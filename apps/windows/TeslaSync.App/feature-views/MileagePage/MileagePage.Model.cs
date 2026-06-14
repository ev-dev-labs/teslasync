using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The backend mileage rollup from <c>GET /mileage/stats</c> (web <c>MileageStats</c> in
/// web/src/types/analytics.ts, hook <c>useMileageStats</c>), narrowed to the fields the Mileage page reads.
/// Distances are kilometres exactly as the restored <c>/mileage/*</c> endpoints emit them (NOT SI metres — the
/// page multiplies by 1000 before converting at the render boundary); the drive counts are dimensionless.
/// Parsing is null-tolerant so a partial or schema-drifted body never throws (web parity: the page tolerates
/// undefined fields with <c>?? 0</c>). Pure data — no WinUI types — so the projection is unit-tested without a
/// UI host.
/// </summary>
public sealed record MileageStats(
    double LifetimeKm,
    double Last30dKm,
    long DriveCountLifetime)
{
    /// <summary>Project the <c>GET /mileage/stats</c> JSON object into a tolerant summary (non-object → null).</summary>
    public static MileageStats? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new MileageStats(
            LifetimeKm: MileageJson.Double(element, "lifetime_km") ?? MileageJson.Double(element, "lifetimeKm") ?? 0,
            Last30dKm: MileageJson.Double(element, "last_30d_km") ?? MileageJson.Double(element, "last30dKm") ?? 0,
            DriveCountLifetime: MileageJson.Long(element, "drive_count_lifetime") ?? MileageJson.Long(element, "driveCountLifetime") ?? 0);
    }
}

/// <summary>
/// One per-day bucket from <c>GET /mileage/daily</c> (web <c>DailyMileageBucket</c> in
/// web/src/types/analytics.ts, hook <c>useDailyMileage</c>), narrowed to the fields the Odometer-Over-Time area
/// chart and the Daily-Distance bar chart read. <see cref="Date"/> is a <c>YYYY-MM-DD</c> calendar day;
/// <see cref="TotalKm"/> is the distance driven that day in kilometres; <see cref="EndOdometerKm"/> is the
/// absolute odometer reading at the end of the latest qualifying drive (null when every drive that day recorded
/// a NULL odometer). Parsing is null-tolerant. Pure data — no WinUI types.
/// </summary>
public sealed record MileageDailyBucket(
    string Date,
    double TotalKm,
    double? EndOdometerKm)
{
    /// <summary>Project a single daily-bucket JSON object into a tolerant record.</summary>
    public static MileageDailyBucket FromJson(JsonElement element)
    {
        return new MileageDailyBucket(
            Date: MileageJson.String(element, "date") ?? string.Empty,
            TotalKm: MileageJson.Double(element, "total_km") ?? MileageJson.Double(element, "totalKm") ?? 0,
            EndOdometerKm: MileageJson.Double(element, "end_odometer_km") ?? MileageJson.Double(element, "endOdometerKm"));
    }
}

/// <summary>
/// One per-month bucket from <c>GET /mileage/monthly</c> (web <c>MonthlyMileageBucket</c> in
/// web/src/types/analytics.ts, hook <c>useMonthlyMileage</c>), narrowed to the fields the Monthly-Summary table
/// reads. <see cref="YearMonth"/> is the <c>YYYY-MM</c> UTC calendar month; <see cref="TotalKm"/> is the
/// kilometres driven that month; <see cref="DriveCount"/> is the number of drives. Parsing is null-tolerant.
/// Pure data — no WinUI types.
/// </summary>
public sealed record MileageMonthlyBucket(
    string YearMonth,
    double TotalKm,
    long DriveCount)
{
    /// <summary>Project a single monthly-bucket JSON object into a tolerant record.</summary>
    public static MileageMonthlyBucket FromJson(JsonElement element)
    {
        return new MileageMonthlyBucket(
            YearMonth: MileageJson.String(element, "year_month") ?? MileageJson.String(element, "yearMonth") ?? string.Empty,
            TotalKm: MileageJson.Double(element, "total_km") ?? MileageJson.Double(element, "totalKm") ?? 0,
            DriveCount: MileageJson.Long(element, "drive_count") ?? MileageJson.Long(element, "driveCount") ?? 0);
    }
}

