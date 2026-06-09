using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets.UptimeMonitor;

/// <summary>
/// The lifecycle state a <see cref="UptimeMonitorViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>UptimeMonitorWidget</c> renders
/// through <c>WidgetShell</c> (web/src/features/dashboard/widgets/UptimeMonitorWidget.tsx). Every branch maps
/// onto a visible surface; none is ever hidden. The web shows the friendly empty surface only when the query
/// resolved with no body at all (<c>data ? content : &lt;EmptyState&gt;</c>), so <see cref="Empty"/> is the
/// lone "no data" state — an object body (even an empty <c>{}</c>) is content.
/// </summary>
public enum UptimeMonitorState
{
    /// <summary>Initial fetch with no cached body — render the skeleton chrome.</summary>
    Loading,

    /// <summary>Fresh data from the network (or non-stale cache) with a system-health body.</summary>
    Loaded,

    /// <summary>The request succeeded but returned no body — render the "no system health data" empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached value exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached value older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached value remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// Tolerant JSON readers shared by the system-health parser. Each returns <see langword="null"/> (or a zero
/// default) for an absent / wrong-kind property so a partial wire body never throws — mirroring the web
/// component's defensive <c>?? 0</c> / <c>?? null</c> reads. Both the Go API's snake_case wire keys and the
/// camelCase aliases the SPA's <c>camelCaseKeys()</c> transform produces are accepted (snake_case first) so
/// the same parser is correct whichever shape a value arrives in.
/// </summary>
internal static class UptimeMonitorJson
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

    internal static int GetInt(JsonElement obj, string snake, string camel, int fallback)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return fallback;
        }

        if (TryReadInt(obj, snake, out var fromSnake))
        {
            return fromSnake;
        }

        return TryReadInt(obj, camel, out var fromCamel) ? fromCamel : fallback;
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

    private static bool TryReadInt(JsonElement obj, string name, out int value)
    {
        value = 0;
        if (!obj.TryGetProperty(name, out var v))
        {
            return false;
        }

        switch (v.ValueKind)
        {
            case JsonValueKind.Number when v.TryGetInt32(out var n):
                value = n;
                return true;
            case JsonValueKind.String when int.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n):
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
            case JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n):
                value = n;
                return true;
            default:
                return false;
        }
    }
}

/// <summary>
/// One component's health from the <c>components</c> map of <c>GET /system/health</c> — the native analogue of
/// the web <c>SystemHealthComponent</c> (web/src/types/admin.ts). Holds the wire <see cref="Status"/> string
/// verbatim (the web keeps the raw status token, never translating it) under its map <see cref="Key"/>, plus
/// the diagnostic <see cref="ConsecutiveFailures"/> / <see cref="LastError"/> the web also derives (defensively
/// defaulted) even though it renders only the status. Pure data so the parse + projection are unit-tested
/// without a UI host.
/// </summary>
/// <param name="Key">The component's key in the <c>components</c> map (e.g. <c>tesla_api</c>), kept verbatim.</param>
/// <param name="Status">The raw status token (e.g. <c>healthy</c> / <c>degraded</c> / <c>unhealthy</c>).</param>
/// <param name="ConsecutiveFailures">The component's consecutive-failure count (web <c>consecutiveFailures ?? 0</c>).</param>
/// <param name="LastError">The component's last error message, or <see langword="null"/> when none.</param>
public sealed record SystemHealthComponent(string Key, string Status, int ConsecutiveFailures, string? LastError);

