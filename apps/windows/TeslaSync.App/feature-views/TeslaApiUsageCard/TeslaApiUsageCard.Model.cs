using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="TeslaApiUsageViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the surface renders. The web component
/// (web/src/features/system/components/status/TeslaApiUsageCard.tsx) feeds the shared <c>UsageCard</c>
/// primitive and degrades to a single "not available yet" message when the <c>/system/api-usage</c> snapshot
/// is absent. The native feature-view owns its own combined <c>/system/api-usage</c> + <c>/api-logs/stats</c>
/// read and therefore renders the full state matrix the P2 contract mandates — none is hidden.
/// </summary>
public enum TeslaApiUsageState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh (or non-stale cached) usage snapshot with budget, bands, details and breakdowns.</summary>
    Loaded,

    /// <summary>The <c>/system/api-usage</c> read returned no object — render the friendly empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The visual intent driving accent colour for the budget bar, bands, detail values and the banner — the
/// native analogue of the web <c>UsageCardIntent</c> ('normal' / 'warn' / 'danger').
/// </summary>
public enum TeslaApiUsageIntent
{
    /// <summary>Default — accent-tinted, no warning emphasis.</summary>
    Normal,

    /// <summary>Cautionary — amber emphasis (approaching the budget / elevated error rate).</summary>
    Warn,

    /// <summary>Critical — red emphasis (over budget / high error rate).</summary>
    Danger,
}

/// <summary>
/// The Tesla Fleet API spend/volume snapshot from <c>GET /system/api-usage</c> the card consumes — the native
/// analogue of the web <c>APIUsage</c> DTO (web/src/api/types.ts). Field names mirror the Go API's snake_case
/// wire tags emitted by <c>APIUsageHandler</c> (internal/api/health.go): <c>total_requests</c>,
/// <c>skipped_polls</c>, <c>estimated_cost</c>, <c>cost_per_request</c>, <c>monthly_credit</c>,
/// <c>estimated_remaining</c>. Counts and money are dimensionless at the display boundary, so no SI unit
/// conversion applies. Parsing is null-tolerant so a partial body never throws.
/// </summary>
/// <param name="TotalRequests">Requests billed this month (web <c>total_requests</c>).</param>
/// <param name="SkippedPolls">Requests skipped because the vehicle was asleep (web <c>skipped_polls</c>).</param>
/// <param name="EstimatedCost">Month-to-date estimated spend in dollars (web <c>estimated_cost</c>).</param>
/// <param name="CostPerRequest">Per-request cost in dollars (web <c>cost_per_request</c>).</param>
/// <param name="MonthlyCredit">The monthly credit / budget in dollars (web <c>monthly_credit</c>).</param>
/// <param name="EstimatedRemaining">Remaining credit in dollars (web <c>estimated_remaining</c>).</param>
public sealed record ApiUsageSnapshot(
    double TotalRequests,
    double SkippedPolls,
    double EstimatedCost,
    double CostPerRequest,
    double MonthlyCredit,
    double EstimatedRemaining)
{
    /// <summary>
    /// Project a <c>GET /system/api-usage</c> response into a tolerant snapshot. Returns <see langword="null"/>
    /// when the body is not a JSON object — the native analogue of the web <c>!apiUsage</c> gate (the empty
    /// surface). Absent or non-numeric fields coalesce to zero like the web's per-field reads.
    /// </summary>
    public static ApiUsageSnapshot? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new ApiUsageSnapshot(
            TotalRequests: TeslaApiUsageJson.ReadDouble(root, "total_requests") ?? 0,
            SkippedPolls: TeslaApiUsageJson.ReadDouble(root, "skipped_polls") ?? 0,
            EstimatedCost: TeslaApiUsageJson.ReadDouble(root, "estimated_cost") ?? 0,
            CostPerRequest: TeslaApiUsageJson.ReadDouble(root, "cost_per_request") ?? 0,
            MonthlyCredit: TeslaApiUsageJson.ReadDouble(root, "monthly_credit") ?? 0,
            EstimatedRemaining: TeslaApiUsageJson.ReadDouble(root, "estimated_remaining") ?? 0);
    }
}

/// <summary>
/// One grouped call-count entry from the <c>by_service</c> / <c>by_method</c> breakdown maps of
/// <c>GET /api-logs/stats</c> — the native analogue of one <c>[name, count]</c> pair the web card derives via
/// <c>dedupeMap</c>. The native source reads the raw snake_case wire object, which carries no camelCase
/// clones, so no de-duplication is needed.
/// </summary>
/// <param name="Name">The service or HTTP method name (the map key).</param>
/// <param name="Count">The call count attributed to it (the map value).</param>
public sealed record ApiUsageGroup(string Name, double Count);

