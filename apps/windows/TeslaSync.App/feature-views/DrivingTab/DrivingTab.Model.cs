using System.Globalization;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The parent-owned load phase the <c>DrivingTab</c> surface is told to render — the native analogue of the
/// query lifecycle the web <c>AnalyticsPage</c> owns and hands the presentational
/// <c>web/src/features/analytics/components/analytics/DrivingTab.tsx</c> through its <c>data</c> prop. The
/// web component itself performs no fetching (its only hooks are <c>useTranslation</c> and <c>useUnits</c>),
/// so the surface's state is a pure function of this phase plus the supplied payload — every branch maps
/// onto a visible surface, none is ever hidden.
/// </summary>
public enum DriveLoadPhase
{
    /// <summary>Initial fetch in flight with no payload yet — render the skeleton chrome.</summary>
    Loading,

    /// <summary>Resolved (fresh) — render the section scaffold (empty per-section when the payload is absent).</summary>
    Ready,

    /// <summary>The fetch failed with nothing cached — render the retry affordance.</summary>
    Error,

    /// <summary>A cached payload older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached payload remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The mutually-exclusive surface state the <c>DrivingTab</c> renders. <see cref="Loading"/> /
/// <see cref="Error"/> replace the body; <see cref="Stale"/> / <see cref="Offline"/> wrap the section
/// scaffold with a freshness chip; <see cref="Empty"/> and <see cref="Ready"/> both render the full section
/// scaffold (each of the seven charts and the two metric grids self-empties when its slice is missing — the
/// web parity for <c>data === undefined</c>), differing only in whether any drive analytics were supplied.
/// </summary>
public enum DrivingTabState
{
    /// <summary>Initial fetch — skeleton chrome.</summary>
    Loading,

    /// <summary>Resolved with no drive analytics — the section scaffold with every section empty.</summary>
    Empty,

    /// <summary>The fetch failed and nothing is cached — the retry affordance.</summary>
    Error,

    /// <summary>A cached payload past the freshness window — content plus a stale chip.</summary>
    Stale,

    /// <summary>Offline with a cached payload — content plus an offline chip.</summary>
    Offline,

    /// <summary>Drive analytics present — the populated section scaffold.</summary>
    Ready,
}

/// <summary>Which freshness chip (if any) the surface overlays on its content.</summary>
public enum DriveStatusChip
{
    /// <summary>No chip — fresh content.</summary>
    None,

    /// <summary>The shown payload is past the freshness window.</summary>
    Stale,

