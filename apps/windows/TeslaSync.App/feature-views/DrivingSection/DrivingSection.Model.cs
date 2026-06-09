using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.WeeklyDigest;

/// <summary>
/// The mutually-exclusive render branch of the <c>DrivingSection</c> surface — the native union of the
/// states the web component renders
/// (web/src/features/analytics/components/weekly-digest/DrivingSection.tsx). The web source is a pure
/// presentational section: it receives the already-computed <c>metrics</c> and <c>dailyDistanceData</c>
/// props and only reads <c>useTranslation</c>, so it performs no fetching. The parent
/// <c>WeeklyDigestPage</c> owns the query lifecycle (loading / error / empty / stale / offline) and only
/// renders the section once the week has resolved; the section itself therefore has no fetch-driven
/// error / stale / offline branch to reproduce. The branches below are a direct function of the input
/// <see cref="DrivingSectionModel"/>, and the within-section empties (no daily-distance data, no top
/// drive) are reproduced as visible empty surfaces rather than hidden ones.
/// </summary>
public enum DrivingSectionState
{
    /// <summary>The parent has not resolved the week's drives yet — skeleton chrome.</summary>
    Loading,

    /// <summary>
    /// The week resolved — the full section (the daily-distance bar chart or its empty surface, the
    /// four efficiency mini-stats, and the top-drive card or its empty surface).
    /// </summary>
    Ready,
}

/// <summary>
/// Which way the efficiency-change mini-stat trended — the native analogue of the web
/// <c>TrendingDown</c> / <c>TrendingUp</c> icon choice. Lower watt-hours per kilometre is better, so the
/// web shows a green <c>TrendingDown</c> when the current average is at or below the previous week's
/// (an improvement) and a red <c>TrendingUp</c> when it rose (a regression). <see cref="None"/> is used
/// by the mini-stats that carry no trend (average efficiency, total time, drives).
/// </summary>
public enum DrivingTrend
{
    /// <summary>No trend affordance (a plain stat).</summary>
    None,

    /// <summary>Improvement — efficiency held or fell (web green <c>TrendingDown</c>).</summary>
    Down,

    /// <summary>Regression — efficiency rose (web red <c>TrendingUp</c>).</summary>
    Up,
}

/// <summary>
/// One bar of the weekly daily-distance chart — the native mirror of a web <c>DailyDistanceEntry</c>
/// (<c>{ day: string; distance: number }</c> in
/// web/src/features/analytics/components/weekly-digest/types.ts). <see cref="Day"/> is the weekday tick
/// label; <see cref="Distance"/> is that day's distance in kilometres (the parent has already resolved
/// the value to kilometres — the section displays it verbatim, exactly as the web component does). Pure
/// data — no WinUI types.
/// </summary>
public sealed record DailyDistanceEntry(string Day, double Distance);

/// <summary>
/// The single top drive of the week — the native mirror of the subset of the web <c>Drive</c> the Top
/// Drive card reads (<c>start_date</c>, <c>distance</c>, <c>duration_min</c>, <c>efficiency_wh_km</c> in
/// web/src/features/analytics/components/weekly-digest/types.ts). Field names mirror the API's snake_case
/// JSON tags. <see cref="DistanceKm"/> is in kilometres and <see cref="EfficiencyWhKm"/> in watt-hours per
/// kilometre — the section displays both verbatim with hard-coded unit symbols, exactly as the web source
/// does (this presentational component reads no <c>useUnits</c>). Parsing is null-tolerant so a partial row
/// never throws. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="StartDate">The drive's ISO-8601 start timestamp (web <c>start_date</c>), formatted at the display boundary.</param>
/// <param name="DistanceKm">Distance travelled in kilometres (web <c>distance</c>).</param>
/// <param name="DurationMin">Drive duration in minutes (web <c>duration_min</c>).</param>
/// <param name="EfficiencyWhKm">Energy intensity in watt-hours per kilometre (web <c>efficiency_wh_km</c>).</param>
public sealed record DigestTopDrive(
    string StartDate,
    double DistanceKm,
    double DurationMin,
    double EfficiencyWhKm)
{
    /// <summary>
    /// Project a cached top-drive payload into a model, mirroring the web prop's <c>Drive | undefined</c>
    /// shape: a JSON <c>null</c> (or any non-object) maps to <see langword="null"/> (the empty card),
    /// otherwise the object is parsed tolerantly via <see cref="FromJson"/>.
    /// </summary>
    public static DigestTopDrive? ParseNullable(JsonElement element) =>
        element.ValueKind == JsonValueKind.Object ? FromJson(element) : null;

    /// <summary>Project a single top-drive JSON object into a tolerant model.</summary>
    public static DigestTopDrive FromJson(JsonElement obj) => new(
        JsonValues.GetString(obj, "start_date") ?? string.Empty,
        JsonValues.GetDouble(obj, "distance") ?? 0,
        JsonValues.GetDouble(obj, "duration_min") ?? 0,
        JsonValues.GetDouble(obj, "efficiency_wh_km") ?? 0);
}