/// <summary>
/// The three-source snapshot the page binds to: the lifetime/windowed rollup (primary — its presence drives the
/// success/empty state, exactly as the web page gates loading on <c>useMileageStats</c>), the per-day buckets
/// (feed the odometer + daily-distance charts) and the per-month buckets (feed the monthly-summary table).
/// Mirrors the web page handing all three query results to its render body.
/// </summary>
public sealed record MileageSnapshot(
    bool HasData,
    MileageStats Stats,
    IReadOnlyList<MileageDailyBucket> Daily,
    IReadOnlyList<MileageMonthlyBucket> Monthly)
{
    /// <summary>The zero stats used as the empty / fallback backing value.</summary>
    public static MileageStats EmptyStats { get; } = new(0, 0, 0);

    /// <summary>The empty snapshot (no backend stats object) — the page-level empty surface.</summary>
    public static MileageSnapshot Empty { get; } =
        new(false, EmptyStats, Array.Empty<MileageDailyBucket>(), Array.Empty<MileageMonthlyBucket>());

    /// <summary>Compose a snapshot from the parsed stats (may be null) plus the daily + monthly buckets.</summary>
    public static MileageSnapshot Compose(
        MileageStats? stats,
        IReadOnlyList<MileageDailyBucket> daily,
        IReadOnlyList<MileageMonthlyBucket> monthly) =>
        stats is { } s
            ? new MileageSnapshot(true, s, daily, monthly)
            : new MileageSnapshot(false, EmptyStats, daily, monthly);
}

/// <summary>The three-source data port the page binds to (the native P1/S8 seam). The view never performs HTTP.</summary>
public interface IMileageFeed
{
    /// <summary>Fetch the mileage stats + daily buckets + monthly buckets for the active vehicle.</summary>
    Task<MileageSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed used by the shell registration: always resolves to the empty surface.</summary>
public sealed class EmptyMileageFeed : IMileageFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyMileageFeed Instance { get; } = new();

    private EmptyMileageFeed()
    {
    }

    /// <inheritdoc />
    public Task<MileageSnapshot> FetchAsync(CancellationToken cancellationToken) =>
        Task.FromResult(MileageSnapshot.Empty);
}

/// <summary>The mutually-exclusive top-level data state the page renders (web loading / empty / error / success).</summary>
public enum MileageState
{
    /// <summary>The primary stats query is in flight with no data yet — the loading shimmer.</summary>
    Loading,

    /// <summary>Resolved with no backend stats object — the friendly empty surface, never a blank page.</summary>
    Empty,

    /// <summary>The primary stats query failed — the retriable error surface.</summary>
    Error,

    /// <summary>The stats rollup resolved — the full page content.</summary>
    Success,
}

/// <summary>A summary metric card (web <c>MetricCard</c>). Pre-formatted value + label + accent rail brush.</summary>
public sealed record MileageMetricCardDisplay(string Label, string Value, string AccentBrushKey, string AutomationName);

/// <summary>
/// A cartesian chart projection (web <c>AreaChart</c> / <c>BarChart</c> inside a GlassPanel). When
/// <see cref="HasData"/> is false the panel renders its <see cref="EmptyMessage"/> instead of the plot, never a
/// blank region. The view picks the concrete area / bar wrapper; the points + colour live here so the whole
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record MileageChartDisplay(
    bool HasData,
    string Title,
    string AriaLabel,
    string EmptyMessage,
    string SeriesName,
    int ColorIndex,
    IReadOnlyList<ChartPoint> Points);

/// <summary>One labelled column header in the monthly-summary table.</summary>
public sealed record MileageColumnDisplay(string Key, string Header, bool IsNumeric);

/// <summary>One monthly-summary table row (web per-month list item), every cell pre-formatted at the boundary.</summary>
public sealed record MileageMonthRowDisplay(
    string Month,
    string Distance,
    string Drives,
    string DistancePerDrive,
    string AutomationName);

