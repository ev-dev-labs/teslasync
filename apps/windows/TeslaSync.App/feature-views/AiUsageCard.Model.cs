using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state the operator-grade Helix usage card can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the surface renders. The web component
/// (web/src/features/system/components/status/AiUsageCard.tsx) reads three TanStack queries
/// (<c>useAiUsageToday</c>, <c>useAiUsageByFeature</c>, <c>useAiUsageRecent</c>) and gates the whole card on
/// today's rollup: it shows a "Loading Helix usage…" surface while today is still loading, a
/// "No Helix calls yet…" surface when today is absent or has zero calls, and the full bands / details /
/// top-lists composition otherwise. The native feature-view owns those three reads through one
/// cache-then-network stream and therefore renders the full state matrix the P2 contract mandates — every
/// branch maps onto a visible surface, none is hidden.
/// </summary>
public enum AiUsageDetailState
{
    /// <summary>Initial fetch with no cached overview — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh (or non-stale cached) overview with today's call / token / cost figures.</summary>
    Loaded,

    /// <summary>Today is absent or reported zero calls — render the friendly empty surface.</summary>
    Empty,

    /// <summary>The today read failed and no cached overview exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached overview older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached overview remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// Visual intent driving accent colour for bands and detail values — the native analogue of the web
/// <c>UsageCardIntent</c> ('normal' | 'warn' | 'danger'). <see cref="Warn"/> tints amber and
/// <see cref="Danger"/> tints red; <see cref="Normal"/> stays on the neutral surface.
/// </summary>
public enum AiUsageIntent
{
    /// <summary>No semantic colour — neutral surface / primary text.</summary>
    Normal,

    /// <summary>A soft warning — amber tint (web <c>warn</c>).</summary>
    Warn,

    /// <summary>A hard warning — red tint (web <c>danger</c>).</summary>
    Danger,
}

/// <summary>
/// Today's per-user AI usage rollup from <c>GET /ai/usage/today</c> the card consumes — the native analogue
/// of the <c>AiUsageToday</c> DTO the web <c>useAiUsageToday</c> hook returns (mirrors the Go DTOs in
/// internal/api/ai_usage_handler.go / internal/database/ai_call_log_repo.go). Field names mirror the API's
/// snake_case JSON tags (<c>call_count</c>, <c>input_tokens</c>, <c>output_tokens</c>,
/// <c>cost_micro_cents</c>, <c>error_count</c>, <c>avg_latency_ms</c>). The handler returns an all-zeros
/// payload when nothing has been audited yet, so a present-but-zero object is a valid snapshot (the card
/// then shows its empty surface, matching the web <c>call_count === 0</c> gate). Parsing is null-tolerant so
/// a partial body never throws.
/// </summary>
/// <param name="CallCount">Number of AI calls today (web <c>today.call_count</c>).</param>
/// <param name="InputTokens">Prompt tokens consumed today (web <c>today.input_tokens</c>).</param>
/// <param name="OutputTokens">Completion tokens produced today (web <c>today.output_tokens</c>).</param>
/// <param name="CostMicroCents">Estimated cost today in micro-cents (web <c>today.cost_micro_cents</c>).</param>
/// <param name="ErrorCount">Number of failed calls today (web <c>today.error_count</c>).</param>
/// <param name="AvgLatencyMs">Average call latency today in milliseconds (web <c>today.avg_latency_ms</c>).</param>
public sealed record AiUsageTodayStats(
    double CallCount,
    double InputTokens,
    double OutputTokens,
    double CostMicroCents,
    double ErrorCount,
    double AvgLatencyMs)
{
    /// <summary>Micro-cents per US dollar — the web cost divisor (<c>1_000_000</c>).</summary>
    public const double MicroCentsPerDollar = 1_000_000d;

    /// <summary>An all-zero rollup — the projection seed before the first emission.</summary>
    public static AiUsageTodayStats Empty { get; } = new(0, 0, 0, 0, 0, 0);

    /// <summary>Total tokens today (web <c>input_tokens + output_tokens</c>).</summary>
    [JsonIgnore]
    public double TotalTokens => InputTokens + OutputTokens;

    /// <summary>
    /// Estimated cost today in dollars from micro-cents (web <c>cost_micro_cents / 1_000_000</c>).
    /// Non-finite micro-cents coalesce to zero, matching the web guard.
    /// </summary>
    [JsonIgnore]
    public double CostDollars =>
        double.IsFinite(CostMicroCents) ? CostMicroCents / MicroCentsPerDollar : 0d;

    /// <summary>
    /// The web error intent: <c>danger</c> when at least 5% of calls errored, <c>warn</c> when any errored,
    /// else <c>normal</c> — only meaningful once at least one call ran.
    /// </summary>
    [JsonIgnore]
    public AiUsageIntent ErrorIntent =>
        ErrorCount > 0 && CallCount > 0
            ? (ErrorCount / CallCount >= 0.05 ? AiUsageIntent.Danger : AiUsageIntent.Warn)
            : AiUsageIntent.Normal;

    /// <summary>
    /// Project a <c>GET /ai/usage/today</c> response into a tolerant rollup. Returns <see langword="null"/>
    /// when the body is not a JSON object — the native analogue of the web <c>today</c> being absent (the
    /// empty surface). Any object yields a snapshot; absent or non-numeric fields coalesce to zero.
    /// </summary>
    public static AiUsageTodayStats? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new AiUsageTodayStats(
            CallCount: AiUsageJson.ReadDouble(root, "call_count") ?? 0,
            InputTokens: AiUsageJson.ReadDouble(root, "input_tokens") ?? 0,
            OutputTokens: AiUsageJson.ReadDouble(root, "output_tokens") ?? 0,
            CostMicroCents: AiUsageJson.ReadDouble(root, "cost_micro_cents") ?? 0,
            ErrorCount: AiUsageJson.ReadDouble(root, "error_count") ?? 0,
            AvgLatencyMs: AiUsageJson.ReadDouble(root, "avg_latency_ms") ?? 0);
    }
}