    /// <summary>The network is unavailable; the shown payload is the last cached one.</summary>
    Offline,
}

/// <summary>
/// One labelled distribution bucket — the native mirror of a web
/// <c>{ range: string; count: number }</c> datum used by <c>speed_distribution</c>,
/// <c>distance_distribution</c> and <c>duration_distribution</c>. Pure data — no WinUI types.
/// </summary>
public sealed record DriveBucket(string Range, double Count);

/// <summary>
/// One hour of the daily driving rhythm — the native mirror of a web
/// <c>{ hour: number; drives: number; distance: number }</c> datum (<c>hourly_pattern</c>). Distance is the
/// backend's raw value (kilometres); the web overlay line renders it unconverted, and so does this port.
/// </summary>
public sealed record DriveHourPoint(double Hour, double Drives, double Distance);

/// <summary>
/// One temperature/efficiency sample — the native mirror of a web
/// <c>{ temp: number; efficiency: number; distance: number }</c> datum (<c>temp_vs_efficiency</c>). The
/// backend delivers <c>temp</c> in °C, <c>efficiency</c> in Wh/km and <c>distance</c> in km; the temperature
/// and efficiency are converted to the user's display units at projection time (mirroring the web boundary).
/// </summary>
public sealed record DriveTempEffPoint(double Temp, double Efficiency, double Distance);

/// <summary>
/// One day of the driving trend — the native mirror of a web
/// <c>{ date: string; drives: number; distance: number; efficiency?: number }</c> datum
/// (<c>daily_trend</c>). Distance is the backend's raw kilometres (rendered unconverted, web parity);
/// efficiency is Wh/km and drives the efficiency-trend filter (<c>efficiency &gt; 0</c>).
/// </summary>
public sealed record DriveDailyPoint(string Date, double Distance, double Drives, double Efficiency);

/// <summary>
/// The min / avg / max slice of the web <c>StatsSummary</c> the driving cards read. The remaining
/// <c>median</c> / <c>p95</c> / <c>count</c> fields the web shape carries are not surfaced by
/// <c>DrivingPerformanceCards</c> or <c>DrivingTemperatureStats</c>, so they are intentionally omitted.
/// </summary>
public sealed record DriveStat(double Min, double Avg, double Max);

/// <summary>
/// The inside / outside cabin temperature stats — the native mirror of the web
/// <c>temperature: { inside: StatsSummary; outside: StatsSummary }</c> shape. Either side may be absent
/// (its cards then render the em-dash, web parity).
/// </summary>
public sealed record DriveTemperature(DriveStat? Inside, DriveStat? Outside);

/// <summary>
/// The driving analytics payload — the native mirror of the web <c>FleetAnalytics.drive_analytics</c> shape
/// (<c>web/src/api/types.ts</c>) restricted to the fields <c>DrivingTab.tsx</c> and its two children read.
/// Every list is non-null (empty is valid and renders that section's empty state); every stat is optional.
/// Pure data so the projection is unit-tested headlessly.
/// </summary>
public sealed record DriveAnalytics(
    IReadOnlyList<DriveBucket> SpeedDistribution,
    IReadOnlyList<DriveBucket> DistanceDistribution,
    IReadOnlyList<DriveBucket> DurationDistribution,
    IReadOnlyList<DriveHourPoint> HourlyPattern,
    IReadOnlyList<DriveTempEffPoint> TempVsEfficiency,
    IReadOnlyList<DriveDailyPoint> DailyTrend,
    DriveStat? SpeedStats,
    DriveStat? PowerStats,
    DriveStat? RegenStats,
    DriveStat? DistanceStats,
    DriveTemperature? Temperature)
{
    /// <summary>The all-empty payload — the parse fallback for an absent <c>drive_analytics</c> body.</summary>
    public static DriveAnalytics Empty { get; } = new(
        Array.Empty<DriveBucket>(),
        Array.Empty<DriveBucket>(),
        Array.Empty<DriveBucket>(),
        Array.Empty<DriveHourPoint>(),
        Array.Empty<DriveTempEffPoint>(),
        Array.Empty<DriveDailyPoint>(),
        null,
        null,
        null,
        null,
        null);
}

/// <summary>
/// The render-time model the <c>DrivingTab</c> view binds to — the parent-owned <see cref="Phase"/> plus the
/// optional <see cref="Analytics"/> payload (the web <c>data?.drive_analytics</c>). The component is
/// presentational: the parent supplies both. User-facing labels and unit conversions are resolved by the
/// projection, not passed in. Pure data — no WinUI types.
/// </summary>
public sealed record DrivingTabModel(DriveLoadPhase Phase, DriveAnalytics? Analytics)
{
    /// <summary>The initial model: the first fetch is in flight and no payload has arrived.</summary>
    public static DrivingTabModel Pending { get; } = new(DriveLoadPhase.Loading, null);

    /// <summary>A resolved model with no drive analytics — the empty section scaffold.</summary>
    public static DrivingTabModel Empty { get; } = new(DriveLoadPhase.Ready, null);

