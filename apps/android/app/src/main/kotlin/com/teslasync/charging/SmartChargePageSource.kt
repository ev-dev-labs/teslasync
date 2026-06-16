// The data seam the SmartChargePage surface binds to, plus its production binding over the shared-core charging
// repository and the app-scoped active-vehicle selection. The view (composable) performs NO HTTP — it only
// collects state from the view-model, which drives this seam, reproducing the web page's two read hooks
// (`useRatePlans`, `useChargePlans`) and two mutations (`useOptimizeCharge`, `useApplySchedule`) plus the global
// `useSelectedVehicle` scope.
//
// The two reads stream the shared-core cache-then-network raw-JSON `Resource` the S7 [ChargingRepository] already
// exposes (`GET /charge-planner/rate-plans` ▸ `ratePlans`, `GET /charge-planner/history?vehicle_id` ▸
// `chargePlans`); the two writes are the non-throwing suspend `Result`s the same port exposes (`POST
// /charge-planner/optimize`, `POST /charge-planner/apply`). The Android DI graph wires no ChargingStore yet, so the
// host constructs the shared [io.teslasync.shared.core.data.repo.HttpChargingRepository] over the SAME resilient
// client + offline cache the other repositories use (so the ADR-013 freshness contract + SI-verbatim caching are
// identical) and hands it in here. A narrow seam so the view-model depends on an abstraction (real adapter ↔ test
// fake), never on a concrete repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.charging.smartcharge

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.data.repo.ChargingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.charging.ApplyScheduleInput
import io.teslasync.shared.core.presentation.charging.OptimizeChargeInput
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [SmartChargePageViewModel] depends on so it binds to an abstraction (the shared charging
 * repository + the app-scoped selection in production, a fake in tests), never to a concrete repository or the
 * network. The two reads are cache-then-network raw-JSON `Resource` flows (the web read hooks); the two writes are
 * non-throwing suspend `Result`s (the web mutations); the selection is the global active-vehicle scope. No HTTP
 * touches the view.
 */
interface SmartChargePageSource {
    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>

    /** The cache-then-network `GET /charge-planner/rate-plans` feed (web `useRatePlans`). */
    fun ratePlans(): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /charge-planner/history?vehicle_id` feed for [vehicleId] (web `useChargePlans`). */
    fun chargePlans(vehicleId: Long): Flow<Resource<JsonElement>>

    /** Runs `POST /charge-planner/optimize` with the optimize body (web `useOptimizeCharge`). */
    suspend fun optimize(input: OptimizeChargeInput): Result<JsonElement>

    /** Runs `POST /charge-planner/apply` with `{ plan_id }` (web `useApplySchedule`). */
    suspend fun apply(input: ApplyScheduleInput): Result<JsonElement>
}

/**
 * Binds the surface to the shared **S7** [ChargingRepository] + the app-scoped [SelectedVehicleStore] — the
 * memoized cache-then-network feeds + the direct mutations every charging surface shares, scoped to the active
 * vehicle. The live values flow through unchanged so the view-model renders the full state matrix (loading /
 * content / empty / error / stale / offline) and the in-flight / success / error mutation states. No HTTP touches
 * the view.
 */
fun smartChargePageSourceOf(
    chargingRepository: ChargingRepository,
    selectedVehicleStore: SelectedVehicleStore,
): SmartChargePageSource =
    object : SmartChargePageSource {
        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId

        override fun ratePlans(): Flow<Resource<JsonElement>> = chargingRepository.ratePlans()

        override fun chargePlans(vehicleId: Long): Flow<Resource<JsonElement>> = chargingRepository.chargePlans(vehicleId)

        override suspend fun optimize(input: OptimizeChargeInput): Result<JsonElement> =
            chargingRepository.optimizeCharge(input)

        override suspend fun apply(input: ApplyScheduleInput): Result<JsonElement> = chargingRepository.applySchedule(input)
    }
