using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="TimeOfUseAnalysisViewModel"/> can be in — the native
/// union of the branches the web Time-of-Use analysis renders
/// (web/src/features/charging/components/cost-analysis/TimeOfUseAnalysis.tsx). The web component is a pure
/// child of the cost-analysis page (it takes <c>hourlyData</c> + <c>touInsights</c> props derived from
/// <c>useCostAnalysisData(sessions)</c>; the page only mounts it once the charging-sessions query resolved);
/// the native surface binds its own cache-then-network read of <c>GET /charging</c>, so it owns the full
/// loading / loaded / empty / error / stale / offline matrix the P2 state contract requires. Every value maps
/// onto a visible surface (never a blank panel): <see cref="Loaded"/>, <see cref="Stale"/> and
/// <see cref="Offline"/> render the hourly bar chart plus the insight cards (with the stale / offline chip for
/// the latter two), <see cref="Empty"/> renders the friendly empty state (web parity: the page shows its
/// "No Charging Data" empty state when there are no sessions), <see cref="Loading"/> shows the skeleton chrome
/// and <see cref="Error"/> the retry surface.
/// </summary>
public enum TimeOfUseAnalysisState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot carrying at least one charging session to bucket.</summary>
    Loaded,

    /// <summary>The snapshot resolved but carries no charging session (web parity: page-level empty state).</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The time-of-use band a charging hour falls into — the native union of the web inline ternary that colours
/// each bar (<c>isPeak ? red : isOffPeak ? green : palette[0]</c>) and labels the legend. The view maps each
/// band onto a theme-aware brush so light / dark / high-contrast all flow from W1 tokens.
/// </summary>
public enum TouHourCategory
{
    /// <summary>Mid-peak — the default band (web <c>palette[0]</c>, the brand cyan).</summary>
    MidPeak,

    /// <summary>Peak demand, 2–7 PM (web <c>hour &gt;= 14 &amp;&amp; hour &lt;= 19</c> → red).</summary>
    Peak,

    /// <summary>Off-peak, 10 PM–6 AM (web <c>hour &gt;= 22 || hour &lt; 6</c> → green).</summary>
    OffPeak,
}

/// <summary>
/// The semantic tone of an insight card value — the native union of the web's per-insight text colour
/// (<c>green-400</c> cheapest, <c>red-400</c> priciest, <c>cyan-400</c> busiest, <c>emerald-400</c> off-peak).
/// The view maps each tone onto a status / brand brush so the colour stays token-driven and theme-aware.
/// </summary>
public enum TouTone
{
    /// <summary>A "good" value (cheapest hour, high off-peak share) — the success / emerald brush.</summary>
    Positive,

    /// <summary>A "costly" value (priciest hour) — the danger / red brush.</summary>
    Negative,

    /// <summary>A neutral-but-notable value (busiest hour) — the brand cyan brush.</summary>
    Info,
}