/// <summary>
/// The API call-log rollup from <c>GET /api-logs/stats</c> the card layers onto the spend snapshot — the
/// native analogue of the web <c>APICallLogStats</c> DTO (web/src/types/admin.ts). Field names mirror the Go
/// API's snake_case wire tags from <c>APICallLogRepo.GetStats</c>: <c>last_24h</c>, <c>avg_duration_ms</c>,
/// <c>error_rate</c> (already a 0..100 percentage), <c>error_count</c>, <c>total_calls</c>, plus the
/// <c>by_service</c> / <c>by_method</c> breakdown maps. Every figure is optional (each field is parsed as a
/// nullable so an absent value degrades to the long em-dash, matching the web's per-field <c>!= null</c>
/// guards); the whole record is itself optional on the overview (the breakdown read is best-effort).
/// </summary>
/// <param name="Last24h">Requests in the last 24h (web <c>last24h</c>), or null when absent.</param>
/// <param name="AvgDurationMs">Average request latency in milliseconds (web <c>avgDurationMs</c>), or null.</param>
/// <param name="ErrorRate">Error rate as a 0..100 percentage (web <c>errorRate</c>), or null.</param>
/// <param name="ErrorCount">Error count (web <c>errorCount</c>), or null when absent.</param>
/// <param name="TotalCalls">Total calls (web <c>totalCalls</c>), or null when absent.</param>
/// <param name="ByService">The per-service call-count breakdown (web <c>by_service</c>); never null.</param>
/// <param name="ByMethod">The per-method call-count breakdown (web <c>by_method</c>); never null.</param>
public sealed record ApiLogStats(
    double? Last24h,
    double? AvgDurationMs,
    double? ErrorRate,
    double? ErrorCount,
    double? TotalCalls,
    IReadOnlyList<ApiUsageGroup> ByService,
    IReadOnlyList<ApiUsageGroup> ByMethod)
{
    /// <summary>
    /// Project a <c>GET /api-logs/stats</c> response into a tolerant rollup. Returns <see langword="null"/>
    /// when the body is not a JSON object (the web <c>logStats</c> being absent). Absent numeric fields stay
    /// null so the projection renders the long em-dash, matching the web <c>logStats?.field != null</c> guards.
    /// </summary>
    public static ApiLogStats? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new ApiLogStats(
            Last24h: TeslaApiUsageJson.ReadDouble(root, "last_24h"),
            AvgDurationMs: TeslaApiUsageJson.ReadDouble(root, "avg_duration_ms"),
            ErrorRate: TeslaApiUsageJson.ReadDouble(root, "error_rate"),
            ErrorCount: TeslaApiUsageJson.ReadDouble(root, "error_count"),
            TotalCalls: TeslaApiUsageJson.ReadDouble(root, "total_calls"),
            ByService: TeslaApiUsageJson.ReadGroups(root, "by_service"),
            ByMethod: TeslaApiUsageJson.ReadGroups(root, "by_method"));
    }
}

/// <summary>
/// The combined usage overview the card renders — the <c>/system/api-usage</c> spend snapshot (the primary
/// read that drives the card state) plus the supplementary <c>/api-logs/stats</c> rollup. The web composes
/// these from a page-level query (the snapshot, passed as a prop) and the <c>useApiLogStats</c> hook where the
/// snapshot gates the surface and the stats are best-effort; the native source folds them into this one
/// cache-then-network value so the engine can serve it stale / offline as a unit. Round-trips losslessly
/// through the cache.
/// </summary>
public sealed record TeslaApiUsageOverview
{
    /// <summary>Creates an overview from the spend snapshot and the (optional) call-log stats.</summary>
    /// <param name="snapshot">The spend snapshot, or null when the api-usage read returned no object.</param>
    /// <param name="stats">The supplementary call-log rollup, or null when the best-effort read failed.</param>
    [JsonConstructor]
    public TeslaApiUsageOverview(ApiUsageSnapshot? snapshot, ApiLogStats? stats)
    {
        Snapshot = snapshot;
        Stats = stats;
    }

    /// <summary>The spend snapshot, or null when the api-usage read returned no object.</summary>
    public ApiUsageSnapshot? Snapshot { get; init; }

    /// <summary>The supplementary call-log rollup, or null when the best-effort read failed / was absent.</summary>
    public ApiLogStats? Stats { get; init; }

    /// <summary>An empty overview — the view-model seed before the first emission.</summary>
    public static TeslaApiUsageOverview Empty { get; } = new(null, null);

    /// <summary>
    /// True when there is usage to show — the web gate <c>!apiUsage</c>. Any present snapshot (even all-zero)
    /// renders the card; a non-object body is the empty surface.
    /// </summary>
    [JsonIgnore]
    public bool HasUsage => Snapshot is not null;
}

/// <summary>
/// The optional budget progress bar (web <c>UsageCardBudget</c>). The native view renders the headline and
/// right-label around a token bar whose fill follows <see cref="Intent"/>, with the <see cref="Caption"/>
/// beneath and the whole group named by <see cref="AutomationName"/> (the web <c>ariaLabel</c> plus the
/// rounded percentage).
/// </summary>
/// <param name="Headline">Pre-formatted "spent of total" headline, e.g. "$0.42 of $5.00".</param>
/// <param name="RightLabel">Right-aligned caption, e.g. "8% of monthly credit".</param>
/// <param name="Caption">Caption under the bar, e.g. "Day 5 of 30 · resets in 25 days".</param>
/// <param name="Percent">0..100+ value used for the bar fill (clamped) and the announced percentage.</param>
/// <param name="Intent">The bar's visual intent.</param>
/// <param name="AriaLabel">The screen-reader label naming the budget.</param>
/// <param name="AutomationName">The composed Narrator phrase ("{ariaLabel}: {percent}%").</param>
public sealed record TeslaApiUsageBudget(
    string Headline,
    string RightLabel,
    string Caption,
    double Percent,
    TeslaApiUsageIntent Intent,
    string AriaLabel,
    string AutomationName);

