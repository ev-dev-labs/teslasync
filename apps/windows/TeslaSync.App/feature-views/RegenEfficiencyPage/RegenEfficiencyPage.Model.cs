using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The backend regen-analytics rollup from <c>GET /analytics/regen</c> (web <c>RegenEfficiencyData</c> in
/// web/src/types/driving.ts, hook <c>useRegenEfficiency</c>), narrowed to the fields the Regen-Efficiency page
/// reads. Energy is SI (watt-hours), power is SI (watts) and the ratio / free-charge counts are dimensionless;
/// every display-side conversion happens at the render boundary, never here. Parsing is null-tolerant so a
/// partial or schema-drifted body never throws (web parity: the page tolerates undefined fields with
/// <c>?? 0</c>). Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record RegenSummary(
    double TotalRegenWh,
    double TotalDriveWh,
    double RegenRatio,
    double MonthlyAvgRegen,
    double FreeCharges)
{
    /// <summary>Project the <c>GET /analytics/regen</c> JSON object into a tolerant summary (non-object → null).</summary>
    public static RegenSummary? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new RegenSummary(
            TotalRegenWh: RegenJson.Double(element, "total_regen_wh") ?? RegenJson.Double(element, "totalRegenWh") ?? 0,
            TotalDriveWh: RegenJson.Double(element, "total_drive_wh") ?? RegenJson.Double(element, "totalDriveWh") ?? 0,
            RegenRatio: RegenJson.Double(element, "regen_ratio") ?? RegenJson.Double(element, "regenRatio") ?? 0,
            MonthlyAvgRegen: RegenJson.Double(element, "monthly_avg_regen") ?? RegenJson.Double(element, "monthlyAvgRegen") ?? 0,
            FreeCharges: RegenJson.Double(element, "free_charges") ?? RegenJson.Double(element, "freeCharges") ?? 0);
    }
}

/// <summary>
/// One drive row from <c>GET /drives</c> (web <c>Drive</c> in web/src/types/driving.ts, hook <c>useDrives</c>),
/// narrowed to the fields the client-side monthly-trend chart and recent-drives table read. Distance is SI
/// (meters), energy is SI (watt-hours) and power is SI (watts) exactly as the API stores them. Parsing is
/// null-tolerant so a partial row never throws. Pure data — no WinUI types.
/// </summary>
public sealed record RegenDrive(
    long Id,
    DateTimeOffset? StartTs,
    double DistanceM,
    double? EnergyUsedWh,
    double? RegenEnergyWh,
    double? AvgPowerW)
{
    /// <summary>Project a single drive JSON object into a tolerant drive record.</summary>
    public static RegenDrive FromJson(JsonElement element)
    {
        return new RegenDrive(
            Id: RegenJson.Long(element, "id") ?? 0,
            StartTs: RegenJson.Instant(element, "start_ts") ?? RegenJson.Instant(element, "startTs"),
            DistanceM: RegenJson.Double(element, "distance_m") ?? RegenJson.Double(element, "distanceM") ?? 0,
            EnergyUsedWh: RegenJson.Double(element, "energy_used_wh") ?? RegenJson.Double(element, "energyUsedWh"),
            RegenEnergyWh: RegenJson.Double(element, "regen_energy_wh") ?? RegenJson.Double(element, "regenEnergyWh"),
            AvgPowerW: RegenJson.Double(element, "avg_power_w") ?? RegenJson.Double(element, "avgPowerW"));
    }

    /// <summary>
    /// The per-drive regen ratio (web <c>getRegenRatio</c>): null when there is no positive average power or no
    /// positive energy used, otherwise <c>regenEnergyWh / energyUsedWh * 100</c>.
    /// </summary>
    public double? RegenRatio()
    {
        if (AvgPowerW is not > 0)
        {
            return null;
        }

        if (RegenEnergyWh is not > 0 || EnergyUsedWh is not > 0)
        {
            return null;
        }

        return RegenEnergyWh.Value / EnergyUsedWh.Value * 100;
    }
}

