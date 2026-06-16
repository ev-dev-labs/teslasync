// The data seam the WeeklyDigestPage analytics surface binds to, plus its production binding over the shared S8
// holders. The view (composable) performs NO HTTP — it only collects state from the view-model, which drives this
// seam, reproducing the web page's data reads: the rendered weekly-digest feed (`GET /vehicles/{id}/weekly-digest`,
// the shared-core port of web `useWeeklyDigest`), the enrolled-vehicle list (web `useVehicles`, the page's vehicle
// `<Select>`), the global active-vehicle scope (web's first-vehicle default), and `useUnits`/`useFormatting` (the
// `/settings` document).
//
// Each read feed is a shared-core cache-then-network `Resource` stream the S8 holders already expose
// (`/vehicles/{id}/weekly-digest` ▸ AnalyticsStore.weeklyDigest(...); `/vehicles` ▸ VehiclesStore.vehicles();
// `/settings` ▸ SettingsStore.settings()); the active-vehicle scope is the app-scoped SelectedVehicleStore selection,
// with [selectVehicle] the user tap on the vehicle picker (web `setVehicleId`). A narrow seam so the view-model
// depends on an abstraction (real adapter ↔ test fake), never on a concrete store or the network. Each (re)collection
// of the digest feed is a fresh cache-then-network stream, so the view-model's refresh trigger re-subscribing performs
// the web `refetch()`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.analytics.weeklydigest

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.analytics.AnalyticsStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [WeeklyDigestPageViewModel] depends on so it binds to an abstraction (the shared Analytics +
 * Vehicles + Settings holders + the app-scoped selection in production, a fake in tests), never to a concrete store or
 * the network. The three read feeds are cache-then-network `Resource` flows (the web read hooks); the selection is the
 * global active-vehicle scope. No HTTP touches the view.
 */
interface WeeklyDigestPageSource {
    /**
     * The cache-then-network `GET /vehicles/{vehicleId}/weekly-digest` feed (web `useWeeklyDigest`) — the current-vs-
     * previous week aggregate (drives / distance / energy / cost / efficiency). [vehicleId] scopes it to one vehicle.
     */
    fun weeklyDigest(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /vehicles` enrolled-vehicle feed (web `useVehicles`) — the page's vehicle picker. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits`/`useFormatting`). */
    fun settings(): Flow<Resource<JsonElement>>

    /** The global active-vehicle selection (web's first-vehicle default), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>

    /** Explicitly selects [id] — the web `<Select onChange>` (`setVehicleId`). */
    fun selectVehicle(id: Long)
}

/**
 * Binds the surface to the shared **S8** [AnalyticsStore] + [VehiclesStore] + [SettingsStore] + the app-scoped
 * [SelectedVehicleStore] — the memoized, multi-observer feeds every surface shares app-wide. The live values flow
 * through unchanged so the view-model renders the full state matrix (loading / content / empty / error / stale /
 * offline). No HTTP touches the view.
 */
fun weeklyDigestPageSourceOf(
    analyticsStore: AnalyticsStore,
    vehiclesStore: VehiclesStore,
    settingsStore: SettingsStore,
    selectedVehicleStore: SelectedVehicleStore,
): WeeklyDigestPageSource =
    object : WeeklyDigestPageSource {
        override fun weeklyDigest(vehicleId: String): Flow<Resource<JsonElement>> = analyticsStore.weeklyDigest(vehicleId)

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()

        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId

        override fun selectVehicle(id: Long) = selectedVehicleStore.select(id)
    }
