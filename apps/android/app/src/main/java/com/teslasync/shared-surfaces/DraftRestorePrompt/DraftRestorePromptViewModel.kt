// UI-thread-free state holder backing the DraftRestorePrompt shared surface — the native port of the
// client-side state the web component manages (web/src/components/feedback/DraftRestorePrompt.tsx →
// `getDrafts` / `discardDraftEnvelope` / `subscribeDraftIndex` from `lib/draftIndex`, plus `useNavigate`
// and the `sessionStorage` one-shot guard). It binds the draft registry (P1/S8) through
// [DraftRestorePromptSource], re-shares the recoverable-draft feed as a lifecycle-aware [UiState]
// (loading / content / empty / stale / offline / error), and runs Discard / Discard-all as non-throwing
// fire-and-forget actions. The view never performs HTTP — it only collects [drafts] + [dismissed] and calls
// the action methods.
//
// A successful discard needs no manual re-fetch: the registry re-emits the trimmed list straight through
// [drafts] (web `subscribeDraftIndex` keeping the modal in sync). [retry]/[refresh] re-read the feed for the
// hard-error / stale affordances. [dismiss] sets the per-session one-shot guard (web `sessionStorage`), and
// [resume] sets it too before the host navigates (web `navigate(entry.route)`). [onViewOpened] emits the one
// PII-safe `view.opened` diagnostic (P1/S11) — surface slug only, never a draft label or route.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/DraftRestorePrompt) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.draftrestoreprompt

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.data.errorKindOf
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * State holder backing the Compose `DraftRestorePrompt`.
 *
 * @param source the draft registry read + mutation seam (the shared [DraftRegistry] in production, a fake
 *   in tests). The view-model owns no networking.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the PII-safe `view.opened`,
 *   the `draftRestore.*` action events, and a classified failure kind on a rejected discard — never a draft
 *   label, route, or storage key.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DraftRestorePromptViewModel(
    private val source: DraftRestorePromptSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val dismissedState = MutableStateFlow(false)
    private var viewOpenedRecorded = false

    /**
     * The recoverable-draft feed as a lifecycle-aware [UiState]: loading (first read, no cache) / content /
     * empty (no drafts) / stale / offline (cached after a failed re-read) / error (no cache). The composable
     * folds it through [DraftRestoreProjection] into the rendered card + list.
     */
    val drafts: StateFlow<UiState<List<DraftRecord>>> =
        refreshTrigger
            .flatMapLatest { source.drafts() }
            .asUiState(isEmpty = { it.isEmpty() })

    /**
     * The per-session one-shot guard (web `sessionStorage` `teslasync:draft-prompt-shown`): once the user
     * dismisses or resumes, the prompt stays hidden for the rest of the session. The composable collects
     * this to suppress the card without unmounting the holder.
     */
    val dismissed: StateFlow<Boolean> = dismissedState.asStateFlow()

    /** Hides the prompt for the session (web `handleDismiss` → `writeDismissed`). */
    fun dismiss() {
        logger.info(DraftRestorePromptRegistration.EVENT_DISMISS, surfaceField())
        dismissedState.update { true }
    }

    /**
     * Marks the prompt resumed for the session and logs the PII-safe event; the composable performs the
     * actual navigation to the draft's route via its host callback (web `handleResume` → `navigate`).
     */
    fun resume() {
        logger.info(DraftRestorePromptRegistration.EVENT_RESUME, surfaceField())
        dismissedState.update { true }
    }

    /**
     * Discards a single [record] (web `handleDiscard` → `discardDraftEnvelope`). The registry re-emits the
     * trimmed list through [drafts], so the row disappears reactively; a rejected removal is logged with its
     * classified kind (no toast — the web surface has none) and the row simply remains.
     */
    fun discard(record: DraftRecord) {
        logger.info(DraftRestorePromptRegistration.EVENT_DISCARD, surfaceField())
        launch {
            source.discard(record.storageKey).onFailure { error ->
                logFailure(DraftRestorePromptRegistration.EVENT_DISCARD_FAILED, error)
            }
        }
    }

    /** Discards every recoverable draft at once (catalog `draft.recovery.discardAll`). */
    fun discardAll() {
        logger.info(DraftRestorePromptRegistration.EVENT_DISCARD_ALL, surfaceField())
        launch {
            source.discardAll().onFailure { error ->
                logFailure(DraftRestorePromptRegistration.EVENT_DISCARD_ALL_FAILED, error)
            }
        }
    }

    /** Re-reads the draft feed after a hard error (web `refetch`); backs the retry affordance. */
    fun retry() {
        logger.info(DraftRestorePromptRegistration.EVENT_REFRESH, surfaceField())
        refreshTrigger.update { it + 1 }
    }

    /** Re-reads the feed over the shown list; backs the stale/offline freshness chip's auto-refresh. */
    fun refresh() = retry()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no draft label, route, or storage key. Call from the composable's first-composition
     * effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(DraftRestorePromptRegistration.EVENT_VIEW_OPENED, surfaceField())
    }

    private fun logFailure(
        event: String,
        error: Throwable,
    ) {
        logger.warn(event, surfaceField(DraftRestorePromptRegistration.KIND_KEY to errorKindOf(error).name))
    }

    private fun surfaceField(vararg extra: Pair<String, String>): Map<String, String> =
        mapOf(DraftRestorePromptRegistration.SURFACE_KEY to DraftRestorePromptRegistration.SLUG, *extra)

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: DraftRestorePromptSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { DraftRestorePromptViewModel(source, logger) }
            }
    }
}
