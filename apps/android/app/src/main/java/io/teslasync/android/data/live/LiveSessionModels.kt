// File holds the live-session value types plus their pure mappers/reducers (supporting declarations).
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.data.live

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.shared.core.net.sse.Connection
import io.teslasync.shared.core.net.sse.LiveEvent
import io.teslasync.shared.core.net.sse.SignalEnvelope
import io.teslasync.shared.core.net.sse.SignalValue
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull

/*
 * Framework-free state + mapping for the Android live-data pipeline (ADR-009/013) — the counterpart
 * of the web `useLiveConnection` / `useVehicleLive` derivations. Kept pure (no Compose, no platform
 * clock, no coroutines) so it runs in the :android:testDebugUnitTest gate and the store/ViewModel
 * stay a thin orchestration layer over the shared `SseClient` `Connection`/`LiveEvent` contract.
 */

/**
 * Always-complete live state for a single vehicle, merged from the SSE `vehicle_update` / `signal_change`
 * stream — the Android port of the web `useVehicleLive` merge guarantee: a new update overlays known
 * signals and never drops previously-seen ones, so a panel never blanks when a single field is absent
 * from one frame. Values stay as the raw SI [JsonElement]s the backend emits; the display boundary
 * (`useUnits`/`UnitFormatter`) converts them at render time.
 *
 * @property vehicleId the vehicle these signals belong to, or `null` before any vehicle is known.
 * @property signals merged latest signal values, keyed by the Tesla field name (e.g. `VehicleSpeed`).
 * @property signalCount number of distinct signals currently known (the merged map size).
 * @property lastUpdatedMillis client clock stamp of the most recent merge, or `null` when none yet.
 */
data class LiveVehicleState(
    val vehicleId: Long?,
    val signals: Map<String, JsonElement>,
    val signalCount: Int,
    val lastUpdatedMillis: Long?,
) {
    companion object {
        /** The empty live state for [vehicleId] (no signals seen yet) — never a blank-hiding null. */
        fun empty(vehicleId: Long? = null): LiveVehicleState =
            LiveVehicleState(vehicleId = vehicleId, signals = emptyMap(), signalCount = 0, lastUpdatedMillis = null)
    }
}

/**
 * The whole live pipeline snapshot the [LiveSessionStore] exposes: the shared-client [Connection]
 * lifecycle, whether a frame has ever arrived (so a cold start reads as `Unknown`, not `Offline`),
 * the last-message clock for freshness, and the per-vehicle merged [LiveVehicleState]s.
 */
data class LiveSessionState(
    val connection: Connection,
    val hasEverConnected: Boolean,
    val lastMessageAtMillis: Long?,
    val vehicles: Map<Long, LiveVehicleState>,
) {
    /** Wire health for `LiveIndicator`, honest about a never-yet-connected cold start. */
    val status: LiveConnectionStatus get() = liveStatusOf(connection, hasEverConnected)

    /**
     * True when the stream is open but has gone silent past the freshness window (the shared client's
     * [Connection.Stale], ADR-013's 2-minute contract) — drives `LiveStaleDataBanner`. The stream is
     * NOT dropped, so last-known values stay valid but flagged.
     */
    val isStale: Boolean get() = connection == Connection.Stale

    /** The merged live state for [id], or an empty (non-null) state so panels never blank. */
    fun vehicle(id: Long?): LiveVehicleState = id?.let { vehicles[it] } ?: LiveVehicleState.empty(id)

    companion object {
        /** Pre-connection seed: closed wire, no frames, no vehicles. */
        val Initial: LiveSessionState =
            LiveSessionState(
                connection = Connection.Closed,
                hasEverConnected = false,
                lastMessageAtMillis = null,
                vehicles = emptyMap(),
            )
    }
}