/// <summary>
/// The parsed <c>GET /system/health</c> payload backing the widget — the native analogue of the web
/// <c>SystemHealth</c> read model (web/src/types/admin.ts) consumed by <c>useSystemHealth</c>. Carries the
/// top-level <see cref="OverallStatus"/> (web <c>data.status ?? 'unknown'</c>), the parsed
/// <see cref="Components"/> map entries, and the optional <see cref="DatabaseSize"/> / <see cref="TableCount"/>
/// the web shows in its tall footer (each <c>?? '—'</c> when the endpoint omits them).
/// <see cref="HasData"/> distinguishes a fetched object body (even an empty one — rendered as content, web
/// <c>data</c> truthiness) from the absent-body fallback used for the first projection and the friendly empty
/// surface. Round-trips losslessly through the cache via System.Text.Json over its own serialization.
/// </summary>
public sealed record SystemHealthSnapshot(
    string OverallStatus,
    IReadOnlyList<SystemHealthComponent> Components,
    string? DatabaseSize,
    long? TableCount)
{
    /// <summary>The default overall status when the body omits it (web <c>data.status ?? 'unknown'</c>).</summary>
    public const string UnknownStatus = "unknown";

    /// <summary>The per-service status assumed when a component is absent (web <c>components[key]?.status ?? 'unhealthy'</c>).</summary>
    public const string UnhealthyStatus = "unhealthy";

    /// <summary>The absent-body fallback (no payload yet) — flagged <see cref="HasData"/> = false.</summary>
    public static SystemHealthSnapshot Empty { get; } =
        new(UnknownStatus, Array.Empty<SystemHealthComponent>(), null, null) { HasData = false };

    /// <summary>True when an object body was fetched (web <c>data</c> truthiness). False only for <see cref="Empty"/>.</summary>
    public bool HasData { get; init; } = true;

    /// <summary>The component for <paramref name="key"/> (ordinal match, web <c>components[key]</c>), or null when absent.</summary>
    public SystemHealthComponent? Component(string key)
    {
        for (int i = 0; i < Components.Count; i++)
        {
            if (string.Equals(Components[i].Key, key, StringComparison.Ordinal))
            {
                return Components[i];
            }
        }

        return null;
    }

    /// <summary>
    /// Project a <c>GET /system/health</c> JSON body into a snapshot. A non-object body (JSON null, a 204, or
    /// an unexpected array) yields an absent-body snapshot (web falsy <c>data</c>); an object — even an empty
    /// <c>{}</c> — yields a content snapshot whose missing fields default exactly as the web's <c>?? </c> reads.
    /// </summary>
    public static SystemHealthSnapshot FromJson(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        string overall = UptimeMonitorJson.GetString(root, "status", "status")
            ?? UptimeMonitorJson.GetString(root, "overall", "overall")
            ?? UnknownStatus;

        var components = ParseComponents(root);
        string? dbSize = UptimeMonitorJson.GetString(root, "database_size", "databaseSize");
        long? tableCount = UptimeMonitorJson.GetLong(root, "table_count", "tableCount");

        return new SystemHealthSnapshot(overall, components, dbSize, tableCount);
    }

    /// <summary>Project the <c>components</c> object into a tolerant list of <see cref="SystemHealthComponent"/>.</summary>
    public static IReadOnlyList<SystemHealthComponent> ParseComponents(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object ||
            !root.TryGetProperty("components", out var components) ||
            components.ValueKind != JsonValueKind.Object)
        {
            return Array.Empty<SystemHealthComponent>();
        }

        var list = new List<SystemHealthComponent>();
        foreach (var member in components.EnumerateObject())
        {
            var value = member.Value;
            string status = UptimeMonitorJson.GetString(value, "status", "status") ?? UnhealthyStatus;
            int failures = UptimeMonitorJson.GetInt(value, "consecutive_failures", "consecutiveFailures", 0);
            string? lastError = UptimeMonitorJson.GetString(value, "last_error", "lastError");
            list.Add(new SystemHealthComponent(member.Name, status, failures, lastError));
        }

        return list;
    }
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> / <c>isTall</c> logic in web/src/features/dashboard/widgets/UptimeMonitorWidget.tsx: a
/// single 1×1 cell shows the compact healthy-count metric; any taller footprint shows the per-service rows,
/// and (since <c>isTall = rows &gt;= 2</c>) the DB-size / table-count footer.
/// </summary>
public readonly record struct UptimeMonitorSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×2).</summary>
    public static UptimeMonitorSize Default => new(2, 2);

    /// <summary>True at a single 1×1 cell (web <c>isCompact = size.cols === 1 &amp;&amp; size.rows === 1</c>).</summary>
    public bool IsCompact => Cols == 1 && Rows == 1;

    /// <summary>True at two-plus rows (web <c>isTall = size.rows &gt;= 2</c>), gating the DB/tables footer.</summary>
    public bool IsTall => Rows >= 2;
}

