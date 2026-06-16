// The state holder backing the ActiveSessionsPage settings surface (P1/S8) — the native counterpart of the web
// page's React state + TanStack-Query hooks (web/src/features/settings/components/ActiveSessionsSection.tsx,
// which the web page wraps 1:1). It projects the shared active-sessions feed onto the lifecycle-aware [UiState]
// the embedded ActiveSessionsSection feature view renders, and orchestrates the two revoke mutations off the UI
// thread while tracking their in-flight ids so the row + footer controls show the busy state (web
// `revokeMut.isPending && revokeMut.variables === row.id` / `revokeAllOthersMut.isPending`). All adapting logic
// lives in the framework-free model (ActiveSessionsPageModel.kt); this holder is the thin orchestration layer and
// performs no HTTP.
//
// The single feed comes from the shared P1/S8 [io.teslasync.shared.core.presentation.sessions.SessionsStore]
// (built over this view-model's scope by the source) — its cache-then-network value is mapped to the feature
// view's [ActiveSessionsData] and projected with the forward-auth empty guard so the section renders the
// open-mode advisory, the list, the empty state, or the stale/offline + retry surface without ever fetching
// here. Each successful mutation refreshes the feed inside the store (web `invalidateQueries(sessionKeys.list)`);
// a failed mutation refreshes nothing and is logged without leaking device content.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/settings) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.settings.sessions

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.activesessionssection.ActiveSessionsData
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.sessions.SessionsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map

/**
 * @param source the P1/S8 data seam (the shared sessions repository assembled into a [SessionsStore] in
 *   production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened`, refresh, and the
 *   mutation outcomes — never any session id, IP, or user-agent.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class ActiveSessionsPageViewModel(
    source: ActiveSessionsPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val store: SessionsStore = source.sessionsStore(stateScope)
    private var viewOpenedRecorded = false

    private val revokingIdState = MutableStateFlow<String?>(null)
    private val revokingAllState = MutableStateFlow(false)

    /**
     * The active-sessions feed as cache-then-network UI state (loading / content / empty / stale / offline /
     * error), adapted from the shared-core list value to the feature view's [ActiveSessionsData] input. A
     * session-mode value with no rows resolves to the empty surface (web `emptyMessage` branch); the open-mode
     * advisory always renders as content so the section never blanks.
     */
    val state: StateFlow<UiState<ActiveSessionsData>> =
        store.sessions
            .map { resource -> resource.mapData { it.toFeatureData() } }
            .asUiState(isEmpty = { it.isEmptyList() })

    /** The id of the session currently being revoked, so its row action shows the in-flight state (else `null`). */
    val revokingId: StateFlow<String?> = revokingIdState.asStateFlow()

    /** Whether the revoke-all-others mutation is in flight, so the footer button shows its busy label. */
    val revokingAll: StateFlow<Boolean> = revokingAllState.asStateFlow()

    /** Re-fetches the feed — wired to the section's hard-error retry and its stale auto-refresh affordance. */
    fun refresh() {
        logger.info("accountSessions.refresh")
        store.refresh()
    }

    /**
     * Revokes a single session by [id] (web `useRevokeSession.mutate(id)`). The store refreshes the feed on
     * success; a failure is logged without leaking device content and leaves the cached list visible. The
     * in-flight [revokingId] drives the row action's disabled state and the confirm dialog's spinner.
     */
    fun revoke(id: String) {
        launch {
            revokingIdState.value = id
            try {
                store.revokeSession(id).onFailure { logger.warn("accountSessions.revokeFailed") }
            } finally {
                revokingIdState.value = null
            }
        }
    }

    /**
     * Revokes every other session for the current subject (web `useRevokeAllOtherSessions`). The store refreshes
     * the feed on success; a failure is logged and leaves the list intact. The in-flight [revokingAll] drives the
     * footer button's busy label.
     */
    fun revokeAllOthers() {
        launch {
            revokingAllState.value = true
            try {
                store.revokeAllOtherSessions().onFailure { logger.warn("accountSessions.revokeAllOthersFailed") }
            } finally {
                revokingAllState.value = false
            }
        }
    }

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the page slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordActiveSessionsPageOpened(logger)
    }
}
