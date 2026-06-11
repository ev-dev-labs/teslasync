// The data ports the Command Quick Actions widget binds to — the native analogue of the web
// `useVehicles` + `useVehicleCommand` hook composition
// (web/src/features/dashboard/widgets/CommandQuickActionsWidget.tsx). The view never performs HTTP; a
// concrete adapter over the shared S8 state holders (or a test fake) drives these seams. Two ports, one
// per web hook: a cache-then-network read feed that resolves the target vehicle + freshness chrome
// (`useVehicles`), and a one-shot command sender (`useVehicleCommand`). Cache-then-network freshness is
// preserved end to end (ADR-013): the vehicles feed drives the cached/stale/error flags exactly as the
// web lets `useVehicles` drive the `WidgetShell` chrome.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/CommandQuickActionsWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.commandquickactions

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.vehiclecommand.CommandResult
import io.teslasync.shared.core.presentation.vehiclecommand.SendVehicleCommandInput
import io.teslasync.shared.core.presentation.vehiclecommand.VehicleCommandStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map

/**
 * Streams the cache-then-network sequence of resolved command scopes the widget renders (the target
 * vehicle id + freshness flags). A single-method seam so the view-model depends on an abstraction
 * (real adapter <-> test fake), never on a concrete store or the network.
 */
fun interface CommandQuickActionsSource {
    /** The cache-then-network scope feed (cached value first for an instant cold start, then refreshed). */
    fun stream(): Flow<Resource<CommandQuickActionsSnapshot>>
}

/**
 * Sends one Tesla vehicle command — the native analogue of the web `useVehicleCommand` mutation. A
 * single non-throwing suspend method so the view-model depends on an abstraction (real adapter <-> test
 * fake). On success the returned [CommandResult.success] / [CommandResult.message] are surfaced by the
 * caller (web `toast.success`/`toast.error`); any failure flows out verbatim as `Result.failure`.
 */
fun interface CommandQuickActionsCommander {
    /** Sends [command] to [vehicleId] as `POST /vehicles/{id}/command`; never throws. */
    suspend fun send(
        vehicleId: Long,
        command: String,
    ): Result<CommandResult>
}

/**
 * Resolve a vehicle-list [resource] into the command [CommandQuickActionsSnapshot] scope, preserving
 * every freshness flag (cached / stale / error) from the feed — the native analogue of the web
 * `useVehicles` driving the `WidgetShell` chrome while only its first row's id matters. The target id is
 * the web `vehicleId ?? vehicles?.[0]?.id ?? 0`: an explicit [explicitVehicleId] wins, then the app-wide
 * [activeVehicleId] (the native equivalent of the dashboard's selected vehicle), then the first enrolled
 * vehicle. A loaded-but-empty fleet maps to scope `0` (the web `id === 0` empty branch); a not-yet-loaded
 * feed with no id hint maps to `null` so the surface stays in its loading/error chrome. Pure, so the
 * contract is unit-tested without a network or cache.
 */
internal fun resolveCommandScope(
    resource: Resource<List<Vehicle>>,
    explicitVehicleId: Long?,
    activeVehicleId: Long?,
): Resource<CommandQuickActionsSnapshot> {
    fun scope(list: List<Vehicle>?): CommandQuickActionsSnapshot? {
        val resolvedId =
            explicitVehicleId?.takeIf { it > 0L }
                ?: activeVehicleId?.takeIf { it > 0L }
                ?: list?.firstOrNull()?.id
        return when {
            resolvedId != null -> CommandQuickActionsSnapshot(resolvedId)
            list != null -> CommandQuickActionsSnapshot(0L)
            else -> null
        }
    }

    return when (resource) {
        is Resource.Loading ->
            Resource.Loading(
                cached = scope(resource.cached),
                fetchedAt = resource.fetchedAt,
                stale = resource.stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = scope(resource.data) ?: CommandQuickActionsSnapshot(0L),
                fetchedAt = resource.fetchedAt,
                stale = resource.stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = scope(resource.cached),
                fetchedAt = resource.fetchedAt,
                stale = resource.stale,
                error = resource.error,
            )
    }
}

/**
 * The shared-state-holder-backed [CommandQuickActionsSource]. It folds the app-wide active-vehicle
 * selection ([activeVehicleId], typically `SelectedVehicleStore.selectedId`, which self-heals to the
 * first enrolled vehicle) together with the shared [VehiclesStore.vehicles] feed (web `useVehicles`) and
 * resolves the target id via [resolveCommandScope]. An explicit [explicitVehicleId] overrides the
 * selection (web `vehicleId` prop precedence). No HTTP touches the view — the shared holder (S7/S8) owns
 * it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class StoreCommandQuickActionsSource(
    private val vehiclesStore: VehiclesStore,
    private val activeVehicleId: StateFlow<Long?>,
    private val explicitVehicleId: Long? = null,
) : CommandQuickActionsSource {
    override fun stream(): Flow<Resource<CommandQuickActionsSnapshot>> =
        activeVehicleId.flatMapLatest { active ->
            vehiclesStore.vehicles().map { resource -> resolveCommandScope(resource, explicitVehicleId, active) }
        }
}

/**
 * The shared-state-holder-backed [CommandQuickActionsCommander]. Routes the command through the shared
 * [VehicleCommandStore] (web `useVehicleCommand`), which posts `POST /vehicles/{id}/command` and, on
 * success, invalidates the four cache surfaces the web hook's `onSuccess` invalidates. No HTTP touches
 * the view.
 */
class StoreCommandQuickActionsCommander(
    private val store: VehicleCommandStore,
) : CommandQuickActionsCommander {
    override suspend fun send(
        vehicleId: Long,
        command: String,
    ): Result<CommandResult> = store.sendCommand(SendVehicleCommandInput(vehicleId = vehicleId, command = command))
}
