package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import io.teslasync.shared.core.presentation.notifications.Alert
import io.teslasync.shared.core.presentation.notifications.AlertDetail
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.notifications.AlertRuleSaveRequest
import io.teslasync.shared.core.presentation.notifications.AlertRuleSnoozeRequest
import io.teslasync.shared.core.presentation.notifications.AlertTestRequest
import io.teslasync.shared.core.presentation.notifications.BulkMarkReadVars
import io.teslasync.shared.core.presentation.notifications.BulkRulesResult
import io.teslasync.shared.core.presentation.notifications.ChannelTestResult
import io.teslasync.shared.core.presentation.notifications.ComputedMetricPreview
import io.teslasync.shared.core.presentation.notifications.ComputedMetricPreviewInput
import io.teslasync.shared.core.presentation.notifications.ComputedMetricSummary
import io.teslasync.shared.core.presentation.notifications.DeletedCountResult
import io.teslasync.shared.core.presentation.notifications.NotificationChannelInput
import io.teslasync.shared.core.presentation.notifications.NotificationLog
import io.teslasync.shared.core.presentation.notifications.NotificationLogGroup
import io.teslasync.shared.core.presentation.notifications.NotificationStats
import io.teslasync.shared.core.presentation.notifications.QuietHoursWindow
import io.teslasync.shared.core.presentation.notifications.QuietHoursWindowInput
import io.teslasync.shared.core.presentation.notifications.UnreadCountResponse
import io.teslasync.shared.core.presentation.notifications.UpdatedCountResult
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The S7 data port for the whole Notifications control plane — the cross-platform analogue of the
 * web `useNotifications` hook domain (web/src/api/hooks/useNotifications.ts). It spans the Alert
 * inbox, alert-rule CRUD, the computed-metric registry, the notification-log inbox (flat + grouped
 * + thread members + bell preview + unread count), notification stats, channel CRUD, and the
 * Do-Not-Disturb quiet-hours windows. Every native Notifications surface (Android/Apple via KMP,
 * Windows via the C# port) reaches the backend exclusively through this interface, so a single fake
 * stands in for the whole domain in the S8 state-holder tests.
 *
 * The reads stream a cache-then-network [Resource] (ADR-013): the cached value first for an instant
 * cold start, then the refreshed value, each cached under a stable per-feed key (see the key
 * builders below) mirroring the web TanStack query keys. The mutations are non-throwing suspend
 * [Result]s; they call the API directly and DO NOT touch the durable cache — the cache-then-network
 * operator always re-fetches when the S8 store bumps the affected feed's trigger (the
 * `invalidateQueries` analogue), so the previous rows stay visible during the reload while no stale
 * value is ever served as fresh. Values are SI on the wire (no unit-bearing fields in this domain);
 * conversion is the render boundary's job (S5).
 */
public interface NotificationsRepository {
    // ---- Reads --------------------------------------------------------------------

    /** `GET /alerts` — the alert inbox (web `useAlerts`, `safeArray`-guarded). */
    public fun alerts(): Flow<Resource<List<Alert>>>

    /** `GET /alerts/{id}` — one alert with its full audit timeline (web `useAlertDetail`). */
    public fun alertDetail(id: Long): Flow<Resource<AlertDetail>>

    /** `GET /alerts/rules` — the alert-rule list (web `useAlertRules`, `safeArray`-guarded). */
    public fun alertRules(): Flow<Resource<List<AlertRule>>>

    /** `GET /alerts/metrics` — the computed-metric registry (web `useAlertMetrics`). */
    public fun alertMetrics(): Flow<Resource<List<ComputedMetricSummary>>>

    /** `GET /notifications` — the notification-channel list (web `useNotificationChannels`). */
    public fun notificationChannels(): Flow<Resource<List<NotificationChannel>>>

    /** `GET /notifications/logs?<filters>` — the flat inbox (web `useNotificationLogs`). */
    public fun notificationLogs(filters: NotificationFilters = NotificationFilters()): Flow<Resource<List<NotificationLog>>>

    /** `GET /notifications/logs?grouped=true&<filters>` — the threaded inbox (web `useNotificationGroups`). */
    public fun notificationGroups(filters: NotificationFilters = NotificationFilters()): Flow<Resource<List<NotificationLogGroup>>>

    /**
     * `GET /notifications/logs?<filters>&group_key=<key>` — the members of one thread on expand
     * (web `useGroupMembers`). Reuses the flat-list endpoint AND its cache key
     * (`notificationLogsKey(filters + group_key)`) so the response dedupes with a matching flat list.
     */
    public fun groupMembers(
        groupKey: String,
        filters: NotificationFilters = NotificationFilters(),
    ): Flow<Resource<List<NotificationLog>>>