/// <summary>
/// The fully-resolved render model the WinUI view binds to — every branch, format and string the web
/// <c>MileagePage</c> computes, resolved once so the view is a thin renderer. Pure data — no WinUI types — so
/// the whole projection is unit-tested without a UI host.
/// </summary>
public sealed record MileageDisplay(
    MileageState State,
    string Title,
    string Subtitle,
    bool ShowLoading,
    bool ShowError,
    bool ShowEmpty,
    bool ShowContent,
    string ErrorText,
    string RetryLabel,
    string EmptyMessage,
    IReadOnlyList<MileageMetricCardDisplay> MetricCards,
    MileageChartDisplay OdometerChart,
    MileageChartDisplay DailyChart,
    string MonthlyTitle,
    IReadOnlyList<MileageColumnDisplay> TableColumns,
    IReadOnlyList<MileageMonthRowDisplay> TableRows,
    string TableEmptyMessage,
    string AutomationName);

/// <summary>
/// The render-time input the projection consumes — the parsed three-source <see cref="Snapshot"/> plus the page
/// lifecycle (the primary stats query's <see cref="Loading"/> / <see cref="ErrorDetail"/>). The view-model
/// fills this in; tests construct it directly. Pure data — no WinUI types.
/// </summary>
public sealed record MileageModel(MileageSnapshot Snapshot, bool Loading, string? ErrorDetail)
{
    /// <summary>The initial model: the primary stats query is in flight with no data yet.</summary>
    public static MileageModel Initial { get; } = new(MileageSnapshot.Empty, true, null);
}

/// <summary>
/// The fully-resolved set of localized strings the page renders — every key the web <c>MileagePage</c> feeds
/// into <c>t(...)</c>, resolved once through the i18n facade so the projection stays readable and the
/// string-coverage test asserts all of them in one pass. The web keys are preserved verbatim.
/// </summary>
public sealed record MileageStrings
{
    public required string Title { get; init; }
    public required string Subtitle { get; init; }
    public required string TotalDistance { get; init; }
    public required string TotalDrives { get; init; }
    public required string DailyAvg { get; init; }
    public required string AnnualProjection { get; init; }
    public required string OdometerOverTime { get; init; }
    public required string Odometer { get; init; }
    public required string DailyDistance { get; init; }
    public required string Distance { get; init; }
    public required string MonthlySummary { get; init; }
    public required string Month { get; init; }
    public required string Drives { get; init; }
    public required string DistancePerDrive { get; init; }
    public required string NoEntries { get; init; }
    public required string LoadFailed { get; init; }
    public required string Retry { get; init; }

    /// <summary>Resolve every string the page renders through the i18n facade (web key names, verbatim).</summary>
    public static MileageStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new MileageStrings
        {
            Title = localizer.GetString("mileage.title", "Mileage"),
            Subtitle = localizer.GetString("mileage.subtitle", "Daily and monthly distance tracking"),
            TotalDistance = localizer.GetString("mileage.totalDistance", "Total Distance"),
            TotalDrives = localizer.GetString("mileage.totalDrives", "Total Drives"),
            DailyAvg = localizer.GetString("mileage.dailyAvg", "Daily Avg (30d)"),
            AnnualProjection = localizer.GetString("mileage.annualProjection", "Annual Projection"),
            OdometerOverTime = localizer.GetString("Odometer Over Time", "Odometer Over Time"),
            Odometer = localizer.GetString("Odometer", "Odometer"),
            DailyDistance = localizer.GetString("Daily Distance", "Daily Distance"),
            Distance = localizer.GetString("Distance", "Distance"),
            MonthlySummary = localizer.GetString("Monthly Summary", "Monthly Summary"),
            Month = localizer.GetString("Month", "Month"),
            Drives = localizer.GetString("Drives", "Drives"),
            DistancePerDrive = localizer.GetString("Distance per Drive", "Distance per Drive"),
            NoEntries = localizer.GetString("No Entries", "No Entries"),
            LoadFailed = localizer.GetString("error.loadFailed", "Failed to load data"),
            Retry = localizer.GetString("common.retry", "Retry"),
        };
    }
}

