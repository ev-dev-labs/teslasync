package io.teslasync.shared.core.presentation.vehicleaccess

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehicleAccessRepository
import io.teslasync.shared.core.data.repo.vehicleDriversCacheKey
import io.teslasync.shared.core.data.repo.vehicleInvitationsCacheKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for the vehicle-access surface — the cross-platform port of the web
 * `useVehicleAccess` hook domain (web/src/api/hooks/useVehicleAccess.ts). Every native
 * VehicleAccess screen (Android/Apple via KMP, Windows via the C# port) binds to this single holder
 * rather than re-implementing endpoints, query keys, or the per-vehicle invalidation rules.
 *
 * The two reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013), each
 * scoped to one vehicle and lazily created on first access, then shared so every observer of the
 * same vehicle folds into one upstream collection:
 *  - [vehicleDrivers] mirrors the web `useVehicleDrivers(vehicleId)` — the shared-driver list.
 *  - [vehicleInvitations] mirrors the web `useVehicleInvitations(vehicleId)` — the invitation list.
 *
 * The five mutations are non-throwing suspend [Result]s; on success each refreshes ONLY the affected
 * vehicle's affected feed, exactly mirroring which `vehicleAccessKeys.*(id)` tuple the matching web
 * hook invalidates:
 *  - [refreshVehicleDrivers] / [removeVehicleDriver] → refresh the drivers feed only
 *    (web invalidates `vehicleAccessKeys.drivers(id)`);
 *  - [refreshVehicleInvitations] / [createVehicleInvitation] / [revokeVehicleInvitation] → refresh
 *    the invitations feed only (web invalidates `vehicleAccessKeys.invitations(id)`).
 * A failed mutation refreshes nothing (the web `onError` skips invalidation). The repository (S7)
 * evicts the same key on the same success, so each refresh re-fetches rather than replaying a stale
 * entry. Toasts are a render-layer concern (web `useMutationToast`) and are intentionally NOT
 * reproduced here. The holder makes no network calls itself.
 *
 * This holder mirrors the web hook's single-threaded usage and is not internally synchronised;
 * create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port every feed and mutation is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class VehicleAccessStore(
    private val repo: VehicleAccessRepository,
    private val scope: CoroutineScope,
) {
    private val driverTriggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val driverFeeds = mutableMapOf<String, StateFlow<Resource<List<VehicleDriver>>>>()
    private val invitationTriggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val invitationFeeds = mutableMapOf<String, StateFlow<Resource<List<VehicleInvitation>>>>()

    // ---- Reads --------------------------------------------------------------------

    /**
     * Shared, refreshable `GET /vehicles/{vehicleId}/drivers` feed for [vehicleId] (web
     * `useVehicleDrivers`). The same `vehicleId` always returns the same feed; bumping its trigger
     * (via [refreshDriversFeed]) restarts its cache-then-network collection.
     */
    public fun vehicleDrivers(vehicleId: String): StateFlow<Resource<List<VehicleDriver>>> {
        val key = vehicleDriversCacheKey(vehicleId)
        return driverFeeds.getOrPut(key) {
            trigger(driverTriggers, key)
                .flatMapLatest { repo.vehicleDrivers(vehicleId) }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = DRIVERS_INITIAL,
                )
        }
    }

    /**
     * Shared, refreshable `GET /vehicles/{vehicleId}/invitations` feed for [vehicleId] (web
     * `useVehicleInvitations`). The same `vehicleId` always returns the same feed; bumping its
     * trigger (via [refreshInvitationsFeed]) restarts its cache-then-network collection.
     */
    public fun vehicleInvitations(vehicleId: String): StateFlow<Resource<List<VehicleInvitation>>> {
        val key = vehicleInvitationsCacheKey(vehicleId)
        return invitationFeeds.getOrPut(key) {
            trigger(invitationTriggers, key)
                .flatMapLatest { repo.vehicleInvitations(vehicleId) }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = INVITATIONS_INITIAL,
                )
        }
    }

    // ---- Mutations ----------------------------------------------------------------

    /**
     * Re-syncs the driver list from Tesla, then refreshes that vehicle's drivers feed on success
     * (web `useRefreshVehicleDrivers`, which invalidates `vehicleAccessKeys.drivers(id)`). A failed
     * refresh refreshes nothing.
     */
    public suspend fun refreshVehicleDrivers(vehicleId: String): Result<List<VehicleDriver>> =
        repo.refreshVehicleDrivers(vehicleId).onSuccess { refreshDriversFeed(vehicleId) }

    /**
     * Re-syncs the invitation list from Tesla, then refreshes that vehicle's invitations feed on
     * success (web `useRefreshVehicleInvitations`, which invalidates
     * `vehicleAccessKeys.invitations(id)`). A failed refresh refreshes nothing.
     */
    public suspend fun refreshVehicleInvitations(vehicleId: String): Result<List<VehicleInvitation>> =
        repo.refreshVehicleInvitations(vehicleId).onSuccess { refreshInvitationsFeed(vehicleId) }

    /**
     * Removes the shared driver [shareUserId] from [vehicleId], then refreshes that vehicle's
     * drivers feed on success (web `useRemoveVehicleDriver`, which invalidates
     * `vehicleAccessKeys.drivers(id)`). A failed remove refreshes nothing.
     */
    public suspend fun removeVehicleDriver(
        vehicleId: String,
        shareUserId: Long,
    ): Result<Unit> = repo.removeVehicleDriver(vehicleId, shareUserId).onSuccess { refreshDriversFeed(vehicleId) }

    /**
     * Mints a new access invitation for [vehicleId], then refreshes that vehicle's invitations feed
     * on success (web `useCreateVehicleInvitation`, which invalidates
     * `vehicleAccessKeys.invitations(id)`). A failed create refreshes nothing.
     */
    public suspend fun createVehicleInvitation(vehicleId: String): Result<VehicleInvitation> =
        repo.createVehicleInvitation(vehicleId).onSuccess { refreshInvitationsFeed(vehicleId) }

    /**
     * Revokes the pending invitation [invitationId] on [vehicleId], then refreshes that vehicle's
     * invitations feed on success (web `useRevokeVehicleInvitation`, which invalidates
     * `vehicleAccessKeys.invitations(id)`). A failed revoke refreshes nothing.
     */
    public suspend fun revokeVehicleInvitation(
        vehicleId: String,
        invitationId: String,
    ): Result<Unit> = repo.revokeVehicleInvitation(vehicleId, invitationId).onSuccess { refreshInvitationsFeed(vehicleId) }

    // ---- Refresh (invalidation analogues) -----------------------------------------

    /**
     * Re-fetches the drivers feed for [vehicleId] — the holder-side analogue of invalidating
     * `vehicleAccessKeys.drivers(id)`. Bumping the vehicle's trigger restarts its cache-then-network
     * collection. A vehicle nobody is observing is a no-op.
     */
    public fun refreshDriversFeed(vehicleId: String) {
        driverTriggers[vehicleDriversCacheKey(vehicleId)]?.update { n -> n + 1 }
    }

    /**
     * Re-fetches the invitations feed for [vehicleId] — the holder-side analogue of invalidating
     * `vehicleAccessKeys.invitations(id)`. Bumping the vehicle's trigger restarts its
     * cache-then-network collection. A vehicle nobody is observing is a no-op.
     */
    public fun refreshInvitationsFeed(vehicleId: String) {
        invitationTriggers[vehicleInvitationsCacheKey(vehicleId)]?.update { n -> n + 1 }
    }

    // ---- Internals ----------------------------------------------------------------

    private fun trigger(
        triggers: MutableMap<String, MutableStateFlow<Int>>,
        key: String,
    ): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val DRIVERS_INITIAL: Resource<List<VehicleDriver>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
        val INVITATIONS_INITIAL: Resource<List<VehicleInvitation>> =
            Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
