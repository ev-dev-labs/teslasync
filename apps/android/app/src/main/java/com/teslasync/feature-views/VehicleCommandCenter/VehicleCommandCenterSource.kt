// The data ports the VehicleCommandCenter binds to (P1/S8) — the native analogue of the web hook
// composition (web/src/features/system/components/VehicleCommandCenter.tsx). The view never performs HTTP;
// a concrete adapter over the shared S8 state holders (or a test fake) drives these seams. Two ports, one
// per web data hook:
//   • [CommandLatestSource] — the cache-then-network `useQuery(['command-latest', id])` feed that decorates
//     each tile with its last `✓/✗ {ago}` status and drives the surface's freshness chrome. There is no
//     shared store for the `/vehicles/{id}/commands/latest` endpoint yet, so the host wires this seam over
//     a future repository; the freshness/stale/offline flags flow through [Resource] end to end (ADR-013).
//   • [CommandCenterCommander] — the one-shot command + wake sender (web `useVehicleCommand` mutation),
//     backed in production by the shared [VehicleCommandStore] via [StoreCommandCenterCommander].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory cannot form a valid Kotlin
// package, so the package intentionally diverges from the path — exactly as the sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclecommandcenter

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.vehiclecommand.CommandResult
import io.teslasync.shared.core.presentation.vehiclecommand.SendVehicleCommandInput
import io.teslasync.shared.core.presentation.vehiclecommand.VehicleCommandStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonObject

/**
 * Streams the cache-then-network sequence of the vehicle's latest command-log statuses — the native
 * analogue of the web `useQuery(['command-latest', vehicle.id])`. A single-method seam so the view-model
 * depends on an abstraction (real adapter ↔ test fake), never on a concrete store or the network. The
 * cached value drives an instant cold start; the freshness/stale flags drive the header chrome.
 */
fun interface CommandLatestSource {
    /** The cache-then-network latest-command feed (cached value first, then refreshed). */
    fun stream(): Flow<Resource<List<CommandLogEntry>>>
}

/**
 * Sends one Tesla vehicle command — the native analogue of the web `useVehicleCommand` mutation (covering
 * both the generic command and the `wake_up` mutation). A single non-throwing suspend method so the
 * view-model depends on an abstraction (real adapter ↔ test fake). On success the returned
 * [CommandResult.success] / [CommandResult.message] are surfaced by the caller (web
 * `toast.success`/`toast.error` + the inline `lastResult` panel); any failure flows out verbatim as
 * `Result.failure`.
 */
fun interface CommandCenterCommander {
    /** Sends [command] (with optional [params]) to [vehicleId] as `POST /vehicles/{id}/command`; never throws. */
    suspend fun send(
        vehicleId: Long,
        command: String,
        params: JsonObject?,
    ): Result<CommandResult>
}

/**
 * The shared-state-holder-backed [CommandCenterCommander]. Routes the command through the shared
 * [VehicleCommandStore] (web `useVehicleCommand`), which posts `POST /vehicles/{id}/command` and, on
 * success, invalidates the four cache surfaces the web hook's `onSuccess` invalidates (per-vehicle state,
 * command-latest, command-history, and the vehicle list). No HTTP touches the view.
 */
class StoreCommandCenterCommander(
    private val store: VehicleCommandStore,
) : CommandCenterCommander {
    override suspend fun send(
        vehicleId: Long,
        command: String,
        params: JsonObject?,
    ): Result<CommandResult> = store.sendCommand(SendVehicleCommandInput(vehicleId = vehicleId, command = command, params = params))
}