/// <summary>
/// Pure projection from a <see cref="MileageModel"/> to its <see cref="MileageDisplay"/> — the native port of
/// the render logic in web/src/features/analytics/pages/MileagePage.tsx and its <c>fromKm</c> / summary-metric /
/// <c>odometerData</c> / <c>dailyData</c> / <c>monthlyRows</c> helpers. The branch precedence mirrors the web
/// data lifecycle (loading → error → empty → success); the stats rollup feeds the four summary metric cards,
/// the daily buckets feed the odometer area chart and the daily-distance bar chart, and the monthly buckets feed
/// the monthly-summary table. Every label resolves through the i18n facade using the same keys the web page uses
/// and every distance is converted from the wire kilometres at this display boundary.
/// </summary>
public static class MileageProjection
{
    /// <summary>1 km = 1000 m — the wire payload is kilometres, the SI converters expect metres.</summary>
    private const double MetersPerKm = 1000.0;

    private const int IntegerPrecision = 0;
    private const int NumberPrecision = 2;

    /// <summary>The brand-cyan accent rail (web <c>color="cyan"</c>).</summary>
    private const string CyanBrush = "TsColorAccentBrush";

    /// <summary>The success-green accent rail (web <c>color="green"</c>).</summary>
    private const string GreenBrush = "TsColorSuccessBrush";

    /// <summary>The info accent rail — the nearest brand token to the web <c>color="purple"</c> (no purple token).</summary>
    private const string PurpleBrush = "TsColorInfoBrush";

    /// <summary>The brand palette index the web odometer area uses (recharts <c>palette[2]</c>).</summary>
    private const int OdometerColorIndex = 2;

    /// <summary>The brand palette index the web daily-distance bar uses (recharts <c>palette[0]</c>).</summary>
    private const int DailyColorIndex = 0;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the active units + localizer.</summary>
    /// <param name="model">The parsed three-source data plus the page lifecycle flags.</param>
    /// <param name="units">The user's unit-display preference (applied only at this boundary).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static MileageDisplay Project(MileageModel model, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var s = MileageStrings.Resolve(localizer);
        var snapshot = model.Snapshot;
        var stats = snapshot.Stats;

        MileageState state =
            model.Loading && !snapshot.HasData ? MileageState.Loading
            : model.ErrorDetail is not null ? MileageState.Error
            : !snapshot.HasData ? MileageState.Empty
            : MileageState.Success;

        string errorText = string.IsNullOrWhiteSpace(model.ErrorDetail)
            ? s.LoadFailed
            : $"{s.LoadFailed}: {model.ErrorDetail}";

        string unit = UnitLabels.Label(units.Distance);
        var cards = BuildMetricCards(stats, s, units, unit);
        var (odometer, daily) = BuildCharts(snapshot.Daily, s, units, unit);
        var (columns, rows) = BuildTable(snapshot.Monthly, s, units, unit);

