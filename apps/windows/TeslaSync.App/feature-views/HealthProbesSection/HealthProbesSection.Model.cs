using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="HealthProbesSectionViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the surface renders. The web source
/// (web/src/features/system/components/status/HealthProbesSection.tsx) reads a single polled
/// <c>useQuery(getExtendedHealth)</c> and renders a loading skeleton, a <c>QueryError</c>, or the two probe
/// cards. The native feature-view owns its own cache-then-network read of the same <c>GET /system/health</c>
/// endpoint and therefore renders the full state matrix the prompt mandates. Every branch maps onto a visible
/// surface — none is ever hidden. A resolved-but-non-object body (a JSON null / 204) carries no health, so it
/// is the lone <see cref="Empty"/> surface; any object body is content (the web shows the cards whenever the
/// query resolves, defaulting each status to "unknown").
/// </summary>
public enum HealthProbesState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome (web <c>isLoading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (network or non-stale cache) carrying a system-health body — render the probes.</summary>
    Loaded,

    /// <summary>The request resolved but returned no health body — render the friendly empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance (web <c>QueryError</c>).</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// Tolerant JSON readers for the <c>GET /system/health</c> body. Each returns a null / fallback for an absent
/// or wrong-kind property so a partial or schema-drifted wire body never throws — mirroring the web component's
/// defensive <c>?? 'unknown'</c> / <c>?? 0</c> / <c>!= null</c> reads. Both the Go API's snake_case wire keys
/// and the camelCase aliases the SPA's <c>camelCaseKeys()</c> transform produces are accepted (snake_case
/// first) so the same parser is correct whichever shape a value arrives in.
/// </summary>
internal static class HealthProbesJson
{
    internal static string? GetString(JsonElement obj, string snake, string camel)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        if (obj.TryGetProperty(snake, out var v) && v.ValueKind == JsonValueKind.String)
        {
            return v.GetString();
        }

        return obj.TryGetProperty(camel, out var c) && c.ValueKind == JsonValueKind.String ? c.GetString() : null;
    }

    internal static double? GetDouble(JsonElement obj, string snake, string camel)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        if (TryReadDouble(obj, snake, out var fromSnake))
        {
            return fromSnake;
        }

        return TryReadDouble(obj, camel, out var fromCamel) ? fromCamel : null;
    }

    internal static long? GetLong(JsonElement obj, string snake, string camel)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        if (TryReadLong(obj, snake, out var fromSnake))
        {
            return fromSnake;
        }

        return TryReadLong(obj, camel, out var fromCamel) ? fromCamel : null;
    }

    internal static JsonElement? GetObject(JsonElement obj, string name)
    {
        if (obj.ValueKind == JsonValueKind.Object
            && obj.TryGetProperty(name, out var v)
            && v.ValueKind == JsonValueKind.Object)
        {
            return v;
        }

        return null;
    }

    private static bool TryReadDouble(JsonElement obj, string name, out double value)
    {
        value = 0;
        if (!obj.TryGetProperty(name, out var v))
        {
            return false;
        }

        switch (v.ValueKind)
        {
            case JsonValueKind.Number when v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n):
                value = n;
                return true;
            case JsonValueKind.String when double.TryParse(
                v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n)
                && !double.IsNaN(n) && !double.IsInfinity(n):
                value = n;
                return true;
            default:
                return false;
        }
    }

    private static bool TryReadLong(JsonElement obj, string name, out long value)
    {
        value = 0;
        if (!obj.TryGetProperty(name, out var v))
        {
            return false;
        }

        switch (v.ValueKind)
        {
            case JsonValueKind.Number when v.TryGetInt64(out var n):
                value = n;
                return true;
            case JsonValueKind.Number when v.TryGetDouble(out var d) && !double.IsNaN(d) && !double.IsInfinity(d):
                value = (long)d;
                return true;
            case JsonValueKind.String when long.TryParse(
                v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n):
                value = n;
                return true;
            default:
                return false;
        }
    }
}

