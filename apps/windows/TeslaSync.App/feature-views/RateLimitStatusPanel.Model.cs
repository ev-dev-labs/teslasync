using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the rate-limit status surface. Every getter returns a
/// fallback rather than throwing so a partial or schema-drifted row from <c>GET /system/rate-limits</c> never
/// aborts the parse (web parity: the React component tolerates undefined fields). Kept private to the surface
/// and free of WinUI types so the parse is unit-tested without a UI host.
/// </summary>
internal static class RateLimitStatusJson
{
    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    /// <summary>The numeric value of <paramref name="name"/>, tolerating a number or numeric-string field (0 fallback).</summary>
    public static double GetDouble(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return 0;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(prop.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s) => s,
            _ => 0,
        };
    }

    /// <summary>The integer value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static long? GetLong(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(prop.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    /// <summary>Parse the backend severity token (<c>ok</c> / <c>warn</c> / <c>critical</c>); unknown maps to ok.</summary>
    public static RateLimitSeverity ParseSeverity(string? raw) => raw switch
    {
        "warn" => RateLimitSeverity.Warn,
        "critical" => RateLimitSeverity.Critical,
        _ => RateLimitSeverity.Ok,
    };

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
/// The colour band the backend reports for a budget — the native analogue of the web
/// <c>RateLimitSeverity = 'ok' | 'warn' | 'critical'</c> union
/// (web/src/features/admin/components/RateLimitStatusPanel.tsx). Severity comes straight from the backend so
/// threshold tuning is a single Go ship.
/// </summary>
public enum RateLimitSeverity
{
    /// <summary>Within budget — green (web <c>#10b981</c>).</summary>
    Ok,

    /// <summary>Approaching the cap — amber (web <c>#f59e0b</c>).</summary>
    Warn,

    /// <summary>At or over the cap — red (web <c>#ef4444</c>).</summary>
    Critical,
}

