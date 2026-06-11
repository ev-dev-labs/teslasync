package io.teslasync.android.data.live

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.net.sse.Connection
import io.teslasync.shared.core.net.sse.LiveEvent
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests [LiveViewModel]'s projection of the [LiveSessionStore] onto the page-facing streams (status,
 * staleness, active-vehicle live state) and the retry action, against the real store backed by a
 * [FakeLiveFeed].
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LiveViewModelTest {
    @Test
    fun projectsStatusStaleAndActiveVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val feed = FakeLiveFeed()
            val selection = SelectedVehicleStore()
            val store =
                LiveSessionStore(
                    feed = feed,
                    authenticated = MutableStateFlow(true),
                    scope = backgroundScope,
                    logger = NoopLogger,
                    nowMillis = { currentTime },
                )
            store.setForeground(true)
            val viewModel = LiveViewModel(store, selection, NoopLogger, backgroundScope)
            backgroundScope.launch { viewModel.status.collect {} }
            backgroundScope.launch { viewModel.isStale.collect {} }
            backgroundScope.launch { viewModel.vehicle.collect {} }

            feed.setConnection(Connection.Open)
            advanceUntilIdle()
            assertEquals(LiveConnectionStatus.Connected, viewModel.status.value)
            assertFalse(viewModel.isStale.value)

            // The active-vehicle stream tracks the selection and folds its live signals.
            selection.select(5L)
            feed.emitEvent(
                LiveEvent.VehicleUpdate(
                    data =
                        buildJsonObject {
                            put("vehicle_id", 5L)
                            putJsonObject("state") { put("Soc", 70.0) }
                        },
                    id = null,
                ),
            )
            advanceUntilIdle()
            assertEquals(5L, viewModel.vehicle.value.vehicleId)
            assertEquals(1, viewModel.vehicle.value.signalCount)

            feed.setConnection(Connection.Stale)
            advanceUntilIdle()
            assertTrue(viewModel.isStale.value)
        }

    @Test
    fun retryReconnects() =
        runTest(UnconfinedTestDispatcher()) {
            val feed = FakeLiveFeed()
            var reauths = 0
            val store =
                LiveSessionStore(
                    feed = feed,
                    authenticated = MutableStateFlow(true),
                    scope = backgroundScope,
                    logger = NoopLogger,
                    nowMillis = { currentTime },
                    onReauth = { reauths += 1 },
                )
            store.setForeground(true)
            val viewModel = LiveViewModel(store, SelectedVehicleStore(), NoopLogger, backgroundScope)
            backgroundScope.launch { viewModel.status.collect {} }
            advanceUntilIdle()
            assertEquals(1, feed.opens)

            viewModel.retry()
            advanceUntilIdle()

            assertEquals(2, feed.opens)
            assertEquals(1, reauths)
        }
}