/// <summary>
/// One per-feature usage row from <c>GET /ai/usage/by-feature</c> — the native analogue of the web
/// <c>AiUsageFeatureRow</c>. Only <see cref="FeatureId"/> and <see cref="CallCount"/> feed the rendered
/// "By feature" top-list, but the remaining figures are parsed for completeness and round-trip through the
/// cache losslessly.
/// </summary>
/// <param name="FeatureId">The feature identifier (web <c>feature_id</c>).</param>
/// <param name="CallCount">Calls attributed to this feature in the window (web <c>call_count</c>).</param>
/// <param name="InputTokens">Prompt tokens for this feature (web <c>input_tokens</c>).</param>
/// <param name="OutputTokens">Completion tokens for this feature (web <c>output_tokens</c>).</param>
/// <param name="CostMicroCents">Cost for this feature in micro-cents (web <c>cost_micro_cents</c>).</param>
/// <param name="ErrorCount">Failed calls for this feature (web <c>error_count</c>).</param>
public sealed record AiUsageFeatureStat(
    string FeatureId,
    double CallCount,
    double InputTokens,
    double OutputTokens,
    double CostMicroCents,
    double ErrorCount)
{
    /// <summary>
    /// Parse the <c>{ since, rows: [...] }</c> envelope into the feature rows, tolerating an absent or
    /// non-array <c>rows</c> (the web <c>data?.rows ?? []</c> guard). Rows without a feature id are dropped.
    /// </summary>
    public static IReadOnlyList<AiUsageFeatureStat> ListFromResponse(JsonElement root)
    {
        var rows = new List<AiUsageFeatureStat>();
        foreach (var row in AiUsageJson.EnumerateRows(root))
        {
            string? id = AiUsageJson.ReadString(row, "feature_id");
            if (string.IsNullOrEmpty(id))
            {
                continue;
            }

            rows.Add(new AiUsageFeatureStat(
                FeatureId: id,
                CallCount: AiUsageJson.ReadDouble(row, "call_count") ?? 0,
                InputTokens: AiUsageJson.ReadDouble(row, "input_tokens") ?? 0,
                OutputTokens: AiUsageJson.ReadDouble(row, "output_tokens") ?? 0,
                CostMicroCents: AiUsageJson.ReadDouble(row, "cost_micro_cents") ?? 0,
                ErrorCount: AiUsageJson.ReadDouble(row, "error_count") ?? 0));
        }

        return rows;
    }
}

/// <summary>
/// One recent AI call row from <c>GET /ai/usage/recent</c> — the native analogue of the web
/// <c>AiUsageRecentRow</c>. The card summarises each row as
/// "{feature} · {model} · {tokens} tok · {relative time}" with a success / failure marker.
/// </summary>
/// <param name="Id">The call's stable id (web <c>id</c>) — the top-list item key.</param>
/// <param name="FeatureId">The feature that issued the call (web <c>feature_id</c>).</param>
/// <param name="Model">The model name (web <c>model</c>).</param>
/// <param name="InputTokens">Prompt tokens for the call (web <c>input_tokens</c>).</param>
/// <param name="OutputTokens">Completion tokens for the call (web <c>output_tokens</c>).</param>
/// <param name="StartedAt">ISO-8601 UTC start timestamp (web <c>started_at</c>).</param>
/// <param name="Error">The error string, empty when the call succeeded (web <c>error</c>).</param>
public sealed record AiUsageRecentCall(
    long Id,
    string FeatureId,
    string Model,
    double InputTokens,
    double OutputTokens,
    string StartedAt,
    string Error)
{
    /// <summary>True when the call recorded an error (web <c>r.error ? '✗' : '✓'</c>).</summary>
    [JsonIgnore]
    public bool Failed => !string.IsNullOrEmpty(Error);

    /// <summary>Total tokens for the call (web <c>input_tokens + output_tokens</c>).</summary>
    [JsonIgnore]
    public double TotalTokens => InputTokens + OutputTokens;

    /// <summary>
    /// Parse the <c>{ limit, rows: [...] }</c> envelope into the recent rows, tolerating an absent or
    /// non-array <c>rows</c> (the web <c>data?.rows ?? []</c> guard).
    /// </summary>
    public static IReadOnlyList<AiUsageRecentCall> ListFromResponse(JsonElement root)
    {
        var rows = new List<AiUsageRecentCall>();
        foreach (var row in AiUsageJson.EnumerateRows(root))
        {
            rows.Add(new AiUsageRecentCall(
                Id: AiUsageJson.ReadLong(row, "id") ?? 0,
                FeatureId: AiUsageJson.ReadString(row, "feature_id") ?? string.Empty,
                Model: AiUsageJson.ReadString(row, "model") ?? string.Empty,
                InputTokens: AiUsageJson.ReadDouble(row, "input_tokens") ?? 0,
                OutputTokens: AiUsageJson.ReadDouble(row, "output_tokens") ?? 0,
                StartedAt: AiUsageJson.ReadString(row, "started_at") ?? string.Empty,
                Error: AiUsageJson.ReadString(row, "error") ?? string.Empty));
        }

        return rows;
    }
}

