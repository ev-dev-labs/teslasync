using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// One parked-session drain row from <c>GET /vampire-drain/stats</c>'s <c>entries</c> array (web
/// <c>VampireDrainEntry</c> in web/src/features/battery/pages/VampireDrainPage.tsx), narrowed to the fields the
/// sessions table and the drain-rate trend line read. Battery levels and drain are dimensionless percentages,
/// duration is hours and the lost energy is the kWh value the web contract already supplies; every value is
/// read exactly as the wire shape provides it. Parsing is null-tolerant so a partial or schema-drifted row
/// never throws (web parity: the page tolerates undefined fields with <c>?? 0</c>). Pure data — no WinUI types.
/// </summary>
public sealed record VampireSessionEntry(
    long Id,
    DateTimeOffset? Date,
    double StartBattery,
    double EndBattery,
    double DrainPct,
    double DrainRatePctHr,
    double DurationHours,
    double EnergyLostKwh,
    bool SentryActive)
{
    /// <summary>Project a single entry JSON object into a tolerant session record.</summary>
    public static VampireSessionEntry FromJson(JsonElement element) => new(
        Id: VampireJson.Long(element, "id") ?? 0,
        Date: VampireJson.Instant(element, "date"),
        StartBattery: VampireJson.Double(element, "start_battery") ?? VampireJson.Double(element, "startBattery") ?? 0,
        EndBattery: VampireJson.Double(element, "end_battery") ?? VampireJson.Double(element, "endBattery") ?? 0,
        DrainPct: VampireJson.Double(element, "drain_pct") ?? VampireJson.Double(element, "drainPct") ?? 0,
        DrainRatePctHr: VampireJson.Double(element, "drain_rate_pct_hr") ?? VampireJson.Double(element, "drainRatePctHr") ?? 0,
        DurationHours: VampireJson.Double(element, "duration_hours") ?? VampireJson.Double(element, "durationHours") ?? 0,
        EnergyLostKwh: VampireJson.Double(element, "energy_lost_kwh") ?? VampireJson.Double(element, "energyLostKwh") ?? 0,
        SentryActive: VampireJson.Bool(element, "sentry_active") ?? VampireJson.Bool(element, "sentryActive") ?? false);
}

/// <summary>
/// One day's parked-drain bucket from <c>GET /vampire-drain/stats</c>'s <c>daily</c> array (web
/// <c>data.daily</c> item), narrowed to the fields the daily-drain bar chart reads: the percent drained and the
/// hours parked. Both are dimensionless / hours exactly as the wire shape provides them. Pure data.
/// </summary>
public sealed record VampireDailyDrainPoint(DateTimeOffset? Date, double DrainPct, double HoursParked)
{
    /// <summary>Project a single daily-bucket JSON object into a tolerant point.</summary>
    public static VampireDailyDrainPoint FromJson(JsonElement element) => new(
        Date: VampireJson.Instant(element, "date"),
        DrainPct: VampireJson.Double(element, "drain_pct") ?? VampireJson.Double(element, "drainPct") ?? 0,
        HoursParked: VampireJson.Double(element, "hours_parked") ?? VampireJson.Double(element, "hoursParked") ?? 0);
}

