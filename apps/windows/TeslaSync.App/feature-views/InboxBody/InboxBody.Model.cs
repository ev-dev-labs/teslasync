using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle branch a <see cref="InboxBodyViewModel"/> can be in — the native union of
/// the states the web <c>InboxBody</c> renders inside its <c>GlassPanel</c>
/// (web/src/features/notifications/components/InboxBody.tsx): the skeleton while a read is in flight, the
/// retriable <c>EmptyState</c> error surface, the friendly empty state, the day-grouped flat list / threaded
/// grouped list content, and — because the native read layer is cache-then-network — the stale and offline
/// chips the web's TanStack-Query layer expresses implicitly. Every branch maps onto a visible surface; none
/// is ever hidden behind a <c>{data &amp;&amp; …}</c> guard.
/// </summary>
public enum InboxBodyState
{
    /// <summary>Initial read with no cached snapshot — render the skeleton rows.</summary>
    Loading,

    /// <summary>A read resolved (fresh or non-stale cache) with notifications to show.</summary>
    Loaded,

    /// <summary>A read resolved with no notifications — render the friendly empty state.</summary>
    Empty,

    /// <summary>The read failed and no cached snapshot exists — render the retry surface.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// Inbox view mode — the native union of the web <c>VIEW_VALUES = ['grouped', 'flat']</c> URL-backed toggle.
/// Grouped is the default (power users with many rules drown in flat duplicates); flat is the historical
/// per-delivery list. Grouping only applies on the inbox tab — the archive workflow is always row-by-row.
/// </summary>
public enum InboxView
{
    /// <summary>Threaded view (web <c>'grouped'</c>) — one row per alert-rule + severity thread.</summary>
    Grouped,

    /// <summary>Flat view (web <c>'flat'</c>) — one row per individual delivery, bucketed by day.</summary>
    Flat,
}

/// <summary>
/// The severity values the inbox filter exposes — the native union of the web
/// <c>SEVERITY_VALUES = ['info', 'warn', 'critical']</c> filter options.
/// </summary>
public enum InboxSeverity
{
    /// <summary>Web <c>'info'</c>.</summary>
    Info,

    /// <summary>Web <c>'warn'</c>.</summary>
    Warn,

    /// <summary>Web <c>'critical'</c>.</summary>
    Critical,
}

/// <summary>
/// The read-state filter — the native union of the web <c>READ_VALUES = ['all', 'read', 'unread']</c>
/// URL-backed filter. <see cref="All"/> sends no <c>read</c> param; the others map to <c>read=true|false</c>.
/// </summary>
public enum InboxReadFilter
{
    /// <summary>Web <c>'all'</c> — no read filter applied.</summary>
    All,

    /// <summary>Web <c>'read'</c> — only read notifications.</summary>
    Read,

    /// <summary>Web <c>'unread'</c> — only unread notifications.</summary>
    Unread,
}

/// <summary>
/// The semantic colour class of a notification severity — the native analogue of how the web row + badge key
/// their accent off the severity string. Unknown / blank severities fall into <see cref="None"/> (a neutral
/// chip), mirroring the web's graceful handling of ad-hoc notifications with no severity. UI-free so the
/// classification is unit-tested without a XAML runtime.
/// </summary>
public enum InboxSeverityClass
{
    /// <summary>Web <c>'critical'</c> — danger accent.</summary>
    Critical,

    /// <summary>Web <c>'warning'</c> / <c>'warn'</c> — warning accent.</summary>
    Warning,

    /// <summary>Web <c>'info'</c> — info accent.</summary>
    Info,

    /// <summary>Any other / blank severity — a neutral chip (no semantic accent).</summary>
    None,
}

/// <summary>
/// A per-row context-menu command — the native union of the actions the web row context menu offers
/// (<c>buildRowContextMenu</c>): mark read / unread, archive / restore, view drill-through context, delete.
/// </summary>
public enum InboxRowAction
{
    /// <summary>Web <c>row.markRead</c> — mark this notification read.</summary>
    MarkRead,

    /// <summary>Web <c>row.markUnread</c> — mark this notification unread.</summary>
    MarkUnread,

    /// <summary>Web <c>row.archive</c> — archive this notification.</summary>
    Archive,

    /// <summary>Web <c>row.unarchive</c> — restore this archived notification.</summary>
    Restore,

    /// <summary>Web <c>alerts.viewContext</c> — navigate to the alert drill-through context.</summary>
    ViewContext,

    /// <summary>Web <c>common.delete</c> — permanently delete this notification.</summary>
    Delete,
}

/// <summary>
/// A bulk-selection toolbar command — the native union of the actions the web <c>BulkActionsToolbar</c>
/// offers for the current tab (mark read + archive on the inbox; restore on the archive; delete on both).
/// </summary>
public enum InboxBulkAction
{
    /// <summary>Web <c>inbox.bulk.markRead</c> — mark the selection read (inbox only).</summary>
    MarkRead,

    /// <summary>Web <c>inbox.bulk.archive</c> — archive the selection (inbox only).</summary>
    Archive,

    /// <summary>Web <c>inbox.bulk.restore</c> — restore the selection (archive only).</summary>
    Restore,

