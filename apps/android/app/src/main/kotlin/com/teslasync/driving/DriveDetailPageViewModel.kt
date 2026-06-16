// The state holder backing the DriveDetailPage driving surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/driving/pages/DriveDetailPage.tsx). It projects the
// `useDrive(id)` cache-then-network read onto the shared lifecycle-aware [UiState] surface, resolves the owning
// vehicle's display name from the shared Vehicles feed (web `useVehicle(drive.vehicleId)`), and re-exposes the
// app-scoped unit formatter (web `useUnits`). All derivation logic lives in the framework-free model
// (DriveDetailPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// Route argument (web parity): the web page reads `useParams().id`; a missing / non-numeric id leaves the page
// with no drive to render. This holder mirrors that — [driveId] is the parsed route argument, and a null id
// parks the feed on a hard error so the page shows its error surface rather than issuing an id-less request.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.driving.drivedetail

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (page-local [DriveDetailRepository] + shared
 *   [VehiclesStore][io.teslasync.shared.core.presentation.vehicles.VehiclesStore] adapter ↔ test fake); the view
 *   never performs HTTP.
 * @param driveId the drive id from the route (web `useParams().id`), or `null` when missing / non-numeric.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DriveDetailPageViewModel(
    private val source: DriveDetailPageSource,
    val driveId: Long?,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The drive detail as cache-then-network UI state (loading / content / error / stale / offline). Re-collected
     * whenever the refresh trigger bumps (the web query `refetch` / the error-surface retry). A drive is never
     * "empty" — even a zero-aggregate drive renders the header + the no-telemetry banner — so the empty predicate
     * is always false; a missing route id parks on a hard error (web's id-less disabled query).
     */
    val state: StateFlow<UiState<Drive>> =
        refreshTrigger
            .flatMapLatest { driveFeed() }
            .asUiState(isEmpty = { false })

    /**
     * The owning vehicle's display name (web `useVehicle(drive.vehicleId)?.display_name`), resolved from the
     * shared Vehicles list once both the drive and the list have loaded; `null` until then, which the header
     * renders as the localized `driveDetail.vehicle` fallback.
     */
    val vehicleName: StateFlow<String?> =
        combine(state, vehicleList()) { driveState, vehicles ->
            driveState.data?.let { drive -> vehicles.firstOrNull { it.id == drive.vehicleId }?.displayName }
        }.stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), null)

    /** The live display-unit formatter (web `useUnits`) — re-exposed so the page formats SI at the boundary. */
    val formatter: StateFlow<UnitFormatter> = source.unitFormatter()

    /** Re-runs the cache-then-network load — the web query `refetch()` + the error-surface retry affordance. */
    fun refresh() {
        logger.info("driveDetail.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the drive feed's hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordDriveDetailPageOpened(logger)
    }

    /** The drive feed for the current [driveId], or a permanent hard error when the route carried no id. */
    private fun driveFeed(): Flow<Resource<Drive>> =
        driveId?.let { source.drive(it) } ?: MISSING_ID_FEED

    /** The enrolled vehicle list (the cache value of the `GET /vehicles` feed), used to resolve the drive owner. */
    private fun vehicleList(): Flow<List<Vehicle>> =
        source.vehicles().map { it.cached ?: emptyList() }

    private companion object {
        /** The "no drive id in the route" feed — a hard error so the page shows its error surface. */
        private val MISSING_ID_FEED: Flow<Resource<Drive>> =
            flowOf(
                Resource.Error(
                    cached = null,
                    fetchedAt = null,
                    stale = false,
                    error = IllegalArgumentException("Drive id missing from route arguments"),
                ),
            )
    }
}