/// <summary>
/// The combined usage overview the card renders — today's rollup (the primary read that drives the card
/// state) plus the supplementary per-feature and recent-call breakdowns. The web composes these from three
/// independent queries where today gates the surface and the breakdowns are best-effort
/// (<c>data?.rows ?? []</c>); the native source folds them into this one cache-then-network value so the
/// engine can serve it stale / offline as a unit. Round-trips losslessly through the cache.
/// </summary>
public sealed record AiUsageOverview
{
    /// <summary>Creates an overview, normalising null breakdown lists to empty so callers never null-check.</summary>
    /// <param name="today">Today's rollup, or null when the today read returned no object.</param>
    /// <param name="features">The per-feature breakdown rows (best-effort; empty when unavailable).</param>
    /// <param name="recent">The recent-call rows (best-effort; empty when unavailable).</param>
    [JsonConstructor]
    public AiUsageOverview(
        AiUsageTodayStats? today,
        IReadOnlyList<AiUsageFeatureStat>? features,
        IReadOnlyList<AiUsageRecentCall>? recent)
    {
        Today = today;
        Features = features ?? Array.Empty<AiUsageFeatureStat>();
        Recent = recent ?? Array.Empty<AiUsageRecentCall>();
    }

    /// <summary>Today's usage rollup, or null when the today read returned no object.</summary>
    public AiUsageTodayStats? Today { get; init; }

    /// <summary>The per-feature breakdown rows (never null).</summary>
    public IReadOnlyList<AiUsageFeatureStat> Features { get; init; }

    /// <summary>The recent-call rows (never null).</summary>
    public IReadOnlyList<AiUsageRecentCall> Recent { get; init; }

    /// <summary>An empty overview — the view-model seed before the first emission.</summary>
    public static AiUsageOverview Empty { get; } = new(null, null, null);

    /// <summary>
    /// True when there is usage to show — the web gate <c>today &amp;&amp; today.call_count !== 0</c>.
    /// A present-but-zero-call rollup is treated as empty, matching the web's empty surface.
    /// </summary>
    [JsonIgnore]
    public bool HasUsage => Today is not null && Today.CallCount > 0;
}

/// <summary>
/// One at-a-glance band rendered in the three-column grid (web <c>UsageCardBand</c>). The
/// <see cref="Value"/> is the large headline; the optional <see cref="Unit"/> is the smaller muted suffix
/// ("calls" / "total"); <see cref="Sub"/> is the grey subtitle; <see cref="Intent"/> tints the band; and
/// <see cref="AutomationName"/> joins them so Narrator reads the band as one phrase.
/// </summary>
/// <param name="Label">The localized band label (web <c>label</c>).</param>
/// <param name="Value">The formatted headline value.</param>
/// <param name="Unit">The localized unit suffix, or empty when the value stands alone.</param>
/// <param name="Sub">The localized subtitle line.</param>
/// <param name="Intent">The band's visual intent.</param>
/// <param name="AutomationName">The composed Narrator phrase for the band.</param>
public sealed record AiUsageDetailBand(
    string Label,
    string Value,
    string Unit,
    string Sub,
    AiUsageIntent Intent,
    string AutomationName);

/// <summary>
/// One key/value cell in the detail grid (web <c>UsageCardDetail</c>). <see cref="Intent"/> colours the
/// value text; <see cref="AutomationName"/> reads the label/value pair as one phrase.
/// </summary>
/// <param name="Label">The localized metric label (web <c>label</c>).</param>
/// <param name="Value">The formatted metric value.</param>
/// <param name="Intent">The value's visual intent.</param>
/// <param name="AutomationName">The composed Narrator phrase for the metric.</param>
public sealed record AiUsageDetailMetric(
    string Label,
    string Value,
    AiUsageIntent Intent,
    string AutomationName);

