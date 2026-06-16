// The data seam the TripReplayPage surface binds to, plus its production binding over the shared-core Driving repository
// and the shared Settings holder. The view (composable) performs NO HTTP — it only collects state from the view-model,
// which drives this seam, reproducing the web page's reads: `useDrive(id)` (`GET /drives/{id}/`) and `useUnits` (the
// `/settings` document).
//
// Both feeds are shared-core cache-then-network `Resource` streams. The Android DI graph
// ([io.teslasync.android.data.DataContainer]) wires no DrivingStore yet, so the host constructs the shared
// [io.teslasync.shared.core.data.repo.HttpDrivingRepository] over the SAME resilient client + offline cache the other
// repositories use (so the ADR-013 freshness contract + SI-verbatim caching are identical) and hands it in here —
// exactly as the sibling DrivesListPage / RegenEfficiencyPage surfaces do. A narrow seam so the view-model depends on an
// abstraction (real adapter ↔ test fake), never on a concrete repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.driving.tripreplay

import io.teslasync.shared.core.data.repo.DrivingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [TripReplayPageViewModel] depends on so it binds to an abstraction (the shared driving repository
 * + the shared settings holder in production, fakes in tests), never to a concrete repository or the network. The
 * drive-detail + settings feeds are cache-then-network `Resource` flows (the web read hooks). No HTTP touches the view.
 */
interface TripReplayPageSource {
    /** The cache-then-network `GET /drives/{id}/` feed (web `useDrive(id)`), raw JSON (positions + telemetry + summary). */
    fun drive(id: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits` source). */
    fun settings(): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S7** [DrivingRepository] + the shared [SettingsStore] — the memoized
 * cache-then-network feeds every driving surface shares. The live values flow through unchanged so the view-model
 * renders the full state matrix (loading / content / empty / error / stale / offline). No HTTP touches the view.
 */
fun tripReplayPageSourceOf(
    drivingRepository: DrivingRepository,
    settingsStore: SettingsStore,
): TripReplayPageSource =
    object : TripReplayPageSource {
        override fun drive(id: String): Flow<Resource<JsonElement>> = drivingRepository.drive(id)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()
    }
