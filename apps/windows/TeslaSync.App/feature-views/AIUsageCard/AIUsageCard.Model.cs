using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="AiUsageCardViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the surface renders. The web component
/// (web/src/features/settings/components/AIUsageCard.tsx) is a lightweight "at a glance" card that reads
/// <c>useAiUsageToday</c> (TanStack Query polled at <c>INTERVALS.STANDARD</c>) and degrades every
/// loading / empty / error branch to a long em-dash so the layout stays stable. The native
/// feature-view owns its own <c>/ai/usage/today</c> read and therefore renders the full state matrix the
/// P2 contract mandates: each branch maps onto a visible surface — none is hidden.
/// </summary>
public enum AiUsageCardState
{
    /// <summary>Initial fetch with no cached usage — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh (or non-stale cached) usage snapshot with today's token / cost figures.</summary>
    Loaded,

    /// <summary>The response carried no usage object — render the friendly empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached usage exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// Today's per-user AI usage rollup from <c>GET /ai/usage/today</c> the card consumes — the native analogue
/// of the <c>AiUsageToday</c> DTO the web <c>useAiUsageToday</c> hook returns (mirrors the Go DTOs in
/// internal/api/ai_usage_handler.go / internal/database/ai_call_log_repo.go). Field names mirror the API's
/// snake_case JSON tags (<c>call_count</c>, <c>input_tokens</c>, <c>output_tokens</c>,
/// <c>cost_micro_cents</c>). The handler returns an all-zeros payload when nothing has been audited yet, so a
/// present-but-zero object is a valid loaded snapshot (the card shows "0" / "$0.00"); a non-object body models
/// the absent <c>data</c> (the empty surface). Parsing is null-tolerant so a partial body never throws.
/// </summary>
/// <param name="CallCount">Number of AI calls today (web <c>data.call_count</c>).</param>
/// <param name="InputTokens">Prompt tokens consumed today (web <c>data.input_tokens</c>).</param>
/// <param name="OutputTokens">Completion tokens produced today (web <c>data.output_tokens</c>).</param>
/// <param name="CostMicroCents">Estimated cost today in micro-cents (web <c>data.cost_micro_cents</c>).</param>
public sealed record AiUsageToday(
    double CallCount,
    double InputTokens,
    double OutputTokens,
    double CostMicroCents)
{
    /// <summary>Micro-cents per US dollar — the web cost divisor (<c>1_000_000</c>).</summary>
    public const double MicroCentsPerDollar = 1_000_000d;

    /// <summary>An all-zero usage snapshot — the projection seed before the first emission.</summary>
    public static AiUsageToday Empty { get; } = new(0, 0, 0, 0);

    /// <summary>
    /// Estimated cost today in dollars (web <c>cost_micro_cents / 1_000_000</c>).
    /// Non-finite micro-cents coalesce to zero, matching the web guard.
    /// </summary>
    public double CostDollars =>
        double.IsFinite(CostMicroCents) ? CostMicroCents / MicroCentsPerDollar : 0d;

    /// <summary>
    /// Project a <c>GET /ai/usage/today</c> response into a tolerant snapshot. Returns <see langword="null"/>
    /// when the body is not a JSON object — the native analogue of the web <c>data</c> being absent (the empty
    /// surface). Any object yields a snapshot (matching the web's truthy gate); absent or non-numeric fields
    /// coalesce to zero like the web's per-field reads.
    /// </summary>
    public static AiUsageToday? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new AiUsageToday(
            CallCount: ReadDouble(root, "call_count") ?? 0,
            InputTokens: ReadDouble(root, "input_tokens") ?? 0,
            OutputTokens: ReadDouble(root, "output_tokens") ?? 0,
            CostMicroCents: ReadDouble(root, "cost_micro_cents") ?? 0);
    }

    private static double? ReadDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
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
}

/// <summary>
/// One render-ready usage cell — the native analogue of the web <c>UsageCell</c> (a muted label above a
/// medium-weight value). The <see cref="AutomationName"/> joins the label and value so Narrator reads the
/// pair as one phrase. Pure data so every field is asserted without a UI host.
/// </summary>
/// <param name="Label">The localized cell label (web <c>label</c> prop, e.g. "Tokens in").</param>
/// <param name="Value">The formatted cell value, or the long em-dash sentinel.</param>
/// <param name="AutomationName">The composed Narrator name for the cell ("{label}: {value}").</param>
public sealed record AiUsageCell(string Label, string Value, string AutomationName);

