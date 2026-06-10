using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>ResetSection</c> feature surface — a parity port of
/// web/src/features/settings/components/ResetSection.tsx. It stacks the web component's three panels: a
/// by-section "Reset to defaults" list whose every whitelisted row carries a destructive
/// <see cref="TsConfirmDialog"/>-gated "Reset" action; a read-only deny-list of sections the Settings page
/// cannot reset; and a red-edged "Danger zone" whose "Reset ALL settings" action requires the user to type
/// <c>RESET</c> before the confirm button enables (the web <c>requireTypedConfirmation</c>). Each completed
/// reset announces an inline status line (the web <c>useToast</c> success / error, mapped to this codebase's
/// inline-announce convention). The view never performs HTTP — it binds the shared
/// <see cref="ResetSectionViewModel"/>. Every string resolves through the i18n facade, every interactive
/// element carries a Narrator name, and the surface adds no bespoke motion so reduced-motion is honoured by
/// construction.
/// </summary>
public sealed partial class ResetSection : ContentControl, IDisposable
{
    private const double PanelPadding = 20;   // web p-5
    private const double IconBoxSize = 40;    // web h-10 w-10
    private const double SmallIconBoxSize = 32;

    private readonly ResetSectionViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;
    private readonly StackPanel _root = new() { Spacing = 24 };

    private TsConfirmDialog? _sectionDialog;
    private TsConfirmDialog? _resetAllDialog;
    private TsInput? _typedInput;
    private string? _announcedStatus;
    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its reset source, localizer and (optional) diagnostics sink.</summary>
    /// <param name="source">The reset mutation port (single-section + global reset).</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public ResetSection(
        ISettingsResetSource source,
        ILocalizer localizer,
        ResetSectionDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new ResetSectionViewModel(source, localizer, diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;
        AutomationProperties.SetAutomationId(this, "reset-section");
        AutomationProperties.SetName(this, _viewModel.Title);
        AutomationProperties.SetAutomationId(_root, "reset-section-root");

        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface slug (<c>ResetSection</c>).</summary>
    public static string SurfaceId => ResetSectionRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public ResetSectionViewModel ViewModel => _viewModel;

    /// <summary>Convenience factory wiring the contract-client-backed <see cref="SettingsResetSource"/>.</summary>
    /// <param name="api">The shared generated contract client.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public static ResetSection Create(
        IApiClient api,
        ILocalizer localizer,
        ResetSectionDiagnostics? diagnostics = null) =>
        new(new SettingsResetSource(api), localizer, diagnostics);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model, dismiss any dialog and cancel in-flight work (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        DismissSectionDialog();
        DismissResetAllDialog();
        _viewModel.Dispose();
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
        AutomationProperties.SetName(this, _viewModel.Title);

        _root.Children.Clear();
        _root.Children.Add(BuildBySectionPanel());
        _root.Children.Add(BuildDeniedPanel());
        _root.Children.Add(BuildDangerPanel());

        var status = BuildStatusLine();
        if (status is not null)
        {
            _root.Children.Add(status);
        }
    }

    // ── By-section panel (web settingsReset.title) ───────────────────────────────────────────────────────

    private TsGlassPanel BuildBySectionPanel()
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(BuildHeader(
            ResetSectionRegistration.ResetGlyph,
            "TsColorWarningBrush",
            new SectionTitle { Value = _viewModel.Title, Foreground = DisplayTokens.TextPrimary },
            _viewModel.Subtitle));

        var list = new StackPanel { Spacing = 0 };
        var sections = _viewModel.Sections;
        for (int i = 0; i < sections.Count; i++)
        {
            list.Children.Add(BuildSectionRow(sections[i]));
            if (i < sections.Count - 1)
            {
                list.Children.Add(Separator());
            }
        }

