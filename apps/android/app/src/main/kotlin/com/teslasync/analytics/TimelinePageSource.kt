// The data seam the TimelinePage analytics surface binds to, plus its production binding over the shared S8 holders.
// The view (composable) performs NO HTTP — it only collects state from the view-model, which drives this seam,
// reproducing the web page's data reads: `useVehicles` (the `GET /vehicles` fleet feed the vehicle-scope picker
// renders + the `useSelectedVehicle` default-to-first reconcile), and `useTimeline` (the rendered
// `GET /vehicle-states/timeline` transitions feed every panel derives from — see TimelinePageModel for why the
// summary endpoint is not bound).
//
// Each feed is a shared-core cache-then-network `Resource` stream the S8 holders already expose
// (`GET /vehicles` ▸ VehiclesStore.vehicles(); `GET /vehicle-states/timeline` ▸ AnalyticsStore.timeline(id)), and the
// active-vehicle scope is the app-scoped SelectedVehicleStore selection. A narrow seam so the view-model depends on
// an abstraction (real adapter ↔ test fake), never on a concrete store or the network. Each (re)collection of the
// timeline feed is a fresh cache-then-network stream, so the view-model's refresh trigger re-subscribing performs the
// web `refetch()`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.analytics.timeline

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.analytics.AnalyticsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [TimelinePageViewModel] depends on so it binds to an abstraction (the shared Vehicles +
 * Analytics holders + the app-scoped selection in production, a fake in tests), never to a concrete store or the
 * network. The two read feeds are cache-then-network `Resource` flows (the web read hooks); the selection is the
 * global active-vehicle scope. No HTTP touches the view.
 */
interface TimelinePageSource {
    /** The cache-then-network `GET /vehicles` fleet feed (web `useVehicles`) — backs the picker + the reconcile. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /**
     * The cache-then-network `GET /vehicle-states/timeline?vehicle_id={id}` transitions feed (web `useTimeline`),
     * scoped to [vehicleId]. Already unwrapped to the `transitions` array by the shared store.
     */
    fun timeline(vehicleId: String): Flow<Resource<JsonElement>>

    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>

    /** Persist [id] as the active selection (web `setVehicleId`). */
    fun select(id: Long)

    /** Self-heal the selection against the currently-[availableIds] (web "default to the first vehicle"). */
    fun reconcile(availableIds: List<Long>)
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] + [AnalyticsStore] + the app-scoped [SelectedVehicleStore] —
 * the memoized, multi-observer feeds every surface shares app-wide. The live values flow through unchanged so the
 * view-model renders the full state matrix (loading / content / empty / error / stale / offline). No HTTP touches
 * the view.
 */
fun timelinePageSourceOf(
    vehiclesStore: VehiclesStore,
    analyticsStore: AnalyticsStore,
    selectedVehicleStore: SelectedVehicleStore,
): TimelinePageSource =
    object : TimelinePageSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun timeline(vehicleId: String): Flow<Resource<JsonElement>> = analyticsStore.timeline(vehicleId)

        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId

        override fun select(id: Long) {
            selectedVehicleStore.select(id)
        }

        override fun reconcile(availableIds: List<Long>) {
            selectedVehicleStore.reconcile(availableIds)
        }
    }