/// <summary>
/// One rate-limit budget row from <c>GET /system/rate-limits</c> — the native analogue of the web
/// <c>ScopeBudget</c> shape (web/src/api/types.ts). Field names mirror the Go API's snake_case JSON tags;
/// parsing is null-tolerant so a partial row never throws. The raw <c>reset_at</c> string is kept and parsed
/// on demand. Pure data — unit-tested without a UI host.
/// </summary>
public sealed record ScopeBudget(
    string Id,
    string Name,
    double Current,
    double Limit,
    long WindowSeconds,
    string? ResetAt,
    RateLimitSeverity Severity,
    string? Detail)
{
    /// <summary>The parsed bucket-refill instant, or null when absent / unparseable.</summary>
    public DateTimeOffset? ResetInstant => RateLimitStatusJson.TryParseTimestamp(ResetAt);

    /// <summary>Parse a single scope JSON object into a <see cref="ScopeBudget"/>.</summary>
    public static ScopeBudget FromJson(JsonElement obj) => new(
        Id: RateLimitStatusJson.GetString(obj, "id") ?? string.Empty,
        Name: RateLimitStatusJson.GetString(obj, "name") ?? string.Empty,
        Current: RateLimitStatusJson.GetDouble(obj, "current"),
        Limit: RateLimitStatusJson.GetDouble(obj, "limit"),
        WindowSeconds: RateLimitStatusJson.GetLong(obj, "window_seconds") ?? 0,
        ResetAt: RateLimitStatusJson.GetString(obj, "reset_at"),
        Severity: RateLimitStatusJson.ParseSeverity(RateLimitStatusJson.GetString(obj, "severity")),
        Detail: RateLimitStatusJson.GetString(obj, "detail"));

    /// <summary>Parse the <c>scopes</c> JSON array into a tolerant list (non-objects skipped).</summary>
    public static IReadOnlyList<ScopeBudget> ParseList(JsonElement array)
    {
        if (array.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<ScopeBudget>();
        }

        var list = new List<ScopeBudget>(array.GetArrayLength());
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
/// The decoded envelope for <c>GET /system/rate-limits</c> — the native analogue of the web
/// <c>RateLimitStatusResponse</c> (web/src/api/types.ts). Holds the server-stamped <see cref="GeneratedAt"/>
/// (rendered relative in the "Updated {when}" caption) and the per-scope <see cref="Scopes"/>.
/// </summary>
public sealed record RateLimitStatusSnapshot(
    string? GeneratedAt,
    IReadOnlyList<ScopeBudget> Scopes)
{
    /// <summary>An empty snapshot (no scopes) — the parse / projection fallback.</summary>
    public static RateLimitStatusSnapshot Empty { get; } = new(null, Array.Empty<ScopeBudget>());

    /// <summary>The parsed generated-at instant, or null when absent / unparseable.</summary>
    public DateTimeOffset? GeneratedAtInstant => RateLimitStatusJson.TryParseTimestamp(GeneratedAt);

    /// <summary>Parse the rate-limit status response object into a tolerant snapshot.</summary>
    public static RateLimitStatusSnapshot FromJson(JsonElement obj)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        string? generatedAt = RateLimitStatusJson.GetString(obj, "generated_at");
        IReadOnlyList<ScopeBudget> scopes = obj.TryGetProperty("scopes", out var scopesEl)
            ? ScopeBudget.ParseList(scopesEl)
            : Array.Empty<ScopeBudget>();
        return new RateLimitStatusSnapshot(generatedAt, scopes);
    }
}

/// <summary>
/// The lifecycle state the rate-limit panel can be in. Every branch maps onto a visible surface — none is
/// ever hidden (engineering rule #6). The web shows <c>Spinner → rows | empty text | inline error</c>; the
/// native surface additionally renders explicit <c>stale</c> and <c>offline</c> freshness branches (a strict
/// superset of the web that satisfies the prompt's mandated state set).
/// </summary>
public enum RateLimitPanelState
{
    /// <summary>First fetch with nothing cached — render the skeleton / spinner.</summary>
    Loading,

    /// <summary>A fresh (network or non-stale cache) result with rows to show.</summary>
    Loaded,

    /// <summary>The read resolved with no scopes — the friendly empty text.</summary>
    Empty,

    /// <summary>The read failed and no cached rows exist — the retry affordance.</summary>
    Error,

    /// <summary>A cached result older than the freshness window — rows plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but cached rows remain — rows plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One projected, render-ready budget row — the native analogue of a <c>RateLimitRow</c> in
/// web/src/features/admin/components/RateLimitStatusPanel.tsx. Holds the scope name, the localized severity
/// label + its token status/brush (web <c>SEVERITY_TONE_CLASS</c>), the bar value/max, the window label
/// (web <c>windowLabel</c>) and usage sublabel (web <c>usageLabel</c>), the optional detail footnote and the
/// optional "Refills in {duration}" reset label (web <c>resetLabel</c>), plus a Narrator name. Pure data.
/// </summary>
public sealed record RateLimitRowDisplay(
    string Id,
    string Name,
    string SeverityLabel,
    StatusKind SeverityStatus,
    string AccentBrushKey,
    double Value,
    double Max,
    string WindowLabel,
    string UsageLabel,
    string? Detail,
    string? ResetLabel,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the panel body — the native analogue of the <c>scopes.map</c>
/// row list in web/src/features/admin/components/RateLimitStatusPanel.tsx. <see cref="HasRows"/> reproduces
/// the web <c>scopes.length === 0</c> empty / rows gate.
/// </summary>
public sealed record RateLimitPanelDisplay(
    bool HasRows,
    IReadOnlyList<RateLimitRowDisplay> Rows)
{
    /// <summary>An empty display (no scopes) — the projection fallback.</summary>
    public static RateLimitPanelDisplay Empty { get; } = new(false, Array.Empty<RateLimitRowDisplay>());
}

/// <summary>
/// A 1:1 port of the web <c>formatDurationMsLong</c> (web/src/lib/dateFormat.ts) used by the rate-limit
/// reset label. Renders a millisecond span as <c>"500ms"</c> / <c>"5.0s"</c> / <c>"2m 5s"</c>, matching the
/// web's <c>toFixed(1)</c> seconds and <c>formatRoundedInt</c> minute-remainder. Non-positive / non-finite
/// inputs render the em-dash. Pure — unit-tested with golden vectors.
/// </summary>
public static class RateLimitDuration
{
    /// <summary>Em-dash fallback for non-positive / non-finite spans (web parity '—').</summary>
    public const string EmDash = "\u2014";

    /// <summary>Format a positive millisecond span the way the web reset label does.</summary>
    public static string FormatMsLong(double ms)
    {
        if (double.IsNaN(ms) || double.IsInfinity(ms) || ms <= 0)
        {
            return EmDash;
        }

        if (ms < 1000)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{(long)ms}ms");
        }

        double sec = ms / 1000.0;
        if (sec < 60)
        {
            return NumberFormatting.Format(sec, null, 1) + "s";
        }

        long min = (long)Math.Floor(sec / 60.0);
        double remainder = sec % 60.0;
        return string.Create(CultureInfo.InvariantCulture, $"{min}m {NumberFormatting.Format(remainder, null, 0)}s");
    }
}

/// <summary>
/// Pure projection from the parsed scopes to the render-ready row models — the native port of the
/// <c>RateLimitRow</c> render (the usage / window / reset labels, the severity tone mapping and the
/// "Updated {when}" caption) in web/src/features/admin/components/RateLimitStatusPanel.tsx. <c>now</c> is
/// injected so the reset countdown and the relative "Updated" stamp are unit-tested deterministically; every
/// label resolves through the i18n facade. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class RateLimitStatusProjection
{
    /// <summary>Project the scope list into render-ready rows using the i18n facade.</summary>
    public static RateLimitPanelDisplay Project(
        IReadOnlyList<ScopeBudget> scopes,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(scopes);
        ArgumentNullException.ThrowIfNull(localizer);

        var rows = new List<RateLimitRowDisplay>(scopes.Count);
        foreach (var scope in scopes)
        {
            StatusKind status = StatusFor(scope.Severity);
            string severityLabel = SeverityLabel(scope.Severity, localizer);
            string usage = UsageLabel(scope, localizer);
            string window = WindowLabel(scope, localizer);
            string? reset = ResetLabel(scope, localizer, now);
            string? detail = string.IsNullOrWhiteSpace(scope.Detail) ? null : scope.Detail;

            rows.Add(new RateLimitRowDisplay(
                Id: scope.Id,
                Name: scope.Name,
                SeverityLabel: severityLabel,
                SeverityStatus: status,
                AccentBrushKey: StatusResources.AccentBrushKey(status),
                Value: scope.Current,
                Max: scope.Limit > 0 ? scope.Limit : 1,
                WindowLabel: window,
                UsageLabel: usage,
                Detail: detail,
                ResetLabel: reset,
                AutomationName: AutomationName(scope.Name, severityLabel, usage, window, reset)));
        }

        return new RateLimitPanelDisplay(rows.Count > 0, rows);
    }

    /// <summary>The localized "Updated {when}" caption (web <c>updatedLabel</c>), or null when no timestamp.</summary>
    public static string? UpdatedLabel(DateTimeOffset? generatedAt, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        if (generatedAt is not { } ts)
        {
            return null;
        }

        return string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString("rateLimitStatus.lastUpdated", "Updated {0}"),
            DateTimeFormatting.Format(ts, DateTimeVariant.Relative, now));
    }

    /// <summary>Map a severity to its token status (web <c>SEVERITY_TONE_CLASS</c> / <c>SEVERITY_COLOR</c>).</summary>
    public static StatusKind StatusFor(RateLimitSeverity severity) => severity switch
    {
        RateLimitSeverity.Warn => StatusKind.Warning,
        RateLimitSeverity.Critical => StatusKind.Danger,
        _ => StatusKind.Success,
    };

    private static string SeverityLabel(RateLimitSeverity severity, ILocalizer localizer) => severity switch
    {
        RateLimitSeverity.Warn => localizer.GetString("rateLimitStatus.severity.warn", "Warning"),
        RateLimitSeverity.Critical => localizer.GetString("rateLimitStatus.severity.critical", "Critical"),
        _ => localizer.GetString("rateLimitStatus.severity.ok", "Healthy"),
    };

    // web: t('rateLimitStatus.usage', '{{current}} / {{limit}}', { current: fmtNumber(...), limit: fmtNumber(...) }).
    // Budgets are integer request counts, so the native scalar formatter renders them at precision 0.
    private static string UsageLabel(ScopeBudget scope, ILocalizer localizer) => string.Format(
        CultureInfo.CurrentCulture,
        localizer.GetString("rateLimitStatus.usage", "{0} / {1}"),
        ScalarFormatters.FormatNumber(scope.Current),
        ScalarFormatters.FormatNumber(scope.Limit));

    // web: window_seconds <= 0 → 'Live snapshot' (token-bucket), else 'Last {{seconds}}s window'.
    private static string WindowLabel(ScopeBudget scope, ILocalizer localizer) => scope.WindowSeconds <= 0
        ? localizer.GetString("rateLimitStatus.windowInstant", "Live snapshot")
        : string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString("rateLimitStatus.windowSeconds", "Last {0}s window"),
            scope.WindowSeconds);

    // web: reset_at present and (reset_at - now) > 0 → 'Refills in {{duration}}', else no label.
    private static string? ResetLabel(ScopeBudget scope, ILocalizer localizer, DateTimeOffset now)
    {
        if (scope.ResetInstant is not { } reset)
        {
            return null;
        }

        double ms = (reset - now).TotalMilliseconds;
        if (double.IsNaN(ms) || double.IsInfinity(ms) || ms <= 0)
        {
            return null;
        }

        return string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString("rateLimitStatus.resetIn", "Refills in {0}"),
            RateLimitDuration.FormatMsLong(ms));
    }

    private static string AutomationName(string name, string severityLabel, string usage, string window, string? reset)
    {
        string core = string.Format(
            CultureInfo.CurrentCulture,
            "{0}, {1}, {2}, {3}",
            name,
            severityLabel,
            usage,
            window);
        return reset is null
            ? core
            : string.Format(CultureInfo.CurrentCulture, "{0}, {1}", core, reset);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions to typed
/// <c>RepositoryResult&lt;RateLimitStatusSnapshot&gt;</c>, preserving the cache-then-network status/freshness
/// while parsing the snake_case payload (the native analogue of the web hook's typed query result). A
/// value-bearing status always carries the parsed snapshot (even when its <c>scopes</c> array is empty) so
/// the header's "Updated {when}" caption survives a zero-scope response, exactly as the web header does; the
/// body's empty state is derived downstream from the row count, not from a lost payload. Pure — unit-tested
/// without a network or cache.
/// </summary>
public static class RateLimitStatusResultMapper
{
    /// <summary>Map a raw rate-limit emission to a typed snapshot result.</summary>
    public static RepositoryResult<RateLimitStatusSnapshot> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        switch (raw.Status)
        {
            case LoadStatus.Loading:
                return RepositoryResult<RateLimitStatusSnapshot>.Loading();

            case LoadStatus.Empty:
                return RepositoryResult<RateLimitStatusSnapshot>.Empty(raw.FetchedAt);

            case LoadStatus.Error:
                return RepositoryResult<RateLimitStatusSnapshot>.Failure(
                    raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error"));
        }

        var snapshot = RateLimitStatusSnapshot.FromJson(raw.Value);
        var fetchedAt = raw.FetchedAt ?? DateTimeOffset.UtcNow;

        return raw.Status switch
        {
            LoadStatus.Cached => RepositoryResult<RateLimitStatusSnapshot>.Cached(snapshot, fetchedAt, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<RateLimitStatusSnapshot>.Refreshing(snapshot, fetchedAt, raw.IsStale),
            LoadStatus.Offline => RepositoryResult<RateLimitStatusSnapshot>.OfflineCached(
                snapshot, fetchedAt, raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Offline")),
            _ => RepositoryResult<RateLimitStatusSnapshot>.Loaded(snapshot, fetchedAt),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the rate-limit status surface — the native mirror of the web admin panel
/// (web/src/features/admin/components/RateLimitStatusPanel.tsx). Centralises the stable id, the diagnostics
/// slug, and the localized title/subtitle so the view and view-model stay free of literal copy.
/// </summary>
public static class RateLimitStatusRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "rate-limit-status-panel";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "RateLimitStatusPanel";

    /// <summary>Localized panel title (web <c>rateLimitStatus.title</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Require(localizer).GetString("rateLimitStatus.title", "Rate-limit budgets");

    /// <summary>Localized panel subtitle (web <c>rateLimitStatus.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer) =>
        Require(localizer).GetString(
            "rateLimitStatus.subtitle",
            "Live view of every server-side throttle that affects this TeslaSync deployment. Bars climb as the window fills; colour switches from green to amber at 50% and to red at 80%.");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the rate-limit status surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a scope id, name or detail — so a
/// diagnostics line can never leak operator-specific throttle data. Thread-safe.
/// </summary>
public sealed class RateLimitStatusDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public RateLimitStatusDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=RateLimitStatusPanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={RateLimitStatusRegistration.Slug}");
    }
}