/// <summary>
/// The two-source snapshot the page binds to: the backend regen rollup (primary — its presence drives the
/// success/empty state, exactly as the web page gates on <c>data ?</c>) and the drive list (secondary — feeds
/// the client-side monthly-trend chart and the recent-drives table). Mirrors the web page handing both query
/// results to its render body.
/// </summary>
public sealed record RegenEfficiencySnapshot(
    bool HasData,
    RegenSummary Summary,
    IReadOnlyList<RegenDrive> Drives)
{
    /// <summary>The regen-ratio zero summary used as the empty / fallback backing value.</summary>
    public static RegenSummary EmptySummary { get; } = new(0, 0, 0, 0, 0);

    /// <summary>The empty snapshot (no backend regen object) — the page-level empty surface.</summary>
    public static RegenEfficiencySnapshot Empty { get; } = new(false, EmptySummary, Array.Empty<RegenDrive>());

    /// <summary>Compose a snapshot from the parsed regen summary (may be null) and the drive list.</summary>
    public static RegenEfficiencySnapshot Compose(RegenSummary? summary, IReadOnlyList<RegenDrive> drives) =>
        summary is { } s
            ? new RegenEfficiencySnapshot(true, s, drives)
            : new RegenEfficiencySnapshot(false, EmptySummary, drives);
}

/// <summary>The two-source data port the page binds to (the native P1/S8 seam). The view never performs HTTP.</summary>
public interface IRegenEfficiencyFeed
{
    /// <summary>Fetch the regen-analytics rollup + drive list for the active vehicle.</summary>
    Task<RegenEfficiencySnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed used by the shell registration: always resolves to the empty surface.</summary>
public sealed class EmptyRegenEfficiencyFeed : IRegenEfficiencyFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyRegenEfficiencyFeed Instance { get; } = new();

    private EmptyRegenEfficiencyFeed()
    {
    }

    /// <inheritdoc />
    public Task<RegenEfficiencySnapshot> FetchAsync(CancellationToken cancellationToken) =>
        Task.FromResult(RegenEfficiencySnapshot.Empty);
}

/// <summary>The mutually-exclusive top-level data state the page renders (web loading / empty / error / success).</summary>
public enum RegenEfficiencyState
{
    /// <summary>The primary regen query is in flight with no data yet — the loading shimmer.</summary>
    Loading,

    /// <summary>Resolved with no backend regen object — the friendly empty surface, never a blank page.</summary>
    Empty,

    /// <summary>The primary regen query failed — the retriable error surface.</summary>
    Error,

    /// <summary>The regen rollup resolved — the full page content.</summary>
    Success,
}

/// <summary>A summary stat tile (web hero stat-card grid). Pre-formatted value + glyph + label.</summary>
public sealed record RegenStatCardDisplay(string Glyph, string Value, string Label, string AutomationName);

/// <summary>A labelled progress bar in the regen-metrics strip (web <c>MetricBar</c> + sub-line).</summary>
public sealed record RegenMetricBarDisplay(
    string Label,
    double Value,
    double Max,
    string ValueText,
    string AccentBrushKey);

/// <summary>A computed monthly-trend datum (web client-side <c>monthlyTrend</c> map output).</summary>
public sealed record RegenTrendPoint(string Month, double RegenKwh, int Drives, double Distance);

/// <summary>A typed chart series projected for the monthly-trend composed chart (WinUI-free).</summary>
public sealed record RegenSeriesDisplay(
    string Name,
    ChartSeriesKind Kind,
    ChartRole Role,
    int ColorIndex,
    IReadOnlyList<ChartPoint> Points);

/// <summary>The monthly-regen-trend chart projection (web <c>ChartContainer</c> + <c>ComposedChart</c>).</summary>
public sealed record RegenTrendChartDisplay(
    bool Visible,
    bool HasData,
    string Title,
    string AriaLabel,
    IReadOnlyList<RegenTrendPoint> Rows,
    IReadOnlyList<RegenSeriesDisplay> Series);

