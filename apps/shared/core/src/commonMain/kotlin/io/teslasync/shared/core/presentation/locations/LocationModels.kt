package io.teslasync.shared.core.presentation.locations

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The wire shape of one visited location — the cross-platform port of the post-migration backend
 * `VisitedLocation` interface (web/src/api/types.ts), itself mirroring the Go row behind
 * `GET /api/v1/locations`. (The legacy camelCase `Location` interface in web/src/types/location.ts
 * that the web `useLocations` hook still imports for TS-compile reasons is reconciled at runtime by
 * `camelCaseKeys`, which keeps BOTH casings; this port models the canonical snake_case wire shape.)
 * Keys arrive snake_case; they are matched verbatim via [SerialName] so the cached payload
 * round-trips unchanged.
 *
 * [addressId] and [lastVisited] are nullable (a location with no resolved address / never revisited).
 * [totalDurationS] is SI seconds — it is NOT converted here; display formatting (e.g. "2 h 5 min") is
 * the render boundary's job (S5). [latitude]/[longitude] are degrees, also carried verbatim.
 */
@Serializable
public data class VisitedLocation(
    val id: Long,
    @SerialName("vehicle_id") val vehicleId: Long,
    @SerialName("address_id") val addressId: Long? = null,
    @SerialName("address_name") val addressName: String,
    @SerialName("visit_count") val visitCount: Long = 0,
    @SerialName("total_duration_s") val totalDurationS: Long = 0,
    @SerialName("last_visited") val lastVisited: String? = null,
    @SerialName("created_at") val createdAt: String,
)

/**
 * The wire shape of one geofence — the cross-platform port of the backend `models.Geofence`
 * (internal/models/system/system.go) as emitted by `GET /api/v1/geofences`. The Go `MarshalJSON`
 * augments the persisted columns (`id`, `name`, `polygon_wkt`, `category`, `enabled`,
 * `alert_on_entry`, `alert_on_exit`, timestamps) with the derived circle-shape fields
 * ([latitude]/[longitude] centroid degrees, [radius] bounding meters) the map clients consume, so all
 * three are modelled here. (The legacy web `Geofence` type declares a `costPerKwh` the backend never
 * emits; it is intentionally omitted so this port matches the real wire shape, not the drifted UI
 * type.) Keys are matched verbatim via [SerialName].
 *
 * [category] is nullable (`category,omitempty` — no category assigned). [radius] is SI meters and is
 * NOT converted here; display formatting is the render boundary's job (S5).
 */
@Serializable
public data class Geofence(
    val id: Long,
    val name: String,
    @SerialName("polygon_wkt") val polygonWkt: String,
    val category: String? = null,
    val enabled: Boolean = false,
    @SerialName("alert_on_entry") val alertOnEntry: Boolean = false,
    @SerialName("alert_on_exit") val alertOnExit: Boolean = false,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String,
    val latitude: Double = 0.0,
    val longitude: Double = 0.0,
    val radius: Double = 0.0,
)

/**
 * The `POST /geofences/bulk` response — the port of the web `GeofenceBulkResult` interface
 * (web/src/api/hooks/useLocations.ts), mirroring the Go `apibulk.OperationResult` for the delete
 * verb. [deleted] is the count actually removed (the backend always emits it for `op=delete`, but it
 * defaults to 0 so a compact body still decodes); [failed] lists the ids that were not found, always
 * present (possibly empty) so a consumer can render an unconditional "failed: N" badge.
 */
@Serializable
public data class GeofenceBulkResult(
    val deleted: Long = 0,
    val failed: List<GeofenceBulkFailure> = emptyList(),
)

/**
 * One entry in a [GeofenceBulkResult.failed] list — the port of the web
 * `{ id: number; reason: string }` shape, mirroring the Go `apibulk.FailedID`. [reason] is a
 * free-form server string (today only `"not_found"`); the UI must use lookup-with-fallback for
 * labels, never exhaustive switching.
 */
@Serializable
public data class GeofenceBulkFailure(
    val id: Long,
    val reason: String,
)

/**
 * Whether the visited-locations feed for [vehicleId] is enabled — the port of the web
 * `useLocations` hook's `enabled: !!vehicleId` gate (web/src/api/hooks/useLocations.ts). Reproduces
 * the JavaScript truthiness of a string exactly: a null or empty id is disabled; ANY non-empty
 * string (including `"0"` or whitespace, which JS treats as truthy) enables the feed. Locked by
 * golden vectors shared with the Windows C# port so the three platforms cannot drift (ADR-004).
 */
public fun locationsEnabled(vehicleId: String?): Boolean = !vehicleId.isNullOrEmpty()