/// <summary>
/// One row in a top-list breakdown (web <c>UsageCardTopListItem</c>). <see cref="Label"/> is the
/// left-aligned name and <see cref="Value"/> the right-aligned figure / marker; <see cref="AutomationName"/>
/// spells the pair out for Narrator (e.g. the ✓ / ✗ marker becomes "succeeded" / "failed").
/// </summary>
/// <param name="Key">The stable item key.</param>
/// <param name="Label">The localized / composed left-aligned label.</param>
/// <param name="Value">The right-aligned figure or status marker.</param>
/// <param name="AutomationName">The composed Narrator phrase for the row.</param>
public sealed record AiUsageDetailTopListItem(
    string Key,
    string Label,
    string Value,
    string AutomationName);

/// <summary>
/// One top-list block (web <c>UsageCardTopList</c>): a titled list of <see cref="Items"/>.
/// </summary>
/// <param name="Key">The stable block key ("features" / "recent").</param>
/// <param name="Title">The localized block title.</param>
/// <param name="Items">The block's rows.</param>
public sealed record AiUsageDetailTopList(
    string Key,
    string Title,
    IReadOnlyList<AiUsageDetailTopListItem> Items);

/// <summary>
/// The render-ready view of the usage card — everything the WinUI view needs to draw without flashing a
/// blank box: the three at-a-glance <see cref="Bands"/>, the four-cell <see cref="Details"/> grid and the
/// optional <see cref="TopLists"/>. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Bands">The three at-a-glance bands, in web order.</param>
/// <param name="Details">The four detail cells, in web order.</param>
/// <param name="TopLists">The optional top-list blocks (feature / recent), present only when non-empty.</param>
public sealed record AiUsageDetailDisplay(
    IReadOnlyList<AiUsageDetailBand> Bands,
    IReadOnlyList<AiUsageDetailMetric> Details,
    IReadOnlyList<AiUsageDetailTopList> TopLists);

/// <summary>
/// Pure projection from a parsed <see cref="AiUsageOverview"/> to the render-ready
/// <see cref="AiUsageDetailDisplay"/> — the native port of the JSX + <c>useFormatting</c> composition in
/// web/src/features/system/components/status/AiUsageCard.tsx. Every label resolves through the i18n facade;
/// token counts are grouped integers, the cost uses the active currency symbol, latency is a plain
/// (ungrouped) integer of milliseconds, and the recent-call summary reproduces the web
/// "{feature} · {model} · {tokens} tok · {relative}" line with the same relative-time tiers. No WinUI types
/// — unit-tested without a UI host.
/// </summary>
public static class AiUsageDetailProjection
{
    /// <summary>The long em-dash shown for an absent value (web em-dash sentinel).</summary>
    public const string EmDash = UnitFormatters.DefaultEmptyDisplay;

    /// <summary>The default currency symbol when the host supplies none (web <c>useFormatting</c> default "$").</summary>
    public const string DefaultCurrencySymbol = "$";

    /// <summary>The success marker shown for a healthy recent call (web <c>'✓'</c>).</summary>
    public const string SuccessMark = "\u2713";

    /// <summary>The failure marker shown for an errored recent call (web <c>'✗'</c>).</summary>
    public const string FailureMark = "\u2717";

    /// <summary>The middle-dot separator joining the recent-call summary segments (web <c>' · '</c>).</summary>
    public const string SummarySeparator = " \u00b7 ";

    // i18n keys + English fallbacks. The web surface hardcodes these strings (it is an anonymous card whose
    // title is supplied by the page); the native port routes every one through the i18n facade. Keys absent
    // from the catalog resolve to the English fallback, matching the established feature-view pattern.

    /// <summary>i18n key for the card title (native chrome; web title is page-supplied).</summary>
    public const string TitleKey = "translation.system.status.aiUsage.title";

    /// <summary>English fallback for <see cref="TitleKey"/>.</summary>
    public const string TitleFallback = "Helix usage";

    /// <summary>i18n key for the loading surface (web <c>"Loading Helix usage…"</c>).</summary>
    public const string LoadingKey = "translation.system.status.aiUsage.loading";

    /// <summary>English fallback for <see cref="LoadingKey"/>.</summary>
    public const string LoadingFallback = "Loading Helix usage\u2026";

    /// <summary>i18n key for the empty surface (web <c>"No Helix calls yet — turn on a feature to start."</c>).</summary>
    public const string EmptyKey = "translation.system.status.aiUsage.empty";

    /// <summary>English fallback for <see cref="EmptyKey"/>.</summary>
    public const string EmptyFallback = "No Helix calls yet \u2014 turn on a feature to start.";

    /// <summary>i18n key for the "Today" band label (web <c>'Today'</c>).</summary>
    public const string TodayLabelKey = "translation.system.status.aiUsage.today";