/// <summary>
/// The render-time data model the <c>DrivingSection</c> view binds to — the native analogue of the slice
/// of the web <c>DrivingSectionProps</c> (<c>{ metrics, dailyDistanceData }</c> in
/// web/src/features/analytics/components/weekly-digest/DrivingSection.tsx) the section actually reads:
/// the average / previous-average efficiency, the total driving time, the drive count, the optional top
/// drive, and the daily-distance series. The section is presentational, so the model also carries the
/// parent's fetch flag (<see cref="Loading"/>) purely so the surface can render a skeleton before the
/// parent resolves the week. User-facing labels are resolved from the i18n facade by the projection, not
/// passed in. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Loading">True while the parent's weekly-digest fetch is still in flight (skeleton chrome).</param>
/// <param name="AvgEfficiency">The week's average efficiency in Wh/km (web <c>metrics.avgEfficiency</c>).</param>
/// <param name="PrevAvgEfficiency">The previous week's average efficiency in Wh/km (web <c>metrics.prevAvgEfficiency</c>).</param>
/// <param name="TotalDurationMinutes">Total driving time in minutes (web <c>metrics.totalDuration</c>).</param>
/// <param name="TotalDrives">The week's drive count (web <c>metrics.totalDrives</c>).</param>
/// <param name="TopDrive">The week's standout drive, or null for the empty card (web <c>metrics.topDrive</c>).</param>
/// <param name="DailyDistance">The per-day distance series for the bar chart (web <c>dailyDistanceData</c>).</param>
public sealed record DrivingSectionModel(
    bool Loading,
    double AvgEfficiency,
    double PrevAvgEfficiency,
    double TotalDurationMinutes,
    long TotalDrives,
    DigestTopDrive? TopDrive,
    IReadOnlyList<DailyDistanceEntry> DailyDistance)
{
    /// <summary>The initial model: the parent's weekly-digest fetch is still in flight.</summary>
    public static DrivingSectionModel Pending { get; } =
        new(true, 0, 0, 0, 0, null, Array.Empty<DailyDistanceEntry>());

    /// <summary>A resolved model with no driving activity — both within-section empties show.</summary>
    public static DrivingSectionModel Empty { get; } =
        new(false, 0, 0, 0, 0, null, Array.Empty<DailyDistanceEntry>());

    /// <summary>
    /// Parse a cached weekly-digest payload into a model, mirroring the web <c>DrivingSectionProps</c>:
    /// a <c>metrics</c> object (camelCase, the client-computed digest) holding the efficiency / duration /
    /// drive-count fields plus a nullable snake_case <c>topDrive</c>, and a <c>dailyDistanceData</c> array
    /// of <c>{ day, distance }</c> rows. Tolerant of missing fields and shapes so a partial cache entry
    /// projects to a usable (possibly empty) section rather than throwing.
    /// </summary>
    /// <param name="root">The cached digest payload (the section's resolved props).</param>
    /// <param name="loading">Whether the parent fetch is still in flight (defaults to resolved).</param>
    public static DrivingSectionModel FromJson(JsonElement root, bool loading = false)
    {
        JsonElement metrics = root.ValueKind == JsonValueKind.Object
            && root.TryGetProperty("metrics", out var m) && m.ValueKind == JsonValueKind.Object
                ? m
                : root;

        DigestTopDrive? topDrive = null;
        if (metrics.ValueKind == JsonValueKind.Object && metrics.TryGetProperty("topDrive", out var td))
        {
            topDrive = DigestTopDrive.ParseNullable(td);
        }

        return new DrivingSectionModel(
            Loading: loading,
            AvgEfficiency: JsonValues.GetDouble(metrics, "avgEfficiency") ?? 0,
            PrevAvgEfficiency: JsonValues.GetDouble(metrics, "prevAvgEfficiency") ?? 0,
            TotalDurationMinutes: JsonValues.GetDouble(metrics, "totalDuration") ?? 0,
            TotalDrives: JsonValues.GetLong(metrics, "totalDrives"),
            TopDrive: topDrive,
            DailyDistance: ParseDailyDistance(root));
    }

    private static IReadOnlyList<DailyDistanceEntry> ParseDailyDistance(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object
            || !root.TryGetProperty("dailyDistanceData", out var arr)
            || arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<DailyDistanceEntry>();
        }

        var entries = new List<DailyDistanceEntry>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            entries.Add(new DailyDistanceEntry(
                JsonValues.GetString(item, "day") ?? string.Empty,
                JsonValues.GetDouble(item, "distance") ?? 0));
        }

        return entries;
    }
}

