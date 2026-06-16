// The state holder backing the UsersPage admin surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/admin/pages/UsersPage.tsx). It owns the page's local
// interaction state (which subject's start mutation is in flight) and projects the two shared cache-then-network
// reads onto the shared lifecycle-aware [UiState] surface via [BaseFeedViewModel.asUiState]:
//   - the impersonatable-subjects feed (web `useImpersonationCandidates`) drives the page's four declared data
//     states (loading / empty / error / success);
//   - the two derived predicate flows ([isOpenMode] = web `isImpersonationOpenMode`, [isActive] =
//     web `isImpersonationActive`) drive the open-mode notice + the per-row disabled decision.
//
// The web hook gates the candidates query behind `enabled: !open`; that opt-in is reproduced here by switching
// the candidates feed off (to the open sentinel) whenever the state resolves to open mode, so an open-mode
// install issues no `/candidates` query, exactly as the web page does. All derivation logic lives in the
// framework-free model (UsersPageModel.kt); this holder performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.users

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.impersonation.ImpersonationCandidatesResponse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.presentation.impersonation.ImpersonationStore]
 *   adapter ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened`, start + refresh.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class UsersPageViewModel(
    private val source: UsersPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false
    private val startingSubjectState = MutableStateFlow<String?>(null)

    /** The subject whose start mutation is in flight, or `null` (web per-button `startMut.isPending`). */
    val startingSubject: StateFlow<String?> = startingSubjectState.asStateFlow()

    /** `true` once the deployment resolves to open mode — the web `open = isImpersonationOpenMode(status.data)`. */
    val isOpenMode: StateFlow<Boolean> = source.isOpenMode

    /** `true` while a session is active, disabling every per-row button — the web `active` ▸ `disabled={active}`. */
    val isActive: StateFlow<Boolean> = source.isActive

    /**
     * The impersonatable-subjects feed as cache-then-network UI state (loading / content / empty / stale /
     * offline / error). Gated on [isOpenMode] to reproduce the web hook's `enabled: !open`: in open mode the
     * candidates query is switched off (resolving to the open sentinel ▸ Empty) so no `/candidates` request is
     * issued; otherwise it tracks the shared feed. The empty predicate is the model's no-subjects guard (web
     * `subjects.length === 0`), so a session with at least one subject resolves to content (the list) rather than
     * the empty panel.
     */
    val candidatesState: StateFlow<UiState<ImpersonationCandidatesResponse>> =
        source.isOpenMode
            .flatMapLatest { open -> if (open) flowOf(OPEN_CANDIDATES) else source.candidates }
            .asUiState(isEmpty = { it.isEmptyCandidates })

    /**
     * Starts impersonating [subject] (web `useStartImpersonation().mutate({ subject })`). Guards against a
     * double-fire while one start is in flight; the shared store wipes the cache + primes the new active state
     * and refreshes both feeds on success, so [isActive] flips true (disabling the buttons) without an extra call
     * here. [startingSubject] resets when the mutation settles.
     */
    fun startImpersonation(subject: String) {
        if (startingSubjectState.value != null) return
        startingSubjectState.update { subject }
        logger.info(EVENT_START, surfaceField)
        launch {
            source.startImpersonation(subject)
            startingSubjectState.update { null }
        }
    }

    /** Re-fetches both feeds — backs the hard-error retry (web candidates `refetch`) and keeps status fresh. */
    fun refresh() {
        logger.info(EVENT_REFRESH, surfaceField)
        source.refresh()
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordUsersPageOpened(logger)
    }

    private val surfaceField: Map<String, String>
        get() = mapOf(FIELD_SURFACE to UsersPageRegistration.SLUG)

    private companion object {
        const val EVENT_START = "usersPage.startImpersonation"
        const val EVENT_REFRESH = "usersPage.refresh"

        /** The open-mode sentinel the candidates feed resolves to while gated off (web `{ mode: 'open' }`). */
        val OPEN_CANDIDATES: Resource<ImpersonationCandidatesResponse> =
            Resource.Success(ImpersonationCandidatesResponse.Open, 0L, false)
    }
}
