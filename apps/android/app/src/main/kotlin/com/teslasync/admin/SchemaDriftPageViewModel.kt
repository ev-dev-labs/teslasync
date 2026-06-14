// The state holder backing the SchemaDriftPage admin surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hook (web/src/features/admin/pages/SchemaDriftPage.tsx). The page has no local
// interaction state (it is a read-only fingerprint comparison), so this holder is a thin orchestration layer: it
// projects the single cache-then-network read (`GET /admin/observability/schema-drift`) onto the shared
// lifecycle-aware [UiState] surface via [BaseFeedViewModel.asUiState] and exposes the refresh/retry seam. The
// HTTP 503 / subsystem-not-configured branch (web `error.status === 503`) is preserved through [UiState.httpStatus]
// for the render layer to surface the "subsystem unavailable" banner. All derivation logic lives in the
// framework-free model (SchemaDriftPageModel.kt); this holder performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.schemadrift

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.operatorconfidence.SchemaDriftResponse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.presentation.operatorconfidence.OperatorConfidenceStore]
 *   adapter ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SchemaDriftPageViewModel(
    private val source: SchemaDriftSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The schema-drift feed as cache-then-network UI state (loading / content / empty / stale / offline /
     * error). Re-collected whenever the refresh trigger bumps. The empty predicate is the model's
     * "no fingerprint computed yet" guard (web empty-state), so a real fingerprint — even one with zero drift —
     * resolves to content (the summary + details panels) rather than the empty panel.
     */
    val state: StateFlow<UiState<SchemaDriftResponse>> =
        refreshTrigger
            .flatMapLatest { source.schemaDrift() }
            .asUiState(isEmpty = { it.isEmptyDrift })

    /** Re-fetch the schema-drift feed (the web `refetchInterval` / error-retry affordance). */
    fun refresh() {
        logger.info("schemaDrift.refresh")
        source.refresh()
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSchemaDriftPageOpened(logger)
    }
}
