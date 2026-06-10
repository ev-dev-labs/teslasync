package io.teslasync.shared.core.presentation.sharing

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The wire shape of one share-link row — the cross-platform port of the web `ShareToken`
 * interface (web/src/types/sharing.ts), mirroring the Go `share` handler's row. Keys arrive
 * snake_case from `GET /api/v1/drives/{driveID}/shares`; they are matched verbatim via
 * [SerialName] so the cached payload round-trips unchanged.
 *
 * [createdBy], [title], [description] and [expiresAt] are nullable (the server may omit them);
 * the three `include_*` booleans and [views] are always present. No field is unit-bearing, so
 * there is no SI conversion at this layer — display formatting is the render boundary's job (S5).
 */
@Serializable
public data class ShareToken(
    val id: Long,
    val token: String,
    @SerialName("drive_id") val driveId: Long,
    @SerialName("created_by") val createdBy: String? = null,
    val title: String? = null,
    val description: String? = null,
    @SerialName("include_map") val includeMap: Boolean,
    @SerialName("include_telemetry") val includeTelemetry: Boolean,
    @SerialName("include_speed") val includeSpeed: Boolean,
    val views: Int,
    @SerialName("expires_at") val expiresAt: String? = null,
    @SerialName("created_at") val createdAt: String,
)

/**
 * The `POST /drives/{driveID}/share` request body — the port of the web `CreateShareRequest`.
 * Every field is optional; only the supplied ones are carried on the wire (mirroring the web
 * `JSON.stringify(data)` dropping `undefined` keys, see
 * [io.teslasync.shared.core.data.repo.createShareBody]). Field names are snake_case, matching the
 * Go handler.
 */
public data class CreateShareRequest(
    val title: String? = null,
    val description: String? = null,
    val includeSpeed: Boolean? = null,
    val includeTelemetry: Boolean? = null,
    val expiresInDays: Int? = null,
)

/**
 * The `POST /drives/{driveID}/share` response — the port of the web `CreateShareResponse`. Carries
 * the freshly minted [token], its public [url], and the row [id]. The web mutation returns this for
 * the caller to copy/share; the S8 store surfaces it as the mutation `Result`'s success value.
 */
@Serializable
public data class CreateShareResponse(
    val token: String,
    val url: String,
    val id: Long,
)

/**
 * The public shared-drive report fetched from `GET /api/v1/share/{token}` — the cross-platform port
 * of the web `SharedDriveData | SharedDriveDataV1` union (web/src/types/sharing.ts). The endpoint
 * is mounted BEFORE the auth middleware on the backend (the token IS the auth), so the read needs
 * no credential.
 *
 * The payload comes in two shapes, discriminated by the presence of the `payload_version` key
 * ([io.teslasync.shared.core.data.repo.sharedDriveIsCanonical]):
 *  - [SharedDriveData] — the SI-canonical shape (`distance_m`, `duration_s`, `*_mps`,
 *    `efficiency_wh_per_m`), always carrying `payload_version`;
 *  - [SharedDriveDataV1] — the legacy pre-SI shape (`distance_km`, `duration_min`, `*_kmh`,
 *    `efficiency_wh_km`), with no `payload_version`. It is preserved verbatim for parity with the
 *    web hook during the share-link SI transition; new producers emit only the canonical shape.
 *
 * Decoded through [io.teslasync.shared.core.data.repo.SharedDriveSerializer]. Canonical values are
 * SI on the wire and converted only at the render boundary (S5); the legacy variant's values are
 * passed through verbatim exactly as the web hook returns them.
 */
public sealed interface SharedDrive

// ---- v2: SI-canonical shape -------------------------------------------------------

/** The SI-canonical shared-drive report (web `SharedDriveData`). Carries `payload_version`. */
@Serializable
public data class SharedDriveData(
    @SerialName("payload_version") val payloadVersion: String,
    val title: String,
    val description: String,
    val drive: SharedDriveInfo,
    val vehicle: SharedVehicle? = null,
    @SerialName("map_points") val mapPoints: List<SharedMapPoint>? = null,
    @SerialName("elevation_profile") val elevationProfile: List<SharedElevationPoint>? = null,
    @SerialName("speed_profile") val speedProfile: List<SharedSpeedPoint>? = null,
    val telemetry: List<SharedTelemetryPoint>? = null,
) : SharedDrive

