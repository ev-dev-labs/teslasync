using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="SystemHealthViewModel"/> can be in — the native union of the loading /
/// loaded / empty / error / stale / offline branches the web <c>SystemHealthWidget</c> renders through
/// <c>WidgetShell</c> (web/src/features/dashboard/widgets/SystemHealthWidget.tsx). The widget composes three
/// reads (server health, database stats, connection pool); the freshness chrome is driven by the health query
/// exactly like the web (<c>updatedAt=health.dataUpdatedAt</c>, <c>isFetching=health.isFetching</c>,
/// <c>isStale=health.isStale</c>, <c>isError=health.isError</c>). <see cref="Empty"/> mirrors the web
/// <c>!hasData</c> gate (<c>health.data == null</c>) — the "No system health data" surface.
/// </summary>
public enum SystemHealthState
{
    /// <summary>Initial fetch with no content from the health read — render the skeleton chrome.</summary>
    Loading,

    /// <summary>The health read resolved with an object and is current — render the body.</summary>
    Loaded,

    /// <summary>The health read carried no value (web <c>!hasData</c>) — render the "No system health data" surface.</summary>
    Empty,

    /// <summary>The health read failed and nothing is renderable — render the retry affordance.</summary>
    Error,

    /// <summary>The shown body is backed by a health read older than the freshness window — body plus a stale chip.</summary>
    Stale,

    /// <summary>The health read is offline but cached content remains — body plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> logic in web/src/features/dashboard/widgets/SystemHealthWidget.tsx
/// (<c>isCompact = size.cols &lt;= 1</c>). The registry footprint is 2×4 (default), 1×2 (min), 4×40 (max).
/// </summary>
/// <param name="Cols">Column span.</param>
/// <param name="Rows">Row span.</param>
public readonly record struct SystemHealthSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static SystemHealthSize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact</c>): the badge + overall-label stack.</summary>
    public bool IsCompact => Cols <= 1;
}

/// <summary>
/// The parsed <c>GET /system/health</c> body (web <c>useSystemHealth</c>). Only the fields the widget consumes
/// are kept: the overall <see cref="Status"/> (web <c>health.data?.status ?? 'unknown'</c>), the per-component
/// <see cref="Components"/> status map (web <c>health.data?.components</c>) and the optional
/// <see cref="DatabaseSize"/> (web <c>health.data?.databaseSize</c>, absent on the live endpoint and filled from
/// the db-stats read). A non-object body yields <see langword="null"/> — the read carried nothing.
/// </summary>
/// <param name="Status">The overall service status ("healthy" / "degraded" / "unhealthy" / …).</param>
/// <param name="Components">Component-name → status string (e.g. <c>database</c> → <c>healthy</c>).</param>
/// <param name="DatabaseSize">The database-size text when the health body carries it, else null.</param>
public sealed record SystemHealthReport(
    string Status,
    IReadOnlyDictionary<string, string> Components,
    string? DatabaseSize)
{
    /// <summary>
    /// Project a <c>GET /system/health</c> response into the snapshot. Reads <c>status</c> (defaulting to
    /// <c>unknown</c>, the web fallback), the <c>components</c> object (each entry's <c>status</c> string) and
    /// an optional <c>database_size</c> scalar. A non-object body yields <see langword="null"/>.
    /// </summary>
    public static SystemHealthReport? Parse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        string status = root.TryGetProperty("status", out var statusEl) && statusEl.ValueKind == JsonValueKind.String
            ? statusEl.GetString() ?? "unknown"
            : "unknown";

        var components = new Dictionary<string, string>(StringComparer.Ordinal);
        if (root.TryGetProperty("components", out var comps) && comps.ValueKind == JsonValueKind.Object)
        {
            foreach (var entry in comps.EnumerateObject())
            {
                if (entry.Value.ValueKind == JsonValueKind.Object &&
                    entry.Value.TryGetProperty("status", out var compStatus) &&
                    compStatus.ValueKind == JsonValueKind.String)
                {
                    string? value = compStatus.GetString();
                    if (!string.IsNullOrEmpty(value))
                    {
                        components[entry.Name] = value;
                    }
                }
            }
        }

        return new SystemHealthReport(status, components, JsonScalar.ReadText(root, "database_size"));
    }
}