/// <summary>
/// The parsed slice of the <c>GET /system/health</c> body the surface needs, reduced to exactly the values the
/// web component reads: the overall liveness <see cref="LivenessStatus"/> (web <c>data?.status</c>), the
/// readiness <see cref="DatabaseStatus"/> (web <c>data?.database?.status</c>) and its
/// <see cref="DatabaseLatencyMs"/> (web <c>data?.database?.latency_ms</c>), the <see cref="Goroutines"/> count
/// (web <c>data?.system?.goroutines</c>), the process <see cref="UptimeSeconds"/> (web
/// <c>data?.system?.uptime_seconds</c>) and the connection-pool <see cref="PoolTotalConns"/> (web
/// <c>data?.database_pool?.total_conns</c>). The two status strings default to <see cref="UnknownStatus"/>
/// when absent (web parity); the numeric fields stay independently nullable so the projection can apply the
/// web's per-field <c>?? 0</c> defaults and the latency em-dash. Pure data — no WinUI types — so the parse is
/// unit-tested without a UI host.
/// </summary>
public sealed record HealthProbesSnapshot(
    string LivenessStatus,
    string DatabaseStatus,
    double? DatabaseLatencyMs,
    long? Goroutines,
    double? UptimeSeconds,
    long? PoolTotalConns)
{
    /// <summary>The web fallback shown for an absent liveness / readiness status (web <c>?? 'unknown'</c>).</summary>
    public const string UnknownStatus = "unknown";

    /// <summary>
    /// True when the read produced a real health body (a JSON object). A non-object body (JSON null, a 204, or
    /// a schema-drifted scalar) carries no health and drives the friendly empty surface — cleared on the
    /// <see cref="Empty"/> sentinel only.
    /// </summary>
    public bool HasData { get; init; } = true;

    /// <summary>An all-absent snapshot with <see cref="HasData"/> cleared — the parse fallback for a non-object body.</summary>
    public static HealthProbesSnapshot Empty { get; } =
        new(UnknownStatus, UnknownStatus, null, null, null, null) { HasData = false };

    /// <summary>
    /// Project a <c>GET /system/health</c> JSON body into a tolerant snapshot. A non-object body returns
    /// <see cref="Empty"/> (no health → empty surface); every nested object (<c>database</c>, <c>system</c>,
    /// <c>database_pool</c>) and field is read defensively so a partial body never throws.
    /// </summary>
    public static HealthProbesSnapshot FromJson(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        string liveness = HealthProbesJson.GetString(root, "status", "status") ?? UnknownStatus;

        var database = HealthProbesJson.GetObject(root, "database");
        string dbStatus = database is { } db
            ? HealthProbesJson.GetString(db, "status", "status") ?? UnknownStatus
            : UnknownStatus;
        double? latency = database is { } dbl ? HealthProbesJson.GetDouble(dbl, "latency_ms", "latencyMs") : null;

        var system = HealthProbesJson.GetObject(root, "system");
        long? goroutines = system is { } sys ? HealthProbesJson.GetLong(sys, "goroutines", "goroutines") : null;
        double? uptime = system is { } sys2 ? HealthProbesJson.GetDouble(sys2, "uptime_seconds", "uptimeSeconds") : null;

        var pool = HealthProbesJson.GetObject(root, "database_pool") ?? HealthProbesJson.GetObject(root, "databasePool");
        long? poolConns = pool is { } p ? HealthProbesJson.GetLong(p, "total_conns", "totalConns") : null;

        return new HealthProbesSnapshot(liveness, dbStatus, latency, goroutines, uptime, poolConns);
    }
}

/// <summary>One label/value row inside a probe card — the native analogue of a web <c>KVList</c> item.</summary>
/// <param name="Label">The localized row label (web <c>label</c>).</param>
/// <param name="Value">The already-formatted value (web <c>value</c>).</param>
public sealed record HealthProbeRow(string Label, string Value);

/// <summary>
/// One projected, display-ready probe card — the native analogue of a web <c>Card</c> + <c>CardHeader</c> +
/// <c>KVList</c> trio. Holds the localized <see cref="Title"/>, the action-badge <see cref="StatusText"/> with
/// its semantic <see cref="StatusKind"/>, the key/value <see cref="Rows"/> and a composed Narrator
/// <see cref="AutomationName"/>. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record HealthProbeCard(
    string Title,
    string StatusText,
    StatusKind StatusKind,
    IReadOnlyList<HealthProbeRow> Rows,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the health-probes section — the two probe cards plus the two
