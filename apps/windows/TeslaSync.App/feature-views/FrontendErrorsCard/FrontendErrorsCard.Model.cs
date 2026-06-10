using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the frontend-errors surface. Every getter returns a
/// fallback rather than throwing so a partial or schema-drifted body from <c>GET /admin/web-errors/summary</c>
/// never aborts the parse (web parity: <c>FrontendErrorsCard.tsx</c> tolerates <c>data.total ?? 0</c> /
/// <c>data.top ?? []</c> / <c>entry.count ?? 0</c>). Kept private to the surface and free of WinUI types so the
/// parse is unit-tested without a UI host.
/// </summary>
internal static class FrontendErrorsJson
{
    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    /// <summary>The integer value of <paramref name="name"/>, tolerating a number or numeric-string field (0 fallback).</summary>
    public static long GetLong(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return 0;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetInt64(out var n) => n,
            JsonValueKind.Number when prop.TryGetDouble(out var d) => (long)Math.Round(d, MidpointRounding.AwayFromZero),
            JsonValueKind.String when long.TryParse(prop.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => 0,
        };
    }

    /// <summary>Parse an ISO-8601 timestamp string to a UTC-normalised instant, or null when unparseable.</summary>
    public static DateTimeOffset? TryParseTimestamp(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// One "top offender" row from <c>GET /admin/web-errors/summary</c> — the native analogue of the web
/// <c>WebErrorsSummaryEntry</c> shape (web/src/types/admin.ts): the originating component <see cref="Name"/>,
/// the <see cref="Route"/> it fired on and the rolling <see cref="Count"/>. Field names mirror the Go API's
/// snake_case JSON tags; parsing is null-tolerant so a partial row never throws. Pure data — unit-tested
/// without a UI host.
/// </summary>
public sealed record WebErrorOffender(string Name, string Route, long Count)
{
    /// <summary>Parse a single offender JSON object into a <see cref="WebErrorOffender"/>.</summary>
    public static WebErrorOffender FromJson(JsonElement obj) => new(
        Name: FrontendErrorsJson.GetString(obj, "name") ?? string.Empty,
        Route: FrontendErrorsJson.GetString(obj, "route") ?? string.Empty,
        Count: FrontendErrorsJson.GetLong(obj, "count"));

    /// <summary>Parse the <c>top</c> JSON array into a tolerant list (non-objects skipped).</summary>
    public static IReadOnlyList<WebErrorOffender> ParseList(JsonElement array)
    {
        if (array.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<WebErrorOffender>();
        }

        var list = new List<WebErrorOffender>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }
}

/// <summary>
/// The decoded envelope for <c>GET /admin/web-errors/summary</c> — the native analogue of the web
/// <c>WebErrorsSummary</c> (web/src/types/admin.ts). Holds the rolling-hour <see cref="Total"/> count, the
/// per-source <see cref="Top"/> offenders and the server-stamped <see cref="AsOf"/> instant. Parsing is
/// null-tolerant so a partial body never throws.
/// </summary>
public sealed record WebErrorsSummary(
    long Total,
    IReadOnlyList<WebErrorOffender> Top,
    string? AsOf)
{
    /// <summary>An empty summary (zero total, no offenders) — the parse / projection fallback.</summary>
    public static WebErrorsSummary Empty { get; } = new(0, Array.Empty<WebErrorOffender>(), null);

    /// <summary>The parsed server <c>as_of</c> instant, or null when absent / unparseable.</summary>
    public DateTimeOffset? AsOfInstant => FrontendErrorsJson.TryParseTimestamp(AsOf);

    /// <summary>Parse the web-errors summary response object into a tolerant snapshot.</summary>
    public static WebErrorsSummary FromJson(JsonElement obj)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        long total = FrontendErrorsJson.GetLong(obj, "total");
        IReadOnlyList<WebErrorOffender> top = obj.TryGetProperty("top", out var topEl)
            ? WebErrorOffender.ParseList(topEl)
            : Array.Empty<WebErrorOffender>();
        string? asOf = FrontendErrorsJson.GetString(obj, "as_of");
        return new WebErrorsSummary(total, top, asOf);
    }
}

/// <summary>
/// The lifecycle state the frontend-errors card can be in. Every branch maps onto a visible surface — none is
/// ever hidden (engineering rule #6). The web shows <c>Skeleton → (total + offenders | "no errors") | "unable
/// to load"</c>; the native surface renders that plus explicit <c>stale</c> and <c>offline</c> freshness
/// branches (a strict superset that satisfies the prompt's mandated state set).
/// </summary>
public enum FrontendErrorsState
{
    /// <summary>First fetch with nothing cached — render the skeleton chrome (web <c>isLoading</c>).</summary>
    Loading,

