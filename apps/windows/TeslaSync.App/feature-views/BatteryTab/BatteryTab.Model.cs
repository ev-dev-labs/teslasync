using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// One battery-health trend sample — the native mirror of a single element of the web
/// <c>FleetAnalytics.battery_trend</c> array
/// (<c>web/src/api/types.ts</c>: <c>{ date; health_score; capacity_wh; degradation_pct; range_km;
/// cycle_count }</c>). Values are SI on the wire: <see cref="CapacityWh"/> is watt-hours,
/// <see cref="RangeKm"/> is the backend's SI kilometres, <see cref="HealthScore"/> /
/// <see cref="DegradationPct"/> are percentages and <see cref="CycleCount"/> is a count. Pure data —
/// no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record BatteryTrendPoint(
    string Date,
    double HealthScore,
    double CapacityWh,
    double DegradationPct,
    double RangeKm,
    double CycleCount);

/// <summary>
/// The render-time data model the <c>BatteryTab</c> surface binds to — the native analogue of the web
/// component's only prop (<c>data: FleetAnalytics | undefined</c>, from which it reads
/// <c>battery_trend</c>). The web component is presentational: the parent analytics page owns the query
/// lifecycle, so this model carries only the parent's <see cref="Loading"/> flag and the resolved
/// <see cref="Trend"/> series. User-facing labels and the unit preference are supplied to the projection,
/// not stored here. Pure data — no WinUI types.
/// </summary>
public sealed record BatteryTabModel(bool Loading, IReadOnlyList<BatteryTrendPoint> Trend)
{
    /// <summary>The initial model: the parent's first fetch is in flight and no trend has arrived yet.</summary>
    public static BatteryTabModel Pending { get; } = new(true, Array.Empty<BatteryTrendPoint>());

    /// <summary>A resolved model with no trend rows — the empty state.</summary>
    public static BatteryTabModel Empty { get; } = new(false, Array.Empty<BatteryTrendPoint>());
}

/// <summary>
/// The mutually-exclusive render branch of the <c>BatteryTab</c> surface — the native union of the states
/// the web component renders (<c>features/analytics/components/analytics/BatteryTab.tsx</c>). The web
/// source is presentational (it takes the analytics <c>data</c> as a prop and performs no fetching), so the
/// branches are a direct function of the input <see cref="BatteryTabModel"/>: there is no fetch-driven
/// error / stale / offline branch to reproduce here — the parent analytics page owns the query lifecycle
/// (loading spinner, <c>QueryError</c> retry, stale/offline chrome) and only mounts this surface with the
/// resolved data. Every branch maps onto a visible surface; none is ever hidden.
/// </summary>
public enum BatteryTabState
{
    /// <summary>The parent fetch is in flight (web <c>data === undefined</c>) — skeleton chrome.</summary>
    Loading,

    /// <summary>Resolved with no trend rows (web <c>trend.length === 0</c>) — the friendly empty state.</summary>
    Empty,

    /// <summary>At least one trend row (web fall-through) — the metric cards + four chart panels.</summary>
    Ready,
}

/// <summary>
/// Which native cartesian control renders a <see cref="BatteryChartPanel"/> — the direct mapping of the web
/// recharts element the panel uses: <see cref="Area"/> ↔ <c>AreaChart</c>, <see cref="Line"/> ↔
/// <c>LineChart</c>, <see cref="Composed"/> ↔ <c>ComposedChart</c> (an area + a line on one surface).
/// </summary>
public enum BatteryChartKind
{
    /// <summary>Single soft-area series (web <c>AreaChart</c>).</summary>
    Area,

    /// <summary>Single line series (web <c>LineChart</c>).</summary>
    Line,

    /// <summary>Mixed area + line series on one surface (web <c>ComposedChart</c>).</summary>
    Composed,
}

/// <summary>
/// One projected, render-ready battery metric tile — the native analogue of a single web <c>MetricCard</c>
/// in the tab's hero grid. <see cref="Value"/> is the pre-formatted headline (the web <c>value</c>),
/// <see cref="Subtitle"/> is the muted unit caption beneath it (the web <c>subtitle</c>, e.g. "%" or the
/// distance unit), <see cref="AccentBrushKey"/> is the token brush key for the accent rail (mapped from the
/// web <c>color</c>), and <see cref="AutomationName"/> is the spoken "label: value unit" name. Pure data.
/// </summary>
public sealed record BatteryMetricCard(
    string Label,
    string Value,
    string Subtitle,
    string AccentBrushKey,
    string AutomationName);

