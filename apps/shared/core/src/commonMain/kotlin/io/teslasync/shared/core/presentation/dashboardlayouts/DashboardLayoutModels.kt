package io.teslasync.shared.core.presentation.dashboardlayouts

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull

/**
 * The wire shape of one named dashboard layout — the cross-platform port of the web
 * `NamedDashboardLayout` interface (web/src/api/hooks/useDashboardLayouts.ts), itself mirroring the
 * Go `dashboardmodel.DashboardLayout` struct (internal/models/dashboard/dashboard_layout.go). Keys
 * arrive snake_case from `GET /api/v1/dashboard/layouts`; they are matched verbatim via
 * [SerialName] so the cached payload round-trips unchanged.
 *
 * [id], [name], [isDefault], and the timestamps are always present; [userId]/[vehicleId] are
 * nullable (a `vehicle_id` NULL row is a user-global layout). [layout] is the opaque SavedDashboard
 * JSON blob (widgets / grid placement / per-widget config) the frontend produces — carried as a
 * raw [JsonElement] and round-tripped verbatim, exactly as the web hook keeps it `unknown` and
 * narrows it at the consumer. No field is unit-bearing, so there is no SI conversion at this
 * layer — display formatting is the render boundary's job (S5).
 */
@Serializable
public data class NamedDashboardLayout(
    val id: Long,
    @SerialName("user_id") val userId: Long? = null,
    @SerialName("vehicle_id") val vehicleId: Long? = null,
    val name: String,
    @SerialName("is_default") val isDefault: Boolean = false,
    val layout: JsonElement = JsonNull,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String,
)

/**
 * The `POST /dashboard/layouts` body — the port of the web `CreateDashboardLayoutInput`. [name] and
 * [layout] are required by the server; [vehicleId] and [isDefault] are optional and only carried on
 * the wire when supplied (mirroring `JSON.stringify` dropping `undefined` keys). [layout] is the
 * opaque SavedDashboard blob sent verbatim.
 */
public data class CreateDashboardLayoutInput(
    val name: String,
    val layout: JsonElement,
    val vehicleId: Long? = null,
    val isDefault: Boolean? = null,
)

/**
 * The `PUT /dashboard/layouts/{id}` body — the port of the web `UpdateDashboardLayoutInput`. Every
 * mutable field is optional so a partial update only sends what changed (the web spreads
 * `{ id, ...patch }` and sends `patch`); scope (`user_id`, `vehicle_id`) is immutable server-side.
 *
 * @property id the layout to update (carried in the path, not the body).
 */
public data class UpdateDashboardLayoutInput(
    val id: Long,
    val name: String? = null,
    val isDefault: Boolean? = null,
    val layout: JsonElement? = null,
)
