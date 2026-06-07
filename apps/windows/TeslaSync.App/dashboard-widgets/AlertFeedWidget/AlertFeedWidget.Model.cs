using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state an <see cref="AlertFeedViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web
/// <c>AlertFeedWidget</c> renders through <c>WidgetShell</c> + <c>WidgetEventFeed</c>
/// (web/src/features/dashboard/widgets/AlertFeedWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden.
/// </summary>
public enum AlertFeedState
{
    /// <summary>Initial fetch with no cached rows — render the skeleton chrome.</summary>
    Loading,

    /// <summary>Fresh rows from the network (or non-stale cache).</summary>
    Loaded,

    /// <summary>The request resolved with no alerts — render the friendly empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached rows exist — render the retry affordance.</summary>
    Error,

    /// <summary>Cached rows older than the freshness window — render rows plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but cached rows remain — render rows plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One alert row from <c>GET /alerts</c> (web <c>useAlerts</c>, shape <c>Alert</c> in
/// web/src/api/types.ts). Field names mirror the Go API's snake_case JSON tags; parsing is
/// null-tolerant so a partial row never throws. <see cref="CreatedAt"/> is kept as the raw
/// wire string (as the web does) and parsed on demand via <see cref="CreatedAtTime"/>.
/// </summary>
public sealed record AlertFeedAlert(
    long Id,
    long VehicleId,
    string Type,
    string Severity,
    string? Title,
    string? Message,
    bool IsRead,
    string? CreatedAt,
    long? RuleId,
    string? RuleSignal,
    string? RuleSeverity)
{
    /// <summary>The parsed creation instant, or <see langword="null"/> when absent/unparseable.</summary>
    public DateTimeOffset? CreatedAtTime => TryParseTimestamp(CreatedAt);

    /// <summary>Parse a <c>GET /alerts</c> JSON array into a tolerant list of rows.</summary>
    public static IReadOnlyList<AlertFeedAlert> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<AlertFeedAlert>();
        }