/// <summary>
/// The parsed <c>GET /dev-tools/db-stats</c> body (web <c>useDBStats</c>). The widget consumes only the
/// <see cref="DatabaseSize"/> as the fallback DB-size value (web <c>dbStats.data?.databaseSize</c>). A
/// non-object body yields <see langword="null"/>.
/// </summary>
/// <param name="DatabaseSize">The database-size text, or null when absent.</param>
public sealed record DbStatsSnapshot(string? DatabaseSize)
{
    /// <summary>Project a <c>GET /dev-tools/db-stats</c> response into the snapshot, or null for a non-object body.</summary>
    public static DbStatsSnapshot? Parse(JsonElement root) =>
        root.ValueKind == JsonValueKind.Object ? new DbStatsSnapshot(JsonScalar.ReadText(root, "database_size")) : null;
}

/// <summary>
/// The parsed <c>GET /dev-tools/runtime-info</c> body (web <c>useConnectionPool</c>). Mirrors the exact subset
/// the web reads off the runtime payload: <see cref="InUse"/> (<c>in_use</c>), <see cref="MaxOpen"/>
/// (<c>max_open</c>), <see cref="Goroutines"/> (<c>goroutines</c>) and <see cref="MemoryMb"/>
/// (<c>memory_mb</c> / <c>memoryMB</c>). The runtime endpoint does not emit a megabyte figure, so
/// <see cref="MemoryMb"/> is normally <see langword="null"/> and the Memory stat renders the em dash — exactly
/// like the web, where <c>pool.data?.memoryMB</c> is undefined. A non-object body yields <see langword="null"/>.
/// </summary>
/// <param name="InUse">Connections currently checked out (web <c>pool.data?.inUse</c>).</param>
/// <param name="MaxOpen">Maximum open connections (web <c>pool.data?.maxOpen</c>).</param>
/// <param name="Goroutines">Live goroutine count (web <c>pool.data?.goroutines</c>).</param>
/// <param name="MemoryMb">Resident memory in megabytes (web <c>pool.data?.memoryMB</c>), usually null.</param>
public sealed record ConnectionPoolSnapshot(int? InUse, int? MaxOpen, long? Goroutines, double? MemoryMb)
{
    /// <summary>Project a <c>GET /dev-tools/runtime-info</c> response into the snapshot, or null for a non-object body.</summary>
    public static ConnectionPoolSnapshot? Parse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new ConnectionPoolSnapshot(
            JsonScalar.ReadInt(root, "in_use"),
            JsonScalar.ReadInt(root, "max_open"),
            JsonScalar.ReadLong(root, "goroutines"),
            JsonScalar.ReadDouble(root, "memory_mb") ?? JsonScalar.ReadDouble(root, "memoryMB"));
    }
}

/// <summary>Small reusable readers for the scalar fields the three reads expose, tolerant of string-or-number wire shapes.</summary>
public static class JsonScalar
{
    /// <summary>
    /// Read <paramref name="name"/> as display text: a JSON string is returned verbatim, a JSON number is
    /// returned as its raw token (so <c>database_size</c> surfaces whether the backend sends bytes or a
    /// formatted string, exactly as the web renders <c>value={dbSize}</c>). Anything else yields null.
    /// </summary>
    public static string? ReadText(JsonElement parent, string name)
    {
        if (!parent.TryGetProperty(name, out var el))
        {
            return null;
        }

        return el.ValueKind switch
        {
            JsonValueKind.String => NullIfEmpty(el.GetString()),
            JsonValueKind.Number => el.GetRawText(),
            _ => null,
        };
    }

    /// <summary>Read <paramref name="name"/> as a 32-bit integer, or null when absent / not an integral number.</summary>
    public static int? ReadInt(JsonElement parent, string name) =>
        parent.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.Number && el.TryGetInt32(out int v) ? v : null;

    /// <summary>Read <paramref name="name"/> as a 64-bit integer, or null when absent / not an integral number.</summary>
    public static long? ReadLong(JsonElement parent, string name) =>
        parent.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.Number && el.TryGetInt64(out long v) ? v : null;

    /// <summary>Read <paramref name="name"/> as a double, or null when absent / not a number.</summary>
    public static double? ReadDouble(JsonElement parent, string name) =>
        parent.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.Number && el.TryGetDouble(out double v) ? v : null;

