using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.Foundation.Collections;
using Windows.Storage;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Settings;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Setup Checklist dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/OnboardingChecklistWidget.tsx. It reproduces the web source's
/// three visibility branches: the hidden/restart footprint (dismissed or celebration elapsed), the
/// friendly "no setup steps" empty state, and the active checklist — a progress header, the seven
/// auto-completing task rows (each with a status icon, optional task-icon chip, title/description and a
/// navigation CTA while incomplete) and, at 100 %, a celebratory footer. All data flows through the
/// shared <see cref="OnboardingChecklistViewModel"/>; the view never performs HTTP. Every string
/// resolves through the i18n facade and every interactive element carries a Narrator name. CTA
/// activation is surfaced as <see cref="NavigationRequested"/> / <see cref="CommandPaletteRequested"/>
/// so the dashboard host performs the actual navigation.
/// </summary>
public sealed partial class OnboardingChecklistWidget : ContentControl, IDisposable
{
    private const string TitleGlyph = "\uE945";     // LightningBolt — web Rocket (get started)
    private const string DismissGlyph = "\uE711";   // Cancel — web X
    private const string RestartGlyph = "\uE72C";   // Refresh — web RotateCcw
    private const string CelebrateGlyph = "\uE735"; // FavoriteStarFill — web Sparkles
    private const string ArrowGlyph = "\uE72A";     // Forward — web ArrowRight
    private const string CheckGlyph = "\uE930";     // Completed — web CheckCircle2

    private const string SuccessBrushKey = "TsColorSuccessBrush";

