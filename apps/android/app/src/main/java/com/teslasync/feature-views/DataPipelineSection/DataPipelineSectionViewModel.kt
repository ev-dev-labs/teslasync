// UI-thread-free state holder backing the DataPipelineSection feature view — the native port of the web
// component's hook composition (web/src/features/system/components/status/DataPipelineSection.tsx). It binds
// the shared compression-stats feed (web `getCompressionStats`) and export-jobs feed (web `getExportJobs`)
// through [DataPipelineSource], folds both cache-then-network emissions into the single shared [UiState]
// surface (loading / content / empty / stale / offline / error), and exposes the refresh action plus the
// PII-safe `view.opened` diagnostic. The view never performs HTTP — it only collects [state] and calls
// [refresh] / [recordViewOpened].
//
// The web `isLoading = compLoading || exportLoading` gates the whole body; this holder reproduces that by
// OR-ing the two feeds' loading flags. A hard error surfaces only when BOTH feeds fail with nothing cached
// (the web would otherwise still render whichever query resolved); a feed that fails but replays its cache
// keeps its data visible and flags the surface stale/offline (the honest-freshness ADR-013 contract every
// native surface adds on top of the web's minimal handling).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/DataPipelineSection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.datapipelinesection

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.admin.AdminStore
import io.teslasync.shared.core.presentation.exports.ExportJobSummary
import io.teslasync.shared.core.presentation.exports.ExportsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * @param source the cache-then-network compression + export feeds (a shared-data-layer adapter in
 *   production, a fake in tests). The view-model owns no networking — it only folds + projects.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DataPipelineSectionViewModel(
    source: DataPipelineSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects both cache-then-network feeds (the manual refetch affordance).
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    private val compressionUi: StateFlow<UiState<CompressionStats?>> =
        refreshTrigger.flatMapLatest { source.compressionStats() }.asUiState { it == null }

    private val exportsUi: StateFlow<UiState<List<ExportJobSummary>>> =
        refreshTrigger.flatMapLatest { source.exportJobs() }.asUiState { it.isEmpty() }

    /**
     * The combined surface state as a lifecycle-aware [UiState]: loading (either feed on its first load) /
     * content / empty (no compression + no jobs) / stale / offline / hard error (both feeds failed with no
     * cache), carrying the freshest stamp + the first error kind.
     */
    val state: StateFlow<UiState<DataPipelineData>> =
        combine(compressionUi, exportsUi) { compression, exports -> combineDataPipelineUi(compression, exports) }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), UiState.loading())

    /** Re-runs both cache-then-network loads (the web `getCompressionStats` + `getExportJobs` refetch). */
    fun refresh() {
        logger.info("dataPipeline.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no compression figures / job id / file name, so a diagnostics line can never leak the
     * install's data-pipeline posture. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to DATA_PIPELINE_SECTION_SLUG))
    }

    companion object {
        /** Wire the surface from the shared [AdminStore] + [ExportsStore] (P1/S8). */
        fun create(
            adminStore: AdminStore,
            exportsStore: ExportsStore,
            logger: Logger,
        ): DataPipelineSectionViewModel =
            DataPipelineSectionViewModel(
                source = StoreDataPipelineSource(adminStore, exportsStore),
                logger = logger,
            )
    }
}

/**
 * Fold the two per-feed [UiState]s into the single surface state the composable renders — the native analogue
 * of the web component holding both `compression` + `exportJobs` in scope. The data pairs the (possibly null)
 * compression payload with the export-job list; the phase is loading while either feed first-loads, a hard
 * error only when both feeds failed with nothing cached, empty when there is neither compression nor a job,
 * otherwise content. Freshness folds to the freshest stamp and the OR of the stale/refreshing flags, and the
 * first present error kind wins.
 */
internal fun combineDataPipelineUi(
    compression: UiState<CompressionStats?>,
    exports: UiState<List<ExportJobSummary>>,
): UiState<DataPipelineData> {
    val data = DataPipelineData(compression = compression.data, exportJobs = exports.data.orEmpty())
    val loading = compression.isLoading || exports.isLoading
    val bothHardError = compression.isError && exports.isError
    val phase =
        when {
            loading -> UiPhase.Loading
            bothHardError -> UiPhase.Error
            DataPipelineProjection.isEmpty(data) -> UiPhase.Empty
            else -> UiPhase.Content
        }
    return UiState(
        phase = phase,
        data = if (phase == UiPhase.Loading || phase == UiPhase.Error) null else data,
        fetchedAt = maxOfNullable(compression.fetchedAt, exports.fetchedAt),
        stale = compression.stale || exports.stale,
        refreshing = compression.refreshing || exports.refreshing,
        errorKind = compression.errorKind ?: exports.errorKind,
        httpStatus = compression.httpStatus ?: exports.httpStatus,
    )
}

private fun maxOfNullable(
    a: Long?,
    b: Long?,
): Long? =
    when {
        a == null -> b
        b == null -> a
        else -> maxOf(a, b)
    }