/// <summary>
/// One projected, render-ready efficiency mini-stat — the native analogue of a web <c>MiniStat</c> tile
/// (web/src/features/analytics/components/weekly-digest/MiniStat.tsx). <see cref="Label"/> and
/// <see cref="Value"/> are the resolved caption and formatted value, <see cref="Glyph"/> is the Segoe
/// Fluent icon standing in for the web Lucide icon, <see cref="Trend"/> drives the efficiency-change
/// tile's coloured trend glyph (<see cref="DrivingTrend.None"/> for the others), and
/// <see cref="AutomationName"/> is the spoken "{label}: {value}". Pure data.
/// </summary>
public sealed record DrivingMiniStat(
    string Label,
    string Value,
    string Glyph,
    DrivingTrend Trend,
    string AutomationName);

/// <summary>
/// One projected, render-ready bar of the daily-distance chart — the native analogue of a single recharts
/// <c>&lt;Bar&gt;</c> datum. <see cref="DayLabel"/> is the weekday tick; <see cref="Distance"/> /
/// <see cref="DistanceText"/> is the raw + one-decimal kilometre value; <see cref="HeightRatio"/> is the
/// bar height as a fraction (0..1) of the busiest day; and <see cref="AutomationName"/> is the spoken
/// "{day}, {n} km" the visual bar conveys. Pure data.
/// </summary>
public sealed record DrivingDailyBar(
    string DayLabel,
    double Distance,
    string DistanceText,
    double HeightRatio,
    string AutomationName);

/// <summary>
/// A declarative table column descriptor (key + localized header) — the native, WinUI-free analogue of the
/// accessible Day / Distance fallback table the native bar chart exposes for the recharts bar chart (which
/// has no screen-reader-navigable tabular form on the web). The view maps each one onto a
/// <c>TsDataColumn</c>; rows address their cells by the same <see cref="Key"/>.
/// </summary>
public sealed record DrivingSectionColumn(string Key, string Header);

/// <summary>
/// A single projected, display-ready table row — the cell values keyed by column key, a stable
/// <see cref="RowKey"/>, and a Narrator automation name. Mirrors one day of the bar chart. Pure data.
/// </summary>
public sealed record DrivingSectionRow(
    string RowKey,
    IReadOnlyDictionary<string, string> Cells,
    string AutomationName);

