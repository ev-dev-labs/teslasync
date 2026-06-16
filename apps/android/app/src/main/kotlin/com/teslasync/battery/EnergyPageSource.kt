// The data seam the EnergyPage battery surface binds to, plus its production binding over the shared S8 holders and a
// page-local charging repository for the one typed read the shared DataContainer does not yet expose. The view
// (composable) performs NO HTTP — it only collects state from the view-model, which drives this seam, reproducing the
// web page's data reads: `useEnergyStats` (`GET /vehicles/{id}/energy?days=30`), `useChargingSessionsPaginated`
// (`GET /charging?vehicle_id&limit&start&end`), `useChargingTelemetryLatest` (`GET /charging-telemetry/latest`), the
// global `useSelectedVehicle` scope, and `useUnits`/`useFormatting` (the `/settings` document).
//
// Two of the three feeds are shared-core cache-then-network `Resource` streams the S8 holders already expose
// (energy-stats ▸ EnergyStore, charging-telemetry-latest ▸ VehiclesStore, settings ▸ SettingsStore); the active-vehicle
// scope is the app-scoped SelectedVehicleStore selection. The paginated `/charging` read has no method on the holders
// the DataContainer exposes, so it is served by a page-local [io.teslasync.shared.core.data.repo.HttpChargingRepository]
// constructed by the host over the SAME shared resilient client + offline cache the shared repositories use (so the
// ADR-013 freshness contract + SI-verbatim caching are identical) — the same precedent the widget layer's
// WidgetContainer follows. A narrow seam so the view-model depends on an abstraction (real adapters ↔ test fake), never
// on a concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.battery.energy

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.data.repo.ChargingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.energy.EnergyStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/** The paginated charging-sessions page size the breakdown + table read over (web `useChargingSessionsPaginated({ limit: 100 })`). */
private const val SESSIONS_PAGE_LIMIT = 100

/**
 * The single seam the [EnergyPageViewModel] depends on so it binds to an abstraction (the shared Energy + Vehicles +
 * Settings holders, the page-local charging repository, and the app-scoped selection in production; a fake in tests),
 * never to a concrete store or the network. Every read feed is a cache-then-network [Resource] flow (the web read
 * hooks); the selection is the global active-vehicle scope. No HTTP touches the view.
 */
interface EnergyPageSource {
    /** The cache-then-network `GET /vehicles/{id}/energy?days=30` feed for [vehicleId] (web `useEnergyStats`). */
    fun energyStats(vehicleId: String): Flow<Resource<JsonElement>>

    /**
     * The cache-then-network paginated `GET /charging` feed for [vehicleId] over the trailing [start]..[end] window
     * (web `useChargingSessionsPaginated`). Decoded to the generated SI [ChargingSession] DTOs.
     */
    fun chargingSessions(
        vehicleId: Long,
        start: String,
        end: String,
    ): Flow<Resource<List<ChargingSession>>>

    /** The cache-then-network `GET /charging-telemetry/latest` feed for [vehicleId] (web `useChargingTelemetryLatest`). */
    fun chargingTelemetryLatest(vehicleId: Long): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits`/`useFormatting`). */
    fun settings(): Flow<Resource<JsonElement>>

    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>
}

/**
 * Binds the surface to the page-local [charging] repository + the shared **S8** [EnergyStore] + [VehiclesStore] +
 * [SettingsStore] + the app-scoped [SelectedVehicleStore] — the memoized, multi-observer feeds every surface shares
 * app-wide. The live values flow through unchanged so the view-model renders the full state matrix (loading / content /
 * empty / error / stale / offline). No HTTP touches the view.
 */
fun energyPageSourceOf(
    charging: ChargingRepository,
    energyStore: EnergyStore,
    vehiclesStore: VehiclesStore,
    settingsStore: SettingsStore,
    selectedVehicleStore: SelectedVehicleStore,
): EnergyPageSource =
    object : EnergyPageSource {
        override fun energyStats(vehicleId: String): Flow<Resource<JsonElement>> =
            energyStore.energyStats(vehicleId, ENERGY_WINDOW_DAYS)

        override fun chargingSessions(
            vehicleId: Long,
            start: String,
            end: String,
        ): Flow<Resource<List<ChargingSession>>> =
            charging.sessionsPaginated(vehicleId, limit = SESSIONS_PAGE_LIMIT, offset = 0, start = start, end = end)

        override fun chargingTelemetryLatest(vehicleId: Long): Flow<Resource<JsonElement>> =
            vehiclesStore.chargingTelemetryLatest(vehicleId)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()

        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId
    }