/// <summary>A single recent-regen-drives table row (web per-drive list item).</summary>
public sealed record RegenDriveRowDisplay(
    string Id,
    string Date,
    string Distance,
    string MaxRegen,
    string Ratio,
    StatusKind RatioStatus,
    string AutomationName);

/// <summary>
/// The fully-resolved render model the WinUI view binds to — every branch, format and string the web
/// <c>RegenEfficiencyPage</c> computes, resolved once so the view is a thin renderer. Pure data — no WinUI
/// types — so the whole projection is unit-tested without a UI host.
/// </summary>
public sealed record RegenEfficiencyDisplay(
    RegenEfficiencyState State,
    string Title,
    string Subtitle,
    bool ShowLoading,
    bool ShowError,
    bool ShowEmpty,
    bool ShowContent,
    string ErrorText,
    string RetryLabel,
    string EmptyMessage,
    double GaugeValue,
    double GaugeMax,
    string GaugeLabel,
    string GaugeUnit,
    StatusKind GaugeStatus,
    string RecoveredInfo,
    IReadOnlyList<RegenStatCardDisplay> StatCards,
    RegenTrendChartDisplay Trend,
    string MetricsTitle,
    string MetricsHelpHint,
    string MetricsHelpLabel,
    IReadOnlyList<RegenMetricBarDisplay> MetricBars,
    string RecentTitle,
    IReadOnlyList<string> TableColumns,
    IReadOnlyList<RegenDriveRowDisplay> TableRows,
    string TableEmptyMessage,
    string AutomationName);

/// <summary>
/// The render-time input the projection consumes — the parsed two-source <see cref="Snapshot"/> plus the page
/// lifecycle (the primary regen query's <see cref="Loading"/> / <see cref="ErrorDetail"/>). The view-model
/// fills this in; tests construct it directly. Pure data — no WinUI types.
/// </summary>
public sealed record RegenEfficiencyModel(RegenEfficiencySnapshot Snapshot, bool Loading, string? ErrorDetail)
{
    /// <summary>The initial model: the primary regen query is in flight with no data yet.</summary>
    public static RegenEfficiencyModel Initial { get; } = new(RegenEfficiencySnapshot.Empty, true, null);
}

/// <summary>
/// The fully-resolved set of localized strings the page renders — every key the web
/// <c>RegenEfficiencyPage</c> feeds into <c>t(...)</c>, resolved once through the i18n facade so the projection
/// stays readable and the string-coverage test asserts all of them in one pass.
/// </summary>
public sealed record RegenStrings
{
    public required string Title { get; init; }
    public required string Subtitle { get; init; }
    public required string RegenRatio { get; init; }
    public required string RecoveredInfo { get; init; }
    public required string TotalRegen { get; init; }
    public required string RatioLabel { get; init; }
    public required string MonthlyAvg { get; init; }
    public required string FreeCharges { get; init; }
    public required string LifetimeRegen { get; init; }
    public required string LifetimeDrive { get; init; }
    public required string MonthlyTrend { get; init; }
    public required string MonthlyTrendAria { get; init; }
    public required string ColMonth { get; init; }
    public required string ColRegenKwh { get; init; }
    public required string ColDrives { get; init; }
    public required string Drives { get; init; }
    public required string RegenKwh { get; init; }
    public required string Metrics { get; init; }
    public required string HelpIconLabel { get; init; }
    public required string TotalRegenLabel { get; init; }
    public required string RegenRatioBar { get; init; }
    public required string MonthlyAvgBar { get; init; }
    public required string FreeChargesBar { get; init; }
    public required string RecentDrives { get; init; }
    public required string Date { get; init; }
    public required string DistanceCol { get; init; }
    public required string MaxRegenCol { get; init; }
    public required string RatioCol { get; init; }
    public required string NoData { get; init; }
    public required string RegenNoData { get; init; }
    public required string ErrorTitle { get; init; }
    public required string Retry { get; init; }

