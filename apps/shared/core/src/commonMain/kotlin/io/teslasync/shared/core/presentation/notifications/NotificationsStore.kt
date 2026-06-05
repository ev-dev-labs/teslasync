package io.teslasync.shared.core.presentation.notifications

import io.teslasync.shared.core.data.repo.NOTIFICATION_LOGS_PREFIX
import io.teslasync.shared.core.data.repo.NotificationFilters
import io.teslasync.shared.core.data.repo.NotificationsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.alertDetailKey
import io.teslasync.shared.core.data.repo.alertMetricsKey
import io.teslasync.shared.core.data.repo.alertRulesKey
import io.teslasync.shared.core.data.repo.alertsKey
import io.teslasync.shared.core.data.repo.bellUnreadKey
import io.teslasync.shared.core.data.repo.channelsKey
import io.teslasync.shared.core.data.repo.notificationGroupsKey
import io.teslasync.shared.core.data.repo.notificationLogsKey
import io.teslasync.shared.core.data.repo.notificationStatsKey
import io.teslasync.shared.core.data.repo.quietHoursKey
import io.teslasync.shared.core.data.repo.unreadCountKey
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for the whole Notifications control plane — the cross-platform port of
 * the web `useNotifications` hook domain (web/src/api/hooks/useNotifications.ts). Every native
 * Notifications screen (Android/Apple via KMP, Windows via the C# port) binds to this single holder
 * rather than re-implementing endpoints, query keys, or invalidation rules.
 *
 * Reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013): each is lazily
 * created on first access, shared so every observer of the same `(feed, params)` folds into one
 * upstream collection, and refreshable. The mutations are non-throwing suspend [Result]s; on success
 * each refreshes EXACTLY the feeds the matching web hook invalidates via `invalidateQueries`:
 *  - mark-read / acknowledge / reopen   → the alert inbox (+ that alert's detail for ack/reopen);
 *  - comment                            → that alert's detail only;
 *  - save / delete / toggle / bulk /
 *    snooze rule                        → the alert-rule list;
 *  - test rule / preview metric         → nothing (the screen renders the result inline);
 *  - any inbox write (read/unread/
 *    archive/unarchive/delete)          → every notification-log-family feed (flat list, grouped,
 *                                         bell preview, unread count) via the
 *                                         `['notification-logs']` prefix;
 *  - save channel                       → the channel list;
 *  - delete / toggle channel            → the channel list + stats;
 *  - test channel                       → nothing;
 *  - save / delete quiet-hours          → the quiet-hours list.
 *
 * Refreshing re-collects the cache-then-network feed, which always re-fetches while replaying the
 * last cached rows first (the web behaviour of keeping prior data during a refetch). The holder makes
 * no network calls itself — it delegates entirely to the injected [NotificationsRepository] (S7). A
 * feed nobody is observing is a no-op to refresh.
 *
 * Optimistic UI (the web inbox's instant row updates) and toasts are render-layer concerns and are
 * intentionally NOT reproduced here. This holder mirrors the web hook's single-threaded usage and is
 * not internally synchronised; create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port every feed and mutation is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class NotificationsStore(
    private val repo: NotificationsRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val alertFeeds = mutableMapOf<String, StateFlow<Resource<List<Alert>>>>()
    private val alertDetailFeeds = mutableMapOf<String, StateFlow<Resource<AlertDetail>>>()
    private val alertRuleFeeds = mutableMapOf<String, StateFlow<Resource<List<AlertRule>>>>()
    private val metricFeeds = mutableMapOf<String, StateFlow<Resource<List<ComputedMetricSummary>>>>()
    private val channelFeeds = mutableMapOf<String, StateFlow<Resource<List<NotificationChannel>>>>()
    private val logFeeds = mutableMapOf<String, StateFlow<Resource<List<NotificationLog>>>>()
    private val groupFeeds = mutableMapOf<String, StateFlow<Resource<List<NotificationLogGroup>>>>()
    private val unreadCountFeeds = mutableMapOf<String, StateFlow<Resource<Int>>>()
    private val statsFeeds = mutableMapOf<String, StateFlow<Resource<NotificationStats>>>()
    private val quietHoursFeeds = mutableMapOf<String, StateFlow<Resource<List<QuietHoursWindow>>>>()

    // ---- Reads --------------------------------------------------------------------

    /** Shared, refreshable `GET /alerts` feed (web `useAlerts`). */
    public fun alerts(): StateFlow<Resource<List<Alert>>> = feed(alertsKey(), alertFeeds) { repo.alerts() }

    /** Shared, refreshable `GET /alerts/{id}` feed (web `useAlertDetail`). */
    public fun alertDetail(id: Long): StateFlow<Resource<AlertDetail>> = feed(alertDetailKey(id), alertDetailFeeds) { repo.alertDetail(id) }

    /** Shared, refreshable `GET /alerts/rules` feed (web `useAlertRules`). */
    public fun alertRules(): StateFlow<Resource<List<AlertRule>>> = feed(alertRulesKey(), alertRuleFeeds) { repo.alertRules() }

    /** Shared, refreshable `GET /alerts/metrics` feed (web `useAlertMetrics`). */
    public fun alertMetrics(): StateFlow<Resource<List<ComputedMetricSummary>>> =
        feed(alertMetricsKey(), metricFeeds) { repo.alertMetrics() }

    /** Shared, refreshable `GET /notifications` channel-list feed (web `useNotificationChannels`). */
    public fun notificationChannels(): StateFlow<Resource<List<NotificationChannel>>> =
        feed(channelsKey(), channelFeeds) { repo.notificationChannels() }

    /** Shared, refreshable `GET /notifications/logs?<filters>` feed (web `useNotificationLogs`). */
    public fun notificationLogs(filters: NotificationFilters = NotificationFilters()): StateFlow<Resource<List<NotificationLog>>> =
        feed(notificationLogsKey(filters), logFeeds) { repo.notificationLogs(filters) }

    /** Shared, refreshable `GET /notifications/logs?grouped=true&<filters>` feed (web `useNotificationGroups`). */
    public fun notificationGroups(filters: NotificationFilters = NotificationFilters()): StateFlow<Resource<List<NotificationLogGroup>>> =
        feed(notificationGroupsKey(filters), groupFeeds) { repo.notificationGroups(filters) }

    /**
     * Shared, refreshable thread-members feed (web `useGroupMembers`). Reuses the flat-list feed key
     * (`notificationLogsKey(filters + group_key)`) so it folds into a matching [notificationLogs]
     * observation.
     */
    public fun groupMembers(
        groupKey: String,
        filters: NotificationFilters = NotificationFilters(),
    ): StateFlow<Resource<List<NotificationLog>>> =
        feed(notificationLogsKey(filters.copy(groupKey = groupKey)), logFeeds) { repo.groupMembers(groupKey, filters) }

    /** Shared, refreshable `GET /notifications/unread-count` feed, mapped to the count (web `useUnreadCount`). */
    public fun unreadCount(): StateFlow<Resource<Int>> =
        feed(unreadCountKey(), unreadCountFeeds) { repo.unreadCount().map { it.mapData { r -> r.count } } }

    /** Shared, refreshable bell-preview feed (web `useUnreadNotifications`). */
    public fun unreadNotifications(limit: Int): StateFlow<Resource<List<NotificationLog>>> {
        val bounded = if (limit < NotificationsRepository.MIN_BELL_LIMIT) NotificationsRepository.MIN_BELL_LIMIT else limit
        return feed(bellUnreadKey(bounded), logFeeds) { repo.unreadNotifications(bounded) }
    }

    /** Shared, refreshable `GET /notifications/stats` feed (web `useNotificationStats`). */
    public fun notificationStats(): StateFlow<Resource<NotificationStats>> =
        feed(notificationStatsKey(), statsFeeds) { repo.notificationStats() }

    /** Shared, refreshable `GET /notifications/quiet-hours` feed (web `useQuietHours`). */
    public fun quietHours(): StateFlow<Resource<List<QuietHoursWindow>>> = feed(quietHoursKey(), quietHoursFeeds) { repo.quietHours() }

    // ---- Mutations: alerts --------------------------------------------------------

    /** Marks an alert read, then refreshes the inbox (web `useMarkAlertRead`). */
    public suspend fun markAlertRead(id: Long): Result<Unit> = repo.markAlertRead(id).onSuccess { refresh(alertsKey()) }

    /** Acknowledges an alert, then refreshes the inbox + that alert's detail (web `useAcknowledgeAlert`). */
    public suspend fun acknowledgeAlert(
        id: Long,
        note: String? = null,
    ): Result<AlertDetail> =
        repo.acknowledgeAlert(id, note).onSuccess {
            refresh(alertsKey())
            refresh(alertDetailKey(id))
        }

    /** Appends a comment, then refreshes that alert's detail only (web `useCommentAlert`). */
    public suspend fun commentAlert(
        id: Long,
        note: String,
    ): Result<AlertDetail> = repo.commentAlert(id, note).onSuccess { refresh(alertDetailKey(id)) }

    /** Reopens an alert, then refreshes the inbox + that alert's detail (web `useReopenAlert`). */
    public suspend fun reopenAlert(id: Long): Result<AlertDetail> =
        repo.reopenAlert(id).onSuccess {
            refresh(alertsKey())
            refresh(alertDetailKey(id))
        }

    // ---- Mutations: alert rules ---------------------------------------------------

    /** Creates/updates an alert rule, then refreshes the rule list (web `useSaveAlertRule`). */
    public suspend fun saveAlertRule(request: AlertRuleSaveRequest): Result<AlertRule> =
        repo.saveAlertRule(request).onSuccess { refresh(alertRulesKey()) }

    /** Deletes an alert rule, then refreshes the rule list (web `useDeleteAlertRule`). */
    public suspend fun deleteAlertRule(id: Long): Result<Unit> = repo.deleteAlertRule(id).onSuccess { refresh(alertRulesKey()) }

    /** Toggles an alert rule, then refreshes the rule list (web `useToggleAlertRule`). */
    public suspend fun toggleAlertRule(
        id: Long,
        enabled: Boolean,
    ): Result<AlertRule> = repo.toggleAlertRule(id, enabled).onSuccess { refresh(alertRulesKey()) }

    /** Bulk-enables alert rules, then refreshes the rule list (web `useBulkEnableRules`). */
    public suspend fun bulkEnableRules(ids: List<Long>): Result<BulkRulesResult> =
        repo.bulkEnableRules(ids).onSuccess { refresh(alertRulesKey()) }

    /** Bulk-disables alert rules, then refreshes the rule list (web `useBulkDisableRules`). */
    public suspend fun bulkDisableRules(ids: List<Long>): Result<BulkRulesResult> =
        repo.bulkDisableRules(ids).onSuccess { refresh(alertRulesKey()) }

    /** Sends a test alert; invalidates nothing (web `useTestAlertRule`). */
    public suspend fun testAlertRule(request: AlertTestRequest): Result<Unit> = repo.testAlertRule(request)

    /** Snoozes/unsnoozes a rule, then refreshes the rule list (web `useSnoozeAlertRule`). */
    public suspend fun snoozeAlertRule(
        id: Long,
        request: AlertRuleSnoozeRequest,
    ): Result<AlertRule> = repo.snoozeAlertRule(id, request).onSuccess { refresh(alertRulesKey()) }

    /** Previews a computed metric; invalidates nothing (web `usePreviewComputedMetric`). */
    public suspend fun previewComputedMetric(input: ComputedMetricPreviewInput): Result<ComputedMetricPreview> =
        repo.previewComputedMetric(input)

    // ---- Mutations: notifications inbox -------------------------------------------

    /** Marks notifications read, then refreshes the whole log family (web `useMarkNotificationsRead`). */
    public suspend fun markNotificationsRead(ids: List<Long>): Result<UpdatedCountResult> =
        repo.markNotificationsRead(ids).onSuccess { refreshLogsFamily() }

    /** Bulk mark-read (ids/all/group), then refreshes the whole log family (web `useBulkMarkRead`). */
    public suspend fun bulkMarkRead(vars: BulkMarkReadVars): Result<UpdatedCountResult> =
        repo.bulkMarkRead(vars).onSuccess { refreshLogsFamily() }

    /** Marks notifications unread, then refreshes the whole log family (web `useMarkNotificationsUnread`). */
    public suspend fun markNotificationsUnread(ids: List<Long>): Result<UpdatedCountResult> =
        repo.markNotificationsUnread(ids).onSuccess { refreshLogsFamily() }

    /** Archives notifications, then refreshes the whole log family (web `useArchiveNotifications`). */
    public suspend fun archiveNotifications(ids: List<Long>): Result<UpdatedCountResult> =
        repo.archiveNotifications(ids).onSuccess { refreshLogsFamily() }

    /** Unarchives notifications, then refreshes the whole log family (web `useUnarchiveNotifications`). */
    public suspend fun unarchiveNotifications(ids: List<Long>): Result<UpdatedCountResult> =
        repo.unarchiveNotifications(ids).onSuccess { refreshLogsFamily() }

    /** Deletes notifications, then refreshes the whole log family (web `useDeleteNotifications`). */
    public suspend fun deleteNotifications(ids: List<Long>): Result<DeletedCountResult> =
        repo.deleteNotifications(ids).onSuccess { refreshLogsFamily() }

    // ---- Mutations: channels ------------------------------------------------------

    /** Creates/updates a channel, then refreshes the channel list (web `useSaveChannel`). */
    public suspend fun saveChannel(input: NotificationChannelInput): Result<NotificationChannel> =
        repo.saveChannel(input).onSuccess { refresh(channelsKey()) }

    /** Deletes a channel, then refreshes the channel list + stats (web `useDeleteChannel`). */
    public suspend fun deleteChannel(id: Long): Result<Unit> =
        repo.deleteChannel(id).onSuccess {
            refresh(channelsKey())
            refresh(notificationStatsKey())
        }

    /** Toggles a channel, then refreshes the channel list + stats (web `useToggleChannel`). */
    public suspend fun toggleChannel(id: Long): Result<NotificationChannel> =
        repo.toggleChannel(id).onSuccess {
            refresh(channelsKey())
            refresh(notificationStatsKey())
        }

    /** Sends a channel test; invalidates nothing (web `useTestChannel`). */
    public suspend fun testChannel(id: Long): Result<ChannelTestResult> = repo.testChannel(id)

    // ---- Mutations: quiet hours ---------------------------------------------------

    /** Creates/updates a quiet-hours window, then refreshes the list (web `useSaveQuietHours`). */
    public suspend fun saveQuietHours(
        input: QuietHoursWindowInput,
        id: Long? = null,
    ): Result<QuietHoursWindow> = repo.saveQuietHours(input, id).onSuccess { refresh(quietHoursKey()) }

    /** Deletes a quiet-hours window, then refreshes the list (web `useDeleteQuietHours`). */
    public suspend fun deleteQuietHours(id: Long): Result<Unit> = repo.deleteQuietHours(id).onSuccess { refresh(quietHoursKey()) }

    // ---- Internals ----------------------------------------------------------------

    /**
     * Returns the shared [StateFlow] for [key], creating it on first access. The feed is a
     * `trigger ▸ flatMapLatest(source) ▸ stateIn` pipeline: bumping the trigger restarts the
     * underlying cache-then-network collection ([refresh]), and [SharingStarted.WhileSubscribed]
     * keeps a single upstream shared across observers while at least one is active.
     */
    private fun <T> feed(
        key: String,
        feeds: MutableMap<String, StateFlow<Resource<T>>>,
        source: () -> Flow<Resource<T>>,
    ): StateFlow<Resource<T>> =
        feeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { source() }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = Resource.Loading(cached = null, fetchedAt = null, stale = false),
                )
        }

    /** Re-fetches [key]'s feed if it is being observed; a no-op for a feed nobody has opened. */
    private fun refresh(key: String) {
        triggers[key]?.update { it + 1 }
    }

    /**
     * Re-fetches EVERY observed notification-log-family feed — the holder-side analogue of the web
     * inbox mutations invalidating the `['notification-logs']` prefix (flat list, grouped list, bell
     * preview, AND unread count at once). The keys are snapshotted before iterating so a concurrent
     * feed creation cannot disturb the walk.
     */
    private fun refreshLogsFamily() {
        triggers.keys
            .filter { it.startsWith(NOTIFICATION_LOGS_PREFIX) }
            .toList()
            .forEach(::refresh)
    }

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    /** Maps a [Resource]'s `data` and `cached` slots through [f], preserving freshness flags. */
    private fun <A, B> Resource<A>.mapData(f: (A) -> B): Resource<B> =
        when (this) {
            is Resource.Loading -> Resource.Loading(cached?.let(f), fetchedAt, stale)
            is Resource.Success -> Resource.Success(f(data), fetchedAt, stale)
            is Resource.Error -> Resource.Error(cached?.let(f), fetchedAt, stale, error)
        }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
