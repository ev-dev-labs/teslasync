package io.teslasync.shared.core.data.repo

import io.ktor.http.ContentType
import io.ktor.http.content.TextContent
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import io.teslasync.shared.core.presentation.notifications.Alert
import io.teslasync.shared.core.presentation.notifications.AlertDetail
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.notifications.AlertRuleInput
import io.teslasync.shared.core.presentation.notifications.AlertRuleSaveRequest
import io.teslasync.shared.core.presentation.notifications.AlertRuleSnoozeRequest
import io.teslasync.shared.core.presentation.notifications.AlertRuleUpdate
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
import io.teslasync.shared.core.presentation.notifications.QuietHoursListResponse
import io.teslasync.shared.core.presentation.notifications.QuietHoursWindow
import io.teslasync.shared.core.presentation.notifications.QuietHoursWindowInput
import io.teslasync.shared.core.presentation.notifications.UnreadCountResponse
import io.teslasync.shared.core.presentation.notifications.UpdatedCountResult
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * HTTP-backed [NotificationsRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). Every read shares the single [CacheDomain.Notifications] partition, keyed by a stable
 * per-feed string (the key builders in NotificationsRepository.kt) that mirrors the web TanStack
 * query keys. Because the domain has many distinct read shapes, the cache layer stores each feed's
 * raw [JsonElement] (the same verbatim-SI strategy as the Admin/Automations/NotificationChannels
 * ports) via [CachingRepository] of [JsonElement], and each read decodes that element to its typed
 * model on every emission through [decode]; a typed decode failure on the fresh value surfaces as
 * [Resource.Error] (never a thrown exception that would cancel the flow before the next refresh),
 * and a failure decoding a cached value degrades that slot to `null` so a schema-drifted cache can
 * never brick the network reload.
 *
 * The mutations call the API directly and return a non-throwing [Result]. They do NOT evict the
 * durable cache: the cache-then-network operator always re-fetches when the S8 store bumps the
 * affected feed's trigger (the `invalidateQueries` analogue), so the previous rows stay visible
 * during the reload while no stale value is ever served as fresh. Create/update bodies are
 * serialized through the id-free input hierarchies (alert-rule, channel, quiet-hours) so the strict
 * `DisallowUnknownFields` backend can never reject them. Bodies are written as exact JSON bytes via
 * [TextContent] for byte-for-byte parity with the web `JSON.stringify` payloads.
 */
public class HttpNotificationsRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    private val json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    NotificationsRepository {
    override val domain: CacheDomain = CacheDomain.Notifications

    // ---- Reads --------------------------------------------------------------------

    override fun alerts(): Flow<Resource<List<Alert>>> =
        observe(alertsKey()) { safeArray(api.request<JsonElement>(path = "/alerts")) }
            .decode(ListSerializer(Alert.serializer()))

    override fun alertDetail(id: Long): Flow<Resource<AlertDetail>> =
        observe(alertDetailKey(id)) { api.request<JsonElement>(path = "/alerts/$id") }
            .decode(AlertDetail.serializer())

    override fun alertRules(): Flow<Resource<List<AlertRule>>> =
        observe(alertRulesKey()) { safeArray(api.request<JsonElement>(path = "/alerts/rules")) }
            .decode(ListSerializer(AlertRule.serializer()))

    override fun alertMetrics(): Flow<Resource<List<ComputedMetricSummary>>> =
        observe(alertMetricsKey()) { safeArray(api.request<JsonElement>(path = "/alerts/metrics")) }
            .decode(ListSerializer(ComputedMetricSummary.serializer()))

    override fun notificationChannels(): Flow<Resource<List<NotificationChannel>>> =
        observe(channelsKey()) { safeArray(api.request<JsonElement>(path = "/notifications")) }
            .decode(ListSerializer(NotificationChannel.serializer()))

    override fun notificationLogs(filters: NotificationFilters): Flow<Resource<List<NotificationLog>>> =
        observe(notificationLogsKey(filters)) {
            safeArray(api.request<JsonElement>(path = "/notifications/logs", query = notificationFilterParams(filters)))
        }.decode(ListSerializer(NotificationLog.serializer()))