    /// <summary>A resolved, populated model.</summary>
    public static DrivingTabModel Ready(DriveAnalytics analytics) => new(DriveLoadPhase.Ready, analytics);
}

/// <summary>
/// One projected metric tile — the native analogue of a web <c>MetricCard</c> (label + pre-formatted value
/// + unit + accent). Used by both the top performance grid and the temperature-stats grid. Pure data.
/// </summary>
public sealed record DriveMetricCard(
    string Label,
    string Value,
    string Unit,
    string AccentBrushKey,
    string AutomationName);

/// <summary>
/// One projected chart section — a titled <c>GlassPanel</c> that renders either its native chart (the
/// projected <see cref="Series"/>) or its localized empty state. Mirrors one
/// <c>&lt;GlassPanel&gt;&lt;SectionTitle/&gt;{chart | EmptyState}&lt;/GlassPanel&gt;</c> block of the web
/// source. Pure data so each branch is asserted headlessly.
/// </summary>
public sealed record DriveChartSection(
    string Key,
    string Title,
    bool HasData,
    string EmptyMessage,
    IReadOnlyList<ChartSeries> Series,
    string AccessibleSummary,
    string AutomationName);

/// <summary>
/// One projected metric grid — a titled group of <see cref="DriveMetricCard"/>s with a localized empty
/// fallback. The performance grid is title-less and always populated (its cards em-dash when a stat is
/// absent); the temperature grid carries the "Temperature Stats" title and falls back to its empty state
/// when neither cabin side reported.
/// </summary>
public sealed record DriveMetricSection(
    string Key,
    string Title,
    bool HasData,
    string EmptyMessage,
    IReadOnlyList<DriveMetricCard> Cards,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the <c>DrivingTab</c> for one model — the native analogue of
/// what the web component returns. Holds the active <see cref="State"/>, the state-chrome labels, the
/// freshness chip, the top performance grid, the seven chart sections and the temperature-stats grid. Pure
/// data so every branch is asserted without a UI host.
/// </summary>
public sealed record DrivingTabDisplay(
    DrivingTabState State,
    string Title,
    string LoadingLabel,
    string ErrorMessage,
    string RetryLabel,
    DriveStatusChip StatusChip,
    string StatusChipLabel,
    DriveMetricSection PerformanceCards,
    IReadOnlyList<DriveChartSection> Charts,
    DriveMetricSection TemperatureStats,
    string AutomationName)
{
    /// <summary>True when the surface renders its section scaffold (empty / ready / stale / offline).</summary>
    public bool HasContent =>
        State is DrivingTabState.Empty or DrivingTabState.Ready or DrivingTabState.Stale or DrivingTabState.Offline;
}

/// <summary>
/// Pure projection from a <see cref="DrivingTabModel"/> (+ the active units and i18n facade) to its
/// <see cref="DrivingTabDisplay"/> — the native port of
/// <c>web/src/features/analytics/components/analytics/DrivingTab.tsx</c> together with its
/// <c>DrivingPerformanceCards</c> and <c>DrivingTemperatureStats</c> children. All unit conversion happens
/// here at the display boundary (SI/derived-SI in, user units out — exactly where the web does it via
/// <c>useUnits</c> + <c>convert*FromSI</c>); every label resolves through the i18n facade using the same
/// keys the web source passes to <c>t()</c>. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class DrivingTabProjection
{
    private const string EmDash = "\u2014";
    private const double MetersPerKm = 1000.0;
    private const double SecondsPerHour = 3600.0;

    // 1 mile = 1.609344 km exactly — the web `KM_PER_MILE` used to rescale Wh/km efficiency into Wh/mi.
    private const double KmPerMile = 1.609344;

    // Web CHART_COLORS indices reproduced 1:1 (the native categorical palette is the same Okabe-Ito set).
    private const int ColorTrips = 0;
    private const int ColorScatter = 1;
    private const int ColorDistDist = 2;
    private const int ColorOverlayLine = 3;
    private const int ColorDuration = 4;

    // Web MetricCard `color` → the matching brand token brush (TsChartPowerBrush is the exact #A855F7 purple).
    private const string AccentCyan = "TsChartRegenBrush";
    private const string AccentPurple = "TsChartPowerBrush";
    private const string AccentAmber = "TsChartEnergyBrush";
    private const string AccentGreen = "TsChartBatteryBrush";

    private const string PowerUnitLabel = "kW";

    /// <summary>Stable section keys (used for diffing / test addressing / Narrator grouping).</summary>
    public static class Sections
    {
        /// <summary>The top performance metric grid.</summary>
        public const string Performance = "performance";

        /// <summary>The speed-distribution bar section.</summary>
        public const string SpeedDistribution = "speedDist";

        /// <summary>The trip-distance-distribution bar section.</summary>
        public const string DistanceDistribution = "distDist";

        /// <summary>The hourly-pattern composed section.</summary>
        public const string HourlyPattern = "hourly";

        /// <summary>The temperature-vs-efficiency scatter section.</summary>
        public const string TempVsEfficiency = "tempEff";

        /// <summary>The daily-trend composed section.</summary>
        public const string DailyTrend = "dailyTrend";

        /// <summary>The drive-duration-distribution bar section.</summary>
        public const string DurationDistribution = "durationDist";

        /// <summary>The efficiency-trend area section.</summary>
        public const string EfficiencyTrend = "effTrend";

        /// <summary>The temperature-stats metric grid.</summary>
        public const string TemperatureStats = "tempStats";
    }

    /// <summary>Project <paramref name="model"/> into a render-ready display in the supplied units.</summary>
    /// <param name="model">The render-time model (the web props).</param>
    /// <param name="units">The user's unit preference (the web <c>useUnits().unitPrefs</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through (the web <c>t()</c>).</param>
    public static DrivingTabDisplay Project(DrivingTabModel model, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        DriveAnalytics da = model.Analytics ?? DriveAnalytics.Empty;

        string title = localizer.GetString("analytics.tabs.driving", "Driving");
        DriveMetricSection cards = BuildPerformanceCards(da, units, localizer);
        List<DriveChartSection> charts = BuildCharts(da, units, localizer);
        DriveMetricSection tempStats = BuildTemperatureStats(da, units, localizer);

        DrivingTabState state = SelectState(model);
        DriveStatusChip chip = state switch
        {
            DrivingTabState.Stale => DriveStatusChip.Stale,
            DrivingTabState.Offline => DriveStatusChip.Offline,
            _ => DriveStatusChip.None,
        };

        string chipLabel = chip switch
        {
            DriveStatusChip.Stale => localizer.GetString("mqtt.stale", "Stale"),
            DriveStatusChip.Offline => localizer.GetString("common.offline", "Offline"),
            _ => string.Empty,
        };

        string loadingLabel = localizer.GetString("common.loading", "Loading...");
        string errorMessage = localizer.GetString("error.loadFailed", "Failed to load data");
        string retryLabel = localizer.GetString("error.retry", "Retry");

        return new DrivingTabDisplay(
            State: state,
            Title: title,
            LoadingLabel: loadingLabel,
            ErrorMessage: errorMessage,
            RetryLabel: retryLabel,
            StatusChip: chip,
            StatusChipLabel: chipLabel,
            PerformanceCards: cards,
            Charts: charts,
            TemperatureStats: tempStats,
            AutomationName: BuildAutomationName(state, title, loadingLabel, errorMessage, chipLabel));
    }

    private static DrivingTabState SelectState(DrivingTabModel model) => model.Phase switch
    {
        DriveLoadPhase.Loading => DrivingTabState.Loading,
        DriveLoadPhase.Error => DrivingTabState.Error,
        DriveLoadPhase.Stale => DrivingTabState.Stale,
        DriveLoadPhase.Offline => DrivingTabState.Offline,
        _ => model.Analytics is null ? DrivingTabState.Empty : DrivingTabState.Ready,
    };

    // ── Performance grid (web DrivingPerformanceCards) ───────────────────────────────────────────────
    private static DriveMetricSection BuildPerformanceCards(
        DriveAnalytics da,
        UnitPref units,
        ILocalizer localizer)
    {
        string speedUnit = UnitLabels.Label(units.Speed);
        string distanceUnit = UnitLabels.Label(units.Distance);

        var cards = new List<DriveMetricCard>(6)
        {
            // backend speed_stats is km/h; the SI floor is m/s, so convert km/h → m/s → display speed.
            Card(localizer.GetString("analytics.driving.topSpeed", "Top Speed"),
                StatValue(da.SpeedStats, s => SpeedFromKmh(s.Max, units), 0), speedUnit, AccentCyan),
            Card(localizer.GetString("analytics.driving.avgSpeed", "Avg Speed"),
                StatValue(da.SpeedStats, s => SpeedFromKmh(s.Avg, units), 0), speedUnit, AccentPurple),
            Card(localizer.GetString("analytics.driving.peakPower", "Peak Power"),
                StatValue(da.PowerStats, s => Safe(s.Max), 0), PowerUnitLabel, AccentAmber),
            Card(localizer.GetString("analytics.driving.peakRegen", "Peak Regen"),
                StatValue(da.RegenStats, s => Safe(s.Max), 0), PowerUnitLabel, AccentGreen),

            // backend distance_stats is km; the SI floor is metres, so convert km → m → display distance.
            Card(localizer.GetString("analytics.driving.avgDriveDist", "Avg Drive Distance"),
                StatValue(da.DistanceStats, s => DistanceFromKm(s.Avg, units), 1), distanceUnit, AccentCyan),
            Card(localizer.GetString("analytics.driving.longestDrive", "Longest Drive"),
                StatValue(da.DistanceStats, s => DistanceFromKm(s.Max, units), 1), distanceUnit, AccentPurple),
        };

        return new DriveMetricSection(
            Key: Sections.Performance,
            Title: string.Empty,
            HasData: true,
            EmptyMessage: string.Empty,
            Cards: cards,
            AutomationName: localizer.GetString("analytics.tabs.driving", "Driving"));
    }

    // ── Temperature-stats grid (web DrivingTemperatureStats) ─────────────────────────────────────────
    private static DriveMetricSection BuildTemperatureStats(
        DriveAnalytics da,
        UnitPref units,
        ILocalizer localizer)
    {
        string tempUnit = UnitLabels.Label(units.Temperature);
        DriveStat? inside = da.Temperature?.Inside;
        DriveStat? outside = da.Temperature?.Outside;
        bool hasData = inside is not null || outside is not null;

        var cards = new List<DriveMetricCard>(6)
        {
            Card(localizer.GetString("analytics.driving.insideMin", "Inside Min"),
                StatValue(inside, s => TempFromCelsius(s.Min, units), 1), tempUnit, AccentCyan),
            Card(localizer.GetString("analytics.driving.insideAvg", "Inside Avg"),
                StatValue(inside, s => TempFromCelsius(s.Avg, units), 1), tempUnit, AccentGreen),
            Card(localizer.GetString("analytics.driving.insideMax", "Inside Max"),
                StatValue(inside, s => TempFromCelsius(s.Max, units), 1), tempUnit, AccentAmber),
            Card(localizer.GetString("analytics.driving.outsideMin", "Outside Min"),
                StatValue(outside, s => TempFromCelsius(s.Min, units), 1), tempUnit, AccentCyan),
            Card(localizer.GetString("analytics.driving.outsideAvg", "Outside Avg"),
                StatValue(outside, s => TempFromCelsius(s.Avg, units), 1), tempUnit, AccentGreen),
            Card(localizer.GetString("analytics.driving.outsideMax", "Outside Max"),
                StatValue(outside, s => TempFromCelsius(s.Max, units), 1), tempUnit, AccentAmber),
        };

        return new DriveMetricSection(
            Key: Sections.TemperatureStats,
            Title: localizer.GetString("analytics.driving.tempStats", "Temperature Stats"),
            HasData: hasData,
            EmptyMessage: localizer.GetString("analytics.driving.noTempStats", "No temperature stats"),
            Cards: cards,
            AutomationName: localizer.GetString("analytics.driving.tempStats", "Temperature Stats"));
    }

    // ── The seven chart sections (web GlassPanel + chart | EmptyState blocks) ─────────────────────────
    private static List<DriveChartSection> BuildCharts(
        DriveAnalytics da,
        UnitPref units,
        ILocalizer localizer)
    {
        string trips = localizer.GetString("analytics.driving.trips", "Trips");
        string drives = localizer.GetString("analytics.driving.drives", "Drives");
        string distance = localizer.GetString("analytics.driving.distance", "Distance");
        string efficiency = localizer.GetString("analytics.driving.efficiency", "Efficiency");
        string distanceUnit = UnitLabels.Label(units.Distance);
        string efficiencyUnit = EfficiencyUnit(units);

        return new List<DriveChartSection>(7)
        {
            BucketSection(
                Sections.SpeedDistribution,
                localizer.GetString("analytics.driving.speedDist", "Speed Distribution"),
                localizer.GetString("analytics.driving.noSpeed", "No speed data"),
                da.SpeedDistribution, trips, ColorTrips),

            BucketSection(
                Sections.DistanceDistribution,
                localizer.GetString("analytics.driving.distDist", "Trip Distance Distribution"),
                localizer.GetString("analytics.driving.noDistDist", "No distance distribution data"),
                da.DistanceDistribution, trips, ColorDistDist),

            HourlySection(da.HourlyPattern, drives, distance, localizer),

            TempEffSection(da.TempVsEfficiency, efficiency, efficiencyUnit, units, localizer),

            DailyTrendSection(da.DailyTrend, distanceUnit, drives, localizer),

            BucketSection(
                Sections.DurationDistribution,
                localizer.GetString("analytics.driving.durationDist", "Drive Duration Distribution"),
                localizer.GetString("analytics.driving.noDurationData", "Not enough drive data for distribution chart"),
                da.DurationDistribution, drives, ColorDuration),

            EfficiencyTrendSection(da.DailyTrend, efficiencyUnit, localizer),
        };
    }

    // Single-bar distribution (speed / distance / duration): web BarChart over { range, count }.
    private static DriveChartSection BucketSection(
        string key,
        string title,
        string emptyMessage,
        IReadOnlyList<DriveBucket> buckets,
        string seriesName,
        int colorIndex)
    {
        if (buckets.Count == 0)
        {
            return EmptySection(key, title, emptyMessage);
        }

        var points = new List<ChartPoint>(buckets.Count);
        for (int i = 0; i < buckets.Count; i++)
        {
            points.Add(new ChartPoint(i, Safe(buckets[i].Count), buckets[i].Range));
        }

        var series = new List<ChartSeries>(1)
        {
            new(seriesName, points) { Kind = ChartSeriesKind.Bar, ColorIndex = colorIndex, Decimals = 0 },
        };

        return ReadySection(key, title, emptyMessage, series);
    }

    // Hourly pattern: web ComposedChart — drives bars (left) + distance line (right, raw km, unconverted).
    private static DriveChartSection HourlySection(
        IReadOnlyList<DriveHourPoint> hourly,
        string drivesName,
        string distanceName,
        ILocalizer localizer)
    {
        string title = localizer.GetString("analytics.driving.hourlyPattern", "Hourly Driving Pattern");
        string emptyMessage = localizer.GetString("analytics.driving.noHourly", "No hourly data");
        if (hourly.Count == 0)
        {
            return EmptySection(Sections.HourlyPattern, title, emptyMessage);
        }

        var drivePoints = new List<ChartPoint>(hourly.Count);
        var distancePoints = new List<ChartPoint>(hourly.Count);
        foreach (var point in hourly)
        {
            string label = HourLabel(point.Hour);
            drivePoints.Add(new ChartPoint(point.Hour, Safe(point.Drives), label));
            distancePoints.Add(new ChartPoint(point.Hour, Safe(point.Distance), label));
        }

        var series = new List<ChartSeries>(2)
        {
            new(drivesName, drivePoints) { Kind = ChartSeriesKind.Bar, ColorIndex = ColorTrips, Decimals = 0 },
            new(distanceName, distancePoints) { Kind = ChartSeriesKind.Line, ColorIndex = ColorOverlayLine, Decimals = 1 },
        };

        return ReadySection(Sections.HourlyPattern, title, emptyMessage, series);
    }

    // Temperature vs efficiency: web ScatterChart — temp (°C→display) vs efficiency (Wh/km→Wh/mi when miles).
    private static DriveChartSection TempEffSection(
        IReadOnlyList<DriveTempEffPoint> tempEff,
        string seriesName,
        string efficiencyUnit,
        UnitPref units,
        ILocalizer localizer)
    {
        string title = localizer.GetString("analytics.driving.tempVsEff", "Temperature vs Efficiency");
        string emptyMessage = localizer.GetString("analytics.driving.noTempEff", "No temperature data");
        if (tempEff.Count == 0)
        {
            return EmptySection(Sections.TempVsEfficiency, title, emptyMessage);
        }

        string tempUnit = UnitLabels.Label(units.Temperature);
        bool miles = units.Distance == DistanceUnit.Mi;
        var points = new List<ChartPoint>(tempEff.Count);
        foreach (var point in tempEff)
        {
            double temp = TempFromCelsius(point.Temp, units);
            double eff = miles ? Safe(point.Efficiency) * KmPerMile : Safe(point.Efficiency);
            string label = string.Concat(NumberFormatting.Format(temp, null, 0), tempUnit);
            points.Add(new ChartPoint(temp, eff, label));
        }

        var series = new List<ChartSeries>(1)
        {
            new(seriesName, points) { Kind = ChartSeriesKind.Scatter, ColorIndex = ColorScatter, Unit = efficiencyUnit, Decimals = 0 },
        };

        return ReadySection(Sections.TempVsEfficiency, title, emptyMessage, series);
    }

    // Daily trend: web ComposedChart — distance area (raw km, unconverted) + drives line.
    private static DriveChartSection DailyTrendSection(
        IReadOnlyList<DriveDailyPoint> dailyTrend,
        string distanceUnit,
        string drivesName,
        ILocalizer localizer)
    {
        string title = localizer.GetString("analytics.driving.dailyTrend", "Daily Driving Trend");
        string emptyMessage = localizer.GetString("analytics.driving.noDailyTrend", "No daily trend data");
        if (dailyTrend.Count == 0)
        {
            return EmptySection(Sections.DailyTrend, title, emptyMessage);
        }

        var distancePoints = new List<ChartPoint>(dailyTrend.Count);
        var drivePoints = new List<ChartPoint>(dailyTrend.Count);
        for (int i = 0; i < dailyTrend.Count; i++)
        {
            string label = DateLabel(dailyTrend[i].Date);
            distancePoints.Add(new ChartPoint(i, Safe(dailyTrend[i].Distance), label));
            drivePoints.Add(new ChartPoint(i, Safe(dailyTrend[i].Drives), label));
        }

        var series = new List<ChartSeries>(2)
        {
            new(distanceUnit, distancePoints) { Kind = ChartSeriesKind.Area, ColorIndex = ColorTrips, Decimals = 1 },
            new(drivesName, drivePoints) { Kind = ChartSeriesKind.Line, ColorIndex = ColorOverlayLine, Decimals = 0 },
        };

        return ReadySection(Sections.DailyTrend, title, emptyMessage, series);
    }

    // Efficiency trend: web AreaChart over daily_trend filtered to efficiency > 0 (raw Wh/km, unconverted).
    private static DriveChartSection EfficiencyTrendSection(
        IReadOnlyList<DriveDailyPoint> dailyTrend,
        string efficiencyUnit,
        ILocalizer localizer)
    {
        string title = localizer.GetString("analytics.driving.effTrend", "Efficiency Trend");
        string emptyMessage = localizer.GetString("analytics.driving.noEffTrend", "No efficiency trend data");

        var points = new List<ChartPoint>();
        int index = 0;
        foreach (var point in dailyTrend)
        {
            // Web parity: effTrend = dailyTrend.filter(d => safe(d.efficiency) > 0).
            if (Safe(point.Efficiency) > 0)
            {
                points.Add(new ChartPoint(index, Safe(point.Efficiency), DateLabel(point.Date)));
                index++;
            }
        }

        if (points.Count == 0)
        {
            return EmptySection(Sections.EfficiencyTrend, title, emptyMessage);
        }

        var series = new List<ChartSeries>(1)
        {
            new(efficiencyUnit, points) { Kind = ChartSeriesKind.Area, ColorIndex = ColorScatter, Decimals = 0 },
        };

        return ReadySection(Sections.EfficiencyTrend, title, emptyMessage, series);
    }

    private static DriveChartSection ReadySection(
        string key,
        string title,
        string emptyMessage,
        IReadOnlyList<ChartSeries> series)
    {
        string summary = ChartAccessibility.Summarize(title, series);
        return new DriveChartSection(
            Key: key,
            Title: title,
            HasData: true,
            EmptyMessage: emptyMessage,
            Series: series,
            AccessibleSummary: summary,
            AutomationName: summary);
    }

    private static DriveChartSection EmptySection(string key, string title, string emptyMessage) =>
        new(
            Key: key,
            Title: title,
            HasData: false,
            EmptyMessage: emptyMessage,
            Series: Array.Empty<ChartSeries>(),
            AccessibleSummary: emptyMessage,
            AutomationName: $"{title}. {emptyMessage}");

    private static DriveMetricCard Card(string label, string value, string unit, string accentBrushKey)
    {
        string spoken = value == EmDash || string.IsNullOrEmpty(unit)
            ? $"{label}: {value}"
            : $"{label}: {value} {unit}";
        return new DriveMetricCard(label, value, unit, accentBrushKey, spoken);
    }

    // Web parity: `stat ? fmtNumber(convert(safe(value)), p) : '—'` — the em-dash gates on the stat record.
    private static string StatValue(DriveStat? stat, Func<DriveStat, double> select, int precision) =>
        stat is null ? EmDash : NumberFormatting.Format(Safe(select(stat)), null, precision);

    private static double SpeedFromKmh(double kmh, UnitPref units) =>
        UnitConverters.SpeedFromSi(Safe(kmh) * MetersPerKm / SecondsPerHour, units.Speed);

    private static double DistanceFromKm(double km, UnitPref units) =>
        UnitConverters.DistanceFromSi(Safe(km) * MetersPerKm, units.Distance);

    private static double TempFromCelsius(double celsius, UnitPref units) =>
        UnitConverters.TemperatureFromSi(Safe(celsius), units.Temperature);

    private static string EfficiencyUnit(UnitPref units) =>
        units.Distance == DistanceUnit.Mi ? "Wh/mi" : "Wh/km";

    private static string HourLabel(double hour) =>
        string.Create(CultureInfo.InvariantCulture, $"{(int)hour}:00");

    // Web parity: the X-axis tickFormatter `(v) => v.slice(5)` drops the "YYYY-" prefix to a MM-DD label.
    private static string DateLabel(string date) =>
        date.Length > 5 ? date[5..] : date;

    private static double Safe(double value) => double.IsFinite(value) ? value : 0.0;

    private static string BuildAutomationName(
        DrivingTabState state,
        string title,
        string loadingLabel,
        string errorMessage,
        string chipLabel) => state switch
        {
            DrivingTabState.Loading => $"{title}. {loadingLabel}",
            DrivingTabState.Error => $"{title}. {errorMessage}",
            DrivingTabState.Stale or DrivingTabState.Offline => $"{title}. {chipLabel}",
            _ => title,
        };
}

/// <summary>
/// PII-safe diagnostics for the <c>DrivingTab</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a speed, distance, temperature or any
/// other drive metric — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class DrivingTabDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DrivingTabDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DrivingTab</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DrivingTabRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>DrivingTab</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/analytics/components/analytics/DrivingTab.tsx</c>.
/// </summary>
public static class DrivingTabRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "DrivingTab";
}
