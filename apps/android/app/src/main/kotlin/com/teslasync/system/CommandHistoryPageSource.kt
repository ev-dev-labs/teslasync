// The data seam the CommandHistoryPage system surface binds to, plus its production binding over the shared S8
// holders. The view (composable) performs NO HTTP — it only collects state from the view-model, which drives
// this seam, reproducing the web page's two TanStack-Query reads (`useVehicles` for the picker, `useCommandHistory`
// for the per-vehicle audit log).
//
// Both feeds are the shared-core cache-then-network `Resource` streams the S8 holders already expose
// (`GET /vehicles` ▸ VehiclesStore.vehicles(); `GET /vehicles/{id}/commands/history?limit=200` ▸
// CommandsStore.commandHistory(id)). A narrow seam so the view-model depends on an abstraction (real adapter ↔
// test fake), never on a concrete store or the network. Each (re)collection is a fresh cache-then-network
// stream, so the view-model's refresh trigger re-subscribing performs the web `refetch()`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.commandhistory

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.commands.CommandsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [CommandHistoryPageViewModel] depends on so it binds to an abstraction (the shared
 * Vehicles + Commands holders in production, a fake in tests), never to a concrete store or the network. Both
 * members are cache-then-network `Resource` flows (the web read hooks). No HTTP touches the view.
 */
interface CommandHistorySource {
    /** The fleet list feed for the vehicle picker (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /**
     * The per-vehicle command-history feed for the selected [vehicleId] (web `useCommandHistory`). The
     * `?limit=200` cap lives in the shared `CommandsStore`/repository, mirroring the web template literal;
     * the page never overrides it.
     */
    fun commandHistory(vehicleId: String): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] + [CommandsStore] — the memoized, multi-observer
 * feeds every surface shares app-wide. The live values flow through unchanged so the view-model renders the
 * full state matrix (loading / content / empty / error / stale / offline) for each source. No HTTP touches the
 * view.
 */
fun commandHistorySourceOf(
    vehiclesStore: VehiclesStore,
    commandsStore: CommandsStore,
): CommandHistorySource =
    object : CommandHistorySource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun commandHistory(vehicleId: String): Flow<Resource<JsonElement>> = commandsStore.commandHistory(vehicleId)
    }
