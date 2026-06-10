using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the backend-status surface. Every getter returns a
/// nullable / fallback rather than throwing so a partial or schema-drifted body from
/// <c>GET /system/health</c>, <c>/dev-tools/runtime-info</c> or <c>/system/version</c> never aborts the parse
/// (web parity: the React hooks tolerate undefined fields and render the em-dash / zero). Kept private to the
/// surface and free of WinUI types so the parse is unit-tested without a UI host.
/// </summary>
internal static class BackendStatusJson
{
    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

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
            JsonValueKind.Number when prop.TryGetDouble(out var d) => (long)d,
            JsonValueKind.String when long.TryParse(prop.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    /// <summary>The double value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static double? GetDouble(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetDouble(out var d) => d,
            JsonValueKind.String when double.TryParse(prop.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    /// <summary>The nested object value of <paramref name="name"/>, or null when absent / not an object.</summary>
    public static JsonElement? GetObject(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.Object
            ? prop
            : null;

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
/// One component-health entry from <c>GET /system/health</c> — the native analogue of one
/// <c>extHealth.components[name]</c> entry in
/// web/src/features/system/components/status/BackendStatusSection.tsx. Field names mirror the Go API's
/// snake_case JSON tags; parsing is null-tolerant (web parity — the component coalesces with
/// <c>?? 0</c>/<c>?? ''</c>). The raw <see cref="LastCheck"/> string is kept and parsed on demand.
/// </summary>
public sealed record ComponentHealth(
    string Name,
    string Status,
    double LatencyMs,
    long ConsecutiveFailures,
    string? LastCheck)
{
    /// <summary>The parsed last-check instant, or null when absent / unparseable.</summary>
    public DateTimeOffset? LastCheckInstant => BackendStatusJson.TryParseTimestamp(LastCheck);
}

/// <summary>
/// The parsed <c>GET /system/health</c> envelope (web <c>ExtendedHealthResponse</c>): the overall status, the
/// component-health map projected to an ordered list, and the embedded <c>system</c> runtime block the web
/// uses as the fallback for the System Runtime section. Parsing is null-tolerant and order-preserving.
/// </summary>
public sealed record BackendHealthSnapshot(
    string Status,
    IReadOnlyList<ComponentHealth> Components,
    bool HasSystem,
    string? SystemGoVersion,
    long SystemUptimeSeconds,
    long SystemGoroutines)
{
    /// <summary>An empty snapshot (no status, no components, no system block).</summary>
    public static BackendHealthSnapshot Empty { get; } = new(
        string.Empty, Array.Empty<ComponentHealth>(), false, null, 0, 0);

    /// <summary>Project a <c>GET /system/health</c> JSON object into a tolerant snapshot.</summary>
    public static BackendHealthSnapshot FromJson(JsonElement obj)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        var components = new List<ComponentHealth>();
        if (BackendStatusJson.GetObject(obj, "components") is { } map)
        {
            foreach (var entry in map.EnumerateObject())
            {
                var c = entry.Value;
                components.Add(new ComponentHealth(
                    Name: entry.Name,
                    Status: BackendStatusJson.GetString(c, "status") ?? string.Empty,
                    LatencyMs: BackendStatusJson.GetDouble(c, "latency_ms") ?? 0,
                    ConsecutiveFailures: BackendStatusJson.GetLong(c, "consecutive_failures") ?? 0,
                    LastCheck: BackendStatusJson.GetString(c, "last_check")));
            }
        }

        var system = BackendStatusJson.GetObject(obj, "system");
        return new BackendHealthSnapshot(
            Status: BackendStatusJson.GetString(obj, "status") ?? string.Empty,
            Components: components,
            HasSystem: system is not null,
            SystemGoVersion: system is { } s ? BackendStatusJson.GetString(s, "go_version") : null,
            SystemUptimeSeconds: system is { } s2 ? BackendStatusJson.GetLong(s2, "uptime_seconds") ?? 0 : 0,
            SystemGoroutines: system is { } s3 ? BackendStatusJson.GetLong(s3, "goroutines") ?? 0 : 0);
    }
}

/// <summary>
/// The parsed <c>GET /dev-tools/runtime-info</c> connection-pool envelope (web <c>ConnectionPool</c>). The Go
/// handler emits snake_case (<c>max_open</c>, <c>open</c>, <c>in_use</c>, <c>idle</c>, <c>wait_count</c>);
/// <see cref="Present"/> reproduces the web <c>{pool &amp;&amp; …}</c> presence gate so the surface knows
/// whether the pool section has data to show.
/// </summary>
public sealed record ConnectionPoolSnapshot(
    bool Present,
    long MaxOpen,
    long Open,
    long InUse,
    long Idle,
    long WaitCount)
{
    /// <summary>An absent pool (the read returned nothing usable).</summary>
    public static ConnectionPoolSnapshot Absent { get; } = new(false, 0, 0, 0, 0, 0);

    /// <summary>Project a <c>GET /dev-tools/runtime-info</c> JSON object into a tolerant snapshot.</summary>
    public static ConnectionPoolSnapshot FromJson(JsonElement obj)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return Absent;
        }

        return new ConnectionPoolSnapshot(
            Present: true,
            MaxOpen: BackendStatusJson.GetLong(obj, "max_open") ?? 0,
            Open: BackendStatusJson.GetLong(obj, "open") ?? 0,
            InUse: BackendStatusJson.GetLong(obj, "in_use") ?? 0,
            Idle: BackendStatusJson.GetLong(obj, "idle") ?? 0,
            WaitCount: BackendStatusJson.GetLong(obj, "wait_count") ?? 0);
    }
}

/// <summary>
/// The parsed <c>GET /system/version</c> envelope (web <c>VersionInfo</c>). <see cref="Present"/> reproduces
/// the web <c>version</c> truthiness the OS / Arch line and the runtime fallbacks depend on.
/// </summary>
public sealed record VersionSnapshot(
    bool Present,
    string? GoVersion,
    long UptimeSeconds,
    long Goroutines,
    string? Os,
    string? Arch)
{
    /// <summary>An absent version (the read returned nothing usable).</summary>
    public static VersionSnapshot Absent { get; } = new(false, null, 0, 0, null, null);

    /// <summary>Project a <c>GET /system/version</c> JSON object into a tolerant snapshot.</summary>
    public static VersionSnapshot FromJson(JsonElement obj)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return Absent;
        }