    /** `GET /notifications/unread-count` — the bell badge count (web `useUnreadCount`). */
    public fun unreadCount(): Flow<Resource<UnreadCountResponse>>

    /** `GET /notifications/logs?read=false&archived=false&limit=<n>` — bell preview (web `useUnreadNotifications`). */
    public fun unreadNotifications(limit: Int): Flow<Resource<List<NotificationLog>>>

    /** `GET /notifications/stats` — channel/delivery stats (web `useNotificationStats`). */
    public fun notificationStats(): Flow<Resource<NotificationStats>>

    /** `GET /notifications/quiet-hours` — the DND windows (web `useQuietHours`, `windows`-unwrapped). */
    public fun quietHours(): Flow<Resource<List<QuietHoursWindow>>>

    // ---- Mutations: alerts --------------------------------------------------------

    /** `POST /alerts/{id}/read` (web `useMarkAlertRead`). */
    public suspend fun markAlertRead(id: Long): Result<Unit>

    /** `POST /alerts/{id}/acknowledge` with `{ note }` only when [note] is non-blank (web `useAcknowledgeAlert`). */
    public suspend fun acknowledgeAlert(
        id: Long,
        note: String? = null,
    ): Result<AlertDetail>

    /** `POST /alerts/{id}/comment` with `{ note: note.trim() }` (web `useCommentAlert`). */
    public suspend fun commentAlert(
        id: Long,
        note: String,
    ): Result<AlertDetail>

    /** `POST /alerts/{id}/reopen` (web `useReopenAlert`). */
    public suspend fun reopenAlert(id: Long): Result<AlertDetail>

    // ---- Mutations: alert rules ---------------------------------------------------

    /** `POST /alerts/rules` (create) or `PUT /alerts/rules/{id}` (update) (web `useSaveAlertRule`). */
    public suspend fun saveAlertRule(request: AlertRuleSaveRequest): Result<AlertRule>

    /** `DELETE /alerts/rules/{id}` (web `useDeleteAlertRule`). */
    public suspend fun deleteAlertRule(id: Long): Result<Unit>

    /** `PUT /alerts/rules/{id}` with `{ enabled }` (web `useToggleAlertRule`). */
    public suspend fun toggleAlertRule(
        id: Long,
        enabled: Boolean,
    ): Result<AlertRule>

    /** `POST /alerts/rules/bulk/enable` with `{ ids }` (web `useBulkEnableRules`). */
    public suspend fun bulkEnableRules(ids: List<Long>): Result<BulkRulesResult>

    /** `POST /alerts/rules/bulk/disable` with `{ ids }` (web `useBulkDisableRules`). */
    public suspend fun bulkDisableRules(ids: List<Long>): Result<BulkRulesResult>

    /** `POST /alerts/test` with the full test body (web `useTestAlertRule`). */
    public suspend fun testAlertRule(request: AlertTestRequest): Result<Unit>

    /** `POST /alerts/rules/{id}/snooze` with `{ minutes?, until? }` (web `useSnoozeAlertRule`). */
    public suspend fun snoozeAlertRule(
        id: Long,
        request: AlertRuleSnoozeRequest,
    ): Result<AlertRule>

    /** `POST /alerts/test` with `{ kind: 'computed_metric', ... }` (web `usePreviewComputedMetric`). */
    public suspend fun previewComputedMetric(input: ComputedMetricPreviewInput): Result<ComputedMetricPreview>

    // ---- Mutations: notifications inbox -------------------------------------------

    /** `POST /notifications/mark-read` with `{ ids }` (web `useMarkNotificationsRead`). */
    public suspend fun markNotificationsRead(ids: List<Long>): Result<UpdatedCountResult>

    /** `POST /notifications/mark-read` with one of `{ ids } | { all } | { group_key }` (web `useBulkMarkRead`). */
    public suspend fun bulkMarkRead(vars: BulkMarkReadVars): Result<UpdatedCountResult>

    /** `POST /notifications/mark-unread` with `{ ids }` (web `useMarkNotificationsUnread`). */
    public suspend fun markNotificationsUnread(ids: List<Long>): Result<UpdatedCountResult>

    /** `POST /notifications/archive` with `{ ids }` (web `useArchiveNotifications`). */
    public suspend fun archiveNotifications(ids: List<Long>): Result<UpdatedCountResult>

    /** `POST /notifications/unarchive` with `{ ids }` (web `useUnarchiveNotifications`). */
    public suspend fun unarchiveNotifications(ids: List<Long>): Result<UpdatedCountResult>