        return new MileageDisplay(
            State: state,
            Title: s.Title,
            Subtitle: s.Subtitle,
            ShowLoading: state == MileageState.Loading,
            ShowError: state == MileageState.Error,
            ShowEmpty: state == MileageState.Empty,
            ShowContent: state == MileageState.Success,
            ErrorText: errorText,
            RetryLabel: s.Retry,
            EmptyMessage: s.NoEntries,
            MetricCards: cards,
            OdometerChart: odometer,
            DailyChart: daily,
            MonthlyTitle: s.MonthlySummary,
            TableColumns: columns,
            TableRows: rows,
            TableEmptyMessage: s.NoEntries,
            AutomationName: $"{s.Title}. {s.Subtitle}");
    }

    /// <summary>
    /// Build the four summary metric cards (web <c>MetricCard</c> grid). The daily average reflects recent
    /// activity (<c>last_30d_km / 30</c>) rather than a lifetime-flat average, and the annual projection scales
    /// that recent average across 365 days — exactly as the web page computes them.
    /// </summary>
    private static IReadOnlyList<MileageMetricCardDisplay> BuildMetricCards(
        MileageStats stats, MileageStrings s, UnitPref units, string unit)
    {
        double dailyAvgKm = stats.Last30dKm / 30.0;

        string totalDistance = $"{Number(FromKm(stats.LifetimeKm, units), IntegerPrecision)} {unit}";
        string totalDrives = Number(stats.DriveCountLifetime, IntegerPrecision);
        string dailyAvg = $"{Number(FromKm(dailyAvgKm, units), NumberPrecision)} {unit}";
        string annualProjection = $"{Number(FromKm(dailyAvgKm * 365.0, units), IntegerPrecision)} {unit}";

        return
        [
            new MileageMetricCardDisplay(s.TotalDistance, totalDistance, CyanBrush, $"{s.TotalDistance}: {totalDistance}"),
            new MileageMetricCardDisplay(s.TotalDrives, totalDrives, GreenBrush, $"{s.TotalDrives}: {totalDrives}"),
            new MileageMetricCardDisplay(s.DailyAvg, dailyAvg, PurpleBrush, $"{s.DailyAvg}: {dailyAvg}"),
            new MileageMetricCardDisplay(s.AnnualProjection, annualProjection, CyanBrush, $"{s.AnnualProjection}: {annualProjection}"),
        ];
    }

    /// <summary>
    /// Build the odometer-over-time area-chart points (web <c>odometerData</c>) and the daily-distance
    /// bar-chart points (web <c>dailyData</c>). The odometer line filters out days where every drive recorded a
    /// NULL final odometer so the line never dives to zero; both convert kilometres to the user's distance unit
    /// at this boundary and label each point with the web <c>formatDate</c> "MMM d, yyyy" day.
    /// </summary>
    private static (MileageChartDisplay Odometer, MileageChartDisplay Daily) BuildCharts(
        IReadOnlyList<MileageDailyBucket> buckets, MileageStrings s, UnitPref units, string unit)
    {
        var odometerPoints = new List<ChartPoint>(buckets.Count);
        var dailyPoints = new List<ChartPoint>(buckets.Count);

        for (int i = 0; i < buckets.Count; i++)
        {
            var bucket = buckets[i];
            string label = FormatDay(bucket.Date);
            dailyPoints.Add(new ChartPoint(dailyPoints.Count, FromKm(bucket.TotalKm, units), label));
            if (bucket.EndOdometerKm is { } odometerKm)
            {
                odometerPoints.Add(new ChartPoint(odometerPoints.Count, FromKm(odometerKm, units), label));
            }
        }

        var odometer = new MileageChartDisplay(
            HasData: odometerPoints.Count > 0,
            Title: s.OdometerOverTime,
            AriaLabel: $"{s.OdometerOverTime} ({unit})",
            EmptyMessage: s.NoEntries,
            SeriesName: $"{s.Odometer} ({unit})",
            ColorIndex: OdometerColorIndex,
            Points: odometerPoints);

        var daily = new MileageChartDisplay(
            HasData: dailyPoints.Count > 0,
            Title: s.DailyDistance,
            AriaLabel: $"{s.DailyDistance} ({unit})",
            EmptyMessage: s.NoEntries,
            SeriesName: $"{s.Distance} ({unit})",
            ColorIndex: DailyColorIndex,
            Points: dailyPoints);

        return (odometer, daily);
    }

    /// <summary>
    /// Build the monthly-summary table (web <c>monthlyRows</c> + <c>monthColumns</c>): one row per UTC calendar
    /// month with the month label, the converted distance, the drive count and the per-drive distance
    /// (<c>distance / drives</c>, or zero when the month has no drives). The numeric columns carry the active
    /// distance unit in their header exactly as the web table does.
    /// </summary>
    private static (IReadOnlyList<MileageColumnDisplay> Columns, IReadOnlyList<MileageMonthRowDisplay> Rows) BuildTable(
        IReadOnlyList<MileageMonthlyBucket> buckets, MileageStrings s, UnitPref units, string unit)
    {
        var columns = new[]
        {
            new MileageColumnDisplay("month", s.Month, false),
            new MileageColumnDisplay("distance", $"{s.Distance} ({unit})", true),
            new MileageColumnDisplay("drives", s.Drives, true),
            new MileageColumnDisplay("dailyAvg", $"{s.DistancePerDrive} ({unit})", true),
        };

        var rows = new List<MileageMonthRowDisplay>(buckets.Count);
        foreach (var bucket in buckets)
        {
            double perDriveKm = bucket.DriveCount > 0 ? bucket.TotalKm / bucket.DriveCount : 0;
            string month = bucket.YearMonth;
            string distance = Number(FromKm(bucket.TotalKm, units), NumberPrecision);
            string drives = Number(bucket.DriveCount, IntegerPrecision);
            string perDrive = Number(FromKm(perDriveKm, units), NumberPrecision);

            rows.Add(new MileageMonthRowDisplay(
                month,
                distance,
                drives,
                perDrive,
                $"{month}, {distance} {unit}, {drives} {s.Drives}, {perDrive} {unit}"));
        }

        return (columns, rows);
    }

    /// <summary>
    /// Convert a wire-kilometres distance to the user's display unit (web <c>fromKm</c>): scale to SI metres
    /// then through the shared SI converter so the metric/imperial split matches the web byte-for-byte.
    /// </summary>
    public static double FromKm(double km, UnitPref units) =>
        UnitConverters.DistanceFromSi(km * MetersPerKm, units.Distance);

    /// <summary>Format the web <c>formatDate</c> "MMM d, yyyy" day label from a <c>YYYY-MM-DD</c> string.</summary>
    public static string FormatDay(string? isoDate)
    {
        if (!string.IsNullOrWhiteSpace(isoDate)
            && DateTime.TryParseExact(isoDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day))
        {
            return day.ToString("MMM d, yyyy", CultureInfo.InvariantCulture);
        }

        return isoDate ?? string.Empty;
    }

    private static string Number(double value, int precision) => ScalarFormatters.FormatNumber(value, precision);
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Mileage page — every getter returns a nullable
/// rather than throwing so a partial or schema-drifted body never aborts the parse (web parity: the page
/// tolerates undefined fields). WinUI-free so the parse is unit-tested without a UI host. Reads the snake_case
/// wire shape (no camelCaseKeys transform on native) but also accepts the camelCase alias.
/// </summary>
internal static class MileageJson
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

    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a string.</summary>
    public static string? String(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object
            || !obj.TryGetProperty(name, out var prop)
            || prop.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return prop.GetString();
    }
}