/// <summary>
/// One field of the Top Drive card — the native analogue of a labelled stat in the web top-drive grid
/// (date, distance, duration, efficiency). <see cref="Label"/> is the resolved caption and
/// <see cref="Value"/> the formatted, unit-suffixed value. Pure data.
/// </summary>
public sealed record DrivingTopDriveField(string Label, string Value);

/// <summary>
/// The fully projected, render-ready view of the section for one input model — the native analogue of what
/// the web <c>DrivingSection</c> returns. Holds the resolved title, the daily-distance chart (the
/// <see cref="Bars"/> plus the accessible <see cref="Columns"/> / <see cref="Rows"/> table and its caption,
/// or the no-data empty surface), the four mini-stats, the top-drive card (badge + fields, or its no-data
/// empty surface), and the per-state Narrator names. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record DrivingSectionDisplay(
    DrivingSectionState State,
    string Title,
    string DailyDistanceLabel,
    bool HasDailyDistance,
    IReadOnlyList<DrivingDailyBar> Bars,
    IReadOnlyList<DrivingSectionColumn> Columns,
    IReadOnlyList<DrivingSectionRow> Rows,
    string ChartAriaLabel,
    string ChartTableLabel,
    string NoDailyDistanceMessage,
    IReadOnlyList<DrivingMiniStat> Stats,
    bool HasTopDrive,
    string TopDriveBadge,
    IReadOnlyList<DrivingTopDriveField> TopDriveFields,
    string NoTopDriveMessage,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="DrivingSectionModel"/> to its <see cref="DrivingSectionDisplay"/> —
/// the native port of web/src/features/analytics/components/weekly-digest/DrivingSection.tsx. The branch
/// precedence mirrors the web data flow (the parent shows loading first, then the resolved section). Values
/// render through <see cref="NumberFormatting"/> exactly as the web <c>fmtNumber</c> / <c>fmtInt</c> do:
/// efficiencies and distances with one decimal, the percentage change with one decimal, drive counts and
/// the hour/minute split as grouped integers. The percentage change reproduces the web <c>pctChange</c>
/// helper, the trend glyph reproduces the web <c>avgEfficiency &lt;= prevAvgEfficiency</c> test, and the
/// top-drive date renders through the shared <see cref="DateTimeFormatting"/> (the web <c>formatDate</c>).
/// Every label resolves through the i18n facade using the keys the web source feeds <c>useTranslation</c>.
/// No WinUI types — unit-tested without a UI host.
/// </summary>
public static class DrivingSectionProjection
{
    /// <summary>Column key for the day column of the accessible fallback table.</summary>
    public const string DayKey = "day";

    /// <summary>Column key for the distance column of the accessible fallback table.</summary>
    public const string DistanceKey = "distance";

    /// <summary>Kilometre unit symbol (web hard-coded <c>km</c>) — a unit symbol, not translatable prose.</summary>
    public const string KmUnit = "km";

    /// <summary>Watt-hours-per-kilometre unit symbol (web hard-coded <c>Wh/km</c>).</summary>
    public const string EfficiencyUnit = "Wh/km";

    /// <summary>Minutes unit symbol (web hard-coded <c>min</c>).</summary>
    public const string MinUnit = "min";