    /** `DELETE /notifications/logs` with `{ ids }` (web `useDeleteNotifications`). */
    public suspend fun deleteNotifications(ids: List<Long>): Result<DeletedCountResult>

    // ---- Mutations: channels ------------------------------------------------------

    /** `POST /notifications` (create) or `PUT /notifications/{id}` (update) (web `useSaveChannel`). */
    public suspend fun saveChannel(input: NotificationChannelInput): Result<NotificationChannel>

    /** `DELETE /notifications/{id}` (web `useDeleteChannel`). */
    public suspend fun deleteChannel(id: Long): Result<Unit>

    /** `POST /notifications/{id}/toggle` (web `useToggleChannel`). */
    public suspend fun toggleChannel(id: Long): Result<NotificationChannel>

    /** `POST /notifications/{id}/test` (web `useTestChannel`). */
    public suspend fun testChannel(id: Long): Result<ChannelTestResult>

    // ---- Mutations: quiet hours ---------------------------------------------------

    /**
     * `POST /notifications/quiet-hours` (create, [id] null/≤0) or
     * `PATCH /notifications/quiet-hours/{id}` (update) — body is the id-free [input]
     * (web `useSaveQuietHours`).
     */
    public suspend fun saveQuietHours(
        input: QuietHoursWindowInput,
        id: Long? = null,
    ): Result<QuietHoursWindow>

    /** `DELETE /notifications/quiet-hours/{id}` (web `useDeleteQuietHours`). */
    public suspend fun deleteQuietHours(id: Long): Result<Unit>

    public companion object {
        /** The web `useUnreadNotifications` lower-bounds the limit at 1 (`Math.max(1, floor)`). */
        public const val MIN_BELL_LIMIT: Int = 1
    }
}

// ── Filter shape + serialization (ported web `NotificationFilters`) ──────────────

/**
 * The notifications-inbox filter shape — the port of the web `NotificationFilters`. Every field is
 * optional; multi-value fields are CSV-encoded by [notificationFilterParams]. Locked by golden
 * vectors shared with the C# port (ADR-004).
 */
public data class NotificationFilters(
    val severity: List<String>? = null,
    val vehicleId: List<Long>? = null,
    val ruleId: List<Long>? = null,
    val from: String? = null,
    val to: String? = null,
    val read: Boolean? = null,
    val archived: Boolean? = null,
    val q: String? = null,
    val groupKey: String? = null,
    val limit: Int? = null,
    val offset: Int? = null,
)

/**
 * The exact port of the web `serializeNotificationFilters` — builds the ordered query-param map
 * (severity, vehicle_id, rule_id, from, to, read, archived, q, group_key, limit, offset). A
 * multi-value field is included only when non-empty and is CSV-joined; a boolean is included only
 * when non-null and stringified as `true`/`false`; a string is included only when non-blank
 * (mirroring the web truthy guard); a number is always stringified when present. The transport
 * layer URL-encodes the values, so this returns the raw, unencoded param map. A pure function of
 * its input — locked by golden vectors so the C# and KMP ports cannot drift (ADR-004).
 */
public fun notificationFilterParams(filters: NotificationFilters): Map<String, String> {
    val params = linkedMapOf<String, String>()
    filters.severity?.takeIf { it.isNotEmpty() }?.let { params["severity"] = it.joinToString(",") }
    filters.vehicleId?.takeIf { it.isNotEmpty() }?.let { params["vehicle_id"] = it.joinToString(",") }
    filters.ruleId?.takeIf { it.isNotEmpty() }?.let { params["rule_id"] = it.joinToString(",") }
    filters.from?.takeIf { it.isNotEmpty() }?.let { params["from"] = it }
    filters.to?.takeIf { it.isNotEmpty() }?.let { params["to"] = it }
    filters.read?.let { params["read"] = it.toString() }
    filters.archived?.let { params["archived"] = it.toString() }
    filters.q?.takeIf { it.isNotEmpty() }?.let { params["q"] = it }
    filters.groupKey?.takeIf { it.isNotEmpty() }?.let { params["group_key"] = it }
    filters.limit?.let { params["limit"] = it.toString() }
    filters.offset?.let { params["offset"] = it.toString() }
    return params
}

/**
 * The grouped-inbox query params — the port of the web `useNotificationGroups`: `grouped=true`
 * FIRST (web puts it before the serialized tail), then the [notificationFilterParams] of the
 * filters with `group_key` cleared (web deletes `group_key` before serializing, mirroring the
 * backend's mutual-exclusion contract). A pure function — golden-locked (ADR-004).
 */