    /// <summary>English fallback for <see cref="TodayLabelKey"/>.</summary>
    public const string TodayLabelFallback = "Today";

    /// <summary>i18n key for the "Tokens" band label (web <c>'Tokens'</c>).</summary>
    public const string TokensLabelKey = "translation.system.status.aiUsage.tokens";

    /// <summary>English fallback for <see cref="TokensLabelKey"/>.</summary>
    public const string TokensLabelFallback = "Tokens";

    /// <summary>i18n key for the "Cost / latency" band label (web <c>'Cost / latency'</c>).</summary>
    public const string CostLatencyLabelKey = "translation.system.status.aiUsage.costLatency";

    /// <summary>English fallback for <see cref="CostLatencyLabelKey"/>.</summary>
    public const string CostLatencyLabelFallback = "Cost / latency";

    /// <summary>i18n key for the "calls" unit suffix (web <c>'calls'</c>).</summary>
    public const string CallsUnitKey = "translation.system.status.aiUsage.callsUnit";

    /// <summary>English fallback for <see cref="CallsUnitKey"/>.</summary>
    public const string CallsUnitFallback = "calls";

    /// <summary>i18n key for the "total" unit suffix (web <c>'total'</c>).</summary>
    public const string TotalUnitKey = "translation.system.status.aiUsage.totalUnit";

    /// <summary>English fallback for <see cref="TotalUnitKey"/>.</summary>
    public const string TotalUnitFallback = "total";

    /// <summary>i18n key for the singular errors sub ("{0} error"; web <c>error</c>).</summary>
    public const string ErrorsSingularKey = "translation.system.status.aiUsage.errorsSingular";

    /// <summary>English fallback for <see cref="ErrorsSingularKey"/>.</summary>
    public const string ErrorsSingularFallback = "{0} error";

    /// <summary>i18n key for the plural errors sub ("{0} errors"; web <c>errors</c>).</summary>
    public const string ErrorsPluralKey = "translation.system.status.aiUsage.errorsPlural";

    /// <summary>English fallback for <see cref="ErrorsPluralKey"/>.</summary>
    public const string ErrorsPluralFallback = "{0} errors";

    /// <summary>i18n key for the tokens in/out sub ("{0} in · {1} out").</summary>
    public const string TokensInOutKey = "translation.system.status.aiUsage.tokensInOut";

    /// <summary>English fallback for <see cref="TokensInOutKey"/>.</summary>
    public const string TokensInOutFallback = "{0} in \u00b7 {1} out";

    /// <summary>i18n key for the average-latency sub ("{0} ms avg").</summary>
    public const string MsAvgKey = "translation.system.status.aiUsage.msAvg";

    /// <summary>English fallback for <see cref="MsAvgKey"/>.</summary>
    public const string MsAvgFallback = "{0} ms avg";

    /// <summary>i18n key for the average-latency detail label (web <c>'Avg latency'</c>).</summary>
    public const string AvgLatencyLabelKey = "translation.system.status.aiUsage.avgLatency";

    /// <summary>English fallback for <see cref="AvgLatencyLabelKey"/>.</summary>
    public const string AvgLatencyLabelFallback = "Avg latency";

    /// <summary>i18n key for the milliseconds detail value ("{0} ms").</summary>
    public const string MsKey = "translation.system.status.aiUsage.ms";

    /// <summary>English fallback for <see cref="MsKey"/>.</summary>
    public const string MsFallback = "{0} ms";

    /// <summary>i18n key for the errors detail label (web <c>'Errors'</c>).</summary>
    public const string ErrorsLabelKey = "translation.system.status.aiUsage.errorsLabel";

    /// <summary>English fallback for <see cref="ErrorsLabelKey"/>.</summary>
    public const string ErrorsLabelFallback = "Errors";

    /// <summary>i18n key for the input-tokens detail label (web <c>'Input tokens'</c>).</summary>
    public const string InputTokensLabelKey = "translation.system.status.aiUsage.inputTokens";

    /// <summary>English fallback for <see cref="InputTokensLabelKey"/>.</summary>
    public const string InputTokensLabelFallback = "Input tokens";

    /// <summary>i18n key for the output-tokens detail label (web <c>'Output tokens'</c>).</summary>
    public const string OutputTokensLabelKey = "translation.system.status.aiUsage.outputTokens";

    /// <summary>English fallback for <see cref="OutputTokensLabelKey"/>.</summary>
    public const string OutputTokensLabelFallback = "Output tokens";

    /// <summary>i18n key for the "By feature (7 days)" top-list title (web <c>'By feature (7 days)'</c>).</summary>
    public const string ByFeatureTitleKey = "translation.system.status.aiUsage.byFeature";

    /// <summary>English fallback for <see cref="ByFeatureTitleKey"/>.</summary>
    public const string ByFeatureTitleFallback = "By feature (7 days)";

    /// <summary>i18n key for the "Recent calls" top-list title (web <c>'Recent calls'</c>).</summary>
    public const string RecentTitleKey = "translation.system.status.aiUsage.recent";