    /// <summary>Web <c>bulk.actions.delete</c> — permanently delete the selection (both tabs).</summary>
    Delete,
}

/// <summary>
/// One notification-log delivery — the native analogue of the web <c>NotificationLog</c>
/// (web/src/api/types.ts), narrowed to the fields the inbox row + grouping + selection logic read. Field
/// names mirror the Go API's snake_case JSON tags; <see cref="FromJson"/> reads snake_case first and falls
/// back to camelCase (the <c>camelCaseKeys</c> transform shape) so a contract shift never throws. Pure data —
/// no WinUI types.
/// </summary>
/// <param name="Id">Stable row id (web <c>id</c>); the selection key and the mutation target.</param>
/// <param name="AlertId">The originating alert id, or <see langword="null"/> for ad-hoc notifications.</param>
/// <param name="Title">The notification title (web <c>title</c>).</param>
/// <param name="Message">The notification body (web <c>message</c>).</param>
/// <param name="Severity">The raw severity string (web <c>severity</c>), or <see langword="null"/>.</param>
/// <param name="CreatedAt">When the notification was created (web <c>created_at</c>); drives day grouping.</param>
/// <param name="ReadAt">When it was read (web <c>read_at</c>), or <see langword="null"/> when unread.</param>
/// <param name="ArchivedAt">When it was archived (web <c>archived_at</c>), or <see langword="null"/>.</param>
public sealed record InboxNotification(
    long Id,
    long? AlertId,
    string Title,
    string Message,
    string? Severity,
    DateTimeOffset? CreatedAt,
    DateTimeOffset? ReadAt,
    DateTimeOffset? ArchivedAt)
{
    /// <summary>True when the notification has been read (web <c>!!log.read_at</c>).</summary>
    public bool IsRead => ReadAt is not null;

    /// <summary>True when the notification has been archived (web <c>!!log.archived_at</c>).</summary>
    public bool IsArchived => ArchivedAt is not null;

    /// <summary>Parse one notification object, tolerating an absent / partial / schema-drifted body.</summary>
    /// <param name="element">The JSON object element for a single notification log.</param>
    public static InboxNotification? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        long? id = InboxJson.Long(element, "id", "id");
        if (id is null)
        {
            return null;
        }

        return new InboxNotification(
            Id: id.Value,
            AlertId: InboxJson.Long(element, "alert_id", "alertId"),
            Title: InboxJson.String(element, "title", "title") ?? string.Empty,
            Message: InboxJson.String(element, "message", "message") ?? string.Empty,
            Severity: InboxJson.String(element, "severity", "severity"),
            CreatedAt: InboxJson.Date(element, "created_at", "createdAt"),
            ReadAt: InboxJson.Date(element, "read_at", "readAt"),
            ArchivedAt: InboxJson.Date(element, "archived_at", "archivedAt"));
    }
}

/// <summary>
/// One server-aggregated notification thread — the native analogue of the web <c>NotificationLogGroup</c>
/// (web/src/api/types.ts): the <see cref="GroupKey"/> (a sha256 of rule + severity, or <see langword="null"/>
/// for a singleton), the <see cref="Latest"/> delivery that heads the thread, the filtered <see cref="Count"/>
/// and <see cref="UnreadCount"/>, and the <see cref="VehicleIds"/> the thread spans. Pure data.
/// </summary>
/// <param name="GroupKey">The thread key, or <see langword="null"/> for a singleton row.</param>
/// <param name="Latest">The most recent delivery in the thread (the row head).</param>
/// <param name="Count">The number of deliveries in the thread (filtered subset).</param>
/// <param name="UnreadCount">The number of unread deliveries in the thread (filtered subset).</param>
/// <param name="VehicleIds">The vehicle ids the thread spans.</param>
public sealed record InboxGroup(
    string? GroupKey,
    InboxNotification Latest,
    long Count,
    long UnreadCount,
    IReadOnlyList<long> VehicleIds)
{
    /// <summary>Parse one group object, tolerating an absent / partial / schema-drifted body.</summary>
    /// <param name="element">The JSON object element for a single notification group.</param>
    public static InboxGroup? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        JsonElement latestElement;
        if (!InboxJson.TryProperty(element, "latest", "latest", out latestElement))
        {
            return null;
        }

        InboxNotification? latest = InboxNotification.FromJson(latestElement);
        if (latest is null)
        {
            return null;
        }

        return new InboxGroup(
            GroupKey: InboxJson.String(element, "group_key", "groupKey"),
            Latest: latest,
            Count: InboxJson.Long(element, "count", "count") ?? 1,
            UnreadCount: InboxJson.Long(element, "unread_count", "unreadCount") ?? 0,
            VehicleIds: InboxJson.LongArray(element, "vehicle_ids", "vehicleIds"));
    }
}

/// <summary>
/// The URL-backed filter the inbox owns — the native analogue of the web <c>NotificationFilters</c> the
/// <c>InboxBody</c> assembles from its URL state (severity, vehicle, rule, search, read state, from/to,
/// archived). <see cref="ToQuery"/> serialises it into the snake_case query the backend
/// <c>GET /notifications/logs</c> endpoint expects (the native analogue of <c>serializeNotificationFilters</c>).
/// Pure data — no WinUI types.
/// </summary>
public sealed record InboxFilter(
    bool Archived,
    IReadOnlyList<InboxSeverity> Severities,
    IReadOnlyList<long> VehicleIds,
    IReadOnlyList<long> RuleIds,
    string? Query,
    string? From,
    string? To,
    InboxReadFilter Read)
{
    /// <summary>The default inbox filter — non-archived, no narrowing, all read states.</summary>
    public static InboxFilter Inbox { get; } = Default(false);

    /// <summary>The default archive filter — archived, no narrowing, all read states.</summary>
    public static InboxFilter Archive { get; } = Default(true);

    /// <summary>A default filter for the given tab with no narrowing applied.</summary>
    /// <param name="archived">Whether this is the archive tab.</param>
    public static InboxFilter Default(bool archived) => new(
        Archived: archived,
        Severities: Array.Empty<InboxSeverity>(),
        VehicleIds: Array.Empty<long>(),
        RuleIds: Array.Empty<long>(),
        Query: null,
        From: null,
        To: null,
        Read: InboxReadFilter.All);

    /// <summary>
    /// Serialise to the snake_case query parameter map for <c>GET /notifications/logs</c>. Mirrors the web
    /// <c>serializeNotificationFilters</c>: only non-empty narrowing keys are emitted, <c>read</c> is the
    /// boolean form, and <c>archived</c> is always present (the tab discriminator).
    /// </summary>
    public IReadOnlyDictionary<string, object?> ToQuery()
    {
        var query = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["archived"] = Archived ? "true" : "false",
        };

        if (Severities.Count > 0)
        {
            query["severity"] = string.Join(",", Severities.Select(SeverityWire));
        }

        if (VehicleIds.Count > 0)
        {
            query["vehicle_id"] = string.Join(",", VehicleIds.Select(v => v.ToString(CultureInfo.InvariantCulture)));
        }

        if (RuleIds.Count > 0)
        {
            query["rule_id"] = string.Join(",", RuleIds.Select(r => r.ToString(CultureInfo.InvariantCulture)));
        }

        if (!string.IsNullOrWhiteSpace(Query))
        {
            query["q"] = Query;
        }

        if (!string.IsNullOrWhiteSpace(From))
        {
            query["from"] = From;
        }

        if (!string.IsNullOrWhiteSpace(To))
        {
            query["to"] = To;
        }

        if (Read != InboxReadFilter.All)
        {
            query["read"] = Read == InboxReadFilter.Read ? "true" : "false";
        }

        return query;
    }

    /// <summary>The wire token for a severity filter value (web <c>'info' | 'warn' | 'critical'</c>).</summary>
    public static string SeverityWire(InboxSeverity severity) => severity switch
    {
        InboxSeverity.Info => "info",
        InboxSeverity.Warn => "warn",
        InboxSeverity.Critical => "critical",
        _ => "info",
    };
}