    private const string EmDash = "\u2014";
    private const double MinutesPerHour = 60.0;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the slice of the web props the section reads).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The clock used to format the top-drive date (display boundary); defaults to now.</param>
    public static DrivingSectionDisplay Project(
        DrivingSectionModel model,
        ILocalizer localizer,
        DateTimeOffset? now = null)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        DateTimeOffset resolvedNow = now ?? DateTimeOffset.Now;

        string title = localizer.GetString("analytics.weeklyDigest.drivingSection", "Driving");
        string dailyDistanceLabel = localizer.GetString("analytics.weeklyDigest.dailyDistance", "Daily Distance (km)");
        string noDailyDistance = localizer.GetString(
            "analytics.weeklyDigest.noDailyDistance",
            "No driving distance data is available for this week.");
        string chartAriaLabel = $"{dailyDistanceLabel}.";
        string tableLabel = string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString("chart.a11y.fallbackTableLabel", "{0} \u2014 data table"),
            dailyDistanceLabel);

        IReadOnlyList<DrivingDailyBar> bars = BuildBars(model.DailyDistance);
        IReadOnlyList<DrivingSectionColumn> columns = BuildColumns(localizer);
        IReadOnlyList<DrivingSectionRow> rows = BuildRows(bars);
        IReadOnlyList<DrivingMiniStat> stats = BuildStats(model, localizer);

        bool hasTopDrive = model.TopDrive is not null;
        string topDriveBadge = localizer.GetString("analytics.weeklyDigest.topDrive", "Top Drive");
        IReadOnlyList<DrivingTopDriveField> topDriveFields =
            hasTopDrive ? BuildTopDriveFields(model.TopDrive!, localizer, resolvedNow) : Array.Empty<DrivingTopDriveField>();
        string noTopDrive = localizer.GetString(
            "analytics.weeklyDigest.noTopDrive",
            "No top drive is available for this week yet.");

        DrivingSectionState state = model.Loading ? DrivingSectionState.Loading : DrivingSectionState.Ready;

        return new DrivingSectionDisplay(
            State: state,
            Title: title,
            DailyDistanceLabel: dailyDistanceLabel,
            HasDailyDistance: bars.Count > 0,
            Bars: bars,
            Columns: columns,
            Rows: rows,
            ChartAriaLabel: chartAriaLabel,
            ChartTableLabel: tableLabel,
            NoDailyDistanceMessage: noDailyDistance,
            Stats: stats,
            HasTopDrive: hasTopDrive,
            TopDriveBadge: topDriveBadge,
            TopDriveFields: topDriveFields,
            NoTopDriveMessage: noTopDrive,
            AutomationName: state == DrivingSectionState.Loading
                ? localizer.GetString("common.loading", "Loading")
                : title);
    }

    /// <summary>
    /// The web <c>pctChange(current, previous)</c> helper
    /// (web/src/features/analytics/components/weekly-digest/helpers.ts): when the previous value is zero the
    /// change is 100% if the current value is positive, otherwise 0%; otherwise it is the signed percentage
    /// difference relative to the magnitude of the previous value.
    /// </summary>
    public static double PercentChange(double current, double previous)
    {
        if (previous == 0)
        {
            return current > 0 ? 100 : 0;
        }

        return (current - previous) / Math.Abs(previous) * 100;
    }

    private static IReadOnlyList<DrivingMiniStat> BuildStats(DrivingSectionModel model, ILocalizer localizer)
    {
        string avgEfficiencyValue = string.Concat(NumberFormatting.Format(model.AvgEfficiency, null, 1), " ", EfficiencyUnit);

        long hours = (long)Math.Floor(model.TotalDurationMinutes / MinutesPerHour);
        double minutes = model.TotalDurationMinutes % MinutesPerHour;
        string totalTimeValue = string.Concat(
            NumberFormatting.Format(hours, null, 0), "h ",
            NumberFormatting.Format(minutes, null, 0), "m");

        // Web parity: only show the percentage when there is a previous baseline to compare against.
        string efficiencyChangeValue = model.PrevAvgEfficiency > 0
            ? string.Concat(NumberFormatting.Format(PercentChange(model.AvgEfficiency, model.PrevAvgEfficiency), null, 1), "%")
            : EmDash;

        // Web parity: lower Wh/km is better → a held-or-fallen average is an improvement (green TrendingDown).
        DrivingTrend efficiencyTrend = model.AvgEfficiency <= model.PrevAvgEfficiency ? DrivingTrend.Down : DrivingTrend.Up;

        string drivesValue = NumberFormatting.Format(model.TotalDrives, null, 0);

        return
        [
            MiniStat(localizer, "analytics.weeklyDigest.avgEfficiency", "Avg Efficiency", avgEfficiencyValue, DrivingSectionRegistration.AvgEfficiencyGlyph, DrivingTrend.None),
            MiniStat(localizer, "analytics.weeklyDigest.totalDrivingTime", "Total Driving Time", totalTimeValue, DrivingSectionRegistration.ClockGlyph, DrivingTrend.None),
            MiniStat(
                localizer,
                "analytics.weeklyDigest.efficiencyChange",
                "Efficiency Change",
                efficiencyChangeValue,
                efficiencyTrend == DrivingTrend.Down ? DrivingSectionRegistration.TrendingDownGlyph : DrivingSectionRegistration.TrendingUpGlyph,
                efficiencyTrend),
            MiniStat(localizer, "analytics.weeklyDigest.drivesCount", "Drives", drivesValue, DrivingSectionRegistration.DrivesGlyph, DrivingTrend.None),
        ];
    }

    private static DrivingMiniStat MiniStat(
        ILocalizer localizer,
        string key,
        string fallback,
        string value,
        string glyph,
        DrivingTrend trend)
    {
        string label = localizer.GetString(key, fallback);
        return new DrivingMiniStat(label, value, glyph, trend, string.Concat(label, ": ", value));
    }

    private static IReadOnlyList<DrivingDailyBar> BuildBars(IReadOnlyList<DailyDistanceEntry> entries)
    {
        if (entries.Count == 0)
        {
            return Array.Empty<DrivingDailyBar>();
        }

        double max = 0;
        foreach (var entry in entries)
        {
            double value = SafeNumber(entry.Distance);
            if (value > max)
            {
                max = value;
            }
        }

        var bars = new List<DrivingDailyBar>(entries.Count);
        foreach (var entry in entries)
        {
            double value = SafeNumber(entry.Distance);
            string distanceText = NumberFormatting.Format(value, null, 1);
            double ratio = max > 0 ? Math.Clamp(value / max, 0.0, 1.0) : 0.0;

            bars.Add(new DrivingDailyBar(
                DayLabel: entry.Day,
                Distance: value,
                DistanceText: distanceText,
                HeightRatio: ratio,
                AutomationName: $"{entry.Day}, {distanceText} {KmUnit}"));
        }

        return bars;
    }

    private static IReadOnlyList<DrivingSectionColumn> BuildColumns(ILocalizer localizer) =>
    [
        new DrivingSectionColumn(DayKey, localizer.GetString("analytics.weeklyDigest.date", "Date")),
        new DrivingSectionColumn(DistanceKey, localizer.GetString("analytics.weeklyDigest.distance", "Distance")),
    ];

    private static IReadOnlyList<DrivingSectionRow> BuildRows(IReadOnlyList<DrivingDailyBar> bars)
    {
        if (bars.Count == 0)
        {
            return Array.Empty<DrivingSectionRow>();
        }

        var rows = new List<DrivingSectionRow>(bars.Count);
        for (int i = 0; i < bars.Count; i++)
        {
            var bar = bars[i];
            var cells = new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [DayKey] = bar.DayLabel,
                [DistanceKey] = string.Concat(bar.DistanceText, " ", KmUnit),
            };

            rows.Add(new DrivingSectionRow(
                RowKey: string.Create(CultureInfo.InvariantCulture, $"row-{i}"),
                Cells: cells,
                AutomationName: $"{bar.DayLabel}. {bar.DistanceText} {KmUnit}"));
        }

        return rows;
    }

    private static IReadOnlyList<DrivingTopDriveField> BuildTopDriveFields(
        DigestTopDrive drive,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        return
        [
            new DrivingTopDriveField(
                localizer.GetString("analytics.weeklyDigest.date", "Date"),
                FormatDate(drive.StartDate, now)),
            new DrivingTopDriveField(
                localizer.GetString("analytics.weeklyDigest.distance", "Distance"),
                string.Concat(NumberFormatting.Format(SafeNumber(drive.DistanceKm), null, 1), " ", KmUnit)),
            new DrivingTopDriveField(
                localizer.GetString("analytics.weeklyDigest.duration", "Duration"),
                string.Concat(NumberFormatting.Format(SafeNumber(drive.DurationMin), null, 0), " ", MinUnit)),
            new DrivingTopDriveField(
                localizer.GetString("analytics.weeklyDigest.efficiency", "Efficiency"),
                string.Concat(NumberFormatting.Format(SafeNumber(drive.EfficiencyWhKm), null, 1), " ", EfficiencyUnit)),
        ];
    }

    // Web parity: formatDate(start_date) renders "MMM d, yyyy" in the user's locale, or the em-dash for an
    // empty / unparseable timestamp. DateTimeFormatting.Format(Date) is the shared 1:1 port of that helper.
    private static string FormatDate(string isoTimestamp, DateTimeOffset now)
    {
        if (string.IsNullOrWhiteSpace(isoTimestamp))
        {
            return EmDash;
        }

        if (!DateTimeOffset.TryParse(
                isoTimestamp,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AllowWhiteSpaces,
                out var parsed))
        {
            return EmDash;
        }

        return DateTimeFormatting.Format(parsed, DateTimeVariant.Date, now);
    }

    // Web parity: safeNumber() — a non-finite value contributes 0 rather than NaN/Infinity to the display.
    private static double SafeNumber(double value) =>
        double.IsNaN(value) || double.IsInfinity(value) ? 0 : value;
}