/// header status badges (web <c>Live</c> / <c>Ready</c> dot badges). Pure data so the projection is asserted
/// headlessly.
/// </summary>
/// <param name="LiveBadgeText">The "Live" header badge label (web <c>t('Live')</c>).</param>
/// <param name="LiveBadgeStatus">The semantic status driving the "Live" badge colour (from the liveness status).</param>
/// <param name="ReadyBadgeText">The "Ready" header badge label (web <c>t('Ready')</c>).</param>
/// <param name="ReadyBadgeStatus">The semantic status driving the "Ready" badge colour (from the database status).</param>
/// <param name="Liveness">The Liveness — /healthz card.</param>
/// <param name="Readiness">The Readiness — /readyz card.</param>
public sealed record HealthProbesDisplay(
    string LiveBadgeText,
    StatusKind LiveBadgeStatus,
    string ReadyBadgeText,
    StatusKind ReadyBadgeStatus,
    HealthProbeCard Liveness,
    HealthProbeCard Readiness);

/// <summary>
/// Pure projection from a parsed <see cref="HealthProbesSnapshot"/> to the render-ready
/// <see cref="HealthProbesDisplay"/> — the native port of the badge + <c>Card</c> + <c>KVList</c> composition in
/// web/src/features/system/components/status/HealthProbesSection.tsx. Reproduces the web's
/// <c>statusToBadgeVariant</c> mapping, its <c>fmtInt</c> / <c>fmtNumber(…, 1)</c> readouts, its
/// <c>formatUptime</c> helper and the latency em-dash; every label resolves through the i18n facade. No WinUI
/// types — unit-tested without a UI host.
/// </summary>
public static class HealthProbesProjection
{
    /// <summary>Em-dash shown when the latency value is absent (web parity <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Fraction digits the latency readout renders (web <c>fmtNumber(dbLatency, 1)</c>).</summary>
    public const int LatencyPrecision = 1;

    /// <summary>i18n key + verbatim fallback for the Liveness card title (web <c>t('Liveness — /healthz')</c>).</summary>
    public const string LivenessTitleKey = "Liveness \u2014 /healthz";

    /// <summary>i18n key + verbatim fallback for the Readiness card title (web <c>t('Readiness — /readyz')</c>).</summary>
    public const string ReadinessTitleKey = "Readiness \u2014 /readyz";

    private const int SecondsPerMinute = 60;
    private const int SecondsPerHour = 3600;
    private const int SecondsPerDay = 86400;

    /// <summary>Project <paramref name="data"/> into the two probe cards and the two header badges.</summary>
    public static HealthProbesDisplay Project(HealthProbesSnapshot data, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(localizer);

        string livenessStatus = string.IsNullOrEmpty(data.LivenessStatus)
            ? HealthProbesSnapshot.UnknownStatus
            : data.LivenessStatus;
        string dbStatus = string.IsNullOrEmpty(data.DatabaseStatus)
            ? HealthProbesSnapshot.UnknownStatus
            : data.DatabaseStatus;

        StatusKind livenessKind = StatusToBadge(livenessStatus);
        StatusKind dbKind = StatusToBadge(dbStatus);

        string livenessTitle = localizer.GetString(LivenessTitleKey, LivenessTitleKey);
        string readinessTitle = localizer.GetString(ReadinessTitleKey, ReadinessTitleKey);

        string latencyValue = data.DatabaseLatencyMs is { } latency
            ? string.Create(
                CultureInfo.InvariantCulture,
                $"{ScalarFormatters.FormatNumber(latency, LatencyPrecision)} ms")
            : EmDash;

        var livenessCard = new HealthProbeCard(
            Title: livenessTitle,
            StatusText: livenessStatus,
            StatusKind: livenessKind,
            Rows: new[]
            {
                new HealthProbeRow(localizer.GetString("Status", "Status"), livenessStatus),
                new HealthProbeRow(localizer.GetString("Goroutines", "Goroutines"), FormatInt(data.Goroutines)),
                new HealthProbeRow(localizer.GetString("Uptime", "Uptime"), FormatUptime(data.UptimeSeconds ?? 0)),
            },
            AutomationName: BuildCardName(livenessTitle, livenessStatus));

        var readinessCard = new HealthProbeCard(
            Title: readinessTitle,
            StatusText: dbStatus,
            StatusKind: dbKind,
            Rows: new[]
            {
                new HealthProbeRow(localizer.GetString("Database", "Database"), dbStatus),
                new HealthProbeRow(localizer.GetString("Latency", "Latency"), latencyValue),
                new HealthProbeRow(
                    localizer.GetString("Pool Connections", "Pool Connections"), FormatInt(data.PoolTotalConns)),
            },
            AutomationName: BuildCardName(readinessTitle, dbStatus));

        return new HealthProbesDisplay(
            LiveBadgeText: localizer.GetString("Live", "Live"),
            LiveBadgeStatus: livenessKind,
            ReadyBadgeText: localizer.GetString("Ready", "Ready"),
            ReadyBadgeStatus: dbKind,
            Liveness: livenessCard,
            Readiness: readinessCard);
    }

