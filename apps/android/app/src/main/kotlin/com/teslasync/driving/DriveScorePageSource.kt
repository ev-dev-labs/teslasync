// The data seam the DriveScorePage driving surface binds to, plus its production binding over the shared-core S7
// Driving repository + the shared Settings holder + the app-scoped active-vehicle selection. The view (composable)
// performs NO HTTP — it only collects state from the view-model, which drives this seam, reproducing the web page's
// data reads: `useDrives` (`GET /drives/?vehicle_id=`), `useDriveScore` (`GET /drives/score?vehicle_id=`), the global
// `useSelectedVehicle` scope, and `useUnits` (the `/settings` document).
//
// Both feeds are the shared-core cache-then-network `Resource` streams the [DrivingRepository] (S7) already exposes —
// `drives` decodes to the generated SI DTO list [Drive] and `driveScore` stays a raw [JsonElement] (decoded by the
// framework-free model) — so the ADR-013 freshness contract + SI-verbatim caching are identical to every other
// surface. The host constructs the production [io.teslasync.shared.core.data.repo.HttpDrivingRepository] over the SAME
// resilient client + offline cache the [io.teslasync.android.data.DataContainer] exposes; the Settings feed is the
// shared S8 holder and the active-vehicle scope is the app-scoped selection. A narrow seam so the view-model depends
// on an abstraction (real adapters ↔ a test fake), never on a concrete store or the network.
//
// `MatchingDeclarationName` is suppressed for the co-located binding helper. `InvalidPackageDeclaration` is suppressed:
// the mandated surface directory (com/teslasync/driving) diverges from the `io.teslasync.android.*` package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.driving.drivescore

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.data.repo.DrivingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [DriveScorePageViewModel] depends on so it binds to an abstraction (the shared Driving S7
 * repository, the shared Settings S8 holder and the app-scoped selection in production; a fake in tests), never to a
 * concrete store or the network. Every read feed is a cache-then-network `Resource` flow (the web read hooks); the
 * selection is the global active-vehicle scope. No HTTP touches the view.
 */
interface DriveScorePageSource {
    /** The cache-then-network `GET /drives/?vehicle_id=` feed for [vehicleId] (web `useDrives`), decoded to SI [Drive]s. */
    fun drives(vehicleId: String): Flow<Resource<List<Drive>>>

    /** The cache-then-network `GET /drives/score?vehicle_id=` feed for [vehicleId] (web `useDriveScore`). */
    fun driveScore(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits`). */
    fun settings(): Flow<Resource<JsonElement>>

    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>
}

/**
 * Binds the surface to the shared **S7** [DrivingRepository] (the host wires the production
 * [io.teslasync.shared.core.data.repo.HttpDrivingRepository] over the container's resilient client + offline cache) +
 * the shared **S8** [SettingsStore] + the app-scoped [SelectedVehicleStore]. The live values flow through unchanged so
 * the view-model renders the full state matrix (loading / content / empty / error / stale / offline). No HTTP touches
 * the view.
 */
fun driveScorePageSourceOf(
    driving: DrivingRepository,
    settingsStore: SettingsStore,
    selectedVehicleStore: SelectedVehicleStore,
): DriveScorePageSource =
    object : DriveScorePageSource {
        override fun drives(vehicleId: String): Flow<Resource<List<Drive>>> = driving.drives(vehicleId)

        override fun driveScore(vehicleId: String): Flow<Resource<JsonElement>> = driving.driveScore(vehicleId)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()

        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId
    }