/// <summary>
/// One projected, display-ready service row consumed by the WinUI service list — the native analogue of the
/// web <c>ServiceRow</c> (a status dot + label + status badge). Holds the localized <see cref="Label"/>, the
/// raw <see cref="Status"/> token, the semantic <see cref="Kind"/> tone (driving both the dot colour and the
/// badge, web <c>statusVariant</c> ≡ <c>statusDotColor</c>), the <see cref="BadgeText"/> (web <c>'OK'</c> for a
/// healthy service, otherwise the raw status), and a Narrator name. Pure data — no WinUI types — so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record UptimeServiceRow(
    string Key,
    string Label,
    string Status,
    StatusKind Kind,
    string BadgeText,
    string AccessibilityName);

/// <summary>
/// The fully projected, render-ready view of the uptime monitor for one footprint — the native analogue of
/// everything the web component computes via <c>useMemo</c> before returning JSX: the overall badge
/// (web <c>statusVariant(overallStatus)</c> + <c>overallStatus === 'healthy' ? 'All OK' : overallStatus</c>),
/// the per-service rows, the healthy-count metric (web <c>healthyCount/services.length</c>), and the DB-size /
/// table-count footer values (each <c>?? '—'</c>), plus every localized label. Pure data so the projection is
/// unit-tested directly.
/// </summary>
public sealed record UptimeMonitorDisplay(
    bool HasData,
    bool IsCompact,
    bool IsTall,
    string OverallLabel,
    string OverallStatus,
    string OverallBadgeText,
    StatusKind OverallKind,
    IReadOnlyList<UptimeServiceRow> Services,
    int HealthyCount,
    int ServiceCount,
    string CompactCountText,
    string DatabaseSizeLabel,
    string DatabaseSizeValue,
    string TableCountLabel,
    string TableCountValue,
    string OverallAutomationName,
    string CompactAutomationName,
    string EmptyMessage);

/// <summary>
/// Pure projection from a parsed <see cref="SystemHealthSnapshot"/> to the display model — the native port of
/// the <c>services</c> / <c>overallStatus</c> / <c>healthyCount</c> <c>useMemo</c> work plus the
/// <c>statusVariant</c>, <c>StatusDot</c> and service-label helpers in
/// web/src/features/dashboard/widgets/UptimeMonitorWidget.tsx. Every label resolves through the i18n facade;
/// the four service keys and their default labels mirror the web's static <c>SERVICE_KEYS</c> map and its
/// computed <c>key.replace(/_/g, ' ').replace(/\b\w/g, …)</c> fallback.
/// </summary>
public static class UptimeMonitorProjection
{
    /// <summary>The wire status token for a healthy component (web success variant).</summary>
    public const string StatusHealthy = "healthy";

    /// <summary>The legacy wire status token treated as healthy (web success variant).</summary>
    public const string StatusOk = "ok";

    /// <summary>The wire status token for a degraded component (web warning variant).</summary>
    public const string StatusDegraded = "degraded";

    /// <summary>
    /// The static service keys the widget surfaces, in render order — the native mirror of the web
    /// <c>SERVICE_KEYS</c> array (<c>['database', 'mqtt', 'tesla_api', 'fleet_telemetry']</c>).
    /// </summary>
    public static IReadOnlyList<string> ServiceKeys { get; } =
        new[] { "database", "mqtt", "tesla_api", "fleet_telemetry" };

    /// <summary>
    /// Map a status token to its semantic tone (web <c>statusVariant</c> ≡ <c>StatusDot</c> colour):
    /// <c>ok</c>/<c>healthy</c> → success (green), <c>degraded</c> → warning (amber), everything else
    /// (including <c>unknown</c> / <c>unhealthy</c>) → danger (red).
    /// </summary>
    public static StatusKind StatusKindFor(string? status) => status switch
    {
        StatusOk or StatusHealthy => StatusKind.Success,
        StatusDegraded => StatusKind.Warning,
        _ => StatusKind.Danger,
    };

    /// <summary>True when <paramref name="status"/> is one of the healthy tokens (web <c>'ok' || 'healthy'</c>).</summary>
    public static bool IsHealthy(string? status) =>
        string.Equals(status, StatusOk, StringComparison.Ordinal) ||
        string.Equals(status, StatusHealthy, StringComparison.Ordinal);

