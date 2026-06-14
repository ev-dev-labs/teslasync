// The state holder backing the IngestXRayPage admin surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/admin/pages/IngestXRayPage.tsx). It owns the page's local
// interaction state (the selected vehicle + the window/bucket selection) as a single immutable
// [XRayInteraction] snapshot, and projects the two cache-then-network reads (`useVehicles`, `useIngestXRay`)
// onto the shared lifecycle-aware [UiState] surface via [BaseFeedViewModel.asUiState]. The X-Ray feed re-collects
// whenever the vehicle/window/bucket changes (a new `/system/ingest-xray/{id}?window&bucket` read) or the refresh
// trigger bumps; it is gated on a selected vehicle (web `enabled: numericId > 0`) so nothing is fetched until the
// operator picks one. All derivation logic lives in the framework-free model (IngestXRayPageModel.kt); this
// holder is the thin orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.ingestxray

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.xraycontrols.IngestXRayBucket as ControlsBucket
import io.teslasync.android.featureviews.xraycontrols.IngestXRayWindow as ControlsWindow
import io.teslasync.android.featureviews.xraycontrols.XRayVehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.ingestxray.IngestXRayResponse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.presentation.vehicles.VehiclesStore] +
 *   [io.teslasync.shared.core.presentation.ingestxray.IngestXRayStore] adapter ↔ test fake); the view never
 *   performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class IngestXRayPageViewModel(
    private val source: IngestXRaySource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableInteraction = MutableStateFlow(XRayInteraction())
    private val vehiclesRefresh = MutableStateFlow(0)
    private val xrayRefresh = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The page's local interaction snapshot (web `useState` group: vehicle + window + bucket). */
    val interaction: StateFlow<XRayInteraction> = mutableInteraction.asStateFlow()

    /**
     * The fleet picker list as cache-then-network UI state (web `useVehicles`). Re-collected when the controls'
     * retry bumps [vehiclesRefresh]; the `Vehicle → XRayVehicle` projection happens here so the controls bind a
     * ready slice.
     */
    val vehiclesState: StateFlow<UiState<List<XRayVehicle>>> =
        vehiclesRefresh
            .flatMapLatest { source.vehicles() }
            .map { resource -> resource.mapData { list -> list.map { it.toXRayVehicle() } } }
            .asUiState(isEmpty = { it.isEmpty() })

    /**
     * The per-vehicle X-Ray as cache-then-network UI state (web `useIngestXRay`). Re-collected whenever the
     * vehicle / window / bucket changes or the refresh trigger bumps. Gated on a selected vehicle (web
     * `enabled: numericId > 0`): with no vehicle it parks on a no-data loading sentinel that the page never
     * shows (it renders the no-vehicle panel instead). The page fans this single feed out into the header /
     * chart / fields slices via [deriveData].
     */
    val xrayState: StateFlow<UiState<IngestXRayResponse>> =
        combine(mutableInteraction, xrayRefresh) { interaction, _ -> interaction }
            .flatMapLatest { interaction ->
                val id = interaction.vehicleId
                if (id == null || id <= 0) {
                    flowOf(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                } else {
                    source.xray(id, interaction.window.toRequestWindow(), interaction.bucket.toRequestBucket())
                }
            }
            .asUiState(isEmpty = { it.isEmptyXRay() })

    // ── Interaction setters (web `setVehicleId` / `setWindowSel` / `setBucketSel`) ───────────────────────────────

    /** Select (or clear, with `null`) the vehicle to inspect (web `setVehicleId`). */
    fun setVehicle(id: Long?): Unit = mutableInteraction.update { it.copy(vehicleId = id) }

    /** Choose the observation window (web `setWindowSel`). */
    fun setWindow(window: ControlsWindow): Unit = mutableInteraction.update { it.copy(window = window) }

    /** Choose the sample-count bucket (web `setBucketSel`). */
    fun setBucket(bucket: ControlsBucket): Unit = mutableInteraction.update { it.copy(bucket = bucket) }

    // ── Refresh / retry (web query `refetch` + the per-surface error retry) ─────────────────────────────────────

    /** Re-collect the X-Ray feed — the web `refetchInterval` / panel error-retry affordance. */
    fun refresh() {
        logger.info("ingestXRay.refresh")
        xrayRefresh.update { it + 1 }
    }

    /** Retry affordance for the X-Ray panels' hard-error surfaces. */
    fun retry(): Unit = refresh()

    /** Re-collect the fleet list — the controls' hard-error retry affordance. */
    fun refreshVehicles() {
        logger.info("ingestXRay.refreshVehicles")
        vehiclesRefresh.update { it + 1 }
    }

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordIngestXRayPageOpened(logger)
    }
}
