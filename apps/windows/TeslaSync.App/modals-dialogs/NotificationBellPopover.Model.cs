using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The mutually-exclusive lifecycle branch the <see cref="NotificationBellPopoverViewModel"/> can be in — the
/// native union of the states the web <c>NotificationBellPanel</c> renders inside its popover
/// (web/src/components/layout/NotificationBellPopover.tsx): the spinner while the preview read is in flight,
/// the retriable error surface, the friendly empty state, the unread-preview list, and — because the native
/// read layer is cache-then-network — the stale and offline affordances the web's TanStack-Query layer
/// expresses implicitly. Every branch maps onto a visible surface; none is ever hidden behind a
/// <c>{data &amp;&amp; …}</c> guard.
/// </summary>
public enum NotificationBellState
{
    /// <summary>Initial preview read with no cached snapshot — render the loading affordance.</summary>
    Loading,

    /// <summary>A read resolved (fresh or non-stale cache) with unread notifications to show.</summary>
    Loaded,

    /// <summary>A read resolved with no unread notifications — render the friendly empty state.</summary>
    Empty,

    /// <summary>The read failed and no cached snapshot exists — render the retry surface.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The severity tone a preview row carries — the native union of the web bell's
/// <c>SEVERITY_TONE</c> keys (<c>'info' | 'warn' | 'critical'</c>), derived from the originating alert rule.
/// </summary>
public enum BellSeverity
{
    /// <summary>Web <c>'info'</c> — the default when the rule is missing or carries an unknown severity.</summary>
    Info,

    /// <summary>Web <c>'warn'</c>.</summary>
    Warn,

    /// <summary>Web <c>'critical'</c>.</summary>
    Critical,
}

/// <summary>
/// Null-tolerant JSON readers shared by the bell-popover models. Each read prefers the Go API's snake_case
/// JSON tag and falls back to the camelCase shape the web <c>camelCaseKeys</c> transform produces, so a
/// contract shift never throws — exactly the dual-read the web hooks rely on. Self-contained so the surface
/// stays within its own files.
/// </summary>
internal static class BellJson
{
    /// <summary>Try the snake_case property, then the camelCase property, of an object element.</summary>
    public static bool TryProperty(JsonElement element, string snake, string camel, out JsonElement value)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            if (element.TryGetProperty(snake, out value))
            {
                return true;
            }

            if (!string.Equals(snake, camel, StringComparison.Ordinal) && element.TryGetProperty(camel, out value))
            {
                return true;
            }
        }

