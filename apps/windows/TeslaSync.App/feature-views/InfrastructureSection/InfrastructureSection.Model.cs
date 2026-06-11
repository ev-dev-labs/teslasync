using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state an <see cref="InfrastructureSectionViewModel"/> can be in — the native union of the
/// loading / ready / empty / error / stale / offline branches the surface renders. The web source
/// (web/src/features/system/components/status/InfrastructureSection.tsx) is presentational: it reads two live
/// queries (<c>getTelemetryStatus</c> + <c>getExtendedHealth</c>) with optional chaining and renders the two
/// diagnostic cards unconditionally (em-dash for any absent field). The native feature-view owns its own
/// cache-then-network read of the same two endpoints and therefore renders the full state matrix the prompt
/// mandates. Every branch maps onto a visible surface — none is ever hidden.
/// </summary>
public enum InfrastructureState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot (network or non-stale cache) — render the two diagnostic cards.</summary>
    Ready,

    /// <summary>The telemetry endpoint resolved with no body — render the disconnected em-dash cards.</summary>
    Empty,

    /// <summary>The primary read failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The connection-pool slice of the extended-health body the surface needs — the three counts the web
/// component reads from <c>extHealth.database_pool</c> (web <c>fmtInt(total_conns)</c> /
/// <c>fmtInt(acquired_conns)</c> / <c>fmtInt(idle_conns)</c> in
/// web/src/features/system/components/status/InfrastructureSection.tsx). Each field is independently nullable so
/// a partial or schema-drifted body never throws; the projection renders an em-dash for any absent count. The
/// whole record is null when the extended-health read carried no <c>database_pool</c> — mirroring the web
/// <c>{extHealth?.database_pool &amp;&amp; (…)}</c> gate that hides the metric row entirely.
/// </summary>
/// <param name="TotalConns">Total pool connections (web <c>database_pool.total_conns</c>).</param>
/// <param name="AcquiredConns">In-use pool connections (web <c>database_pool.acquired_conns</c>).</param>
/// <param name="IdleConns">Idle pool connections (web <c>database_pool.idle_conns</c>).</param>
public sealed record InfrastructureDbPool(long? TotalConns, long? AcquiredConns, long? IdleConns);

/// <summary>
/// The infrastructure slice the surface needs, reduced to the values the web component reads: the SSE/telemetry
/// <see cref="Enabled"/> flag (web <c>telemetry?.enabled ?? false</c>), the connection <see cref="Mode"/> (web
/// <c>telemetry?.mode ?? 'unknown'</c>), the <see cref="Endpoint"/> + <see cref="Protocol"/>, the three
/// speed-comparison strings (web <c>telemetry?.speed_comparison?.*</c>) and the optional database-pool counts
/// (web <c>extHealth?.database_pool</c>). Every field is independently nullable so a partial / schema-drifted
/// body never throws and the per-row em-dash (web parity) is preserved. The snapshot is parsed from the merged
/// <c>{ telemetry, health }</c> envelope the <see cref="InfrastructureSectionSource"/> builds so both snake_case
/// wire shapes round-trip losslessly through the cache.
/// </summary>
public sealed record InfrastructureSnapshot(
    bool Enabled,
    string? Mode,
    string? Endpoint,
    string? Protocol,
    string? Speedup,
    string? FleetTelemetryLatency,
    string? FleetApiPolling,
    InfrastructureDbPool? Pool)
{
    /// <summary>The merged-envelope key holding the raw <c>GET /telemetry/</c> body (the primary read).</summary>
    public const string TelemetryKey = "telemetry";

    /// <summary>The merged-envelope key holding the raw <c>GET /system/health</c> body (the supplementary read).</summary>
    public const string HealthKey = "health";

    /// <summary>The connection mode value that marks the polling fallback as active (web <c>=== 'polling'</c>).</summary>
    public const string PollingMode = "polling";

    /// <summary>An all-absent snapshot — the parse fallback and the empty-state em-dash source.</summary>
    public static InfrastructureSnapshot Empty { get; } = new(false, null, null, null, null, null, null, null);

    /// <summary>
    /// True when the polling fallback engine is active — the native analogue of the web
    /// <c>connectionMode === 'polling'</c> test (which uses <c>mode ?? 'unknown'</c>, so an absent mode is not
    /// polling). Drives the "Polling Engine" Active/Standby badge and the SSE "Fallback Mode" row.
    /// </summary>
    public bool IsPolling => string.Equals(Mode, PollingMode, StringComparison.Ordinal);

    /// <summary>
    /// Project the merged cache envelope — <c>{ "telemetry": …, "health": … }</c> built by the
    /// <see cref="InfrastructureSectionSource"/> — into a tolerant snapshot. The telemetry body supplies the
    /// SSE/polling fields; the health body's <c>database_pool</c> supplies the optional metric counts (left null
    /// when absent, mirroring the web optional-chaining gate). Both sub-bodies are read defensively so a missing
    /// key, wrong value-kind or partial object never throws.
    /// </summary>
    public static InfrastructureSnapshot FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        JsonElement telemetry = Child(element, TelemetryKey);
        JsonElement health = Child(element, HealthKey);
        JsonElement speed = Child(telemetry, "speed_comparison");

        return new InfrastructureSnapshot(
            Enabled: GetBool(telemetry, "enabled") ?? false,
            Mode: GetString(telemetry, "mode"),
            Endpoint: GetString(telemetry, "endpoint"),
            Protocol: GetString(telemetry, "protocol"),
            Speedup: GetString(speed, "speedup"),
            FleetTelemetryLatency: GetString(speed, "fleet_telemetry_latency"),
            FleetApiPolling: GetString(speed, "fleet_api_polling"),
            Pool: ReadPool(Child(health, "database_pool")));
    }

    // The web reads database_pool only when present; an absent / non-object node leaves the whole metric row out.
    private static InfrastructureDbPool? ReadPool(JsonElement pool)
    {
        if (pool.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new InfrastructureDbPool(
            GetLong(pool, "total_conns"),
            GetLong(pool, "acquired_conns"),
            GetLong(pool, "idle_conns"));
    }

    private static JsonElement Child(JsonElement parent, string name) =>
        parent.ValueKind == JsonValueKind.Object && parent.TryGetProperty(name, out var child)
            ? child
            : default;

    // String fields are taken verbatim only for a JSON string kind — a null / wrong-kind value reads as absent
    // so the projection falls back to the em-dash (web `?? '—'`).
    private static string? GetString(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var value))
        {
            return null;
        }

        return value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    }

    private static bool? GetBool(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }

    // Pool counts are integers on the wire; tolerate a numeric string too (some middleware re-encodes numbers).
    private static long? GetLong(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetInt64(out var n) => n,
            JsonValueKind.Number when value.TryGetDouble(out var d) && !double.IsNaN(d) && !double.IsInfinity(d) =>
                (long)d,
            JsonValueKind.String when long.TryParse(
                value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }
}

