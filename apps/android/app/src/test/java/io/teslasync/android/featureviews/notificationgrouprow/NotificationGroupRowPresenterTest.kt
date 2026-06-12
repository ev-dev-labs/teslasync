package io.teslasync.android.featureviews.notificationgrouprow

import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiEvent
import io.teslasync.shared.core.data.repo.NotificationFilters
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.notifications.NotificationLog
import io.teslasync.shared.core.presentation.notifications.NotificationLogGroup
import io.teslasync.shared.core.presentation.notifications.UpdatedCountResult
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [NotificationGroupRowPresenter] over a controllable fake [NotificationGroupRowSource], covering the
 * cache-then-network state matrix the web component renders from its lazily-gated `useGroupMembers` query plus
 * the `useBulkMarkRead` mutation: the collapsed disabled-query gate (no fetch), the expand loading / content /
 * empty / hard-error / stale-offline freshness, the refresh re-fetch, the group-read success + error toasts,
 * the singleton no-ops, and the PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NotificationGroupRowPresenterTest {
    private class FakeSource(
        var emissions: List<Resource<List<NotificationLog>>> = listOf(loading()),
        private val markResult: Result<UpdatedCountResult> = Result.success(UpdatedCountResult(3)),
    ) : NotificationGroupRowSource {
        var groupMembersCalls = 0
            private set
        var markGroupReadCalls = 0
            private set
        var lastMarkKey: String? = null
            private set

        override fun groupMembers(
            groupKey: String,
            filters: NotificationFilters,
        ): Flow<Resource<List<NotificationLog>>> =
            flow {
                groupMembersCalls++
                emissions.forEach { emit(it) }
            }

        override suspend fun markGroupRead(groupKey: String): Result<UpdatedCountResult> {
            markGroupReadCalls++
            lastMarkKey = groupKey
            return markResult
        }
    }

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    @Test
    fun collapsedNeverOpensTheMemberFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(members(), 100L, false)))
            val presenter = presenter(src)
            backgroundScope.launch { presenter.membersState.collect {} }
            advanceUntilIdle()

            assertEquals(0, src.groupMembersCalls)
            assertTrue(presenter.membersState.value.isEmpty)
            assertFalse(presenter.expanded.value)
        }

    @Test
    fun expandOpensTheFeedAndProjectsContent() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(members(), 100L, false)))
            val presenter = presenter(src)
            backgroundScope.launch { presenter.membersState.collect {} }
            advanceUntilIdle()

            presenter.toggleExpanded()
            advanceUntilIdle()

            assertTrue(presenter.expanded.value)
            assertTrue(src.groupMembersCalls >= 1)
            val state = presenter.membersState.value
            assertTrue(state.isContent)
            assertEquals(2, state.data?.size)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun expandShowsLoadingThenContent() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(loading(), Resource.Success(members(), 100L, false)))
            val presenter = presenter(src)
            backgroundScope.launch { presenter.membersState.collect {} }
            advanceUntilIdle()

            presenter.toggleExpanded()
            advanceUntilIdle()

            assertTrue(presenter.membersState.value.isContent)
            assertNotNull(presenter.membersState.value.data)
        }

    @Test
    fun expandHardErrorWithNoCacheSurfacesError() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(loading(), Resource.Error(null, null, false, ApiError.Network())))
            val presenter = presenter(src)
            backgroundScope.launch { presenter.membersState.collect {} }
            advanceUntilIdle()

            presenter.toggleExpanded()
            advanceUntilIdle()

            val state = presenter.membersState.value
            assertTrue(state.isError)
            assertNull(state.data)
        }

    @Test
    fun expandStaleOfflineKeepsCachedMembers() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Error(members(), 100L, true, ApiError.Timeout())))
            val presenter = presenter(src)
            backgroundScope.launch { presenter.membersState.collect {} }
            advanceUntilIdle()

            presenter.toggleExpanded()
            advanceUntilIdle()

            val state = presenter.membersState.value
            assertNotNull(state.data)
            assertTrue(state.stale)
            assertTrue(state.hasError)
            assertEquals(2, state.data?.size)
        }

    @Test
    fun refreshReFetchesTheMemberFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(members(), 100L, false)))
            val presenter = presenter(src)
            backgroundScope.launch { presenter.membersState.collect {} }
            advanceUntilIdle()
            presenter.toggleExpanded()
            advanceUntilIdle()
            assertEquals(100L, presenter.membersState.value.fetchedAt)

            src.emissions = listOf(Resource.Success(members(), 200L, false))
            presenter.refresh()
            advanceUntilIdle()

            assertEquals(200L, presenter.membersState.value.fetchedAt)
            assertTrue(src.groupMembersCalls >= 2)
        }

    @Test
    fun singletonNeverExpandsOrFetches() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(members(), 100L, false)))
            val presenter = presenter(src, group = group(groupKey = null))
            backgroundScope.launch { presenter.membersState.collect {} }
            advanceUntilIdle()

            presenter.toggleExpanded()
            advanceUntilIdle()

            assertFalse(presenter.expanded.value)
            assertEquals(0, src.groupMembersCalls)
        }

    @Test
    fun markGroupReadEmitsSuccessToastCarryingTheUpdatedCount() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(markResult = Result.success(UpdatedCountResult(5)))
            val presenter = presenter(src)
            val received = mutableListOf<UiEvent>()
            backgroundScope.launch { presenter.events.collect { received += it } }

            presenter.markGroupRead()
            advanceUntilIdle()

            assertEquals("low_battery:warning", src.lastMarkKey)
            assertFalse(presenter.markPending.value)
            val msg = received.filterIsInstance<UiEvent.Message>().single()
            assertEquals(MARK_READ_SUCCESS_KEY, msg.messageKey)
            assertEquals(listOf("5"), msg.args)
            assertEquals(UiEvent.Severity.Success, msg.severity)
        }

    @Test
    fun markGroupReadEmitsErrorToastOnFailure() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(markResult = Result.failure(ApiError.Http(500)))
            val presenter = presenter(src)
            val received = mutableListOf<UiEvent>()
            backgroundScope.launch { presenter.events.collect { received += it } }

            presenter.markGroupRead()
            advanceUntilIdle()

            val msg = received.filterIsInstance<UiEvent.Message>().single()
            assertEquals(MARK_READ_ERROR_KEY, msg.messageKey)
            assertEquals(UiEvent.Severity.Error, msg.severity)
        }

    @Test
    fun markGroupReadIsANoopForASingleton() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            val presenter = presenter(src, group = group(groupKey = null))
            val received = mutableListOf<UiEvent>()
            backgroundScope.launch { presenter.events.collect { received += it } }

            presenter.markGroupRead()
            advanceUntilIdle()

            assertEquals(0, src.markGroupReadCalls)
            assertTrue(received.isEmpty())
        }

    @Test
    fun recordViewOpenedEmitsTheSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val presenter = presenter(FakeSource(), logger = logger)

            presenter.recordViewOpened()
            presenter.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "NotificationGroupRow"), opened.single().second)
        }

    @Test
    fun refreshEmitsAPiiSafeDiagnostic() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val presenter = presenter(FakeSource(), logger = logger)

            presenter.refresh()

            assertTrue(logger.events.any { it.first == "notificationGroupRow.refresh" })
            assertTrue(logger.events.all { it.second.none { (k, _) -> k == "title" || k == "message" } })
        }

    private fun TestScope.presenter(
        source: NotificationGroupRowSource,
        logger: Logger = NoopLogger,
        group: NotificationLogGroup = group(),
    ): NotificationGroupRowPresenter = NotificationGroupRowPresenter(source, logger, group, NotificationFilters(), backgroundScope)

    private companion object {
        fun loading(): Resource<List<NotificationLog>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun members(): List<NotificationLog> =
            listOf(
                NotificationLog(id = 9, title = "Battery low — Model Y", createdAt = "2026-06-12T11:30:00Z"),
                NotificationLog(id = 8, title = "Battery low — Model 3", createdAt = "2026-06-12T11:00:00Z"),
            )

        fun group(groupKey: String? = "low_battery:warning"): NotificationLogGroup =
            NotificationLogGroup(
                groupKey = groupKey,
                latest = NotificationLog(id = 10, title = "Battery low", createdAt = "2026-06-12T11:30:00Z"),
                count = 4,
                unreadCount = 3,
                vehicleIds = listOf(1, 2),
            )
    }
}
