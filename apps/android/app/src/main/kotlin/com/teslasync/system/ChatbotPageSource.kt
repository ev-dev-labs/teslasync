// The data seam the ChatbotPage system surface binds to, plus its production binding over the shared KMP
// ChatStore (P1/S8). The view (composable) performs NO HTTP — it only collects state from the view-model, which
// drives this seam, reproducing the web page's five `useChat*` hooks (useChatSessions, useChatHistory,
// useSendChatMessage, useRenameChatSession, useDeleteChatSession) through the single shared store.
//
// The seam is intentionally a `ChatStore` factory rather than a flat method bag: the shared store memoizes its
// session + per-session-history feeds and owns the optimistic session-list patches + the disabled-history gate,
// so the page binds to that one holder. The store is created lazily over the page view-model's own scope (so the
// feeds live exactly as long as the screen observes them) from an injected [ChatRepository] — the real resilient
// HTTP repository in production, a fake in tests — so the view-model depends on an abstraction, never on a
// concrete client or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system

import io.teslasync.shared.core.data.repo.ChatRepository
import io.teslasync.shared.core.presentation.chat.ChatStore
import kotlinx.coroutines.CoroutineScope

/**
 * The single seam the [ChatbotPageViewModel] depends on so it binds to an abstraction (the shared chat store
 * over the resilient repository in production, a fake repository in tests), never to a concrete client or the
 * network. [chatStore] mints the shared [ChatStore] bound to the supplied [scope] — the page view-model passes
 * its own scope so the session + history feeds are collected only while the screen is observing them and are
 * dropped shortly after it leaves.
 */
fun interface ChatbotPageSource {
    /** Builds the shared [ChatStore] (S8) bound to [scope], over the seam's chat repository (S7). */
    fun chatStore(scope: CoroutineScope): ChatStore
}

/**
 * Binds the surface to the shared resilient [repo] (the same cache-then-network client + offline cache the
 * shared stores run on): each call mints a [ChatStore] over [repo] bound to the caller's scope. The session
 * list + per-session history are the store's `Resource` feeds; the send / rename / delete mutations route
 * through the store. No HTTP touches the view.
 */
fun chatbotPageSourceOf(repo: ChatRepository): ChatbotPageSource = ChatbotPageSource { scope -> ChatStore(repo, scope) }