/// <summary>
/// One at-a-glance band rendered in the three-column grid (web <c>UsageCardBand</c>). The <see cref="Value"/>
/// is the large headline; the optional <see cref="Unit"/> is the smaller muted suffix ("requests"); the
/// <see cref="Sub"/> is the grey subtitle; <see cref="Intent"/> tints the band; and <see cref="AutomationName"/>
/// joins them so Narrator reads the band as one phrase.
/// </summary>
/// <param name="Label">The localized band label (web <c>label</c>).</param>
/// <param name="Value">The formatted headline value.</param>
/// <param name="Unit">The localized unit suffix, or empty when the value stands alone.</param>
/// <param name="Sub">The localized subtitle line.</param>
/// <param name="Intent">The band's visual intent.</param>
/// <param name="AutomationName">The composed Narrator phrase for the band.</param>
public sealed record TeslaApiUsageBand(
    string Label,
    string Value,
    string Unit,
    string Sub,
    TeslaApiUsageIntent Intent,
    string AutomationName);

/// <summary>
/// One key/value cell in the four-column detail grid (web <c>UsageCardDetail</c>). <see cref="Intent"/>
/// colours the value text; <see cref="AutomationName"/> reads the label/value pair as one phrase.
/// </summary>
/// <param name="Label">The localized metric label (web <c>label</c>).</param>
/// <param name="Value">The formatted metric value.</param>
/// <param name="Intent">The value's visual intent.</param>
/// <param name="AutomationName">The composed Narrator phrase for the metric.</param>
public sealed record TeslaApiUsageDetail(
    string Label,
    string Value,
    TeslaApiUsageIntent Intent,
    string AutomationName);

/// <summary>
/// One row in a top-list breakdown (web <c>UsageCardTopListItem</c>). <see cref="Label"/> is the left-aligned
/// name and <see cref="Value"/> the right-aligned count; <see cref="AutomationName"/> spells the pair out for
/// Narrator.
/// </summary>
/// <param name="Key">The stable item key.</param>
/// <param name="Label">The left-aligned name (service or method).</param>
/// <param name="Value">The right-aligned formatted count.</param>
/// <param name="AutomationName">The composed Narrator phrase for the row.</param>
public sealed record TeslaApiUsageTopListItem(
    string Key,
    string Label,
    string Value,
    string AutomationName);

/// <summary>
/// One top-list block (web <c>UsageCardTopList</c>): a titled list of <see cref="Items"/>.
/// </summary>
/// <param name="Key">The stable block key ("services" / "methods").</param>
/// <param name="Title">The localized block title.</param>
/// <param name="Items">The block's rows.</param>
public sealed record TeslaApiUsageTopList(
    string Key,
    string Title,
    IReadOnlyList<TeslaApiUsageTopListItem> Items);

/// <summary>
/// The optional over-budget callout banner (web <c>UsageCardBanner</c>): a titled danger strip shown when
/// month-to-date spend exceeds the monthly credit.
/// </summary>
/// <param name="Title">The localized banner heading.</param>
/// <param name="Description">The localized banner body (with the overage amount).</param>
/// <param name="Intent">The banner's visual intent.</param>
public sealed record TeslaApiUsageBanner(
    string Title,
    string Description,
    TeslaApiUsageIntent Intent);

/// <summary>
/// One footer navigation link (web <c>UsageCardFooterLink</c>). The native view renders these as accessible
/// hyperlink buttons; <see cref="Route"/> is the in-app destination raised to the host on invocation.
/// </summary>
/// <param name="Key">The stable link key.</param>
/// <param name="Route">The in-app route the link targets (e.g. "/api-logs").</param>
/// <param name="Label">The localized link label.</param>
/// <param name="Primary">True for the primary (filled) link; false for the secondary link.</param>
/// <param name="AutomationName">The Narrator name for the link.</param>
public sealed record TeslaApiUsageFooterLink(
    string Key,
    string Route,
    string Label,
    bool Primary,
    string AutomationName);

/// <summary>
/// The render-ready view of the card — everything the WinUI view needs to draw without flashing a blank box:
/// the optional <see cref="Budget"/> bar, the three at-a-glance <see cref="Bands"/>, the four-cell
/// <see cref="Details"/> grid, the optional <see cref="TopLists"/>, the optional over-budget
/// <see cref="Banner"/> and the <see cref="Footer"/> links. Pure data so the projection is unit-tested
/// without a UI host.
/// </summary>
/// <param name="Budget">The budget bar, or null for the empty seed.</param>
/// <param name="Bands">The three at-a-glance bands, in web order.</param>
/// <param name="Details">The four detail cells, in web order.</param>
/// <param name="TopLists">The optional top-list blocks (services / methods), present only when non-empty.</param>
/// <param name="Banner">The over-budget banner, or null when within budget.</param>
/// <param name="Footer">The footer links.</param>
public sealed record TeslaApiUsageDisplay(
    TeslaApiUsageBudget? Budget,
    IReadOnlyList<TeslaApiUsageBand> Bands,
    IReadOnlyList<TeslaApiUsageDetail> Details,
    IReadOnlyList<TeslaApiUsageTopList> TopLists,
    TeslaApiUsageBanner? Banner,
    IReadOnlyList<TeslaApiUsageFooterLink> Footer);