/// <summary>
/// The phantom-drain rollup from <c>GET /vampire-drain/stats?vehicle_id=...</c> (web <c>VampireDrainStats</c>),
/// narrowed to every field the page renders: the four summary scalars (average drain rate, total phantom loss,
/// worst single session and the 0–100 drain score) plus the nested session and daily-bucket arrays that feed
/// the trend line, the daily bar chart and the sessions table. Parsing is null-tolerant — a non-object body
/// composes to "no data" and any missing scalar reads as zero (web parity: the page reads <c>data?.field</c>
/// which <c>fmtNumber</c> renders as <c>0</c>). Pure data — no WinUI types.
/// </summary>
public sealed record VampireDrainStats(
    double AvgDrainRate,
    double TotalEnergyLost,
    double WorstDrainPct,
    double DrainScore,
    IReadOnlyList<VampireSessionEntry> Entries,
    IReadOnlyList<VampireDailyDrainPoint> Daily)
{
    /// <summary>Project the stats JSON object into a tolerant rollup (non-object → null = the empty surface).</summary>
    public static VampireDrainStats? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new VampireDrainStats(
            AvgDrainRate: VampireJson.Double(element, "avg_drain_rate") ?? VampireJson.Double(element, "avgDrainRate") ?? 0,
            TotalEnergyLost: VampireJson.Double(element, "total_energy_lost") ?? VampireJson.Double(element, "totalEnergyLost") ?? 0,
            WorstDrainPct: VampireJson.Double(element, "worst_drain_pct") ?? VampireJson.Double(element, "worstDrainPct") ?? 0,
            DrainScore: VampireJson.Double(element, "drain_score") ?? VampireJson.Double(element, "drainScore") ?? 0,
            Entries: ParseEntries(element),
            Daily: ParseDaily(element));
    }

    private static IReadOnlyList<VampireSessionEntry> ParseEntries(JsonElement obj)
    {
        if (!VampireJson.TryArray(obj, "entries", out var array))
        {
            return Array.Empty<VampireSessionEntry>();
        }

        var list = new List<VampireSessionEntry>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(VampireSessionEntry.FromJson(item));
            }
        }

        return list;
    }

    private static IReadOnlyList<VampireDailyDrainPoint> ParseDaily(JsonElement obj)
    {
        if (!VampireJson.TryArray(obj, "daily", out var array))
        {
            return Array.Empty<VampireDailyDrainPoint>();
        }

        var list = new List<VampireDailyDrainPoint>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(VampireDailyDrainPoint.FromJson(item));
            }
        }

        return list;
    }
}

/// <summary>
/// The single-source snapshot the page binds to: the phantom-drain rollup whose presence drives the
/// success/empty state, exactly as the web page gates on <c>data ?</c>. Mirrors the web page handing the one
/// query result to its render body. Pure data.
/// </summary>
public sealed record VampireDrainSnapshot(bool HasData, VampireDrainStats Stats)
{
    /// <summary>The zero rollup used as the empty / fallback backing value.</summary>
    public static VampireDrainStats EmptyStats { get; } = new(
        0, 0, 0, 0, Array.Empty<VampireSessionEntry>(), Array.Empty<VampireDailyDrainPoint>());

    /// <summary>The empty snapshot (no stats object) — the page-level empty surface, never a blank page.</summary>
    public static VampireDrainSnapshot Empty { get; } = new(false, EmptyStats);

    /// <summary>Compose a snapshot from the parsed stats rollup (null → the empty surface).</summary>
    public static VampireDrainSnapshot Compose(VampireDrainStats? stats) =>
        stats is { } s ? new VampireDrainSnapshot(true, s) : VampireDrainSnapshot.Empty;
}

/// <summary>The single-source data port the page binds to (the native P1/S8 seam). The view never performs HTTP.</summary>
public interface IVampireDrainFeed
{
    /// <summary>Fetch the phantom-drain rollup for the active vehicle.</summary>
    Task<VampireDrainSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed used by the shell registration: always resolves to the empty surface.</summary>
public sealed class EmptyVampireDrainFeed : IVampireDrainFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyVampireDrainFeed Instance { get; } = new();

    private EmptyVampireDrainFeed()
    {
    }

    /// <inheritdoc />
    public Task<VampireDrainSnapshot> FetchAsync(CancellationToken cancellationToken) =>
        Task.FromResult(VampireDrainSnapshot.Empty);
}

/// <summary>The mutually-exclusive top-level data state the page renders (web loading / empty / error / success).</summary>
public enum VampireDrainPageState
{
    /// <summary>The stats query is in flight with no data yet — the loading shimmer.</summary>
    Loading,

    /// <summary>Resolved with no stats object — the friendly empty surface, never a blank page.</summary>
    Empty,

    /// <summary>The stats query failed — the retriable error surface.</summary>
    Error,

    /// <summary>The stats rollup resolved — the full page content.</summary>
    Success,
}

/// <summary>A summary metric tile (web <c>MetricCard</c>). Pre-formatted value + glyph + label.</summary>
public sealed record VampireMetricCardDisplay(string Glyph, string Value, string Label, string AutomationName);