/// <summary>
/// One cache-then-network reading of the inbox — exactly one of <see cref="Rows"/> (flat view) or
/// <see cref="Groups"/> (grouped view) is populated, per the active <see cref="View"/>. The native analogue
/// of the web's two-query composition (<c>useNotificationLogs</c> for flat, <c>useNotificationGroups</c> for
/// grouped); only the active read is enabled, exactly as the web gates them on <c>!isGrouped</c> /
/// <c>isGrouped</c>. Pure data.
/// </summary>
/// <param name="View">Which read produced this reading.</param>
/// <param name="Rows">The flat delivery list (populated in flat view; empty otherwise).</param>
/// <param name="Groups">The threaded group list (populated in grouped view; empty otherwise).</param>
public sealed record InboxReading(
    InboxView View,
    IReadOnlyList<InboxNotification> Rows,
    IReadOnlyList<InboxGroup> Groups)
{
    /// <summary>An empty reading for the given view (no rows / groups).</summary>
    /// <param name="view">The active view mode.</param>
    public static InboxReading EmptyFor(InboxView view) =>
        new(view, Array.Empty<InboxNotification>(), Array.Empty<InboxGroup>());

    /// <summary>Parse a logs / groups JSON array into a reading for <paramref name="view"/>.</summary>
    /// <param name="element">The JSON array body (flat logs, or grouped logs when <paramref name="grouped"/>).</param>
    /// <param name="view">The active view mode the read was issued for.</param>
    /// <param name="grouped">Whether <paramref name="element"/> is a grouped (<c>NotificationLogGroup[]</c>) body.</param>
    public static InboxReading FromJson(JsonElement element, InboxView view, bool grouped)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return EmptyFor(view);
        }

        if (grouped)
        {
            var groups = new List<InboxGroup>(element.GetArrayLength());
            foreach (JsonElement item in element.EnumerateArray())
            {
                InboxGroup? group = InboxGroup.FromJson(item);
                if (group is not null)
                {
                    groups.Add(group);
                }
            }

            return new InboxReading(view, Array.Empty<InboxNotification>(), groups);
        }

        var rows = new List<InboxNotification>(element.GetArrayLength());
        foreach (JsonElement item in element.EnumerateArray())
        {
            InboxNotification? row = InboxNotification.FromJson(item);
            if (row is not null)
            {
                rows.Add(row);
            }
        }

        return new InboxReading(view, rows, Array.Empty<InboxGroup>());
    }
}

/// <summary>
/// The render-time data model the projection consumes — the resolved <see cref="Reading"/> plus the inbox
/// context the web <c>InboxBody</c> derives its branches from: whether this is the archive tab, the active
/// <see cref="View"/>, and the current bulk <see cref="SelectedIds"/>. Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="Reading">The resolved cache-then-network reading.</param>
/// <param name="Archived">Whether this is the archive tab (web <c>archived</c> prop).</param>
/// <param name="View">The active view mode (web URL <c>view</c>).</param>
/// <param name="SelectedIds">The currently bulk-selected ids (web <c>useBulkSelection</c> state).</param>
public sealed record InboxBodyModel(
    InboxReading Reading,
    bool Archived,
    InboxView View,
    IReadOnlySet<long> SelectedIds)
{
    /// <summary>An empty inbox model (flat view, nothing selected) — the headless default.</summary>
    public static InboxBodyModel Empty { get; } =
        new(InboxReading.EmptyFor(InboxView.Flat), false, InboxView.Flat, new HashSet<long>());

    /// <summary>
    /// Whether the grouped/threaded list is active — web <c>isGrouped = view === 'grouped' &amp;&amp;
    /// !archived</c>. The archive tab is always flat (row-by-row triage).
    /// </summary>
    public bool IsGrouped => View == InboxView.Grouped && !Archived;
}

/// <summary>One projected per-row context-menu command — render-ready label + glyph for the WinUI menu.</summary>
/// <param name="Action">The command this item invokes.</param>
/// <param name="Label">The localized menu label.</param>
/// <param name="Glyph">The Segoe Fluent glyph for the menu item.</param>
/// <param name="Destructive">Whether the item is destructive (web <c>destructive</c> — delete).</param>
public sealed record InboxRowMenuItem(InboxRowAction Action, string Label, string Glyph, bool Destructive);