/// <summary>
/// Pure projection from a parsed <see cref="TeslaApiUsageOverview"/> to the render-ready
/// <see cref="TeslaApiUsageDisplay"/> — the native port of the <c>useMemo</c> derivation + JSX +
/// <c>useFormatting</c> composition in web/src/features/system/components/status/TeslaApiUsageCard.tsx. Every
/// label resolves through the i18n facade; money uses the active currency symbol; counts are grouped
/// integers; percentages carry a trailing %. The billing-window maths (days elapsed / remaining, budget
/// percentage, daily averages and the two end-of-month forecasts) reproduce the web exactly. No WinUI types —
/// unit-tested without a UI host.
/// </summary>
public static class TeslaApiUsageProjection
{
    /// <summary>The long em-dash shown for an absent value (web em-dash sentinel).</summary>
    public const string EmDash = UnitFormatters.DefaultEmptyDisplay;

    /// <summary>The default currency symbol when the host supplies none (web <c>useFormatting</c> default "$").</summary>
    public const string DefaultCurrencySymbol = "$";

    /// <summary>The budget percentage above which the bar turns amber (web <c>pctOfBudget &gt; 80</c>).</summary>
    public const double BudgetWarnThreshold = 80d;

    /// <summary>The error-rate percentage at/above which the value turns red (web <c>errorPct &gt;= 5</c>).</summary>
    public const double ErrorDangerThreshold = 5d;

    /// <summary>The error-rate percentage at/above which the value turns amber (web <c>errorPct &gt;= 1</c>).</summary>
    public const double ErrorWarnThreshold = 1d;

    /// <summary>The "/api-logs" footer route (web primary footer link).</summary>
    public const string ApiLogsRoute = "/api-logs";

    /// <summary>The "/tesla-account" footer route (web secondary footer link).</summary>
    public const string TeslaAccountRoute = "/tesla-account";

    // ---- i18n keys + English fallbacks (web t(key, fallback) parity) --------------------------------------

    /// <summary>i18n key for the native chrome title.</summary>
    public const string TitleKey = "translation.system.status.teslaApiUsage.title";

    /// <summary>English fallback for <see cref="TitleKey"/>.</summary>
    public const string TitleFallback = "Tesla API usage";

    /// <summary>i18n key for the empty-surface message (web <c>emptyMessage</c>).</summary>
    public const string EmptyKey = "translation.system.status.teslaApiUsage.empty";

    /// <summary>English fallback for <see cref="EmptyKey"/> (the web empty copy).</summary>
    public const string EmptyFallback = "Tesla API usage data is not available yet.";

    /// <summary>i18n key for the budget bar's screen-reader label (web <c>ariaLabel</c>).</summary>
    public const string BudgetAriaKey = "translation.system.status.teslaApiUsage.budgetAria";

    /// <summary>English fallback for <see cref="BudgetAriaKey"/>.</summary>
    public const string BudgetAriaFallback = "Tesla API budget used";

    /// <summary>i18n key for the budget headline format (web "{spent} of {total}").</summary>
    public const string BudgetHeadlineKey = "translation.system.status.teslaApiUsage.budgetHeadline";

    /// <summary>English fallback for <see cref="BudgetHeadlineKey"/>.</summary>
    public const string BudgetHeadlineFallback = "{0} of {1}";

    /// <summary>i18n key for the budget right-label format (web "{pct} of monthly credit").</summary>
    public const string BudgetRightLabelKey = "translation.system.status.teslaApiUsage.budgetRight";

    /// <summary>English fallback for <see cref="BudgetRightLabelKey"/>.</summary>
    public const string BudgetRightLabelFallback = "{0} of monthly credit";

    /// <summary>i18n key for the "Day {0} of {1}" caption prefix.</summary>
    public const string DayOfKey = "translation.system.status.teslaApiUsage.dayOf";

    /// <summary>English fallback for <see cref="DayOfKey"/>.</summary>
    public const string DayOfFallback = "Day {0} of {1}";

    /// <summary>i18n key for the "resets tomorrow" caption clause.</summary>
    public const string ResetsTomorrowKey = "translation.system.status.teslaApiUsage.resetsTomorrow";

    /// <summary>English fallback for <see cref="ResetsTomorrowKey"/>.</summary>
    public const string ResetsTomorrowFallback = "resets tomorrow";

    /// <summary>i18n key for the singular "resets in {0} day" caption clause.</summary>
    public const string ResetsInDayKey = "translation.system.status.teslaApiUsage.resetsInDay";

    /// <summary>English fallback for <see cref="ResetsInDayKey"/>.</summary>
    public const string ResetsInDayFallback = "resets in {0} day";

    /// <summary>i18n key for the plural "resets in {0} days" caption clause.</summary>
    public const string ResetsInDaysKey = "translation.system.status.teslaApiUsage.resetsInDays";

    /// <summary>English fallback for <see cref="ResetsInDaysKey"/>.</summary>
    public const string ResetsInDaysFallback = "resets in {0} days";

    /// <summary>i18n key for the "This month" band label.</summary>
    public const string ThisMonthKey = "translation.system.status.teslaApiUsage.thisMonth";

    /// <summary>English fallback for <see cref="ThisMonthKey"/>.</summary>
    public const string ThisMonthFallback = "This month";

    /// <summary>i18n key for the "Last 24h" band label.</summary>
    public const string Last24hKey = "translation.system.status.teslaApiUsage.last24h";

    /// <summary>English fallback for <see cref="Last24hKey"/>.</summary>
    public const string Last24hFallback = "Last 24h";