    override fun notificationGroups(filters: NotificationFilters): Flow<Resource<List<NotificationLogGroup>>> =
        observe(notificationGroupsKey(filters)) {
            safeArray(api.request<JsonElement>(path = "/notifications/logs", query = notificationGroupsParams(filters)))
        }.decode(ListSerializer(NotificationLogGroup.serializer()))

    override fun groupMembers(
        groupKey: String,
        filters: NotificationFilters,
    ): Flow<Resource<List<NotificationLog>>> {
        // Reuses the flat-list endpoint AND its cache key with `group_key` merged in (web
        // `useGroupMembers` keys on `logsFiltered(merged)`), so an expand-row payload dedupes with a
        // matching flat list.
        val merged = filters.copy(groupKey = groupKey)
        return observe(notificationLogsKey(merged)) {
            safeArray(api.request<JsonElement>(path = "/notifications/logs", query = notificationFilterParams(merged)))
        }.decode(ListSerializer(NotificationLog.serializer()))
    }

    override fun unreadCount(): Flow<Resource<UnreadCountResponse>> =
        observe(unreadCountKey()) { api.request<JsonElement>(path = "/notifications/unread-count") }
            .decode(UnreadCountResponse.serializer())

    override fun unreadNotifications(limit: Int): Flow<Resource<List<NotificationLog>>> {
        val bounded = if (limit < NotificationsRepository.MIN_BELL_LIMIT) NotificationsRepository.MIN_BELL_LIMIT else limit
        val query = linkedMapOf("read" to "false", "archived" to "false", "limit" to bounded.toString())
        return observe(bellUnreadKey(bounded)) {
            safeArray(api.request<JsonElement>(path = "/notifications/logs", query = query))
        }.decode(ListSerializer(NotificationLog.serializer()))
    }

    override fun notificationStats(): Flow<Resource<NotificationStats>> =
        observe(notificationStatsKey()) { api.request<JsonElement>(path = "/notifications/stats") }
            .decode(NotificationStats.serializer())

    override fun quietHours(): Flow<Resource<List<QuietHoursWindow>>> =
        observe(quietHoursKey()) { api.request<JsonElement>(path = "/notifications/quiet-hours") }
            .decode(QuietHoursListResponse.serializer())
            // web `select: (r) => safeArray(r?.windows)` — unwrap the envelope on every emission.
            .map { it.mapData { envelope -> envelope.windows } }

    // ---- Mutations: alerts --------------------------------------------------------

    override suspend fun markAlertRead(id: Long): Result<Unit> =
        api.safeRequest<String>(method = HttpMethodKind.POST, path = "/alerts/$id/read").map { }

    override suspend fun acknowledgeAlert(
        id: Long,
        note: String?,
    ): Result<AlertDetail> =
        api.safeRequest<AlertDetail>(
            method = HttpMethodKind.POST,
            path = "/alerts/$id/acknowledge",
            body = jsonBody(acknowledgeBody(note)),
        )

    override suspend fun commentAlert(
        id: Long,
        note: String,
    ): Result<AlertDetail> {
        val body = buildJsonObject { put("note", note.trim()) }
        return api.safeRequest<AlertDetail>(
            method = HttpMethodKind.POST,
            path = "/alerts/$id/comment",
            body = jsonBody(body),
        )
    }

    override suspend fun reopenAlert(id: Long): Result<AlertDetail> =
        api.safeRequest<AlertDetail>(method = HttpMethodKind.POST, path = "/alerts/$id/reopen")

    // ---- Mutations: alert rules ---------------------------------------------------

    override suspend fun saveAlertRule(request: AlertRuleSaveRequest): Result<AlertRule> =
        when (request) {
            is AlertRuleSaveRequest.Create ->
                api.safeRequest<AlertRule>(
                    method = HttpMethodKind.POST,
                    path = "/alerts/rules",
                    body = textBody(json.encodeToString(AlertRuleInput.serializer(), request.input)),
                )
            is AlertRuleSaveRequest.Update ->
                api.safeRequest<AlertRule>(
                    method = HttpMethodKind.PUT,
                    path = "/alerts/rules/${request.id}",
                    body = textBody(json.encodeToString(AlertRuleUpdate.serializer(), request.patch)),
                )
        }

    override suspend fun deleteAlertRule(id: Long): Result<Unit> =
        api.safeRequest<String>(method = HttpMethodKind.DELETE, path = "/alerts/rules/$id").map { }

