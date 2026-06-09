using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using Windows.ApplicationModel.DataTransfer;
using Windows.UI;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 LayoutManager surface — a parity port of
/// web/src/features/dashboard/components/LayoutManager.tsx. It reproduces the web component's composition: a
/// horizontally scrollable strip of dashboard-layout "tab" chips (each an emoji icon, the layout name and, for
/// the built-in layout, a localized "default" badge), where the active chip is accent-highlighted, a click
/// switches layout, a right-click (or the keyboard Menu key) opens the per-layout context menu
/// (Rename / Duplicate / Settings / —— / Delete, with Delete disabled for the default layout), and a chip can be
/// dragged to a new position to reorder. A chip being renamed swaps in place to an inline editor (a
/// <see cref="TsInput"/> with confirm/cancel <see cref="TsButton"/>s — Enter confirms a non-empty name, Escape
/// cancels); the trailing "New Layout" affordance either opens the inline create editor or, when a template
/// picker is wired, opens that instead (web <c>startCreate</c>). There is no loading / error / stale / offline
/// branch because the web source has none — it is fully prop-driven and its only hook is
/// <c>useTranslation('dashboard')</c>; the two honest states are the populated strip and a friendly inline empty
/// hint shown beside the always-present "New Layout" affordance (never a blank box). All state and projection
/// flow through the shared <see cref="LayoutManagerViewModel"/>; the view never performs HTTP. Every string
/// resolves through the i18n facade, every interactive element carries a Narrator name, the layout uses platform
/// tokens (no ported web styling), and no custom animations are used so the system reduced-motion preference is
/// honoured implicitly and font sizes scale with the system text-scaling setting.
/// </summary>
public sealed partial class LayoutManager : ContentControl, IDisposable
{
    private const double NameMaxWidth = 140;
    private const double EditorInputMinWidth = 112;

    private readonly LayoutManagerViewModel _viewModel;
    private readonly LayoutManagerDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly ScrollViewer _scroller = new();
    private readonly StackPanel _row = new() { Orientation = Orientation.Horizontal, Spacing = 4 };

