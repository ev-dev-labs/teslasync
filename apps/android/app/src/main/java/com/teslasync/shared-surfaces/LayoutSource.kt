// The data seam the Layout surface binds to for the three live feeds the web shell reads — the native
// analogue of the web `useVehicles`, `useAlerts`, and `useIsForwardAuth` hooks
// (web/src/components/layout/Layout.tsx). The view (composable) performs NO HTTP — it only collects
// state from the [LayoutViewModel], which drives this seam (ADR-002), satisfying the "no direct HTTP
// from the view" contract. A concrete adapter over the shared S8 stores backs it in production; a test
// fake backs it in unit tests.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Layout) cannot form a valid Kotlin package. `MatchingDeclarationName`
// and the ktlint filename rule are suppressed: the mandated `Layout*` filename cannot match the
// `LayoutSource` seam plus its co-located store adapter.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.layout

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.authmode.AuthModeStore
import io.teslasync.shared.core.presentation.notifications.Alert
import io.teslasync.shared.core.presentation.notifications.NotificationsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

/**
 * The seam the [LayoutViewModel] depends on so it binds to abstractions (real adapters ↔ test fakes),
 * never concrete clients — the Android counterpart of the web shell's three reads. The vehicle list and
 * alert list are carried as cache-then-network [Resource] feeds (ADR-013); the auth mode is carried as a
 * derived [StateFlow] boolean (the web `useIsForwardAuth`). No HTTP touches the view.
 */
interface LayoutSource {
    /** Cache-then-network `GET /vehicles` feed (web `useVehicles`) — fleet count + the /vehicles badge. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Cache-then-network `GET /alerts` feed (web `useAlerts`) — the unread badge + the SSE alert banner. */
    fun alerts(): Flow<Resource<List<Alert>>>

    /** The deployment auth-mode boolean (web `useIsForwardAuth`) — hides auth-gated nav items in open mode. */
    fun isForwardAuth(): StateFlow<Boolean>
}

/**
 * Binds the surface to the shared **S8** stores — the memoized, multi-observer feeds every vehicles- /
 * notifications- / auth-derived surface shares (so a sync elsewhere refreshes this shell's counts too).
 * No HTTP touches the view.
 *
 * @param vehiclesStore the S8 [VehiclesStore] (web `useVehicles`).
 * @param notificationsStore the S8 [NotificationsStore] (web `useAlerts`).
 * @param authModeStore the S8 [AuthModeStore] (web `useIsForwardAuth`).
 */
class StoreLayoutSource(
    private val vehiclesStore: VehiclesStore,
    private val notificationsStore: NotificationsStore,
    private val authModeStore: AuthModeStore,
) : LayoutSource {
    override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

    override fun alerts(): Flow<Resource<List<Alert>>> = notificationsStore.alerts()

    override fun isForwardAuth(): StateFlow<Boolean> = authModeStore.isForwardAuth
}