    /// <summary>Resolve every string the page renders through the i18n facade (web key names, verbatim).</summary>
    public static RegenStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new RegenStrings
        {
            Title = localizer.GetString("regen.title", "Regenerative Braking"),
            Subtitle = localizer.GetString("regen.subtitle", "Energy recovery analysis and regen efficiency"),
            RegenRatio = localizer.GetString("regen.regenRatio", "Regen Ratio"),
            RecoveredInfo = localizer.GetString(
                "regen.recoveredInfo",
                "You've recovered {0} kWh \u2014 equivalent to ~{1} free charges."),
            TotalRegen = localizer.GetString("regen.totalRegen", "Total Regen"),
            RatioLabel = localizer.GetString("regen.ratioLabel", "Recovery Rate"),
            MonthlyAvg = localizer.GetString("regen.monthlyAvg", "Monthly Avg kW"),
            FreeCharges = localizer.GetString("regen.freeCharges", "Free Charges"),
            LifetimeRegen = localizer.GetString("regen.lifetimeRegen", "Lifetime Regen kWh"),
            LifetimeDrive = localizer.GetString("regen.lifetimeDrive", "Lifetime Drive kWh"),
            MonthlyTrend = localizer.GetString("regen.monthlyTrend", "Monthly Regen Trend"),
            MonthlyTrendAria = localizer.GetString(
                "regen.monthlyTrend.aria",
                "Monthly regen energy and drive count composed chart"),
            ColMonth = localizer.GetString("regen.col.month", "Month"),
            ColRegenKwh = localizer.GetString("regen.col.regenKwh", "Regen kWh"),
            ColDrives = localizer.GetString("regen.col.drives", "Drives"),
            Drives = localizer.GetString("regen.drives", "Drives"),
            RegenKwh = localizer.GetString("regen.regenKwh", "Regen kWh"),
            Metrics = localizer.GetString("regen.metrics", "Regen Metrics"),
            HelpIconLabel = localizer.GetString("help.regenEfficiency.iconLabel", "More info about regen metrics"),
            TotalRegenLabel = localizer.GetString("regen.totalRegenLabel", "Total Regen"),
            RegenRatioBar = localizer.GetString("regen.regenRatioBar", "Regen Ratio"),
            MonthlyAvgBar = localizer.GetString("regen.monthlyAvgBar", "Monthly Avg"),
            FreeChargesBar = localizer.GetString("regen.freeChargesBar", "Free Charges"),
            RecentDrives = localizer.GetString("regen.recentDrives", "Recent Regen Drives"),
            Date = localizer.GetString("regen.date", "Date"),
            DistanceCol = localizer.GetString("regen.distanceCol", "Distance"),
            MaxRegenCol = localizer.GetString("regen.maxRegenCol", "Max Regen"),
            RatioCol = localizer.GetString("regen.ratioCol", "Ratio"),
            NoData = localizer.GetString("common.noData", "No data available"),
            RegenNoData = localizer.GetString("regen.noData", "No regen efficiency data available yet"),
            ErrorTitle = localizer.GetString("regen.error", "Unable to load regen efficiency"),
            Retry = localizer.GetString("common.retry", "Retry"),
        };
    }
}

/// <summary>
/// Pure projection from a <see cref="RegenEfficiencyModel"/> to its <see cref="RegenEfficiencyDisplay"/> — the
/// native port of the render logic in web/src/features/driving/pages/RegenEfficiencyPage.tsx and its
/// <c>regenColor</c> / <c>getRegenRatio</c> / <c>monthlyTrend</c> / <c>regenDrives</c> helpers. The branch
/// precedence mirrors the web data lifecycle (loading → error → empty → success); the backend rollup feeds the
/// hero gauge, the six stat cards and the four metric bars, while the drive list feeds the client-side
/// monthly-trend composed chart and the recent-regen-drives table. Every label resolves through the i18n
/// facade using the same keys the web page uses and every SI value is converted at this display boundary.
/// </summary>
public static class RegenEfficiencyProjection
{
    /// <summary>Segoe Fluent — LightningBolt (web <c>Zap</c>).</summary>
    public const string ZapGlyph = "\uE945";

