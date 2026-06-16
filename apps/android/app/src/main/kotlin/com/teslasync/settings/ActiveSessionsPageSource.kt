// The data seam the ActiveSessionsPage settings surface binds to, plus its production binding over the shared
// resilient client. The view (composable) performs NO HTTP — it only collects state from the view-model, which
// drives this seam, reproducing the web page's single domain (`useSessions` + the two revoke mutations
// `useRevokeSession` / `useRevokeAllOtherSessions`) that the embedded <ActiveSessionsSection /> consumes.
//
// The seam yields the cross-platform P1/S8 [SessionsStore] — the single shared state holder that owns the
// `GET /auth/sessions` cache-then-network feed (its 30s staleTime, the 501 AUTH_MODE_OPEN open-mode
// normalisation, and the invalidate-on-revoke rule), so neither this Android module nor the view re-implements
// any of it. The store is built over the [CoroutineScope] the view-model supplies (its `viewModelScope`) so the
// shared feed is collected only while the screen observes it and is cancelled when the screen leaves. A narrow
// seam: the view-model depends on this abstraction (the real binding ↔ a test fake over a fake
// [SessionRepository]), never on a concrete client or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/settings) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.settings.sessions

import io.teslasync.shared.core.data.repo.SessionRepository
import io.teslasync.shared.core.presentation.sessions.SessionsStore
import kotlinx.coroutines.CoroutineScope

/**
 * The single seam the [ActiveSessionsPageViewModel] depends on so it binds to an abstraction (the shared
 * sessions repository assembled into the P1/S8 [SessionsStore] in production, a fake in tests), never to a
 * concrete client or the network. The view-model passes its own scope so the shared feed's lifetime follows the
 * screen. No HTTP touches the view.
 */
interface ActiveSessionsPageSource {
    /**
     * Builds the shared active-session state holder bound to [scope] — the view-model's `viewModelScope` in
     * production, a `TestScope`-backed scope in tests. The store owns the single list feed plus the per-session
     * and all-others revoke mutations (web `useSessions` / `useRevokeSession` / `useRevokeAllOtherSessions`).
     */
    fun sessionsStore(scope: CoroutineScope): SessionsStore
}

/**
 * Binds the surface to the shared resilient [repository] (its `GET /auth/sessions` cache-then-network feed and
 * the two revoke mutations) by assembling the P1/S8 [SessionsStore] over the caller's [scope]. The repository is
 * the same `HttpSessionRepository` over the one resilient client + offline cache every shared store runs on, so
 * the open-mode normalisation, freshness, and invalidate-on-revoke contract come from the shared layer
 * unchanged. No HTTP touches the view.
 */
fun activeSessionsPageSourceOf(repository: SessionRepository): ActiveSessionsPageSource =
    object : ActiveSessionsPageSource {
        override fun sessionsStore(scope: CoroutineScope): SessionsStore = SessionsStore(repository, scope)
    }