    override suspend fun toggleAlertRule(
        id: Long,
        enabled: Boolean,
    ): Result<AlertRule> {
        val body = buildJsonObject { put("enabled", enabled) }
        return api.safeRequest<AlertRule>(method = HttpMethodKind.PUT, path = "/alerts/rules/$id", body = jsonBody(body))
    }

    override suspend fun bulkEnableRules(ids: List<Long>): Result<BulkRulesResult> =
        api.safeRequest<BulkRulesResult>(
            method = HttpMethodKind.POST,
            path = "/alerts/rules/bulk/enable",
            body = jsonBody(idsBody(ids)),
        )

    override suspend fun bulkDisableRules(ids: List<Long>): Result<BulkRulesResult> =
        api.safeRequest<BulkRulesResult>(
            method = HttpMethodKind.POST,
            path = "/alerts/rules/bulk/disable",
            body = jsonBody(idsBody(ids)),
        )

    override suspend fun testAlertRule(request: AlertTestRequest): Result<Unit> =
        api
            .safeRequest<String>(
                method = HttpMethodKind.POST,
                path = "/alerts/test",
                body = textBody(json.encodeToString(AlertTestRequest.serializer(), request)),
            ).map { }

    override suspend fun snoozeAlertRule(
        id: Long,
        request: AlertRuleSnoozeRequest,
    ): Result<AlertRule> =
        api.safeRequest<AlertRule>(
            method = HttpMethodKind.POST,
            path = "/alerts/rules/$id/snooze",
            body = textBody(json.encodeToString(AlertRuleSnoozeRequest.serializer(), request)),
        )

    override suspend fun previewComputedMetric(input: ComputedMetricPreviewInput): Result<ComputedMetricPreview> =
        api.safeRequest<ComputedMetricPreview>(
            method = HttpMethodKind.POST,
            path = "/alerts/test",
            body = textBody(json.encodeToString(ComputedMetricPreviewInput.serializer(), input)),
        )

    // ---- Mutations: notifications inbox -------------------------------------------

    override suspend fun markNotificationsRead(ids: List<Long>): Result<UpdatedCountResult> =
        api.safeRequest<UpdatedCountResult>(
            method = HttpMethodKind.POST,
            path = "/notifications/mark-read",
            body = jsonBody(idsBody(ids)),
        )

    override suspend fun bulkMarkRead(vars: BulkMarkReadVars): Result<UpdatedCountResult> =
        api.safeRequest<UpdatedCountResult>(
            method = HttpMethodKind.POST,
            path = "/notifications/mark-read",
            body = jsonBody(bulkMarkReadBody(vars)),
        )

    override suspend fun markNotificationsUnread(ids: List<Long>): Result<UpdatedCountResult> =
        api.safeRequest<UpdatedCountResult>(
            method = HttpMethodKind.POST,
            path = "/notifications/mark-unread",
            body = jsonBody(idsBody(ids)),
        )

    override suspend fun archiveNotifications(ids: List<Long>): Result<UpdatedCountResult> =
        api.safeRequest<UpdatedCountResult>(
            method = HttpMethodKind.POST,
            path = "/notifications/archive",
            body = jsonBody(idsBody(ids)),
        )

    override suspend fun unarchiveNotifications(ids: List<Long>): Result<UpdatedCountResult> =
        api.safeRequest<UpdatedCountResult>(
            method = HttpMethodKind.POST,
            path = "/notifications/unarchive",
            body = jsonBody(idsBody(ids)),
        )

    override suspend fun deleteNotifications(ids: List<Long>): Result<DeletedCountResult> =
        api.safeRequest<DeletedCountResult>(
            method = HttpMethodKind.DELETE,
            path = "/notifications/logs",
            body = jsonBody(idsBody(ids)),
        )

    // ---- Mutations: channels ------------------------------------------------------

    override suspend fun saveChannel(input: NotificationChannelInput): Result<NotificationChannel> {
        val body = textBody(json.encodeToString(NotificationChannelInput.serializer(), input))
        val id = input.id
        return if (id != null) {
            api.safeRequest<NotificationChannel>(method = HttpMethodKind.PUT, path = "/notifications/$id", body = body)
        } else {
            api.safeRequest<NotificationChannel>(method = HttpMethodKind.POST, path = "/notifications", body = body)
        }
    }