/** The SI-canonical drive summary (web `SharedDriveInfo`): metres, seconds, m/s, Wh/m. */
@Serializable
public data class SharedDriveInfo(
    val date: String,
    @SerialName("distance_m") val distanceM: Double,
    @SerialName("duration_s") val durationS: Double,
    @SerialName("start_address") val startAddress: String,
    @SerialName("end_address") val endAddress: String,
    @SerialName("start_battery") val startBattery: Double? = null,
    @SerialName("end_battery") val endBattery: Double? = null,
    @SerialName("elevation_gain") val elevationGain: Double? = null,
    @SerialName("elevation_loss") val elevationLoss: Double? = null,
    @SerialName("max_speed_mps") val maxSpeedMps: Double? = null,
    @SerialName("avg_speed_mps") val avgSpeedMps: Double? = null,
    @SerialName("efficiency_wh_per_m") val efficiencyWhPerM: Double? = null,
)

/** A point on the route polyline (web `SharedMapPoint`). */
@Serializable
public data class SharedMapPoint(
    val lat: Double,
    val lng: Double,
)

/** A point on the SI elevation profile (web `SharedElevationPoint`): distance in metres. */
@Serializable
public data class SharedElevationPoint(
    @SerialName("distance_m") val distanceM: Double,
    @SerialName("elevation_m") val elevationM: Double,
)

/** A point on the SI speed profile (web `SharedSpeedPoint`): distance in metres, speed in m/s. */
@Serializable
public data class SharedSpeedPoint(
    @SerialName("distance_m") val distanceM: Double,
    @SerialName("speed_mps") val speedMps: Double,
)

/** A point on the SI telemetry track (web `SharedTelemetryPoint`): distance in metres. */
@Serializable
public data class SharedTelemetryPoint(
    @SerialName("distance_m") val distanceM: Double,
    @SerialName("battery_level") val batteryLevel: Double? = null,
    val power: Double? = null,
    val elevation: Double? = null,
)

/** The vehicle badge on a shared report (web `SharedVehicle`); shared by both payload shapes. */
@Serializable
public data class SharedVehicle(
    val model: String,
    val color: String,
)

// ---- v1: legacy pre-SI shape ------------------------------------------------------

/**
 * The legacy pre-SI shared-drive report (web `SharedDriveDataV1`). It carries no `payload_version`
 * and its drive summary / profiles use the pre-SI unit-suffixed field names (`*_km`, `*_kmh`).
 * Preserved verbatim ONLY for parity with the web hook's union during the share-link SI
 * transition; new producers emit the canonical [SharedDriveData] shape instead.
 */
@Serializable
public data class SharedDriveDataV1(
    val title: String,
    val description: String,
    val drive: SharedDriveInfoV1,
    val vehicle: SharedVehicle? = null,
    @SerialName("map_points") val mapPoints: List<SharedMapPoint>? = null,
    @SerialName("elevation_profile") val elevationProfile: List<SharedElevationPointV1>? = null,
    @SerialName("speed_profile") val speedProfile: List<SharedSpeedPointV1>? = null,
    val telemetry: List<SharedTelemetryPointV1>? = null,
) : SharedDrive

/** The legacy pre-SI drive summary (web `SharedDriveDataV1.drive`): kilometres, minutes, km/h. */
@Serializable
public data class SharedDriveInfoV1(
    val date: String,
    @SerialName("distance_km") val distanceKm: Double,
    @SerialName("duration_min") val durationMin: Double,
    @SerialName("start_address") val startAddress: String,
    @SerialName("end_address") val endAddress: String,
    @SerialName("start_battery") val startBattery: Double? = null,
    @SerialName("end_battery") val endBattery: Double? = null,
    @SerialName("elevation_gain") val elevationGain: Double? = null,
    @SerialName("elevation_loss") val elevationLoss: Double? = null,
    @SerialName("max_speed_kmh") val maxSpeedKmh: Double? = null,
    @SerialName("avg_speed_kmh") val avgSpeedKmh: Double? = null,
    @SerialName("efficiency_wh_km") val efficiencyWhKm: Double? = null,
)

/** A point on the legacy elevation profile (distance in kilometres). */
@Serializable
public data class SharedElevationPointV1(
    @SerialName("distance_km") val distanceKm: Double,
    @SerialName("elevation_m") val elevationM: Double,
)

/** A point on the legacy speed profile (distance in kilometres, speed in km/h). */
@Serializable
public data class SharedSpeedPointV1(
    @SerialName("distance_km") val distanceKm: Double,
    @SerialName("speed_kmh") val speedKmh: Double,
)

/** A point on the legacy telemetry track (distance in kilometres). */
@Serializable
public data class SharedTelemetryPointV1(
    @SerialName("distance_km") val distanceKm: Double,
    @SerialName("battery_level") val batteryLevel: Double? = null,
    val power: Double? = null,
    val elevation: Double? = null,
)