/// <summary>A typed chart series projected for one cartesian surface (WinUI-free).</summary>
public sealed record VampireSeriesDisplay(
    string Name,
    ChartSeriesKind Kind,
    ChartRole Role,
    int ColorIndex,
    IReadOnlyList<ChartPoint> Points);

/// <summary>One cartesian chart projection (web <c>ChartContainer</c> + recharts surface).</summary>
public sealed record VampireChartDisplay(
    bool Visible,
    string Title,
    string AriaLabel,
    IReadOnlyList<VampireSeriesDisplay> Series);

/// <summary>A single drain-sessions table row (web per-entry list item).</summary>
public sealed record VampireSessionRowDisplay(
    string Id,
    string Date,
    string Duration,
    string StartPct,
    string EndPct,
    string LossPct,
    string Rate,
    string Sentry,
    string AutomationName);

/// <summary>One recommendation in the tips panel (web <c>tips</c> entry: glyph + text).</summary>
public sealed record VampireTipDisplay(string Glyph, string Text);

/// <summary>
/// The fully-resolved render model the WinUI view binds to — every branch, format and string the web
/// <c>VampireDrainPage</c> computes, resolved once so the view is a thin renderer. Pure data — no WinUI types —
/// so the whole projection is unit-tested without a UI host.
/// </summary>
public sealed record VampireDrainDisplay(
    VampireDrainPageState State,
    string Title,
    string Subtitle,
    string AutomationName,
    bool ShowLoading,
    bool ShowError,
    bool ShowEmpty,
    bool ShowContent,
    string ErrorText,
    string RetryLabel,
    string EmptyMessage,
    IReadOnlyList<VampireMetricCardDisplay> MetricCards,
    double GaugeValue,
    double GaugeMax,
    string GaugeLabel,
    string GaugeUnit,
    VampireChartDisplay TrendChart,
    VampireChartDisplay DailyChart,
    string SessionsTitle,
    string SessionsCountLabel,
    IReadOnlyList<string> TableColumns,
    IReadOnlyList<VampireSessionRowDisplay> TableRows,
    string TableEmptyMessage,
    string TipsTitle,
    IReadOnlyList<VampireTipDisplay> Tips);

/// <summary>
/// The render-time input the projection consumes — the parsed <see cref="Snapshot"/> plus the page lifecycle
/// (the stats query's <see cref="Loading"/> / <see cref="ErrorDetail"/>). The view-model fills this in; tests
/// construct it directly. Pure data — no WinUI types.
/// </summary>
public sealed record VampireDrainPageModel(VampireDrainSnapshot Snapshot, bool Loading, string? ErrorDetail)
{
    /// <summary>The initial model: the stats query is in flight with no data yet.</summary>
    public static VampireDrainPageModel Initial { get; } = new(VampireDrainSnapshot.Empty, true, null);
}

/// <summary>
/// The fully-resolved set of localized strings the page renders — every key the web <c>VampireDrainPage</c>
/// feeds into <c>t(...)</c>, resolved once through the i18n facade so the projection stays readable and the
/// string-coverage test asserts all of them in one pass. The web uses each visible English string as its own
/// i18n key, plus the dotted <c>vampire.title</c> document-title key; both are preserved verbatim.
/// </summary>
public sealed record VampireStrings
{
    public required string Title { get; init; }
    public required string DocumentTitle { get; init; }
    public required string Subtitle { get; init; }
    public required string AvgDrainRate { get; init; }
    public required string TotalPhantomLoss { get; init; }
    public required string WorstSession { get; init; }
    public required string DrainScore { get; init; }
    public required string Score { get; init; }
    public required string DrainRateTrend { get; init; }
    public required string DrainRate { get; init; }
    public required string DailyDrain { get; init; }
    public required string DrainPctSeries { get; init; }
    public required string ParkedHours { get; init; }
    public required string DrainSessions { get; init; }
    public required string Sessions { get; init; }
    public required string Date { get; init; }
    public required string Duration { get; init; }
    public required string StartPct { get; init; }
    public required string EndPct { get; init; }
    public required string LossPct { get; init; }
    public required string Rate { get; init; }
    public required string Sentry { get; init; }
    public required string On { get; init; }
    public required string Off { get; init; }
    public required string NoSessions { get; init; }
    public required string TipsTitle { get; init; }
    public required string TipSentry { get; init; }
    public required string TipPolling { get; init; }
    public required string TipOpen { get; init; }
    public required string TipEnergy { get; init; }
    public required string ErrorTitle { get; init; }
    public required string Retry { get; init; }

