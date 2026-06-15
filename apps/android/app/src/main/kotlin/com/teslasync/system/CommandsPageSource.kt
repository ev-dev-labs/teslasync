// The data ports the CommandsPage surface binds to (P1/S8), plus their production binding over the shared-core
// Vehicles + Commands + Vehicle-command state holders. The view (composable) performs NO HTTP — it only collects
// state from the view-model (the vehicle-list roll-up + per-vehicle states) and threads the per-vehicle
// command-center seams through to each embedded VehicleCommandCenter, reproducing the web page's reads
// (web/src/features/system/pages/CommandsPage.tsx): `useQuery(['vehicles'])`, the per-vehicle
// `useQuery(['command-vehicle-states', …])` map, and — inside each command center — the
// `useQuery(['command-latest', id])` feed + the `useVehicleCommand` mutation.
//
// The vehicle list + per-vehicle states are the shared-core cache-then-network `Resource` streams the S8
// [VehiclesStore] already exposes. There is no shared store for `/vehicles/{id}/commands/latest` yet, so the
// command-latest seam is wired over the shared [CommandsRepository] here (parsed into typed [CommandLogEntry] rows
// at this boundary, every freshness flag preserved); the command dispatcher is the shared [VehicleCommandStore] via
// [StoreCommandCenterCommander]. Narrow seams so the view-model + page depend on abstractions (real adapters ↔ test
// fakes), never on a concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper + the Resource projection.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.commands

import io.teslasync.android.featureviews.vehiclecommandcenter.CommandCenterCommander
import io.teslasync.android.featureviews.vehiclecommandcenter.CommandLatestSource
import io.teslasync.android.featureviews.vehiclecommandcenter.CommandLogEntry
import io.teslasync.android.featureviews.vehiclecommandcenter.StoreCommandCenterCommander
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.CommandsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.vehiclecommand.VehicleCommandStore
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonElement

/**
 * The seams the CommandsPage surface depends on so it binds to abstractions (the shared Vehicles + Commands +
 * Vehicle-command holders in production, fakes in tests), never to concrete stores or the network. The vehicle
 * list + per-vehicle state are cache-then-network `Resource` flows (the page's two reads); the per-vehicle
 * command-latest feed + the command dispatcher are the seams each embedded VehicleCommandCenter binds. No HTTP
 * touches the view.
 */
interface CommandsPageSource {
    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /vehicles/{id}/state` feed for [vehicleId] (web per-vehicle `command-vehicle-states`). */
    fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>>

    /**
     * The per-vehicle latest-command feed seam an embedded VehicleCommandCenter binds (web
     * `useQuery(['command-latest', id])`). Scoped to [vehicleId]; the cache-then-network freshness flags flow
     * through verbatim.
     */
    fun commandLatestFor(vehicleId: Long): CommandLatestSource

    /** The shared command dispatcher every embedded VehicleCommandCenter sends through (web `useVehicleCommand`). */
    val commander: CommandCenterCommander
}

/**
 * Project a raw `GET /vehicles/{id}/commands/latest` [Resource] into a [Resource] of typed [CommandLogEntry] rows,
 * preserving every freshness flag (cached / refreshing / stale / offline) so the command center renders its full
 * latest-status chrome. Pure, so the parse-and-preserve contract is unit-tested without a network or cache.
 */
fun Resource<JsonElement>.toCommandLogResource(): Resource<List<CommandLogEntry>> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(
                cached = cached?.let(::parseCommandLatest),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = parseCommandLatest(data),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = cached?.let(::parseCommandLatest),
                fetchedAt = fetchedAt,
                stale = stale,
                error = error,
            )
    }

/**
 * Binds the surface to the shared **S8** [VehiclesStore], the shared **S7** [CommandsRepository], and the shared
 * [VehicleCommandStore] — the memoized cache-then-network feeds every Vehicles/Commands surface shares. The live
 * values flow through unchanged so the view-model renders the full state matrix (loading / content / empty / error
 * / stale / offline). No HTTP touches the view.
 */
fun commandsPageSourceOf(
    vehiclesStore: VehiclesStore,
    commandsRepository: CommandsRepository,
    vehicleCommandStore: VehicleCommandStore,
): CommandsPageSource =
    object : CommandsPageSource {
        override val commander: CommandCenterCommander = StoreCommandCenterCommander(vehicleCommandStore)

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> =
            vehiclesStore.vehicleState(vehicleId)

        override fun commandLatestFor(vehicleId: Long): CommandLatestSource =
            CommandLatestSource {
                commandsRepository.commandLatest(vehicleId.toString()).map { it.toCommandLogResource() }
            }
    }