    private static string? NullIfEmpty(string? value) => string.IsNullOrEmpty(value) ? null : value;
}

/// <summary>
/// The three reads merged into one value — the native analogue of the web component's <c>health</c> /
/// <c>dbStats</c> / <c>pool</c> hook results (web/src/features/dashboard/widgets/SystemHealthWidget.tsx). Each
/// slice is <see langword="null"/> only when its read carried no usable body (loading / failed / non-object).
/// <see cref="HasHealth"/> reproduces the web <c>hasData = health.data != null</c> gate — the health read is the
/// sole gate; the db-stats and pool reads only enrich the stat grid.
/// </summary>
/// <param name="Health">The parsed server-health body (web <c>health.data</c>), or null when the read carried nothing.</param>
/// <param name="Db">The parsed db-stats body (web <c>dbStats.data</c>), or null when the read carried nothing.</param>
/// <param name="Pool">The parsed runtime-info body (web <c>pool.data</c>), or null when the read carried nothing.</param>
public sealed record SystemHealthReading(
    SystemHealthReport? Health,
    DbStatsSnapshot? Db,
    ConnectionPoolSnapshot? Pool)
{
    /// <summary>True when the health read returned an object (web <c>hasData</c>).</summary>
    public bool HasHealth => Health is not null;
}

/// <summary>One service-status row projected for the WinUI view (web service-grid entry).</summary>
/// <param name="Label">The localized service label (web <c>t(`widget.systemHealth.${i18n}`, …)</c>).</param>
/// <param name="Severity">The status-dot severity token ("success" / "warning" / "critical").</param>
/// <param name="StatusText">The raw component status, surfaced in the row's Narrator name.</param>
public sealed record SystemServiceRow(string Label, string Severity, string StatusText);

/// <summary>
/// The fully projected, render-ready view of the system-health surface for one footprint — the native analogue
/// of everything the web component computes before returning JSX. Pure data so the projection is unit-tested
/// without a UI host; the WinUI view chooses the compact / standard composition from <see cref="IsCompact"/>.
/// </summary>
/// <param name="HasData">Web <c>hasData</c>; false renders the empty surface instead of the body.</param>
/// <param name="IsCompact">Web <c>isCompact</c> (single column).</param>
/// <param name="Health">The overall semantic health tone driving the badge / accent colour.</param>
/// <param name="OverallLabel">The localized overall label (Healthy / Degraded / Down).</param>
/// <param name="PresenceToken">The compact presence chip token (online / away / offline).</param>
/// <param name="HealthyCount">Count of services reporting ok / healthy (web <c>healthyCount</c>).</param>
/// <param name="TotalServices">Total tracked services (web <c>services.length</c>).</param>
/// <param name="ServicesLabel">The localized lowercase "services" caption.</param>
/// <param name="ServicesSummary">The precomposed "{healthy}/{total} services" caption (web compact line).</param>
/// <param name="Services">The four service rows (status dot + label).</param>
/// <param name="DbSizeLabel">The localized "DB Size" stat label.</param>
/// <param name="DbSizeText">The DB-size value (web <c>dbSize</c>), or the em dash.</param>
/// <param name="ActiveConnsLabel">The localized "Active Conns" stat label.</param>
/// <param name="ActiveConnsText">The active/max connection value (web <c>activeConns/maxConns</c>).</param>
/// <param name="MemoryLabel">The localized "Memory" stat label.</param>
/// <param name="MemoryText">The memory value (web <c>memory</c>), or the em dash.</param>
/// <param name="GoroutinesLabel">The localized "Goroutines" stat label.</param>
/// <param name="GoroutinesText">The goroutine value (web <c>goroutines</c>), or the em dash.</param>
/// <param name="AutomationName">Narrator summary of the standard body.</param>
/// <param name="CompactAutomationName">Narrator summary of the compact body.</param>
public sealed record SystemHealthDisplay(
    bool HasData,
    bool IsCompact,
    StatusKind Health,
    string OverallLabel,
    string PresenceToken,
    int HealthyCount,
    int TotalServices,
    string ServicesLabel,
    string ServicesSummary,
    IReadOnlyList<SystemServiceRow> Services,
    string DbSizeLabel,
    string DbSizeText,
    string ActiveConnsLabel,
    string ActiveConnsText,
    string MemoryLabel,
    string MemoryText,
    string GoroutinesLabel,
    string GoroutinesText,
    string AutomationName,
    string CompactAutomationName);

