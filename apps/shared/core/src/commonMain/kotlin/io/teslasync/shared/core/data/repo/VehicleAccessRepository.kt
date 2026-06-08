package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.vehicleaccess.VehicleDriver
import io.teslasync.shared.core.presentation.vehicleaccess.VehicleInvitation
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/**
 * The S7 data port for the vehicle-access surface — the cross-platform analogue of the web
 * `useVehicleAccess` hook domain (web/src/api/hooks/useVehicleAccess.ts). Every native
 * VehicleAccess screen (Android/Apple via KMP, Windows via the C# port) reaches the backend
 * exclusively through this interface, so a single fake stands in for the whole domain in the S8
 * state-holder tests.
 *
 * The two reads stream a cache-then-network [Resource] (ADR-013), each scoped to one vehicle:
 *  - [vehicleDrivers] — `GET /vehicles/{vehicleId}/drivers`, the vehicle's shared-driver rows (web
 *    `useVehicleDrivers`). Cached under [vehicleDriversCacheKey]. Always resolves to an array (the
 *    web `select: safeArray`).
 *  - [vehicleInvitations] — `GET /vehicles/{vehicleId}/invitations`, the vehicle's pending access
 *    invitations (web `useVehicleInvitations`). Cached under [vehicleInvitationsCacheKey]. Always
 *    resolves to an array (the web `select: safeArray`).
 *
 * Both web reads carry `staleTime: STALE_TIMES.STANDARD` (60s), which the [CacheDomain.VehicleAccess]
 * default TTL ([VEHICLE_ACCESS_TTL_MILLIS]) matches verbatim, so neither read needs a per-entry TTL
 * override.
 *
 * The five mutations are non-throwing suspend [Result]s. On success each evicts ONLY the affected
 * vehicle's feed key — the driver-facing actions ([refreshVehicleDrivers], [removeVehicleDriver])
 * evict [vehicleDriversCacheKey]; the invitation-facing actions ([refreshVehicleInvitations],
 * [createVehicleInvitation], [revokeVehicleInvitation]) evict [vehicleInvitationsCacheKey] — exactly
 * as the web hooks invalidate ONLY `vehicleAccessKeys.drivers(id)` or
 * `vehicleAccessKeys.invitations(id)` for their respective action, never the other feed and never
 * another vehicle. The matching S8 store refresh then re-fetches that one feed rather than replaying
 * a stale entry.
 *
 * Driver / invitation fields (ids, emails, roles, urls, statuses, ISO stamps) are plain and not
 * unit-bearing, so they round-trip verbatim with no SI conversion.
 */
public interface VehicleAccessRepository {
    /**
     * `GET /vehicles/{vehicleId}/drivers` — every shared driver for [vehicleId] (web
     * `useVehicleDrivers`). The cache key is built by [vehicleDriversCacheKey], mirroring the web
     * `vehicleAccessKeys.drivers` tuple. Always resolves to an array (never null).
     */
    public fun vehicleDrivers(vehicleId: String): Flow<Resource<List<VehicleDriver>>>

    /**
     * `GET /vehicles/{vehicleId}/invitations` — every access invitation for [vehicleId] (web
     * `useVehicleInvitations`). The cache key is built by [vehicleInvitationsCacheKey], mirroring the
     * web `vehicleAccessKeys.invitations` tuple. Always resolves to an array (never null).
     */
    public fun vehicleInvitations(vehicleId: String): Flow<Resource<List<VehicleInvitation>>>

    /**
     * `POST /vehicles/{vehicleId}/drivers/refresh` — re-syncs the driver list from Tesla (web
     * `useRefreshVehicleDrivers`). Returns the freshly fetched rows. On success the affected
     * vehicle's [vehicleDriversCacheKey] is evicted (the web
     * `invalidateQueries(vehicleAccessKeys.drivers(id))`).
     */
    public suspend fun refreshVehicleDrivers(vehicleId: String): Result<List<VehicleDriver>>

