// The data seam the SpeedProfilePage surface binds to, plus its production binding over the shared-core Driving
// repository, the app-scoped active-vehicle selection and the shared Settings holder. The view (composable)
// performs NO HTTP — it only collects state from the view-model, which drives this seam, reproducing the web
// page's reads (`useSpeedProfile(vehicleId, start, end)` + `useDrives(vehicleId)` + the `useUnits` settings
// document scoped by `useSelectedVehicle`).
//
// Both analytics feeds are the shared-core cache-then-network `Resource` streams the S7 [DrivingRepository]
// exposes (`GET /analytics/speed-profile` carried as raw SI [JsonElement] since no generated DTO exists for it,
// and `GET /drives/?vehicle_id` ▸ `drives`). The Android DI graph ([io.teslasync.android.data.DataContainer])
// wires no DrivingStore yet, so the host constructs the shared [io.teslasync.shared.core.data.repo.HttpDrivingRepository]
// over the SAME resilient client + offline cache the other repositories use (so the ADR-013 freshness contract +
// SI-verbatim caching are identical) and hands it in here — exactly as the sibling DrivesList + ChargingCurve
// surfaces do. A narrow seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a
// concrete repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.driving.speedprofile

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.data.repo.DrivingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [SpeedProfilePageViewModel] depends on so it binds to an abstraction (the shared driving
 * repository + the app-scoped selection + the shared settings holder in production, fakes in tests), never to a
 * concrete repository or the network. The speed-profile feed + the drives feed + the settings feed are
 * cache-then-network `Resource` flows (the web read hooks); the selection is the global active-vehicle scope. No
 * HTTP touches the view.
 */
interface SpeedProfilePageSource {
    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>

    /** The cache-then-network `GET /analytics/speed-profile?vehicle_id&start&end` feed (web `useSpeedProfile`). */
    fun speedProfile(
        vehicleId: Long,
        start: String,
        end: String,
    ): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /drives/?vehicle_id` feed for [vehicleId] (web `useDrives`). */
    fun drives(vehicleId: Long): Flow<Resource<List<Drive>>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits` source). */
    fun settings(): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S7** [DrivingRepository] + the app-scoped [SelectedVehicleStore] + the shared
 * [SettingsStore] — the memoized cache-then-network feeds every driving surface shares, scoped to the active
 * vehicle. The live values flow through unchanged so the view-model renders the full state matrix (loading /
 * content / empty / error / stale / offline). No HTTP touches the view.
 */
fun speedProfilePageSourceOf(
    drivingRepository: DrivingRepository,
    selectedVehicleStore: SelectedVehicleStore,
    settingsStore: SettingsStore,
): SpeedProfilePageSource =
    object : SpeedProfilePageSource {
        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId

        override fun speedProfile(
            vehicleId: Long,
            start: String,
            end: String,
        ): Flow<Resource<JsonElement>> = drivingRepository.speedProfile(vehicleId.toString(), start, end)

        override fun drives(vehicleId: Long): Flow<Resource<List<Drive>>> = drivingRepository.drives(vehicleId.toString())

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()
    }