/// <summary>
/// Canonical navigation + diagnostics metadata for the Mileage page — the native mirror of the web page at
/// web/src/features/analytics/pages/MileagePage.tsx (route <c>/mileage</c>, nav name <c>Mileage</c>). The page
/// reads the three mileage rollups the web <c>useMileageStats</c> / <c>useDailyMileage</c> /
/// <c>useMonthlyMileage</c> hooks read (generated operations <c>get_api_v1_mileage_stats</c> /
/// <c>get_api_v1_mileage_daily</c> / <c>get_api_v1_mileage_monthly</c>).
/// </summary>
public static class MileageRegistration
{
    /// <summary>The navigation route name the shell registers this page under (matches <c>RouteTable</c>).</summary>
    public const string RouteName = "Mileage";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "MileagePage";

    /// <summary>The generated operation id for the stats read (web <c>useMileageStats</c>).</summary>
    public const string StatsOperation = Operations.Mileage.Stats;

    /// <summary>The generated operation id for the daily-buckets read (web <c>useDailyMileage</c>).</summary>
    public const string DailyOperation = Operations.Mileage.Daily;

    /// <summary>The generated operation id for the monthly-buckets read (web <c>useMonthlyMileage</c>).</summary>
    public const string MonthlyOperation = Operations.Mileage.Monthly;

    /// <summary>Segoe Fluent — Speed/Gauge glyph for the page-level empty surface (web <c>Gauge</c>).</summary>
    public const string EmptyGlyph = "\uE9D9";

    /// <summary>The localized page title (web <c>t('mileage.title')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("mileage.title", "Mileage");
    }
}

/// <summary>
/// PII-safe diagnostics sink for the Mileage surface — records only the <c>view.opened</c> event with the
/// surface slug, never any vehicle data. Mirrors the sibling feature-view diagnostics.
/// </summary>
public sealed class MileageDiagnostics
{
    private readonly Action<string>? _sink;
    private int _viewsOpened;

    /// <summary>Creates the diagnostics sink over an optional line writer.</summary>
    public MileageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>The number of times the surface was opened.</summary>
    public int ViewsOpened => _viewsOpened;

    /// <summary>Record that the surface was opened (PII-safe).</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={MileageRegistration.Slug}");
    }
}