/// <summary>
/// The render-ready view of the usage card — everything the WinUI view needs to draw without ever flashing a
/// blank box. Holds the localized <see cref="Title"/> (web <c>&lt;Subhead&gt;Usage today&lt;/Subhead&gt;</c>),
/// the three <see cref="Cells"/> (Tokens in / Tokens out / Estimated cost), the <see cref="Caption"/> line
/// (the live "{n} Helix calls today." suffix or the empty-caption copy) and the <see cref="HasData"/> flag.
/// Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Title">The localized card title (web "Usage today").</param>
/// <param name="Cells">The three usage cells, in web order (tokens in, tokens out, estimated cost).</param>
/// <param name="Caption">The localized caption line beneath the cells.</param>
/// <param name="HasData">True when a usage snapshot is shown; false for the empty display.</param>
public sealed record AiUsageDisplay(
    string Title,
    IReadOnlyList<AiUsageCell> Cells,
    string Caption,
    bool HasData);

/// <summary>
/// Pure projection from a parsed <see cref="AiUsageToday"/> to the render-ready <see cref="AiUsageDisplay"/> —
/// the native port of the JSX + <c>t()</c> + <c>useFormatting</c> composition in
/// web/src/features/settings/components/AIUsageCard.tsx. Every label resolves through the i18n facade; the
/// three values are formatted exactly once here (token counts via grouped integers, the cost via the active
/// currency symbol from the micro-cents cost conversion); the caption reproduces the web
/// <c>call_count &gt; 0 ? "{n} Helix calls today." : empty</c> branch. No WinUI types — unit-tested
/// without a UI host.
/// </summary>
public static class AiUsageCardProjection
{
    /// <summary>The long em-dash shown for an absent value (web em-dash sentinel).</summary>
    public const string EmDash = "\u2014";

    /// <summary>The default currency symbol when the host supplies none (web <c>useFormatting</c> default "$").</summary>
    public const string DefaultCurrencySymbol = "$";

    /// <summary>i18n key for the card title (web <c>t('ai.settings.usage.title', 'Usage today')</c>).</summary>
    public const string TitleKey = "translation.ai.settings.usage.title";

    /// <summary>English fallback for <see cref="TitleKey"/> (web default).</summary>
    public const string TitleFallback = "Usage today";

    /// <summary>i18n key for the Tokens-in cell (web <c>t('ai.settings.usage.tokensIn', 'Tokens in')</c>).</summary>
    public const string TokensInKey = "translation.ai.settings.usage.tokensIn";

    /// <summary>English fallback for <see cref="TokensInKey"/> (web default).</summary>
    public const string TokensInFallback = "Tokens in";

    /// <summary>i18n key for the Tokens-out cell (web <c>t('ai.settings.usage.tokensOut', 'Tokens out')</c>).</summary>
    public const string TokensOutKey = "translation.ai.settings.usage.tokensOut";

    /// <summary>English fallback for <see cref="TokensOutKey"/> (web default).</summary>
    public const string TokensOutFallback = "Tokens out";

    /// <summary>i18n key for the Estimated-cost cell (web <c>t('ai.settings.usage.cost', 'Estimated cost')</c>).</summary>
    public const string CostKey = "translation.ai.settings.usage.cost";

    /// <summary>English fallback for <see cref="CostKey"/> (web default).</summary>
    public const string CostFallback = "Estimated cost";

    /// <summary>i18n key for the live caption suffix (web <c>t('ai.settings.usage.liveSuffix', 'Helix calls today.')</c>).</summary>
    public const string LiveSuffixKey = "translation.ai.settings.usage.liveSuffix";

    /// <summary>English fallback for <see cref="LiveSuffixKey"/> (web default).</summary>
    public const string LiveSuffixFallback = "Helix calls today.";

    /// <summary>i18n key for the empty-state caption (the web settings 'usage' empty copy).</summary>
    public const string EmptyCaptionKey = "translation.ai.settings.usage.placeholder"; // parity:allow web settings 'usage.placeholder' i18n key name

    /// <summary>English fallback for <see cref="EmptyCaptionKey"/> (web default).</summary>
    public const string EmptyCaptionFallback =
        "Usage populates as features run. Live numbers arrive in a follow-up update.";

    // web display precisions: fmtInt (0 decimals, grouped) for the token counts, formatCurrency(amount) which
    // defaults to the user's decimal precision (2) for the estimated cost.
    private const int CountDecimals = 0;
    private const int CostDecimals = 2;

