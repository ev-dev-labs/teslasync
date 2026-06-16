// The data seam the SignalDiffPage telemetry surface binds to, plus its production binding over the shared S8
// holders. The view (composable) performs NO HTTP — it only collects state from the view-model, which drives this
// seam, reproducing the web page's five data hooks: `useVehicles` (the picker), `useSignals` (the available-signal
// set narrowing the diff), `useSignalDiffServer` (the server-side snapshot diff), `usePinned` (the pinned set), and
// `useTogglePin` (the pin/unpin mutation).
//
// The four reads are the shared-core cache-then-network `Resource` streams the S8 holders already expose, and the
// mutation is the holder's non-throwing suspend `Result`. A narrow seam so the view-model depends on an abstraction
// (real adapter ↔ test fake), never on a concrete store or the network. Each (re)collection is a fresh
// cache-then-network stream, so the view-model re-subscribing performs the web `refetch()`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.telemetry.signaldiff

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import io.teslasync.shared.core.presentation.pinned.PinnedItemType
import io.teslasync.shared.core.presentation.pinned.PinnedStore
import io.teslasync.shared.core.presentation.telemetry.SignalDiffServerResponse
import io.teslasync.shared.core.presentation.telemetry.TelemetryStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [SignalDiffPageViewModel] depends on so it binds to an abstraction (the shared Vehicles +
 * Telemetry + Pinned holders in production, a fake in tests), never to a concrete store or the network. The four
 * members are cache-then-network `Resource` flows (the web read hooks); [togglePin] is the non-throwing pin
 * mutation (web `useTogglePin`). No HTTP touches the view.
 */
interface SignalDiffPageSource {
    /** The fleet list feed for the vehicle picker (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The available-signal-name feed narrowing the diff (web `useSignals` from `useTelemetry`). */
    fun signals(vehicleId: Long): Flow<Resource<List<String>>>

    /**
     * The server-side snapshot diff feed for the selected window (web `useSignalDiffServer`):
     * `GET /signals/{vehicleId}/diff?at_a=&at_b=[&signals=]`. The diff is the raw SI the backend serves, untouched.
     */
    fun signalDiff(
        vehicleId: Long,
        atA: String,
        atB: String,
        signalsCsv: String,
    ): Flow<Resource<SignalDiffServerResponse>>

    /** The pinned-widget feed for the page's `context` bucket (web `usePinned('widget', context)`). */
    fun pinned(context: String): Flow<Resource<List<PinnedItem>>>

    /**
     * Pins ([pin] = true) or unpins ([pin] = false) the signal [itemId] in the page's `context` bucket, refreshing
     * the affected feeds on success (web `useTogglePin('widget')`). Non-throwing — failures surface as a failed
     * [Result] and change nothing.
     */
    suspend fun togglePin(
        itemId: String,
        pin: Boolean,
        context: String,
    ): Result<PinnedItem?>
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] + [TelemetryStore] + [PinnedStore] — the memoized,
 * multi-observer feeds every surface shares app-wide. The live values flow through unchanged so the view-model
 * renders the full state matrix (loading / content / empty / error / stale / offline) for each source. The pin
 * mutation routes through the unified `widget` pin domain, matching the web `item_type='widget'`. No HTTP touches
 * the view.
 */
fun signalDiffPageSourceOf(
    vehiclesStore: VehiclesStore,
    telemetryStore: TelemetryStore,
    pinnedStore: PinnedStore,
): SignalDiffPageSource =
    object : SignalDiffPageSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun signals(vehicleId: Long): Flow<Resource<List<String>>> = telemetryStore.signals(vehicleId)

        override fun signalDiff(
            vehicleId: Long,
            atA: String,
            atB: String,
            signalsCsv: String,
        ): Flow<Resource<SignalDiffServerResponse>> = telemetryStore.signalDiffServer(vehicleId, atA, atB, signalsCsv)

        override fun pinned(context: String): Flow<Resource<List<PinnedItem>>> = pinnedStore.pinned(PinnedItemType.Widget, context)

        override suspend fun togglePin(
            itemId: String,
            pin: Boolean,
            context: String,
        ): Result<PinnedItem?> = pinnedStore.togglePin(PinnedItemType.Widget, itemId, pin, context)
    }
