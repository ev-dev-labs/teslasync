// The state holder backing the SecretRotationPage admin surface (P1/S8) — the native counterpart of the web
// page's React state + TanStack-Query hook (web/src/features/admin/pages/SecretRotationPage.tsx). It projects
// the single cache-then-network read (`/admin/observability/secret-rotation`) onto the shared lifecycle-aware
// [UiState] surface via [BaseFeedViewModel.asUiState], with the structural-empty predicate keyed on the
// tracked-secret items list (web `items.length === 0`). All derivation lives in the framework-free model
// (SecretRotationPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.secretrotation

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.operatorconfidence.SecretRotationResponse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow

/** The page's interaction callbacks, wired to the [SecretRotationPageViewModel] (web event handlers). */
data class SecretRotationActions(
    val onRetry: () -> Unit,
)

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.presentation.operatorconfidence.OperatorConfidenceStore]
 *   adapter ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class SecretRotationPageViewModel(
    private val source: SecretRotationSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /**
     * The secret-rotation surface as cache-then-network UI state (loading / content / empty / stale /
     * offline / error). Empty is keyed on the tracked-secret items list so a successful-but-empty response
     * renders the native empty state (web `items.length === 0`); the HTTP-503 "subsystem not configured"
     * case is surfaced through [UiState.httpStatus] and branched at the render boundary.
     */
    val state: StateFlow<UiState<SecretRotationResponse>> =
        source.secretRotation().asUiState(isEmpty = { it.items.isEmpty() })

    /** Re-collect the cache-then-network feed (the web `refetchInterval` / error retry affordance). */
    fun refresh() {
        logger.info("secretRotation.refresh")
        source.refresh()
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSecretRotationPageOpened(logger)
    }
}