    /// <summary>English fallback for <see cref="RecentTitleKey"/>.</summary>
    public const string RecentTitleFallback = "Recent calls";

    /// <summary>i18n key for the recent-call token segment ("{0} tok").</summary>
    public const string TokSegmentKey = "translation.system.status.aiUsage.tokSegment";

    /// <summary>English fallback for <see cref="TokSegmentKey"/>.</summary>
    public const string TokSegmentFallback = "{0} tok";

    /// <summary>i18n key for the "seconds ago" relative tier ("{0}s ago").</summary>
    public const string SecondsAgoKey = "translation.system.status.aiUsage.secondsAgo";

    /// <summary>English fallback for <see cref="SecondsAgoKey"/>.</summary>
    public const string SecondsAgoFallback = "{0}s ago";

    /// <summary>i18n key for the "minutes ago" relative tier ("{0}m ago").</summary>
    public const string MinutesAgoKey = "translation.system.status.aiUsage.minutesAgo";

    /// <summary>English fallback for <see cref="MinutesAgoKey"/>.</summary>
    public const string MinutesAgoFallback = "{0}m ago";

    /// <summary>i18n key for the "hours ago" relative tier ("{0}h ago").</summary>
    public const string HoursAgoKey = "translation.system.status.aiUsage.hoursAgo";

    /// <summary>English fallback for <see cref="HoursAgoKey"/>.</summary>
    public const string HoursAgoFallback = "{0}h ago";

    /// <summary>i18n key for the "days ago" relative tier ("{0}d ago").</summary>
    public const string DaysAgoKey = "translation.system.status.aiUsage.daysAgo";

    /// <summary>English fallback for <see cref="DaysAgoKey"/>.</summary>
    public const string DaysAgoFallback = "{0}d ago";

    /// <summary>i18n key for the spoken success status of a recent call (Narrator only).</summary>
    public const string SucceededKey = "translation.system.status.aiUsage.succeeded";

    /// <summary>English fallback for <see cref="SucceededKey"/>.</summary>
    public const string SucceededFallback = "succeeded";

    /// <summary>i18n key for the spoken failure status of a recent call (Narrator only).</summary>
    public const string FailedKey = "translation.system.status.aiUsage.failed";

    /// <summary>English fallback for <see cref="FailedKey"/>.</summary>
    public const string FailedFallback = "failed";

    private const int CountDecimals = 0;
    private const int CostDecimals = 2;
    private const int TopListLimit = 5;