        value = default;
        return false;
    }

    /// <summary>Read a string property, or <see langword="null"/> when absent / not a string.</summary>
    public static string? String(JsonElement element, string snake, string camel) =>
        TryProperty(element, snake, camel, out JsonElement value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    /// <summary>Read an integer property (number or numeric string), or <see langword="null"/>.</summary>
    public static long? Long(JsonElement element, string snake, string camel)
    {
        if (!TryProperty(element, snake, camel, out JsonElement value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetInt64(out long n) => n,
            JsonValueKind.String when long.TryParse(
                value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out long n) => n,
            _ => null,
        };
    }

    /// <summary>Read an ISO-8601 timestamp property, or <see langword="null"/> when absent / unparseable.</summary>
    public static DateTimeOffset? Date(JsonElement element, string snake, string camel)
    {
        string? raw = String(element, snake, camel);
        if (string.IsNullOrEmpty(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out DateTimeOffset dt)
            ? dt
            : null;
    }

    /// <summary>Enumerate an array element, or an empty sequence when it is not an array.</summary>
    public static IReadOnlyList<JsonElement> Array(JsonElement element) =>
        element.ValueKind == JsonValueKind.Array
            ? element.EnumerateArray().ToList()
            : System.Array.Empty<JsonElement>();
}

/// <summary>
/// One unread notification-log delivery — the native analogue of the web <c>NotificationLog</c>
/// (web/src/api/types.ts), narrowed to the fields the bell-popover preview row reads. Pure data — no WinUI
/// types — so the model is exercised headlessly.
/// </summary>
/// <param name="Id">Stable row id (web <c>id</c>); the row key.</param>
/// <param name="AlertId">The originating alert id (web <c>alert_id</c>), or <see langword="null"/>.</param>
/// <param name="Title">The notification title (web <c>title</c>).</param>
/// <param name="Message">The notification body (web <c>message</c>).</param>
/// <param name="CreatedAt">When it was created (web <c>created_at</c>); drives the relative timestamp.</param>
public sealed record BellNotification(
    long Id,
    long? AlertId,
    string Title,
    string Message,
    DateTimeOffset? CreatedAt)
{
    /// <summary>Parse one notification object, tolerating an absent / partial / schema-drifted body.</summary>
    /// <param name="element">The JSON object element for a single notification log.</param>
    public static BellNotification? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        long? id = BellJson.Long(element, "id", "id");
        if (id is null)
        {
            return null;
        }

        return new BellNotification(
            Id: id.Value,
            AlertId: BellJson.Long(element, "alert_id", "alertId"),
            Title: BellJson.String(element, "title", "title") ?? string.Empty,
            Message: BellJson.String(element, "message", "message") ?? string.Empty,
            CreatedAt: BellJson.Date(element, "created_at", "createdAt"));
    }

    /// <summary>Parse a notification-log array, skipping any malformed element.</summary>
    /// <param name="element">The JSON array element returned by <c>GET /notifications/logs</c>.</param>
    public static IReadOnlyList<BellNotification> FromJsonArray(JsonElement element)
    {
        var list = new List<BellNotification>();
        foreach (JsonElement item in BellJson.Array(element))
        {
            if (FromJson(item) is { } note)
            {
                list.Add(note);
            }
        }

        return list;
    }
}

/// <summary>
/// One alert-rule lookup — the native analogue of the web <c>AlertRule</c> (web/src/api/types.ts), narrowed to
/// the fields the bell row joins on: <see cref="Severity"/> (the row's severity tone) and <see cref="VehicleId"/>
/// (the vehicle the rule is scoped to). Pure data.
/// </summary>
/// <param name="Id">The rule id (web <c>id</c>); the join key from <see cref="BellNotification.AlertId"/>.</param>
/// <param name="Name">The rule name (web <c>name</c>), the row's title fallback.</param>
/// <param name="Severity">The raw severity string (web <c>severity</c>), or <see langword="null"/>.</param>
/// <param name="VehicleId">The scoped vehicle id (web <c>vehicle_id</c>), or <see langword="null"/>.</param>
public sealed record BellAlertRule(long Id, string? Name, string? Severity, long? VehicleId)
{
    /// <summary>Parse one rule object, tolerating an absent / partial / schema-drifted body.</summary>
    /// <param name="element">The JSON object element for a single alert rule.</param>
    public static BellAlertRule? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        long? id = BellJson.Long(element, "id", "id");
        if (id is null)
        {
            return null;
        }

        return new BellAlertRule(
            Id: id.Value,
            Name: BellJson.String(element, "name", "name"),
            Severity: BellJson.String(element, "severity", "severity"),
            VehicleId: BellJson.Long(element, "vehicle_id", "vehicleId"));
    }

    /// <summary>Build the id-keyed lookup from the rules array (web <c>ruleMap</c>).</summary>
    /// <param name="element">The JSON array element returned by <c>GET /alerts/rules</c>.</param>
    public static IReadOnlyDictionary<long, BellAlertRule> MapFromJson(JsonElement element)
    {
        var map = new Dictionary<long, BellAlertRule>();
        foreach (JsonElement item in BellJson.Array(element))
        {
            if (FromJson(item) is { } rule)
            {
                map[rule.Id] = rule;
            }
        }

        return map;
    }
}

/// <summary>
/// One vehicle lookup — the native analogue of the web <c>Vehicle</c> (web/src/types/vehicle.ts), narrowed to
/// the <see cref="DisplayName"/> the bell row shows. Pure data.
/// </summary>
/// <param name="Id">The vehicle id (web <c>id</c>); the join key from <see cref="BellAlertRule.VehicleId"/>.</param>
/// <param name="DisplayName">The display name (web <c>display_name</c>), or <see langword="null"/>.</param>
public sealed record BellVehicle(long Id, string? DisplayName)
{
    /// <summary>Parse one vehicle object, tolerating an absent / partial / schema-drifted body.</summary>
    /// <param name="element">The JSON object element for a single vehicle.</param>
    public static BellVehicle? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        long? id = BellJson.Long(element, "id", "id");
        if (id is null)
        {
            return null;
        }