    /// <summary>Segoe Fluent — activity (web <c>Activity</c>).</summary>
    public const string ActivityGlyph = "\uE9D2";

    /// <summary>Segoe Fluent — Calendar (web <c>Calendar</c>).</summary>
    public const string CalendarGlyph = "\uE787";

    /// <summary>The regen-ratio gauge maximum (web <c>max={100}</c>).</summary>
    public const double GaugeMax = 100;

    private const int EnergyPrecision = 1;
    private const int PowerPrecision = 1;
    private const int PercentPrecision = 2;
    private const int NumberPrecision = 2;
    private const int DistancePrecision = 2;
    private const int RecentDrivesLimit = 20;
    private const int TrendMonths = 12;

    private const string SuccessBrush = "TsColorSuccessBrush";
    private const string AccentBrush = "TsColorAccentBrush";
    private const string InfoBrush = "TsColorInfoBrush";
    private const string WarningBrush = "TsColorWarningBrush";
    private const string EmDash = "\u2014";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the active units + localizer.</summary>
    /// <param name="model">The parsed two-source data plus the page lifecycle flags.</param>
    /// <param name="units">The user's unit-display preference (applied only at this boundary).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">Injectable clock for deterministic date formatting in tests.</param>
    public static RegenEfficiencyDisplay Project(
        RegenEfficiencyModel model,
        UnitPref units,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var s = RegenStrings.Resolve(localizer);
        var snapshot = model.Snapshot;
        var data = snapshot.Summary;
        var drives = snapshot.Drives;

        RegenEfficiencyState state =
            model.Loading && !snapshot.HasData ? RegenEfficiencyState.Loading
            : model.ErrorDetail is not null ? RegenEfficiencyState.Error
            : !snapshot.HasData ? RegenEfficiencyState.Empty
            : RegenEfficiencyState.Success;

        string errorText = string.IsNullOrWhiteSpace(model.ErrorDetail)
            ? s.ErrorTitle
            : $"{s.ErrorTitle}: {model.ErrorDetail}";

        var statCards = BuildStatCards(data, s, units);
        var metricBars = BuildMetricBars(data, s, units);
        var trend = BuildTrend(drives, s, units);
        var (columns, rows) = BuildTable(drives, s, units, now);

        string recovered = string.Format(
            CultureInfo.CurrentCulture,
            s.RecoveredInfo,
            ScalarFormatters.FormatNumber(data.TotalRegenWh / 1000.0, EnergyPrecision),
            ScalarFormatters.FormatNumber(data.FreeCharges, NumberPrecision));

        return new RegenEfficiencyDisplay(
            State: state,
            Title: s.Title,
            Subtitle: s.Subtitle,
            ShowLoading: state == RegenEfficiencyState.Loading,
            ShowError: state == RegenEfficiencyState.Error,
            ShowEmpty: state == RegenEfficiencyState.Empty,
            ShowContent: state == RegenEfficiencyState.Success,
            ErrorText: errorText,
            RetryLabel: s.Retry,
            EmptyMessage: s.RegenNoData,
            GaugeValue: Math.Round(data.RegenRatio),
            GaugeMax: GaugeMax,
            GaugeLabel: s.RegenRatio,
            GaugeUnit: "%",
            GaugeStatus: RegenStatus(data.RegenRatio),
            RecoveredInfo: recovered,
            StatCards: statCards,
            Trend: trend,
            MetricsTitle: s.Metrics,
            MetricsHelpHint: localizer.GetString(
                "help.regenEfficiency.body",
                "Energy recovered through regenerative braking divided by total energy used during driving."),
            MetricsHelpLabel: s.HelpIconLabel,
            MetricBars: metricBars,
            RecentTitle: s.RecentDrives,
            TableColumns: columns,
            TableRows: rows,
            TableEmptyMessage: s.NoData,
            AutomationName: $"{s.Title}. {s.Subtitle}");
    }