/// <summary>
/// One projected, render-ready flat notification row — the native analogue of a web <c>NotificationRow</c>
/// the inbox composes. Holds the selection <see cref="Id"/>, the <see cref="Title"/> + <see cref="Message"/>,
/// the resolved severity chip (<see cref="SeverityLabel"/> + <see cref="SeverityStatus"/>), the relative
/// <see cref="TimeText"/>, the read / archived / selected flags, the spoken <see cref="AutomationName"/>, and
/// the per-row <see cref="ContextMenu"/>. Pure data.
/// </summary>
public sealed record InboxRowDisplay(
    long Id,
    string Title,
    string Message,
    string? SeverityLabel,
    StatusKind SeverityStatus,
    string TimeText,
    bool IsRead,
    bool IsArchived,
    bool Selected,
    string AutomationName,
    IReadOnlyList<InboxRowMenuItem> ContextMenu);

/// <summary>
/// One day bucket in the flat list — the native analogue of the web <c>groupByDay</c> output: a
/// <see cref="DayLabel"/> ("Today" / "Yesterday" / a dated header) over the <see cref="Rows"/> that fall on
/// that local day, newest first. Pure data.
/// </summary>
/// <param name="DayLabel">The localized day header.</param>
/// <param name="Rows">The rows on this day, in source order (newest first).</param>
public sealed record InboxDayGroup(string DayLabel, IReadOnlyList<InboxRowDisplay> Rows);

/// <summary>
/// One projected, render-ready threaded group row — the native analogue of a web <c>NotificationGroupRow</c>.
/// Holds the head delivery's <see cref="LatestId"/> + content, the thread <see cref="CountText"/> /
/// <see cref="UnreadCount"/>, the selected flag, the spoken <see cref="AutomationName"/> and the per-row
/// <see cref="ContextMenu"/>. Pure data.
/// </summary>
public sealed record InboxGroupRowDisplay(
    long LatestId,
    string? GroupKey,
    string Title,
    string Message,
    string? SeverityLabel,
    StatusKind SeverityStatus,
    string TimeText,
    long Count,
    string CountText,
    long UnreadCount,
    string? UnreadText,
    bool Selected,
    string AutomationName,
    IReadOnlyList<InboxRowMenuItem> ContextMenu);

/// <summary>
/// One projected, render-ready bulk-action toolbar button — the native analogue of a web <c>BulkAction</c>.
/// Carries the localized <see cref="Label"/> + <see cref="Glyph"/>, the destructive flag, and (for delete) the
/// localized confirmation copy the web attaches via the action's <c>confirm</c> contract.
/// </summary>
public sealed record InboxBulkActionItem(
    InboxBulkAction Action,
    string Label,
    string Glyph,
    bool Destructive,
    string? ConfirmTitle,
    string? ConfirmBody,
    string? ConfirmLabel);

/// <summary>
/// The fully projected, render-ready view of the inbox body for one model — the native analogue of what the
/// web <c>InboxBody</c> renders. Holds the resolved layout flags, the day-grouped flat <see cref="Days"/> or
/// the threaded <see cref="Groups"/>, the header counts + labels, the bulk-selection summary, the resolved
/// empty-state copy for the active tab / view, and the surface <see cref="AutomationName"/>. Pure data so
/// every branch is asserted headlessly.
/// </summary>
public sealed record InboxBodyDisplay(
    bool IsGrouped,
    bool Archived,
    bool HasContent,
    IReadOnlyList<InboxDayGroup> Days,
    IReadOnlyList<InboxGroupRowDisplay> Groups,
    int FlatCount,
    int GroupCount,
    int UnreadCount,
    IReadOnlyList<long> VisibleIds,
    int SelectedCount,
    bool AllVisibleSelected,
    IReadOnlyList<InboxBulkActionItem> BulkActions,
    string CountLabel,
    string SelectAllLabel,
    string ViewLabel,
    string GroupedLabel,
    string FlatLabel,
    string MarkAllReadLabel,
    string ItemNounSingular,
    string ItemNounPlural,
    string EmptyTitle,
    string EmptyMessage,
    string? EmptyCtaLabel,
    string AutomationName);

/// <summary>
/// Pure projection from an <see cref="InboxBodyModel"/> to its <see cref="InboxBodyDisplay"/> — the native
/// port of web/src/features/notifications/components/InboxBody.tsx. Reproduces the web's data shaping: the
/// grouped/flat branch gate (<c>isGrouped</c>), the <c>groupByDay</c> bucketing with Today / Yesterday / dated
/// headers, the severity-chip classification, the relative timestamps, the per-row context menu assembly, the
/// tab-specific bulk-action set, the unread count, the select-all master state, and the empty-state copy. Every
/// label resolves through the i18n facade using the catalog keys the web source feeds into <c>t()</c>. No
/// WinUI types — unit-tested without a UI host.
/// </summary>
public static class InboxBodyProjection
{
    /// <summary>i18n key for the count label (web <c>notifications.inbox.countLabel</c>).</summary>
    public const string CountLabelKey = "notifications.inbox.countLabel";

    /// <summary>i18n key for the select-all checkbox label (web <c>notifications.inbox.selectAll</c>).</summary>
    public const string SelectAllKey = "notifications.inbox.selectAll";

    /// <summary>i18n key for the view-toggle group label (web <c>notifications.view.label</c>).</summary>
    public const string ViewLabelKey = "notifications.view.label";

    /// <summary>i18n key for the grouped view label (web <c>notifications.view.grouped</c>).</summary>
    public const string GroupedKey = "notifications.view.grouped";

    /// <summary>i18n key for the flat view label (web <c>notifications.view.flat</c>).</summary>
    public const string FlatKey = "notifications.view.flat";

    /// <summary>i18n key for the mark-all-read action (web <c>notifications.markAllRead.action</c>).</summary>
    public const string MarkAllReadKey = "notifications.markAllRead.action";