    /// <summary>
    /// The default service label computed from the key — the faithful C# port of the web's
    /// <c>key.replace(/_/g, ' ').replace(/\b\w/g, (c) =&gt; c.toUpperCase())</c>: underscores become spaces and
    /// the first letter of each word is upper-cased (e.g. <c>tesla_api</c> → <c>Tesla Api</c>).
    /// </summary>
    public static string TitleCaseFromKey(string key)
    {
        ArgumentNullException.ThrowIfNull(key);
        var chars = key.Replace('_', ' ').ToCharArray();
        bool atWordStart = true;
        for (int i = 0; i < chars.Length; i++)
        {
            if (char.IsWhiteSpace(chars[i]))
            {
                atWordStart = true;
            }
            else
            {
                if (atWordStart)
                {
                    chars[i] = char.ToUpperInvariant(chars[i]);
                }

                atWordStart = false;
            }
        }

        return new string(chars);
    }

    /// <summary>Resolve the localized label for a service key (web <c>t(`widget.uptime.${key}`, default)</c>).</summary>
    public static string ServiceLabel(string key, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(key);
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            string.Concat("widget.uptime.", key),
            TitleCaseFromKey(key));
    }

    /// <summary>Project <paramref name="snapshot"/> for <paramref name="size"/> using the i18n facade.</summary>
    public static UptimeMonitorDisplay Project(
        SystemHealthSnapshot snapshot,
        UptimeMonitorSize size,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        string overallLabel = localizer.GetString("widget.uptime.overall", "Overall");
        string dbSizeLabel = localizer.GetString("widget.uptime.dbSize", "DB Size");
        string tablesLabel = localizer.GetString("widget.uptime.tables", "Tables");
        string emptyMessage = localizer.GetString("widget.uptime.noData", "No system health data");

        var services = BuildServices(snapshot, localizer);
        int healthyCount = 0;
        for (int i = 0; i < services.Count; i++)
        {
            if (IsHealthy(services[i].Status))
            {
                healthyCount++;
            }
        }

        string overall = snapshot.HasData ? snapshot.OverallStatus : SystemHealthSnapshot.UnknownStatus;
        string overallBadgeText = string.Equals(overall, StatusHealthy, StringComparison.Ordinal)
            ? localizer.GetString("widget.uptime.allOk", "All OK")
            : overall;

        string compactCount = string.Create(CultureInfo.InvariantCulture, $"{healthyCount}/{services.Count}");

        string dbSizeValue = string.IsNullOrEmpty(snapshot.DatabaseSize)
            ? DateTimeFormatting.DefaultEmptyDisplay
            : snapshot.DatabaseSize!;
        string tableCountValue = snapshot.TableCount is { } tc
            ? tc.ToString(CultureInfo.InvariantCulture)
            : DateTimeFormatting.DefaultEmptyDisplay;

        string overallAutomation = string.Format(
            CultureInfo.CurrentCulture, "{0}: {1}", overallLabel, overallBadgeText);
        string compactAutomation = string.Format(
            CultureInfo.CurrentCulture, "{0} / {1}", healthyCount, services.Count);

        return new UptimeMonitorDisplay(
            HasData: snapshot.HasData,
            IsCompact: size.IsCompact,
            IsTall: size.IsTall,
            OverallLabel: overallLabel,
            OverallStatus: overall,
            OverallBadgeText: overallBadgeText,
            OverallKind: StatusKindFor(overall),
            Services: services,
            HealthyCount: healthyCount,
            ServiceCount: services.Count,
            CompactCountText: compactCount,
            DatabaseSizeLabel: dbSizeLabel,
            DatabaseSizeValue: dbSizeValue,
            TableCountLabel: tablesLabel,
            TableCountValue: tableCountValue,
            OverallAutomationName: overallAutomation,
            CompactAutomationName: compactAutomation,
            EmptyMessage: emptyMessage);
    }

    private static List<UptimeServiceRow> BuildServices(SystemHealthSnapshot snapshot, ILocalizer localizer)
    {
        var rows = new List<UptimeServiceRow>(ServiceKeys.Count);
        foreach (var key in ServiceKeys)
        {
            var component = snapshot.Component(key);
            string status = component?.Status ?? SystemHealthSnapshot.UnhealthyStatus;
            string label = ServiceLabel(key, localizer);
            string badgeText = IsHealthy(status)
                ? localizer.GetString("widget.uptime.ok", "OK")
                : status;
            string accessibility = string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, badgeText);
            rows.Add(new UptimeServiceRow(key, label, status, StatusKindFor(status), badgeText, accessibility));
        }

        return rows;
    }
}