        column.Children.Add(list);
        return Panel(column, "reset-section-by-section");
    }

    private Grid BuildSectionRow(ResetSectionRow row)
    {
        bool busy = _viewModel.IsBusyForSection(row);

        var grid = new Grid { ColumnSpacing = 12, Padding = new Thickness(0, 12, 0, 12) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        AutomationProperties.SetAutomationId(grid, $"reset-section-row-{row.Id}");

        var icon = BuildIconBox(row.Glyph, "TsColorInfoBrush", SmallIconBoxSize);
        Grid.SetColumn(icon, 0);

        var text = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        var title = new Subhead { Value = row.Title, Foreground = DisplayTokens.TextPrimary };
        AutomationProperties.SetHeadingLevel(title, AutomationHeadingLevel.Level3);
        text.Children.Add(title);
        text.Children.Add(new HelperText { Value = row.Description });
        Grid.SetColumn(text, 1);

        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            IconGlyph = ResetSectionRegistration.ResetGlyph,
            Text = _viewModel.ResetActionLabel,
            IsLoading = busy,
            IsEnabled = !busy,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(button, _viewModel.ResetActionLabel);
        AutomationProperties.SetAutomationId(button, $"reset-section-button-{row.Id}");
        button.Click += (_, _) => _viewModel.RequestSectionReset(row);
        Grid.SetColumn(button, 2);

        grid.Children.Add(icon);
        grid.Children.Add(text);
        grid.Children.Add(button);
        return grid;
    }

    // ── Deny-list panel (web settingsReset.deniedTitle) ──────────────────────────────────────────────────

    private TsGlassPanel BuildDeniedPanel()
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(BuildHeader(
            ResetSectionRegistration.ShieldGlyph,
            "TsColorInfoBrush",
            new PanelTitle { Value = _viewModel.DeniedTitle, Foreground = DisplayTokens.TextPrimary },
            _viewModel.DeniedSubtitle));

        var list = new StackPanel { Spacing = 12 };
        foreach (var row in _viewModel.DeniedRows)
        {
            list.Children.Add(BuildDeniedRow(row));
        }

        column.Children.Add(list);
        return Panel(column, "reset-section-denied");
    }

    private static Grid BuildDeniedRow(ResetDeniedRow row)
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        AutomationProperties.SetAutomationId(grid, $"reset-section-denied-row-{row.Id}");

        var icon = new FontIcon
        {
            Glyph = ResetSectionRegistration.WarningGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Brush("TsColorWarningBrush"),
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 2, 0, 0),
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        Grid.SetColumn(icon, 0);

        var text = new StackPanel { Spacing = 2 };
        var title = new Subhead { Value = row.Title, Foreground = DisplayTokens.TextPrimary };
        AutomationProperties.SetHeadingLevel(title, AutomationHeadingLevel.Level3);
        text.Children.Add(title);
        text.Children.Add(new HelperText { Value = row.Reason });
        Grid.SetColumn(text, 1);

        grid.Children.Add(icon);
        grid.Children.Add(text);
        return grid;
    }

    // ── Danger zone (web settingsReset.dangerZone.title) ─────────────────────────────────────────────────

    private TsGlassPanel BuildDangerPanel()
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(BuildHeader(
            ResetSectionRegistration.WarningGlyph,
            "TsColorDangerBrush",
            new SectionTitle { Value = _viewModel.DangerZoneTitle, Foreground = DisplayTokens.TextPrimary },
            _viewModel.DangerZoneSubtitle));

        var row = new Grid { ColumnSpacing = 12 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var help = new HelperText { Value = _viewModel.DangerZoneHelp, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(help, 0);

        var button = new TsButton
        {
            Variant = ButtonVariant.Destructive,
            IconGlyph = ResetSectionRegistration.ResetGlyph,
            Text = _viewModel.DangerZoneCta,
            IsLoading = _viewModel.IsResetAllBusy,
            IsEnabled = !_viewModel.IsResetAllBusy,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(button, _viewModel.DangerZoneCta);
        AutomationProperties.SetAutomationId(button, "reset-section-reset-all");
        button.Click += (_, _) => _viewModel.RequestResetAll();
        Grid.SetColumn(button, 1);

        row.Children.Add(help);
        row.Children.Add(button);
        column.Children.Add(row);

        var panel = Panel(column, "reset-section-danger-zone");
        panel.BorderBrush = DisplayTokens.Brush("TsColorDangerBrush");
        return panel;
    }

    // ── Inline status line (web toast.success / toast.error) ─────────────────────────────────────────────

    private StackPanel? BuildStatusLine()
    {
        if (_viewModel.StatusMessage is not { Length: > 0 } message)
        {
            _announcedStatus = null;
            return null;
        }

        bool isError = _viewModel.StatusIsError;
        string brushKey = isError ? "TsColorDangerBrush" : "TsColorSuccessBrush";
        string glyph = isError ? ResetSectionRegistration.ErrorGlyph : ResetSectionRegistration.SuccessGlyph;

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAutomationId(row, "reset-section-status");
        row.Children.Add(new FontIcon
        {
            Glyph = glyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush(brushKey),
            VerticalAlignment = VerticalAlignment.Center,
        });
        row.Children.Add(new Text
        {
            Value = message,
            Foreground = DisplayTokens.Brush(brushKey),
            VerticalAlignment = VerticalAlignment.Center,
        });

        AutomationProperties.SetName(row, message);
        LiveRegion.Configure(row, assertive: isError);
        if (!string.Equals(_announcedStatus, message, StringComparison.Ordinal))
        {
            _announcedStatus = message;
            LiveRegion.Announce(row);
        }

        return row;
    }

    // ── Per-section confirm dialog (web ConfirmDialog) ───────────────────────────────────────────────────

    private void SyncDialogs()
    {
        if (_disposed)
        {
            return;
        }

        if (_viewModel.IsResetAllOpen)
        {
            ShowResetAllDialog();
        }
        else
        {
            DismissResetAllDialog();
        }

        if (_viewModel.IsSectionConfirmOpen)
        {
            ShowSectionDialog();
        }
        else
        {
            DismissSectionDialog();
        }
    }

    private void ShowSectionDialog()
    {
        if (_sectionDialog is not null || XamlRoot is null)
        {
            return;
        }

        var dialog = new TsConfirmDialog
        {
            Title = _viewModel.SectionConfirmTitle,
            Content = BuildDialogMessage(_viewModel.SectionConfirmMessage),
            PrimaryButtonText = _viewModel.ConfirmLabel,
            CloseButtonText = _viewModel.CancelLabel,
            IsDestructive = true,
            XamlRoot = XamlRoot,
        };
        AutomationProperties.SetAutomationId(dialog, "reset-section-confirm-dialog");
        dialog.PrimaryButtonClick += OnSectionConfirmPrimary;
        dialog.CloseButtonClick += OnSectionConfirmClose;

        _sectionDialog = dialog;
        _ = dialog.ShowAsync();
    }

    private void DismissSectionDialog()
    {
        if (_sectionDialog is not { } dialog)
        {
            return;
        }

        _sectionDialog = null;
        dialog.PrimaryButtonClick -= OnSectionConfirmPrimary;
        dialog.CloseButtonClick -= OnSectionConfirmClose;
        dialog.Hide();
    }

    private void OnSectionConfirmPrimary(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        _sectionDialog = null;
        sender.PrimaryButtonClick -= OnSectionConfirmPrimary;
        sender.CloseButtonClick -= OnSectionConfirmClose;
        _ = _viewModel.ConfirmSectionResetAsync();
    }

    private void OnSectionConfirmClose(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        _sectionDialog = null;
        sender.PrimaryButtonClick -= OnSectionConfirmPrimary;
        sender.CloseButtonClick -= OnSectionConfirmClose;
        _viewModel.CancelSectionReset();
    }

    // ── Danger-zone typed-confirmation dialog (web requireTypedConfirmation) ─────────────────────────────

    private void ShowResetAllDialog()
    {
        if (_resetAllDialog is not null || XamlRoot is null)
        {
            return;
        }

        var content = new StackPanel { Spacing = 12, MaxWidth = 360 };
        content.Children.Add(BuildDialogMessage(_viewModel.AllConfirmMessage));

        var field = new StackPanel { Spacing = 4 };
        field.Children.Add(new Label { Value = _viewModel.TypedConfirmationLabel });
        _typedInput = new TsInput { Hint = ResetSectionRegistration.TypedConfirmationToken };
        AutomationProperties.SetName(_typedInput, _viewModel.TypedConfirmationLabel);
        AutomationProperties.SetAutomationId(_typedInput, "reset-section-typed-confirm");
        _typedInput.TextChanged += OnTypedConfirmationChanged;
        field.Children.Add(_typedInput);
        content.Children.Add(field);

        var dialog = new TsConfirmDialog
        {
            Title = _viewModel.AllConfirmTitle,
            Content = content,
            PrimaryButtonText = _viewModel.AllConfirmLabel,
            CloseButtonText = _viewModel.CancelLabel,
            IsDestructive = true,
            IsPrimaryButtonEnabled = false,
            XamlRoot = XamlRoot,
        };
        AutomationProperties.SetAutomationId(dialog, "reset-section-confirm-all-dialog");
        dialog.PrimaryButtonClick += OnResetAllPrimary;
        dialog.CloseButtonClick += OnResetAllClose;

        _resetAllDialog = dialog;
        _ = dialog.ShowAsync();
    }

    private void DismissResetAllDialog()
    {
        if (_resetAllDialog is not { } dialog)
        {
            return;
        }

        if (_typedInput is { } input)
        {
            input.TextChanged -= OnTypedConfirmationChanged;
        }

        _typedInput = null;
        _resetAllDialog = null;
        dialog.PrimaryButtonClick -= OnResetAllPrimary;
        dialog.CloseButtonClick -= OnResetAllClose;
        dialog.Hide();
    }

    private void OnTypedConfirmationChanged(object sender, TextChangedEventArgs e)
    {
        if (_resetAllDialog is { } dialog)
        {
            dialog.IsPrimaryButtonEnabled = ResetSectionProjection.IsTypedConfirmationSatisfied(_typedInput?.Text);
        }
    }

    private void OnResetAllPrimary(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        DetachResetAllHandlers(sender);
        _ = _viewModel.ConfirmResetAllAsync();
    }

    private void OnResetAllClose(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        DetachResetAllHandlers(sender);
        _viewModel.CancelResetAll();
    }

    private void DetachResetAllHandlers(ContentDialog sender)
    {
        if (_typedInput is { } input)
        {
            input.TextChanged -= OnTypedConfirmationChanged;
        }

        _typedInput = null;
        _resetAllDialog = null;
        sender.PrimaryButtonClick -= OnResetAllPrimary;
        sender.CloseButtonClick -= OnResetAllClose;
    }

    // ── Shared chrome helpers ────────────────────────────────────────────────────────────────────────────

    private static StackPanel BuildHeader(string glyph, string accentBrushKey, TsTypography title, string subtitle)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };

        var icon = BuildIconBox(glyph, accentBrushKey, IconBoxSize);
        row.Children.Add(icon);

        var titleColumn = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetHeadingLevel(title, AutomationHeadingLevel.Level2);
        titleColumn.Children.Add(title);
        titleColumn.Children.Add(new Text { Value = subtitle, Foreground = DisplayTokens.TextMuted });

        row.Children.Add(titleColumn);
        return row;
    }

    private static Border BuildIconBox(string glyph, string accentBrushKey, double size)
    {
        var accent = DisplayTokens.Brush(accentBrushKey);
        var box = new Border
        {
            Width = size,
            Height = size,
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
            Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush"),
            BorderBrush = accent,
            BorderThickness = new Thickness(1),
            VerticalAlignment = VerticalAlignment.Top,
            Child = new FontIcon
            {
                Glyph = glyph,
                FontSize = size >= IconBoxSize ? 20 : 16,
                Foreground = accent,
            },
        };
        AutomationProperties.SetAccessibilityView(box, AccessibilityView.Raw);
        return box;
    }

    private static StackPanel BuildDialogMessage(string message)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        row.Children.Add(new FontIcon
        {
            Glyph = ResetSectionRegistration.WarningGlyph,
            FontSize = 20,
            Foreground = DisplayTokens.Brush("TsColorDangerBrush"),
            VerticalAlignment = VerticalAlignment.Top,
        });
        row.Children.Add(new TextBlock
        {
            Text = message,
            TextWrapping = TextWrapping.Wrap,
            Foreground = DisplayTokens.TextPrimary,
            MaxWidth = 320,
        });
        return row;
    }

    private static Border Separator() => new()
    {
        Height = 1,
        Background = DisplayTokens.Border,
    };

    private static TsGlassPanel Panel(UIElement content, string automationId)
    {
        var panel = new TsGlassPanel
        {
            Padding = new Thickness(PanelPadding),
            Content = content,
        };
        AutomationProperties.SetAutomationId(panel, automationId);
        return panel;
    }
}
