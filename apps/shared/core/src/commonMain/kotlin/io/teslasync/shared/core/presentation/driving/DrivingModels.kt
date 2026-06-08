package io.teslasync.shared.core.presentation.driving

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * A start/destination/waypoint point in a trip-plan request — the cross-platform port of the web
 * `TripLocation` (web/src/types/driving.ts). Plain WGS84 lat/lng degrees plus a display name; not
 * a stored SI column, so the Phase-48 unit-suffix rule does not apply.
 */
@Serializable
public data class TripLocation(
    @SerialName("lat") val lat: Double,
    @SerialName("lng") val lng: Double,
    @SerialName("name") val name: String,
)

/**
 * Optional tuning knobs for a trip plan — the port of the web `TripPlanPreferences`. Every field
 * is optional; the networking client's `explicitNulls = false` JSON drops the nulls, so the wire
 * body matches the web `JSON.stringify(params)` exactly (which omits `undefined` keys).
 */
@Serializable
public data class TripPlanPreferences(
    @SerialName("max_charge_stops") val maxChargeStops: Int? = null,
    @SerialName("speed_factor") val speedFactor: Double? = null,
    @SerialName("include_weather") val includeWeather: Boolean? = null,
    @SerialName("prefer_superchargers") val preferSuperchargers: Boolean? = null,
)

/**
 * The `POST /trip-planner/plan` body — the cross-platform port of the web `TripPlanRequest`,
 * consumed by the web `usePlanTrip` mutation. Keys are snake_case, matching the Go trip-planner
 * request shape. SoC values are integer percentages; distances/durations inside the returned plan
 * stay SI (meters, seconds) — this is the request body, not a stored unit-suffixed DB/Go field,
 * so the Phase-48 SI-canonical rule does not apply here.
 */
@Serializable
public data class TripPlanRequest(
    @SerialName("vehicle_id") val vehicleId: Long,
    @SerialName("origin") val origin: TripLocation,
    @SerialName("destination") val destination: TripLocation,
    @SerialName("current_soc") val currentSoc: Int,
    @SerialName("charge_limit_soc") val chargeLimitSoc: Int,
    @SerialName("min_arrival_soc") val minArrivalSoc: Int,
    @SerialName("waypoints") val waypoints: List<TripLocation>? = null,
    @SerialName("departure_time") val departureTime: String? = null,
    @SerialName("preferences") val preferences: TripPlanPreferences? = null,
)
