// The data seam the QuickStatsPage dashboard surface binds to, plus its production binding over the shared S8 holders.
// The view (composable) performs NO HTTP — it only collects state from the view-model, which drives this seam,
// reproducing the web page's data reads: `useVehicles` (the enrolled-vehicle list it takes `[0]` of), `useVehicleState`
// (the first vehicle's last-known state, for the subtitle), `useAnalyticsSummary(30)` (the `/analytics/fleet?days=30`
// metric feed) and `useUnits`/`useFormatting` (the `/settings` document).
//
// Every feed is a shared-core cache-then-network `Resource` stream the S8 holders already expose
// (`GET /vehicles` ▸ VehiclesStore.vehicles(); `GET /vehicles/{id}/state` ▸ VehiclesStore.vehicleState(...);
// `GET /analytics/fleet?days=30` ▸ AnalyticsStore.analyticsSummary(30); `GET /settings` ▸ SettingsStore.settings()).
// A narrow seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete store or
// the network. Values stay SI; conversion is display-only (S5). The web page scopes to `vehicles?.[0]` (the FIRST
// enrolled vehicle), NOT the global active-vehicle selection, so this surface deliberately does not bind the
// SelectedVehicleStore.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/dashboard) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.quickstats

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.analytics.AnalyticsStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/** The trailing window the fleet summary reads (web `useAnalyticsSummary(30)` ▸ `/analytics/fleet?days=30`). */
private const val SUMMARY_WINDOW_DAYS = 30

/**
 * The single seam the [QuickStatsPageViewModel] depends on so it binds to an abstraction (the shared Vehicles +
 * Analytics + Settings holders in production, a fake in tests), never to a concrete store or the network. Every read
 * feed is a cache-then-network `Resource` flow (the web read hooks). No HTTP touches the view.
 */
interface QuickStatsPageSource {
    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`); the surface takes its first element. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /vehicles/{id}/state` feed for [vehicleId] (web `useVehicleState`). */
    fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>>

    /** The cache-then-network `GET /analytics/fleet?days=30` summary feed (web `useAnalyticsSummary(30)`). */
    fun analyticsSummary(): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits`/`useFormatting`). */
    fun settings(): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] + [AnalyticsStore] + [SettingsStore] — the memoized,
 * multi-observer feeds every surface shares app-wide. The live values flow through unchanged so the view-model
 * renders the full state matrix (loading / content / empty / error / stale / offline). No HTTP touches the view.
 */
fun quickStatsPageSourceOf(
    vehiclesStore: VehiclesStore,
    analyticsStore: AnalyticsStore,
    settingsStore: SettingsStore,
): QuickStatsPageSource =
    object : QuickStatsPageSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = vehiclesStore.vehicleState(vehicleId)

        override fun analyticsSummary(): Flow<Resource<JsonElement>> = analyticsStore.analyticsSummary(SUMMARY_WINDOW_DAYS)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()
    }
