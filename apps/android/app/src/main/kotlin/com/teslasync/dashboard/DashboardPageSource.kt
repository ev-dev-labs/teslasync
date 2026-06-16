// The data seam the DashboardPage surface binds to, plus its production binding over the shared S8 stores. The
// view (composable) performs NO HTTP — it only collects state from the view-model, which drives this seam,
// reproducing the web page's two bound hooks: the auth-status read (`useAuthStatus`, GET /auth/status) that
// decides the onboarding panel's connected/disconnected copy, and the vehicle-sync mutation (`useSyncVehicles`,
// POST /vehicles/sync) the panel's "Sync Vehicles" action fires.
//
// Both members route through the shared KMP holders the rest of the app already shares (P1/S8): the auth-status
// feed is the cache-then-network `Resource` stream the shared [SettingsStore] exposes (web `useAuthStatus` lives
// in `@/api/hooks/useSettings`), and the sync mutation is the shared [VehiclesStore] re-discovery (web
// `useSyncVehicles` lives in `@/api/hooks/useVehicles`), which re-fetches the `['vehicles']` family on success
// exactly as the web hook invalidates it. A narrow seam so the view-model depends on an abstraction (real
// adapter ↔ test fake), never on a concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/dashboard) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.dashboard

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.settings.AuthStatus
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [DashboardPageViewModel] depends on so it binds to an abstraction (the shared Settings +
 * Vehicles holders in production, a fake in tests), never to a concrete store or the network. [authStatus] is a
 * cache-then-network `Resource` flow (the web `useAuthStatus` read hook); [syncVehicles] is the non-throwing
 * re-discovery mutation (the web `useSyncVehicles` mutation). No HTTP touches the view.
 */
interface DashboardPageSource {
    /** The cache-then-network `GET /auth/status` feed (web `useAuthStatus`) driving the onboarding panel copy. */
    fun authStatus(): Flow<Resource<AuthStatus>>

    /**
     * Re-discovers vehicles from Tesla (`POST /vehicles/sync`, web `useSyncVehicles`), refreshing the shared
     * vehicles family on success. Returns a non-throwing [Result] (the outcome is surfaced as a one-shot toast,
     * never cached as if applied — ADR-013).
     */
    suspend fun syncVehicles(): Result<*>
}

/**
 * Binds the surface to the shared **S8** [SettingsStore] (auth-status feed) + [VehiclesStore] (sync mutation) —
 * the same memoized, multi-observer holders every other surface shares app-wide. The live values flow through
 * unchanged so the view-model renders the full state matrix (loading / content / error / stale / offline). No
 * HTTP touches the view.
 */
fun dashboardPageSourceOf(
    settingsStore: SettingsStore,
    vehiclesStore: VehiclesStore,
): DashboardPageSource =
    object : DashboardPageSource {
        override fun authStatus(): Flow<Resource<AuthStatus>> = settingsStore.authStatus()

        override suspend fun syncVehicles(): Result<*> = vehiclesStore.syncVehicles()
    }