    /// <summary>i18n key for the "Forecast EOM" band label.</summary>
    public const string ForecastKey = "translation.system.status.teslaApiUsage.forecast";

    /// <summary>English fallback for <see cref="ForecastKey"/>.</summary>
    public const string ForecastFallback = "Forecast EOM";

    /// <summary>i18n key for the "requests" unit suffix.</summary>
    public const string RequestsUnitKey = "translation.system.status.teslaApiUsage.requestsUnit";

    /// <summary>English fallback for <see cref="RequestsUnitKey"/>.</summary>
    public const string RequestsUnitFallback = "requests";

    /// <summary>i18n key for the "{0}/day avg" band subtitle.</summary>
    public const string DayAvgKey = "translation.system.status.teslaApiUsage.dayAvg";

    /// <summary>English fallback for <see cref="DayAvgKey"/>.</summary>
    public const string DayAvgFallback = "{0}/day avg";

    /// <summary>i18n key for the "{0}/day burn" band subtitle.</summary>
    public const string DayBurnKey = "translation.system.status.teslaApiUsage.dayBurn";

    /// <summary>English fallback for <see cref="DayBurnKey"/>.</summary>
    public const string DayBurnFallback = "{0}/day burn";

    /// <summary>i18n key for the "recent rate: {0}" band subtitle.</summary>
    public const string RecentRateKey = "translation.system.status.teslaApiUsage.recentRate";

    /// <summary>English fallback for <see cref="RecentRateKey"/>.</summary>
    public const string RecentRateFallback = "recent rate: {0}";

    /// <summary>i18n key for the "Useful" detail label.</summary>
    public const string UsefulKey = "translation.system.status.teslaApiUsage.useful";

    /// <summary>English fallback for <see cref="UsefulKey"/>.</summary>
    public const string UsefulFallback = "Useful";

    /// <summary>i18n key for the "Skipped (asleep)" detail label.</summary>
    public const string SkippedKey = "translation.system.status.teslaApiUsage.skipped";

    /// <summary>English fallback for <see cref="SkippedKey"/>.</summary>
    public const string SkippedFallback = "Skipped (asleep)";

    /// <summary>i18n key for the "Avg latency" detail label.</summary>
    public const string AvgLatencyKey = "translation.system.status.teslaApiUsage.avgLatency";

    /// <summary>English fallback for <see cref="AvgLatencyKey"/>.</summary>
    public const string AvgLatencyFallback = "Avg latency";

    /// <summary>i18n key for the "Error rate" detail label.</summary>
    public const string ErrorRateKey = "translation.system.status.teslaApiUsage.errorRate";

    /// <summary>English fallback for <see cref="ErrorRateKey"/>.</summary>
    public const string ErrorRateFallback = "Error rate";

    /// <summary>i18n key for the "{0} ms" latency value format.</summary>
    public const string MsKey = "translation.system.status.teslaApiUsage.ms";

    /// <summary>English fallback for <see cref="MsKey"/>.</summary>
    public const string MsFallback = "{0} ms";

    /// <summary>i18n key for the "Top services" top-list title.</summary>
    public const string TopServicesKey = "translation.system.status.teslaApiUsage.topServices";

    /// <summary>English fallback for <see cref="TopServicesKey"/>.</summary>
    public const string TopServicesFallback = "Top services";

    /// <summary>i18n key for the "By method" top-list title.</summary>
    public const string ByMethodKey = "translation.system.status.teslaApiUsage.byMethod";

    /// <summary>English fallback for <see cref="ByMethodKey"/>.</summary>
    public const string ByMethodFallback = "By method";

    /// <summary>i18n key for the over-budget banner title.</summary>
    public const string OverBudgetTitleKey = "translation.system.status.teslaApiUsage.overBudgetTitle";

    /// <summary>English fallback for <see cref="OverBudgetTitleKey"/>.</summary>
    public const string OverBudgetTitleFallback = "Over monthly credit";

    /// <summary>i18n key for the over-budget banner description format.</summary>
    public const string OverBudgetDescKey = "translation.system.status.teslaApiUsage.overBudgetDesc";

    /// <summary>English fallback for <see cref="OverBudgetDescKey"/>.</summary>
    public const string OverBudgetDescFallback =
        "Spend has exceeded the {0} monthly credit by {1}. Review polling cadence or vehicle subscriptions.";

    /// <summary>i18n key for the "Open API Logs" footer link.</summary>
    public const string FooterLogsKey = "translation.system.status.teslaApiUsage.footerLogs";

    /// <summary>English fallback for <see cref="FooterLogsKey"/>.</summary>
    public const string FooterLogsFallback = "Open API Logs";

    /// <summary>i18n key for the "Tesla account" footer link.</summary>
    public const string FooterTeslaKey = "translation.system.status.teslaApiUsage.footerTesla";

    /// <summary>English fallback for <see cref="FooterTeslaKey"/>.</summary>
    public const string FooterTeslaFallback = "Tesla account";

    // web display precisions: fmtInt (0 decimals, grouped) for counts; formatCurrency (2 decimals) for money;
    // fmtPercent(x, 0) for the budget percentage and fmtPercent(x, 1) for the error rate.
    private const int CountDecimals = 0;
    private const int CostDecimals = 2;
    private const int BudgetPercentDecimals = 0;
    private const int ErrorPercentDecimals = 1;
    private const int TopServicesCap = 3;
    private const string CaptionSeparator = " \u00b7 ";