    /// <summary>The localized card title (native chrome).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TitleKey, TitleFallback);
    }

    /// <summary>The localized loading-surface message (web loading <c>emptyMessage</c>).</summary>
    public static string LoadingMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(LoadingKey, LoadingFallback);
    }

    /// <summary>The localized empty-surface message (web empty <c>emptyMessage</c>).</summary>
    public static string EmptyMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(EmptyKey, EmptyFallback);
    }

    /// <summary>
    /// Project <paramref name="overview"/> into the render-ready display. Caller guarantees the overview has
    /// usage (<see cref="AiUsageOverview.HasUsage"/>); the loading / empty branches are surfaced by the
    /// view-model state, not here.
    /// </summary>
    /// <param name="overview">The combined usage overview (must carry today's rollup).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="now">The wall-clock instant relative-time labels are computed against.</param>
    /// <param name="currencySymbol">The currency symbol for the cost band; defaults to "$" when null/blank.</param>
    public static AiUsageDetailDisplay Project(
        AiUsageOverview overview,
        ILocalizer localizer,
        DateTimeOffset now,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(overview);
        ArgumentNullException.ThrowIfNull(localizer);

        AiUsageTodayStats today = overview.Today ?? AiUsageTodayStats.Empty;
        string symbol = string.IsNullOrWhiteSpace(currencySymbol) ? DefaultCurrencySymbol : currencySymbol;

        return new AiUsageDetailDisplay(
            BuildBands(today, localizer, symbol),
            BuildDetails(today, localizer),
            BuildTopLists(overview, localizer, now));
    }

    /// <summary>An empty display (no bands / details / top-lists) — the loading and empty surfaces' seed.</summary>
    public static AiUsageDetailDisplay EmptyDisplay() => new(
        Array.Empty<AiUsageDetailBand>(),
        Array.Empty<AiUsageDetailMetric>(),
        Array.Empty<AiUsageDetailTopList>());

    private static List<AiUsageDetailBand> BuildBands(
        AiUsageTodayStats today,
        ILocalizer localizer,
        string symbol)
    {
        string todayLabel = localizer.GetString(TodayLabelKey, TodayLabelFallback);
        string tokensLabel = localizer.GetString(TokensLabelKey, TokensLabelFallback);
        string costLabel = localizer.GetString(CostLatencyLabelKey, CostLatencyLabelFallback);

        string callsValue = Count(today.CallCount);
        string callsUnit = localizer.GetString(CallsUnitKey, CallsUnitFallback);
        string errorsSub = Errors(today.ErrorCount, localizer);

        string tokensValue = Count(today.TotalTokens);
        string totalUnit = localizer.GetString(TotalUnitKey, TotalUnitFallback);
        string tokensSub = Format(
            localizer, TokensInOutKey, TokensInOutFallback, Count(today.InputTokens), Count(today.OutputTokens));

        string costValue = ScalarFormatters.FormatCurrency(today.CostDollars, symbol, CostDecimals, EmDash);
        string latencySub = Format(localizer, MsAvgKey, MsAvgFallback, PlainInt(today.AvgLatencyMs));

        return new List<AiUsageDetailBand>(3)
        {
            new(todayLabel, callsValue, callsUnit, errorsSub, today.ErrorIntent,
                BandName(todayLabel, callsValue, callsUnit, errorsSub)),
            new(tokensLabel, tokensValue, totalUnit, tokensSub, AiUsageIntent.Normal,
                BandName(tokensLabel, tokensValue, totalUnit, tokensSub)),
            new(costLabel, costValue, string.Empty, latencySub, AiUsageIntent.Normal,
                BandName(costLabel, costValue, string.Empty, latencySub)),
        };
    }

    private static List<AiUsageDetailMetric> BuildDetails(AiUsageTodayStats today, ILocalizer localizer)
    {
        string avgLatencyLabel = localizer.GetString(AvgLatencyLabelKey, AvgLatencyLabelFallback);
        string errorsLabel = localizer.GetString(ErrorsLabelKey, ErrorsLabelFallback);
        string inputLabel = localizer.GetString(InputTokensLabelKey, InputTokensLabelFallback);
        string outputLabel = localizer.GetString(OutputTokensLabelKey, OutputTokensLabelFallback);

        string avgLatencyValue = Format(localizer, MsKey, MsFallback, PlainInt(today.AvgLatencyMs));
        string errorsValue = Count(today.ErrorCount);
        string inputValue = Count(today.InputTokens);
        string outputValue = Count(today.OutputTokens);
        AiUsageIntent errorsIntent = today.ErrorCount > 0 ? AiUsageIntent.Danger : AiUsageIntent.Normal;

        return new List<AiUsageDetailMetric>(4)
        {
            new(avgLatencyLabel, avgLatencyValue, AiUsageIntent.Normal, MetricName(avgLatencyLabel, avgLatencyValue)),
            new(errorsLabel, errorsValue, errorsIntent, MetricName(errorsLabel, errorsValue)),
            new(inputLabel, inputValue, AiUsageIntent.Normal, MetricName(inputLabel, inputValue)),
            new(outputLabel, outputValue, AiUsageIntent.Normal, MetricName(outputLabel, outputValue)),
        };
    }

    private static List<AiUsageDetailTopList> BuildTopLists(
        AiUsageOverview overview,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        var lists = new List<AiUsageDetailTopList>(2);

        if (overview.Features.Count > 0)
        {
            var items = overview.Features
                .OrderByDescending(f => f.CallCount)
                .Take(TopListLimit)
                .Select(f =>
                {
                    string value = Count(f.CallCount);
                    return new AiUsageDetailTopListItem(
                        f.FeatureId, f.FeatureId, value, MetricName(f.FeatureId, value));
                })
                .ToList();
            lists.Add(new AiUsageDetailTopList(
                "features", localizer.GetString(ByFeatureTitleKey, ByFeatureTitleFallback), items));
        }

        if (overview.Recent.Count > 0)
        {
            var items = overview.Recent
                .Take(TopListLimit)
                .Select(r =>
                {
                    string label = SummarizeRecent(r, localizer, now);
                    string value = r.Failed ? FailureMark : SuccessMark;
                    string spoken = localizer.GetString(
                        r.Failed ? FailedKey : SucceededKey,
                        r.Failed ? FailedFallback : SucceededFallback);
                    return new AiUsageDetailTopListItem(
                        r.Id.ToString(CultureInfo.InvariantCulture),
                        label,
                        value,
                        string.Concat(label, ", ", spoken));
                })
                .ToList();
            lists.Add(new AiUsageDetailTopList(
                "recent", localizer.GetString(RecentTitleKey, RecentTitleFallback), items));
        }

        return lists;
    }

    /// <summary>
    /// Compose the recent-call summary line — the native port of the web <c>summarizeRecentRow</c>:
    /// "{feature} · {model} · {tokens} tok · {relative time}".
    /// </summary>
    internal static string SummarizeRecent(AiUsageRecentCall row, ILocalizer localizer, DateTimeOffset now)
    {
        string tokenSegment = Format(localizer, TokSegmentKey, TokSegmentFallback, Count(row.TotalTokens));
        string relative = RelativeTime(row.StartedAt, localizer, now);
        return string.Join(SummarySeparator, row.FeatureId, row.Model, tokenSegment, relative);
    }

    /// <summary>
    /// Format the relative age of an ISO-8601 timestamp — the native port of the web
    /// <c>formatRelativeTime</c> (seconds / minutes / hours / days tiers). An unparseable timestamp is
    /// returned verbatim, matching the web fallback.
    /// </summary>
    internal static string RelativeTime(string startedAt, ILocalizer localizer, DateTimeOffset now)
    {
        if (!DateTimeOffset.TryParse(
                startedAt,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var parsed))
        {
            return startedAt;
        }

        double ageMs = (now - parsed).TotalMilliseconds;
        if (ageMs < 60_000)
        {
            long seconds = Math.Max(0, RoundHalfUp(ageMs / 1000));
            return Format(localizer, SecondsAgoKey, SecondsAgoFallback, seconds.ToString(CultureInfo.InvariantCulture));
        }

        if (ageMs < 3_600_000)
        {
            return Format(localizer, MinutesAgoKey, MinutesAgoFallback, Tier(ageMs / 60_000));
        }

        if (ageMs < 86_400_000)
        {
            return Format(localizer, HoursAgoKey, HoursAgoFallback, Tier(ageMs / 3_600_000));
        }

        return Format(localizer, DaysAgoKey, DaysAgoFallback, Tier(ageMs / 86_400_000));
    }

    private static string Errors(double errorCount, ILocalizer localizer)
    {
        string formatted = Count(errorCount);
        bool singular = Math.Abs(errorCount - 1) < double.Epsilon;
        return singular
            ? Format(localizer, ErrorsSingularKey, ErrorsSingularFallback, formatted)
            : Format(localizer, ErrorsPluralKey, ErrorsPluralFallback, formatted);
    }

    private static string Count(double value) =>
        double.IsFinite(value) ? ScalarFormatters.FormatNumber(value, CountDecimals, EmDash) : EmDash;

    // Plain (ungrouped) integer of milliseconds — the web embeds Math.round(avg_latency_ms) directly into a
    // template literal, so there is no thousands grouping (unlike the grouped token counts).
    private static string PlainInt(double value) =>
        double.IsFinite(value)
            ? ((long)Math.Round(value, MidpointRounding.AwayFromZero)).ToString(CultureInfo.InvariantCulture)
            : EmDash;

    private static string Tier(double value) => RoundHalfUp(value).ToString(CultureInfo.InvariantCulture);

    // JS Math.round rounds half toward +Infinity; for the non-negative ages here that equals
    // round-half-away-from-zero.
    private static long RoundHalfUp(double value) => (long)Math.Floor(value + 0.5);

    private static string Format(ILocalizer localizer, string key, string fallback, params object[] args) =>
        string.Format(CultureInfo.CurrentCulture, localizer.GetString(key, fallback), args);

    private static string BandName(string label, string value, string unit, string sub)
    {
        string head = string.IsNullOrEmpty(unit) ? value : string.Concat(value, " ", unit);
        return string.Concat(label, ": ", head, ", ", sub);
    }

    private static string MetricName(string label, string value) => string.Concat(label, ": ", value);
}