    /// <summary>
    /// The semantic quality band of a regen ratio (web <c>regenColor</c>): ≥25 excellent (success), ≥15 good
    /// (info/accent), ≥8 fair (warning), otherwise poor (danger).
    /// </summary>
    public static StatusKind RegenStatus(double ratio) =>
        ratio >= 25 ? StatusKind.Success
        : ratio >= 15 ? StatusKind.Info
        : ratio >= 8 ? StatusKind.Warning
        : StatusKind.Danger;

    private static IReadOnlyList<RegenStatCardDisplay> BuildStatCards(RegenSummary data, RegenStrings s, UnitPref units)
    {
        string totalRegen = UnitFormatters.FormatEnergy(data.TotalRegenWh, units, EnergyPrecision);
        string ratio = ScalarFormatters.FormatPercentage(data.RegenRatio, PercentPrecision);
        string monthlyAvg = UnitFormatters.FormatPower(data.MonthlyAvgRegen, units, PowerPrecision);
        string freeCharges = ScalarFormatters.FormatNumber(data.FreeCharges, NumberPrecision);

        // Lifetime regen / drive energy are always unavailable on the web page (the two consts are null), so the
        // last two tiles render the em-dash fallback — preserved here for full hero-grid parity.
        return
        [
            new RegenStatCardDisplay(ZapGlyph, totalRegen, s.TotalRegen, $"{s.TotalRegen}: {totalRegen}"),
            new RegenStatCardDisplay(ActivityGlyph, ratio, s.RatioLabel, $"{s.RatioLabel}: {ratio}"),
            new RegenStatCardDisplay(CalendarGlyph, monthlyAvg, s.MonthlyAvg, $"{s.MonthlyAvg}: {monthlyAvg}"),
            new RegenStatCardDisplay(ZapGlyph, freeCharges, s.FreeCharges, $"{s.FreeCharges}: {freeCharges}"),
            new RegenStatCardDisplay(ZapGlyph, EmDash, s.LifetimeRegen, $"{s.LifetimeRegen}: {EmDash}"),
            new RegenStatCardDisplay(ActivityGlyph, EmDash, s.LifetimeDrive, $"{s.LifetimeDrive}: {EmDash}"),
        ];
    }

    private static IReadOnlyList<RegenMetricBarDisplay> BuildMetricBars(RegenSummary data, RegenStrings s, UnitPref units)
    {
        return
        [
            new RegenMetricBarDisplay(
                s.TotalRegenLabel,
                data.TotalRegenWh,
                Math.Max(data.TotalRegenWh, 100000),
                UnitFormatters.FormatEnergy(data.TotalRegenWh, units, EnergyPrecision),
                SuccessBrush),
            new RegenMetricBarDisplay(
                s.RegenRatioBar,
                data.RegenRatio,
                100,
                ScalarFormatters.FormatPercentage(data.RegenRatio, PercentPrecision),
                AccentBrush),
            new RegenMetricBarDisplay(
                s.MonthlyAvgBar,
                data.MonthlyAvgRegen,
                Math.Max(data.MonthlyAvgRegen, 50),
                UnitFormatters.FormatPower(data.MonthlyAvgRegen, units, PowerPrecision),
                InfoBrush),
            new RegenMetricBarDisplay(
                s.FreeChargesBar,
                data.FreeCharges,
                Math.Max(data.FreeCharges, 10),
                ScalarFormatters.FormatNumber(data.FreeCharges, NumberPrecision),
                WarningBrush),
        ];
    }