    /// <summary>i18n key for the singular item noun (web <c>bulk.noun.notification_one</c>).</summary>
    public const string NounOneKey = "bulk.noun.notification_one";

    /// <summary>i18n key for the plural item noun (web <c>bulk.noun.notification_other</c>).</summary>
    public const string NounOtherKey = "bulk.noun.notification_other";

    /// <summary>i18n key for the "Today" day header (web <c>common.today</c>).</summary>
    public const string TodayKey = "common.today";

    /// <summary>i18n key for the "Yesterday" day header (web <c>common.yesterday</c>).</summary>
    public const string YesterdayKey = "common.yesterday";

    /// <summary>i18n key for the bulk "Mark read" action (web <c>notifications.inbox.bulk.markRead</c>).</summary>
    public const string BulkMarkReadKey = "notifications.inbox.bulk.markRead";

    /// <summary>i18n key for the bulk "Archive" action (web <c>notifications.inbox.bulk.archive</c>).</summary>
    public const string BulkArchiveKey = "notifications.inbox.bulk.archive";

    /// <summary>i18n key for the bulk "Restore" action (web <c>notifications.inbox.bulk.restore</c>).</summary>
    public const string BulkRestoreKey = "notifications.inbox.bulk.restore";

    /// <summary>i18n key for the bulk "Delete" action (web <c>bulk.actions.delete</c>).</summary>
    public const string BulkDeleteKey = "bulk.actions.delete";

    /// <summary>i18n key for the delete confirmation title (web <c>notifications.inbox.bulk.deleteConfirmTitle</c>).</summary>
    public const string DeleteConfirmTitleKey = "notifications.inbox.bulk.deleteConfirmTitle";

    /// <summary>i18n key for the delete confirmation body (web <c>notifications.inbox.bulk.deleteConfirmBody</c>).</summary>
    public const string DeleteConfirmBodyKey = "notifications.inbox.bulk.deleteConfirmBody";

    /// <summary>i18n key for the shared "Delete" confirm label (web <c>common.delete</c>).</summary>
    public const string CommonDeleteKey = "common.delete";

    /// <summary>i18n key for the row "Mark as read" item (web <c>notifications.inbox.row.markRead</c>).</summary>
    public const string RowMarkReadKey = "notifications.inbox.row.markRead";

    /// <summary>i18n key for the row "Mark as unread" item (web <c>notifications.inbox.row.markUnread</c>).</summary>
    public const string RowMarkUnreadKey = "notifications.inbox.row.markUnread";

    /// <summary>i18n key for the row "Archive" item (web <c>notifications.inbox.row.archive</c>).</summary>
    public const string RowArchiveKey = "notifications.inbox.row.archive";

    /// <summary>i18n key for the row "Restore" item (web <c>notifications.inbox.row.unarchive</c>).</summary>
    public const string RowRestoreKey = "notifications.inbox.row.unarchive";

    /// <summary>i18n key for the "View context" item (web <c>alerts.viewContext</c>).</summary>
    public const string ViewContextKey = "alerts.viewContext";

    /// <summary>i18n key for the inbox empty title (web <c>notifications.inbox.empty.title</c>).</summary>
    public const string EmptyTitleKey = "notifications.inbox.empty.title";

    /// <summary>i18n key for the inbox empty body (web <c>notifications.inbox.empty.message</c>).</summary>
    public const string EmptyMessageKey = "notifications.inbox.empty.message";

    /// <summary>i18n key for the archive empty title (web <c>notifications.inbox.empty.archivedTitle</c>).</summary>
    public const string EmptyArchivedTitleKey = "notifications.inbox.empty.archivedTitle";

    /// <summary>i18n key for the archive empty body (web <c>notifications.inbox.empty.archivedMessage</c>).</summary>
    public const string EmptyArchivedMessageKey = "notifications.inbox.empty.archivedMessage";

    /// <summary>i18n key for the empty-state CTA (web <c>notifications.inbox.empty.cta</c>).</summary>
    public const string EmptyCtaKey = "notifications.inbox.empty.cta";

    /// <summary>i18n key for the grouped empty title (web <c>notifications.group.emptyTitle</c>).</summary>
    public const string GroupEmptyTitleKey = "notifications.group.emptyTitle";

    /// <summary>i18n key for the grouped empty body (web <c>notifications.group.emptyMessage</c>).</summary>
    public const string GroupEmptyMessageKey = "notifications.group.emptyMessage";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade and clock.</summary>
    /// <param name="model">The render-time data model (the resolved reading + inbox context).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The current instant, used for the Today / Yesterday / relative-time tiers.</param>
    public static InboxBodyDisplay Project(InboxBodyModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        bool grouped = model.IsGrouped;

        IReadOnlyList<InboxNotification> rows = model.Reading.Rows;
        IReadOnlyList<InboxGroup> groups = model.Reading.Groups;

        IReadOnlyList<InboxDayGroup> days = grouped
            ? Array.Empty<InboxDayGroup>()
            : BuildDays(rows, model, localizer, now);

        IReadOnlyList<InboxGroupRowDisplay> groupRows = grouped
            ? BuildGroups(groups, model, localizer, now)
            : Array.Empty<InboxGroupRowDisplay>();

        var visibleIds = rows.Select(r => r.Id).ToArray();
        int unread = rows.Count(r => !r.IsRead);
        bool allSelected = visibleIds.Length > 0 && visibleIds.All(model.SelectedIds.Contains);

        int flatCount = rows.Count;
        int groupCount = groups.Count;
        bool hasContent = grouped ? groupCount > 0 : flatCount > 0;

        string countLabel = Interpolate(
            localizer.GetString(CountLabelKey, "{{count}} notifications"),
            grouped ? groupCount : flatCount);

        (string emptyTitle, string emptyMessage, string? emptyCta) = BuildEmptyCopy(model, grouped, localizer);

        return new InboxBodyDisplay(
            IsGrouped: grouped,
            Archived: model.Archived,
            HasContent: hasContent,
            Days: days,
            Groups: groupRows,
            FlatCount: flatCount,
            GroupCount: groupCount,
            UnreadCount: unread,
            VisibleIds: visibleIds,
            SelectedCount: model.SelectedIds.Count,
            AllVisibleSelected: allSelected,
            BulkActions: BuildBulkActions(model.Archived, localizer),
            CountLabel: countLabel,
            SelectAllLabel: localizer.GetString(SelectAllKey, "Select all visible"),
            ViewLabel: localizer.GetString(ViewLabelKey, "View"),
            GroupedLabel: localizer.GetString(GroupedKey, "Grouped"),
            FlatLabel: localizer.GetString(FlatKey, "Flat"),
            MarkAllReadLabel: localizer.GetString(MarkAllReadKey, "Mark all read"),
            ItemNounSingular: localizer.GetString(NounOneKey, "notification"),
            ItemNounPlural: localizer.GetString(NounOtherKey, "notifications"),
            EmptyTitle: emptyTitle,
            EmptyMessage: emptyMessage,
            EmptyCtaLabel: emptyCta,
            AutomationName: BuildAutomationName(model, grouped, hasContent, flatCount, groupCount, unread, emptyTitle, localizer));
    }