    /// <summary>The localized native chrome title (web surface is anonymous; native cards carry a header).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TitleKey, TitleFallback);
    }

    /// <summary>The localized empty-surface message (web <c>emptyMessage</c>).</summary>
    public static string EmptyMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(EmptyKey, EmptyFallback);
    }

    /// <summary>An empty display (no budget / bands / details / top-lists / banner / footer) — the seed.</summary>
    public static TeslaApiUsageDisplay EmptyDisplay() => new(
        null,
        Array.Empty<TeslaApiUsageBand>(),
        Array.Empty<TeslaApiUsageDetail>(),
        Array.Empty<TeslaApiUsageTopList>(),
        null,
        Array.Empty<TeslaApiUsageFooterLink>());

    /// <summary>
    /// Project <paramref name="overview"/> into the render-ready display. Caller guarantees the overview has
    /// usage (<see cref="TeslaApiUsageOverview.HasUsage"/>); the loading / empty branches are surfaced by the
    /// view-model state, not here.
    /// </summary>
    /// <param name="overview">The combined usage overview (must carry the spend snapshot).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="now">The wall-clock instant the billing-window maths are computed against.</param>
    /// <param name="currencySymbol">The currency symbol for money values; defaults to "$" when null/blank.</param>
    public static TeslaApiUsageDisplay Project(
        TeslaApiUsageOverview overview,
        ILocalizer localizer,
        DateTimeOffset now,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(overview);
        ArgumentNullException.ThrowIfNull(localizer);

        ApiUsageSnapshot snapshot = overview.Snapshot ?? new ApiUsageSnapshot(0, 0, 0, 0, 0, 0);
        ApiLogStats? stats = overview.Stats;
        string symbol = string.IsNullOrWhiteSpace(currencySymbol) ? DefaultCurrencySymbol : currencySymbol;

        var window = BillingWindow.For(now);
        double pctOfBudget = snapshot.MonthlyCredit > 0
            ? snapshot.EstimatedCost / snapshot.MonthlyCredit * 100d
            : 0d;
        double dailyAvgCost = snapshot.EstimatedCost / window.DaysElapsed;
        double last24h = stats?.Last24h ?? 0d;
        double last24hBurn = last24h * snapshot.CostPerRequest;
        double forecastFromMtd = dailyAvgCost * window.TotalDays;
        double forecastFromRecent = last24hBurn * window.TotalDays;
        bool overBudget = snapshot.EstimatedCost > snapshot.MonthlyCredit;

        TeslaApiUsageIntent budgetIntent = overBudget
            ? TeslaApiUsageIntent.Danger
            : pctOfBudget > BudgetWarnThreshold ? TeslaApiUsageIntent.Warn : TeslaApiUsageIntent.Normal;

        return new TeslaApiUsageDisplay(
            BuildBudget(snapshot, localizer, symbol, window, pctOfBudget, budgetIntent),
            BuildBands(snapshot, stats, localizer, symbol, dailyAvgCost, last24hBurn, forecastFromMtd, forecastFromRecent),
            BuildDetails(snapshot, stats, localizer),
            BuildTopLists(stats, localizer),
            overBudget ? BuildOverBudgetBanner(snapshot, localizer, symbol) : null,
            BuildFooter(localizer));
    }

    private static TeslaApiUsageBudget BuildBudget(
        ApiUsageSnapshot snapshot,
        ILocalizer localizer,
        string symbol,
        BillingWindow window,
        double pctOfBudget,
        TeslaApiUsageIntent intent)
    {
        string headline = Fmt(
            localizer.GetString(BudgetHeadlineKey, BudgetHeadlineFallback),
            Currency(snapshot.EstimatedCost, symbol),
            Currency(snapshot.MonthlyCredit, symbol));
        string rightLabel = Fmt(
            localizer.GetString(BudgetRightLabelKey, BudgetRightLabelFallback),
            Percent(pctOfBudget, BudgetPercentDecimals));

        string resets = window.DaysRemaining == 0
            ? localizer.GetString(ResetsTomorrowKey, ResetsTomorrowFallback)
            : window.DaysRemaining == 1
                ? Fmt(localizer.GetString(ResetsInDayKey, ResetsInDayFallback), window.DaysRemaining)
                : Fmt(localizer.GetString(ResetsInDaysKey, ResetsInDaysFallback), window.DaysRemaining);
        string caption = Fmt(localizer.GetString(DayOfKey, DayOfFallback), window.DaysElapsed, window.TotalDays)
            + CaptionSeparator + resets;

        string ariaLabel = localizer.GetString(BudgetAriaKey, BudgetAriaFallback);
        string automation = Fmt("{0}: {1}", ariaLabel, Percent(pctOfBudget, BudgetPercentDecimals));

        return new TeslaApiUsageBudget(headline, rightLabel, caption, pctOfBudget, intent, ariaLabel, automation);
    }

    private static List<TeslaApiUsageBand> BuildBands(
        ApiUsageSnapshot snapshot,
        ApiLogStats? stats,
        ILocalizer localizer,
        string symbol,
        double dailyAvgCost,
        double last24hBurn,
        double forecastFromMtd,
        double forecastFromRecent)
    {
        string requestsUnit = localizer.GetString(RequestsUnitKey, RequestsUnitFallback);

        string thisMonthLabel = localizer.GetString(ThisMonthKey, ThisMonthFallback);
        string thisMonthValue = Count(snapshot.TotalRequests);
        string thisMonthSub = Fmt(localizer.GetString(DayAvgKey, DayAvgFallback), Currency(dailyAvgCost, symbol));

        string last24hLabel = localizer.GetString(Last24hKey, Last24hFallback);
        string last24hValue = stats?.Last24h is { } l24 ? Count(l24) : EmDash;
        string last24hSub = Fmt(localizer.GetString(DayBurnKey, DayBurnFallback), Currency(last24hBurn, symbol));

        string forecastLabel = localizer.GetString(ForecastKey, ForecastFallback);
        string forecastValue = Currency(forecastFromMtd, symbol);
        string forecastSub = Fmt(localizer.GetString(RecentRateKey, RecentRateFallback), Currency(forecastFromRecent, symbol));
        TeslaApiUsageIntent forecastIntent = forecastFromMtd > snapshot.MonthlyCredit
            ? TeslaApiUsageIntent.Danger
            : TeslaApiUsageIntent.Normal;

        return new List<TeslaApiUsageBand>(3)
        {
            new(thisMonthLabel, thisMonthValue, requestsUnit, thisMonthSub, TeslaApiUsageIntent.Normal,
                BandAutomationName(thisMonthLabel, thisMonthValue, requestsUnit, thisMonthSub)),
            new(last24hLabel, last24hValue, requestsUnit, last24hSub, TeslaApiUsageIntent.Normal,
                BandAutomationName(last24hLabel, last24hValue, requestsUnit, last24hSub)),
            new(forecastLabel, forecastValue, string.Empty, forecastSub, forecastIntent,
                BandAutomationName(forecastLabel, forecastValue, string.Empty, forecastSub)),
        };
    }

    private static List<TeslaApiUsageDetail> BuildDetails(
        ApiUsageSnapshot snapshot,
        ApiLogStats? stats,
        ILocalizer localizer)
    {
        string usefulLabel = localizer.GetString(UsefulKey, UsefulFallback);
        string usefulValue = Count(snapshot.TotalRequests - snapshot.SkippedPolls);

        string skippedLabel = localizer.GetString(SkippedKey, SkippedFallback);
        string skippedValue = Count(snapshot.SkippedPolls);

        string latencyLabel = localizer.GetString(AvgLatencyKey, AvgLatencyFallback);
        string latencyValue = stats?.AvgDurationMs is { } ms
            ? Fmt(localizer.GetString(MsKey, MsFallback), Count(Math.Round(ms, MidpointRounding.AwayFromZero)))
            : EmDash;

        string errorRateLabel = localizer.GetString(ErrorRateKey, ErrorRateFallback);
        double? errorPct = stats?.ErrorRate;
        string errorRateValue = errorPct is { } pct
            ? Percent(pct, ErrorPercentDecimals) + (stats?.ErrorCount is { } ec ? $" ({Count(ec)})" : string.Empty)
            : EmDash;
        TeslaApiUsageIntent errorIntent = errorPct switch
        {
            { } p when p >= ErrorDangerThreshold => TeslaApiUsageIntent.Danger,
            { } p when p >= ErrorWarnThreshold => TeslaApiUsageIntent.Warn,
            _ => TeslaApiUsageIntent.Normal,
        };

        return new List<TeslaApiUsageDetail>(4)
        {
            new(usefulLabel, usefulValue, TeslaApiUsageIntent.Normal, DetailAutomationName(usefulLabel, usefulValue)),
            new(skippedLabel, skippedValue, TeslaApiUsageIntent.Normal, DetailAutomationName(skippedLabel, skippedValue)),
            new(latencyLabel, latencyValue, TeslaApiUsageIntent.Normal, DetailAutomationName(latencyLabel, latencyValue)),
            new(errorRateLabel, errorRateValue, errorIntent, DetailAutomationName(errorRateLabel, errorRateValue)),
        };
    }

    private static List<TeslaApiUsageTopList> BuildTopLists(ApiLogStats? stats, ILocalizer localizer)
    {
        var lists = new List<TeslaApiUsageTopList>(2);
        if (stats is null)
        {
            return lists;
        }

        var topServices = stats.ByService
            .OrderByDescending(g => g.Count)
            .Take(TopServicesCap)
            .ToList();
        if (topServices.Count > 0)
        {
            lists.Add(new TeslaApiUsageTopList(
                "services",
                localizer.GetString(TopServicesKey, TopServicesFallback),
                topServices.Select(BuildTopListItem).ToList()));
        }

        var methods = stats.ByMethod
            .OrderByDescending(g => g.Count)
            .ToList();
        if (methods.Count > 0)
        {
            lists.Add(new TeslaApiUsageTopList(
                "methods",
                localizer.GetString(ByMethodKey, ByMethodFallback),
                methods.Select(BuildTopListItem).ToList()));
        }

        return lists;
    }

    private static TeslaApiUsageTopListItem BuildTopListItem(ApiUsageGroup group)
    {
        string value = Count(group.Count);
        return new TeslaApiUsageTopListItem(
            group.Name,
            group.Name,
            value,
            Fmt("{0}: {1}", group.Name, value));
    }

    private static TeslaApiUsageBanner BuildOverBudgetBanner(
        ApiUsageSnapshot snapshot,
        ILocalizer localizer,
        string symbol)
    {
        string description = Fmt(
            localizer.GetString(OverBudgetDescKey, OverBudgetDescFallback),
            Currency(snapshot.MonthlyCredit, symbol),
            Currency(snapshot.EstimatedCost - snapshot.MonthlyCredit, symbol));
        return new TeslaApiUsageBanner(
            localizer.GetString(OverBudgetTitleKey, OverBudgetTitleFallback),
            description,
            TeslaApiUsageIntent.Danger);
    }

    private static List<TeslaApiUsageFooterLink> BuildFooter(ILocalizer localizer)
    {
        string logs = localizer.GetString(FooterLogsKey, FooterLogsFallback);
        string tesla = localizer.GetString(FooterTeslaKey, FooterTeslaFallback);
        return new List<TeslaApiUsageFooterLink>(2)
        {
            new("logs", ApiLogsRoute, logs, true, logs),
            new("tesla", TeslaAccountRoute, tesla, false, tesla),
        };
    }

    private static string BandAutomationName(string label, string value, string unit, string sub)
    {
        string head = string.IsNullOrEmpty(unit)
            ? Fmt("{0}: {1}", label, value)
            : Fmt("{0}: {1} {2}", label, value, unit);
        return Fmt("{0}, {1}", head, sub);
    }

    private static string DetailAutomationName(string label, string value) => Fmt("{0}: {1}", label, value);

    private static string Count(double value) => ScalarFormatters.FormatNumber(value, CountDecimals, EmDash);

    private static string Currency(double value, string symbol) =>
        ScalarFormatters.FormatCurrency(value, symbol, CostDecimals, EmDash);

    private static string Percent(double value, int decimals) =>
        ScalarFormatters.FormatPercentage(value, decimals, EmDash);

    private static string Fmt(string format, params object[] args) =>
        string.Format(CultureInfo.CurrentCulture, format, args);
}