    /// <summary>
    /// Build the client-side monthly-regen-trend rows (web <c>monthlyTrend</c>): bucket drives by <c>yyyy-MM</c>,
    /// sum regen Wh / count drives / sum distance, keep the most recent twelve months in ascending order, then
    /// project regen Wh → kWh and meters → the user's distance unit. The chart only renders when more than one
    /// month is present (web <c>monthlyTrend.length &gt; 1</c>).
    /// </summary>
    public static IReadOnlyList<RegenTrendPoint> BuildMonthlyTrend(IReadOnlyList<RegenDrive> drives, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(drives);
        ArgumentNullException.ThrowIfNull(units);

        var byMonth = new Dictionary<string, (double TotalRegen, int Count, double TotalDist)>(StringComparer.Ordinal);
        foreach (var d in drives)
        {
            if (d.StartTs is not { } ts)
            {
                continue;
            }

            string month = ts.ToString("yyyy-MM", CultureInfo.InvariantCulture);
            byMonth.TryGetValue(month, out var bucket);
            bucket.TotalRegen += d.RegenEnergyWh ?? 0;
            bucket.Count++;
            bucket.TotalDist += d.DistanceM;
            byMonth[month] = bucket;
        }

        var months = new List<string>(byMonth.Keys);
        months.Sort(StringComparer.Ordinal);
        var trimmed = months.Count > TrendMonths ? months.GetRange(months.Count - TrendMonths, TrendMonths) : months;

        var rows = new List<RegenTrendPoint>(trimmed.Count);
        foreach (var month in trimmed)
        {
            var bucket = byMonth[month];
            double regenKwh = Math.Round(bucket.TotalRegen / 1000.0, 1);
            double distance = Math.Round(UnitConverters.DistanceFromSi(bucket.TotalDist, units.Distance));
            rows.Add(new RegenTrendPoint(month, regenKwh, bucket.Count, distance));
        }

        return rows;
    }

    private static RegenTrendChartDisplay BuildTrend(IReadOnlyList<RegenDrive> drives, RegenStrings s, UnitPref units)
    {
        var rows = BuildMonthlyTrend(drives, units);
        bool visible = rows.Count > 1;

        var drivePoints = new List<ChartPoint>(rows.Count);
        var regenPoints = new List<ChartPoint>(rows.Count);
        for (int i = 0; i < rows.Count; i++)
        {
            drivePoints.Add(new ChartPoint(i, rows[i].Drives, rows[i].Month));
            regenPoints.Add(new ChartPoint(i, rows[i].RegenKwh, rows[i].Month));
        }

        var series = new List<RegenSeriesDisplay>
        {
            new(s.Drives, ChartSeriesKind.Bar, ChartRole.None, 4, drivePoints),
            new(s.RegenKwh, ChartSeriesKind.Line, ChartRole.Regen, 0, regenPoints),
        };

        return new RegenTrendChartDisplay(visible, rows.Count > 0, s.MonthlyTrend, s.MonthlyTrendAria, rows, series);
    }