        var list = new List<AlertFeedAlert>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single alert JSON object into an <see cref="AlertFeedAlert"/>.</summary>
    public static AlertFeedAlert FromJson(JsonElement obj) => new(
        Id: GetLong(obj, "id") ?? 0,
        VehicleId: GetLong(obj, "vehicle_id") ?? 0,
        Type: GetString(obj, "type") ?? string.Empty,
        Severity: GetString(obj, "severity") ?? "info",
        Title: GetString(obj, "title"),
        Message: GetString(obj, "message"),
        IsRead: GetBool(obj, "is_read") ?? false,
        CreatedAt: GetString(obj, "created_at"),
        RuleId: GetLong(obj, "rule_id"),
        RuleSignal: GetString(obj, "rule_signal"),
        RuleSeverity: GetString(obj, "rule_severity"));

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static long? GetLong(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    private static bool? GetBool(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }

    private static DateTimeOffset? TryParseTimestamp(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind | DateTimeStyles.AssumeUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// A drill-through navigation target for an alert — the native port of
/// web/src/lib/alertDrillthrough.ts. Maps the alert's <c>rule_signal</c> onto the context page
/// (or the Signal Explorer fallback) and forwards the alert context (<c>vehicle_id</c>, <c>t</c>,
/// <c>signal</c>) as snake_case query parameters. The widget raises this as an event so the host
/// performs the actual navigation.
/// </summary>
public sealed record AlertFeedDrillthrough(string Path, IReadOnlyList<KeyValuePair<string, string>> Query)
{
    /// <summary>Generic fallback page when no signal-specific page is registered.</summary>
    public const string SignalExplorerFallback = "signal-explorer";

    /// <summary>
    /// Telemetry signal name → native route path pattern (no leading slash, matching
    /// <c>RouteTable</c>). A 1:1 port of <c>SIGNAL_TO_PAGE</c> in web/src/lib/alertDrillthrough.ts.
    /// </summary>
    private static readonly Dictionary<string, string> SignalToPage = new(StringComparer.Ordinal)
    {
        // Battery
        ["BatteryLevel"] = "battery",
        ["RatedRange"] = "battery",
        ["ChargeLimitSoc"] = "battery",
        ["EstBatteryRange"] = "battery",
        ["IdealBatteryRange"] = "battery",

        // Charging
        ["ChargeState"] = "charging",
        ["DetailedChargeState"] = "charging",
        ["DCChargingPower"] = "charging",
        ["ACChargingPower"] = "charging",
        ["ChargeAmps"] = "charging",
        ["ChargerVoltage"] = "charging",
        ["ChargerActualCurrent"] = "charging",
        ["ChargingCableType"] = "charging",

        // Driving
        ["Gear"] = "drives",
        ["VehicleSpeed"] = "drives",
        ["Power"] = "drives",
        ["Odometer"] = "drives",

        // Climate
        ["InsideTemp"] = "climate-control",
        ["OutsideTemp"] = "climate-control",
        ["HvacPower"] = "climate-control",
        ["ClimateKeeperMode"] = "climate-control",

        // Tire pressure
        ["TpmsPressureFl"] = "tire-pressure",
        ["TpmsPressureFr"] = "tire-pressure",
        ["TpmsPressureRl"] = "tire-pressure",
        ["TpmsPressureRr"] = "tire-pressure",
        ["TpmsHardWarnings"] = "tire-pressure",
        ["TpmsSoftWarnings"] = "tire-pressure",
        ["TpmsLastSeenPressureTimeFl"] = "tire-pressure",
        ["TpmsLastSeenPressureTimeFr"] = "tire-pressure",
        ["TpmsLastSeenPressureTimeRl"] = "tire-pressure",
        ["TpmsLastSeenPressureTimeRr"] = "tire-pressure",

        // Security / access
        ["Locked"] = "security-access",
        ["SentryMode"] = "security-access",
        ["DoorState"] = "security-access",
        ["WindowState"] = "security-access",
        ["SunroofInstalled"] = "security-access",

        // Software
        ["SoftwareUpdateVersion"] = "software-updates",
        ["SoftwareUpdateDownloadPercentComplete"] = "software-updates",
        ["SoftwareUpdateInstallationPercentComplete"] = "software-updates",
        ["SoftwareUpdateExpectedDurationMinutes"] = "software-updates",

        // Location / navigation
        ["LocatedAtHome"] = "navigation",
        ["LocatedAtWork"] = "navigation",
        ["LocatedAtFavorite"] = "navigation",
        ["DestinationName"] = "navigation",
        ["DestinationLocation"] = "navigation",
    };

    /// <summary>Compute the drill-through target for <paramref name="alert"/>.</summary>
    public static AlertFeedDrillthrough For(AlertFeedAlert alert)
    {
        ArgumentNullException.ThrowIfNull(alert);

        string? signal = string.IsNullOrEmpty(alert.RuleSignal) ? null : alert.RuleSignal;
        long? vehicleId = alert.VehicleId > 0 ? alert.VehicleId : null;

        var query = new List<KeyValuePair<string, string>>(3);
        if (vehicleId is { } id)
        {
            query.Add(new KeyValuePair<string, string>("vehicle_id", id.ToString(CultureInfo.InvariantCulture)));
        }

        if (!string.IsNullOrEmpty(alert.CreatedAt))
        {
            query.Add(new KeyValuePair<string, string>("t", alert.CreatedAt));
        }

        if (signal is not null)
        {
            query.Add(new KeyValuePair<string, string>("signal", signal));
        }

        string path = signal is not null && SignalToPage.TryGetValue(signal, out var mapped)
            ? mapped
            : SignalExplorerFallback;

        return new AlertFeedDrillthrough(path, query);
    }

    /// <summary>The target as a single relative href ("path?k=v&amp;…"), mirroring the web helper.</summary>
    public string Href
    {
        get
        {
            if (Query.Count == 0)
            {
                return Path;
            }

            var parts = new string[Query.Count];
            for (int i = 0; i < Query.Count; i++)
            {
                parts[i] = $"{Uri.EscapeDataString(Query[i].Key)}={Uri.EscapeDataString(Query[i].Value)}";
            }

            return $"{Path}?{string.Join('&', parts)}";
        }
    }
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> and the
/// <c>isWide</c> / <c>isTall</c> / <c>maxItems</c> logic in
/// web/src/features/dashboard/widgets/AlertFeedWidget.tsx.
/// </summary>
public readonly record struct AlertFeedSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static AlertFeedSize Default => new(2, 4);

    /// <summary>True at three or more columns (web <c>isWide</c>): show messages as subtitles.</summary>
    public bool IsWide => Cols >= 3;

    /// <summary>True at two or more rows (web <c>isTall</c>).</summary>
    public bool IsTall => Rows >= 2;

    /// <summary>Maximum rows rendered: wide→12, tall→8, otherwise 5 (web parity).</summary>
    public int MaxItems => IsWide ? 12 : IsTall ? 8 : 5;
}

/// <summary>
/// One projected, display-ready alert row consumed by the WinUI view. Holds the resolved severity
/// presentation (glyph + token brush key), the localized title/subtitle, the relative time string,
/// the drill-through target, and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
public sealed record AlertFeedRow(
    long Id,
    SeverityLevel Severity,
    string Glyph,
    string AccentBrushKey,
    string Title,
    string? Subtitle,
    string RelativeTime,
    DateTimeOffset? Timestamp,
    AlertFeedDrillthrough Drillthrough,
    string AutomationName);

/// <summary>
/// Pure projection from raw alerts to display rows — the native port of the <c>useMemo</c> mapping
/// in web/src/features/dashboard/widgets/AlertFeedWidget.tsx plus <c>WidgetEventFeed</c>'s
/// newest-first sort and <c>maxItems</c> slice. <c>now</c> is injected so the relative-time tiers
/// are unit-tested deterministically.
/// </summary>
public static class AlertFeedProjection
{
    /// <summary>Project + sort (newest first) + cap <paramref name="alerts"/> to the footprint's row budget.</summary>
    public static IReadOnlyList<AlertFeedRow> Project(
        IReadOnlyList<AlertFeedAlert> alerts,
        AlertFeedSize size,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(alerts);
        ArgumentNullException.ThrowIfNull(localizer);

        var ordered = alerts
            .OrderByDescending(a => a.CreatedAtTime ?? DateTimeOffset.MinValue)
            .Take(size.MaxItems);

        var rows = new List<AlertFeedRow>(Math.Min(alerts.Count, size.MaxItems));
        foreach (var alert in ordered)
        {
            var level = SeverityLevels.Normalize(alert.Severity);
            var tokens = SeverityLevels.Tokens(level);
            string title = string.IsNullOrEmpty(alert.Title) ? "\u2014" : alert.Title!;
            string severityLabel = SeverityLabel(localizer, level);
            string? subtitle = size.IsWide ? alert.Message : severityLabel;
            string relative = DateTimeFormatting.Format(alert.CreatedAtTime, DateTimeVariant.Relative, now);

            rows.Add(new AlertFeedRow(
                Id: alert.Id,
                Severity: level,
                Glyph: tokens.IconGlyph,
                AccentBrushKey: tokens.AccentBrushKey,
                Title: title,
                Subtitle: subtitle,
                RelativeTime: relative,
                Timestamp: alert.CreatedAtTime,
                Drillthrough: AlertFeedDrillthrough.For(alert),
                AutomationName: AutomationName(severityLabel, title, relative)));
        }

        return rows;
    }

    /// <summary>Localized severity label (web <c>SEVERITY_LABELS</c>), routed through the i18n facade.</summary>
    public static string SeverityLabel(ILocalizer localizer, SeverityLevel level)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return level switch
        {
            SeverityLevel.Info => localizer.GetString("alerts.severity.info", "Info"),
            SeverityLevel.Warn => localizer.GetString("alerts.severity.warning", "Warning"),
            SeverityLevel.Critical => localizer.GetString("alerts.severity.critical", "Critical"),
            SeverityLevel.Success => localizer.GetString("alerts.severity.success", "Success"),
            _ => localizer.GetString("alerts.severity.info", "Info"),
        };
    }

    private static string AutomationName(string severityLabel, string title, string relativeTime) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1}, {2}", severityLabel, title, relativeTime);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;AlertFeedAlert&gt;&gt;</c>, preserving every freshness
/// flag (cached / refreshing / stale / offline) so the view-model can render the full state matrix.
/// Kept pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class AlertFeedResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<AlertFeedAlert>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<AlertFeedAlert> Parse() =>
            raw.HasValue ? AlertFeedAlert.ParseList(raw.Value) : Array.Empty<AlertFeedAlert>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<AlertFeedAlert>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<AlertFeedAlert>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<AlertFeedAlert>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => ToLoadedOrEmpty(Parse(), raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<AlertFeedAlert>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<AlertFeedAlert>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<AlertFeedAlert>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    private static RepositoryResult<IReadOnlyList<AlertFeedAlert>> ToLoadedOrEmpty(
        IReadOnlyList<AlertFeedAlert> parsed,
        DateTimeOffset? fetchedAt)
        => parsed.Count == 0
            ? RepositoryResult<IReadOnlyList<AlertFeedAlert>>.Empty(fetchedAt)
            : RepositoryResult<IReadOnlyList<AlertFeedAlert>>.Loaded(parsed, fetchedAt ?? DateTimeOffset.UtcNow);
}
