package io.teslasync.android.data.live

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.net.sse.Connection
import io.teslasync.shared.core.net.sse.LiveEvent
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
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
 * Behavioural coverage for [LiveSessionStore]'s lifecycle gating (ADR-009), driven by a [FakeLiveFeed]
 * so foreground/background, auth gating + re-auth, reconnect/retry, staleness, clean cancellation, and
 * event folding are all deterministic on virtual time with no real `SseClient`/network/clock.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LiveSessionStoreTest {
    @Test
    fun foregroundGatesAndResumesTheSubscription() =
        runTest(UnconfinedTestDispatcher()) {
            val feed = FakeLiveFeed()
            val store = store(feed, authenticated = MutableStateFlow(true))
            backgroundScope.launch { store.state.collect {} }
            advanceUntilIdle()

            // Backgrounded: observed, authenticated — but no foreground, so nothing streams.
            assertEquals(0, feed.opens)
            assertEquals(LiveConnectionStatus.Unknown, store.state.value.status)

            store.setForeground(true)
            feed.setConnection(Connection.Open)
            advanceUntilIdle()
            assertEquals(1, feed.opens)
            assertEquals(1, feed.activeStreams)
            assertEquals(LiveConnectionStatus.Connected, store.state.value.status)

            // Background → stream torn down, last status honest (Disconnected, not Unknown).
            store.setForeground(false)
            advanceUntilIdle()
            assertEquals(0, feed.activeStreams)
            assertEquals(Connection.Closed, store.state.value.connection)
            assertEquals(LiveConnectionStatus.Disconnected, store.state.value.status)

            // Foreground again → resumes with a fresh connection.
            store.setForeground(true)
            advanceUntilIdle()
            assertEquals(2, feed.opens)
            assertEquals(1, feed.activeStreams)
        }

    @Test
    fun unauthenticatedDoesNotStreamAndReauthReopens() =
        runTest(UnconfinedTestDispatcher()) {
            val feed = FakeLiveFeed()
            val authenticated = MutableStateFlow(false)
            val store = store(feed, authenticated)
            store.setForeground(true)
            backgroundScope.launch { store.state.collect {} }
            advanceUntilIdle()

            // Foreground + observed, but signed out → no stream.
            assertEquals(0, feed.opens)

            // Sign-in (authenticated → true) opens with the now-available credential.
            authenticated.value = true
            advanceUntilIdle()
            assertEquals(1, feed.opens)

            // Token invalidation then a fresh re-auth: drop, then reopen (the SSE re-auth path).
            authenticated.value = false
            advanceUntilIdle()
            assertEquals(0, feed.activeStreams)
            authenticated.value = true
            advanceUntilIdle()
            assertEquals(2, feed.opens)
            assertEquals(1, feed.activeStreams)
        }

    @Test
    fun staleFlagsWithoutDroppingTheStream() =
        runTest(UnconfinedTestDispatcher()) {
            val feed = FakeLiveFeed()
            val store = store(feed, MutableStateFlow(true))
            store.setForeground(true)
            backgroundScope.launch { store.state.collect {} }
            feed.setConnection(Connection.Open)
            advanceUntilIdle()
            assertFalse(store.state.value.isStale)

            feed.setConnection(Connection.Stale)
            advanceUntilIdle()

            assertTrue(store.state.value.isStale)
            // Stale flags, it does not drop — the wire stays open and the indicator stays Connected.
            assertEquals(1, feed.activeStreams)
            assertEquals(LiveConnectionStatus.Connected, store.state.value.status)
        }

    @Test
    fun reconnectForcesFreshOpenAndNudgesReauth() =
        runTest(UnconfinedTestDispatcher()) {
            val feed = FakeLiveFeed()
            var reauths = 0
            val store = store(feed, MutableStateFlow(true), onReauth = { reauths += 1 })
            store.setForeground(true)
            backgroundScope.launch { store.state.collect {} }
            advanceUntilIdle()
            assertEquals(1, feed.opens)

            store.reconnect()
            advanceUntilIdle()

            assertEquals(2, feed.opens)
            assertEquals(1, feed.activeStreams)
            assertEquals(1, reauths)
        }

    @Test
    fun cancellingTheObserverClosesTheStream() =
        runTest(UnconfinedTestDispatcher()) {
            val feed = FakeLiveFeed()
            val store = store(feed, MutableStateFlow(true))
            store.setForeground(true)
            val job = backgroundScope.launch { store.state.collect {} }
            advanceUntilIdle()
            assertEquals(1, feed.activeStreams)

            job.cancel()
            // The upstream survives the last observer by WhileSubscribed's stop timeout; advance past it.
            advanceTimeBy(6_000)
            advanceUntilIdle()

            assertEquals(0, feed.activeStreams)
        }

    @Test
    fun foldsVehicleUpdateForActiveVehicleAndStampsLastMessage() =
        runTest(UnconfinedTestDispatcher()) {
            val feed = FakeLiveFeed()
            val store = store(feed, MutableStateFlow(true))
            store.setForeground(true)
            backgroundScope.launch { store.state.collect {} }
            feed.setConnection(Connection.Open)
            advanceUntilIdle()

            feed.emitEvent(
                LiveEvent.VehicleUpdate(
                    data =
                        buildJsonObject {
                            put("vehicle_id", 9L)
                            putJsonObject("state") {
                                put("VehicleSpeed", 30.0)
                                put("BatteryLevel", 64.0)
                            }
                        },
                    id = "e1",
                ),
            )
            advanceUntilIdle()

            val vehicle = store.state.value.vehicle(9L)
            assertEquals(2, vehicle.signalCount)
            assertTrue(store.state.value.hasEverConnected)
            assertEquals(store.state.value.lastMessageAtMillis, vehicle.lastUpdatedMillis)
        }

    private fun TestScope.store(
        feed: FakeLiveFeed,
        authenticated: MutableStateFlow<Boolean>,
        onReauth: suspend () -> Unit = {},
    ) = LiveSessionStore(
        feed = feed,
        authenticated = authenticated,
        scope = backgroundScope,
        logger = NoopLogger,
        nowMillis = { currentTime },
        onReauth = onReauth,
    )
}
