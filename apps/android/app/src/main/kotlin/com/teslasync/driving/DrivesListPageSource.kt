// The data seam the DrivesListPage surface binds to, plus its production binding over the shared-core Driving
// repository, the app-scoped active-vehicle selection and the shared Settings holder. The view (composable)
// performs NO HTTP — it only collects state from the view-model, which drives this seam, reproducing the web
// page's reads (`useDrives(vehicleId)` + the `useSelectedVehicle` scope + the `useUnits`/`useFormatting` settings
// document) and its single mutation (`useBulkDeleteDrives` → `DELETE /drives/bulk`).
//
// The drives feed is the shared-core cache-then-network `Resource` stream the S7 [DrivingRepository] already
// exposes (`GET /drives/?vehicle_id` ▸ `drives`). The Android DI graph ([io.teslasync.android.data.DataContainer])
// wires no DrivingStore yet, so the host constructs the shared [io.teslasync.shared.core.data.repo.HttpDrivingRepository]
// over the SAME resilient client + offline cache the other repositories use (so the ADR-013 freshness contract +
// SI-verbatim caching are identical) and hands it in here — exactly as the sibling ChargingCurve surface does.
// A narrow seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete
// repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.driving.driveslist

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.data.repo.DrivingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [DrivesListPageViewModel] depends on so it binds to an abstraction (the shared driving
 * repository + the app-scoped selection + the shared settings holder in production, fakes in tests), never to a
 * concrete repository or the network. The drives feed + the settings feed are cache-then-network `Resource`
 * flows (the web read hooks); the selection is the global active-vehicle scope; the bulk delete is the page's
 * one mutation. No HTTP touches the view.
 */
interface DrivesListPageSource {
    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>

    /** The cache-then-network `GET /drives/?vehicle_id` feed for [vehicleId] (web `useDrives`). */
    fun drives(vehicleId: Long): Flow<Resource<List<Drive>>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits` / `useFormatting` source). */
    fun settings(): Flow<Resource<JsonElement>>

    /** Bulk-deletes [ids] then resolves the API result (web `useBulkDeleteDrives` → `DELETE /drives/bulk`). */
    suspend fun bulkDeleteDrives(ids: List<Long>): Result<JsonElement>
}

/**
 * Binds the surface to the shared **S7** [DrivingRepository] + the app-scoped [SelectedVehicleStore] + the
 * shared [SettingsStore] — the memoized cache-then-network feeds every driving surface shares, scoped to the
 * active vehicle. The live values flow through unchanged so the view-model renders the full state matrix
 * (loading / content / empty / error / stale / offline). No HTTP touches the view.
 */
fun drivesListPageSourceOf(
    drivingRepository: DrivingRepository,
    selectedVehicleStore: SelectedVehicleStore,
    settingsStore: SettingsStore,
): DrivesListPageSource =
    object : DrivesListPageSource {
        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId

        override fun drives(vehicleId: Long): Flow<Resource<List<Drive>>> = drivingRepository.drives(vehicleId.toString())

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()

        override suspend fun bulkDeleteDrives(ids: List<Long>): Result<JsonElement> = drivingRepository.bulkDeleteDrives(ids)
    }