/// <summary>
/// One parsed charging session, reduced to just the fields the time-of-use analysis needs — the native mirror
/// of the web <c>ChargingSession</c> subset <c>useCostAnalysisData</c> reads to build the hourly buckets
/// (<c>started_at</c>, <c>cost_decimal</c>, <c>total_energy_added_wh</c>). Field names mirror the Go API's
/// snake_case JSON tags; parsing is null-tolerant so a partial row never throws. <see cref="StartedAt"/> is
/// kept as an offset so the projection can bucket by the user's local hour (web <c>new Date().getHours()</c>).
/// WinUI-free so the parse is unit-tested without a UI host.
/// </summary>
public sealed record TimeOfUseSession(DateTimeOffset? StartedAt, double? Cost, double EnergyWh)
{
    /// <summary>Parse a charging-sessions JSON array into a tolerant list of rows, preserving order.</summary>
    public static IReadOnlyList<TimeOfUseSession> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<TimeOfUseSession>();
        }

        var list = new List<TimeOfUseSession>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single charging-session JSON object into a tolerant row.</summary>
    public static TimeOfUseSession FromJson(JsonElement obj) => new(
        GetDateTime(obj, "started_at"),
        GetDouble(obj, "cost_decimal"),
        GetDouble(obj, "total_energy_added_wh") ?? 0);

    private static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
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

    private static DateTimeOffset? GetDateTime(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            v.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// The charging read-model the time-of-use analysis consumes — the list of charging sessions the web
/// cost-analysis page hands to <c>useCostAnalysisData</c> (which derives <c>hourlyData</c> + <c>touInsights</c>
/// inside the page, then passes them to the presentational <c>TimeOfUseAnalysis</c>). Parsing is tolerant so a
/// partial or non-array body yields <see cref="Empty"/> rather than throwing. <see cref="HasData"/> mirrors
/// the page's <c>sessions.length &gt; 0</c> mount gate (the page renders its empty state otherwise).
/// </summary>
public sealed record TimeOfUseReport(IReadOnlyList<TimeOfUseSession> Sessions)
{
    /// <summary>The no-data report — the parse fallback for an absent / non-array / empty body.</summary>
    public static TimeOfUseReport Empty { get; } = new(Array.Empty<TimeOfUseSession>());

    /// <summary>True when there is at least one charging session (web <c>sessions.length &gt; 0</c>).</summary>
    public bool HasData => Sessions.Count > 0;

    /// <summary>Project a <c>GET /charging</c> JSON array body into a tolerant report.</summary>
    public static TimeOfUseReport FromJson(JsonElement element) =>
        element.ValueKind == JsonValueKind.Array
            ? new TimeOfUseReport(TimeOfUseSession.ParseList(element))
            : Empty;
}

/// <summary>
/// One render-ready bar in the hourly distribution chart — a single hour's session count plus the metadata the
/// custom bar surface and Narrator need: the "HH:00" <see cref="Label"/> (web <c>HourBucket.label</c>), the
/// session count driving the bar, the average cost and energy carried into the spoken/hover summary, the
/// 0..1 <see cref="HeightRatio"/> against the busiest hour, the time-of-use <see cref="Category"/> (which the
/// view tints) and the spoken <see cref="AutomationName"/>. Pure data so the bucket maths is asserted
/// headlessly.
/// </summary>
public sealed record TouHourBar(
    int Hour,
    string Label,
    int Sessions,
    double AvgCost,
    double EnergyKwh,
    double HeightRatio,
    TouHourCategory Category,
    string AutomationName);

/// <summary>
/// One legend entry beneath the hourly chart — a localized band label plus the <see cref="TouHourCategory"/>
/// the view tints its swatch with. Mirrors the web's three-swatch peak / mid-peak / off-peak legend.
/// </summary>
public sealed record TouLegendEntry(string Label, TouHourCategory Category);

/// <summary>
/// One render-ready insight card — the native mirror of a single web <c>GlassPanel</c> in the insights column
/// (cheapest / priciest / busiest hour, off-peak share). Holds the localized <see cref="Label"/>, the headline
/// <see cref="Value"/> (the hour label or the percentage), the muted <see cref="Caption"/> beneath it, the
/// semantic <see cref="Tone"/> the view colours the value with, and the spoken <see cref="AutomationName"/>.
/// Pure data so the insight selection + formatting is asserted headlessly.
/// </summary>
public sealed record TouInsightCard(string Label, string Value, string Caption, TouTone Tone, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Time-of-Use analysis surface — the localized panel title, the
/// surface + chart empty copy, the insights heading + no-insights copy, the bar-series label, the 24 hourly
/// <see cref="Bars"/>, the three-entry <see cref="Legend"/> and the (up to four) <see cref="Insights"/> cards.
/// <see cref="HasData"/> drives the surface content-vs-empty branch (web parity: the chart + insights render
/// when there is at least one session); <see cref="HasInsights"/> drives the per-column insights-vs-noInsights
/// branch (web parity: <c>touInsights</c> may still be null). Pure data so every branch is asserted without a
/// UI host.
/// </summary>
public sealed record TimeOfUseDisplay(
    bool HasData,
    string Title,
    string AriaLabel,
    string EmptyMessage,
    string ChartEmptyMessage,
    string InsightsHeading,
    string NoInsightsMessage,
    string SessionsLabel,
    IReadOnlyList<TouHourBar> Bars,
    IReadOnlyList<TouLegendEntry> Legend,
    IReadOnlyList<TouInsightCard> Insights)
{
    /// <summary>True when there is at least one bucketed insight to show (web <c>touInsights != null</c>).</summary>
    public bool HasInsights => Insights.Count > 0;

    /// <summary>True when the hourly chart has bars to render (web <c>hourlyData.length &gt; 0</c>).</summary>
    public bool HasHourlyBars => Bars.Count > 0;

    /// <summary>An all-empty display (the friendly empty state) for the loading / empty fallback.</summary>
    public static TimeOfUseDisplay Empty(ILocalizer localizer) =>
        TimeOfUseAnalysisProjection.Project(TimeOfUseReport.Empty, localizer);
}

/// <summary>
/// Pure projection from a parsed <see cref="TimeOfUseReport"/> (the charging-sessions list) to a
/// <see cref="TimeOfUseDisplay"/> — the native port of the render + derivation logic the web cost-analysis
/// page runs in <c>useCostAnalysisData</c> and <c>TimeOfUseAnalysis.tsx</c>. It buckets the sessions into the
/// fixed 24-hour distribution (session count, average cost and energy per hour, keyed by the user's local
/// hour the way web's <c>new Date(started_at).getHours()</c> does), derives the time-of-use insights
/// (cheapest / priciest / busiest hour, off-peak share) with the same tie-breaking as the web stable sorts,
/// and resolves every label through the i18n facade using the keys the web source feeds into <c>t(...)</c>.
/// WinUI-free — unit-tested without a UI host.
/// </summary>
public static class TimeOfUseAnalysisProjection
{
    /// <summary>Hours in a day (bars). Web buckets are fixed 0..23.</summary>
    public const int Hours = 24;

    /// <summary>Hour labels are shown only every third column (web recharts <c>interval={2}</c>).</summary>
    public const int HourLabelInterval = 3;

    /// <summary>First peak hour, inclusive (web <c>hour &gt;= 14</c>).</summary>
    public const int PeakStartHour = 14;

    /// <summary>Last peak hour, inclusive (web <c>hour &lt;= 19</c>).</summary>
    public const int PeakEndHour = 19;

    /// <summary>First off-peak hour in the evening, inclusive (web <c>hour &gt;= 22</c>).</summary>
    public const int OffPeakStartHour = 22;

    /// <summary>Off-peak runs up to (exclusive) this morning hour (web <c>hour &lt; 6</c>).</summary>
    public const int OffPeakEndHour = 6;

    /// <summary>The currency symbol used in the insight captions (web <c>fmtNumber</c> + literal "$").</summary>
    public const string CurrencySymbol = "$";

    /// <summary>The cost precision used in the cheapest / priciest captions (web <c>fmtNumber(avgCost, 3)</c>).</summary>
    public const int CostDecimals = 3;

    /// <summary>The off-peak-share precision (web <c>fmtNumber(offPeakPct, 1)</c>).</summary>
    public const int PercentDecimals = 1;

    /// <summary>Classify an hour into its time-of-use band (web inline peak / off-peak ternary).</summary>
    public static TouHourCategory Classify(int hour)
    {
        if (hour >= PeakStartHour && hour <= PeakEndHour)
        {
            return TouHourCategory.Peak;
        }

        if (hour >= OffPeakStartHour || hour < OffPeakEndHour)
        {
            return TouHourCategory.OffPeak;
        }

        return TouHourCategory.MidPeak;
    }

    /// <summary>
    /// The user's local hour for a session timestamp — the native analogue of web's
    /// <c>new Date(started_at).getHours()</c>, which reads the browser-local hour. Null when the timestamp is
    /// absent / unparseable (the session is then left out of the buckets, as a NaN hour would be in web).
    /// </summary>
    public static int? LocalHour(DateTimeOffset? timestamp) =>
        timestamp is { } ts ? ts.ToLocalTime().Hour : null;

    /// <summary>Project <paramref name="report"/> using the localizer for every label.</summary>
    /// <param name="report">The parsed charging-sessions read-model.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public static TimeOfUseDisplay Project(TimeOfUseReport report, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(report);
        ArgumentNullException.ThrowIfNull(localizer);

        var sessionCount = new int[Hours];
        var totalCost = new double[Hours];
        var totalEnergyWh = new double[Hours];
        int offPeakCount = 0;

        foreach (var session in report.Sessions)
        {
            if (LocalHour(session.StartedAt) is not { } hour || hour is < 0 or >= Hours)
            {
                continue;
            }

            sessionCount[hour]++;
            totalCost[hour] += session.Cost ?? 0;
            totalEnergyWh[hour] += session.EnergyWh;
            if (Classify(hour) == TouHourCategory.OffPeak)
            {
                offPeakCount++;
            }
        }

        int maxSessions = 0;
        for (int hour = 0; hour < Hours; hour++)
        {
            maxSessions = Math.Max(maxSessions, sessionCount[hour]);
        }

        string sessionsWord = localizer.GetString("charging.curve.sessions", "sessions");
        var bars = report.HasData
            ? BuildBars(sessionCount, totalCost, totalEnergyWh, maxSessions, sessionsWord)
            : (IReadOnlyList<TouHourBar>)Array.Empty<TouHourBar>();

        var insights = BuildInsights(report, sessionCount, totalCost, offPeakCount, localizer, sessionsWord);
        var legend = BuildLegend(localizer);
        string title = localizer.GetString("costAnalysis.tou.title", "Electricity Rate Analysis (Time-of-Use)");

        return new TimeOfUseDisplay(
            HasData: report.HasData,
            Title: title,
            AriaLabel: title,
            EmptyMessage: localizer.GetString("costAnalysis.empty.title", "No Charging Data"),
            ChartEmptyMessage: localizer.GetString("costAnalysis.charts.noData", "Not enough data"),
            InsightsHeading: localizer.GetString("costAnalysis.tou.insights", "Insights"),
            NoInsightsMessage: localizer.GetString("costAnalysis.tou.noInsights", "No insights available"),
            SessionsLabel: localizer.GetString("costAnalysis.tou.sessions", "Sessions"),
            Bars: bars,
            Legend: legend,
            Insights: insights);
    }

    private static List<TouHourBar> BuildBars(
        int[] sessionCount,
        double[] totalCost,
        double[] totalEnergyWh,
        int maxSessions,
        string sessionsWord)
    {
        var bars = new List<TouHourBar>(Hours);
        for (int hour = 0; hour < Hours; hour++)
        {
            int sessions = sessionCount[hour];
            double avgCost = sessions > 0 ? totalCost[hour] / sessions : 0;
            double energyKwh = UnitConverters.EnergyFromSi(totalEnergyWh[hour], EnergyUnit.Kwh);
            double ratio = maxSessions > 0 ? (double)sessions / maxSessions : 0;
            string label = string.Create(CultureInfo.InvariantCulture, $"{hour:D2}:00");

            bars.Add(new TouHourBar(
                Hour: hour,
                Label: label,
                Sessions: sessions,
                AvgCost: avgCost,
                EnergyKwh: energyKwh,
                HeightRatio: ratio,
                Category: Classify(hour),
                AutomationName: string.Create(CultureInfo.CurrentCulture, $"{label}, {sessions} {sessionsWord}")));
        }

        return bars;
    }

    private static TouInsightCard[] BuildInsights(
        TimeOfUseReport report,
        int[] sessionCount,
        double[] totalCost,
        int offPeakCount,
        ILocalizer localizer,
        string sessionsWord)
    {
        // Web: const withSessions = hourlyData.filter(h => h.sessions > 0); if (withSessions.length === 0) null.
        var withSessions = new List<TouHourBar>();
        for (int hour = 0; hour < Hours; hour++)
        {
            int sessions = sessionCount[hour];
            if (sessions <= 0)
            {
                continue;
            }

            double avgCost = totalCost[hour] / sessions;
            withSessions.Add(new TouHourBar(
                Hour: hour,
                Label: string.Create(CultureInfo.InvariantCulture, $"{hour:D2}:00"),
                Sessions: sessions,
                AvgCost: avgCost,
                EnergyKwh: 0,
                HeightRatio: 0,
                Category: Classify(hour),
                AutomationName: string.Empty));
        }

        if (withSessions.Count == 0)
        {
            // Web parity: touInsights is null when no hour has sessions — the column shows "No insights".
            return Array.Empty<TouInsightCard>();
        }

        // Web uses stable sorts over the hour-ordered withSessions list; LINQ OrderBy is stable, so ties resolve
        // to the lowest hour exactly as the web's Array.prototype.sort does.
        var cheapest = withSessions.OrderBy(h => h.AvgCost).First();
        var priciest = withSessions.OrderByDescending(h => h.AvgCost).First();
        var busiest = withSessions.OrderByDescending(h => h.Sessions).First();
        double offPeakPct = report.Sessions.Count > 0
            ? (double)offPeakCount / report.Sessions.Count * 100
            : 0;

        string avgWord = localizer.GetString("costAnalysis.tou.avgCost", "avg");
        string perSession = localizer.GetString("costAnalysis.tou.perSession", "/ session");
        string cheapestLabel = localizer.GetString("costAnalysis.tou.cheapestHour", "Cheapest Hour");
        string priciestLabel = localizer.GetString("costAnalysis.tou.priciestHour", "Priciest Hour");
        string busiestLabel = localizer.GetString("costAnalysis.tou.busiestHour", "Busiest Hour");
        string offPeakLabel = localizer.GetString("costAnalysis.tou.offPeakRatio", "Off-Peak Charging");

        string cheapestCaption = CostCaption(avgWord, cheapest.AvgCost, perSession);
        string priciestCaption = CostCaption(avgWord, priciest.AvgCost, perSession);
        string busiestCaption = string.Create(
            CultureInfo.CurrentCulture, $"{ScalarFormatters.FormatNumber(busiest.Sessions)} {sessionsWord}");
        string offPeakValue = ScalarFormatters.FormatPercentage(offPeakPct, PercentDecimals);
        string offPeakCaption = localizer.GetString("costAnalysis.tou.offPeakDesc", "of sessions between 10 PM-6 AM");

        return new[]
        {
            new TouInsightCard(
                Label: cheapestLabel,
                Value: cheapest.Label,
                Caption: cheapestCaption,
                Tone: TouTone.Positive,
                AutomationName: InsightName(cheapestLabel, cheapest.Label, cheapestCaption)),
            new TouInsightCard(
                Label: priciestLabel,
                Value: priciest.Label,
                Caption: priciestCaption,
                Tone: TouTone.Negative,
                AutomationName: InsightName(priciestLabel, priciest.Label, priciestCaption)),
            new TouInsightCard(
                Label: busiestLabel,
                Value: busiest.Label,
                Caption: busiestCaption,
                Tone: TouTone.Info,
                AutomationName: InsightName(busiestLabel, busiest.Label, busiestCaption)),
            new TouInsightCard(
                Label: offPeakLabel,
                Value: offPeakValue,
                Caption: offPeakCaption,
                Tone: TouTone.Positive,
                AutomationName: InsightName(offPeakLabel, offPeakValue, offPeakCaption)),
        };
    }

    private static TouLegendEntry[] BuildLegend(ILocalizer localizer) => new[]
    {
        new TouLegendEntry(localizer.GetString("costAnalysis.tou.peak", "Peak (2-7 PM)"), TouHourCategory.Peak),
        new TouLegendEntry(localizer.GetString("costAnalysis.tou.midPeak", "Mid-peak"), TouHourCategory.MidPeak),
        new TouLegendEntry(localizer.GetString("costAnalysis.tou.offPeak", "Off-peak (10 PM-6 AM)"), TouHourCategory.OffPeak),
    };

    // Web: `${t('avg')} ${formatCurrency(avgCost, 3)} ${t('perSession')}` — e.g. "avg $0.083 / session".
    private static string CostCaption(string avgWord, double avgCost, string perSession) =>
        string.Create(
            CultureInfo.CurrentCulture,
            $"{avgWord} {ScalarFormatters.FormatCurrency(avgCost, CurrencySymbol, CostDecimals)} {perSession}");

    private static string InsightName(string label, string value, string caption) =>
        string.Create(CultureInfo.CurrentCulture, $"{label}: {value}. {caption}");
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;TimeOfUseReport&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline) so the view-model can render the full state matrix. Pure so the parse-and-preserve
/// contract is unit-tested without a network or cache.
/// </summary>
public static class TimeOfUseAnalysisResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<TimeOfUseReport> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        TimeOfUseReport Parse() =>
            raw.HasValue ? TimeOfUseReport.FromJson(raw.Value) : TimeOfUseReport.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<TimeOfUseReport>.Loading(),
            LoadStatus.Cached => RepositoryResult<TimeOfUseReport>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<TimeOfUseReport>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<TimeOfUseReport>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<TimeOfUseReport>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<TimeOfUseReport>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<TimeOfUseReport>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical metadata for the Time-of-Use analysis feature surface — the native mirror of the web component at
/// web/src/features/charging/components/cost-analysis/TimeOfUseAnalysis.tsx. The surface reads the same
/// charging-sessions list the web cost-analysis page buckets into the hourly distribution and insights.
/// </summary>
public static class TimeOfUseAnalysisRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "time-of-use-analysis";

    /// <summary>Surface category.</summary>
    public const string Category = "charging";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (per the P2 prompt).</summary>
    public const string Slug = "TimeOfUseAnalysis";

    /// <summary>Localized surface name.</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("costAnalysis.tou.title", "Electricity Rate Analysis (Time-of-Use)");
    }
}

/// <summary>
/// PII-safe diagnostics for the Time-of-Use analysis surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a cost, session count, hour or
/// percentage — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class TimeOfUseAnalysisDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public TimeOfUseAnalysisDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TimeOfUseAnalysis</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TimeOfUseAnalysisRegistration.Slug}");
    }
}