/// <summary>
/// The current calendar-month billing window the budget maths run against — the native analogue of the web
/// <c>startOfMonth</c> / <c>endOfMonth</c> / days-elapsed / days-remaining derivation. Computed from a
/// supplied wall-clock instant so it is deterministic in tests.
/// </summary>
/// <param name="TotalDays">Days in the current month (web <c>totalDaysInMonth</c>).</param>
/// <param name="DaysElapsed">Whole days elapsed since the first of the month, floored at one (web <c>daysElapsed</c>).</param>
/// <param name="DaysRemaining">Days left in the month, floored at zero (web <c>daysRemaining</c>).</param>
public readonly record struct BillingWindow(int TotalDays, int DaysElapsed, int DaysRemaining)
{
    /// <summary>Compute the billing window for <paramref name="now"/> using its own offset (web uses local time).</summary>
    public static BillingWindow For(DateTimeOffset now)
    {
        var monthStart = new DateTimeOffset(now.Year, now.Month, 1, 0, 0, 0, now.Offset);
        int totalDays = DateTime.DaysInMonth(now.Year, now.Month);
        double elapsedDays = (now - monthStart).TotalDays;
        int daysElapsed = Math.Max(1, (int)Math.Ceiling(elapsedDays));
        int daysRemaining = Math.Max(0, totalDays - daysElapsed);
        return new BillingWindow(totalDays, daysElapsed, daysRemaining);
    }
}