        return new VersionSnapshot(
            Present: true,
            GoVersion: BackendStatusJson.GetString(obj, "go_version"),
            UptimeSeconds: BackendStatusJson.GetLong(obj, "uptime_seconds") ?? 0,
            Goroutines: BackendStatusJson.GetLong(obj, "goroutines") ?? 0,
            Os: BackendStatusJson.GetString(obj, "os"),
            Arch: BackendStatusJson.GetString(obj, "arch"));
    }
}

/// <summary>
/// The lifecycle state the backend-status section can be in. Every branch maps onto a visible surface — none
/// is ever hidden (engineering rule #6). The web shows <c>Skeleton → sections | empty table</c>; the native
/// surface additionally renders an explicit <c>error</c> (retry), <c>stale</c> and <c>offline</c> branch (a
/// strict superset of the web that satisfies the prompt's mandated state set).
/// </summary>
public enum BackendStatusSectionState
{
    /// <summary>First fetch with nothing cached — render the skeleton (web <c>extLoading || poolLoading</c>).</summary>
    Loading,

    /// <summary>A fresh result with content to show.</summary>
    Loaded,

    /// <summary>The read resolved with no components, pool or runtime — the friendly empty text.</summary>
    Empty,

    /// <summary>The health read failed and no cached content exists — the retry affordance.</summary>
    Error,

