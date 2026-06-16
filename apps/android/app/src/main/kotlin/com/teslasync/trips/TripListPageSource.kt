// The data seam the TripListPage trips surface binds to, plus its production binding over the shared-core Trips
// repository, the app-scoped active-vehicle selection, and the shared Settings holder. The view (composable)
// performs NO HTTP — it only collects state from the view-model, which drives this seam, reproducing the web
// page's reads: `useTrips({ vehicle_id, limit, offset, start, end })` (`request<Trip[]>('/trips')`), the
// `useSelectedVehicle` scope (the optional `vehicle_id` filter), and `useUnits`/`useFormatting` (the `/settings`
// document).
//
// The trips read is the shared-core cache-then-network `Resource` stream the S7 [TripsRepository] already exposes
// (`GET /trips` ▸ `trips`). The Android DI graph ([io.teslasync.android.data.DataContainer]) wires no TripsStore
// yet, so the host constructs the shared [io.teslasync.shared.core.data.repo.HttpTripsRepository] over the SAME
// resilient client + offline cache the other repositories use (so the ADR-013 freshness contract + SI-verbatim
// caching are identical) and hands it in here — exactly as the sibling DrivesList / TripDetail surfaces do. A
// narrow seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete
// repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/trips) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.trips.triplist

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.TripsRepository
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.trips.Trip
import io.teslasync.shared.core.presentation.trips.TripsParams
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [TripListPageViewModel] depends on so it binds to an abstraction (the shared trips
 * repository + the app-scoped selection + the shared settings holder in production, fakes in tests), never to a
 * concrete repository or the network. The trips feed + the settings feed are cache-then-network `Resource`
 * flows (the web read hooks); the selection is the global active-vehicle scope (the optional `vehicle_id`
 * filter). No HTTP touches the view.
 */
interface TripListPageSource {
    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>

    /**
     * The `GET /trips[?vehicle_id&limit&offset&start&end]` feed (web `useTrips(params)`), surfaced as a
     * cache-then-network [Resource] stream of the SI [Trip] list. The web `select: safeArray` array-guard is
     * applied once at the shared data layer, so this always resolves to a list (never null).
     */
    fun trips(params: TripsParams): Flow<Resource<List<Trip>>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits` / `useFormatting` source). */
    fun settings(): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S7** [TripsRepository] + the app-scoped [SelectedVehicleStore] + the shared
 * [SettingsStore] — the memoized cache-then-network feeds every trips surface shares. The live values flow
 * through unchanged so the view-model renders the full state matrix (loading / content / empty / error / stale /
 * offline). No HTTP touches the view.
 */
fun tripListPageSourceOf(
    tripsRepository: TripsRepository,
    selectedVehicleStore: SelectedVehicleStore,
    settingsStore: SettingsStore,
): TripListPageSource =
    object : TripListPageSource {
        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId

        override fun trips(params: TripsParams): Flow<Resource<List<Trip>>> = tripsRepository.trips(params)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()
    }