    /// <summary>
    /// Native port of the web <c>statusToBadgeVariant</c> (helpers.tsx): map a (case-insensitive) status string
    /// onto the semantic chip colour. <c>healthy/ok/online/ready/sent/completed</c> → success,
    /// <c>degraded/warning/pending/queued/processing</c> → warning,
    /// <c>unhealthy/offline/error/down/failed</c> → danger, everything else → neutral.
    /// </summary>
    public static StatusKind StatusToBadge(string? status) => (status ?? string.Empty).ToLowerInvariant() switch
    {
        "healthy" or "ok" or "online" or "ready" or "sent" or "completed" => StatusKind.Success,
        "degraded" or "warning" or "pending" or "queued" or "processing" => StatusKind.Warning,
        "unhealthy" or "offline" or "error" or "down" or "failed" => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };

    /// <summary>
    /// Native port of the web <c>formatUptime</c> (helpers.tsx): a compact "Nd Nh Nm" / "Nh Nm" / "Nm" string
    /// from SI seconds. Negative inputs clamp to zero so a clock-skewed reading never renders a sign.
    /// </summary>
    public static string FormatUptime(double seconds)
    {
        long total = seconds <= 0 ? 0 : (long)Math.Floor(seconds);
        long days = total / SecondsPerDay;
        long hours = total % SecondsPerDay / SecondsPerHour;
        long mins = total % SecondsPerHour / SecondsPerMinute;

        if (days > 0)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{days}d {hours}h {mins}m");
        }

        if (hours > 0)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{hours}h {mins}m");
        }

        return string.Create(CultureInfo.InvariantCulture, $"{mins}m");
    }

    // Web fmtInt: a grouped integer readout, defaulting an absent value to 0 (web `?? 0`).
    private static string FormatInt(long? value) =>
        ScalarFormatters.FormatNumber(value ?? 0, 0);

    private static string BuildCardName(string title, string status) =>
        string.Create(CultureInfo.CurrentCulture, $"{title}: {status}");
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;HealthProbesSnapshot&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept pure so
/// the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class HealthProbesResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<HealthProbesSnapshot> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        HealthProbesSnapshot Parse() =>
            raw.HasValue ? HealthProbesSnapshot.FromJson(raw.Value) : HealthProbesSnapshot.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<HealthProbesSnapshot>.Loading(),
            LoadStatus.Cached => RepositoryResult<HealthProbesSnapshot>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<HealthProbesSnapshot>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<HealthProbesSnapshot>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<HealthProbesSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<HealthProbesSnapshot>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<HealthProbesSnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the Health Probes Section surface — the native mirror of the web component
/// (web/src/features/system/components/status/HealthProbesSection.tsx, rendered inside the system-status page).
/// Centralises the stable id, category, diagnostics slug, generated operation id and cache key so the view,
/// view-model and source stay free of literal identifiers.
/// </summary>
public static class HealthProbesSectionRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "health-probes-section";

    /// <summary>Surface category (matches the web system feature).</summary>
    public const string Category = "system";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "HealthProbesSection";

    /// <summary>Generated operation id for the extended-health read (web <c>getExtendedHealth</c> → <c>GET /system/health</c>).</summary>
    public const string HealthOperationId = "get_api_v1_system_health";

    /// <summary>Cache key for this surface's snapshot — distinct from sibling system-health readers so the cache never collides.</summary>
    public const string CacheKey = "system-status:health-probes";
}

/// <summary>
/// PII-safe diagnostics for the Health Probes Section surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a status, latency or uptime — so a
/// diagnostics line can never leak operational data. Thread-safe.
/// </summary>
public sealed class HealthProbesSectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public HealthProbesSectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=HealthProbesSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={HealthProbesSectionRegistration.Slug}");
    }
}