    /// <summary>Resolve every string the page renders through the i18n facade (web key names, verbatim).</summary>
    public static VampireStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new VampireStrings
        {
            Title = localizer.GetString("Vampire Drain", "Vampire Drain"),
            DocumentTitle = localizer.GetString("vampire.title", "Vampire Drain"),
            Subtitle = localizer.GetString(
                "Analyze phantom energy loss while your vehicle is parked",
                "Analyze phantom energy loss while your vehicle is parked"),
            AvgDrainRate = localizer.GetString("Avg Drain Rate", "Avg Drain Rate"),
            TotalPhantomLoss = localizer.GetString("Total Phantom Loss", "Total Phantom Loss"),
            WorstSession = localizer.GetString("Worst Session", "Worst Session"),
            DrainScore = localizer.GetString("Drain Score", "Drain Score"),
            Score = localizer.GetString("Score", "Score"),
            DrainRateTrend = localizer.GetString("Drain Rate Trend", "Drain Rate Trend"),
            DrainRate = localizer.GetString("Drain Rate", "Drain Rate"),
            DailyDrain = localizer.GetString("Daily Drain While Parked", "Daily Drain While Parked"),
            DrainPctSeries = localizer.GetString("Drain %", "Drain %"),
            ParkedHours = localizer.GetString("Parked Hours", "Parked Hours"),
            DrainSessions = localizer.GetString("Drain Sessions", "Drain Sessions"),
            Sessions = localizer.GetString("sessions", "sessions"),
            Date = localizer.GetString("Date", "Date"),
            Duration = localizer.GetString("Duration", "Duration"),
            StartPct = localizer.GetString("Start %", "Start %"),
            EndPct = localizer.GetString("End %", "End %"),
            LossPct = localizer.GetString("Loss %", "Loss %"),
            Rate = localizer.GetString("Rate %/hr", "Rate %/hr"),
            Sentry = localizer.GetString("Sentry", "Sentry"),
            On = localizer.GetString("On", "On"),
            Off = localizer.GetString("Off", "Off"),
            NoSessions = localizer.GetString("No drain sessions recorded yet.", "No drain sessions recorded yet."),
            TipsTitle = localizer.GetString("Tips to Reduce Vampire Drain", "Tips to Reduce Vampire Drain"),
            TipSentry = localizer.GetString(
                "Disable Sentry Mode when parked at home to save 1\u20132 % per day.",
                "Disable Sentry Mode when parked at home to save 1\u20132 % per day."),
            TipPolling = localizer.GetString(
                "Reduce third-party app polling intervals to let the car sleep faster.",
                "Reduce third-party app polling intervals to let the car sleep faster."),
            TipOpen = localizer.GetString(
                "Avoid opening the app frequently \u2014 each wake cycle costs battery.",
                "Avoid opening the app frequently \u2014 each wake cycle costs battery."),
            TipEnergy = localizer.GetString(
                "Enable energy-saving mode in vehicle settings for better standby.",
                "Enable energy-saving mode in vehicle settings for better standby."),
            ErrorTitle = localizer.GetString("Failed to load data", "Failed to load data"),
            Retry = localizer.GetString("Retry", "Retry"),
        };
    }
}

/// <summary>
/// Pure projection from a <see cref="VampireDrainPageModel"/> to its <see cref="VampireDrainDisplay"/> — the
/// native port of the render logic in web/src/features/battery/pages/VampireDrainPage.tsx and its summary-metric,
/// drain-rate-trend, daily-drain, sessions-table and tips helpers. The branch precedence mirrors the web data
/// lifecycle (loading → error → empty → success). Every label resolves through the i18n facade using the same
/// keys the web page uses; the percent / hours / kWh values are formatted at this display boundary.
/// </summary>
public static class VampireDrainProjection
{
    /// <summary>Segoe Fluent — LightningBolt (web <c>Zap</c>).</summary>
    public const string ZapGlyph = "\uE945";