        return new BellVehicle(
            Id: id.Value,
            DisplayName: BellJson.String(element, "display_name", "displayName"));
    }

    /// <summary>Build the id-keyed lookup from the vehicles array (web <c>vehicleMap</c>).</summary>
    /// <param name="element">The JSON array element returned by <c>GET /vehicles</c>.</param>
    public static IReadOnlyDictionary<long, BellVehicle> MapFromJson(JsonElement element)
    {
        var map = new Dictionary<long, BellVehicle>();
        foreach (JsonElement item in BellJson.Array(element))
        {
            if (FromJson(item) is { } vehicle)
            {
                map[vehicle.Id] = vehicle;
            }
        }

        return map;
    }
}

/// <summary>
/// One cache-then-network reading of the bell preview — the latest unread notifications plus the alert-rule
/// and vehicle lookups they join against. The native analogue of the web panel's three-query composition
/// (<c>useUnreadNotifications</c> + <c>useAlertRules</c> + <c>useVehicles</c>) that
/// <see cref="NotificationBellProjection.BuildRows"/> folds into preview rows. Pure data.
/// </summary>
/// <param name="Notifications">The latest unread, non-archived notifications (web <c>logs</c>).</param>
/// <param name="Rules">The id-keyed alert-rule lookup (web <c>ruleMap</c>).</param>
/// <param name="Vehicles">The id-keyed vehicle lookup (web <c>vehicleMap</c>).</param>
public sealed record NotificationBellPreview(
    IReadOnlyList<BellNotification> Notifications,
    IReadOnlyDictionary<long, BellAlertRule> Rules,
    IReadOnlyDictionary<long, BellVehicle> Vehicles)
{
    /// <summary>An empty preview — no notifications and no lookups.</summary>
    public static NotificationBellPreview Empty { get; } = new(
        System.Array.Empty<BellNotification>(),
        new Dictionary<long, BellAlertRule>(),
        new Dictionary<long, BellVehicle>());
}

/// <summary>
/// One projected bell-popover preview row — the native analogue of the web panel's per-row render
/// (severity dot, title, message, relative time, vehicle name). Every string is display-ready and localized.
/// Pure data.
/// </summary>
/// <param name="Id">The notification id (the row key + navigation context).</param>
/// <param name="Title">The resolved title (web <c>log.title || rule?.name || t('untitled')</c>).</param>
/// <param name="Message">The notification body, or <see langword="null"/> when blank (web shows it only if set).</param>
/// <param name="RelativeTime">The localized relative timestamp (web <c>formatRelative(created_at)</c>).</param>
/// <param name="Severity">The row's severity tone (web <c>severityOf(rule)</c>).</param>
/// <param name="SeverityLabel">The localized severity label announced on the dot (web <c>tone.label</c>).</param>
/// <param name="VehicleName">The scoped vehicle's display name, or <see langword="null"/> when none.</param>
/// <param name="AccessibleName">The composed Narrator name for the row button.</param>
public sealed record BellRow(
    long Id,
    string Title,
    string? Message,
    string RelativeTime,
    BellSeverity Severity,
    string SeverityLabel,
    string? VehicleName,
    string AccessibleName);

