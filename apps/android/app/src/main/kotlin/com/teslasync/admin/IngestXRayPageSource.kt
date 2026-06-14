// The data seam the IngestXRayPage admin surface binds to, plus its production binding over the shared S8
// holders. The view (composable) performs NO HTTP — it only collects state from the view-model, which drives
// this seam, reproducing the web page's two TanStack-Query reads (`useVehicles` for the picker, `useIngestXRay`
// for the per-vehicle X-Ray).
//
// Both feeds are the shared-core cache-then-network `Resource` streams the S8 holders already expose
// (`GET /vehicles` ▸ VehiclesStore.vehicles(); `GET /system/ingest-xray/{id}` ▸ IngestXRayStore.xray(...)).
// A narrow seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete
// store or the network. Each (re)collection is a fresh cache-then-network stream, so the view-model's refresh
// trigger re-subscribing performs the web `refetch()`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.ingestxray

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.IngestXRayRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.ingestxray.IngestXRayBucket
import io.teslasync.shared.core.presentation.ingestxray.IngestXRayResponse
import io.teslasync.shared.core.presentation.ingestxray.IngestXRayStore
import io.teslasync.shared.core.presentation.ingestxray.IngestXRayWindow
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [IngestXRayPageViewModel] depends on so it binds to an abstraction (the shared Vehicles +
 * Ingest-X-Ray holders in production, a fake in tests), never to a concrete store or the network. Both members
 * are cache-then-network `Resource` flows (the web read hooks). No HTTP touches the view.
 */
interface IngestXRaySource {
    /** The fleet list feed for the vehicle picker (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /**
     * The per-vehicle X-Ray feed for the selected [vehicleId] / [window] / [bucket] (web `useIngestXRay`). The
     * `limit` is the shared-core default (the web `PAGINATION.DEFAULT_LIMIT`); the page never overrides it.
     */
    fun xray(
        vehicleId: Long,
        window: IngestXRayWindow,
        bucket: IngestXRayBucket,
    ): Flow<Resource<IngestXRayResponse>>
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] + [IngestXRayStore] — the memoized, multi-observer
 * feeds every surface shares app-wide. The live values flow through unchanged so the view-model renders the full
 * state matrix (loading / content / empty / error / stale / offline) for each source. No HTTP touches the view.
 */
fun ingestXRaySourceOf(
    vehiclesStore: VehiclesStore,
    ingestXRayStore: IngestXRayStore,
): IngestXRaySource =
    object : IngestXRaySource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun xray(
            vehicleId: Long,
            window: IngestXRayWindow,
            bucket: IngestXRayBucket,
        ): Flow<Resource<IngestXRayResponse>> =
            ingestXRayStore.xray(vehicleId, window, bucket, IngestXRayRepository.DEFAULT_LIMIT)
    }