    /// <summary>Segoe Fluent — battery with warning bolt (web <c>BatteryWarning</c>).</summary>
    public const string BatteryWarningGlyph = "\uE83F";

    /// <summary>Segoe Fluent — activity pulse (web <c>Activity</c>).</summary>
    public const string ActivityGlyph = "\uE9D2";

    /// <summary>Segoe Fluent — shield with alert (web <c>ShieldAlert</c>).</summary>
    public const string ShieldGlyph = "\uEA18";

    /// <summary>Segoe Fluent — clock (web <c>Clock</c>).</summary>
    public const string ClockGlyph = "\uE823";

    /// <summary>Segoe Fluent — lightbulb (web <c>Lightbulb</c>).</summary>
    public const string LightbulbGlyph = "\uEA80";

    /// <summary>The drain-score gauge maximum (web <c>max={100}</c>).</summary>
    public const double GaugeMax = 100;

    private const int RatePrecision = 2;
    private const int EnergyPrecision = 1;
    private const int PercentPrecision = 1;
    private const int ScorePrecision = 0;
    private const int BatteryPrecision = 0;
    private const int DurationPrecision = 1;

    private const int TrendLineColor = 2;
    private const int DailyDrainColor = 5;
    private const int ParkedHoursColor = 0;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the localizer + clock.</summary>
    /// <param name="model">The parsed single-source data plus the page lifecycle flags.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">Injectable clock for deterministic date formatting in tests.</param>
    public static VampireDrainDisplay Project(VampireDrainPageModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var s = VampireStrings.Resolve(localizer);
        var snapshot = model.Snapshot;
        var data = snapshot.Stats;

        VampireDrainPageState state =
            model.Loading && !snapshot.HasData ? VampireDrainPageState.Loading
            : model.ErrorDetail is not null ? VampireDrainPageState.Error
            : !snapshot.HasData ? VampireDrainPageState.Empty
            : VampireDrainPageState.Success;

        string errorText = string.IsNullOrWhiteSpace(model.ErrorDetail)
            ? s.ErrorTitle
            : $"{s.ErrorTitle}: {model.ErrorDetail}";

        var metricCards = BuildMetricCards(data, s);
        var trend = BuildTrendChart(data.Entries, s, now);
        var daily = BuildDailyChart(data.Daily, s, now);
        var (columns, rows) = BuildTable(data.Entries, s, now);
        var tips = BuildTips(s);

        return new VampireDrainDisplay(
            State: state,
            Title: s.Title,
            Subtitle: s.Subtitle,
            AutomationName: $"{s.DocumentTitle}. {s.Subtitle}",
            ShowLoading: state == VampireDrainPageState.Loading,
            ShowError: state == VampireDrainPageState.Error,
            ShowEmpty: state == VampireDrainPageState.Empty,
            ShowContent: state == VampireDrainPageState.Success,
            ErrorText: errorText,
            RetryLabel: s.Retry,
            EmptyMessage: s.NoSessions,
            MetricCards: metricCards,
            GaugeValue: Math.Round(data.DrainScore),
            GaugeMax: GaugeMax,
            GaugeLabel: s.Score,
            GaugeUnit: "/100",
            TrendChart: trend,
            DailyChart: daily,
            SessionsTitle: s.DrainSessions,
            SessionsCountLabel: $"{data.Entries.Count.ToString(CultureInfo.CurrentCulture)} {s.Sessions}",
            TableColumns: columns,
            TableRows: rows,
            TableEmptyMessage: s.NoSessions,
            TipsTitle: s.TipsTitle,
            Tips: tips);
    }

