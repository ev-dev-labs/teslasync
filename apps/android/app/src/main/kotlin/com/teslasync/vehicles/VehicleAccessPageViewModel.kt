// The state holder backing the VehicleAccessPage vehicles surface (P1/S8) — the native counterpart of the web
// page's React state + TanStack-Query hooks (web/src/features/vehicles/pages/VehicleAccessPage.tsx). It owns the
// page's local interaction state (the two confirm-dialog targets + the per-action in-flight flags) and projects the
// three cache-then-network reads onto the shared lifecycle-aware [UiState] surface via [BaseFeedViewModel.asUiState]:
//   - [vehicleState]      mirrors web `useVehicle(id)`        — the parent vehicle, for the breadcrumb label;
//   - [driversState]      mirrors web `useVehicleDrivers(id)` — the shared-driver list (loading/empty/success);
//   - [invitationsState]  mirrors web `useVehicleInvitations(id)` — the invitation list (loading/empty/success).
//
// The five mutations reproduce the web hooks' per-feed invalidation exactly: a driver-facing action
// ([refreshDrivers] / [confirmRemoveDriver]) re-collects ONLY the drivers feed on success (web invalidates
// `vehicleAccessKeys.drivers(id)`); an invitation-facing action ([refreshInvitations] / [createInvitation] /
// [confirmRevokeInvitation]) re-collects ONLY the invitations feed (web invalidates
// `vehicleAccessKeys.invitations(id)`). A failed mutation re-collects nothing (the web `onError` skips
// invalidation). Each mutation guards against a double-fire and surfaces an in-flight flag (web per-mutation
// `isPending`) the render layer wires to the matching button/dialog spinner. Toasts are a render-layer concern (web
// `useMutationToast`) and are intentionally NOT reproduced here; this holder performs no HTTP — it delegates to the
// injected [VehicleAccessPageSource].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehicles) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.vehicles.vehicleaccess

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicleaccess.VehicleDriver
import io.teslasync.shared.core.presentation.vehicleaccess.VehicleInvitation
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (real [VehiclesStore] + [io.teslasync.shared.core.data.repo.VehicleAccessRepository]
 *   adapter ↔ a test fake); the view never performs HTTP.
 * @param vehicleId the vehicle id from the route (web `useParams().id`).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + the five mutation events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehicleAccessPageViewModel(
    private val source: VehicleAccessPageSource,
    val vehicleId: String,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    private val driversTrigger = MutableStateFlow(0)
    private val invitationsTrigger = MutableStateFlow(0)

    private val removeTargetState = MutableStateFlow<VehicleDriver?>(null)
    private val revokeTargetState = MutableStateFlow<VehicleInvitation?>(null)
    private val refreshingDriversState = MutableStateFlow(false)
    private val refreshingInvitationsState = MutableStateFlow(false)
    private val creatingInvitationState = MutableStateFlow(false)
    private val removingDriverState = MutableStateFlow(false)
    private val revokingInvitationState = MutableStateFlow(false)

    /** The driver pending removal, or `null` — backs the remove confirm dialog (web `removeTarget`). */
    val removeTarget: StateFlow<VehicleDriver?> = removeTargetState.asStateFlow()

    /** The invitation pending revocation, or `null` — backs the revoke confirm dialog (web `revokeTarget`). */
    val revokeTarget: StateFlow<VehicleInvitation?> = revokeTargetState.asStateFlow()

    /** `true` while the drivers refresh is in flight (web `refreshDrivers.isPending`). */
    val refreshingDrivers: StateFlow<Boolean> = refreshingDriversState.asStateFlow()

    /** `true` while the invitations refresh is in flight (web `refreshInvitations.isPending`). */
    val refreshingInvitations: StateFlow<Boolean> = refreshingInvitationsState.asStateFlow()

    /** `true` while the create-invitation mutation is in flight (web `createInvitation.isPending`). */
    val creatingInvitation: StateFlow<Boolean> = creatingInvitationState.asStateFlow()

    /** `true` while the remove-driver mutation is in flight — spins the dialog confirm button. */
    val removingDriver: StateFlow<Boolean> = removingDriverState.asStateFlow()

    /** `true` while the revoke-invitation mutation is in flight — spins the dialog confirm button. */
    val revokingInvitation: StateFlow<Boolean> = revokingInvitationState.asStateFlow()

    /**
     * The parent vehicle as cache-then-network UI state (web `useVehicle(id)`), surfaced only for the breadcrumb
     * label. A vehicle is never structurally "empty", so the empty predicate is constant-false; while it loads or
     * hard-fails the render layer falls back to the "Vehicle #id" label (web `vehicle?.display_name ?? …`).
     */
    val vehicleState: StateFlow<UiState<Vehicle>> =
        source.vehicle(vehicleId).asUiState(isEmpty = { false })

    /**
     * The shared-driver list as cache-then-network UI state (web `useVehicleDrivers`). Re-collected when the drivers
     * trigger bumps (a successful driver mutation, or the retry affordance). An empty list resolves to
     * [io.teslasync.android.data.UiPhase.Empty] (the panel's empty state); a non-empty one to
     * [io.teslasync.android.data.UiPhase.Content] (the DataTable).
     */
    val driversState: StateFlow<UiState<List<VehicleDriver>>> =
        driversTrigger
            .flatMapLatest { source.vehicleDrivers(vehicleId) }
            .asUiState(isEmpty = { it.isEmpty() })

    /**
     * The access-invitation list as cache-then-network UI state (web `useVehicleInvitations`). Re-collected when the
     * invitations trigger bumps (a successful invitation mutation, or the retry affordance). Empty → the panel's
     * empty state; non-empty → the DataTable.
     */
    val invitationsState: StateFlow<UiState<List<VehicleInvitation>>> =
        invitationsTrigger
            .flatMapLatest { source.vehicleInvitations(vehicleId) }
            .asUiState(isEmpty = { it.isEmpty() })

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordVehicleAccessPageOpened(logger)
    }

    /**
     * Re-syncs the driver list from Tesla (web `refreshDrivers.mutate(vehicleId)`), then re-collects ONLY the drivers
     * feed on success. Guards against a double-fire while one refresh is in flight.
     */
    fun refreshDrivers() {
        if (refreshingDriversState.value) return
        refreshingDriversState.update { true }
        logger.info(EVENT_REFRESH_DRIVERS, surfaceField)
        launch {
            source.refreshVehicleDrivers(vehicleId).onSuccess { bumpDrivers() }
            refreshingDriversState.update { false }
        }
    }

    /**
     * Re-syncs the invitation list from Tesla (web `refreshInvitations.mutate(vehicleId)`), then re-collects ONLY the
     * invitations feed on success. Guards against a double-fire while one refresh is in flight.
     */
    fun refreshInvitations() {
        if (refreshingInvitationsState.value) return
        refreshingInvitationsState.update { true }
        logger.info(EVENT_REFRESH_INVITATIONS, surfaceField)
        launch {
            source.refreshVehicleInvitations(vehicleId).onSuccess { bumpInvitations() }
            refreshingInvitationsState.update { false }
        }
    }

    /**
     * Mints a new access invitation (web `createInvitation.mutate(vehicleId)`), then re-collects ONLY the invitations
     * feed on success. Guards against a double-fire while one create is in flight.
     */
    fun createInvitation() {
        if (creatingInvitationState.value) return
        creatingInvitationState.update { true }
        logger.info(EVENT_CREATE_INVITATION, surfaceField)
        launch {
            source.createVehicleInvitation(vehicleId).onSuccess { bumpInvitations() }
            creatingInvitationState.update { false }
        }
    }

    /** Opens the remove-driver confirm dialog for [driver] (web `setRemoveTarget(row)`). */
    fun requestRemoveDriver(driver: VehicleDriver) {
        removeTargetState.update { driver }
    }

    /** Dismisses the remove-driver confirm dialog without acting (web `onCancel`). */
    fun cancelRemoveDriver() {
        if (removingDriverState.value) return
        removeTargetState.update { null }
    }

    /**
     * Confirms removal of the targeted driver (web `handleRemoveDriver`): removes the shared driver by its
     * `share_user_id`, re-collects ONLY the drivers feed on success, and closes the dialog when the mutation settles
     * (web `onSettled: () => setRemoveTarget(null)`). A driver with no `share_user_id` cannot be removed, so it just
     * closes (web `if (!removeTarget?.share_user_id) return`).
     */
    fun confirmRemoveDriver() {
        if (removingDriverState.value) return
        val shareUserId = removeTargetState.value?.shareUserId
        if (shareUserId == null) {
            // A driver with no share_user_id cannot be removed, so just close (web `if (!share_user_id) return`).
            removeTargetState.update { null }
            return
        }
        removingDriverState.update { true }
        logger.info(EVENT_REMOVE_DRIVER, surfaceField)
        launch {
            source.removeVehicleDriver(vehicleId, shareUserId).onSuccess { bumpDrivers() }
            removingDriverState.update { false }
            removeTargetState.update { null }
        }
    }

    /** Opens the revoke-invitation confirm dialog for [invitation] (web `setRevokeTarget(row)`). */
    fun requestRevokeInvitation(invitation: VehicleInvitation) {
        revokeTargetState.update { invitation }
    }

    /** Dismisses the revoke-invitation confirm dialog without acting (web `onCancel`). */
    fun cancelRevokeInvitation() {
        if (revokingInvitationState.value) return
        revokeTargetState.update { null }
    }

    /**
     * Confirms revocation of the targeted invitation (web `handleRevokeInvitation`): revokes by its `invitation_id`,
     * re-collects ONLY the invitations feed on success, and closes the dialog when the mutation settles (web
     * `onSettled: () => setRevokeTarget(null)`).
     */
    fun confirmRevokeInvitation() {
        if (revokingInvitationState.value) return
        val target = revokeTargetState.value ?: return
        revokingInvitationState.update { true }
        logger.info(EVENT_REVOKE_INVITATION, surfaceField)
        launch {
            source.revokeVehicleInvitation(vehicleId, target.invitationId).onSuccess { bumpInvitations() }
            revokingInvitationState.update { false }
            revokeTargetState.update { null }
        }
    }

    /** Re-collects the drivers feed — the hard-error retry affordance over the drivers panel. */
    fun retryDrivers() = bumpDrivers()

    /** Re-collects the invitations feed — the hard-error retry affordance over the invitations panel. */
    fun retryInvitations() = bumpInvitations()

    private fun bumpDrivers() {
        driversTrigger.update { it + 1 }
    }

    private fun bumpInvitations() {
        invitationsTrigger.update { it + 1 }
    }

    private val surfaceField: Map<String, String>
        get() = mapOf(FIELD_SURFACE to VehicleAccessPageRegistration.SLUG)
}