/// <summary>
/// Canonical registry metadata for the Tesla API usage card surface — the native mirror of the web component
/// (web/src/features/system/components/status/TeslaApiUsageCard.tsx, rendered on the System Status page).
/// Centralises the stable id, category and diagnostics slug so the view and view-model stay free of literal
/// identifiers.
/// </summary>
public static class TeslaApiUsageRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "tesla-api-usage-card";

    /// <summary>Surface category (matches the web system feature).</summary>
    public const string Category = "system";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "TeslaApiUsageCard";
}

/// <summary>
/// PII-safe diagnostics for the Tesla API usage card surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a request count, cost or account
/// subject — so a diagnostics line can never leak usage data. Thread-safe.
/// </summary>
public sealed class TeslaApiUsageDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to, or null.</param>
    public TeslaApiUsageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TeslaApiUsageCard</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TeslaApiUsageRegistration.Slug}");
    }
}

/// <summary>
/// Tolerant JSON readers shared by the Tesla API usage DTO parsers — null / non-object / non-numeric inputs
/// coalesce rather than throw, mirroring the web's per-field optional reads. Internal so the parse adapters
/// stay the public surface.
/// </summary>
internal static class TeslaApiUsageJson
{
    public static double? ReadDouble(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var d) => d,
            JsonValueKind.String when double.TryParse(
                v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    public static IReadOnlyList<ApiUsageGroup> ReadGroups(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object ||
            !obj.TryGetProperty(name, out var map) ||
            map.ValueKind != JsonValueKind.Object)
        {
            return Array.Empty<ApiUsageGroup>();
        }

        var groups = new List<ApiUsageGroup>();
        foreach (var property in map.EnumerateObject())
        {
            double? value = property.Value.ValueKind switch
            {
                JsonValueKind.Number when property.Value.TryGetDouble(out var d) => d,
                JsonValueKind.String when double.TryParse(
                    property.Value.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s) => s,
                _ => null,
            };
            if (value is { } count)
            {
                groups.Add(new ApiUsageGroup(property.Name, count));
            }
        }

        return groups;
    }
}
