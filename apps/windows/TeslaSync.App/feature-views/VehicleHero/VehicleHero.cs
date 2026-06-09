using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Layout;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Carries the in-app route a <see cref="VehicleHero"/> quick-action button requests navigation to, so the
/// host can route it (the native analogue of the web hero's <c>&lt;Link to=…&gt;</c>).
/// </summary>
/// <param name="route">The in-app route to navigate to (e.g. <c>/commands</c>).</param>
public sealed class VehicleHeroNavigationEventArgs(string route) : EventArgs
{
    /// <summary>The in-app route the host should navigate to.</summary>
    public string Route { get; } = route;
}

/// <summary>
/// The native WinUI 3 Vehicle Hero surface — a parity port of
/// web/src/features/dashboard/components/VehicleHero.tsx. It renders the web's always-visible header (vehicle
/// name + state badge + model/trim/VIN subtitle) and, when live state is present, the context-aware radial
/// gauges (battery, range, plus speed while driving and charge power while charging, then cabin/outside
/// temperatures), a "⚡ Charging" details panel, a context stat grid (the <c>buildStatCards</c> driving /
/// charging / idle variants plus the always-visible lock, Sentry, firmware and power tiles) and the four
/// quick-action buttons (Details, Commands, Live Map, Digital Twin). When the vehicle is asleep it renders the
/// web's wake panel (a skeleton, the "asleep" message and a Wake Up button); when no vehicle resolves it shows
/// a friendly empty surface. Every state renders — the loading skeleton, the retry surface on hard failure,
/// and stale / offline freshness chips over the content. All data flows through the shared
/// <see cref="VehicleHeroViewModel"/>; the view never performs HTTP. Every string resolves through the i18n
/// facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class VehicleHero : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const string CarGlyph = "\uE804";     // Segoe Fluent — Car (empty surface)
    private const string BoltGlyph = "\uE945";    // Segoe Fluent — LightningBolt (charging header)
    private const double GaugeDiameter = 72;
    private const double SectionSpacing = 16;

    private readonly VehicleHeroViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly VehicleHeroDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly StackPanel _header = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
        Padding = new Thickness(0, 0, 0, 8),
    };

    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly ContentControl _bodyHost = new()
    {
        HorizontalContentAlignment = HorizontalAlignment.Stretch,
        VerticalContentAlignment = VerticalAlignment.Stretch,
    };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, unit preference and (optional) diagnostics.</summary>
    /// <param name="source">The cache-then-network hero source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits().unitPrefs</c>); null = metric.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public VehicleHero(
        IVehicleHeroSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        VehicleHeroDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new VehicleHeroDiagnostics();
        _viewModel = new VehicleHeroViewModel(source, localizer, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>Raised when a quick-action button is invoked; the host navigates to <see cref="VehicleHeroNavigationEventArgs.Route"/>.</summary>
    public event EventHandler<VehicleHeroNavigationEventArgs>? NavigationRequested;

    /// <summary>The canonical surface id (<c>vehicle-hero</c>).</summary>
    public static string SurfaceId => VehicleHeroRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public VehicleHeroViewModel ViewModel => _viewModel;

    /// <summary>The display-unit preference; reassigning re-projects the current snapshot at the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="VehicleHeroSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    /// <param name="api">The generated contract API client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The API client options carrying the JSON serializer settings.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="units">The user's unit preference; null = metric.</param>
    /// <param name="vehicleId">An explicit vehicle id, or null for the primary roster vehicle.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <returns>A ready-to-host surface bound to the live data layer.</returns>
    public static VehicleHero Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        UnitPref? units = null,
        long? vehicleId = null,
        VehicleHeroDiagnostics? diagnostics = null)
    {
        var source = new VehicleHeroSource(api, engine, options, vehicleId);
        return new VehicleHero(source, localizer, units, diagnostics);
    }

    private void BuildChrome()
    {
        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        var scroll = new ScrollViewer
        {
            Content = _bodyHost,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };

        Grid.SetRow(_header, 0);
        Grid.SetRow(scroll, 1);
        _root.Children.Add(_header);
        _root.Children.Add(scroll);
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
    }

    private void Render()
    {
        var display = _viewModel.Display;
        AutomationProperties.SetName(this, display.AutomationName);

        switch (_viewModel.State)
        {
            case VehicleHeroState.Loading:
                Content = BuildLoading();
                break;

            case VehicleHeroState.Error:
                Content = BuildError();
                break;

            case VehicleHeroState.Empty:
                Content = BuildEmpty();
                break;

            default:
                UpdateHeader();
                _bodyHost.Content = BuildContent(display);
                Content = _root;
                break;
        }
    }

    // ── Header (stale/offline chip + freshness + refresh) ────────────────────────────────────────────

    private void UpdateHeader()
    {
        _header.Children.Clear();

        if (_viewModel.State is VehicleHeroState.Stale or VehicleHeroState.Offline)
        {
            _header.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.State == VehicleHeroState.Offline;
        _header.Children.Add(_freshness);
        _header.Children.Add(BuildRefreshButton());
    }

    private TsBadge BuildFreshnessChip(VehicleHeroState state)
    {
        bool offline = state == VehicleHeroState.Offline;
        string text = offline
            ? _localizer.GetString("common.offline", "Offline")
            : _localizer.GetString("common.stale", "Stale");

        var badge = new TsBadge
        {
            Status = offline ? StatusKind.Danger : StatusKind.Warning,
            Content = new TextBlock { Text = text, FontSize = 12 },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    private TsButton BuildRefreshButton()
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = RefreshGlyph,
            VerticalAlignment = VerticalAlignment.Center,
            IsEnabled = !_viewModel.IsFetching,
        };
        AutomationProperties.SetName(button, _localizer.GetString("common.refresh", "Refresh"));
        button.Click += OnRefreshClick;
        return button;
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    // ── Content (header block + awake / asleep body) ─────────────────────────────────────────────────

    private StackPanel BuildContent(VehicleHeroDisplay display)
    {
        var column = new StackPanel { Spacing = SectionSpacing };
        column.Children.Add(BuildHeaderBlock(display));
        column.Children.Add(display.IsAwake ? BuildAwake(display) : BuildAsleep(display));
        AutomationProperties.SetName(column, display.AutomationName);
        return column;
    }

    private static StackPanel BuildHeaderBlock(VehicleHeroDisplay display)
    {
        var column = new StackPanel { Spacing = 2 };

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 10,
            VerticalAlignment = VerticalAlignment.Center,
        };
        titleRow.Children.Add(new TextBlock
        {
            Text = display.Name,
            FontSize = 22,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        });
        titleRow.Children.Add(new TsStatusBadge
        {
            Status = display.Status,
            AccentBrushKey = display.StatusAccentKey,
            VerticalAlignment = VerticalAlignment.Center,
        });
        column.Children.Add(titleRow);

        if (!string.IsNullOrWhiteSpace(display.Subtitle))
        {
            column.Children.Add(new Caption
            {
                Value = display.Subtitle,
                HorizontalAlignment = HorizontalAlignment.Left,
            });
        }

        return column;
    }

    private StackPanel BuildAwake(VehicleHeroDisplay display)
    {
        var column = new StackPanel { Spacing = SectionSpacing };
        column.Children.Add(BuildGauges(display));

        if (display.IsCharging && display.Charging is { } charging)
        {
            column.Children.Add(BuildChargingPanel(charging));
        }

        column.Children.Add(BuildStats(display));
        column.Children.Add(BuildActions(display));
        return column;
    }

    private static TsGrid BuildGauges(VehicleHeroDisplay display)
    {
        var grid = new TsGrid { Columns = 6, Gutter = 12, ItemMinWidth = 96 };
        foreach (var gauge in display.Gauges)
        {
            var control = new TsRadialGauge
            {
                Value = gauge.Value,
                Max = gauge.Max,
                Label = gauge.Label,
                Unit = gauge.Unit,
                Decimals = 0,
                Diameter = GaugeDiameter,
                Role = GaugeRole(gauge.Accent),
            };
            AutomationProperties.SetName(control, gauge.AutomationName);
            grid.Children.Add(control);
        }

        return grid;
    }

    private static Border BuildChargingPanel(VehicleHeroCharging charging)
    {
        var success = DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Success));
        var tint = success is SolidColorBrush scb ? scb.Color : Microsoft.UI.Colors.LimeGreen;

        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var bolt = new FontIcon
        {
            Glyph = BoltGlyph,
            FontSize = 14,
            Foreground = success,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(bolt, AccessibilityView.Raw);
        if (!MotionPreference.ReduceMotion)
        {
            PulseHelper.Attach(bolt);
        }

        header.Children.Add(bolt);
        header.Children.Add(new TextBlock
        {
            Text = charging.Header,
            FontSize = 13,
            FontWeight = FontWeights.Medium,
            Foreground = success,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var metrics = new TsGrid { Columns = 3, Gutter = 12, ItemMinWidth = 96 };
        metrics.Children.Add(ChargingMetric(charging.PowerLabel, charging.PowerText, null));
        metrics.Children.Add(ChargingMetric(charging.RateLabel, charging.RateText, null));
        metrics.Children.Add(ChargingMetric(charging.TimeToFullLabel, charging.TimeToFullText, charging.DoneAtText));

        var stack = new StackPanel { Spacing = 8 };
        stack.Children.Add(header);
        stack.Children.Add(metrics);

        var panel = new Border
        {
            Background = new SolidColorBrush(tint) { Opacity = 0.08 },
            BorderBrush = new SolidColorBrush(tint) { Opacity = 0.20 },
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(12),
            Padding = new Thickness(12),
            Child = stack,
        };
        AutomationProperties.SetName(panel, charging.AutomationName);
        return panel;
    }

    private static StackPanel ChargingMetric(string label, string value, string? sub)
    {
        var column = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Center };
        column.Children.Add(new MetricLabel { Value = label, HorizontalAlignment = HorizontalAlignment.Center });
        column.Children.Add(new TextBlock
        {
            Text = value,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });

        if (!string.IsNullOrEmpty(sub))
        {
            column.Children.Add(new Caption { Value = sub, HorizontalAlignment = HorizontalAlignment.Center });
        }

        AutomationProperties.SetName(column, $"{label}: {value}");
        return column;
    }

    private static TsGrid BuildStats(VehicleHeroDisplay display)
    {
        var grid = new TsGrid { Columns = 4, Gutter = 12, ItemMinWidth = 140 };
        foreach (var stat in display.Stats)
        {
            grid.Children.Add(BuildStatTile(stat));
        }

        return grid;
    }

    private static Border BuildStatTile(VehicleHeroStat stat)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };

        var icon = new FontIcon
        {
            Glyph = stat.Glyph,
            FontSize = 16,
            Foreground = AccentBrush(stat.Accent),
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 2, 0, 0),
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        row.Children.Add(icon);

        var text = new StackPanel { Spacing = 1 };
        text.Children.Add(new MetricLabel { Value = stat.Label });
        text.Children.Add(new TextBlock
        {
            Text = stat.Value,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        row.Children.Add(text);

        var tile = new Border
        {
            Child = row,
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(10),
        };
        AutomationProperties.SetName(tile, stat.AutomationName);
        return tile;
    }

    private StackPanel BuildActions(VehicleHeroDisplay display)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        foreach (var action in display.Actions)
        {
            row.Children.Add(BuildActionButton(action, ButtonVariant.Secondary));
        }

        return row;
    }

    private TsButton BuildActionButton(VehicleHeroAction action, ButtonVariant variant)
    {
        var button = new TsButton
        {
            Variant = variant,
            Size = ControlSize.Small,
            Text = action.Label,
            IconGlyph = string.IsNullOrEmpty(action.Glyph) ? null : action.Glyph,
            Tag = action.Route,
        };
        AutomationProperties.SetName(button, action.AutomationName);
        button.Click += OnActionClick;
        return button;
    }

    private void OnActionClick(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { Tag: string route } && !string.IsNullOrEmpty(route))
        {
            NavigationRequested?.Invoke(this, new VehicleHeroNavigationEventArgs(route));
        }
    }

    private TsGlassPanel BuildAsleep(VehicleHeroDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var skeleton = new TsSkeleton
        {
            BlockWidth = 160,
            BlockHeight = 24,
            Radius = 8,
            ReduceMotion = MotionPreference.ReduceMotion,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(skeleton, AccessibilityView.Raw);
        column.Children.Add(skeleton);

        column.Children.Add(new Text
        {
            Value = display.AsleepMessage,
            HorizontalContentAlignment = HorizontalAlignment.Center,
        });

        column.Children.Add(BuildActionButton(display.WakeAction, ButtonVariant.Primary));

        var panel = new TsGlassPanel { Padding = new Thickness(20), Content = column };
        AutomationProperties.SetName(panel, display.AsleepMessage);
        return panel;
    }

    // ── State bodies ─────────────────────────────────────────────────────────────────────────────────

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(4) };
        column.Children.Add(new TsSkeleton { BlockWidth = 220, BlockHeight = 26, Radius = 8, ReduceMotion = MotionPreference.ReduceMotion });
        column.Children.Add(new TsSkeleton { BlockWidth = 320, BlockHeight = 14, Radius = 6, ReduceMotion = MotionPreference.ReduceMotion });

        var gauges = new TsGrid { Columns = 6, Gutter = 12, ItemMinWidth = 96, Margin = new Thickness(0, 8, 0, 0) };
        for (int i = 0; i < 4; i++)
        {
            gauges.Children.Add(new TsSkeleton { BlockWidth = 72, BlockHeight = 72, Radius = 36, ReduceMotion = MotionPreference.ReduceMotion });
        }

        column.Children.Add(gauges);

        AutomationProperties.SetName(column, _localizer.GetString("hero.loading", "Loading vehicle"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("hero.error", "Couldn't load this vehicle"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = CarGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Accent mapping (categorical accent → themed token, never web hex) ────────────────────────────

    private static ChartRole GaugeRole(VehicleHeroAccent accent) => accent switch
    {
        VehicleHeroAccent.Green => ChartRole.Battery,
        VehicleHeroAccent.Amber => ChartRole.Energy,
        VehicleHeroAccent.Cyan => ChartRole.Speed,
        VehicleHeroAccent.Purple => ChartRole.Power,
        VehicleHeroAccent.Orange => ChartRole.Temperature,
        VehicleHeroAccent.Blue => ChartRole.Regen,
        _ => ChartRole.None,
    };

    private static Brush AccentBrush(VehicleHeroAccent accent) => DisplayTokens.Brush(accent switch
    {
        VehicleHeroAccent.Cyan => "TsChartSpeedBrush",
        VehicleHeroAccent.Purple => "TsChartPowerBrush",
        VehicleHeroAccent.Green => "TsChartBatteryBrush",
        VehicleHeroAccent.Amber => "TsChartEnergyBrush",
        VehicleHeroAccent.Orange => "TsChartTemperatureBrush",
        VehicleHeroAccent.Blue => "TsChartRegenBrush",
        VehicleHeroAccent.Red => "TsColorDangerBrush",
        VehicleHeroAccent.Indigo => "TsColorInfoBrush",
        _ => "TsColorTextMutedBrush",
    });

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new VehicleHeroAutomationPeer(this);

    private sealed class VehicleHeroAutomationPeer(VehicleHero owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((VehicleHero)Owner).ViewModel.Display.AutomationName
                : name;
        }
    }
}
