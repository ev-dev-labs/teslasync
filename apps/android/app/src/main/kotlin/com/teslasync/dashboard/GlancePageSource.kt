// The data seam the GlancePage surface binds to, plus its production binding over the shared-core Vehicles +
// Vehicle-command state holders and the app-scoped active-vehicle selection. The view (composable) performs NO
// HTTP — it only collects state from the view-model, which drives this seam, reproducing the web page's four
// hooks (web/src/features/dashboard/pages/GlancePage.tsx): `useVehicles`, `useVehicleState`,
// `useLocationSnapshotLatest`, and the `useVehicleCommand` mutation, scoped by the global active-vehicle selection.
//
// Every read is the shared-core cache-then-network `Resource` stream the S8 [VehiclesStore] already exposes; the
// location feed's raw JSON is parsed into a [GlanceLocation] here (preserving every freshness flag) so the
// view-model stays DTO-typed. The command is routed through the shared [VehicleCommandStore], which posts
// `POST /vehicles/{id}/command` and invalidates the four cache surfaces the web hook's `onSuccess` invalidates.
// A narrow seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete
// store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/dashboard) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.glance

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.vehiclecommand.CommandResult
import io.teslasync.shared.core.presentation.vehiclecommand.SendVehicleCommandInput
import io.teslasync.shared.core.presentation.vehiclecommand.VehicleCommandStore
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [GlancePageViewModel] depends on so it binds to an abstraction (the shared Vehicles +
 * Vehicle-command holders + the app-scoped selection in production, a fake in tests), never to a concrete store
 * or the network. The three reads are cache-then-network `Resource` flows (the web read hooks); the command is a
 * non-throwing suspend `Result`. No HTTP touches the view.
 */
interface GlancePageSource {
    /** The global active-vehicle selection (web `vehicleId ?? vehicles?.[0]`), self-healing from the live list. */
    fun selectedVehicleId(): StateFlow<Long?>

    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /vehicles/{id}/state` feed for [vehicleId] (web `useVehicleState`). */
    fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>>

    /** The cache-then-network `GET /location-snapshots/latest` feed for [vehicleId] (web `useLocationSnapshotLatest`). */
    fun locationSnapshotLatest(vehicleId: Long): Flow<Resource<GlanceLocation?>>

    /** Send [command] to [vehicleId] as `POST /vehicles/{id}/command` (web `useVehicleCommand`); never throws. */
    suspend fun sendCommand(
        vehicleId: Long,
        command: String,
    ): Result<CommandResult>
}

/**
 * Parse a raw [Resource] of the `GET /location-snapshots/latest` JSON into a [Resource] of a parsed
 * [GlanceLocation], preserving every freshness flag (cached / refreshing / stale / offline) so the view-model
 * can render the full state matrix. Pure, so the parse-and-preserve contract is unit-tested without a network or
 * cache. A present-but-not-object body parses to `null` (web's outer `!location` → the em-dash location label).
 */
fun Resource<JsonElement>.toGlanceLocation(): Resource<GlanceLocation?> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(
                cached = cached?.let(GlanceLocation::fromJson),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = GlanceLocation.fromJson(data),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = cached?.let(GlanceLocation::fromJson),
                fetchedAt = fetchedAt,
                stale = stale,
                error = error,
            )
    }

/**
 * Binds the surface to the shared **S8** [VehiclesStore] + [VehicleCommandStore] and the app-scoped
 * [SelectedVehicleStore] — the memoized cache-then-network feeds every Vehicles surface shares, scoped to the
 * active vehicle. The live values flow through unchanged so the view-model renders the full state matrix
 * (loading / content / empty / error / stale / offline). No HTTP touches the view.
 */
fun glancePageSourceOf(
    vehiclesStore: VehiclesStore,
    vehicleCommandStore: VehicleCommandStore,
    selectedVehicleStore: SelectedVehicleStore,
): GlancePageSource =
    object : GlancePageSource {
        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> =
            vehiclesStore.vehicleState(vehicleId)

        override fun locationSnapshotLatest(vehicleId: Long): Flow<Resource<GlanceLocation?>> =
            vehiclesStore.locationSnapshotLatest(vehicleId).map { it.toGlanceLocation() }

        override suspend fun sendCommand(
            vehicleId: Long,
            command: String,
        ): Result<CommandResult> = vehicleCommandStore.sendCommand(SendVehicleCommandInput(vehicleId = vehicleId, command = command))
    }