    /// <summary>Classify a raw severity string into its semantic chip class (web row/badge accent switch).</summary>
    /// <param name="severity">The raw severity string (case-insensitive); <see langword="null"/> → none.</param>
    public static InboxSeverityClass Classify(string? severity) =>
        (severity ?? string.Empty).Trim().ToLowerInvariant() switch
        {
            "critical" => InboxSeverityClass.Critical,
            "warning" or "warn" => InboxSeverityClass.Warning,
            "info" => InboxSeverityClass.Info,
            _ => InboxSeverityClass.None,
        };

    /// <summary>The status colour a severity chip renders with (critical → danger, warn → warning, …).</summary>
    /// <param name="severityClass">The classified severity.</param>
    public static StatusKind StatusFor(InboxSeverityClass severityClass) => severityClass switch
    {
        InboxSeverityClass.Critical => StatusKind.Danger,
        InboxSeverityClass.Warning => StatusKind.Warning,
        InboxSeverityClass.Info => StatusKind.Info,
        _ => StatusKind.Neutral,
    };

    /// <summary>The localized day-bucket header for a timestamp — "Today" / "Yesterday" / a dated header.</summary>
    /// <param name="value">The notification's local creation instant.</param>
    /// <param name="now">The current instant.</param>
    /// <param name="localizer">The i18n facade for the Today / Yesterday labels.</param>
    public static string DayLabel(DateTimeOffset value, DateTimeOffset now, ILocalizer localizer)
    {
        DateTime day = value.LocalDateTime.Date;
        DateTime today = now.LocalDateTime.Date;

        if (day == today)
        {
            return localizer.GetString(TodayKey, "Today");
        }

        if (day == today.AddDays(-1))
        {
            return localizer.GetString(YesterdayKey, "Yesterday");
        }

        return day.ToString("dddd, MMM d, yyyy", CultureInfo.GetCultureInfo("en-US"));
    }

    private static List<InboxDayGroup> BuildDays(
        IReadOnlyList<InboxNotification> rows,
        InboxBodyModel model,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        var days = new List<InboxDayGroup>();
        var current = new List<InboxRowDisplay>();
        string? currentLabel = null;

        foreach (InboxNotification row in rows)
        {
            if (row.CreatedAt is not { } created)
            {
                continue;
            }

            string label = DayLabel(created, now, localizer);
            if (currentLabel is null || !string.Equals(currentLabel, label, StringComparison.Ordinal))
            {
                if (currentLabel is not null)
                {
                    days.Add(new InboxDayGroup(currentLabel, current));
                    current = new List<InboxRowDisplay>();
                }

                currentLabel = label;
            }

            current.Add(BuildRow(row, model, localizer, now));
        }

        if (currentLabel is not null)
        {
            days.Add(new InboxDayGroup(currentLabel, current));
        }

        return days;
    }

    private static InboxRowDisplay BuildRow(
        InboxNotification row,
        InboxBodyModel model,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        InboxSeverityClass severityClass = Classify(row.Severity);
        string? severityLabel = severityClass == InboxSeverityClass.None ? null : Capitalize(row.Severity);
        string time = DateTimeFormatting.Format(row.CreatedAt, DateTimeVariant.Relative, now);
        bool selected = model.SelectedIds.Contains(row.Id);

        string state = row.IsRead
            ? localizer.GetString(RowMarkReadKey, "Mark as read")
            : localizer.GetString(RowMarkUnreadKey, "Mark as unread");

        string automation = severityLabel is null
            ? string.Create(CultureInfo.CurrentCulture, $"{row.Title}. {row.Message}. {time}")
            : string.Create(CultureInfo.CurrentCulture, $"{severityLabel}. {row.Title}. {row.Message}. {time}");

        return new InboxRowDisplay(
            Id: row.Id,
            Title: row.Title,
            Message: row.Message,
            SeverityLabel: severityLabel,
            SeverityStatus: StatusFor(severityClass),
            TimeText: time,
            IsRead: row.IsRead,
            IsArchived: row.IsArchived,
            Selected: selected,
            AutomationName: automation,
            ContextMenu: BuildRowMenu(row, model.Archived, localizer));
    }

