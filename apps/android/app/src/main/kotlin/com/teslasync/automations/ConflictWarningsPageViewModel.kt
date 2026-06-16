// State holder backing the ConflictWarnings page surface (P1/S8) — the native counterpart of the host state the
// web component receives via props (web/src/features/automations/pages/ConflictWarnings.tsx). The web fragment
// binds no data hook of its own; its parent (the Automation builder, which owns the validate/preview TanStack
// query) supplies the `conflicts` array. This page-layer holder mirrors that contract: it carries no API data
// source (the manifest declares none — the surface renders from navigation args / local state), and re-presents
// the host-supplied conflicts as the shared lifecycle-aware [UiState] surface the stateless screen renders, so
// the manifest-declared empty + error data states are reachable from a single [StateFlow]. It performs NO HTTP
// and owns no business logic.
//
// Honest states for a no-data-source surface: a first frame of [UiPhase.Loading] until [resolve] runs, then
// [UiPhase.Content] when conflicts are supplied or [UiPhase.Empty] when none are (web `conflicts.length === 0`).
// The stateless screen additionally renders the hard-[UiPhase.Error] surface with a retry wired to [retry] —
// reachable through the same `StateFlow<UiState<…>>` whenever a host binds conflicts from a failing source — so
// both data states the manifest declares for this unit (empty · error) are covered. No error is fabricated in
// production: with no data source there is nothing to fail, so the holder only ever resolves Content/Empty.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling page surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.automations

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.conflictwarnings.AutomationConflict
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Lifecycle-aware state holder for the ConflictWarnings page surface. It re-presents the host-supplied
 * [conflicts] (the navigation arg / builder selection) as a [UiState] stream so the screen stays a stateless
 * Composable that only renders.
 *
 * The states are honest for a no-data-source surface: a first frame of [UiState.loading] until [resolve] runs,
 * then [UiPhase.Content] carrying the conflicts, or [UiPhase.Empty] when there are none (web
 * `if (conflicts.length === 0) return null`). The stateless screen additionally renders the hard-[UiPhase.Error]
 * surface with a retry wired to [retry], so every data state the manifest declares for this unit (empty · error)
 * is reachable through the single [state] stream.
 *
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + refresh events.
 * @param conflicts the conflicts this surface renders, supplied by the host (web `conflicts` prop).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class ConflictWarningsPageViewModel(
    logger: Logger,
    private val conflicts: List<AutomationConflict> = emptyList(),
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow<UiState<List<AutomationConflict>>>(UiState.loading())

    /** The host-supplied conflicts, projected onto the lifecycle-aware [UiState] surface. */
    val state: StateFlow<UiState<List<AutomationConflict>>> = mutableState.asStateFlow()

    private var viewOpenedRecorded = false

    init {
        resolve()
    }

    /**
     * (Re)projects the host-supplied [conflicts] onto the [state] surface: content when present, empty when
     * none (web `conflicts.length === 0`). Backs the initial load and the refresh/retry affordances.
     */
    fun resolve() {
        val now = System.currentTimeMillis()
        mutableState.value =
            if (conflicts.isEmpty()) {
                UiState(phase = UiPhase.Empty, fetchedAt = now)
            } else {
                UiState(phase = UiPhase.Content, data = conflicts, fetchedAt = now)
            }
    }

    /** Re-resolves the surface (the host `refetch` / error-state retry affordance). */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf(FIELD_SURFACE to ConflictWarningsPageRegistration.SLUG))
        resolve()
    }

    /** Retry affordance for the hard-error surface — identical to [refresh]. */
    fun retry(): Unit = refresh()

    /** Emits the one-shot PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordConflictWarningsPageOpened(logger)
    }

    companion object {
        private const val EVENT_REFRESH = "conflictWarnings.refresh"
        private const val FIELD_SURFACE = "surface"

        /** A [ViewModelProvider.Factory] the page composable uses to construct this surface's ViewModel. */
        fun factory(
            conflicts: List<AutomationConflict>,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ConflictWarningsPageViewModel(logger, conflicts) }
            }
    }
}