    private static IReadOnlyList<VampireMetricCardDisplay> BuildMetricCards(VampireDrainStats data, VampireStrings s)
    {
        string avg = $"{ScalarFormatters.FormatNumber(data.AvgDrainRate, RatePrecision)}%/hr";
        string total = $"{ScalarFormatters.FormatNumber(data.TotalEnergyLost, EnergyPrecision)} kWh";
        string worst = $"{ScalarFormatters.FormatNumber(data.WorstDrainPct, PercentPrecision)}%";
        string score = $"{ScalarFormatters.FormatNumber(data.DrainScore, ScorePrecision)}/100";

        return
        [
            new VampireMetricCardDisplay(ZapGlyph, avg, s.AvgDrainRate, $"{s.AvgDrainRate}: {avg}"),
            new VampireMetricCardDisplay(BatteryWarningGlyph, total, s.TotalPhantomLoss, $"{s.TotalPhantomLoss}: {total}"),
            new VampireMetricCardDisplay(ActivityGlyph, worst, s.WorstSession, $"{s.WorstSession}: {worst}"),
            new VampireMetricCardDisplay(ShieldGlyph, score, s.DrainScore, $"{s.DrainScore}: {score}"),
        ];
    }

    private static VampireChartDisplay BuildTrendChart(
        IReadOnlyList<VampireSessionEntry> entries,
        VampireStrings s,
        DateTimeOffset now)
    {
        var points = new List<ChartPoint>(entries.Count);
        for (int i = 0; i < entries.Count; i++)
        {
            points.Add(new ChartPoint(i, entries[i].DrainRatePctHr, FormatChartDate(entries[i].Date, now)));
        }

        var series = new List<VampireSeriesDisplay>
        {
            new(s.DrainRate, ChartSeriesKind.Line, ChartRole.None, TrendLineColor, points),
        };

        return new VampireChartDisplay(points.Count > 0, s.DrainRateTrend, s.DrainRateTrend, series);
    }

    private static VampireChartDisplay BuildDailyChart(
        IReadOnlyList<VampireDailyDrainPoint> daily,
        VampireStrings s,
        DateTimeOffset now)
    {
        var drainPoints = new List<ChartPoint>(daily.Count);
        var hoursPoints = new List<ChartPoint>(daily.Count);
        for (int i = 0; i < daily.Count; i++)
        {
            string label = FormatChartDate(daily[i].Date, now);
            drainPoints.Add(new ChartPoint(i, daily[i].DrainPct, label));
            hoursPoints.Add(new ChartPoint(i, daily[i].HoursParked, label));
        }

        var series = new List<VampireSeriesDisplay>
        {
            new(s.DrainPctSeries, ChartSeriesKind.Bar, ChartRole.None, DailyDrainColor, drainPoints),
            new(s.ParkedHours, ChartSeriesKind.Bar, ChartRole.None, ParkedHoursColor, hoursPoints),
        };

        return new VampireChartDisplay(daily.Count > 0, s.DailyDrain, s.DailyDrain, series);
    }

    private static (IReadOnlyList<string> Columns, IReadOnlyList<VampireSessionRowDisplay> Rows) BuildTable(
        IReadOnlyList<VampireSessionEntry> entries,
        VampireStrings s,
        DateTimeOffset now)
    {
        var columns = new[] { s.Date, s.Duration, s.StartPct, s.EndPct, s.LossPct, s.Rate, s.Sentry };

        // Web parity: useSortToggle('date') sorts the entries by date — most-recent first.
        var ordered = new List<VampireSessionEntry>(entries);
        ordered.Sort(static (a, b) => Nullable.Compare(b.Date, a.Date));

        var rows = new List<VampireSessionRowDisplay>(ordered.Count);
        foreach (var entry in ordered)
        {
            string date = DateTimeFormatting.Format(entry.Date, DateTimeVariant.Full, now);
            string duration = $"{ScalarFormatters.FormatNumber(entry.DurationHours, DurationPrecision)}h";
            string startPct = $"{ScalarFormatters.FormatNumber(entry.StartBattery, BatteryPrecision)}%";
            string endPct = $"{ScalarFormatters.FormatNumber(entry.EndBattery, BatteryPrecision)}%";
            string lossPct = $"{ScalarFormatters.FormatNumber(entry.DrainPct, PercentPrecision)}%";
            string rate = ScalarFormatters.FormatNumber(entry.DrainRatePctHr, RatePrecision);
            string sentry = entry.SentryActive ? s.On : s.Off;

            rows.Add(new VampireSessionRowDisplay(
                entry.Id.ToString(CultureInfo.InvariantCulture),
                date,
                duration,
                startPct,
                endPct,
                lossPct,
                rate,
                sentry,
                $"{date}, {duration}, {startPct}, {endPct}, {lossPct}, {rate}, {sentry}"));
        }

        return (columns, rows);
    }