    /**
     * `POST /vehicles/{vehicleId}/invitations/refresh` — re-syncs the invitation list from Tesla
     * (web `useRefreshVehicleInvitations`). Returns the freshly fetched rows. On success the
     * affected vehicle's [vehicleInvitationsCacheKey] is evicted (the web
     * `invalidateQueries(vehicleAccessKeys.invitations(id))`).
     */
    public suspend fun refreshVehicleInvitations(vehicleId: String): Result<List<VehicleInvitation>>

    /**
     * `DELETE /vehicles/{vehicleId}/drivers` — removes a shared driver (web
     * `useRemoveVehicleDriver`). The body carries the `share_user_id` to revoke (built by
     * [removeVehicleDriverBody]). On success the affected vehicle's [vehicleDriversCacheKey] is
     * evicted (the web `invalidateQueries(vehicleAccessKeys.drivers(id))`).
     */
    public suspend fun removeVehicleDriver(
        vehicleId: String,
        shareUserId: Long,
    ): Result<Unit>

    /**
     * `POST /vehicles/{vehicleId}/invitations` — mints a new access invitation (web
     * `useCreateVehicleInvitation`). Returns the created row. On success the affected vehicle's
     * [vehicleInvitationsCacheKey] is evicted (the web
     * `invalidateQueries(vehicleAccessKeys.invitations(id))`).
     */
    public suspend fun createVehicleInvitation(vehicleId: String): Result<VehicleInvitation>

    /**
     * `POST /vehicles/{vehicleId}/invitations/{invitationId}/revoke` — revokes a pending invitation
     * (web `useRevokeVehicleInvitation`). On success the affected vehicle's
     * [vehicleInvitationsCacheKey] is evicted (the web
     * `invalidateQueries(vehicleAccessKeys.invitations(id))`).
     */
    public suspend fun revokeVehicleInvitation(
        vehicleId: String,
        invitationId: String,
    ): Result<Unit>
}

/**
 * Builds the stable cache/feed key for a vehicle's shared-driver list, mirroring the web
 * `vehicleAccessKeys.drivers` tuple `['vehicle-drivers', id]`. Prefixed with `vehicle-drivers:` so
 * it can never collide with a [vehicleInvitationsCacheKey] sharing the same partition. Locked by
 * golden vectors shared with the C# port.
 */
public fun vehicleDriversCacheKey(vehicleId: String): String = "vehicle-drivers:$vehicleId"

/**
 * Builds the stable cache/feed key for a vehicle's invitation list, mirroring the web
 * `vehicleAccessKeys.invitations` tuple `['vehicle-invitations', id]`. Prefixed with
 * `vehicle-invitations:` so it can never collide with a [vehicleDriversCacheKey] in the same
 * partition. Locked by golden vectors shared with the C# port.
 */
public fun vehicleInvitationsCacheKey(vehicleId: String): String = "vehicle-invitations:$vehicleId"

/**
 * Builds the `DELETE /vehicles/{vehicleId}/drivers` body, mirroring the web
 * `JSON.stringify({ share_user_id: shareUserId })`: a single snake_case `share_user_id` key
 * carrying the numeric share-user id, matching the Go handler. Locked by golden vectors shared with
 * the C# port.
 */
public fun removeVehicleDriverBody(shareUserId: Long): JsonObject =
    buildJsonObject {
        put("share_user_id", JsonPrimitive(shareUserId))
    }

/**
 * Per-entity staleness threshold for both vehicle-access reads — the web `useVehicleDrivers` /
 * `useVehicleInvitations` `staleTime` (`STALE_TIMES.STANDARD` = 60s). Matches the
 * [CacheDomain.VehicleAccess] default, so it is the domain window rather than a per-read override.
 */
public const val VEHICLE_ACCESS_TTL_MILLIS: Long = 60_000L