/// <summary>
/// Pure projection for the system-health surface — the native port of the web component's computation in
/// web/src/features/dashboard/widgets/SystemHealthWidget.tsx. Reproduces the fixed service list, the
/// status→colour mapping (<c>statusColor</c>), the overall label / presence mapping (<c>overallLabel</c> /
/// <c>overallBadgeStatus</c>), the healthy-count tally, the DB-size fallback chain, the active/max connection
/// formatting and the memory / goroutine readouts. Every label resolves through the i18n facade.
/// </summary>
public static class SystemHealthProjection
{
    /// <summary>Segoe Fluent glyph for the surface header / empty state (web <c>Server</c> icon).</summary>
    public const string ServerGlyph = "\uE968";

    /// <summary>The em dash the web renders for an absent value (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    // Web SERVICE_KEYS: the four tracked services, their i18n suffix, and the title-cased fallback the web
    // derives from the wire key (key.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase())). The labels
    // resolve through the i18n facade; these fallbacks reproduce the web's derived text 1:1.
    private static readonly ServiceKey[] ServiceKeys =
    [
        new("database", "db", "Database"),
        new("mqtt", "mqtt", "Mqtt"),
        new("tesla_api", "teslaApi", "Tesla Api"),
        new("fleet_telemetry", "workers", "Fleet Telemetry"),
    ];

    private static readonly IReadOnlyDictionary<string, string> EmptyComponents =
        new Dictionary<string, string>(StringComparer.Ordinal);

    private static readonly CultureInfo GroupingCulture = CultureInfo.GetCultureInfo("en-US");

    /// <summary>Project <paramref name="reading"/> for <paramref name="size"/> against the localizer.</summary>
    public static SystemHealthDisplay Project(SystemHealthReading reading, SystemHealthSize size, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(localizer);

        var health = reading.Health;
        string overall = health?.Status ?? "unknown";
        var components = health?.Components ?? EmptyComponents;

        var services = new List<SystemServiceRow>(ServiceKeys.Length);
        int healthyCount = 0;
        foreach (var svc in ServiceKeys)
        {
            string status = components.TryGetValue(svc.Key, out var value) ? value : "unhealthy";
            if (IsHealthy(status))
            {
                healthyCount++;
            }

            services.Add(new SystemServiceRow(
                localizer.GetString($"widget.systemHealth.{svc.I18n}", svc.Fallback),
                StatusSeverity(status),
                status));
        }

        int inUse = reading.Pool?.InUse ?? 0;
        int maxOpen = reading.Pool?.MaxOpen ?? 0;
        string activeConns = maxOpen > 0
            ? string.Create(GroupingCulture, $"{FormatInt(inUse)}/{FormatInt(maxOpen)}")
            : FormatInt(inUse);

        string dbSize = health?.DatabaseSize ?? reading.Db?.DatabaseSize ?? EmDash;
        string memory = reading.Pool?.MemoryMb is { } mb
            ? string.Create(GroupingCulture, $"{FormatInt(mb)} MB")
            : EmDash;
        string goroutines = reading.Pool?.Goroutines is { } gr ? FormatInt(gr) : EmDash;

        string overallLabel = OverallLabel(overall, localizer);
        string servicesLabel = localizer.GetString("widget.systemHealth.services", "services");
        string servicesSummary = string.Create(GroupingCulture, $"{healthyCount}/{services.Count} {servicesLabel}");
        string dbSizeLabel = localizer.GetString("widget.systemHealth.dbSize", "DB Size");
        string activeConnsLabel = localizer.GetString("widget.systemHealth.activeConns", "Active Conns");
        string memoryLabel = localizer.GetString("widget.systemHealth.memory", "Memory");
        string goroutinesLabel = localizer.GetString("widget.systemHealth.goroutines", "Goroutines");

        string automation = BuildAutomationName(
            localizer, overallLabel, healthyCount, services.Count, servicesLabel,
            dbSizeLabel, dbSize, activeConnsLabel, activeConns, memoryLabel, memory, goroutinesLabel, goroutines);
        string compactAutomation = BuildCompactAutomationName(
            localizer, overallLabel, healthyCount, services.Count, servicesLabel);

        return new SystemHealthDisplay(
            HasData: reading.HasHealth,
            IsCompact: size.IsCompact,
            Health: OverallHealth(overall),
            OverallLabel: overallLabel,
            PresenceToken: PresenceToken(overall),
            HealthyCount: healthyCount,
            TotalServices: services.Count,
            ServicesLabel: servicesLabel,
            ServicesSummary: servicesSummary,
            Services: services,
            DbSizeLabel: dbSizeLabel,
            DbSizeText: dbSize,
            ActiveConnsLabel: activeConnsLabel,
            ActiveConnsText: activeConns,
            MemoryLabel: memoryLabel,
            MemoryText: memory,
            GoroutinesLabel: goroutinesLabel,
            GoroutinesText: goroutines,
            AutomationName: automation,
            CompactAutomationName: compactAutomation);
    }