/// <summary>
/// One projected label/value pair the WinUI view renders inside a KV list or as an inline metric — the native
/// analogue of a single web <c>KVList</c> item / <c>InlineMetric</c>. Pure data (no WinUI types) so the
/// projection is unit-tested without a UI host; the view maps it onto the shared <c>TsKVList</c> /
/// <c>TsInlineMetric</c> primitives.
/// </summary>
/// <param name="Label">The localized left-hand label.</param>
/// <param name="Value">The already-formatted right-hand value (or em-dash when absent).</param>
public sealed record InfrastructureRow(string Label, string Value);

/// <summary>
/// The fully projected, render-ready view of the infrastructure section — the connection status (for the header
/// badge and the SSE "Connection State" row), the polling status (for the "Polling Engine" badge), the two KV
/// card row-sets (always present, web parity) and the optional database-pool metric rows (null when the
/// extended-health body carried no <c>database_pool</c>). Pure data so the projection is unit-tested without a
/// UI host.
/// </summary>
/// <param name="Connected">Whether the SSE/telemetry connection is enabled (web <c>sseConnected</c>).</param>
/// <param name="ConnectionStatusText">Localized "Connected" / "Disconnected" label.</param>
/// <param name="Polling">Whether the polling fallback engine is active (web <c>connectionMode === 'polling'</c>).</param>
/// <param name="PollingStatusText">Localized "Active" / "Standby" label.</param>
/// <param name="SseRows">The four "SSE Connection" card rows.</param>
/// <param name="PollingRows">The four "Polling Engine" card rows.</param>
/// <param name="Metrics">The three database-pool inline metrics, or null when no pool was reported.</param>
public sealed record InfrastructureDisplay(
    bool Connected,
    string ConnectionStatusText,
    bool Polling,
    string PollingStatusText,
    IReadOnlyList<InfrastructureRow> SseRows,
    IReadOnlyList<InfrastructureRow> PollingRows,
    IReadOnlyList<InfrastructureRow>? Metrics);

/// <summary>
/// Pure projection from a parsed <see cref="InfrastructureSnapshot"/> to its <see cref="InfrastructureDisplay"/>
/// — the native port of the JSX composition in
/// web/src/features/system/components/status/InfrastructureSection.tsx. Every label resolves through the i18n
/// facade; every absent value falls back to the em-dash (web <c>?? '—'</c>); the mode value is rendered verbatim
/// with the web's literal <c>'unknown'</c> fallback (a server-side status token, not translated copy). No WinUI
/// types — unit-tested without a UI host.
/// </summary>
public static class InfrastructureProjection
{
    /// <summary>Em-dash shown when a value is absent (web parity '—').</summary>
    public const string EmDash = "\u2014";

    /// <summary>The web's literal connection-mode fallback (a server token, rendered verbatim, not translated).</summary>
    public const string UnknownMode = "unknown";