    private LayoutManagerDisplay _display;
    private int? _dragIndex;
    private Control? _pendingFocus;
    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over a host-built view-model and an optional diagnostics collector.</summary>
    /// <param name="viewModel">The shared state holder (the host wires its mutation events and pushes updates).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public LayoutManager(LayoutManagerViewModel viewModel, LayoutManagerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new LayoutManagerDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _display = _viewModel.Display;

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>
    /// Creates the surface, building its own <see cref="LayoutManagerViewModel"/> over the i18n facade and the
    /// initial layout collection. The host wires the view-model's mutation events via <see cref="ViewModel"/>.
    /// </summary>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="dashboards">The initial saved layouts (null is treated as empty).</param>
    /// <param name="activeId">The initially active layout id.</param>
    /// <param name="supportsTemplates">True when a template picker is wired (web <c>onOpenTemplates</c> present).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public LayoutManager(
        ILocalizer localizer,
        IReadOnlyList<LayoutDashboard>? dashboards = null,
        string? activeId = null,
        bool supportsTemplates = false,
        LayoutManagerDiagnostics? diagnostics = null)
        : this(new LayoutManagerViewModel(localizer, dashboards, activeId, supportsTemplates), diagnostics)
    {
    }

    /// <summary>The shared state holder the host wires mutation events on and pushes updates through.</summary>
    public LayoutManagerViewModel ViewModel => _viewModel;

    /// <summary>The diagnostics surface slug this view registers under (<c>LayoutManager</c>).</summary>
    public static string Slug => LayoutManagerRegistration.Slug;

    /// <summary>
    /// Re-resolve every label from the localizer and re-render — call after the active language changes so the
    /// strip's copy and accessibility names update without reconstructing the surface (react-i18next parity).
    /// </summary>
    public void Reload() => _viewModel.Reload();

    /// <summary>Detach from the view-model and layout events (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    private void BuildChrome()
    {
        _scroller.HorizontalScrollBarVisibility = ScrollBarVisibility.Auto;
        _scroller.VerticalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _scroller.HorizontalScrollMode = ScrollMode.Enabled;
        _scroller.VerticalScrollMode = ScrollMode.Disabled;
        _scroller.Padding = new Thickness(0, 0, 0, 8);
        _scroller.Content = _row;

        AutomationProperties.SetName(_scroller, _display.RegionName);
        AutomationProperties.SetLandmarkType(_scroller, AutomationLandmarkType.Navigation);
        AutomationProperties.SetLocalizedLandmarkType(_scroller, _display.RegionName);

        Content = _scroller;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        _display = _viewModel.Display;
        _pendingFocus = null;
        _row.Children.Clear();

        AutomationProperties.SetName(_scroller, _display.RegionName);
        AutomationProperties.SetLocalizedLandmarkType(_scroller, _display.RegionName);

        if (_display.State == LayoutManagerState.Empty)
        {
            _row.Children.Add(BuildEmptyHint());
        }

        IReadOnlyList<LayoutTab> tabs = _display.Tabs;
        for (int i = 0; i < tabs.Count; i++)
        {
            LayoutTab tab = tabs[i];
            if (_viewModel.EditingId is { } editingId && string.Equals(editingId, tab.Id, StringComparison.Ordinal))
            {
                _row.Children.Add(BuildRenameEditor());
            }
            else
            {
                _row.Children.Add(BuildChip(tab, i));
            }
        }

        if (_viewModel.IsCreating)
        {
            _row.Children.Add(BuildCreateEditor());
        }
        else
        {
            _row.Children.Add(BuildNewLayoutButton());
        }

        FocusPending();
    }

    private TextBlock BuildEmptyHint() => new()
    {
        Text = _display.EmptyMessage,
        FontFamily = TypographyTokens.Sans,
        FontSize = 12,
        Foreground = DisplayTokens.TextMuted,
        VerticalAlignment = VerticalAlignment.Center,
        Margin = new Thickness(0, 0, 8, 0),
    };

    private Button BuildChip(LayoutTab tab, int index)
    {
        var icon = new TextBlock
        {
            Text = tab.IconGlyph,
            FontSize = 14,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var name = new TextBlock
        {
            Text = tab.Name,
            FontFamily = TypographyTokens.Sans,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            MaxWidth = NameMaxWidth,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var inner = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };
        inner.Children.Add(icon);
        inner.Children.Add(name);

        if (tab.IsDefault && tab.DefaultBadge is { } badge)
        {
            inner.Children.Add(new TextBlock
            {
                Text = badge,
                FontFamily = TypographyTokens.Sans,
                FontSize = 9,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Bottom,
            });
        }

        var chip = new Button
        {
            Content = inner,
            Padding = new Thickness(12, 6, 12, 6),
            MinHeight = 0,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
        };
        ApplyChipVisual(chip, name, tab.IsActive);

        AutomationProperties.SetName(chip, tab.AutomationName);
        ToolTipService.SetToolTip(chip, tab.Name);
        chip.Click += (_, _) => _viewModel.Select(tab.Id);
        chip.ContextFlyout = BuildMenu(tab);
        WireDrag(chip, tab.Id, index);
        return chip;
    }

    private MenuFlyout BuildMenu(LayoutTab tab)
    {
        var flyout = new MenuFlyout();
        foreach (LayoutMenuItem item in LayoutManagerProjection.BuildMenu(_display, tab.IsDefault))
        {
            if (item.Action == LayoutAction.Delete)
            {
                flyout.Items.Add(new MenuFlyoutSeparator());
            }

            var entry = new MenuFlyoutItem
            {
                Text = item.Label,
                Icon = new FontIcon { Glyph = item.Glyph },
                IsEnabled = item.IsEnabled,
            };
            AutomationProperties.SetName(entry, item.Label);

            if (item.IsDanger && DisplayTokens.Brush("TsColorDangerBrush") is { } danger)
            {
                entry.Foreground = danger;
            }

            LayoutAction action = item.Action;
            string id = tab.Id;
            entry.Click += (_, _) => InvokeMenu(action, id);
            flyout.Items.Add(entry);
        }

        return flyout;
    }

    private void InvokeMenu(LayoutAction action, string id)
    {
        switch (action)
        {
            case LayoutAction.Rename:
                _viewModel.BeginRename(id);
                break;
            case LayoutAction.Duplicate:
                _viewModel.Duplicate(id);
                break;
            case LayoutAction.Settings:
                _viewModel.OpenSettings(id);
                break;
            case LayoutAction.Delete:
                _viewModel.Delete(id);
                break;
            default:
                break;
        }
    }

    private void WireDrag(Button chip, string id, int index)
    {
        chip.CanDrag = true;
        chip.AllowDrop = true;
        chip.DragStarting += (_, args) =>
        {
            _dragIndex = index;
            args.Data.RequestedOperation = DataPackageOperation.Move;
            args.Data.SetText(id);
        };
        chip.DragOver += (_, args) =>
        {
            if (_dragIndex is not null)
            {
                args.AcceptedOperation = DataPackageOperation.Move;
            }
        };
        chip.Drop += (_, _) =>
        {
            if (_dragIndex is int from)
            {
                _dragIndex = null;
                _viewModel.Reorder(from, index);
            }
        };
        chip.DropCompleted += (_, _) => _dragIndex = null;
    }

    private StackPanel BuildRenameEditor()
    {
        var input = NewEditorInput(_viewModel.EditingName, hint: null, automationName: _display.RenameLabel);
        input.KeyDown += (_, e) => HandleEditorKey(e, () => _viewModel.ConfirmRename(input.Text), _viewModel.CancelRename);

        TsButton confirm = IconButton(_display.ConfirmGlyph, _display.ConfirmRenameLabel, () => _viewModel.ConfirmRename(input.Text));
        TsButton cancel = IconButton(_display.CancelGlyph, _display.CancelRenameLabel, _viewModel.CancelRename);

        _pendingFocus = input;
        return EditorRow(input, confirm, cancel);
    }

    private StackPanel BuildCreateEditor()
    {
        var input = NewEditorInput(string.Empty, hint: _display.NewNameHint, automationName: _display.NewNameHint);
        input.KeyDown += (_, e) => HandleEditorKey(e, () => _viewModel.ConfirmCreate(input.Text), _viewModel.CancelCreate);

        TsButton confirm = IconButton(_display.ConfirmGlyph, _display.ConfirmCreateLabel, () => _viewModel.ConfirmCreate(input.Text));
        TsButton cancel = IconButton(_display.CancelGlyph, _display.CancelCreateLabel, _viewModel.CancelCreate);

        _pendingFocus = input;
        return EditorRow(input, confirm, cancel);
    }

    private TsButton BuildNewLayoutButton()
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = _display.NewLayoutGlyph,
            Text = _display.NewLayoutLabel,
        };
        AutomationProperties.SetName(button, _display.NewLayoutLabel);
        ToolTipService.SetToolTip(button, _display.NewLayoutLabel);
        button.Click += (_, _) => _viewModel.BeginCreate();
        return button;
    }

    private void FocusPending()
    {
        if (_pendingFocus is not { } target)
        {
            return;
        }

        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(() => target.Focus(FocusState.Programmatic));
        }
        else
        {
            target.Focus(FocusState.Programmatic);
        }
    }

    private static TsInput NewEditorInput(string value, string? hint, string automationName)
    {
        var input = new TsInput
        {
            Text = value,
            Hint = hint,
            MinWidth = EditorInputMinWidth,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(input, automationName);
        return input;
    }

    private static TsButton IconButton(string glyph, string automationName, Action onClick)
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = glyph,
        };
        AutomationProperties.SetName(button, automationName);
        ToolTipService.SetToolTip(button, automationName);
        button.Click += (_, _) => onClick();
        return button;
    }

    private static StackPanel EditorRow(TsInput input, TsButton confirm, TsButton cancel)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(input);
        row.Children.Add(confirm);
        row.Children.Add(cancel);
        return row;
    }

    private static void HandleEditorKey(KeyRoutedEventArgs e, Action confirm, Action cancel)
    {
        if (e.Key == Windows.System.VirtualKey.Enter)
        {
            e.Handled = true;
            confirm();
        }
        else if (e.Key == Windows.System.VirtualKey.Escape)
        {
            e.Handled = true;
            cancel();
        }
    }

    private static void ApplyChipVisual(Button chip, TextBlock name, bool active)
    {
        if (active)
        {
            (Brush background, Brush ring, Brush foreground) = ActiveAccentBrushes();
            chip.Background = background;
            chip.BorderBrush = ring;
            chip.BorderThickness = new Thickness(1);
            chip.Foreground = foreground;
            name.Foreground = foreground;
        }
        else
        {
            chip.Background = DisplayTokens.Surface;
            chip.BorderThickness = new Thickness(0);
            chip.Foreground = DisplayTokens.TextSecondary;
            name.Foreground = DisplayTokens.TextSecondary;
        }
    }

    private static (Brush Background, Brush Ring, Brush Foreground) ActiveAccentBrushes()
    {
        // The accent token (web active chip: bg-[var(--theme-primary)]/10, border /20, text full): a ~11% fill,
        // a ~25% ring and the full-strength accent text.
        Brush accent = DisplayTokens.Accent;
        if (accent is SolidColorBrush solid && solid.Color.A != 0)
        {
            Color c = solid.Color;
            return (
                new SolidColorBrush(Color.FromArgb(28, c.R, c.G, c.B)),
                new SolidColorBrush(Color.FromArgb(64, c.R, c.G, c.B)),
                new SolidColorBrush(c));
        }

        return (accent, accent, accent);
    }
}