    private static (IReadOnlyList<string> Columns, IReadOnlyList<RegenDriveRowDisplay> Rows) BuildTable(
        IReadOnlyList<RegenDrive> drives,
        RegenStrings s,
        UnitPref units,
        DateTimeOffset now)
    {
        var columns = new[] { s.Date, s.DistanceCol, s.MaxRegenCol, s.RatioCol };

        var rows = new List<RegenDriveRowDisplay>();
        foreach (var d in drives)
        {
            if (d.RegenEnergyWh is not > 0)
            {
                continue;
            }

            if (rows.Count >= RecentDrivesLimit)
            {
                break;
            }

            string date = d.StartTs is { } ts
                ? DateTimeFormatting.Format(ts, DateTimeVariant.Short, now)
                : EmDash;
            double distanceDisplay = UnitConverters.DistanceFromSi(d.DistanceM, units.Distance);
            string distance = $"{ScalarFormatters.FormatNumber(distanceDisplay, DistancePrecision)} {UnitLabels.Label(units.Distance)}";
            string maxRegen = d.RegenEnergyWh is { } regen
                ? $"{ScalarFormatters.FormatNumber(regen / 1000.0, NumberPrecision)} kWh"
                : EmDash;

            double? ratio = d.RegenRatio();
            string ratioText = ratio is { } r ? ScalarFormatters.FormatPercentage(r, PercentPrecision) : EmDash;
            StatusKind ratioStatus = ratio is { } rv ? RegenStatus(rv) : StatusKind.Neutral;

            rows.Add(new RegenDriveRowDisplay(
                d.Id.ToString(CultureInfo.InvariantCulture),
                date,
                distance,
                maxRegen,
                ratioText,
                ratioStatus,
                $"{date}, {distance}, {maxRegen}, {ratioText}"));
        }

        return (columns, rows);
    }
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Regen-Efficiency page — every getter returns a
/// nullable rather than throwing so a partial or schema-drifted body never aborts the parse (web parity: the
/// page tolerates undefined fields). WinUI-free so the parse is unit-tested without a UI host. Reads the
/// snake_case wire shape (no camelCaseKeys transform on native) but also accepts the camelCase alias.
/// </summary>
internal static class RegenJson
{
    /// <summary>The numeric value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static double? Double(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(prop.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var sv) => sv,
            _ => null,
        };
    }

    /// <summary>The integer value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static long? Long(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetInt64(out var n) => n,
            JsonValueKind.Number when prop.TryGetDouble(out var d) => (long)d,
            JsonValueKind.String when long.TryParse(prop.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var sv) => sv,
            _ => null,
        };
    }

    /// <summary>The timestamp value of <paramref name="name"/>, or null when absent / unparseable.</summary>
    public static DateTimeOffset? Instant(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object
            || !obj.TryGetProperty(name, out var prop)
            || prop.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            prop.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// Canonical navigation + diagnostics metadata for the Regen-Efficiency page — the native mirror of the web
/// page at web/src/features/driving/pages/RegenEfficiencyPage.tsx (route <c>/regen-efficiency</c>, nav name
/// <c>RegenEfficiency</c>). The page reads the same regen-analytics rollup the web <c>useRegenEfficiency</c>
/// hook reads (generated operation <c>get_api_v1_analytics_regen</c>) plus the drive list the web
/// <c>useDrives</c> hook reads (generated operation <c>get_api_v1_drives</c>).
/// </summary>
public static class RegenEfficiencyRegistration
{
    /// <summary>The navigation route name the shell registers this page under (matches <c>RouteTable</c>).</summary>
    public const string RouteName = "RegenEfficiency";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "RegenEfficiencyPage";

    /// <summary>The generated operation id for the regen-analytics read (web <c>useRegenEfficiency</c>).</summary>
    public const string RegenOperation = Operations.Analytics.Regen;

    /// <summary>The generated operation id for the drive-list read (web <c>useDrives</c>).</summary>
    public const string DrivesOperation = Operations.Drives.List;

    /// <summary>The Segoe Fluent glyph for the page-level empty surface (web <c>Activity</c>).</summary>
    public const string EmptyGlyph = RegenEfficiencyProjection.ActivityGlyph;

    /// <summary>The localized page title (web <c>t('regen.title')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("regen.title", "Regenerative Braking");
    }
}

/// <summary>
/// PII-safe diagnostics sink for the Regen-Efficiency surface — records only the <c>view.opened</c> event with
/// the surface slug, never any vehicle data. Mirrors the sibling feature-view diagnostics.
/// </summary>
public sealed class RegenEfficiencyDiagnostics
{
    private readonly Action<string>? _sink;
    private int _viewsOpened;

    /// <summary>Creates the diagnostics sink over an optional line writer.</summary>
    public RegenEfficiencyDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>The number of times the surface was opened.</summary>
    public int ViewsOpened => _viewsOpened;

    /// <summary>Record that the surface was opened (PII-safe).</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={RegenEfficiencyRegistration.Slug}");
    }
}