    /// <summary>Project <paramref name="data"/> into the render-ready display using the i18n facade.</summary>
    /// <param name="data">The parsed infrastructure snapshot (or <see cref="InfrastructureSnapshot.Empty"/>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static InfrastructureDisplay Project(InfrastructureSnapshot data, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(localizer);

        bool connected = data.Enabled;
        bool polling = data.IsPolling;

        string connectionText = connected
            ? localizer.GetString("infrastructure.connected", "Connected")
            : localizer.GetString("infrastructure.disconnected", "Disconnected");
        string pollingText = polling
            ? localizer.GetString("infrastructure.active", "Active")
            : localizer.GetString("infrastructure.standby", "Standby");
        string fallbackModeText = polling
            ? localizer.GetString("infrastructure.yesPolling", "Yes \u2014 Polling")
            : localizer.GetString("infrastructure.no", "No");

        var sseRows = new List<InfrastructureRow>(4)
        {
            new(localizer.GetString("infrastructure.connectionState", "Connection State"), connectionText),
            new(localizer.GetString("infrastructure.endpoint", "Endpoint"), data.Endpoint ?? EmDash),
            new(localizer.GetString("infrastructure.protocol", "Protocol"), data.Protocol ?? EmDash),
            new(localizer.GetString("infrastructure.fallbackMode", "Fallback Mode"), fallbackModeText),
        };

        var pollingRows = new List<InfrastructureRow>(4)
        {
            new(localizer.GetString("infrastructure.mode", "Mode"), data.Mode ?? UnknownMode),
            new(localizer.GetString("infrastructure.speedComparison", "Speed Comparison"), data.Speedup ?? EmDash),
            new(
                localizer.GetString("infrastructure.fleetTelemetryLatency", "Fleet Telemetry Latency"),
                data.FleetTelemetryLatency ?? EmDash),
            new(
                localizer.GetString("infrastructure.fleetApiPolling", "Fleet API Polling"),
                data.FleetApiPolling ?? EmDash),
        };

        IReadOnlyList<InfrastructureRow>? metrics = data.Pool is { } pool
            ? new List<InfrastructureRow>(3)
            {
                new(localizer.GetString("infrastructure.totalConns", "Total Conns"), FormatCount(pool.TotalConns)),
                new(localizer.GetString("infrastructure.acquired", "Acquired"), FormatCount(pool.AcquiredConns)),
                new(localizer.GetString("infrastructure.idle", "Idle"), FormatCount(pool.IdleConns)),
            }
            : null;

        return new InfrastructureDisplay(connected, connectionText, polling, pollingText, sseRows, pollingRows, metrics);
    }

    // Web fmtInt(v) === fmtNumber(v, 0): a locale-grouped integer. The shared formatter renders the em-dash for
    // a null count, so a partial pool body still degrades gracefully.
    private static string FormatCount(long? value) =>
        ScalarFormatters.FormatNumber(value, 0, EmDash);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;InfrastructureSnapshot&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept pure so the
/// parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class InfrastructureResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<InfrastructureSnapshot> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        InfrastructureSnapshot Parse() =>
            raw.HasValue ? InfrastructureSnapshot.FromJson(raw.Value) : InfrastructureSnapshot.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<InfrastructureSnapshot>.Loading(),
            LoadStatus.Cached => RepositoryResult<InfrastructureSnapshot>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<InfrastructureSnapshot>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<InfrastructureSnapshot>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<InfrastructureSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<InfrastructureSnapshot>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<InfrastructureSnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the Infrastructure Section surface — the native mirror of the web component
/// (web/src/features/system/components/status/InfrastructureSection.tsx, rendered inside the system status page).
/// Centralises the stable id, category, diagnostics slug and the generated telemetry read operation so the view,
/// view-model and source stay free of literal identifiers.
/// </summary>
public static class InfrastructureSectionRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "infrastructure-section";

    /// <summary>Surface category (matches the web system feature).</summary>
    public const string Category = "system";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "InfrastructureSection";

    /// <summary>
    /// The generated operation for the primary <c>GET /telemetry/</c> read (web <c>getTelemetryStatus</c>).
    /// Operations.cs carries no telemetry entry yet, so the id is referenced verbatim here (scoped to this
    /// surface), exactly as the sibling SignalRateSource references it. It resolves against
    /// TeslaSync.Windows.Generated.Api.ApiEndpoints.
    /// </summary>
    public const string TelemetryOperation = "get_api_v1_telemetry";

    /// <summary>The shared cache key for the merged telemetry + extended-health read.</summary>
    public const string CacheKey = "infrastructure:status";
}

/// <summary>
/// PII-safe diagnostics for the Infrastructure Section surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an endpoint, protocol or pool count — so a
/// diagnostics line can never leak deployment data. Thread-safe.
/// </summary>
public sealed class InfrastructureSectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public InfrastructureSectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=InfrastructureSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={InfrastructureSectionRegistration.Slug}");
    }
}
