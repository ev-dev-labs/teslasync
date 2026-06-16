// The data seam the FleetTelemetryCoveragePage admin surface binds to, plus its production binding over the
// shared S8 FleetTelemetryStore. The view (composable) performs NO HTTP — it only collects state from the
// view-model, which drives this seam, reproducing the web page's single TanStack-Query read
// (`useFleetTelemetryCoverage`).
//
// The read is the typed, cache-then-network [Resource] stream the shared S8 FleetTelemetryStore already
// exposes (`GET /tesla/fleet-telemetry/coverage` ▸ coverage()); [refresh] is the store's own
// upstream-restart (web query `refetch`). The snapshot is parameterless + has no mutations — the web hook
// file is a single `useQuery` — so the seam is one read + one refresh. A narrow seam so the view-model
// depends on an abstraction (real adapter ↔ test fake), never on a concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is
// suppressed for the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.fleettelemetry

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.fleettelemetry.FleetTelemetryCoverageResponse
import io.teslasync.shared.core.presentation.fleettelemetry.FleetTelemetryStore
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [FleetTelemetryCoveragePageViewModel] depends on so it binds to an abstraction (the
 * shared Fleet-Telemetry holder in production, a fake in tests), never to a concrete store or the network.
 * [coverage] is a cache-then-network typed `Resource` flow (web `useFleetTelemetryCoverage`); [refresh]
 * re-runs it (the web query `refetch`). No HTTP touches the view.
 */
interface FleetTelemetryCoverageSource {
    /** The typed `GET /tesla/fleet-telemetry/coverage` snapshot feed (web `useFleetTelemetryCoverage`). */
    fun coverage(): Flow<Resource<FleetTelemetryCoverageResponse>>

    /** Re-fetches the coverage snapshot (the web Refresh button / error retry affordance). */
    fun refresh()
}

/**
 * Binds the surface to the shared **S8** [FleetTelemetryStore] — the memoized, multi-observer routing
 * snapshot feed every Fleet-Telemetry surface shares. The live values flow through unchanged so the
 * view-model renders the full state matrix (loading / content / empty / error / stale / offline). The
 * store's [FleetTelemetryStore.refreshCoverage] restarts the shared upstream, so the snapshot self-updates.
 * No HTTP touches the view.
 */
fun FleetTelemetryStore.asFleetTelemetryCoverageSource(): FleetTelemetryCoverageSource {
    val store = this
    return object : FleetTelemetryCoverageSource {
        override fun coverage(): Flow<Resource<FleetTelemetryCoverageResponse>> = store.coverage()

        override fun refresh() = store.refreshCoverage()
    }
}