    private static List<InboxGroupRowDisplay> BuildGroups(
        IReadOnlyList<InboxGroup> groups,
        InboxBodyModel model,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        var result = new List<InboxGroupRowDisplay>(groups.Count);
        foreach (InboxGroup group in groups)
        {
            InboxNotification latest = group.Latest;
            InboxSeverityClass severityClass = Classify(latest.Severity);
            string? severityLabel = severityClass == InboxSeverityClass.None ? null : Capitalize(latest.Severity);
            string time = DateTimeFormatting.Format(latest.CreatedAt, DateTimeVariant.Relative, now);
            string countText = NumberFormatting.Format(group.Count, null, 0);
            string? unreadText = group.UnreadCount > 0
                ? NumberFormatting.Format(group.UnreadCount, null, 0)
                : null;

            string automation = unreadText is null
                ? string.Create(CultureInfo.CurrentCulture, $"{latest.Title}. {latest.Message}. {countText}. {time}")
                : string.Create(CultureInfo.CurrentCulture, $"{latest.Title}. {latest.Message}. {countText}. {unreadText} unread. {time}");

            result.Add(new InboxGroupRowDisplay(
                LatestId: latest.Id,
                GroupKey: group.GroupKey,
                Title: latest.Title,
                Message: latest.Message,
                SeverityLabel: severityLabel,
                SeverityStatus: StatusFor(severityClass),
                TimeText: time,
                Count: group.Count,
                CountText: countText,
                UnreadCount: group.UnreadCount,
                UnreadText: unreadText,
                Selected: model.SelectedIds.Contains(latest.Id),
                AutomationName: automation,
                ContextMenu: BuildRowMenu(latest, model.Archived, localizer)));
        }

        return result;
    }

    private static List<InboxRowMenuItem> BuildRowMenu(InboxNotification row, bool archived, ILocalizer localizer)
    {
        var items = new List<InboxRowMenuItem>(4);

        if (!row.IsRead)
        {
            items.Add(new InboxRowMenuItem(
                InboxRowAction.MarkRead,
                localizer.GetString(RowMarkReadKey, "Mark as read"),
                InboxBodyRegistration.MailOpenGlyph,
                Destructive: false));
        }
        else
        {
            items.Add(new InboxRowMenuItem(
                InboxRowAction.MarkUnread,
                localizer.GetString(RowMarkUnreadKey, "Mark as unread"),
                InboxBodyRegistration.MailGlyph,
                Destructive: false));
        }

        if (!row.IsArchived)
        {
            items.Add(new InboxRowMenuItem(
                InboxRowAction.Archive,
                localizer.GetString(RowArchiveKey, "Archive"),
                InboxBodyRegistration.ArchiveGlyph,
                Destructive: false));
        }
        else
        {
            items.Add(new InboxRowMenuItem(
                InboxRowAction.Restore,
                localizer.GetString(RowRestoreKey, "Restore"),
                InboxBodyRegistration.RestoreGlyph,
                Destructive: false));
        }

        // Web parity: "View context" appears only when the notification is tied to an alert that can be
        // drilled into (the web gates it on a resolvable drill-through href, which requires an alert).
        if (row.AlertId is not null)
        {
            items.Add(new InboxRowMenuItem(
                InboxRowAction.ViewContext,
                localizer.GetString(ViewContextKey, "View context"),
                InboxBodyRegistration.ViewContextGlyph,
                Destructive: false));
        }

        items.Add(new InboxRowMenuItem(
            InboxRowAction.Delete,
            localizer.GetString(CommonDeleteKey, "Delete"),
            InboxBodyRegistration.DeleteGlyph,
            Destructive: true));

        return items;
    }

    private static List<InboxBulkActionItem> BuildBulkActions(bool archived, ILocalizer localizer)
    {
        var actions = new List<InboxBulkActionItem>(3);

        if (!archived)
        {
            actions.Add(new InboxBulkActionItem(
                InboxBulkAction.MarkRead,
                localizer.GetString(BulkMarkReadKey, "Mark read"),
                InboxBodyRegistration.MailOpenGlyph,
                Destructive: false,
                ConfirmTitle: null,
                ConfirmBody: null,
                ConfirmLabel: null));
            actions.Add(new InboxBulkActionItem(
                InboxBulkAction.Archive,
                localizer.GetString(BulkArchiveKey, "Archive"),
                InboxBodyRegistration.ArchiveGlyph,
                Destructive: false,
                ConfirmTitle: null,
                ConfirmBody: null,
                ConfirmLabel: null));
        }
        else
        {
            actions.Add(new InboxBulkActionItem(
                InboxBulkAction.Restore,
                localizer.GetString(BulkRestoreKey, "Restore"),
                InboxBodyRegistration.RestoreGlyph,
                Destructive: false,
                ConfirmTitle: null,
                ConfirmBody: null,
                ConfirmLabel: null));
        }

        actions.Add(new InboxBulkActionItem(
            InboxBulkAction.Delete,
            localizer.GetString(BulkDeleteKey, "Delete"),
            InboxBodyRegistration.DeleteGlyph,
            Destructive: true,
            ConfirmTitle: localizer.GetString(DeleteConfirmTitleKey, "Delete notifications?"),
            ConfirmBody: localizer.GetString(
                DeleteConfirmBodyKey,
                "These notifications will be permanently removed. Archive is usually the safer choice."),
            ConfirmLabel: localizer.GetString(CommonDeleteKey, "Delete")));

        return actions;
    }

    private static (string Title, string Message, string? Cta) BuildEmptyCopy(
        InboxBodyModel model,
        bool grouped,
        ILocalizer localizer)
    {
        if (grouped)
        {
            return (
                localizer.GetString(GroupEmptyTitleKey, "No notification threads"),
                localizer.GetString(
                    GroupEmptyMessageKey,
                    "When alert rules fire repeatedly, related notifications will be grouped here."),
                localizer.GetString(EmptyCtaKey, "Configure alert rules"));
        }

        if (model.Archived)
        {
            return (
                localizer.GetString(EmptyArchivedTitleKey, "No archived notifications"),
                localizer.GetString(EmptyArchivedMessageKey, "Archived notifications will appear here."),
                null);
        }

        return (
            localizer.GetString(EmptyTitleKey, "No notifications"),
            localizer.GetString(
                EmptyMessageKey,
                "When alert rules fire, the resulting notifications appear here."),
            localizer.GetString(EmptyCtaKey, "Configure alert rules"));
    }