/// <summary>
/// Canonical registry metadata for the operator Helix usage card surface — the native mirror of the web
/// component (web/src/features/system/components/status/AiUsageCard.tsx, rendered on the system status page).
/// Centralises the stable id, category and diagnostics slug so the view and view-model stay free of literal
/// identifiers.
/// </summary>
public static class AiUsageDetailRegistration
{
    /// <summary>Stable surface id (distinct from the settings <c>ai-usage-card</c>).</summary>
    public const string Id = "ai-usage-detail-card";

    /// <summary>Surface category (the system status feature).</summary>
    public const string Category = "system";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "AiUsageCard";
}

/// <summary>
/// PII-safe diagnostics for the operator Helix usage card surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a token count, cost, model name or
/// user subject — so a diagnostics line can never leak usage data. Thread-safe.
/// </summary>
public sealed class AiUsageDetailDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to, or null.</param>
    public AiUsageDetailDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AiUsageCard</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AiUsageDetailRegistration.Slug}");
    }
}

/// <summary>
/// Tolerant JSON readers shared by the usage DTO parsers — null / non-object / non-numeric inputs coalesce
/// rather than throw, mirroring the web's per-field optional reads. Internal so the parse adapters stay the
/// public surface.
/// </summary>
internal static class AiUsageJson
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

    public static long? ReadLong(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var l) => l,
            JsonValueKind.String when long.TryParse(
                v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    public static string? ReadString(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    }

    public static IEnumerable<JsonElement> EnumerateRows(JsonElement root)
    {
        JsonElement rows = root;
        if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("rows", out var inner))
        {
            rows = inner;
        }

        if (rows.ValueKind != JsonValueKind.Array)
        {
            yield break;
        }

        foreach (var row in rows.EnumerateArray())
        {
            if (row.ValueKind == JsonValueKind.Object)
            {
                yield return row;
            }
        }
    }
}