    /// <summary>
    /// Project <paramref name="data"/> into the render-ready display using the active currency symbol. Token
    /// counts are grouped integers; the cost is the dollar amount derived from micro-cents formatted with the
    /// symbol; the caption shows "{n} Helix calls today." when at least one call ran, else the empty-caption copy.
    /// </summary>
    /// <param name="data">The parsed usage snapshot.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="currencySymbol">The currency symbol for the cost cell; defaults to "$" when null/blank.</param>
    public static AiUsageDisplay Project(AiUsageToday data, ILocalizer localizer, string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(localizer);

        string symbol = string.IsNullOrWhiteSpace(currencySymbol) ? DefaultCurrencySymbol : currencySymbol;

        string tokensInValue = ScalarFormatters.FormatNumber(data.InputTokens, CountDecimals, EmDash);
        string tokensOutValue = ScalarFormatters.FormatNumber(data.OutputTokens, CountDecimals, EmDash);
        string costValue = ScalarFormatters.FormatCurrency(data.CostDollars, symbol, CostDecimals, EmDash);

        var cells = BuildCells(localizer, tokensInValue, tokensOutValue, costValue);
        string caption = CaptionFor(data, localizer);

        return new AiUsageDisplay(localizer.GetString(TitleKey, TitleFallback), cells, caption, true);
    }

    /// <summary>
    /// An empty display (title + three em-dash cells + the empty-caption copy) — the web "no data"
    /// degradation, used as the view-model seed and for the loading / empty surfaces.
    /// </summary>
    public static AiUsageDisplay EmptyDisplay(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        var cells = BuildCells(localizer, EmDash, EmDash, EmDash);

        return new AiUsageDisplay(
            localizer.GetString(TitleKey, TitleFallback),
            cells,
            localizer.GetString(EmptyCaptionKey, EmptyCaptionFallback),
            false);
    }

    private static List<AiUsageCell> BuildCells(
        ILocalizer localizer,
        string tokensInValue,
        string tokensOutValue,
        string costValue)
    {
        string tokensInLabel = localizer.GetString(TokensInKey, TokensInFallback);
        string tokensOutLabel = localizer.GetString(TokensOutKey, TokensOutFallback);
        string costLabel = localizer.GetString(CostKey, CostFallback);

        return new List<AiUsageCell>(3)
        {
            new(tokensInLabel, tokensInValue, AutomationName(tokensInLabel, tokensInValue)),
            new(tokensOutLabel, tokensOutValue, AutomationName(tokensOutLabel, tokensOutValue)),
            new(costLabel, costValue, AutomationName(costLabel, costValue)),
        };
    }

    private static string CaptionFor(AiUsageToday data, ILocalizer localizer)
    {
        // web: data.call_count > 0 ? `${fmtInt(call_count)} Helix calls today.` : empty-caption copy.
        if (double.IsFinite(data.CallCount) && data.CallCount > 0)
        {
            string count = ScalarFormatters.FormatNumber(data.CallCount, CountDecimals, EmDash);
            string suffix = localizer.GetString(LiveSuffixKey, LiveSuffixFallback);
            return string.Format(CultureInfo.CurrentCulture, "{0} {1}", count, suffix);
        }

        return localizer.GetString(EmptyCaptionKey, EmptyCaptionFallback);
    }

    private static string AutomationName(string label, string value) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;AiUsageToday&gt;</c>, preserving every freshness flag (cached / refreshing / stale /
/// offline) so the view-model can render the full state matrix. A payload that is not a JSON object collapses
/// to <see cref="RepositoryResult{T}.Empty"/> — the web "no data" gate. Kept pure so the parse-and-preserve
/// contract is unit-tested without a network or cache.
/// </summary>
public static class AiUsageResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s usage payload (when present) while preserving its status.</summary>
    public static RepositoryResult<AiUsageToday> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        AiUsageToday? Parse() => raw.HasValue ? AiUsageToday.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<AiUsageToday>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<AiUsageToday>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<AiUsageToday>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<AiUsageToday>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<AiUsageToday>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<AiUsageToday>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<AiUsageToday>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<AiUsageToday>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<AiUsageToday>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<AiUsageToday>.Empty(raw.FetchedAt),
            _ => RepositoryResult<AiUsageToday>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the AI Usage card surface — the native mirror of the web component
/// (web/src/features/settings/components/AIUsageCard.tsx, rendered on the Helix settings panel). Centralises
/// the stable id, category and diagnostics slug so the view and view-model stay free of literal identifiers.
/// </summary>
public static class AiUsageCardRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "ai-usage-card";

    /// <summary>Surface category (matches the web settings feature).</summary>
    public const string Category = "settings";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "AIUsageCard";
}

/// <summary>
/// PII-safe diagnostics for the AI Usage card surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a token count, cost or user subject — so
/// a diagnostics line can never leak usage data. Thread-safe.
/// </summary>
public sealed class AiUsageCardDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to, or null.</param>
    public AiUsageCardDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AIUsageCard</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AiUsageCardRegistration.Slug}");
    }
}
