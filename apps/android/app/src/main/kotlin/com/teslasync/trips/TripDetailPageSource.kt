// The data seam the TripDetailPage trips surface binds to, plus its production binding over the shared-core Trips
// repository and the shared Settings holder. The view (composable) performs NO HTTP — it only collects state from
// the view-model, which drives this seam, reproducing the web page's reads: `useTrip(id)`
// (`request<Trip>('/trips/{id}')`) and `useUnits`/`useFormatting` (the `/settings` document).
//
// The trip read is the shared-core cache-then-network `Resource` stream the S7 [TripsRepository] already exposes
// (`GET /trips/{id}` ▸ `trip`). The Android DI graph ([io.teslasync.android.data.DataContainer]) wires no
// TripsStore yet, so the host constructs the shared [io.teslasync.shared.core.data.repo.HttpTripsRepository] over
// the SAME resilient client + offline cache the other repositories use (so the ADR-013 freshness contract +
// SI-verbatim caching are identical) and hands it in here — exactly as the sibling DrivesList / ChargingCurve
// surfaces do. A narrow seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a
// concrete repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/trips) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.trips.tripdetail

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.TripsRepository
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.trips.Trip
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [TripDetailPageViewModel] depends on so it binds to an abstraction (the shared trips
 * repository + the shared settings holder in production, fakes in tests), never to a concrete repository or the
 * network. The trip feed is the page's one cache-then-network `Resource` stream (web `useTrip`); settings backs
 * the display units + currency. No HTTP touches the view.
 */
interface TripDetailPageSource {
    /**
     * The `GET /trips/{id}` feed (web `useTrip(id)` ▸ `request(...)`), surfaced as a cache-then-network
     * [Resource] stream: [Resource.Loading] first (cached value if any), then a terminal [Resource.Success]
     * (the decoded trip) or [Resource.Error] (the backend registers no such route, so in practice a 404 — the
     * same channel the web `TripDetailPage` renders gracefully).
     */
    fun trip(id: String): Flow<Resource<Trip>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits` / `useFormatting` source). */
    fun settings(): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S7** [TripsRepository] + the shared [SettingsStore] — the memoized
 * cache-then-network feeds every trips surface shares. The live values flow through unchanged so the view-model
 * renders the full state matrix (loading / content / empty / error / stale / offline). No HTTP touches the view.
 */
fun tripDetailPageSourceOf(
    tripsRepository: TripsRepository,
    settingsStore: SettingsStore,
): TripDetailPageSource =
    object : TripDetailPageSource {
        override fun trip(id: String): Flow<Resource<Trip>> = tripsRepository.trip(id)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()
    }
