using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Battery-Range feature surface — a parity port of
/// web/src/features/vehicles/components/vehicle-detail/BatteryRangeCharts.tsx. It reproduces the web's
/// responsive two-panel grid (<c>grid-cols-1 lg:grid-cols-2</c>), each panel a <see cref="TsGlassPanel"/>
/// entering through a <see cref="TsFadeIn"/>:
/// <list type="number">
/// <item>"Battery Overview": a Battery-accented header over a state-of-charge radial gauge (tinted by the web
/// <c>batteryColor</c> threshold), the Battery / Range count-up stat cards, and a Current/Remaining bar
/// chart (the recharts <c>BarChart</c>).</item>
/// <item>"Drive Distance Trend": a trend-accented header over the recent-drive distance + duration area chart
/// (the recharts <c>AreaChart</c> with a legend), or a friendly empty state when there are no drives (web
/// <c>driveChartData.length &gt; 0</c>).</item>
/// </list>
/// The web component is a pure child of the Vehicle-Detail page; the native feature-view owns its own
/// cache-then-network read and therefore renders every state the P2 contract mandates — a loading skeleton,
/// the populated panels, a friendly empty surface, an explicit retry surface on hard failure, plus stale and
/// offline freshness chips. All data flows through the shared <see cref="BatteryRangeChartsViewModel"/>; the
/// view never performs HTTP. Every string resolves through the i18n facade and every interactive element
/// carries a Narrator name.
/// </summary>
public sealed partial class BatteryRangeCharts : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C";  // Segoe Fluent — Refresh
    private const string BatteryGlyph = "\uE83F";  // Segoe Fluent — Battery (web lucide Battery)
    private const string RouteGlyph = "\uE9D2";    // Segoe Fluent — line/route trend (web lucide Route)

    private const double TwoColumnMinWidth = 640;  // web lg: breakpoint — two panels side by side above this
    private const double PanelPadding = 24;        // web p-6
    private const double PanelGap = 24;            // web gap-6
    private const double HeaderGlyphSize = 16;     // web h-4 w-4 lucide icon
    private const double GaugeDiameter = 100;      // web RadialGauge size={100}
    private const double BarChartHeight = 192;     // web h-48
    private const double AreaChartHeight = 256;    // web h-64
    private const double ChipFontSize = 12;
    private const double FadeInDelayMs = 150;
    private const int DistanceColorIndex = 0;      // web CHART_COLORS[0]
    private const int DurationColorIndex = 1;      // web CHART_COLORS[1]
    private const string AccentBrushKey = "TsChartSpeedBrush"; // web text-[var(--neon-cyan)] header accent

    private readonly BatteryRangeChartsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly BatteryRangeChartsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 12 };
    private readonly StackPanel _actions = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsBadge _freshnessChip = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _freshnessChipText = new() { FontSize = ChipFontSize };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _refresh = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = RefreshGlyph,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Border _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;
    private int _columns = 2;

    /// <summary>Creates the surface over its data source, localizer, (optional) diagnostics and units.</summary>
    /// <param name="source">The cache-then-network battery-range source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink; a private collector is used when null.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric when null.</param>
    public BatteryRangeCharts(
        IBatteryRangeChartsSource source,
        ILocalizer localizer,
        BatteryRangeChartsDiagnostics? diagnostics = null,
        UnitPref? units = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new BatteryRangeChartsDiagnostics();
        _viewModel = new BatteryRangeChartsViewModel(source, localizer, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _refresh.Click += OnRefreshClick;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
        Content = _root;
        Render();
    }

    /// <summary>The canonical surface id (<c>battery-range-charts</c>).</summary>
    public static string SurfaceId => BatteryRangeChartsRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public BatteryRangeChartsViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="BatteryRangeChartsSource"/> from the
    /// shared data layer (the host's P2-core dependencies), scoped to an explicit <paramref name="vehicleId"/>
    /// or — when null — the primary cached vehicle.
    /// </summary>
    public static BatteryRangeCharts Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long? vehicleId = null,
        BatteryRangeChartsDiagnostics? diagnostics = null,
        UnitPref? units = null)
    {
        var source = new BatteryRangeChartsSource(vehicles, api, engine, options, vehicleId);
        return new BatteryRangeCharts(source, localizer, diagnostics, units);
    }

    private void BuildChrome()
    {
        _freshnessChip.Content = _freshnessChipText;

        _actions.Children.Add(_freshnessChip);
        _actions.Children.Add(_freshness);
        _actions.Children.Add(_refresh);

        _root.Children.Add(_actions);
        _root.Children.Add(_bodyHost);
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

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        int desired = e.NewSize.Width >= TwoColumnMinWidth ? 2 : 1;
        if (desired != _columns)
        {
            _columns = desired;
            ScheduleRender();
        }
    }

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _refresh.Click -= OnRefreshClick;
        _viewModel.Dispose();
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
    }

    private void Render()
    {
        var display = _viewModel.Display;
        var state = _viewModel.State;

        AutomationProperties.SetName(this, display.BatteryOverviewTitle);

        UpdateFreshness(state);
        _bodyHost.Child = BuildBody(display, state);
    }

    private void UpdateFreshness(BatteryRangeChartsState state)
    {
        bool showActions = state is not (BatteryRangeChartsState.Loading or BatteryRangeChartsState.Error);
        _actions.Visibility = showActions ? Visibility.Visible : Visibility.Collapsed;
        if (!showActions)
        {
            return;
        }

        bool stale = state == BatteryRangeChartsState.Stale;
        bool offline = state == BatteryRangeChartsState.Offline;
        if (stale || offline)
        {
            _freshnessChip.Visibility = Visibility.Visible;
            _freshnessChip.Status = offline ? StatusKind.Danger : StatusKind.Warning;
            _freshnessChipText.Text = offline ? _viewModel.OfflineChip : _viewModel.StaleChip;
            AutomationProperties.SetName(_freshnessChip, _freshnessChipText.Text);
        }
        else
        {
            _freshnessChip.Visibility = Visibility.Collapsed;
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = offline;
        AutomationProperties.SetName(_refresh, _viewModel.RefreshLabel);
    }

    private UIElement BuildBody(BatteryRangeChartsDisplay display, BatteryRangeChartsState state) => state switch
    {
        BatteryRangeChartsState.Loading => BuildLoading(),
        BatteryRangeChartsState.Error => BuildError(),
        BatteryRangeChartsState.Empty => BuildEmpty(),
        _ => BuildPanels(display),
    };

    // ── Loading ──────────────────────────────────────────────────────────────────────────────────────────

    private Grid BuildLoading()
    {
        var grid = BuildResponsiveGrid(
            Fade(BuildLoadingPanel(BarChartHeight)),
            Fade(BuildLoadingPanel(AreaChartHeight)));

        AutomationProperties.SetName(grid, _viewModel.LoadingLabel);
        LiveRegion.Configure(grid);
        LiveRegion.Announce(grid);
        return grid;
    }

    private static TsGlassPanel BuildLoadingPanel(double bodyHeight)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(new TsSkeleton
        {
            BlockWidth = 180,
            BlockHeight = 18,
            ReduceMotion = MotionPreference.ReduceMotion,
        });
        column.Children.Add(new TsSkeleton
        {
            BlockHeight = bodyHeight,
            ReduceMotion = MotionPreference.ReduceMotion,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        });

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    // ── Error ────────────────────────────────────────────────────────────────────────────────────────────

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Title = _viewModel.ErrorTitle,
            Message = _viewModel.ErrorMessage ?? _viewModel.ErrorTitle,
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    // ── Empty (no vehicle / no usable live state) ────────────────────────────────────────────────────────

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = BatteryGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Loaded / Stale / Offline (both panels always render) ─────────────────────────────────────────────

    private Grid BuildPanels(BatteryRangeChartsDisplay display)
    {
        var battery = Fade(BuildBatteryPanel(display));
        var drive = Fade(BuildDrivePanel(display));
        return BuildResponsiveGrid(battery, drive);
    }

    private static TsGlassPanel BuildBatteryPanel(BatteryRangeChartsDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(BuildHeader(display.BatteryOverviewTitle, BatteryGlyph));
        column.Children.Add(BuildGaugeRow(display));
        column.Children.Add(BuildBatteryChart(display));

        var glass = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(glass, display.BatteryChartAutomationName);
        return glass;
    }

    private static Grid BuildGaugeRow(BatteryRangeChartsDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 16, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var gauge = new BatteryThresholdGauge(
            display.GaugeValue, display.GaugeMax, display.BatteryTier, display.GaugeLabel, display.GaugeUnit, GaugeDiameter)
        {
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(gauge, 0);

        var cards = new StackPanel { Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        cards.Children.Add(BuildStatCard(display.BatteryStatLabel, display.BatteryStatValue, 0, "%"));
        cards.Children.Add(BuildStatCard(
            display.RangeStatLabel, display.RangeDisplay, 0, $" {display.DistanceUnitLabel}"));
        Grid.SetColumn(cards, 1);

        grid.Children.Add(gauge);
        grid.Children.Add(cards);
        return grid;
    }

    private static TsGlassPanel BuildStatCard(string label, double value, int precision, string suffix)
    {
        var stack = new StackPanel { Spacing = 2 };
        stack.Children.Add(new Caption { Value = label });

        var number = new TsAnimatedNumber
        {
            Value = value,
            Precision = precision,
            Suffix = suffix,
            ReduceMotion = MotionPreference.ReduceMotion,
        };
        stack.Children.Add(number);

        var card = new TsGlassPanel { Padding = new Thickness(12), Content = stack };
        AutomationProperties.SetName(card, $"{label}: {ScalarFormatters.FormatNumber(value, precision)}{suffix}");
        return card;
    }

    private static TsBarChart BuildBatteryChart(BatteryRangeChartsDisplay display)
    {
        var points = new List<ChartPoint>(display.BatteryBars.Count);
        for (int i = 0; i < display.BatteryBars.Count; i++)
        {
            var bar = display.BatteryBars[i];
            points.Add(new ChartPoint(i, bar.Value, bar.Label));
        }

        // web: a single <Bar dataKey="value" fill={CHART_COLORS[0]} /> over the Current/Remaining categories.
        var series = new ChartSeries(display.GaugeLabel, points)
        {
            Kind = ChartSeriesKind.Bar,
            ColorIndex = DistanceColorIndex,
            Unit = "%",
            Decimals = 0,
        };

        var chart = new TsBarChart
        {
            Series = [series],
            ShowLegend = false, // web BarChart has no <Legend>
            ShowGrid = true,    // web <CartesianGrid>
            ShowAxes = true,    // web <XAxis>/<YAxis domain={[0,100]}>
            IncludeZero = true,
            Height = BarChartHeight,
            Title = display.BatteryOverviewTitle,
        };
        AutomationProperties.SetName(chart, display.BatteryChartAutomationName);
        return chart;
    }

    private static TsGlassPanel BuildDrivePanel(BatteryRangeChartsDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(BuildHeader(display.DriveTrendTitle, RouteGlyph));
        column.Children.Add(display.HasDriveData ? BuildDriveChart(display) : BuildDriveEmpty(display));

        var glass = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(glass, display.DriveChartAutomationName);
        return glass;
    }

    private static TsAreaChart BuildDriveChart(BatteryRangeChartsDisplay display)
    {
        var distancePoints = new List<ChartPoint>(display.DrivePoints.Count);
        var durationPoints = new List<ChartPoint>(display.DrivePoints.Count);
        for (int i = 0; i < display.DrivePoints.Count; i++)
        {
            var p = display.DrivePoints[i];
            distancePoints.Add(new ChartPoint(i, p.DistanceDisplay, p.DateLabel));
            durationPoints.Add(new ChartPoint(i, p.DurationMinutes, p.DateLabel));
        }

        // web: two <Area> series (distance CHART_COLORS[0], duration CHART_COLORS[1]) over a shared YAxis,
        // distinguished by a <Legend>.
        var distance = new ChartSeries(display.DistanceSeriesName, distancePoints)
        {
            Kind = ChartSeriesKind.Area,
            ColorIndex = DistanceColorIndex,
            Unit = display.DistanceUnitLabel,
            Decimals = 0,
        };
        var duration = new ChartSeries(display.DurationSeriesName, durationPoints)
        {
            Kind = ChartSeriesKind.Area,
            ColorIndex = DurationColorIndex,
            Unit = "min",
            Decimals = 0,
        };

        var chart = new TsAreaChart
        {
            Series = [distance, duration],
            ShowLegend = true, // web <Legend>
            ShowGrid = true,   // web <CartesianGrid>
            ShowAxes = true,   // web <XAxis>/<YAxis>
            IncludeZero = true,
            Height = AreaChartHeight,
            Title = display.DriveTrendTitle,
        };
        AutomationProperties.SetName(chart, display.DriveChartAutomationName);
        return chart;
    }

    private static TsEmptyState BuildDriveEmpty(BatteryRangeChartsDisplay display) => new()
    {
        IconGlyph = RouteGlyph,
        Message = display.NoDriveDataMessage,
        VerticalAlignment = VerticalAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Center,
    };

    // ── Shared chrome ────────────────────────────────────────────────────────────────────────────────────

    private static StackPanel BuildHeader(string title, string glyph)
    {
        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = HeaderGlyphSize,
            Foreground = DisplayTokens.Brush(AccentBrushKey),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw); // decorative; title carries meaning

        header.Children.Add(icon);
        header.Children.Add(new PanelTitle { Value = title, VerticalAlignment = VerticalAlignment.Center });
        return header;
    }

    private static TsFadeIn Fade(FrameworkElement child) => new()
    {
        DelayMs = (int)FadeInDelayMs,
        Content = child,
        HorizontalAlignment = HorizontalAlignment.Stretch,
        VerticalAlignment = VerticalAlignment.Top,
    };

    private Grid BuildResponsiveGrid(FrameworkElement first, FrameworkElement second)
    {
        var grid = new Grid { ColumnSpacing = PanelGap, RowSpacing = PanelGap };

        if (_columns >= 2)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            Grid.SetColumn(first, 0);
            Grid.SetColumn(second, 1);
        }
        else
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            Grid.SetRow(first, 0);
            Grid.SetRow(second, 1);
        }

        grid.Children.Add(first);
        grid.Children.Add(second);
        return grid;
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new BatteryRangeChartsAutomationPeer(this);

    private sealed class BatteryRangeChartsAutomationPeer(BatteryRangeCharts owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((BatteryRangeCharts)Owner).ViewModel.Title
                : name;
        }
    }

    /// <summary>
    /// The native state-of-charge gauge whose value arc is tinted by the web <c>batteryColor</c> threshold
    /// (green &gt; 60, amber &gt; 25, else red), mapped to the shared <see cref="StatusKind"/> chart brushes.
    /// Draws a tokenized background track and a value arc whose sweep is <c>value / max</c>, with the
    /// formatted value centred and a caption beneath — the native analogue of the web <c>RadialGauge</c>
    /// (<c>color={batteryColor(level)}</c>). The arc colour cannot be expressed by the shared
    /// <see cref="TsRadialGauge"/>'s palette/role API, so the threshold tint is drawn here from the same
    /// shared chart primitives the dashboard battery gauges use.
    /// </summary>
    private sealed partial class BatteryThresholdGauge : ContentControl
    {
        private const double StrokeWidth = 8;

        public BatteryThresholdGauge(
            double value, double max, StatusKind tier, string label, string unit, double diameter)
        {
            IsTabStop = false;

            var canvas = new Canvas { Width = diameter, Height = diameter };
            var radius = (diameter - StrokeWidth) / 2;
            var center = new PointD(diameter / 2, diameter / 2);

            canvas.Children.Add(ChartShapes.ArcPath(
                ChartGeometry.RingArc(center, radius, 0.9999), ChartBrushes.Border, StrokeWidth));

            double fraction = ChartGeometry.GaugeFraction(value, max);
            if (fraction > 0)
            {
                canvas.Children.Add(ChartShapes.ArcPath(
                    ChartGeometry.RingArc(center, radius, fraction), ChartBrushes.ForStatus(tier), StrokeWidth));
            }

            string valueText = $"{ScalarFormatters.FormatNumber(value, 0)}{unit}";
            var valueBlock = new TextBlock
            {
                Text = valueText,
                FontSize = 18,
                FontWeight = FontWeights.Bold,
                Foreground = DisplayTokens.TextPrimary,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
            };

            var ring = new Grid { Width = diameter, Height = diameter };
            ring.Children.Add(canvas);
            ring.Children.Add(valueBlock);

            var outer = new StackPanel { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Center };
            outer.Children.Add(ring);
            outer.Children.Add(new Caption { Value = label, HorizontalAlignment = HorizontalAlignment.Center });
            Content = outer;

            AutomationProperties.SetName(this, $"{label} {valueText}");
        }
    }
}