    private static string BuildAutomationName(
        InboxBodyModel model,
        bool grouped,
        bool hasContent,
        int flatCount,
        int groupCount,
        int unread,
        string emptyTitle,
        ILocalizer localizer)
    {
        if (!hasContent)
        {
            return emptyTitle;
        }

        string count = Interpolate(
            localizer.GetString(CountLabelKey, "{{count}} notifications"),
            grouped ? groupCount : flatCount);

        if (grouped || unread == 0)
        {
            return count;
        }

        return string.Create(CultureInfo.CurrentCulture, $"{count}. {unread} unread");
    }

    // Web pie/title-casing rule: uppercase the first character, leave the rest verbatim.
    private static string Capitalize(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return string.Empty;
        }

        return char.ToUpper(value[0], CultureInfo.InvariantCulture) + value[1..];
    }

    private static string Interpolate(string template, int count) => template.Replace(
        "{{count}}",
        NumberFormatting.Format(count, null, 0),
        StringComparison.Ordinal);
}

/// <summary>
/// PII-safe diagnostics for the <c>InboxBody</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a notification title, message body,
/// recipient or count — so a diagnostics line can never leak what a user's notifications were about.
/// Thread-safe.
/// </summary>
public sealed class InboxBodyDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public InboxBodyDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=InboxBody</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={InboxBodyRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>InboxBody</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/notifications/components/InboxBody.tsx</c>, plus the Segoe Fluent Icons glyphs that
/// stand in for the web Lucide icons (Bell, MailOpen, Mail, Archive, ArchiveRestore, Trash2, CheckCheck,
/// Layers, List, ExternalLink). UI-free so the metadata is asserted in tests.
/// </summary>
public static class InboxBodyRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "InboxBody";

    /// <summary>Segoe Fluent "Ringer" glyph — the empty-state + header bell (web <c>Bell</c>).</summary>
    public const string BellGlyph = "\uEA8F";

    /// <summary>Segoe Fluent "Read" glyph — mark-as-read (web <c>MailOpen</c>).</summary>
    public const string MailOpenGlyph = "\uE8C3";

    /// <summary>Segoe Fluent "Mail" glyph — mark-as-unread (web <c>Mail</c>).</summary>
    public const string MailGlyph = "\uE715";

    /// <summary>Segoe Fluent "Archive" glyph — archive (web <c>Archive</c>).</summary>
    public const string ArchiveGlyph = "\uE7B8";

    /// <summary>Segoe Fluent "Undo" glyph — restore (web <c>ArchiveRestore</c>).</summary>
    public const string RestoreGlyph = "\uE7A7";

    /// <summary>Segoe Fluent "Delete" glyph — delete (web <c>Trash2</c>).</summary>
    public const string DeleteGlyph = "\uE74D";

    /// <summary>Segoe Fluent "CheckList" glyph — mark all read (web <c>CheckCheck</c>).</summary>
    public const string MarkAllReadGlyph = "\uE9D5";

    /// <summary>Segoe Fluent "GroupList" glyph — grouped view toggle (web <c>Layers</c>).</summary>
    public const string GroupedGlyph = "\uF168";

    /// <summary>Segoe Fluent "List" glyph — flat view toggle (web <c>List</c>).</summary>
    public const string FlatGlyph = "\uE8FD";

    /// <summary>Segoe Fluent "OpenInNewWindow" glyph — view context (web <c>ExternalLink</c>).</summary>
    public const string ViewContextGlyph = "\uE8A7";

    /// <summary>The Segoe Fluent glyph for a bulk / row action.</summary>
    /// <param name="action">The bulk action selecting the glyph.</param>
    public static string BulkGlyph(InboxBulkAction action) => action switch
    {
        InboxBulkAction.MarkRead => MailOpenGlyph,
        InboxBulkAction.Archive => ArchiveGlyph,
        InboxBulkAction.Restore => RestoreGlyph,
        _ => DeleteGlyph,
    };
}

/// <summary>
/// Small null-tolerant JSON readers shared by the inbox parsers — read a snake_case key first, then the
/// camelCase fallback the <c>camelCaseKeys</c> transform produces, so a contract shift never throws. UI-free.
/// </summary>
internal static class InboxJson
{
    public static bool TryProperty(JsonElement element, string snake, string camel, out JsonElement value)
    {
        if (element.TryGetProperty(snake, out value))
        {
            return true;
        }

        return element.TryGetProperty(camel, out value);
    }

    public static string? String(JsonElement element, string snake, string camel)
    {
        if (!TryProperty(element, snake, camel, out JsonElement value))
        {
            return null;
        }

        return value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    }

    public static long? Long(JsonElement element, string snake, string camel)
    {
        if (!TryProperty(element, snake, camel, out JsonElement value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetInt64(out long n) => n,
            JsonValueKind.String when long.TryParse(value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out long s) => s,
            _ => null,
        };
    }

    public static DateTimeOffset? Date(JsonElement element, string snake, string camel)
    {
        if (!TryProperty(element, snake, camel, out JsonElement value) || value.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            value.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out DateTimeOffset parsed)
            ? parsed
            : null;
    }

    public static IReadOnlyList<long> LongArray(JsonElement element, string snake, string camel)
    {
        if (!TryProperty(element, snake, camel, out JsonElement value) || value.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<long>();
        }

        var result = new List<long>(value.GetArrayLength());
        foreach (JsonElement item in value.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Number && item.TryGetInt64(out long n))
            {
                result.Add(n);
            }
        }

        return result;
    }
}