    /// <summary>A fresh (or non-stale cached) summary — total plus the offenders list / "no errors" copy.</summary>
    Loaded,

    /// <summary>The read resolved with no usable summary envelope — the friendly "unable to load" surface.</summary>
    Empty,

    /// <summary>The read failed and no cached summary exists — the retry affordance (web <c>!data</c>).</summary>
    Error,

    /// <summary>A cached summary older than the freshness window — content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached summary remains — content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One projected, render-ready offender row — the native analogue of a <c>top.map</c> entry in
/// web/src/features/system/components/status/FrontendErrorsCard.tsx. Holds the component
/// <see cref="Name"/> (em-dash when blank, web <c>entry.name || '—'</c>), the <see cref="Route"/> (em-dash
/// when blank, web <c>entry.route || '—'</c>), the grouped <see cref="CountText"/> (web
/// <c>fmtInt(entry.count ?? 0)</c>) and a Narrator name. Pure data.
/// </summary>
public sealed record FrontendErrorOffenderDisplay(
    string Name,
    string Route,
    string CountText,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the card body — the native analogue of the
/// total-plus-<c>top.map</c> composition in FrontendErrorsCard.tsx. <see cref="HasOffenders"/> reproduces the
/// web <c>top.length &gt; 0</c> list / "no errors" gate; the card always shows the <see cref="TotalText"/>
/// when a summary is present (web parity: the total renders even at zero).
/// </summary>
public sealed record FrontendErrorsDisplay(
    string TotalText,
    bool HasOffenders,
    IReadOnlyList<FrontendErrorOffenderDisplay> Offenders)
{
    /// <summary>An empty display (zero total, no offenders) — the projection fallback.</summary>
    public static FrontendErrorsDisplay Empty { get; } =
        new(ScalarFormatters.FormatNumber(0, 0), false, Array.Empty<FrontendErrorOffenderDisplay>());
}

/// <summary>
/// Pure projection from the parsed summary to the render-ready body model — the native port of the
/// total + offenders render in FrontendErrorsCard.tsx (the <c>fmtInt</c> grouping, the
/// <c>entry.name/route || '—'</c> em-dash gates and the <c>top.length &gt; 0</c> list gate). Every label
/// resolves through the i18n facade; no WinUI types so it is unit-tested without a UI host.
/// </summary>
public static class FrontendErrorsProjection
{
    /// <summary>Em-dash fallback for a blank component name / route (web parity '—').</summary>
    public const string EmDash = "\u2014";

    /// <summary>Project the parsed summary into the render-ready body (null → the empty projection).</summary>
    public static FrontendErrorsDisplay Project(WebErrorsSummary? summary, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        if (summary is null)
        {
            return FrontendErrorsDisplay.Empty;
        }

        var offenders = new List<FrontendErrorOffenderDisplay>(summary.Top.Count);
        foreach (var entry in summary.Top)
        {
            string name = string.IsNullOrEmpty(entry.Name) ? EmDash : entry.Name;
            string route = string.IsNullOrEmpty(entry.Route) ? EmDash : entry.Route;
            string countText = FormatCount(entry.Count);
            offenders.Add(new FrontendErrorOffenderDisplay(
                Name: name,
                Route: route,
                CountText: countText,
                AutomationName: string.Format(CultureInfo.CurrentCulture, "{0}, {1}, {2}", name, route, countText)));
        }

        return new FrontendErrorsDisplay(FormatCount(summary.Total), offenders.Count > 0, offenders);
    }

    /// <summary>Format an error count with locale grouping (web <c>fmtInt</c> parity, precision 0).</summary>
    public static string FormatCount(long value) => ScalarFormatters.FormatNumber(value, 0);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions to typed
/// <c>RepositoryResult&lt;WebErrorsSummary&gt;</c>, preserving the cache-then-network status/freshness while
/// parsing the snake_case payload (the native analogue of the web hook's typed query result). A value-bearing
/// status always carries the parsed summary (even when its <c>top</c> array is empty) so the card's total and
/// "no errors" copy survive a zero-offender response, exactly as the web card does; the whole-surface empty
/// state is derived downstream from an absent envelope, not from a lost payload. Pure — unit-tested without a
/// network or cache.
/// </summary>
public static class FrontendErrorsResultMapper
{
    /// <summary>Map a raw web-errors emission to a typed summary result.</summary>
    public static RepositoryResult<WebErrorsSummary> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        WebErrorsSummary Parse() => WebErrorsSummary.FromJson(raw.Value);

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<WebErrorsSummary>.Loading(),
            LoadStatus.Cached => RepositoryResult<WebErrorsSummary>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<WebErrorsSummary>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<WebErrorsSummary>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<WebErrorsSummary>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<WebErrorsSummary>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<WebErrorsSummary>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// The registry metadata, i18n keys and glyph for the frontend-errors surface. The web card is anonymous
/// (FrontendErrorsCard.tsx hardcodes its English copy); the P1/S10 catalog already carries the matching
/// <c>admin.errors.*</c> keys for this surface, so every region resolves through one <c>GetString</c> here.
/// Native-superset chrome (loading / offline / retry) reuses the shared <c>common.*</c> catalog keys.
/// </summary>
public static class FrontendErrorsRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "frontend-errors-card";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "FrontendErrorsCard";

    /// <summary>Segoe Fluent "Bug" glyph — native stand-in for the web Lucide <c>Bug</c> icon.</summary>
    public const string TitleGlyph = "\uEBE8";

    /// <summary>Card title (web "Frontend errors (last hour)" → <c>admin.errors.title</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Require(localizer).GetString("admin.errors.title", "Frontend Errors (Last Hour)");

    /// <summary>Descriptive caption under the total (web "reported by browser sessions" → <c>admin.errors.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer) =>
        Require(localizer).GetString(
            "admin.errors.subtitle",
            "Reported by browser sessions via /api/v1/web-errors. Exported as Prometheus counter teslasync_web_errors_total.");

    /// <summary>Label above the rolling-hour total (web <c>admin.errors.totalLastHour</c>).</summary>
    public static string TotalLabel(ILocalizer localizer) =>
        Require(localizer).GetString("admin.errors.totalLastHour", "Errors in last hour");

    /// <summary>Heading above the offenders list (web <c>admin.errors.topOffenders</c>).</summary>
    public static string TopOffendersLabel(ILocalizer localizer) =>
        Require(localizer).GetString("admin.errors.topOffenders", "Top error sources");

    /// <summary>"No errors" copy shown when the offenders list is empty (web <c>admin.errors.noErrors</c>).</summary>
    public static string NoErrorsText(ILocalizer localizer) =>
        Require(localizer).GetString("admin.errors.noErrors", "No frontend errors reported in the last hour.");

    /// <summary>"Unable to load" copy for the empty / error surfaces (web <c>!data</c> → <c>admin.errors.unableToLoad</c>).</summary>
    public static string UnableToLoadText(ILocalizer localizer) =>
        Require(localizer).GetString("admin.errors.unableToLoad", "Unable to load error summary.");

    /// <summary>Loading announcement label (native superset; reuses <c>common.loading</c>).</summary>
    public static string LoadingLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.loading", "Loading\u2026");

    /// <summary>Offline chip / announcement label (native superset; reuses <c>common.offline</c>).</summary>
    public static string OfflineLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.offline", "Offline");

    /// <summary>Retry affordance label for the hard-error branch (native superset; reuses <c>common.retry</c>).</summary>
    public static string RetryLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.retry", "Retry");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the frontend-errors surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an error count, component name or route
/// — so a diagnostics line can never leak browser-reported error data. Thread-safe.
/// </summary>
public sealed class FrontendErrorsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public FrontendErrorsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=FrontendErrorsCard</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={FrontendErrorsRegistration.Slug}");
    }
}