/**
 * Maps the shared-client [Connection] onto the A2 [LiveConnectionStatus] surfaced by `LiveIndicator`,
 * mirroring the web `useLiveConnection` derivation:
 *  - [Connection.Open] / [Connection.Stale] → [LiveConnectionStatus.Connected] (the wire is up; staleness
 *    of the *data* is surfaced separately by the banner, exactly as the web splits indicator vs. freshness);
 *  - [Connection.Reconnecting] → [LiveConnectionStatus.Reconnecting];
 *  - [Connection.Connecting] → Reconnecting once a session has been seen, else Unknown (cold start);
 *  - [Connection.Closed] → Disconnected once a session has been seen, else Unknown.
 */
fun liveStatusOf(
    connection: Connection,
    hasEverConnected: Boolean,
): LiveConnectionStatus =
    when (connection) {
        Connection.Open, Connection.Stale -> LiveConnectionStatus.Connected
        Connection.Reconnecting -> LiveConnectionStatus.Reconnecting
        Connection.Connecting -> if (hasEverConnected) LiveConnectionStatus.Reconnecting else LiveConnectionStatus.Unknown
        Connection.Closed -> if (hasEverConnected) LiveConnectionStatus.Disconnected else LiveConnectionStatus.Unknown
    }

/**
 * Folds a `vehicle_update` payload into [vehicles], mirroring the web `useVehicleLive` handler: the
 * complete `state` map is preferred, falling back to the partial `signals` map, and the result is
 * merged over the vehicle's prior signals so nothing known is lost. A payload that cannot be attributed
 * to a vehicle (no numeric `vehicle_id`) or carries neither map is ignored unchanged.
 */
fun mergeVehicleUpdate(
    vehicles: Map<Long, LiveVehicleState>,
    data: JsonObject,
    nowMillis: Long,
): Map<Long, LiveVehicleState> {
    val vehicleId = (data["vehicle_id"] as? JsonPrimitive)?.longOrNull
    val raw = (data["state"] as? JsonObject) ?: (data["signals"] as? JsonObject)
    if (vehicleId == null || raw == null) return vehicles
    return mergeSignals(vehicles, vehicleId, raw, nowMillis)
}

/**
 * Folds a single `signal_change` [envelope] into [vehicles] (the web `parseEnvelope` → merge path),
 * overlaying just that one field on the vehicle's prior signals.
 */
fun mergeSignalChange(
    vehicles: Map<Long, LiveVehicleState>,
    envelope: SignalEnvelope,
    nowMillis: Long,
): Map<Long, LiveVehicleState> =
    mergeSignals(vehicles, envelope.vehicleId, mapOf(envelope.field to envelope.value.toJsonElement()), nowMillis)

/**
 * Folds [event] into [vehicles], returning the map unchanged for events that carry no per-vehicle
 * signal payload (`connected`, `heartbeat`, `alert`, `export_status`, `achievement_unlocked`, unknown).
 */
fun mergeLiveEvent(
    vehicles: Map<Long, LiveVehicleState>,
    event: LiveEvent,
    nowMillis: Long,
): Map<Long, LiveVehicleState> =
    when (event) {
        is LiveEvent.VehicleUpdate -> mergeVehicleUpdate(vehicles, event.data, nowMillis)
        is LiveEvent.Signal -> mergeSignalChange(vehicles, event.envelope, nowMillis)
        else -> vehicles
    }

private fun mergeSignals(
    vehicles: Map<Long, LiveVehicleState>,
    vehicleId: Long,
    raw: Map<String, JsonElement>,
    nowMillis: Long,
): Map<Long, LiveVehicleState> {
    if (raw.isEmpty()) return vehicles
    val prev = vehicles[vehicleId] ?: LiveVehicleState.empty(vehicleId)
    val merged = prev.signals + raw
    return vehicles + (vehicleId to prev.copy(signals = merged, signalCount = merged.size, lastUpdatedMillis = nowMillis))
}

/** Converts a typed shared-client [SignalValue] into the raw [JsonElement] the merged signal map holds. */
private fun SignalValue.toJsonElement(): JsonElement =
    when (this) {
        is SignalValue.NumberValue -> JsonPrimitive(value)
        is SignalValue.StringValue -> JsonPrimitive(value)
        is SignalValue.BoolValue -> JsonPrimitive(value)
        is SignalValue.TimeValue -> JsonPrimitive(value)
        SignalValue.NullValue -> JsonNull
    }