    /// <summary>True when a component reports a healthy status (web <c>status === 'ok' || status === 'healthy'</c>).</summary>
    public static bool IsHealthy(string status) =>
        string.Equals(status, "ok", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(status, "healthy", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Map a component status to the status-dot severity the way the web <c>statusColor</c> does: ok / healthy →
    /// success (green), degraded → warning (amber), anything else → critical (red).
    /// </summary>
    public static string StatusSeverity(string status)
    {
        if (IsHealthy(status))
        {
            return "success";
        }

        return string.Equals(status, "degraded", StringComparison.OrdinalIgnoreCase) ? "warning" : "critical";
    }

    /// <summary>
    /// Resolve the overall semantic tone (web <c>overallBadgeStatus</c> intent): healthy → success, degraded →
    /// warning, anything else → danger. Drives the header icon and the compact presence chip accent.
    /// </summary>
    public static StatusKind OverallHealth(string status)
    {
        if (string.Equals(status, "healthy", StringComparison.OrdinalIgnoreCase))
        {
            return StatusKind.Success;
        }

        return string.Equals(status, "degraded", StringComparison.OrdinalIgnoreCase)
            ? StatusKind.Warning
            : StatusKind.Danger;
    }

    /// <summary>The compact presence token (web <c>overallBadgeStatus</c>): healthy → online, degraded → away, else offline.</summary>
    public static string PresenceToken(string status)
    {
        if (string.Equals(status, "healthy", StringComparison.OrdinalIgnoreCase))
        {
            return "online";
        }

        return string.Equals(status, "degraded", StringComparison.OrdinalIgnoreCase) ? "away" : "offline";
    }

    /// <summary>Resolve the localized overall label (web <c>overallLabel</c>): Healthy / Degraded / Down.</summary>
    public static string OverallLabel(string status, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        if (string.Equals(status, "healthy", StringComparison.OrdinalIgnoreCase))
        {
            return localizer.GetString("widget.systemHealth.healthy", "Healthy");
        }

        return string.Equals(status, "degraded", StringComparison.OrdinalIgnoreCase)
            ? localizer.GetString("widget.systemHealth.degraded", "Degraded")
            : localizer.GetString("widget.systemHealth.down", "Down");
    }

    /// <summary>Format a count the way the web <c>fmtInt</c> does — en-US grouping, zero fraction digits.</summary>
    private static string FormatInt(long value) => value.ToString("N0", GroupingCulture);

    /// <summary>Format a (megabyte) measure the way the web <c>fmtInt</c> does — en-US grouping, zero fraction digits.</summary>
    private static string FormatInt(double value) => value.ToString("N0", GroupingCulture);

    private static string BuildAutomationName(
        ILocalizer localizer,
        string overallLabel,
        int healthyCount,
        int totalServices,
        string servicesLabel,
        string dbSizeLabel,
        string dbSize,
        string activeConnsLabel,
        string activeConns,
        string memoryLabel,
        string memory,
        string goroutinesLabel,
        string goroutines)
    {
        string title = localizer.GetString("widget.systemHealth.title", "System Health");
        return string.Create(
            CultureInfo.CurrentCulture,
            $"{title}: {overallLabel}, {healthyCount}/{totalServices} {servicesLabel}, {dbSizeLabel} {dbSize}, {activeConnsLabel} {activeConns}, {memoryLabel} {memory}, {goroutinesLabel} {goroutines}");
    }

    private static string BuildCompactAutomationName(
        ILocalizer localizer,
        string overallLabel,
        int healthyCount,
        int totalServices,
        string servicesLabel)
    {
        string title = localizer.GetString("widget.systemHealth.title", "System Health");
        return string.Create(
            CultureInfo.CurrentCulture,
            $"{title}: {overallLabel}, {healthyCount}/{totalServices} {servicesLabel}");
    }

    private readonly record struct ServiceKey(string Key, string I18n, string Fallback);
}

/// <summary>
/// Combines the three cache-then-network reads (server health, db stats, connection pool) into a single
/// <see cref="RepositoryResult{T}"/> over the merged <see cref="SystemHealthReading"/>, preserving the freshness
/// contract. The freshness / error chrome is driven solely by the health read, exactly like the web
/// (<c>updatedAt=health.dataUpdatedAt</c>, <c>isFetching=health.isFetching</c>, <c>isStale=health.isStale</c>,
/// <c>isError=health.isError</c>); the body's empty-vs-content choice is driven by whether the health read
/// carried a value (web <c>hasData = health.data != null</c>). Kept pure so the combine contract is unit-tested
/// without a network or cache.
/// </summary>
public static class SystemHealthResultMapper
{
    /// <summary>Fold the three resolved reads into one combined emission with health-driven freshness.</summary>
    /// <param name="health">The load-bearing server-health read.</param>
    /// <param name="db">The db-stats enrichment read, or null while it is still loading.</param>
    /// <param name="pool">The connection-pool enrichment read, or null while it is still loading.</param>
    public static RepositoryResult<SystemHealthReading> Combine(
        RepositoryResult<JsonElement> health,
        RepositoryResult<JsonElement>? db,
        RepositoryResult<JsonElement>? pool)
    {
        var healthSnap = HasContent(health) && health.Value is { } healthEl ? SystemHealthReport.Parse(healthEl) : null;
        var dbSnap = db is { } d && HasContent(d) && d.Value is { } dbEl ? DbStatsSnapshot.Parse(dbEl) : null;
        var poolSnap = pool is { } p && HasContent(p) && p.Value is { } poolEl ? ConnectionPoolSnapshot.Parse(poolEl) : null;

        var reading = new SystemHealthReading(healthSnap, dbSnap, poolSnap);

        if (!reading.HasHealth)
        {
            // Web parity: health.data == null → !hasData. A health hard-failure collapses to the retry surface;
            // otherwise this is the friendly "No system health data" empty surface.
            return health.Status == LoadStatus.Error
                ? RepositoryResult<SystemHealthReading>.Failure(
                    health.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Couldn't load system health"))
                : RepositoryResult<SystemHealthReading>.Empty(health.FetchedAt);
        }

        // hasData → the body renders; the health read tints the freshness chip (web chrome).
        DateTimeOffset stamp = health.FetchedAt
            ?? db?.FetchedAt
            ?? pool?.FetchedAt
            ?? DateTimeOffset.UtcNow;

        return health.Status switch
        {
            // Health offline / errored but its cached object remains — keep the body, tint the chip as offline.
            LoadStatus.Offline or LoadStatus.Error => RepositoryResult<SystemHealthReading>.OfflineCached(
                reading, stamp, health.Error ?? new RepositoryError(RepositoryErrorKind.Network, "System health is unavailable")),

            // Health still in flight while its cached object is shown — body plus the "Updating…" chip.
            LoadStatus.Loading or LoadStatus.Refreshing => RepositoryResult<SystemHealthReading>.Refreshing(
                reading, stamp, health.IsStale),

            // Health surfaced a (possibly stale) cached value.
            LoadStatus.Cached => RepositoryResult<SystemHealthReading>.Cached(reading, stamp, health.IsStale),

            // Health returned fresh (Loaded) — fresh chrome unless flagged stale.
            _ => health.IsStale
                ? RepositoryResult<SystemHealthReading>.Cached(reading, stamp, stale: true)
                : RepositoryResult<SystemHealthReading>.Loaded(reading, stamp),
        };
    }

    private static bool HasContent(RepositoryResult<JsonElement> result) =>
        result.Status is LoadStatus.Cached or LoadStatus.Refreshing or LoadStatus.Loaded or LoadStatus.Offline;
}