/// <summary>
/// The localized chrome strings the bell popover renders, resolved once through the i18n facade (P1/S10). The
/// keys mirror the web component's <c>t(...)</c> calls verbatim so a key present in the web catalog is present
/// here; the English fallbacks mirror the web defaults so the surface still renders if a key is absent (the
/// same graceful-fallback contract the web <c>t(key, default)</c> uses).
/// </summary>
/// <param name="Title">Header title (web <c>notifications.bellPopover.title</c>).</param>
/// <param name="Close">Close button label (web <c>common.close</c>).</param>
/// <param name="Loading">Loading text (web <c>notifications.bellPopover.loading</c>).</param>
/// <param name="ErrorText">Error text (web <c>notifications.bellPopover.error</c>).</param>
/// <param name="EmptyTitle">Empty-state title (web <c>notifications.bellPopover.emptyTitle</c>).</param>
/// <param name="EmptyMessage">Empty-state message (web <c>notifications.bellPopover.emptyMessage</c>).</param>
/// <param name="Untitled">Row title fallback (web <c>notifications.bellPopover.untitled</c>).</param>
/// <param name="MarkAllRead">Mark-all-read label (web <c>notifications.bellPopover.markAllRead</c>).</param>
/// <param name="ViewAll">View-all label (web <c>notifications.bellPopover.viewAll</c>).</param>
/// <param name="SeverityInfo">Info severity label (web <c>SEVERITY_TONE.info.label</c>).</param>
/// <param name="SeverityWarning">Warning severity label (web <c>SEVERITY_TONE.warn.label</c>).</param>
/// <param name="SeverityCritical">Critical severity label (web <c>SEVERITY_TONE.critical.label</c>).</param>
public sealed record NotificationBellLabels(
    string Title,
    string Close,
    string Loading,
    string ErrorText,
    string EmptyTitle,
    string EmptyMessage,
    string Untitled,
    string MarkAllRead,
    string ViewAll,
    string SeverityInfo,
    string SeverityWarning,
    string SeverityCritical)
{
    /// <summary>Resolve every chrome string through the i18n facade.</summary>
    /// <param name="localizer">The i18n facade resolving each key.</param>
    public static NotificationBellLabels Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new NotificationBellLabels(
            Title: localizer.GetString("notifications.bellPopover.title", "Notifications"),
            Close: localizer.GetString("common.close", "Close"),
            Loading: localizer.GetString("notifications.bellPopover.loading", "Loading\u2026"),
            ErrorText: localizer.GetString("notifications.bellPopover.error", "Could not load notifications"),
            EmptyTitle: localizer.GetString("notifications.bellPopover.emptyTitle", "You're all caught up"),
            EmptyMessage: localizer.GetString(
                "notifications.bellPopover.emptyMessage", "No unread notifications right now."),
            Untitled: localizer.GetString("notifications.bellPopover.untitled", "Notification"),
            MarkAllRead: localizer.GetString("notifications.bellPopover.markAllRead", "Mark all read"),
            ViewAll: localizer.GetString("notifications.bellPopover.viewAll", "View all"),
            SeverityInfo: localizer.GetString("notifications.severity.info", "Info"),
            SeverityWarning: localizer.GetString("notifications.severity.warning", "Warning"),
            SeverityCritical: localizer.GetString("notifications.severity.critical", "Critical"));
    }

    /// <summary>The localized label for a severity tone (web <c>SEVERITY_TONE[sev].label</c>).</summary>
    /// <param name="severity">The severity tone.</param>
    public string SeverityLabel(BellSeverity severity) => severity switch
    {
        BellSeverity.Warn => SeverityWarning,
        BellSeverity.Critical => SeverityCritical,
        _ => SeverityInfo,
    };
}

/// <summary>
/// The immutable display state the bell popover binds to — the projection of the current
/// <see cref="NotificationBellState"/>, the unread badge count and the cache-then-network preview. Every field
/// is render-ready. Pure data.
/// </summary>
/// <param name="State">Which lifecycle branch is active.</param>
/// <param name="Subtitle">The header subtitle (web "{{count}} unread" / "All caught up").</param>
/// <param name="Rows">The projected preview rows (empty unless content is present).</param>
/// <param name="HasRows">True when at least one preview row is present.</param>
/// <param name="MarkAllReadEnabled">True when the mark-all-read action is enabled (rows present, not pending).</param>
/// <param name="PanelAutomationName">The composed Narrator name for the dialog surface.</param>
public sealed record NotificationBellDisplay(
    NotificationBellState State,
    string Subtitle,
    IReadOnlyList<BellRow> Rows,
    bool HasRows,
    bool MarkAllReadEnabled,
    string PanelAutomationName);

/// <summary>
/// Projects the bell-popover state, unread count and cache-then-network preview into the render-ready
/// <see cref="NotificationBellDisplay"/> — the native port of the web <c>NotificationBellPanel</c>'s render
/// logic (severity classification, title fallback, vehicle join, relative-time formatting, the count-driven
/// header subtitle and trigger label). UI-free so every branch is unit-tested.
/// </summary>
public static class NotificationBellProjection
{
    /// <summary>Project the current state into the render-ready display.</summary>
    /// <param name="state">The active lifecycle branch.</param>
    /// <param name="preview">The latest preview reading, or <see langword="null"/> when none is shown.</param>
    /// <param name="unreadCount">The unread badge count driving the header subtitle.</param>
    /// <param name="markAllReadPending">Whether the mark-all-read mutation is in flight.</param>
    /// <param name="labels">The resolved chrome labels.</param>
    /// <param name="localizer">The i18n facade (for the count-interpolated subtitle).</param>
    /// <param name="now">The reference time for relative-timestamp formatting.</param>
    public static NotificationBellDisplay Project(
        NotificationBellState state,
        NotificationBellPreview? preview,
        int unreadCount,
        bool markAllReadPending,
        NotificationBellLabels labels,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(labels);
        ArgumentNullException.ThrowIfNull(localizer);

        IReadOnlyList<BellRow> rows = preview is null
            ? System.Array.Empty<BellRow>()
            : BuildRows(preview, labels, now);
        bool hasRows = rows.Count > 0;
        string subtitle = Subtitle(unreadCount, localizer);
        string panelName = string.Create(CultureInfo.CurrentCulture, $"{labels.Title}. {subtitle}");

        return new NotificationBellDisplay(
            State: state,
            Subtitle: subtitle,
            Rows: rows,
            HasRows: hasRows,
            MarkAllReadEnabled: hasRows && !markAllReadPending,
            PanelAutomationName: panelName);
    }