    /// <summary>A cached result older than the freshness window — content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but cached content remains — content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One projected, render-ready component-health row — the native analogue of a <c>componentColumns</c> row in
/// web/src/features/system/components/status/BackendStatusSection.tsx. Holds the status (raw text + the
/// semantic <see cref="StatusKind"/> and a Fluent glyph the web renders via <c>getStatusIcon</c> /
/// <c>statusTextClass</c>), the formatted latency and failure counts (with the web's red treatment when
/// failures &gt; 0), the formatted last-check string and a Narrator name. Pure data — no WinUI types.
/// </summary>
public sealed record ComponentHealthRow(
    string Name,
    string StatusText,
    StatusKind StatusKind,
    string StatusGlyph,
    string LatencyText,
    string FailuresText,
    bool HasFailures,
    string LastCheckText,
    string AutomationName);

/// <summary>
/// The projected, render-ready database connection-pool block — the native analogue of the five
/// <c>StatCard</c>s in the web DB pool grid. Values are pre-formatted; <see cref="Present"/> mirrors the web
/// <c>{pool &amp;&amp; …}</c> gate.
/// </summary>
public sealed record ConnectionPoolDisplay(
    bool Present,
    string MaxOpenText,
    string OpenText,
    string InUseText,
    string IdleText,
    string WaitCountText)
{
    /// <summary>An absent pool display.</summary>
    public static ConnectionPoolDisplay Absent { get; } = new(false, "0", "0", "0", "0", "0");
}

/// <summary>One label/value pair for the System Runtime list (UI-free analogue of a web <c>KVList</c> item).</summary>
public sealed record RuntimeItem(string Label, string Value);

/// <summary>
/// The projected, render-ready System Runtime block — the native analogue of the web <c>KVList</c> (Go
/// Version, Uptime, Goroutines, OS / Arch). <see cref="Present"/> mirrors the web
/// <c>{(extHealth?.system || version) &amp;&amp; …}</c> gate.
/// </summary>
public sealed record SystemRuntimeDisplay(bool Present, IReadOnlyList<RuntimeItem> Items)
{
    /// <summary>An absent runtime display.</summary>
    public static SystemRuntimeDisplay Absent { get; } = new(false, Array.Empty<RuntimeItem>());
}

/// <summary>
/// The fully projected, render-ready view of the backend-status section — the native analogue of the web
/// component's combined render (the okCount badge, the component table, the pool grid and the runtime list).
/// <see cref="HasAnyContent"/> reproduces "is there anything to show across all three reads"; the section's
/// empty state is shown only when it is false.
/// </summary>
public sealed record BackendStatusDisplay(
    IReadOnlyList<ComponentHealthRow> ComponentRows,
    int OkCount,
    int ComponentCount,
    bool HasComponents,
    bool HasBadge,
    string BadgeText,
    StatusKind BadgeStatus,
    ConnectionPoolDisplay Pool,
    SystemRuntimeDisplay Runtime)
{
    /// <summary>True when any of the three reads produced something to render.</summary>
    public bool HasAnyContent => HasComponents || Pool.Present || Runtime.Present;

    /// <summary>An empty display (nothing to show across all three reads).</summary>
    public static BackendStatusDisplay Empty { get; } = new(
        Array.Empty<ComponentHealthRow>(), 0, 0, false, false, string.Empty, StatusKind.Success,
        ConnectionPoolDisplay.Absent, SystemRuntimeDisplay.Absent);
}

/// <summary>
/// Pure projection from the parsed snapshots to the display model — the native port of the web component's
/// render functions: the okCount badge variant, the <c>componentColumns</c> cells, the <c>getStatusIcon</c> /
/// <c>statusTextClass</c> status mapping, the <c>formatUptime</c> helper and the runtime fallbacks. <c>now</c>
/// is injected so the last-check formatting is deterministic; every label resolves through the i18n facade.
/// No WinUI types — unit-tested without a UI host.
/// </summary>
public static class BackendStatusProjection
{
    /// <summary>Fluent glyph for a healthy/ok component (web green <c>CheckCircle</c>).</summary>
    public const string HealthyGlyph = "\uEC61"; // CompletedSolid