public fun notificationGroupsParams(filters: NotificationFilters): Map<String, String> {
    val params = linkedMapOf("grouped" to "true")
    params.putAll(notificationFilterParams(filters.copy(groupKey = null)))
    return params
}

/**
 * The deterministic feed/cache-key suffix for a filter set — `notificationFilterParams` flattened
 * to a stable `k=v&k=v` string (empty when no params). The web keys the TanStack cache on the
 * filters OBJECT; this canonical, order-stable string is the cross-platform equivalent so two
 * structurally-equal filter sets fold into one feed.
 */
public fun notificationFilterKey(filters: NotificationFilters): String =
    notificationFilterParams(filters).entries.joinToString("&") { "${it.key}=${it.value}" }

// ── Mutation body builders (golden-locked derivations) ───────────────────────────

/**
 * The `POST /notifications/mark-read` body for the bulk variant — the port of the web
 * `useBulkMarkRead` `JSON.stringify(vars)`. Exactly one mutually-exclusive key is written: `ids`
 * (an array), `all` (the literal `true`), or `group_key` (a string). A pure function — golden-locked
 * so the C# and KMP ports cannot drift (ADR-004).
 */
public fun bulkMarkReadBody(vars: BulkMarkReadVars): JsonObject =
    when (vars) {
        is BulkMarkReadVars.Ids ->
            buildJsonObject {
                put("ids", buildJsonArray { vars.ids.forEach { add(JsonPrimitive(it)) } })
            }
        BulkMarkReadVars.All -> buildJsonObject { put("all", true) }
        is BulkMarkReadVars.Group -> buildJsonObject { put("group_key", vars.groupKey) }
    }

/**
 * The `POST /alerts/{id}/acknowledge` body — the port of the web `useAcknowledgeAlert`: `{ note }`
 * only when [note] is non-null AND its trimmed form is non-empty (the VERBATIM trimmed value is
 * sent), otherwise an empty object `{}` (the server applies its defaults). A pure function —
 * golden-locked (ADR-004).
 */
public fun acknowledgeBody(note: String?): JsonObject {
    val trimmed = note?.trim()
    return if (trimmed != null && trimmed.isNotEmpty()) {
        buildJsonObject { put("note", trimmed) }
    } else {
        buildJsonObject {}
    }
}

// ── Cache/feed key builders (mirror the web `notificationKeys`) ───────────────────

/** Cache/feed key for the alert inbox — the web `notificationKeys.alerts` (`['alerts']`). */
public fun alertsKey(): String = "alerts"

/** Cache/feed key for one alert's detail — the web `notificationKeys.alertDetail(id)`. */
public fun alertDetailKey(id: Long): String = "alert-detail:$id"

/** Cache/feed key for the alert-rule list — the web `notificationKeys.alertRules`. */
public fun alertRulesKey(): String = "alert-rules"

/** Cache/feed key for the computed-metric registry — the web `notificationKeys.alertMetrics`. */
public fun alertMetricsKey(): String = "alert-metrics"

/**
 * The shared prefix for every notification-log-family feed key (web `notificationKeys.logs`,
 * `['notification-logs']`). Invalidating this prefix fans across the flat list, grouped list, bell
 * preview, and unread count — exactly the web prefix-invalidation behaviour.
 */
public const val NOTIFICATION_LOGS_PREFIX: String = "notification-logs:"

/** Cache/feed key for a filtered flat inbox — the web `notificationKeys.logsFiltered(filters)`. */
public fun notificationLogsKey(filters: NotificationFilters): String =
    "${NOTIFICATION_LOGS_PREFIX}filtered:${notificationFilterKey(filters)}"

/** Cache/feed key for a grouped inbox — the web `notificationKeys.groups(sanitizedFilters)`. */
public fun notificationGroupsKey(filters: NotificationFilters): String =
    "${NOTIFICATION_LOGS_PREFIX}groups:${notificationFilterKey(filters.copy(groupKey = null))}"

/** Cache/feed key for the bell preview at [limit] — the web `notificationKeys.bellUnread(limit)`. */
public fun bellUnreadKey(limit: Int): String = "${NOTIFICATION_LOGS_PREFIX}bell-unread:$limit"

/** Cache/feed key for the unread badge count — the web `notificationKeys.unreadCount`. */
public fun unreadCountKey(): String = "${NOTIFICATION_LOGS_PREFIX}unread-count"

/** Cache/feed key for notification stats — the web `notificationKeys.stats`. */
public fun notificationStatsKey(): String = "notification-stats"

/** Cache/feed key for the DND windows — the web `notificationKeys.quietHours`. */
public fun quietHoursKey(): String = "notification-quiet-hours"
