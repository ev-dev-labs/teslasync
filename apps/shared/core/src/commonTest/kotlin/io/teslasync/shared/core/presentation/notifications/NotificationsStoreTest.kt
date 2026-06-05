package io.teslasync.shared.core.presentation.notifications

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
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Verifies the S8 [NotificationsStore] folds the S7 [NotificationsRepository] into shared,
 * refreshable typed feeds and routes each mutation to the right repository call + the web-faithful
 * targeted refresh (the `invalidateQueries` analogue) — using a fake repository, so no network or
 * cache is involved.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NotificationsStoreTest {
    /**
     * Fake S7 port: every read re-counts its collections per feed key (so a refresh is observable)
     * and emits Loading→Success with a deterministic value; every mutation records its argument and
     * succeeds.
     */
    private class FakeNotificationsRepository : NotificationsRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()
        val calls: MutableList<String> = mutableListOf()

        private fun <T> counting(
            key: String,
            value: (Int) -> T,
        ): Flow<Resource<T>> =
            flow {
                val n = (collections[key] ?: 0) + 1
                collections[key] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = value(n), fetchedAt = 1L, stale = false))
            }

        override fun alerts(): Flow<Resource<List<Alert>>> = counting(alertsKey()) { n -> listOf(Alert(id = n.toLong(), title = "a-$n")) }

        override fun alertDetail(id: Long): Flow<Resource<AlertDetail>> =
            counting(alertDetailKey(id)) { n -> AlertDetail(id = id, title = "d-$n") }

        override fun alertRules(): Flow<Resource<List<AlertRule>>> =
            counting(alertRulesKey()) { n -> listOf(AlertRule(id = n.toLong(), name = "r-$n")) }

        override fun alertMetrics(): Flow<Resource<List<ComputedMetricSummary>>> =
            counting(alertMetricsKey()) { _ -> listOf(ComputedMetricSummary(id = "m")) }

        override fun notificationChannels(): Flow<Resource<List<NotificationChannel>>> =
            counting(channelsKey()) { n -> listOf(NotificationChannel.Discord(id = n.toLong(), name = "c-$n")) }

        override fun notificationLogs(filters: NotificationFilters): Flow<Resource<List<NotificationLog>>> =
            counting(notificationLogsKey(filters)) { n -> listOf(NotificationLog(id = n.toLong(), title = "log-$n")) }

        override fun notificationGroups(filters: NotificationFilters): Flow<Resource<List<NotificationLogGroup>>> =
            counting(notificationGroupsKey(filters)) { n ->
                listOf(NotificationLogGroup(groupKey = "g$n", latest = NotificationLog(id = n.toLong())))
            }

        override fun groupMembers(
            groupKey: String,
            filters: NotificationFilters,
        ): Flow<Resource<List<NotificationLog>>> =
            counting(notificationLogsKey(filters.copy(groupKey = groupKey))) { n -> listOf(NotificationLog(id = n.toLong())) }

        override fun unreadCount(): Flow<Resource<UnreadCountResponse>> = counting(unreadCountKey()) { n -> UnreadCountResponse(count = n) }

        override fun unreadNotifications(limit: Int): Flow<Resource<List<NotificationLog>>> =
            counting(bellUnreadKey(limit)) { n -> listOf(NotificationLog(id = n.toLong())) }

        override fun notificationStats(): Flow<Resource<NotificationStats>> =
            counting(notificationStatsKey()) { n -> NotificationStats(sent = n.toLong()) }

        override fun quietHours(): Flow<Resource<List<QuietHoursWindow>>> =
            counting(quietHoursKey()) { n -> listOf(QuietHoursWindow(id = n.toLong())) }

        override suspend fun markAlertRead(id: Long): Result<Unit> {
            calls += "markAlertRead:$id"
            return Result.success(Unit)
        }

        override suspend fun acknowledgeAlert(
            id: Long,
            note: String?,
        ): Result<AlertDetail> {
            calls += "acknowledgeAlert:$id:$note"
            return Result.success(AlertDetail(id = id))
        }

        override suspend fun commentAlert(
            id: Long,
            note: String,
        ): Result<AlertDetail> {
            calls += "commentAlert:$id:$note"
            return Result.success(AlertDetail(id = id))
        }

        override suspend fun reopenAlert(id: Long): Result<AlertDetail> {
            calls += "reopenAlert:$id"
            return Result.success(AlertDetail(id = id))
        }

        override suspend fun saveAlertRule(request: AlertRuleSaveRequest): Result<AlertRule> {
            calls += "saveAlertRule:$request"
            return Result.success(AlertRule(id = 1))
        }

        override suspend fun deleteAlertRule(id: Long): Result<Unit> {
            calls += "deleteAlertRule:$id"
            return Result.success(Unit)
        }

        override suspend fun toggleAlertRule(
            id: Long,
            enabled: Boolean,
        ): Result<AlertRule> {
            calls += "toggleAlertRule:$id:$enabled"
            return Result.success(AlertRule(id = id, enabled = enabled))
        }

        override suspend fun bulkEnableRules(ids: List<Long>): Result<BulkRulesResult> {
            calls += "bulkEnableRules:$ids"
            return Result.success(BulkRulesResult(updated = ids.size))
        }

        override suspend fun bulkDisableRules(ids: List<Long>): Result<BulkRulesResult> {
            calls += "bulkDisableRules:$ids"
            return Result.success(BulkRulesResult(updated = ids.size))
        }

        override suspend fun testAlertRule(request: AlertTestRequest): Result<Unit> {
            calls += "testAlertRule"
            return Result.success(Unit)
        }

        override suspend fun snoozeAlertRule(
            id: Long,
            request: AlertRuleSnoozeRequest,
        ): Result<AlertRule> {
            calls += "snoozeAlertRule:$id:${request.minutes}"
            return Result.success(AlertRule(id = id))
        }

        override suspend fun previewComputedMetric(input: ComputedMetricPreviewInput): Result<ComputedMetricPreview> {
            calls += "previewComputedMetric:${input.metricId}"
            return Result.success(ComputedMetricPreview())
        }

        override suspend fun markNotificationsRead(ids: List<Long>): Result<UpdatedCountResult> {
            calls += "markNotificationsRead:$ids"
            return Result.success(UpdatedCountResult(updated = ids.size))
        }

        override suspend fun bulkMarkRead(vars: BulkMarkReadVars): Result<UpdatedCountResult> {
            calls += "bulkMarkRead:$vars"
            return Result.success(UpdatedCountResult(updated = 1))
        }

        override suspend fun markNotificationsUnread(ids: List<Long>): Result<UpdatedCountResult> {
            calls += "markNotificationsUnread:$ids"
            return Result.success(UpdatedCountResult(updated = ids.size))
        }

        override suspend fun archiveNotifications(ids: List<Long>): Result<UpdatedCountResult> {
            calls += "archiveNotifications:$ids"
            return Result.success(UpdatedCountResult(updated = ids.size))
        }

        override suspend fun unarchiveNotifications(ids: List<Long>): Result<UpdatedCountResult> {
            calls += "unarchiveNotifications:$ids"
            return Result.success(UpdatedCountResult(updated = ids.size))
        }

        override suspend fun deleteNotifications(ids: List<Long>): Result<DeletedCountResult> {
            calls += "deleteNotifications:$ids"
            return Result.success(DeletedCountResult(deleted = ids.size))
        }

        override suspend fun saveChannel(input: NotificationChannelInput): Result<NotificationChannel> {
            calls += "saveChannel:${input.id}"
            return Result.success(NotificationChannel.Discord(id = input.id ?: 1))
        }

        override suspend fun deleteChannel(id: Long): Result<Unit> {
            calls += "deleteChannel:$id"
            return Result.success(Unit)
        }

        override suspend fun toggleChannel(id: Long): Result<NotificationChannel> {
            calls += "toggleChannel:$id"
            return Result.success(NotificationChannel.Discord(id = id))
        }

        override suspend fun testChannel(id: Long): Result<ChannelTestResult> {
            calls += "testChannel:$id"
            return Result.success(ChannelTestResult(success = true))
        }

        override suspend fun saveQuietHours(
            input: QuietHoursWindowInput,
            id: Long?,
        ): Result<QuietHoursWindow> {
            calls += "saveQuietHours:$id"
            return Result.success(QuietHoursWindow(id = id ?: 1))
        }

        override suspend fun deleteQuietHours(id: Long): Result<Unit> {
            calls += "deleteQuietHours:$id"
            return Result.success(Unit)
        }
    }

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val store = NotificationsStore(FakeNotificationsRepository(), backgroundScope)
            val seen = mutableListOf<Resource<List<Alert>>>()
            backgroundScope.launch { store.alerts().collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals("a-1", last.data.first().title)
        }

    @Test
    fun unreadCountReadMapsEnvelopeToCount() =
        runTest {
            val store = NotificationsStore(FakeNotificationsRepository(), backgroundScope)
            val seen = mutableListOf<Resource<Int>>()
            backgroundScope.launch { store.unreadCount().collect { seen += it } }
            runCurrent()

            val last = seen.last()
            assertTrue(last is Resource.Success)
            assertEquals(1, last.data, "the {count} envelope is unwrapped to the bare count (web select)")
        }

    @Test
    fun sameKeySharesUpstreamAndDistinctKeysAreDistinctFeeds() =
        runTest {
            val store = NotificationsStore(FakeNotificationsRepository(), backgroundScope)
            assertSame(store.alerts(), store.alerts())
            assertSame(store.alertDetail(1), store.alertDetail(1))
            assertTrue(store.alertDetail(1) !== store.alertDetail(2))
            assertSame(store.notificationLogs(), store.notificationLogs())
            assertTrue(store.notificationLogs() !== store.notificationLogs(NotificationFilters(read = false)))
            // groupMembers reuses the flat-list feed key (filters + group_key), so it folds into the
            // matching notificationLogs observation (web `useGroupMembers` reuses `logsFiltered`).
            assertSame(
                store.notificationLogs(NotificationFilters(read = false, groupKey = "abc")),
                store.groupMembers("abc", NotificationFilters(read = false)),
            )
        }

    @Test
    fun markAlertReadRefreshesOnlyTheInbox() =
        runTest {
            val repo = FakeNotificationsRepository()
            val store = NotificationsStore(repo, backgroundScope)
            backgroundScope.launch { store.alerts().collect {} }
            backgroundScope.launch { store.alertRules().collect {} }
            runCurrent()
            assertEquals(1, repo.collections[alertsKey()])

            val result = store.markAlertRead(7)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf("markAlertRead:7"), repo.calls)
            assertEquals(2, repo.collections[alertsKey()])
            assertEquals(1, repo.collections[alertRulesKey()], "rule list is untouched")
        }

    @Test
    fun acknowledgeRefreshesInboxAndThatDetailOnly() =
        runTest {
            val repo = FakeNotificationsRepository()
            val store = NotificationsStore(repo, backgroundScope)
            backgroundScope.launch { store.alerts().collect {} }
            backgroundScope.launch { store.alertDetail(5).collect {} }
            backgroundScope.launch { store.alertDetail(6).collect {} }
            runCurrent()

            store.acknowledgeAlert(5, note = "  ok  ")
            runCurrent()

            assertEquals(listOf("acknowledgeAlert:5:  ok  "), repo.calls)
            assertEquals(2, repo.collections[alertsKey()])
            assertEquals(2, repo.collections[alertDetailKey(5)])
            assertEquals(1, repo.collections[alertDetailKey(6)], "a different alert's detail is not refreshed")
        }

    @Test
    fun commentRefreshesThatDetailOnlyNotInbox() =
        runTest {
            val repo = FakeNotificationsRepository()
            val store = NotificationsStore(repo, backgroundScope)
            backgroundScope.launch { store.alerts().collect {} }
            backgroundScope.launch { store.alertDetail(5).collect {} }
            runCurrent()

            store.commentAlert(5, note = "hi")
            runCurrent()

            assertEquals(listOf("commentAlert:5:hi"), repo.calls)
            assertEquals(1, repo.collections[alertsKey()], "comment leaves the inbox untouched")
            assertEquals(2, repo.collections[alertDetailKey(5)])
        }

    @Test
    fun ruleMutationsRefreshOnlyTheRuleList() =
        runTest {
            val repo = FakeNotificationsRepository()
            val store = NotificationsStore(repo, backgroundScope)
            backgroundScope.launch { store.alertRules().collect {} }
            backgroundScope.launch { store.alerts().collect {} }
            runCurrent()

            store.toggleAlertRule(3, enabled = true)
            runCurrent()
            assertEquals(2, repo.collections[alertRulesKey()])

            store.saveAlertRule(AlertRuleSaveRequest.Create(AlertRuleInput(name = "n")))
            runCurrent()
            assertEquals(3, repo.collections[alertRulesKey()])

            store.deleteAlertRule(3)
            runCurrent()
            assertEquals(4, repo.collections[alertRulesKey()])

            store.bulkEnableRules(listOf(1, 2))
            runCurrent()
            assertEquals(5, repo.collections[alertRulesKey()])

            store.bulkDisableRules(listOf(1, 2))
            runCurrent()
            assertEquals(6, repo.collections[alertRulesKey()])

            store.snoozeAlertRule(3, AlertRuleSnoozeRequest(minutes = 30))
            runCurrent()
            assertEquals(7, repo.collections[alertRulesKey()])

            assertEquals(1, repo.collections[alertsKey()], "the inbox is never touched by rule mutations")
        }

    @Test
    fun testRuleAndPreviewInvalidateNothing() =
        runTest {
            val repo = FakeNotificationsRepository()
            val store = NotificationsStore(repo, backgroundScope)
            backgroundScope.launch { store.alertRules().collect {} }
            runCurrent()
            assertEquals(1, repo.collections[alertRulesKey()])

            store.testAlertRule(AlertTestRequest(message = "x"))
            runCurrent()
            store.previewComputedMetric(
                ComputedMetricPreviewInput(metricId = "m", metricWindow = "7d", metricOp = ">", metricThreshold = 1.0),
            )
            runCurrent()

            assertTrue(repo.calls.contains("testAlertRule"))
            assertTrue(repo.calls.contains("previewComputedMetric:m"))
            assertEquals(1, repo.collections[alertRulesKey()], "neither test nor preview refreshes any feed")
        }

    @Test
    fun inboxWritesRefreshEveryLogFamilyFeed() =
        runTest {
            val repo = FakeNotificationsRepository()
            val store = NotificationsStore(repo, backgroundScope)
            val flatKey = notificationLogsKey(NotificationFilters())
            val groupsKey = notificationGroupsKey(NotificationFilters())
            backgroundScope.launch { store.notificationLogs().collect {} }
            backgroundScope.launch { store.notificationGroups().collect {} }
            backgroundScope.launch { store.unreadNotifications(10).collect {} }
            backgroundScope.launch { store.unreadCount().collect {} }
            backgroundScope.launch { store.alerts().collect {} }
            runCurrent()
            assertEquals(1, repo.collections[flatKey])

            store.markNotificationsRead(listOf(1, 2))
            runCurrent()

            assertEquals(listOf("markNotificationsRead:[1, 2]"), repo.calls)
            // The whole `['notification-logs']` family re-fetches at once.
            assertEquals(2, repo.collections[flatKey])
            assertEquals(2, repo.collections[groupsKey])
            assertEquals(2, repo.collections[bellUnreadKey(10)])
            assertEquals(2, repo.collections[unreadCountKey()])
            // A non-log feed is NOT swept up by the prefix refresh.
            assertEquals(1, repo.collections[alertsKey()])
        }

    @Test
    fun bulkMarkReadAllVariantRefreshesLogFamily() =
        runTest {
            val repo = FakeNotificationsRepository()
            val store = NotificationsStore(repo, backgroundScope)
            val flatKey = notificationLogsKey(NotificationFilters())
            backgroundScope.launch { store.notificationLogs().collect {} }
            backgroundScope.launch { store.unreadCount().collect {} }
            runCurrent()

            store.bulkMarkRead(BulkMarkReadVars.All)
            runCurrent()

            assertEquals(listOf("bulkMarkRead:All"), repo.calls)
            assertEquals(2, repo.collections[flatKey])
            assertEquals(2, repo.collections[unreadCountKey()])
        }

    @Test
    fun otherInboxWritesAllRefreshLogFamily() =
        runTest {
            val repo = FakeNotificationsRepository()
            val store = NotificationsStore(repo, backgroundScope)
            val flatKey = notificationLogsKey(NotificationFilters())
            backgroundScope.launch { store.notificationLogs().collect {} }
            runCurrent()

            store.markNotificationsUnread(listOf(1))
            runCurrent()
            store.archiveNotifications(listOf(1))
            runCurrent()
            store.unarchiveNotifications(listOf(1))
            runCurrent()
            store.deleteNotifications(listOf(1))
            runCurrent()

            // Four inbox writes ⇒ four extra flat-list re-fetches (1 initial + 4).
            assertEquals(5, repo.collections[flatKey])
        }

    @Test
    fun channelMutationsRefreshChannelsAndStatsPerWeb() =
        runTest {
            val repo = FakeNotificationsRepository()
            val store = NotificationsStore(repo, backgroundScope)
            backgroundScope.launch { store.notificationChannels().collect {} }
            backgroundScope.launch { store.notificationStats().collect {} }
            runCurrent()

            store.saveChannel(NotificationChannelInput.Discord(name = "n"))
            runCurrent()
            // save invalidates channels only (not stats).
            assertEquals(2, repo.collections[channelsKey()])
            assertEquals(1, repo.collections[notificationStatsKey()])

            store.deleteChannel(4)
            runCurrent()
            assertEquals(3, repo.collections[channelsKey()])
            assertEquals(2, repo.collections[notificationStatsKey()])

            store.toggleChannel(4)
            runCurrent()
            assertEquals(4, repo.collections[channelsKey()])
            assertEquals(3, repo.collections[notificationStatsKey()])

            store.testChannel(4)
            runCurrent()
            // test invalidates nothing.
            assertEquals(4, repo.collections[channelsKey()])
            assertEquals(3, repo.collections[notificationStatsKey()])
        }

    @Test
    fun quietHoursMutationsRefreshOnlyTheQuietHoursList() =
        runTest {
            val repo = FakeNotificationsRepository()
            val store = NotificationsStore(repo, backgroundScope)
            backgroundScope.launch { store.quietHours().collect {} }
            runCurrent()

            store.saveQuietHours(QuietHoursWindowInput(enabled = true))
            runCurrent()
            assertEquals(2, repo.collections[quietHoursKey()])

            store.deleteQuietHours(9)
            runCurrent()
            assertEquals(3, repo.collections[quietHoursKey()])
            assertEquals(listOf("saveQuietHours:null", "deleteQuietHours:9"), repo.calls)
        }

    @Test
    fun refreshIsNoOpWhenNothingObserved() =
        runTest {
            val repo = FakeNotificationsRepository()
            val store = NotificationsStore(repo, backgroundScope)

            val result = store.markNotificationsRead(listOf(1))
            runCurrent()

            assertTrue(result.isSuccess)
            assertTrue(repo.collections.isEmpty(), "no feed observed ⇒ no needless upstream restart")
        }
}