    /// <summary>Fluent glyph for a degraded/warning component (web amber <c>AlertTriangle</c>).</summary>
    public const string WarningGlyph = "\uE7BA"; // Warning

    /// <summary>Fluent glyph for an unhealthy/error component (web red <c>XCircle</c>).</summary>
    public const string DangerGlyph = "\uEB90"; // StatusErrorFull

    /// <summary>Fluent glyph for an unknown component status (web default <c>AlertTriangle</c>).</summary>
    public const string UnknownGlyph = "\uE897"; // Help

    /// <summary>Em-dash fallback for absent strings (web parity '—').</summary>
    public const string EmDash = "\u2014";

    /// <summary>Map a backend status string to its semantic <see cref="StatusKind"/> (web <c>statusTextClass</c>).</summary>
    public static StatusKind StatusKindFor(string? status) => (status ?? string.Empty).Trim().ToLowerInvariant() switch
    {
        "healthy" or "ok" or "online" or "connected" or "ready" or "sent" or "completed" => StatusKind.Success,
        "degraded" or "warning" or "pending" or "queued" or "processing" => StatusKind.Warning,
        "unhealthy" or "offline" or "error" or "down" or "failed" => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };

    /// <summary>The Fluent status glyph for a backend status string (web <c>getStatusIcon</c>).</summary>
    public static string StatusGlyphFor(string? status) => StatusKindFor(status) switch
    {
        StatusKind.Success => HealthyGlyph,
        StatusKind.Warning => WarningGlyph,
        StatusKind.Danger => DangerGlyph,
        _ => UnknownGlyph,
    };

    /// <summary>True when a component status counts toward the "healthy" badge tally (web ok/healthy).</summary>
    public static bool IsHealthy(string? status) => (status ?? string.Empty).Trim().ToLowerInvariant() is "ok" or "healthy";

    /// <summary>Port of the web <c>formatUptime</c>: "{d}d {h}h {m}m" / "{h}h {m}m" / "{m}m".</summary>
    public static string FormatUptime(long seconds)
    {
        if (seconds < 0)
        {
            seconds = 0;
        }

        long days = seconds / 86400;
        long hours = (seconds % 86400) / 3600;
        long mins = (seconds % 3600) / 60;
        if (days > 0)
        {
            return string.Create(CultureInfo.CurrentCulture, $"{days}d {hours}h {mins}m");
        }

        if (hours > 0)
        {
            return string.Create(CultureInfo.CurrentCulture, $"{hours}h {mins}m");
        }

        return string.Create(CultureInfo.CurrentCulture, $"{mins}m");
    }

    /// <summary>Project all three snapshots into the combined display using the i18n facade.</summary>
    public static BackendStatusDisplay Project(
        BackendHealthSnapshot health,
        ConnectionPoolSnapshot pool,
        VersionSnapshot version,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(health);
        ArgumentNullException.ThrowIfNull(pool);
        ArgumentNullException.ThrowIfNull(version);
        ArgumentNullException.ThrowIfNull(localizer);

        var rows = new List<ComponentHealthRow>(health.Components.Count);
        int okCount = 0;
        foreach (var c in health.Components)
        {
            if (IsHealthy(c.Status))
            {
                okCount++;
            }

            rows.Add(BuildRow(c, now, localizer));
        }

        int count = rows.Count;
        bool hasComponents = count > 0;

        // web: <Badge variant={okCount === count ? 'success' : 'warning'}>{okCount}/{count} healthy</Badge>
        bool hasBadge = hasComponents;
        StatusKind badgeStatus = okCount == count ? StatusKind.Success : StatusKind.Warning;
        string healthyLabel = localizer.GetString("featureView.backendStatus.healthy", "healthy");
        string badgeText = string.Create(CultureInfo.CurrentCulture, $"{okCount}/{count} {healthyLabel}");

        return new BackendStatusDisplay(
            ComponentRows: rows,
            OkCount: okCount,
            ComponentCount: count,
            HasComponents: hasComponents,
            HasBadge: hasBadge,
            BadgeText: badgeText,
            BadgeStatus: badgeStatus,
            Pool: ProjectPool(pool),
            Runtime: ProjectRuntime(health, version, localizer));
    }