    override suspend fun deleteChannel(id: Long): Result<Unit> =
        api.safeRequest<String>(method = HttpMethodKind.DELETE, path = "/notifications/$id").map { }

    override suspend fun toggleChannel(id: Long): Result<NotificationChannel> =
        api.safeRequest<NotificationChannel>(method = HttpMethodKind.POST, path = "/notifications/$id/toggle")

    override suspend fun testChannel(id: Long): Result<ChannelTestResult> =
        api.safeRequest<ChannelTestResult>(method = HttpMethodKind.POST, path = "/notifications/$id/test")

    // ---- Mutations: quiet hours ---------------------------------------------------

    override suspend fun saveQuietHours(
        input: QuietHoursWindowInput,
        id: Long?,
    ): Result<QuietHoursWindow> {
        val body = textBody(json.encodeToString(QuietHoursWindowInput.serializer(), input))
        val isUpdate = id != null && id > 0
        return if (isUpdate) {
            api.safeRequest<QuietHoursWindow>(method = HttpMethodKind.PATCH, path = "/notifications/quiet-hours/$id", body = body)
        } else {
            api.safeRequest<QuietHoursWindow>(method = HttpMethodKind.POST, path = "/notifications/quiet-hours", body = body)
        }
    }

    override suspend fun deleteQuietHours(id: Long): Result<Unit> =
        api.safeRequest<String>(method = HttpMethodKind.DELETE, path = "/notifications/quiet-hours/$id").map { }

    // ---- Internals ----------------------------------------------------------------

    /** Maps a raw-JSON cache-then-network feed onto its typed model, guarding every decode. */
    private fun <T> Flow<Resource<JsonElement>>.decode(serializer: KSerializer<T>): Flow<Resource<T>> =
        map { resource -> resource.decodeTo(serializer) }

    private fun <T> Resource<JsonElement>.decodeTo(serializer: KSerializer<T>): Resource<T> =
        when (this) {
            is Resource.Loading -> Resource.Loading(cached?.let { tryDecode(serializer, it) }, fetchedAt, stale)
            is Resource.Error -> Resource.Error(cached?.let { tryDecode(serializer, it) }, fetchedAt, stale, error)
            is Resource.Success ->
                runCatching { json.decodeFromJsonElement(serializer, data) }.fold(
                    onSuccess = { Resource.Success(it, fetchedAt, stale) },
                    // A 2xx body that no longer matches the DTO is a contract error, not a transport
                    // one — surface it without throwing across the flow boundary.
                    onFailure = { Resource.Error(cached = null, fetchedAt = fetchedAt, stale = false, error = it) },
                )
        }

    /** A schema-drifted cached slot degrades to `null` rather than bricking the refresh. */
    private fun <T> tryDecode(
        serializer: KSerializer<T>,
        element: JsonElement,
    ): T? = runCatching { json.decodeFromJsonElement(serializer, element) }.getOrNull()

    /** Maps a [Resource]'s `data` and `cached` slots through [f], preserving freshness flags. */
    private fun <A, B> Resource<A>.mapData(f: (A) -> B): Resource<B> =
        when (this) {
            is Resource.Loading -> Resource.Loading(cached?.let(f), fetchedAt, stale)
            is Resource.Success -> Resource.Success(f(data), fetchedAt, stale)
            is Resource.Error -> Resource.Error(cached?.let(f), fetchedAt, stale, error)
        }

    /** The shared `{ ids: [...] }` body used by the bulk-rule and notification mutations. */
    private fun idsBody(ids: List<Long>): JsonObject =
        buildJsonObject {
            put("ids", JsonArray(ids.map { JsonPrimitive(it) }))
        }

    /**
     * Wraps an already-built [JsonObject] as [TextContent] so its exact, compact JSON bytes reach
     * the wire unchanged — byte-for-byte parity with the web `JSON.stringify` bodies.
     */
    private fun jsonBody(obj: JsonObject): TextContent = TextContent(obj.toString(), ContentType.Application.Json)

    /** Wraps already-serialized JSON text as the request body with the JSON content type. */
    private fun textBody(text: String): TextContent = TextContent(text, ContentType.Application.Json)
}
