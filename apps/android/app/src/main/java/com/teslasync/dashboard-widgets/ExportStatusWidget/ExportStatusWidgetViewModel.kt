// UI-thread-free state holder backing the Export Status widget — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/ExportStatusWidget.tsx). It binds
// the shared Fleet-export feed (web `useExports`) and the admin export-jobs feed (web `useExportJobs`)
// through [ExportStatusSource], merges them the way the web `sortedJobs` memo does, and projects each
// cache-then-network emission onto the shared [UiState] surface (loading / content / empty / stale /
// offline / error). It exposes the single refresh action plus the PII-safe `view.opened` diagnostic.
// The view never performs HTTP — it only collects [state] and calls [refresh]/[recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/ExportStatusWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.exportstatus

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.admin.AdminStore
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
 * @param source the cache-then-network export + admin feeds (a shared-data-layer adapter in
 *   production, a fake in tests). The view-model owns no networking — it only merges + projects.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ExportStatusWidgetViewModel(
    source: ExportStatusSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects both cache-then-network feeds (the manual refetch affordance).
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    private val exportsUi: StateFlow<UiState<List<ExportStatusJob>>> =
        refreshTrigger.flatMapLatest { source.exports() }.asUiState { it.isEmpty() }

    private val adminUi: StateFlow<UiState<List<ExportStatusJob>>> =
        refreshTrigger.flatMapLatest { source.adminJobs() }.asUiState { it.isEmpty() }

    /**
     * The merged export-jobs feed as a lifecycle-aware [UiState]: loading (either feed on its first
     * load) / content / empty (no jobs) / stale / offline / hard error, carrying the freshest stamp +
     * the first error kind. The merge mirrors the web `sortedJobs` memo (dedupe-by-id, admin wins).
     */
    val state: StateFlow<UiState<List<ExportStatusJob>>> =
        combine(exportsUi, adminUi) { exports, admin -> combineExportStatusUi(exports, admin) }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), UiState.loading())

    /** Re-runs both cache-then-network loads (the web `exportsRefetch()` + `adminRefetch()`). */
    fun refresh() {
        logger.info("exportStatus.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once
     * per holder. Carries no job id / file name / status, so a diagnostics line can never leak what
     * was exported. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to ExportStatusRegistration.SLUG))
    }

    companion object {
        /** Wire the surface from the shared [ExportsStore] + [AdminStore] (P1/S8). */
        fun create(
            exportsStore: ExportsStore,
            adminStore: AdminStore,
            logger: Logger,
        ): ExportStatusWidgetViewModel =
            ExportStatusWidgetViewModel(
                source = StoreExportStatusSource(exportsStore, adminStore),
                logger = logger,
            )
    }
}

/**
 * Fold the two per-feed [UiState]s into the single surface state the composable renders — the native
 * analogue of the web component merging `useExports` + `useExportJobs` into one `sortedJobs` list and
 * one set of `isLoading`/`isStale`/`isError` flags. The merged rows come from
 * [ExportStatusProjection.merge]; the phase is loading while either feed is on its first load, a hard
 * error only when there is nothing to show, otherwise empty/content. Freshness folds to the freshest
 * stamp and the OR of the stale/refreshing flags, and the first present error kind wins.
 */
internal fun combineExportStatusUi(
    exports: UiState<List<ExportStatusJob>>,
    admin: UiState<List<ExportStatusJob>>,
): UiState<List<ExportStatusJob>> {
    val merged = ExportStatusProjection.merge(exports.data.orEmpty(), admin.data.orEmpty())
    val loading = exports.isLoading || admin.isLoading
    val hardError = exports.isError || admin.isError
    val phase =
        when {
            loading -> UiPhase.Loading
            merged.isEmpty() && hardError -> UiPhase.Error
            merged.isEmpty() -> UiPhase.Empty
            else -> UiPhase.Content
        }
    return UiState(
        phase = phase,
        data = if (phase == UiPhase.Loading || phase == UiPhase.Error) null else merged,
        fetchedAt = maxOfNullable(exports.fetchedAt, admin.fetchedAt),
        stale = exports.stale || admin.stale,
        refreshing = exports.refreshing || admin.refreshing,
        errorKind = exports.errorKind ?: admin.errorKind,
        httpStatus = exports.httpStatus ?: admin.httpStatus,
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
