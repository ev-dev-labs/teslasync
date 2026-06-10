package io.teslasync.shared.core.presentation.chat

import io.teslasync.shared.core.data.repo.CHAT_SESSIONS_KEY
import io.teslasync.shared.core.data.repo.ChatRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.chatHistoryKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for the AI assistant chat store — the cross-platform port of the web
 * `useChat` hook domain (web/src/api/hooks/useChat.ts). Every native Chat screen (Android/Apple via
 * KMP, Windows via the C# port) binds to this single holder rather than re-implementing endpoints,
 * query keys, the session-list optimistic patches, or the disabled-history gate.
 *
 * The two reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013), each
 * lazily created on first access and shared so every observer of the same feed folds into one
 * upstream collection:
 *  - [chatSessions] mirrors the web `useChatSessions` — the single sidebar feed;
 *  - [chatHistory] mirrors `useChatHistory` — one session's messages, keyed by session id. The web
 *    hook gates it with `enabled: !!sessionId`; the holder reproduces that gate: a blank session id
 *    returns a feed that never fetches and stays at the initial Loading slot, so a screen can bind
 *    before a session is selected. All such disabled feeds collapse to one stable instance.
 *
 * The mutations are non-throwing suspend [Result]s. [renameChatSession] / [deleteChatSession]
 * refresh the sessions feed on success — the holder-side analogue of the web hooks invalidating
 * `chatKeys.sessions()`; the repository (S7) has already optimistically patched the cached list
 * (and, for delete, evicted the session's history) on the same success, so the refresh's Loading
 * emission carries the corrected list instantly while the network reload runs. [sendChatMessage]
 * has no cache interaction — exactly like the web hook, which leaves `onSuccess` to the caller so a
 * screen can push the reply into local UI state for the typewriter reveal.
 *
 * The holder makes no network calls itself; it delegates entirely to the injected [ChatRepository].
 * Values stay SI; conversion is display-only (S5). It mirrors the web hook's single-threaded usage
 * and is not internally synchronised; create and drive it from one confinement (the platform main
 * scope).
 *
 * @property repo the S7 data port every feed and mutation is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class ChatStore(
    private val repo: ChatRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val sessionsFeed: StateFlow<Resource<List<ChatSessionInfo>>> by lazy {
        trigger(CHAT_SESSIONS_KEY)
            .flatMapLatest { repo.chatSessions() }
            .stateIn(scope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), INITIAL_SESSIONS)
    }
    private val historyFeeds = mutableMapOf<String, StateFlow<Resource<List<ChatMessage>>>>()
    private val disabledHistory: StateFlow<Resource<List<ChatMessage>>> = MutableStateFlow(INITIAL_HISTORY)

    // ---- Reads --------------------------------------------------------------------

    /** Shared, refreshable `GET /chatbot/sessions` sidebar feed (web `useChatSessions`). */
    public fun chatSessions(): StateFlow<Resource<List<ChatSessionInfo>>> = sessionsFeed

    /**
     * Shared, refreshable `GET /chatbot/history?session_id={sessionId}` feed (web `useChatHistory`).
     * A blank [sessionId] returns the disabled feed that never fetches — the analogue of the web
     * hook's `enabled: !!sessionId`.
     */
    public fun chatHistory(sessionId: String): StateFlow<Resource<List<ChatMessage>>> {
        if (sessionId.isBlank()) return disabledHistory
        val key = chatHistoryKey(sessionId)
        return historyFeeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { repo.chatHistory(sessionId) }
                .stateIn(scope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), INITIAL_HISTORY)
        }
    }

    // ---- Mutations ----------------------------------------------------------------

    /**
     * Renames a session, then refreshes the sessions feed (web `useRenameChatSession`). An empty
     * [title] clears the override. The repository has already optimistically patched the cached
     * list, so the refresh shows the new title immediately while the reload runs.
     */
    public suspend fun renameChatSession(
        sessionId: String,
        title: String,
    ): Result<RenameSessionResult> = repo.renameChatSession(sessionId, title).onSuccess { refreshSessions() }

    /**
     * Deletes a session, then refreshes the sessions feed (web `useDeleteChatSession`). The
     * repository has already removed the row from the cached list and evicted the session's
     * cached history on the same success.
     */
    public suspend fun deleteChatSession(sessionId: String): Result<Unit> =
        repo.deleteChatSession(sessionId).onSuccess { refreshSessions() }

    /**
     * Sends a user message and returns the assistant reply (web `useSendChatMessage`). No cache
     * interaction — the caller pushes the reply into local UI state.
     */
    public suspend fun sendChatMessage(input: SendChatMessageInput): Result<ChatResponse> = repo.sendChatMessage(input)

    /** Re-fetches the sessions feed if it is being observed — the `invalidateQueries` analogue. */
    public fun refreshSessions() {
        triggers[CHAT_SESSIONS_KEY]?.update { it + 1 }
    }

    /** Re-fetches [sessionId]'s history feed if it is being observed; a no-op otherwise. */
    public fun refreshHistory(sessionId: String) {
        if (sessionId.isBlank()) return
        triggers[chatHistoryKey(sessionId)]?.update { it + 1 }
    }

    // ---- Internals ----------------------------------------------------------------

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val INITIAL_SESSIONS: Resource<List<ChatSessionInfo>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
        val INITIAL_HISTORY: Resource<List<ChatMessage>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