    private static IReadOnlyList<VampireTipDisplay> BuildTips(VampireStrings s) =>
    [
        new VampireTipDisplay(ShieldGlyph, s.TipSentry),
        new VampireTipDisplay(ClockGlyph, s.TipPolling),
        new VampireTipDisplay(BatteryWarningGlyph, s.TipOpen),
        new VampireTipDisplay(ActivityGlyph, s.TipEnergy),
    ];

    private static string FormatChartDate(DateTimeOffset? date, DateTimeOffset now) =>
        DateTimeFormatting.Format(date, DateTimeVariant.Date, now);
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Vampire-Drain page — every getter returns a nullable
/// rather than throwing so a partial or schema-drifted body never aborts the parse (web parity: the page
/// tolerates undefined fields). WinUI-free so the parse is unit-tested without a UI host. Reads the snake_case
/// wire shape (no camelCaseKeys transform on native) but also accepts the camelCase alias.
/// </summary>
internal static class VampireJson
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

    /// <summary>The boolean value of <paramref name="name"/>, tolerating a bool or "true"/"false" string.</summary>
    public static bool? Bool(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String when bool.TryParse(prop.GetString(), out var sv) => sv,
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

    /// <summary>Bind <paramref name="array"/> to the named JSON array property; false when absent / not an array.</summary>
    public static bool TryArray(JsonElement obj, string name, out JsonElement array)
    {
        if (obj.ValueKind == JsonValueKind.Object
            && obj.TryGetProperty(name, out var prop)
            && prop.ValueKind == JsonValueKind.Array)
        {
            array = prop;
            return true;
        }

        array = default;
        return false;
    }
}

/// <summary>
/// Canonical navigation + diagnostics metadata for the Vampire-Drain page — the native mirror of the web page at
/// web/src/features/battery/pages/VampireDrainPage.tsx (routes <c>/charging/vampire-drain</c> + <c>/vampire-drain</c>,
/// nav name <c>VampireDrain</c>). The page reads the same phantom-drain rollup the web page's
/// <c>request('/vampire-drain/stats')</c> query reads (generated operation <c>get_api_v1_vampire_drain_stats</c>).
/// </summary>
public static class VampireDrainRegistration
{
    /// <summary>The navigation route name the shell registers this page under (matches <c>RouteTable</c>).</summary>
    public const string RouteName = "VampireDrain";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "VampireDrainPage";

    /// <summary>The generated operation id for the phantom-drain rollup read (web <c>/vampire-drain/stats</c>).</summary>
    public const string StatsOperation = "get_api_v1_vampire_drain_stats";

    /// <summary>The Segoe Fluent glyph for the page-level empty surface (web <c>BatteryWarning</c>).</summary>
    public const string EmptyGlyph = VampireDrainProjection.BatteryWarningGlyph;

    /// <summary>The localized page document title (web <c>usePageTitle(t('vampire.title'))</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("vampire.title", "Vampire Drain");
    }
}

/// <summary>
/// PII-safe diagnostics sink for the Vampire-Drain surface — records only the <c>view.opened</c> event with the
/// surface slug, never any vehicle data (drain rate, battery delta, VIN or vehicle id). Mirrors the sibling
/// feature-view diagnostics. Thread-safe.
/// </summary>
public sealed class VampireDrainPageDiagnostics
{
    private readonly Action<string>? _sink;
    private int _viewsOpened;

    /// <summary>Creates the diagnostics sink over an optional PII-safe line writer.</summary>
    public VampireDrainPageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>The number of times the surface was opened.</summary>
    public int ViewsOpened => _viewsOpened;

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=VampireDrainPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={VampireDrainRegistration.Slug}");
    }
}