    /// <summary>Fold the preview into projected rows (web <c>logs.map(...)</c> with the rule + vehicle join).</summary>
    /// <param name="preview">The preview reading.</param>
    /// <param name="labels">The resolved chrome labels.</param>
    /// <param name="now">The reference time for relative-timestamp formatting.</param>
    public static IReadOnlyList<BellRow> BuildRows(
        NotificationBellPreview preview,
        NotificationBellLabels labels,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(preview);
        ArgumentNullException.ThrowIfNull(labels);

        var rows = new List<BellRow>(preview.Notifications.Count);
        foreach (BellNotification log in preview.Notifications)
        {
            BellAlertRule? rule = log.AlertId is { } alertId && preview.Rules.TryGetValue(alertId, out BellAlertRule? r)
                ? r
                : null;
            BellVehicle? vehicle = rule?.VehicleId is { } vehicleId && preview.Vehicles.TryGetValue(vehicleId, out BellVehicle? v)
                ? v
                : null;

            BellSeverity severity = SeverityOf(rule);
            string title = FirstNonEmpty(log.Title, rule?.Name) ?? labels.Untitled;
            string? message = string.IsNullOrEmpty(log.Message) ? null : log.Message;
            string? vehicleName = VehicleName(vehicle);
            string time = DateTimeFormatting.Format(log.CreatedAt, DateTimeVariant.Relative, now);
            string severityLabel = labels.SeverityLabel(severity);

            rows.Add(new BellRow(
                Id: log.Id,
                Title: title,
                Message: message,
                RelativeTime: time,
                Severity: severity,
                SeverityLabel: severityLabel,
                VehicleName: vehicleName,
                AccessibleName: AccessibleName(severityLabel, title, time, vehicleName)));
        }

        return rows;
    }

    /// <summary>Classify a rule's severity (web <c>severityOf</c>): warn / critical pass through, else info.</summary>
    /// <param name="rule">The originating rule, or <see langword="null"/>.</param>
    public static BellSeverity SeverityOf(BellAlertRule? rule) => rule?.Severity switch
    {
        "warn" => BellSeverity.Warn,
        "critical" => BellSeverity.Critical,
        _ => BellSeverity.Info,
    };

    /// <summary>The header subtitle (web "{{count}} unread" when unread, else "All caught up").</summary>
    /// <param name="count">The unread badge count.</param>
    /// <param name="localizer">The i18n facade.</param>
    public static string Subtitle(int count, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return count > 0
            ? Interpolate(localizer.GetString("notifications.bellPopover.unreadCount", "{{count}} unread"), count)
            : localizer.GetString("notifications.bellPopover.allRead", "All caught up");
    }

    /// <summary>The trigger button's accessible label (web "{{count}} unread notifications" / "Notifications").</summary>
    /// <param name="count">The unread badge count.</param>
    /// <param name="localizer">The i18n facade.</param>
    public static string TriggerLabel(int count, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return count > 0
            ? Interpolate(
                localizer.GetString("nav.notificationsUnread", "{{count}} unread notifications"), count)
            : localizer.GetString("nav.notifications", "Notifications");
    }

    /// <summary>The badge text — the count, capped at "99+" (web <c>count &gt; 99 ? '99+' : count</c>).</summary>
    /// <param name="count">The unread badge count.</param>
    public static string BadgeText(int count) =>
        count > 99 ? "99+" : NumberFormatting.Format(count, null, 0);

    private static string? VehicleName(BellVehicle? vehicle)
    {
        if (vehicle is null)
        {
            return null;
        }

        return string.IsNullOrEmpty(vehicle.DisplayName)
            ? string.Create(CultureInfo.InvariantCulture, $"#{vehicle.Id}")
            : vehicle.DisplayName;
    }