/// <summary>
/// One projected, render-ready chart panel — the native analogue of one web <c>GlassPanel</c> wrapping a
/// <c>SectionTitle</c> and a recharts chart. <see cref="Title"/> is the localized section heading,
/// <see cref="Kind"/> selects the native chart control, <see cref="Series"/> is the WinUI-free data the
/// control plots (X is the ordinal sample index, matching recharts' categorical date axis),
/// <see cref="AccessibleSummary"/> is the spoken chart description, and <see cref="AutomationName"/> is the
/// panel region's Narrator name. Pure data so every panel is asserted headlessly.
/// </summary>
public sealed record BatteryChartPanel(
    string Title,
    BatteryChartKind Kind,
    IReadOnlyList<ChartSeries> Series,
    string AccessibleSummary,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the surface for one input model — the native analogue of what
/// the web <c>BatteryTab</c> returns. Holds the active <see cref="State"/>, the resolved surface / empty /
/// loading labels, the projected hero <see cref="Metrics"/> and the four chart <see cref="Charts"/>, plus
/// the root <see cref="AutomationName"/>. Pure data so every branch is asserted without a UI host.
/// </summary>
public sealed record BatteryTabDisplay(
    BatteryTabState State,
    string SurfaceName,
    string EmptyMessage,
    string LoadingLabel,
    IReadOnlyList<BatteryMetricCard> Metrics,
    IReadOnlyList<BatteryChartPanel> Charts,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="BatteryTabModel"/> (+ i18n facade + unit preference) to its
/// <see cref="BatteryTabDisplay"/> — the native port of
/// <c>features/analytics/components/analytics/BatteryTab.tsx</c>. The branch precedence mirrors the web
/// source exactly (loading → empty → ready); the hero metric values render through the shared SI display
/// boundary (<see cref="NumberFormatting"/> = the web <c>fmtNumber</c>/<c>fmtInt</c>,
/// <see cref="UnitFormatters.FormatEnergy"/> = the web <c>formatEnergy</c>, and
/// <see cref="UnitConverters.DistanceFromSi"/> = the web <c>convertDistanceFromSI</c>); and the four chart
/// series mirror the web <c>dataKey</c>s and <c>CHART_COLORS</c> indices. Every label resolves through the
/// i18n facade using the same keys the web source feeds into <c>t()</c>. No WinUI types — unit-tested
/// without a UI host.
/// </summary>
public static class BatteryTabProjection
{
    /// <summary>Token brush key for the Health Score accent rail (web <c>color="green"</c>).</summary>
    public const string AccentHealth = "TsColorSuccessBrush";

    /// <summary>Token brush key for the Capacity accent rail (web <c>color="cyan"</c>).</summary>
    public const string AccentCapacity = "TsColorAccentBrush";

    /// <summary>Token brush key for the Degradation accent rail (web <c>color="amber"</c>).</summary>
    public const string AccentDegradation = "TsColorWarningBrush";

    /// <summary>Token brush key for the Est. Range accent rail (web <c>color="purple"</c>).</summary>
    public const string AccentRange = "TsChartPowerBrush";

    /// <summary>Token brush key for the Cycles accent rail (web <c>color="cyan"</c>).</summary>
    public const string AccentCycles = "TsColorAccentBrush";

    /// <summary>Categorical palette index for the Health series (web <c>CHART_COLORS[1]</c>).</summary>
    public const int ColorHealth = 1;

    /// <summary>Categorical palette index for the Capacity series (web <c>CHART_COLORS[0]</c>).</summary>
    public const int ColorCapacity = 0;

    /// <summary>Categorical palette index for the Range series (web <c>CHART_COLORS[2]</c>).</summary>
    public const int ColorRange = 2;

    /// <summary>Categorical palette index for the Degradation series (web <c>CHART_COLORS[5]</c>).</summary>
    public const int ColorDegradation = 5;

    /// <summary>Categorical palette index for the Cycle Count series (web <c>CHART_COLORS[4]</c>).</summary>
    public const int ColorCycles = 4;

    private const string Percent = "%";
    private const double MetersPerKm = 1000.0;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade and units.</summary>
    /// <param name="model">The render-time data model (the web prop).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit preference applied at the display boundary (the web <c>useUnits</c>).</param>
    public static BatteryTabDisplay Project(BatteryTabModel model, ILocalizer localizer, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(units);

        string surfaceName = localizer.GetString("analytics.tabs.battery", "Battery");
        string emptyMessage = localizer.GetString("analytics.battery.noData", "No battery trend data available");
        string loadingLabel = localizer.GetString("common.loading", "Loading");

        BatteryTabState state = SelectState(model);
        bool ready = state == BatteryTabState.Ready;

        IReadOnlyList<BatteryMetricCard> metrics = ready
            ? BuildMetrics(model.Trend[^1], localizer, units)
            : Array.Empty<BatteryMetricCard>();
        IReadOnlyList<BatteryChartPanel> charts = ready
            ? BuildCharts(model.Trend, localizer, units)
            : Array.Empty<BatteryChartPanel>();

        string automationName = state switch
        {
            BatteryTabState.Loading => $"{surfaceName}. {loadingLabel}",
            BatteryTabState.Empty => $"{surfaceName}. {emptyMessage}",
            _ => surfaceName,
        };

        return new BatteryTabDisplay(
            State: state,
            SurfaceName: surfaceName,
            EmptyMessage: emptyMessage,
            LoadingLabel: loadingLabel,
            Metrics: metrics,
            Charts: charts,
            AutomationName: automationName);
    }

    /// <summary>Branch precedence from the web source: loading → empty → ready.</summary>
    private static BatteryTabState SelectState(BatteryTabModel model)
    {
        if (model.Loading)
        {
            return BatteryTabState.Loading;
        }

        // Web parity: `trend.length === 0` collapses an undefined/empty trend to the empty state.
        return model.Trend.Count == 0 ? BatteryTabState.Empty : BatteryTabState.Ready;
    }

    // The five hero tiles read from the LAST trend sample (web `latest = trend[trend.length - 1]`).
    private static IReadOnlyList<BatteryMetricCard> BuildMetrics(
        BatteryTrendPoint latest,
        ILocalizer localizer,
        UnitPref units)
    {
        string distanceLabel = UnitLabels.Label(units.Distance);

        // web: fmtNumber(safe(latest.health_score), 1)
        string health = NumberFormatting.Format(Safe(latest.HealthScore), units.Locale, 1);
        // web: formatEnergy(safe(latest.capacity_wh), { precision: 1 }) — useUnits forces kWh display
        // (DEFAULT_ENERGY_PREF='kWh') regardless of the metric/imperial system, so pin energy to kWh here.
        string capacity = UnitFormatters.FormatEnergy(Safe(latest.CapacityWh), units with { Energy = EnergyUnit.Kwh }, 1);
        // web: fmtNumber(safe(latest.degradation_pct), 2)
        string degradation = NumberFormatting.Format(Safe(latest.DegradationPct), units.Locale, 2);
        // web: fmtNumber(fromKm(safe(latest.range_km)), 0) where fromKm(km) = convertDistanceFromSI(km*1000, unit)
        double rangeDisplay = UnitConverters.DistanceFromSi(Safe(latest.RangeKm) * MetersPerKm, units.Distance);
        string range = NumberFormatting.Format(rangeDisplay, units.Locale, 0);
        // web: fmtInt(safe(latest.cycle_count))
        string cycles = NumberFormatting.Format(Safe(latest.CycleCount), units.Locale, 0);

        return
        [
            Metric(localizer.GetString("analytics.battery.healthScore", "Health Score"), health, Percent, AccentHealth),
            Metric(localizer.GetString("analytics.battery.capacity", "Capacity"), capacity, string.Empty, AccentCapacity),
            Metric(localizer.GetString("analytics.battery.degradation", "Degradation"), degradation, Percent, AccentDegradation),
            Metric(localizer.GetString("analytics.battery.estRange", "Est. Range"), range, distanceLabel, AccentRange),
            Metric(localizer.GetString("analytics.battery.cycles", "Cycles"), cycles, string.Empty, AccentCycles),
        ];
    }

    private static BatteryMetricCard Metric(string label, string value, string subtitle, string accentKey)
    {
        string automation = string.IsNullOrEmpty(subtitle)
            ? $"{label}: {value}"
            : $"{label}: {value} {subtitle}";
        return new BatteryMetricCard(label, value, subtitle, accentKey, automation);
    }

    private static IReadOnlyList<BatteryChartPanel> BuildCharts(
        IReadOnlyList<BatteryTrendPoint> trend,
        ILocalizer localizer,
        UnitPref units)
    {
        string distanceLabel = UnitLabels.Label(units.Distance);

        // Health Score Timeline — web AreaChart dataKey="health_score".
        var healthSeries = new ChartSeries(
            localizer.GetString("analytics.battery.health", "Health %"),
            Points(trend, static p => Safe(p.HealthScore)))
        {
            Kind = ChartSeriesKind.Area,
            ColorIndex = ColorHealth,
            Decimals = 1,
        };

        // Capacity Trend — web LineChart dataKey="capacity_wh" (plots raw SI watt-hours, unconverted).
        var capacitySeries = new ChartSeries(
            localizer.GetString("analytics.battery.capacity", "Capacity"),
            Points(trend, static p => Safe(p.CapacityWh)))
        {
            Kind = ChartSeriesKind.Line,
            ColorIndex = ColorCapacity,
            Decimals = 0,
        };

        // Range Trend — web LineChart dataKey="range" where range = fromKm(safe(d.range_km)).
        var rangeSeries = new ChartSeries(
            $"{localizer.GetString("analytics.battery.range", "Range")} ({distanceLabel})",
            Points(trend, p => UnitConverters.DistanceFromSi(Safe(p.RangeKm) * MetersPerKm, units.Distance)))
        {
            Kind = ChartSeriesKind.Line,
            ColorIndex = ColorRange,
            Decimals = 0,
            Unit = distanceLabel,
        };

        // Degradation & Cycles — web ComposedChart: Area degradation_pct (left axis) + Line cycle_count (right).
        var degradationSeries = new ChartSeries(
            localizer.GetString("analytics.battery.degradPct", "Degradation %"),
            Points(trend, static p => Safe(p.DegradationPct)))
        {
            Kind = ChartSeriesKind.Area,
            ColorIndex = ColorDegradation,
            Decimals = 2,
        };
        var cyclesSeries = new ChartSeries(
            localizer.GetString("analytics.battery.cycleCount", "Cycle Count"),
            Points(trend, static p => Safe(p.CycleCount)))
        {
            Kind = ChartSeriesKind.Line,
            ColorIndex = ColorCycles,
            Decimals = 0,
        };

        return
        [
            Panel(localizer.GetString("analytics.battery.healthTimeline", "Health Score Timeline"), BatteryChartKind.Area, [healthSeries]),
            Panel(localizer.GetString("analytics.battery.capacityTrend", "Capacity Trend"), BatteryChartKind.Line, [capacitySeries]),
            Panel(localizer.GetString("analytics.battery.rangeTrend", "Range Trend"), BatteryChartKind.Line, [rangeSeries]),
            Panel(localizer.GetString("analytics.battery.degradationCycles", "Degradation & Cycles"), BatteryChartKind.Composed, [degradationSeries, cyclesSeries]),
        ];
    }

    private static BatteryChartPanel Panel(string title, BatteryChartKind kind, IReadOnlyList<ChartSeries> series)
    {
        string summary = ChartAccessibility.Summarize(title, series);
        return new BatteryChartPanel(title, kind, series, summary, summary);
    }

    // X is the ordinal sample index (recharts spaces a categorical date axis evenly by index); the date is
    // carried on each point's label so tooltips / the accessible summary can surface it.
    private static List<ChartPoint> Points(
        IReadOnlyList<BatteryTrendPoint> trend,
        Func<BatteryTrendPoint, double> selector)
    {
        var points = new List<ChartPoint>(trend.Count);
        for (int i = 0; i < trend.Count; i++)
        {
            points.Add(new ChartPoint(i, selector(trend[i]), trend[i].Date));
        }

        return points;
    }

    // web `safe`: coerce a non-finite (null/NaN/Infinity) value to 0 before formatting.
    private static double Safe(double value) => double.IsFinite(value) ? value : 0.0;
}

/// <summary>
/// PII-safe diagnostics for the <c>BatteryTab</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a trend value, capacity, range or
/// cycle count — so a diagnostics line can never leak battery telemetry. Thread-safe.
/// </summary>
public sealed class BatteryTabDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public BatteryTabDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=BatteryTab</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={BatteryTabRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>BatteryTab</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/analytics/components/analytics/BatteryTab.tsx</c>.
/// </summary>
public static class BatteryTabRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "BatteryTab";
}
