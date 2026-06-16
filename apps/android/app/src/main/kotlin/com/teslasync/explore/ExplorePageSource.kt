// The data seam the ExplorePage surface binds to, plus its production binding over the shared-core Vehicles +
// auth-mode state holders and the client-side recently-viewed store. The view (composable) performs NO HTTP — it
// only collects state from the view-model, which drives this seam (ADR-002), reproducing the web page's two data
// hooks (web/src/features/explore/pages/ExplorePage.tsx): `useVehicles` (fleet-count gate) and `useIsForwardAuth`
// (auth gate), plus the page's recently-visited strip, which reads the same client-side recent-pages registry the
// web page reads via `getRecentPages()` (web/src/lib/recentPages.ts).
//
// A narrow seam so the view-model depends on an abstraction (real adapters ↔ test fakes), never on a concrete
// store or the network. The two reads are the shared S8 holders' flows; the recent feed is the on-device
// SharedPreferences store; `refresh` re-fetches the auth-mode contract (the vehicle-list feed re-collects from
// the view-model's refresh trigger).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/explore) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located production binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.explore

import io.teslasync.android.featureviews.recentlyviewed.RecentPageEntry
import io.teslasync.android.featureviews.recentlyviewed.RecentPagesStore
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.authmode.AuthModeStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [ExplorePageViewModel] depends on so it binds to an abstraction (the shared Vehicles +
 * auth-mode holders + the on-device recent-pages store in production, fakes in tests), never a concrete store or
 * the network. The two contract reads are cache-then-network `Resource` / derived flows (the web read hooks); the
 * recent feed is a reactive on-device list; [refresh] re-fetches the auth-mode contract. No HTTP touches the view.
 */
interface ExplorePageSource {
    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`) — drives the fleet-count gate. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The deployment auth-mode derivation (web `useIsForwardAuth`) — drives the auth-gated catalog rows. */
    fun isForwardAuth(): Flow<Boolean>

    /** The on-device recently-visited registry (web `getRecentPages()` / `subscribeRecentPages()`). */
    fun recentPages(): Flow<List<RecentPageEntry>>

    /** Re-fetches the auth-mode contract (web's window-focus refetch); backs the surface's retry affordance. */
    fun refresh()
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] + [AuthModeStore] and the on-device [RecentPagesStore] —
 * the memoized cache-then-network feeds every Vehicles/auth-coupled surface shares, plus the privacy-sensitive
 * client-side recent-pages list (never synced). The live values flow through unchanged so the view-model renders
 * the full freshness matrix (refreshing / stale / offline + retry). No HTTP touches the view.
 */
fun explorePageSourceOf(
    vehiclesStore: VehiclesStore,
    authModeStore: AuthModeStore,
    recentPagesStore: RecentPagesStore,
): ExplorePageSource =
    object : ExplorePageSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun isForwardAuth(): Flow<Boolean> = authModeStore.isForwardAuth

        override fun recentPages(): Flow<List<RecentPageEntry>> = recentPagesStore.recentPages()

        override fun refresh() = authModeStore.refresh()
    }
