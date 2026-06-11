package io.teslasync.android.data.live

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.shared.core.net.sse.Connection
import io.teslasync.shared.core.net.sse.LiveEvent
import io.teslasync.shared.core.net.sse.SignalEnvelope
import io.teslasync.shared.core.net.sse.SignalKind
import io.teslasync.shared.core.net.sse.SignalValue
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure-logic coverage for the live-session mappers/reducers: the `Connection` → `LiveConnectionStatus`
 * derivation, the stale flag, and the never-lose-a-known-signal merge — the Android port of the web
 * `useLiveConnection` / `useVehicleLive` behaviour.
 */
class LiveSessionModelsTest {
    @Test
    fun liveStatusOf_mapsOpenAndStaleToConnected() {
        assertEquals(LiveConnectionStatus.Connected, liveStatusOf(Connection.Open, hasEverConnected = true))
        assertEquals(LiveConnectionStatus.Connected, liveStatusOf(Connection.Stale, hasEverConnected = true))
    }

    @Test
    fun liveStatusOf_coldStartIsUnknown_afterSessionIsReconnectingOrOffline() {
        // Never connected: a quiet wire reads as Unknown, not a scary Offline.
        assertEquals(LiveConnectionStatus.Unknown, liveStatusOf(Connection.Connecting, hasEverConnected = false))
        assertEquals(LiveConnectionStatus.Unknown, liveStatusOf(Connection.Closed, hasEverConnected = false))
        // Once a session has existed, the same states are honest about the drop.
        assertEquals(LiveConnectionStatus.Reconnecting, liveStatusOf(Connection.Connecting, hasEverConnected = true))
        assertEquals(LiveConnectionStatus.Reconnecting, liveStatusOf(Connection.Reconnecting, hasEverConnected = true))
        assertEquals(LiveConnectionStatus.Disconnected, liveStatusOf(Connection.Closed, hasEverConnected = true))
    }

    @Test
    fun sessionState_isStaleOnlyWhenConnectionStale() {
        assertTrue(state(Connection.Stale).isStale)
        assertFalse(state(Connection.Open).isStale)
        assertFalse(state(Connection.Reconnecting).isStale)
    }

    @Test
    fun sessionState_vehicleNeverNull() {
        val empty = LiveSessionState.Initial.vehicle(7L)
        assertEquals(7L, empty.vehicleId)
        assertEquals(0, empty.signalCount)
        assertNull(LiveSessionState.Initial.vehicle(null).vehicleId)
    }

    @Test
    fun mergeVehicleUpdate_prefersStateAndMergesOverPriorSignals() {
        val first =
            buildJsonObject {
                put("vehicle_id", 1L)
                putJsonObject("state") {
                    put("VehicleSpeed", 42.0)
                    put("BatteryLevel", 80.0)
                }
            }
        val afterFirst = mergeVehicleUpdate(emptyMap(), first, nowMillis = 100L)

        // A later frame missing BatteryLevel must NOT drop it (the web merge guarantee).
        val second =
            buildJsonObject {
                put("vehicle_id", 1L)
                putJsonObject("state") { put("VehicleSpeed", 50.0) }
            }
        val afterSecond = mergeVehicleUpdate(afterFirst, second, nowMillis = 200L)

        val vehicle = afterSecond.getValue(1L)
        assertEquals(JsonPrimitive(50.0), vehicle.signals["VehicleSpeed"])
        assertEquals(JsonPrimitive(80.0), vehicle.signals["BatteryLevel"])
        assertEquals(2, vehicle.signalCount)
        assertEquals(200L, vehicle.lastUpdatedMillis)
    }

    @Test
    fun mergeVehicleUpdate_fallsBackToSignalsAndIgnoresUnattributable() {
        val viaSignals =
            buildJsonObject {
                put("vehicle_id", 2L)
                putJsonObject("signals") { put("Soc", 55.0) }
            }
        val merged = mergeVehicleUpdate(emptyMap(), viaSignals, nowMillis = 10L)
        assertEquals(JsonPrimitive(55.0), merged.getValue(2L).signals["Soc"])

        // No vehicle_id, or neither map → unchanged.
        val noId = buildJsonObject { putJsonObject("state") { put("Soc", 1.0) } }
        assertEquals(merged, mergeVehicleUpdate(merged, noId, nowMillis = 20L))
        val noMaps = buildJsonObject { put("vehicle_id", 2L) }
        assertEquals(merged, mergeVehicleUpdate(merged, noMaps, nowMillis = 20L))
    }

    @Test
    fun mergeLiveEvent_foldsVehicleUpdateAndSignalChange_ignoresOthers() {
        val update =
            LiveEvent.VehicleUpdate(
                data =
                    buildJsonObject {
                        put("vehicle_id", 3L)
                        putJsonObject("state") { put("Gear", "D") }
                    },
                id = null,
            )
        val afterUpdate = mergeLiveEvent(emptyMap(), update, nowMillis = 1L)
        assertEquals(JsonPrimitive("D"), afterUpdate.getValue(3L).signals["Gear"])

        val signal =
            LiveEvent.Signal(
                envelope =
                    SignalEnvelope(
                        vehicleId = 3L,
                        field = "Soc",
                        kind = SignalKind.Float,
                        value = SignalValue.NumberValue(72.0),
                        ts = "2026-06-10T00:00:00Z",
                    ),
                id = null,
            )
        val afterSignal = mergeLiveEvent(afterUpdate, signal, nowMillis = 2L)
        assertEquals(JsonPrimitive(72.0), afterSignal.getValue(3L).signals["Soc"])
        // The single-signal merge must not drop the earlier Gear value.
        assertEquals(JsonPrimitive("D"), afterSignal.getValue(3L).signals["Gear"])

        // Heartbeat carries no vehicle payload → vehicles unchanged.
        assertEquals(afterSignal, mergeLiveEvent(afterSignal, LiveEvent.Heartbeat(time = "t", id = null), nowMillis = 3L))
    }

    private fun state(connection: Connection): LiveSessionState = LiveSessionState.Initial.copy(connection = connection)
}