    private readonly OnboardingChecklistViewModel _viewModel;
    private readonly OnboardingChecklistDiagnostics _diagnostics;
    private readonly OnboardingChecklistSize _size;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ScrollViewer _bodyHost = new();
    private readonly TextBlock _titleText = new();
    private readonly TsButton _dismiss = new() { Variant = ButtonVariant.Icon };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, state store, localizer, footprint and diagnostics.</summary>
    public OnboardingChecklistWidget(
        IOnboardingChecklistSource source,
        IChecklistStateStore store,
        ILocalizer localizer,
        OnboardingChecklistSize size,
        OnboardingChecklistDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new OnboardingChecklistDiagnostics();
        _size = size;
        _viewModel = new OnboardingChecklistViewModel(source, store, localizer, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>Raised when a task CTA is invoked; carries the native route the host should navigate to.</summary>
    public event EventHandler<string>? NavigationRequested;

    /// <summary>Raised when the "try the command palette" CTA is invoked, so the host toggles the palette.</summary>
    public event EventHandler? CommandPaletteRequested;

    /// <summary>The canonical registry id this surface registers under (<c>onboarding-checklist</c>).</summary>
    public static string RegistryId => OnboardingChecklistRegistration.Id;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="OnboardingChecklistSource"/> and
    /// the <see cref="ApplicationData"/>-backed state store from the shared P2-core dependencies.
    /// </summary>
    public static OnboardingChecklistWidget Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        AppSettingsService settings,
        OnboardingChecklistSize? size = null,
        OnboardingChecklistDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(settings);
        var source = new OnboardingChecklistSource(api, engine, options);
        var store = new ApplicationDataChecklistStateStore(settings);
        return new OnboardingChecklistWidget(source, store, localizer, size ?? OnboardingChecklistRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var rocket = new FontIcon
        {
            Glyph = TitleGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(rocket, AccessibilityView.Raw);

        _titleText.FontSize = 11;
        _titleText.FontWeight = FontWeights.Medium;
        _titleText.Foreground = DisplayTokens.TextMuted;
        _titleText.CharacterSpacing = 80;
        _titleText.VerticalAlignment = VerticalAlignment.Center;

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        titleRow.Children.Add(rocket);
        titleRow.Children.Add(_titleText);

        _dismiss.IconGlyph = DismissGlyph;
        _dismiss.Size = ControlSize.Small;
        AutomationProperties.SetName(_dismiss, _viewModel.DismissLabel);
        ToolTipService.SetToolTip(_dismiss, _viewModel.DismissLabel);
        _dismiss.Click += OnDismissClick;

        var header = new Grid { Padding = new Thickness(12, 8, 12, 2) };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(titleRow, 0);
        Grid.SetColumn(_dismiss, 1);
        header.Children.Add(titleRow);
        header.Children.Add(_dismiss);

        _bodyHost.VerticalScrollMode = ScrollMode.Auto;
        _bodyHost.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _bodyHost.HorizontalScrollMode = ScrollMode.Disabled;
        _bodyHost.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _bodyHost.Padding = new Thickness(12, 0, 12, 8);

        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(header, 0);
        Grid.SetRow(_bodyHost, 1);
        _root.Children.Add(header);
        _root.Children.Add(_bodyHost);
        Content = _root;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnDismissClick(object sender, RoutedEventArgs e) => _viewModel.Dismiss();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) => ScheduleRender();

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
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);

        switch (_viewModel.State)
        {
            case OnboardingChecklistState.Hidden:
                _dismiss.Visibility = Visibility.Collapsed;
                _bodyHost.Content = BuildHidden();
                break;

            case OnboardingChecklistState.Empty:
                _dismiss.Visibility = Visibility.Visible;
                _bodyHost.Content = BuildEmpty();
                break;

            default:
                _dismiss.Visibility = Visibility.Visible;
                _bodyHost.Content = BuildActive();
                break;
        }
    }

    private TsEmptyState BuildHidden()
    {
        var empty = new TsEmptyState
        {
            IconGlyph = CelebrateGlyph,
            Title = _viewModel.HiddenTitle,
            Message = _viewModel.HiddenMessage,
            ActionText = _viewModel.RestartLabel,
            VerticalAlignment = VerticalAlignment.Center,
        };
        empty.ActionInvoked += OnRestartInvoked;
        return empty;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = CheckGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private StackPanel BuildActive()
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(BuildProgressHeader());
        column.Children.Add(BuildTaskList());

        if (_viewModel.AllComplete)
        {
            column.Children.Add(BuildCelebration());
        }

        return column;
    }

    private StackPanel BuildProgressHeader()
    {
        var labelRow = new Grid();
        labelRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        labelRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var progressText = new TextBlock
        {
            Text = _viewModel.ProgressText,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var percentText = new TextBlock
        {
            Text = string.Format(CultureInfo.CurrentCulture, "{0}%", _viewModel.ProgressPercent),
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(percentText, AccessibilityView.Raw);
        Grid.SetColumn(progressText, 0);
        Grid.SetColumn(percentText, 1);
        labelRow.Children.Add(progressText);
        labelRow.Children.Add(percentText);

        var bar = new ProgressBar
        {
            Minimum = 0,
            Maximum = Math.Max(1, _viewModel.TotalCount),
            Value = _viewModel.CompleteCount,
            Height = 6,
            Foreground = _viewModel.AllComplete ? DisplayTokens.Brush(SuccessBrushKey) : DisplayTokens.Accent,
        };
        AutomationProperties.SetName(bar, _viewModel.ProgressText);

        return new StackPanel
        {
            Spacing = 8,
            Children = { labelRow, bar },
        };
    }

    private StackPanel BuildTaskList()
    {
        var list = new StackPanel { Spacing = 8 };
        foreach (var task in _viewModel.Tasks)
        {
            list.Children.Add(BuildTaskRow(task));
        }

        AutomationProperties.SetName(list, _viewModel.ProgressText);
        return list;
    }

    private Border BuildTaskRow(ChecklistTaskView task)
    {
        var status = new FontIcon
        {
            Glyph = task.StatusGlyph,
            FontSize = 16,
            Foreground = task.IsComplete ? DisplayTokens.Brush(SuccessBrushKey) : DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(status, AccessibilityView.Raw);

        var body = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Center };
        body.Children.Add(new TextBlock
        {
            Text = task.Title,
            FontSize = 14,
            FontWeight = FontWeights.Medium,
            Foreground = task.IsComplete ? DisplayTokens.TextSecondary : DisplayTokens.TextPrimary,
            TextDecorations = task.IsComplete ? Windows.UI.Text.TextDecorations.Strikethrough : Windows.UI.Text.TextDecorations.None,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });
        body.Children.Add(new TextBlock
        {
            Text = task.Description,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });

        var grid = new Grid { ColumnSpacing = 10, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        if (_size.IsWide)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        }

        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        int column = 0;
        Grid.SetColumn(status, column++);
        grid.Children.Add(status);

        if (_size.IsWide)
        {
            var chip = new Border
            {
                Width = 28,
                Height = 28,
                CornerRadius = new CornerRadius(6),
                Background = DisplayTokens.Surface,
                VerticalAlignment = VerticalAlignment.Center,
                Child = new FontIcon
                {
                    Glyph = task.IconGlyph,
                    FontSize = 13,
                    Foreground = DisplayTokens.TextSecondary,
                },
            };
            AutomationProperties.SetAccessibilityView(chip, AccessibilityView.Raw);
            Grid.SetColumn(chip, column++);
            grid.Children.Add(chip);
        }

        Grid.SetColumn(body, column++);
        grid.Children.Add(body);

        if (!task.IsComplete)
        {
            var cta = new TsButton
            {
                Variant = ButtonVariant.Subtle,
                Size = ControlSize.Small,
                Text = task.CtaLabel,
                IconGlyph = ArrowGlyph,
                VerticalAlignment = VerticalAlignment.Center,
                DataContext = task,
            };
            AutomationProperties.SetName(cta, string.Format(CultureInfo.CurrentCulture, "{0}: {1}", task.CtaLabel, task.Title));
            cta.Click += OnCtaClick;
            Grid.SetColumn(cta, column);
            grid.Children.Add(cta);
        }

        var border = new Border
        {
            CornerRadius = new CornerRadius(8),
            BorderThickness = new Thickness(1),
            BorderBrush = DisplayTokens.Border,
            Background = DisplayTokens.Surface,
            Padding = new Thickness(12),
            Opacity = task.IsComplete ? 0.6 : 1.0,
            Child = grid,
        };
        AutomationProperties.SetName(border, task.AutomationName);
        return border;
    }

    private Border BuildCelebration()
    {
        var sparkle = new FontIcon
        {
            Glyph = CelebrateGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Brush(SuccessBrushKey),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(sparkle, AccessibilityView.Raw);

        var message = new TextBlock
        {
            Text = _viewModel.CompleteMessage,
            FontSize = 14,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.Brush(SuccessBrushKey),
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var dismiss = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = _viewModel.DismissLabel,
            IconGlyph = RestartGlyph,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(dismiss, _viewModel.DismissLabel);
        dismiss.Click += OnDismissClick;

        var grid = new Grid { ColumnSpacing = 10, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(sparkle, 0);
        Grid.SetColumn(message, 1);
        Grid.SetColumn(dismiss, 2);
        grid.Children.Add(sparkle);
        grid.Children.Add(message);
        grid.Children.Add(dismiss);

        var border = new Border
        {
            CornerRadius = new CornerRadius(8),
            BorderThickness = new Thickness(1),
            BorderBrush = DisplayTokens.Brush(SuccessBrushKey),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(12),
            Child = grid,
        };
        AutomationProperties.SetName(border, _viewModel.CompleteMessage);
        LiveRegion.Configure(border);
        LiveRegion.Announce(border);
        return border;
    }

    private void OnRestartInvoked(object? sender, EventArgs e) => _viewModel.Restart();

    private void OnCtaClick(object sender, RoutedEventArgs e)
    {
        if (sender is not TsButton { DataContext: ChecklistTaskView task })
        {
            return;
        }

        if (task.IsCommandPalette)
        {
            CommandPaletteRequested?.Invoke(this, EventArgs.Empty);
        }
        else
        {
            NavigationRequested?.Invoke(this, task.CtaTarget);
        }
    }
}

/// <summary>
/// The <see cref="ApplicationData.LocalSettings"/>-backed <see cref="IChecklistStateStore"/> — the
/// concrete app store for the Setup Checklist's locally-tracked flags (the native analogue of the web
/// <c>localStorage</c> keys in web/src/features/onboarding/checklist.ts). The "theme picked" signal is
/// read live from <see cref="AppSettingsService"/> (a non-System theme counts, since the native app
/// has no separate accent palette), and the command-palette / web-push / dashboard-customized signals
/// plus the widget-owned dismiss / completion flags persist to the packaged app's local settings.
/// Every settings access is defensive: in an unpackaged or first-run context persistence is silently
/// skipped, mirroring the W8 settings store contract.
/// </summary>
public sealed class ApplicationDataChecklistStateStore : IChecklistStateStore
{
    private const string CommandPaletteKey = "teslasync.checklist.cpDiscovered";
    private const string WebPushKey = "teslasync.checklist.webPushGranted";
    private const string DashboardKey = "teslasync.checklist.customizeDashboard";
    private const string DismissedKey = "teslasync.checklist.dismissed";
    private const string CompletedAtKey = "teslasync.checklist.completedAt";

    private readonly AppSettingsService _settings;

    /// <summary>Creates the store over the live settings service (for the theme-picked signal).</summary>
    public ApplicationDataChecklistStateStore(AppSettingsService settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        _settings = settings;
        _settings.Changed += OnSettingsChanged;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    private static IPropertySet? Values
    {
        get
        {
            try
            {
                return ApplicationData.Current.LocalSettings.Values;
            }
            catch (Exception)
            {
                // Unpackaged / identity-less context — persistence is unavailable; treat flags as unset.
                return null;
            }
        }
    }

    /// <inheritdoc />
    public ChecklistLocalState Read()
    {
        var values = Values;
        return new ChecklistLocalState(
            ThemePicked: _settings.Current.Theme != AppThemePreference.System,
            CommandPaletteDiscovered: ReadBool(values, CommandPaletteKey),
            WebPushGranted: ReadBool(values, WebPushKey),
            DashboardCustomized: ReadBool(values, DashboardKey),
            Dismissed: ReadBool(values, DismissedKey),
            CompletedAt: ReadCompletedAt(values));
    }

    /// <inheritdoc />
    public void SetDismissed(bool dismissed)
    {
        WriteBool(DismissedKey, dismissed);
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <inheritdoc />
    public void SetCompletedAt(DateTimeOffset? completedAt)
    {
        var values = Values;
        if (values is not null)
        {
            try
            {
                if (completedAt is { } at)
                {
                    values[CompletedAtKey] = at.ToUnixTimeMilliseconds();
                }
                else
                {
                    values.Remove(CompletedAtKey);
                }
            }
            catch (Exception)
            {
                // Non-fatal: a transient settings-store failure must not crash the surface.
            }
        }

        Changed?.Invoke(this, EventArgs.Empty);
    }

    private void OnSettingsChanged(object? sender, AppSettings e) => Changed?.Invoke(this, EventArgs.Empty);

    private static bool ReadBool(IPropertySet? values, string key) =>
        values is not null && values.TryGetValue(key, out var value) && value is bool b && b;

    private static DateTimeOffset? ReadCompletedAt(IPropertySet? values)
    {
        if (values is not null && values.TryGetValue(CompletedAtKey, out var value) && value is long ms && ms > 0)
        {
            return DateTimeOffset.FromUnixTimeMilliseconds(ms);
        }

        return null;
    }

    private static void WriteBool(string key, bool value)
    {
        var values = Values;
        if (values is null)
        {
            return;
        }

        try
        {
            values[key] = value;
        }
        catch (Exception)
        {
            // Non-fatal: a transient settings-store failure must not crash the surface.
        }
    }
}
