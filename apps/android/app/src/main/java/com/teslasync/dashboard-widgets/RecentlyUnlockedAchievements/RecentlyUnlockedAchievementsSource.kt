// The data port the Recently Unlocked Achievements widget binds to — the native analogue of the web hooks
// the component composes: `useVehicles` (to resolve the default vehicle), `useLifetimeStats` (the rendered
// `/analytics/lifetime` feed the achievements live inside), and `useAchievementCelebrationPrefs` (the
// client-side `showOnDashboard` opt-out). See
// web/src/features/dashboard/widgets/RecentlyUnlockedAchievements.tsx + web/src/api/hooks/useAnalytics.ts +
// web/src/hooks/useAchievementCelebrationPrefs.ts. The view never performs HTTP; a concrete adapter over
// the shared S7/S8 data layer (or a test double) drives this seam. Cache-then-network freshness is
// preserved end to end (ADR-013): the view-model projects each emission's cached/stale/error flags onto the
// render surface.
//
// `showOnDashboard` parity note: the web preference is a client-only localStorage flag (default on) with no
// server `/settings` field and no shared-core (P1/S8) state holder ported yet, so it is exposed here as an
// injectable `Flow<Boolean>` defaulting to `flowOf(true)` — the web default. The widget's opt-out empty
// state is fully implemented + tested against this seam; a host wires a persisted flow once the native
// client-preference store lands, exactly as it wires the data adapters.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/RecentlyUnlockedAchievements) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.recentlyunlockedachievements

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.AnalyticsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.analytics.AnalyticsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.serialization.json.JsonElement

/**
 * Streams the feeds the widget needs: the enrolled-vehicle [vehicles] list (used only to resolve the
 * default vehicle when no explicit id is configured — web `vehicles?.[0]?.id`), the [lifetimeStats]
 * envelope (the rendered `GET /analytics/lifetime` feed the achievements are nested inside), and the
 * [showOnDashboard] preference (web `useAchievementCelebrationPrefs().showOnDashboard`). A narrow seam so
 * the view-model depends on an abstraction (real adapter ↔ test double), never on a concrete
 * store/repository or the network.
 */
interface RecentlyUnlockedAchievementsSource {
    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`), used to pick the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /**
     * The cache-then-network `GET /analytics/lifetime` feed (web `useLifetimeStats`). A non-null
     * [vehicleId] scopes the payload to that vehicle (`?vehicle_id={id}`); a null id requests the
     * fleet-wide totals — exactly the web `vehicleId ? '?vehicle_id=' + vehicleId : ''` switch.
     */
    fun lifetimeStats(vehicleId: String?): Flow<Resource<JsonElement>>

    /** The live `showOnDashboard` opt-out (web `useAchievementCelebrationPrefs().showOnDashboard`). */
    fun showOnDashboard(): Flow<Boolean>
}

/**
 * Binds the widget to the shared **S7** repositories — the cold cache-then-network `Flow`s the S8 stores
 * also wrap. Re-collecting any feed performs a genuine cache-then-network re-fetch, which is what backs the
 * widget's manual refresh / error-retry affordance (the web `refetch()`). The vehicles list lives on the
 * [VehiclesRepository] seam and the lifetime feed on the [AnalyticsRepository]; [showOnDashboard] defaults
 * to the web's always-on value until a host supplies a persisted preference flow. No HTTP touches the view.
 */
fun recentlyUnlockedAchievementsSource(
    vehicles: VehiclesRepository,
    analytics: AnalyticsRepository,
    showOnDashboard: Flow<Boolean> = flowOf(true),
): RecentlyUnlockedAchievementsSource =
    object : RecentlyUnlockedAchievementsSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun lifetimeStats(vehicleId: String?): Flow<Resource<JsonElement>> = analytics.lifetimeStats(vehicleId)

        override fun showOnDashboard(): Flow<Boolean> = showOnDashboard
    }

/**
 * Binds the widget to the shared **S8** stores — the memoized, multi-observer feeds every surface shares.
 * Use this when a host wants the widget to fold into the same shared collections as the rest of the app;
 * the live values (incl. each store's background refresh) flow through unchanged. [showOnDashboard]
 * defaults to the web's always-on value until a host supplies a persisted preference flow. No HTTP touches
 * the view.
 */
fun recentlyUnlockedAchievementsSource(
    vehicles: VehiclesStore,
    analytics: AnalyticsStore,
    showOnDashboard: Flow<Boolean> = flowOf(true),
): RecentlyUnlockedAchievementsSource =
    object : RecentlyUnlockedAchievementsSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun lifetimeStats(vehicleId: String?): Flow<Resource<JsonElement>> = analytics.lifetimeStats(vehicleId)

        override fun showOnDashboard(): Flow<Boolean> = showOnDashboard
    }
