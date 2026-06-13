// Drives [NotificationBellPopoverPresenter] over a controllable fake [NotificationBellPopoverSource], covering the
// cache-then-network state matrix the web component renders from its open-gated `useUnreadNotifications` query plus
// the always-live `useUnreadCount` badge and the `useBulkMarkRead({ all: true })` mutation: the closed
// disabled-query gate (no preview fetch), the open loading / content / empty / hard-error / stale-offline
// freshness, the unread-count passthrough, the mark-all-read routing + pending lifecycle + empty/in-flight no-ops,
// the refresh re-fetch, and the PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
package io.teslasync.android.modalsdialogs.notificationbellpopover

import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.notifications.NotificationLog
import io.teslasync.shared.core.presentation.notifications.UpdatedCountResult
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class NotificationBellPopoverPresenterTest {
    private class FakeSource(
        var previewEmissions: List<Resource<List<NotificationLog>>> = listOf(loading()),
        var rules: List<AlertRule> = emptyList(),
        var vehicles: List<Vehicle> = emptyList(),
        var unread: Int = 0,
        private val markResult: Result<UpdatedCountResult> = Result.success(UpdatedCountResult(3)),
    ) : NotificationBellPopoverSource {
        var unreadNotificationsCalls = 0
            private set
        var markAllReadCalls = 0
            private set

        override fun unreadCount(): Flow<Resource<Int>> = flowOf(Resource.Success(unread, 0L, false))

        override fun unreadNotifications(limit: Int): Flow<Resource<List<NotificationLog>>> =
            flow {
                unreadNotificationsCalls++
                previewEmissions.forEach { emit(it) }
            }

        override fun alertRules(): Flow<Resource<List<AlertRule>>> = flowOf(Resource.Success(rules, 0L, false))

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = flowOf(Resource.Success(vehicles, 0L, false))

        override suspend fun markAllRead(): Result<UpdatedCountResult> {
            markAllReadCalls++
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
    fun closedNeverOpensThePreviewFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(rows(), 100L, false)))
            val presenter = presenter(src)
            backgroundScope.launch { presenter.preview.collect {} }
            advanceUntilIdle()

            assertEquals(0, src.unreadNotificationsCalls)
            assertTrue(presenter.preview.value.state.isEmpty)
            assertFalse(presenter.open.value)
        }

    @Test
    fun openCollectsTheFeedAndProjectsContentJoinedWithRulesAndVehicles() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    previewEmissions = listOf(Resource.Success(rows(), 100L, false)),
                    rules = listOf(AlertRule(id = 7, name = "Low battery", severity = "critical", vehicleId = 2)),
                    vehicles = listOf(vehicle()),
                )
            val presenter = presenter(src)
            backgroundScope.launch { presenter.preview.collect {} }
            advanceUntilIdle()

            presenter.toggle()
            advanceUntilIdle()

            assertTrue(presenter.open.value)
            assertTrue(src.unreadNotificationsCalls >= 1)
            val preview = presenter.preview.value
            assertTrue(preview.state.isContent)
            assertEquals(2, preview.logCount)
            assertEquals(100L, preview.state.fetchedAt)
            assertEquals(mapOf(7L to "Low battery"), preview.rulesById.mapValues { it.value.name })
            assertEquals(setOf(2L), preview.vehiclesById.keys)
        }

    @Test
    fun openShowsLoadingThenContent() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(loading(), Resource.Success(rows(), 100L, false)))
            val presenter = presenter(src)
            backgroundScope.launch { presenter.preview.collect {} }
            advanceUntilIdle()

            presenter.toggle()
            advanceUntilIdle()

            assertTrue(presenter.preview.value.state.isContent)
        }

    @Test
    fun openEmptyProjectsTheEmptyState() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(emptyList(), 100L, false)))
            val presenter = presenter(src)
            backgroundScope.launch { presenter.preview.collect {} }
            advanceUntilIdle()

            presenter.toggle()
            advanceUntilIdle()

            assertTrue(presenter.preview.value.state.isEmpty)
            assertEquals(0, presenter.preview.value.logCount)
        }

    @Test
    fun openHardErrorWithNoCacheSurfacesError() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(loading(), Resource.Error(null, null, false, ApiError.Network())))
            val presenter = presenter(src)
            backgroundScope.launch { presenter.preview.collect {} }
            advanceUntilIdle()

            presenter.toggle()
            advanceUntilIdle()

            val state = presenter.preview.value.state
            assertTrue(state.isError)
            assertNull(state.data)
        }

    @Test
    fun openStaleOfflineKeepsCachedRows() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Error(rows(), 100L, true, ApiError.Timeout())))
            val presenter = presenter(src)
            backgroundScope.launch { presenter.preview.collect {} }
            advanceUntilIdle()

            presenter.toggle()
            advanceUntilIdle()

            val state = presenter.preview.value.state
            assertTrue(state.stale)
            assertTrue(state.hasError)
            assertEquals(2, state.data?.size)
        }

    @Test
    fun unreadCountPassesThroughTheBadgeFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(unread = 42)
            val presenter = presenter(src)
            backgroundScope.launch { presenter.unreadCount.collect {} }
            advanceUntilIdle()

            assertEquals(42, presenter.unreadCount.value)
        }

    @Test
    fun markAllReadRoutesThroughTheSourceAndClearsPending() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(rows(), 100L, false)))
            val presenter = presenter(src)
            backgroundScope.launch { presenter.preview.collect {} }
            advanceUntilIdle()
            presenter.toggle()
            advanceUntilIdle()
            val firstFetches = src.unreadNotificationsCalls

            presenter.markAllRead()
            advanceUntilIdle()

            assertEquals(1, src.markAllReadCalls)
            assertFalse(presenter.markPending.value)
            // The success re-collects the preview so the freshly-emptied list + cleared badge are reflected.
            assertTrue(src.unreadNotificationsCalls > firstFetches)
        }

    @Test
    fun markAllReadIsANoopWhenThePreviewIsEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(emptyList(), 100L, false)))
            val presenter = presenter(src)
            backgroundScope.launch { presenter.preview.collect {} }
            advanceUntilIdle()
            presenter.toggle()
            advanceUntilIdle()

            presenter.markAllRead()
            advanceUntilIdle()

            assertEquals(0, src.markAllReadCalls)
        }

    @Test
    fun refreshReFetchesThePreviewFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(rows(), 100L, false)))
            val presenter = presenter(src)
            backgroundScope.launch { presenter.preview.collect {} }
            advanceUntilIdle()
            presenter.toggle()
            advanceUntilIdle()
            val before = src.unreadNotificationsCalls

            presenter.refresh()
            advanceUntilIdle()

            assertTrue(src.unreadNotificationsCalls > before)
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
            assertEquals(mapOf("surface" to "NotificationBellPopover"), opened.single().second)
        }

    private fun TestScope.presenter(
        source: NotificationBellPopoverSource,
        logger: Logger = NoopLogger,
    ): NotificationBellPopoverPresenter = NotificationBellPopoverPresenter(source, logger, backgroundScope)

    private companion object {
        fun loading(): Resource<List<NotificationLog>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun rows(): List<NotificationLog> =
            listOf(
                NotificationLog(id = 9, alertId = 7, title = "Battery low — Model Y", createdAt = "2026-06-12T11:30:00Z"),
                NotificationLog(id = 8, title = "Software update available", createdAt = "2026-06-12T11:00:00Z"),
            )

        fun vehicle(): Vehicle =
            Vehicle(
                createdAt = kotlin.time.Instant.parse("2026-01-01T00:00:00Z"),
                displayName = "Model Y",
                enrolledAt = kotlin.time.Instant.parse("2026-01-01T00:00:00Z"),
                id = 2,
                teslaId = 1002,
                timezone = "UTC",
                updatedAt = kotlin.time.Instant.parse("2026-01-01T00:10:00Z"),
                vin = "VIN2",
            )
    }
}