    private static ComponentHealthRow BuildRow(ComponentHealth c, DateTimeOffset now, ILocalizer localizer)
    {
        string status = string.IsNullOrEmpty(c.Status) ? EmDash : c.Status;
        bool hasFailures = c.ConsecutiveFailures > 0;
        string latency = string.Create(CultureInfo.CurrentCulture, $"{ScalarFormatters.FormatNumber(c.LatencyMs, 1)} ms");
        string failures = ScalarFormatters.FormatNumber(c.ConsecutiveFailures, 0);
        string lastCheck = c.LastCheckInstant is { } instant
            ? DateTimeFormatting.Format(instant, DateTimeVariant.Full, now)
            : EmDash;

        return new ComponentHealthRow(
            Name: c.Name,
            StatusText: status,
            StatusKind: StatusKindFor(c.Status),
            StatusGlyph: StatusGlyphFor(c.Status),
            LatencyText: latency,
            FailuresText: failures,
            HasFailures: hasFailures,
            LastCheckText: lastCheck,
            AutomationName: ComponentAutomationName(c.Name, status, latency, failures, lastCheck, localizer));
    }

    private static ConnectionPoolDisplay ProjectPool(ConnectionPoolSnapshot pool)
    {
        if (!pool.Present)
        {
            return ConnectionPoolDisplay.Absent;
        }

        return new ConnectionPoolDisplay(
            Present: true,
            MaxOpenText: ScalarFormatters.FormatNumber(pool.MaxOpen, 0),
            OpenText: ScalarFormatters.FormatNumber(pool.Open, 0),
            InUseText: ScalarFormatters.FormatNumber(pool.InUse, 0),
            IdleText: ScalarFormatters.FormatNumber(pool.Idle, 0),
            WaitCountText: ScalarFormatters.FormatNumber(pool.WaitCount, 0));
    }

    private static SystemRuntimeDisplay ProjectRuntime(
        BackendHealthSnapshot health,
        VersionSnapshot version,
        ILocalizer localizer)
    {
        // web: shown when (extHealth?.system || version)
        bool present = health.HasSystem || version.Present;
        if (!present)
        {
            return SystemRuntimeDisplay.Absent;
        }

        // web fallbacks: version?.X ?? extHealth?.system?.X ?? 0/'—'
        string goVersion = version.GoVersion ?? health.SystemGoVersion ?? EmDash;
        long uptime = version.Present ? version.UptimeSeconds : health.SystemUptimeSeconds;
        long goroutines = version.Present ? version.Goroutines : health.SystemGoroutines;
        string osArch = version.Present
            ? string.Create(CultureInfo.CurrentCulture, $"{version.Os ?? EmDash} / {version.Arch ?? EmDash}")
            : EmDash;

        var items = new List<RuntimeItem>(4)
        {
            new(localizer.GetString("featureView.backendStatus.goVersion", "Go Version"), goVersion),
            new(localizer.GetString("featureView.backendStatus.uptime", "Uptime"), FormatUptime(uptime)),
            new(localizer.GetString("featureView.backendStatus.goroutines", "Goroutines"), ScalarFormatters.FormatNumber(goroutines, 0)),
            new(localizer.GetString("featureView.backendStatus.osArch", "OS / Arch"), osArch),
        };

        return new SystemRuntimeDisplay(true, items);
    }