/// <summary>
/// Tolerant JSON readers shared by the <c>DrivingSection</c> parse adapters — the same null-safe coercion
/// the sibling feature-view models use so a partial cache row never throws. UI-free so the adapters are
/// unit-tested without a XAML runtime.
/// </summary>
internal static class JsonValues
{
    public static long GetLong(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return 0;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.Number when v.TryGetDouble(out var d) && !double.IsNaN(d) && !double.IsInfinity(d) => (long)d,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => 0,
        };
    }

    public static double? GetDouble(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    public static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;
}

/// <summary>
/// Canonical metadata for the <c>DrivingSection</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/analytics/components/weekly-digest/DrivingSection.tsx</c> — plus the
/// Segoe Fluent Icons glyphs that stand in for the web Lucide icons (Car, BarChart3, Clock, TrendingDown,
/// TrendingUp, Activity). UI-free so the metadata is asserted in tests.
/// </summary>
public static class DrivingSectionRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "DrivingSection";

    /// <summary>Segoe Fluent "Car" glyph for the section title (web <c>Car</c>).</summary>
    public const string CarGlyph = "\uE804";

    /// <summary>Segoe Fluent chart glyph for the average-efficiency stat (web <c>BarChart3</c>).</summary>
    public const string AvgEfficiencyGlyph = "\uE9D9";

    /// <summary>Segoe Fluent "Recent" glyph for the total-driving-time stat (web <c>Clock</c>).</summary>
    public const string ClockGlyph = "\uE823";

    /// <summary>Segoe Fluent chevron-down glyph for an improving efficiency change (web green <c>TrendingDown</c>).</summary>
    public const string TrendingDownGlyph = "\uE70D";

    /// <summary>Segoe Fluent chevron-up glyph for a worsening efficiency change (web red <c>TrendingUp</c>).</summary>
    public const string TrendingUpGlyph = "\uE70E";

    /// <summary>Segoe Fluent pulse glyph for the drives-count stat (web <c>Activity</c>).</summary>
    public const string DrivesGlyph = "\uE950";
}

/// <summary>
/// PII-safe diagnostics for the <c>DrivingSection</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a distance, efficiency, drive
/// count or date — so a diagnostics line can never leak how much the owner drove. Thread-safe.
/// </summary>
public sealed class DrivingSectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DrivingSectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DrivingSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DrivingSectionRegistration.Slug}");
    }
}