    private static string AccessibleName(string severityLabel, string title, string time, string? vehicleName)
    {
        string head = string.Create(CultureInfo.CurrentCulture, $"{severityLabel}: {title}. {time}");
        return vehicleName is null
            ? head
            : string.Create(CultureInfo.CurrentCulture, $"{head}, {vehicleName}");
    }

    private static string? FirstNonEmpty(string? primary, string? secondary)
    {
        if (!string.IsNullOrEmpty(primary))
        {
            return primary;
        }

        return string.IsNullOrEmpty(secondary) ? null : secondary;
    }

    private static string Interpolate(string template, int count) => template.Replace(
        "{{count}}",
        NumberFormatting.Format(count, null, 0),
        StringComparison.Ordinal);
}

/// <summary>
/// PII-safe diagnostics for the <c>NotificationBellPopover</c> surface (P1/S11 diagnostics contract). Records
/// only the operational <c>view.opened</c> event with the surface slug — never a notification title, message
/// body, recipient or count — so a diagnostics line can never leak what a user's notifications were about.
/// Thread-safe.
/// </summary>
public sealed class NotificationBellDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The diagnostics sink, or <see langword="null"/> to only count.</param>
    public NotificationBellDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=NotificationBellPopover</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={NotificationBellRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>NotificationBellPopover</c> surface — the native mirror of the web component
/// at <c>web/src/components/layout/NotificationBellPopover.tsx</c>: the diagnostics slug, the generated
/// operation ids the data layer consumes, the canonical inbox route, the Segoe Fluent Icons glyphs that stand
/// in for the web Lucide icons (Bell, X, AlertTriangle, CheckCheck, ChevronRight), and the severity-tone
/// mapping. UI-free so the metadata is asserted in tests.
/// </summary>
public static class NotificationBellRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "NotificationBellPopover";

    /// <summary>Operation id for the unread-count badge read (web <c>useUnreadCount</c>).</summary>
    public const string UnreadCountOperation = "get_api_v1_notifications_unread_count";

    /// <summary>Operation id for the unread-preview read (web <c>useUnreadNotifications</c>).</summary>
    public const string LogsOperation = "get_api_v1_notifications_logs";

    /// <summary>Operation id for the alert-rule lookup read (web <c>useAlertRules</c>).</summary>
    public const string AlertRulesOperation = "get_api_v1_alerts_rules";

    /// <summary>Operation id for the vehicle lookup read (web <c>useVehicles</c>).</summary>
    public const string VehiclesOperation = "get_api_v1_vehicles";

    /// <summary>Operation id for the mark-all-read mutation (web <c>useBulkMarkRead({ all: true })</c>).</summary>
    public const string MarkReadOperation = "post_api_v1_notifications_mark_read";

    /// <summary>Canonical inbox route the bell navigates to (web <c>/notifications/inbox</c>).</summary>
    public const string InboxRoute = "/notifications/inbox";

    /// <summary>The number of preview rows requested (web <c>PREVIEW_LIMIT</c>).</summary>
    public const int PreviewLimit = 10;

    /// <summary>Segoe Fluent "Ringer" glyph — the trigger + empty-state bell (web <c>Bell</c>).</summary>
    public const string BellGlyph = "\uEA8F";

    /// <summary>Segoe Fluent "ChromeClose" glyph — the header close button (web <c>X</c>).</summary>
    public const string CloseGlyph = "\uE8BB";

    /// <summary>Segoe Fluent "Warning" glyph — the error surface (web <c>AlertTriangle</c>).</summary>
    public const string WarningGlyph = "\uE7BA";

    /// <summary>Segoe Fluent "CheckList" glyph — mark all read (web <c>CheckCheck</c>).</summary>
    public const string MarkAllReadGlyph = "\uE9D5";

    /// <summary>Segoe Fluent "ChevronRight" glyph — view all (web <c>ChevronRight</c>).</summary>
    public const string ViewAllGlyph = "\uE76C";

    /// <summary>The semantic status a severity tone maps onto (drives the row dot brush).</summary>
    /// <param name="severity">The severity tone.</param>
    public static StatusKind StatusFor(BellSeverity severity) => severity switch
    {
        BellSeverity.Warn => StatusKind.Warning,
        BellSeverity.Critical => StatusKind.Danger,
        _ => StatusKind.Info,
    };

    /// <summary>The theme-aware accent brush resource key for a severity tone.</summary>
    /// <param name="severity">The severity tone.</param>
    public static string SeverityBrushKey(BellSeverity severity) =>
        StatusResources.AccentBrushKey(StatusFor(severity));
}