    private static string ComponentAutomationName(
        string name,
        string status,
        string latency,
        string failures,
        string lastCheck,
        ILocalizer localizer)
    {
        string statusLabel = localizer.GetString("featureView.backendStatus.col.status", "Status");
        string latencyLabel = localizer.GetString("featureView.backendStatus.col.latency", "Latency");
        string failuresLabel = localizer.GetString("featureView.backendStatus.col.failures", "Failures");
        string lastCheckLabel = localizer.GetString("featureView.backendStatus.col.lastCheck", "Last Check");
        return string.Format(
            CultureInfo.CurrentCulture,
            "{0}, {1}: {2}, {3}: {4}, {5}: {6}, {7}: {8}",
            name,
            statusLabel,
            status,
            latencyLabel,
            latency,
            failuresLabel,
            failures,
            lastCheckLabel,
            lastCheck);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions to typed snapshot results for
/// the three backend-status reads, preserving the cache-then-network status/freshness while parsing the
/// snake_case payload (the native analogue of the web hooks' typed query results). Pure — unit-tested without
/// a network or cache.
/// </summary>
public static class BackendStatusResultMapper
{
    /// <summary>Map a raw extended-health emission to a typed snapshot result.</summary>
    public static RepositoryResult<BackendHealthSnapshot> MapHealth(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);
        return Map(raw, BackendHealthSnapshot.FromJson, BackendHealthSnapshot.Empty);
    }

    /// <summary>Map a raw connection-pool emission to a typed snapshot result.</summary>
    public static RepositoryResult<ConnectionPoolSnapshot> MapPool(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);
        return Map(raw, ConnectionPoolSnapshot.FromJson, ConnectionPoolSnapshot.Absent);
    }

    /// <summary>Map a raw runtime-version emission to a typed snapshot result.</summary>
    public static RepositoryResult<VersionSnapshot> MapVersion(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);
        return Map(raw, VersionSnapshot.FromJson, VersionSnapshot.Absent);
    }

    private static RepositoryResult<T> Map<T>(
        RepositoryResult<JsonElement> raw,
        Func<JsonElement, T> parse,
        T empty)
        where T : class
    {
        switch (raw.Status)
        {
            case LoadStatus.Loading:
                return RepositoryResult<T>.Loading();

            case LoadStatus.Empty:
                return RepositoryResult<T>.Empty(raw.FetchedAt);

            case LoadStatus.Error:
                return RepositoryResult<T>.Failure(
                    raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error"));
        }

        var value = parse(raw.Value);
        var fetchedAt = raw.FetchedAt ?? DateTimeOffset.UtcNow;

        return raw.Status switch
        {
            LoadStatus.Cached => RepositoryResult<T>.Cached(value, fetchedAt, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<T>.Refreshing(value, fetchedAt, raw.IsStale),
            LoadStatus.Offline => RepositoryResult<T>.OfflineCached(
                value, fetchedAt, raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Offline")),
            _ => RepositoryResult<T>.Loaded(value, fetchedAt),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the backend-status surface — the native mirror of the web
/// <c>BackendStatusSection</c>. Centralises the stable id, the diagnostics slug and the localized
/// title/description so the view and the view-model stay free of literal copy.
/// </summary>
public static class BackendStatusRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "backend-status-section";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "BackendStatusSection";

    /// <summary>Localized section title (web <c>t('Backend Status')</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Require(localizer).GetString("featureView.backendStatus.title", "Backend Status");

    /// <summary>Localized section description (web <c>t('Component health, database pool, and runtime info')</c>).</summary>
    public static string Description(ILocalizer localizer) =>
        Require(localizer).GetString(
            "featureView.backendStatus.description", "Component health, database pool, and runtime info");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the backend-status surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a component name, status or runtime
/// detail — so a diagnostics line can never leak infrastructure topology. Thread-safe.
/// </summary>
public sealed class BackendStatusDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public BackendStatusDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=BackendStatusSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={BackendStatusRegistration.Slug}");
    }
}
