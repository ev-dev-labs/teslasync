package io.teslasync.shared.core.presentation.vehicleaccess

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The wire shape of one shared-driver row — the cross-platform port of the web `VehicleDriver`
 * interface (web/src/api/types.ts), mirroring the Go vehicle-access handler's row. Keys arrive
 * snake_case from `GET /api/v1/vehicles/{vehicleId}/drivers`; they are matched verbatim via
 * [SerialName] so the cached payload round-trips unchanged.
 *
 * [shareUserId], [driverEmail], [driverName] and [role] are nullable (the server may omit them);
 * [id], [vehicleId] and [fetchedAt] are always present. No field is unit-bearing, so there is no
 * SI conversion at this layer — display formatting is the render boundary's job (S5).
 */
@Serializable
public data class VehicleDriver(
    val id: Long,
    @SerialName("vehicle_id") val vehicleId: Long,
    @SerialName("share_user_id") val shareUserId: Long? = null,
    @SerialName("driver_email") val driverEmail: String? = null,
    @SerialName("driver_name") val driverName: String? = null,
    val role: String? = null,
    @SerialName("fetched_at") val fetchedAt: String,
)

/**
 * The wire shape of one access-invitation row — the cross-platform port of the web
 * `VehicleInvitation` interface (web/src/api/types.ts), mirroring the Go vehicle-access handler's
 * row. Keys arrive snake_case from `GET /api/v1/vehicles/{vehicleId}/invitations`; they are matched
 * verbatim via [SerialName] so the cached payload round-trips unchanged.
 *
 * [inviteUrl], [expiresAt] and [createdBy] are nullable (the server may omit them); the rest are
 * always present. No field is unit-bearing, so there is no SI conversion at this layer — display
 * formatting is the render boundary's job (S5).
 */
@Serializable
public data class VehicleInvitation(
    val id: Long,
    @SerialName("vehicle_id") val vehicleId: Long,
    @SerialName("invitation_id") val invitationId: String,
    @SerialName("invite_url") val inviteUrl: String? = null,
    val status: String,
    @SerialName("expires_at") val expiresAt: String? = null,
    @SerialName("created_by") val createdBy: String? = null,
    @SerialName("fetched_at") val fetchedAt: String,
    @SerialName("created_at") val createdAt: String,
)
