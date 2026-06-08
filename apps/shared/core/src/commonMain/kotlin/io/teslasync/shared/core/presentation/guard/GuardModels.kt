package io.teslasync.shared.core.presentation.guard

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * The wire shape of a vehicle's Sentry-Guard configuration — the cross-platform port of the web
 * `GuardConfig` interface (web/src/api/hooks/useGuard.ts), itself mirroring `database.GuardConfig`
 * behind `internal/api/guard/guard_handler.go`. Keys arrive snake_case from
 * `GET /api/v1/vehicles/{id}/guard`; they are matched verbatim via [SerialName] so the cached
 * payload round-trips unchanged. [homeGeofenceId] is nullable (no home fence configured). No field
 * is unit-bearing, so there is no SI conversion at this layer — display formatting is the render
 * boundary's job (S5).
 */
@Serializable
public data class GuardConfig(
    @SerialName("vehicle_id") val vehicleId: Long,
    val enabled: Boolean,
    @SerialName("home_geofence_id") val homeGeofenceId: Long? = null,
    val sensitivity: String,
    @SerialName("auto_panic") val autoPanic: Boolean,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String,
)

/**
 * The wire shape of one guard event — the cross-platform port of the web `GuardEvent` interface,
 * matching `database.GuardEvent` from `internal/database/guard_repo.go` exactly. The events feed
 * returns state-change records sourced from `security_events`, so [eventType] is a free-form
 * `String` (the UI must use lookup-with-fallback for labels/icons, never exhaustive switching).
 *
 * `acknowledged` is DERIVED from [acknowledgedAt] being non-null; the backend does NOT emit it as a
 * separate boolean. Use [isGuardEventAcknowledged] for the canonical, golden-locked derivation.
 * [details] is an opaque per-event JSON map (web `Record<string, unknown> | null`) round-tripped
 * verbatim — not unit-bearing, so no SI conversion here.
 */
@Serializable
public data class GuardEvent(
    val id: Long,
    @SerialName("vehicle_id") val vehicleId: Long,
    val ts: String,
    @SerialName("event_type") val eventType: String,
    @SerialName("from_state") val fromState: String? = null,
    @SerialName("to_state") val toState: String? = null,
    val details: JsonObject? = null,
    @SerialName("acknowledged_at") val acknowledgedAt: String? = null,
    @SerialName("acknowledged_by") val acknowledgedBy: String? = null,
)

/**
 * Envelope returned by `GET /vehicles/{id}/guard/events` — the port of the web
 * `GuardEventsResponse` interface, mirroring `guard_handler.go::GuardEventsResponse`. The envelope
 * echoes [vehicleId] alongside the [events] array; consumers MUST NOT assume the response is a bare
 * array. The S8 holder unwraps it through [guardEventsOf] (the web `safeArray(data?.events)` select
 * analogue), so callers always receive a plain `List<GuardEvent>`. [events] defaults to empty so a
 * payload missing the key still decodes.
 */
@Serializable
public data class GuardEventsResponse(
    @SerialName("vehicle_id") val vehicleId: Long,
    val events: List<GuardEvent> = emptyList(),
)

/**
 * Response of `POST /vehicles/{id}/guard` — the port of the web `SetConfigResponse`. Carries the
 * persisted [config] plus the per-channel [armResults] map (e.g. command → status string). The map
 * defaults to empty so a response omitting it still decodes.
 */
@Serializable
public data class SetConfigResponse(
    val config: GuardConfig,
    @SerialName("arm_results") val armResults: Map<String, String> = emptyMap(),
)

/**
 * Response of `POST /vehicles/{id}/guard/panic` — the port of the web `PanicResponse`. Carries the
 * per-command [commandResults] map, the list of [notifiedChannels] that were alerted, and the
 * [eventId] of the synthesized panic record. The collection fields default to empty.
 */
@Serializable
public data class PanicResponse(
    @SerialName("command_results") val commandResults: Map<String, String> = emptyMap(),
    @SerialName("notified_channels") val notifiedChannels: List<String> = emptyList(),
    @SerialName("event_id") val eventId: Long,
)

/**
 * Response of `POST /vehicles/{id}/guard/events/{eventID}/acknowledge` — the port of the web
 * `{ status: string }` body.
 */
@Serializable
public data class AcknowledgeResponse(
    val status: String,
)

/**
 * The `POST /vehicles/{id}/guard` body — the port of the web `useSetGuardConfig` mutation argument.
 * Every field is always present on the wire (the web `JSON.stringify` carries an explicit `null` for
 * [homeGeofenceId] rather than dropping the key). [vehicleId] is carried in the path, not the body.
 *
 * @property vehicleId the vehicle whose guard config is being set (path parameter).
 * @property enabled whether Sentry-Guard arming is on.
 * @property homeGeofenceId the home fence to disarm inside, or null for none.
 * @property sensitivity the trigger sensitivity (`low` | `medium` | `high`), carried verbatim.
 * @property autoPanic whether a trip outside the home fence auto-triggers a panic.
 */
public data class SetGuardConfigInput(
    val vehicleId: String,
    val enabled: Boolean,
    val homeGeofenceId: Long?,
    val sensitivity: String,
    val autoPanic: Boolean,
)

/**
 * Whether [event] is acknowledged — the canonical port of the web `isGuardEventAcknowledged`
 * helper, derived SOLELY from [GuardEvent.acknowledgedAt] being non-null (a present
 * [GuardEvent.acknowledgedBy] is irrelevant). Locked by golden vectors shared with the Windows C#
 * port so the three platforms cannot drift (ADR-004).
 */
public fun isGuardEventAcknowledged(event: GuardEvent): Boolean = event.acknowledgedAt != null

/**
 * Unwraps the guard-events envelope onto a plain list — the port of the web
 * `select: (data) => safeArray(data?.events)`. A null [response] (the feed has not produced a value)
 * or a payload whose `events` is absent yields the empty list, so a consumer never has to defend
 * against shape drift. Locked by golden vectors shared with the C# port.
 */
public fun guardEventsOf(response: GuardEventsResponse?): List<GuardEvent> = response?.events ?: emptyList()

/**
 * Whether a guard feed for [vehicleId] is enabled — the port of the web hooks' `enabled: vehicleId
 * > 0` gate. Reproduces the numeric predicate exactly: a null, blank, non-numeric, or non-positive
 * id is disabled; only a strictly-positive integer id enables the feed. Locked by golden vectors
 * shared with the C# port.
 */
public fun guardVehicleEnabled(vehicleId: String?): Boolean = (vehicleId?.toLongOrNull() ?: 0L) > 0L
