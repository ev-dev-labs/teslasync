using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>LayoutSwitcher</c> feature surface — a parity port of
/// web/src/features/dashboard/components/LayoutSwitcher.tsx. It composes the web component's fragment: a
/// bordered trigger button carrying the uppercase "Layout" caption, the active layout name and the optional
/// "modified" / pinned-vehicle badges, which opens a light-dismiss <see cref="Flyout"/> menu of the layouts
/// visible for the selected vehicle (each a switch row with a "default" badge, a pin glyph and a trailing
/// check for the active one) followed by the "new layout from current", pin / unpin, and destructive
/// "reset to default" actions and a footer hint; the web's empty branch (no layouts for this vehicle) renders
/// as a friendly in-menu message. Alongside the trigger sit the inline edit / save-as / reset actions. Save-as
/// opens a name prompt (the web <c>window.prompt</c>) pre-filled with the active layout's name plus a copy
/// suffix; reset routes through a destructive <see cref="TsConfirmDialog"/> (the web <c>useConfirm()</c>).
/// There is deliberately no loading / stale / error / offline chrome because the web source has none —
/// <c>LayoutSwitcher</c> is a controlled component driven entirely by its props. All state, label resolution
/// and menu composition flow through the shared <see cref="LayoutSwitcherViewModel"/> /
/// <see cref="LayoutSwitcherProjection"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class LayoutSwitcher : ContentControl, IDisposable
{
    private const string ChevronGlyph = "\uE70D";  // Segoe Fluent — ChevronDown (web ChevronDown)
    private const string PinGlyph = "\uE718";       // Segoe Fluent — Pinned (web Pin)
    private const string EditGlyph = "\uE70F";      // Segoe Fluent — Edit (web Edit3)
    private const string SaveGlyph = "\uE74E";      // Segoe Fluent — Save (web Save)
    private const string ResetGlyph = "\uE72C";     // Segoe Fluent — Refresh (web RotateCcw)
    private const string AddGlyph = "\uE710";       // Segoe Fluent — Add (web Plus)
    private const string CheckGlyph = "\uE73E";     // Segoe Fluent — CheckMark (web Check)
    private const string MoreGlyph = "\uE712";      // Segoe Fluent — More (web MoreHorizontal)

    private const double MenuMinWidth = 256;   // web min-w-[16rem]
    private const double MenuMaxHeight = 288;  // web max-h-72

    private readonly ILocalizer _localizer;
    private readonly LayoutSwitcherViewModel _viewModel;
    private readonly LayoutSwitcherDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 4,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Button _trigger = new();
    private readonly TextBlock _triggerLabel = new();
    private readonly TextBlock _triggerName = new() { TextTrimming = TextTrimming.CharacterEllipsis };
    private readonly TsBadge _modifiedBadge = new() { Status = StatusKind.Warning };
    private readonly TextBlock _modifiedText = new();
    private readonly TsBadge _pinnedBadge = new() { Status = StatusKind.Neutral };
    private readonly TextBlock _pinnedText = new();
    private readonly Flyout _menuFlyout = new();
    private readonly StackPanel _menuRoot = new() { Spacing = 2, MinWidth = MenuMinWidth };

    private readonly StackPanel _actions = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 4,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsButton _editButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };
    private readonly TsButton _saveAsButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };
    private readonly TsButton _resetButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };

    private TsConfirmDialog? _confirmDialog;
    private ContentDialog? _promptDialog;
    private TsInput? _promptInput;
    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its i18n facade, an optional initial model and diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial inputs; defaults to <see cref="LayoutSwitcherModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public LayoutSwitcher(
        ILocalizer localizer,
        LayoutSwitcherModel? model = null,
        LayoutSwitcherDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new LayoutSwitcherDiagnostics();
        _viewModel = new LayoutSwitcherViewModel(localizer, model ?? LayoutSwitcherModel.Empty, _diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Left;
        VerticalContentAlignment = VerticalAlignment.Center;

        BuildChrome();
        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>LayoutSwitcher</c>).</summary>
    public static string Slug => LayoutSwitcherRegistration.Slug;

    /// <summary>The backing state holder (exposed so a host can subscribe to the action events).</summary>
    public LayoutSwitcherViewModel ViewModel => _viewModel;

    /// <summary>The current inputs; reassigning re-projects and re-renders the surface.</summary>
    public LayoutSwitcherModel Model
    {
        get => _viewModel.Model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _viewModel.Model = value;
        }
    }

    /// <summary>Convenience factory mirroring the sibling surfaces' <c>Create</c> entry point.</summary>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="model">The initial inputs; defaults to <see cref="LayoutSwitcherModel.Empty"/>.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public static LayoutSwitcher Create(
        ILocalizer localizer,
        LayoutSwitcherModel? model = null,
        LayoutSwitcherDiagnostics? diagnostics = null) =>
        new(localizer, model, diagnostics);

    private void BuildChrome()
    {
        _triggerLabel.FontFamily = TypographyTokens.Sans;
        _triggerLabel.FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12);
        _triggerLabel.FontWeight = FontWeights.SemiBold;
        _triggerLabel.Foreground = DisplayTokens.TextMuted;
        _triggerLabel.CharacterSpacing = 60;
        _triggerLabel.VerticalAlignment = VerticalAlignment.Center;

        _triggerName.FontFamily = TypographyTokens.Sans;
        _triggerName.FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14);
        _triggerName.FontWeight = FontWeights.Medium;
        _triggerName.Foreground = DisplayTokens.TextPrimary;
        _triggerName.MaxWidth = 160; // web max-w-[10rem]
        _triggerName.VerticalAlignment = VerticalAlignment.Center;

        _modifiedText.FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12);
        _modifiedBadge.Content = _modifiedText;
        _modifiedBadge.VerticalAlignment = VerticalAlignment.Center;
        _modifiedBadge.Visibility = Visibility.Collapsed;

        var pinnedContent = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };
        pinnedContent.Children.Add(DecorativeIcon(PinGlyph, 10));
        _pinnedText.FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12);
        _pinnedText.VerticalAlignment = VerticalAlignment.Center;
        pinnedContent.Children.Add(_pinnedText);
        _pinnedBadge.Content = pinnedContent;
        _pinnedBadge.VerticalAlignment = VerticalAlignment.Center;
        _pinnedBadge.Visibility = Visibility.Collapsed;

        var triggerContent = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        triggerContent.Children.Add(_triggerLabel);
        triggerContent.Children.Add(_triggerName);
        triggerContent.Children.Add(_modifiedBadge);
        triggerContent.Children.Add(_pinnedBadge);
        triggerContent.Children.Add(DecorativeIcon(ChevronGlyph, 12, DisplayTokens.TextMuted));

        _trigger.Content = triggerContent;
        _trigger.Padding = new Thickness(12, 6, 12, 6);
        _trigger.BorderBrush = DisplayTokens.Border;
        _trigger.BorderThickness = new Thickness(1);
        _trigger.CornerRadius = DisplayTokens.Radius("TsRadiusLg", 8);
        _trigger.Background = DisplayTokens.Surface;
        _trigger.Flyout = _menuFlyout;

        _menuFlyout.Content = _menuRoot;
        _menuFlyout.Opening += OnMenuOpening;
        _menuFlyout.Closed += OnMenuClosed;

        _editButton.Click += OnEditClick;
        _saveAsButton.Click += OnSaveAsClick;
        _resetButton.Click += OnResetClick;
        _resetButton.IconGlyph = ResetGlyph;

        _actions.Children.Add(_editButton);
        _actions.Children.Add(_saveAsButton);
        _actions.Children.Add(_resetButton);

        _root.Children.Add(_trigger);
        _root.Children.Add(_actions);
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

    /// <summary>Detach from the view-model, dismiss any dialog and stop rendering (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _menuFlyout.Opening -= OnMenuOpening;
        _menuFlyout.Closed -= OnMenuClosed;
        _editButton.Click -= OnEditClick;
        _saveAsButton.Click -= OnSaveAsClick;
        _resetButton.Click -= OnResetClick;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        DismissConfirmDialog();
        DismissPromptDialog();
        GC.SuppressFinalize(this);
    }

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
        SyncDialogs();
    }

    private void Render()
    {
        LayoutSwitcherDisplay display = _viewModel.Display;

        AutomationProperties.SetName(this, display.SwitcherAutomationName);
        AutomationProperties.SetName(_trigger, display.SwitcherAutomationName);
        _triggerLabel.Text = display.LabelText;
        _triggerName.Text = display.ActiveName;

        _modifiedText.Text = display.ModifiedText;
        _modifiedBadge.Visibility = display.ShowModifiedBadge ? Visibility.Visible : Visibility.Collapsed;
        AutomationProperties.SetName(_modifiedBadge, display.ModifiedText);

        _pinnedText.Text = display.PinnedLabel ?? string.Empty;
        _pinnedBadge.Visibility = display.ShowPinnedBadge ? Visibility.Visible : Visibility.Collapsed;
        if (display.ShowPinnedBadge && display.PinnedLabel is { } pinned)
        {
            AutomationProperties.SetName(_pinnedBadge, pinned);
        }

        _editButton.Visibility = display.ShowEditButton ? Visibility.Visible : Visibility.Collapsed;
        _editButton.Text = display.EditButtonLabel;
        _editButton.Variant = display.EditActive ? ButtonVariant.Secondary : ButtonVariant.Subtle;
        _editButton.IconGlyph = EditGlyph;
        ToolTipService.SetToolTip(_editButton, display.EditButtonTooltip);
        AutomationProperties.SetName(_editButton, display.EditButtonTooltip);

        _saveAsButton.Text = display.SaveAsLabel;
        _saveAsButton.IconGlyph = SaveGlyph;
        ToolTipService.SetToolTip(_saveAsButton, display.SaveAsTooltip);
        AutomationProperties.SetName(_saveAsButton, display.SaveAsTooltip);

        ToolTipService.SetToolTip(_resetButton, display.ResetTooltip);
        AutomationProperties.SetName(_resetButton, display.ResetTooltip);

        BuildMenu(display);
    }

    // ── Saved-layouts menu (web dropdown) ────────────────────────────────────────────────────────────────

    private void BuildMenu(LayoutSwitcherDisplay display)
    {
        _menuRoot.Children.Clear();
        AutomationProperties.SetName(_menuRoot, display.MenuAutomationName);

        var listPanel = new StackPanel { Spacing = 2 };
        if (display.IsEmpty)
        {
            listPanel.Children.Add(new TextBlock
            {
                Text = display.EmptyMessage,
                FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
                Foreground = DisplayTokens.TextMuted,
                TextWrapping = TextWrapping.Wrap,
                Padding = new Thickness(12, 8, 12, 8),
            });
        }
        else
        {
            foreach (LayoutMenuEntry entry in display.Entries)
            {
                listPanel.Children.Add(BuildEntryRow(entry, display.DefaultBadgeText));
            }
        }

        _menuRoot.Children.Add(new ScrollViewer
        {
            Content = listPanel,
            MaxHeight = MenuMaxHeight,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        });

        _menuRoot.Children.Add(BuildSeparator());

        _menuRoot.Children.Add(BuildActionRow(AddGlyph, display.NewFromCurrentLabel, danger: false, OnNewLayoutClick));

        if (display.ShowPinToggle)
        {
            Button pin = BuildActionRow(PinGlyph, display.PinToggleLabel, danger: false, OnPinToggleClick);
            pin.IsEnabled = display.PinToggleEnabled;
            _menuRoot.Children.Add(pin);
        }

        _menuRoot.Children.Add(BuildActionRow(ResetGlyph, display.ResetItemLabel, danger: true, OnResetMenuClick));

        _menuRoot.Children.Add(BuildSeparator());

        var footer = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            Padding = new Thickness(8, 4, 8, 4),
        };
        footer.Children.Add(DecorativeIcon(MoreGlyph, 12, DisplayTokens.TextMuted));
        footer.Children.Add(new TextBlock
        {
            Text = display.MenuFooterText,
            FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            Foreground = DisplayTokens.TextMuted,
            TextWrapping = TextWrapping.Wrap,
            VerticalAlignment = VerticalAlignment.Center,
        });
        AutomationProperties.SetAccessibilityView(footer, AccessibilityView.Raw);
        _menuRoot.Children.Add(footer);
    }

    private Button BuildEntryRow(LayoutMenuEntry entry, string defaultBadgeText)
    {
        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var nameRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };
        nameRow.Children.Add(new TextBlock
        {
            Text = entry.Name,
            FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
            Foreground = entry.IsActive ? DisplayTokens.Accent : DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        });

        if (entry.ShowDefaultBadge)
        {
            var badge = new TsBadge
            {
                Status = StatusKind.Neutral,
                Content = new TextBlock
                {
                    Text = defaultBadgeText,
                    FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
                },
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(badge, AccessibilityView.Raw);
            nameRow.Children.Add(badge);
        }

        if (entry.ShowPinGlyph)
        {
            nameRow.Children.Add(DecorativeIcon(PinGlyph, 12, DisplayTokens.TextMuted));
        }

        Grid.SetColumn(nameRow, 0);
        grid.Children.Add(nameRow);

        if (entry.IsActive)
        {
            FontIcon check = DecorativeIcon(CheckGlyph, 14, DisplayTokens.Accent);
            Grid.SetColumn(check, 1);
            grid.Children.Add(check);
        }

        Button button = MenuButton(grid, danger: false);
        button.Background = entry.IsActive ? DisplayTokens.Brush("TsColorAccentSoftBrush") : button.Background;
        AutomationProperties.SetName(button, entry.AutomationName);
        button.Click += (_, _) =>
        {
            _menuFlyout.Hide();
            _viewModel.Switch(entry.Id);
        };
        return button;
    }

    private static Button BuildActionRow(string glyph, string text, bool danger, RoutedEventHandler handler)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Brush tint = danger ? DisplayTokens.Brush("TsColorDangerBrush") : DisplayTokens.TextMuted;
        row.Children.Add(DecorativeIcon(glyph, 14, tint));
        row.Children.Add(new TextBlock
        {
            Text = text,
            FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
            Foreground = danger ? DisplayTokens.Brush("TsColorDangerBrush") : DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        });

        Button button = MenuButton(row, danger);
        AutomationProperties.SetName(button, text);
        button.Click += handler;
        return button;
    }

    private static Button MenuButton(UIElement content, bool danger)
    {
        _ = danger;
        return new Button
        {
            Content = content,
            Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
            BorderThickness = new Thickness(0),
            Padding = new Thickness(8, 6, 8, 6),
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 6),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
    }

    private static Border BuildSeparator() => new()
    {
        Height = 1,
        Margin = new Thickness(4, 2, 4, 2),
        Background = DisplayTokens.Border,
    };

    private void OnMenuOpening(object? sender, object e) => _viewModel.OpenMenu();

    private void OnMenuClosed(object? sender, object e) => _viewModel.CloseMenu();

    private void OnNewLayoutClick(object sender, RoutedEventArgs e)
    {
        _menuFlyout.Hide();
        _viewModel.BeginSaveAs();
    }

    private void OnPinToggleClick(object sender, RoutedEventArgs e)
    {
        _menuFlyout.Hide();
        _viewModel.TogglePin();
    }

    private void OnResetMenuClick(object sender, RoutedEventArgs e)
    {
        _menuFlyout.Hide();
        _viewModel.BeginReset();
    }

    // ── Inline actions ───────────────────────────────────────────────────────────────────────────────────

    private void OnEditClick(object sender, RoutedEventArgs e) => _viewModel.ToggleEdit();

    private void OnSaveAsClick(object sender, RoutedEventArgs e) => _viewModel.BeginSaveAs();

    private void OnResetClick(object sender, RoutedEventArgs e) => _viewModel.BeginReset();

    // ── Modal dialogs (web window.prompt + useConfirm) ─────────────────────────────────────────────────────

    private void SyncDialogs()
    {
        if (_disposed)
        {
            return;
        }

        if (_viewModel.IsResetConfirmOpen)
        {
            ShowConfirmDialog();
        }
        else
        {
            DismissConfirmDialog();
        }

        if (_viewModel.IsSaveAsPromptOpen)
        {
            ShowPromptDialog();
        }
        else
        {
            DismissPromptDialog();
        }
    }

    private void ShowConfirmDialog()
    {
        if (_confirmDialog is not null || XamlRoot is null)
        {
            return;
        }

        LayoutSwitcherDisplay display = _viewModel.Display;
        var dialog = new TsConfirmDialog
        {
            Title = display.ResetConfirmTitle,
            Content = new TextBlock
            {
                Text = display.ResetConfirmMessage,
                TextWrapping = TextWrapping.Wrap,
                MaxWidth = 360,
            },
            PrimaryButtonText = display.ResetConfirmLabel,
            CloseButtonText = display.CancelLabel,
            IsDestructive = true,
            XamlRoot = XamlRoot,
        };
        dialog.PrimaryButtonClick += OnConfirmPrimary;
        dialog.CloseButtonClick += OnConfirmClose;

        _confirmDialog = dialog;
        _ = dialog.ShowAsync();
    }

    private void DismissConfirmDialog()
    {
        if (_confirmDialog is not { } dialog)
        {
            return;
        }

        _confirmDialog = null;
        dialog.PrimaryButtonClick -= OnConfirmPrimary;
        dialog.CloseButtonClick -= OnConfirmClose;
        dialog.Hide();
    }

    private void OnConfirmPrimary(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        _confirmDialog = null;
        sender.PrimaryButtonClick -= OnConfirmPrimary;
        sender.CloseButtonClick -= OnConfirmClose;
        _viewModel.ConfirmReset();
    }

    private void OnConfirmClose(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        _confirmDialog = null;
        sender.PrimaryButtonClick -= OnConfirmPrimary;
        sender.CloseButtonClick -= OnConfirmClose;
        _viewModel.CancelReset();
    }

    private void ShowPromptDialog()
    {
        if (_promptDialog is not null || XamlRoot is null)
        {
            return;
        }

        LayoutSwitcherDisplay display = _viewModel.Display;
        var input = new TsInput { Text = display.SaveAsSuggestion };
        AutomationProperties.SetName(input, display.SaveAsPromptTitle);
        _promptInput = input;

        var dialog = new ContentDialog
        {
            Title = display.SaveAsPromptTitle,
            Content = input,
            PrimaryButtonText = display.SaveAsConfirmLabel,
            CloseButtonText = display.CancelLabel,
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = XamlRoot,
        };
        dialog.PrimaryButtonClick += OnPromptPrimary;
        dialog.CloseButtonClick += OnPromptClose;

        _promptDialog = dialog;
        _ = dialog.ShowAsync();
        input.SelectAll();
    }

    private void DismissPromptDialog()
    {
        if (_promptDialog is not { } dialog)
        {
            return;
        }

        _promptDialog = null;
        _promptInput = null;
        dialog.PrimaryButtonClick -= OnPromptPrimary;
        dialog.CloseButtonClick -= OnPromptClose;
        dialog.Hide();
    }

    private void OnPromptPrimary(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        string? text = _promptInput?.Text;
        _promptDialog = null;
        _promptInput = null;
        sender.PrimaryButtonClick -= OnPromptPrimary;
        sender.CloseButtonClick -= OnPromptClose;
        _viewModel.CommitSaveAs(text);
    }

    private void OnPromptClose(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        _promptDialog = null;
        _promptInput = null;
        sender.PrimaryButtonClick -= OnPromptPrimary;
        sender.CloseButtonClick -= OnPromptClose;
        _viewModel.CancelSaveAs();
    }

    // ── Shared primitives ──────────────────────────────────────────────────────────────────────────────────

    private static FontIcon DecorativeIcon(string glyph, double size) =>
        DecorativeIcon(glyph, size, DisplayTokens.TextMuted);

    private static FontIcon DecorativeIcon(string glyph, double size, Brush foreground)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = size,
            Foreground = foreground,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Decorative: the surrounding control's automation name already conveys the meaning.
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }
}
