package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.chat.ChatMessage
import io.teslasync.shared.core.presentation.chat.ChatResponse
import io.teslasync.shared.core.presentation.chat.ChatSessionInfo
import io.teslasync.shared.core.presentation.chat.RenameSessionResult
import io.teslasync.shared.core.presentation.chat.SendChatMessageInput
import kotlinx.coroutines.flow.Flow

/**
 * The S7 data port for the AI assistant chat store — the cross-platform analogue of the web
 * `useChat` hook domain (web/src/api/hooks/useChat.ts) and its `@/api/devtools` chat exports.
 * Every native Chat screen (Android/Apple via KMP, Windows via the C# port) reaches the backend
 * exclusively through this interface, so a single fake stands in for the whole domain in the S8
 * state-holder tests.
 *
 * The two reads stream a cache-then-network [Resource] (ADR-013): the cached rows first for an
 * instant cold start, then the refreshed rows. [chatSessions] mirrors the web `useChatSessions`
 * (the sidebar feed); [chatHistory] mirrors `useChatHistory` (one session's messages).
 *
 * The three mutations are non-throwing suspend [Result]s. [renameChatSession] and
 * [deleteChatSession] optimistically patch the cached session list on success — the data-layer
 * analogue of the web hooks' `setQueryData` — so a refresh shows the corrected list immediately
 * while the network reload runs; [deleteChatSession] additionally evicts the deleted session's
 * cached history (the web `removeQueries(history)` analogue). [sendChatMessage] has no cache
 * interaction (the web hook leaves `onSuccess` to the caller, which pushes the reply into local
 * UI state for the typewriter reveal).
 *
 * Chat fields are plain (ids, timestamps, titles, message text) — not unit-bearing — so they
 * round-trip verbatim with no SI conversion; display formatting is the render boundary's job (S5).
 */
public interface ChatRepository {
    /**
     * `GET /chatbot/sessions` — the session sidebar feed (web `useChatSessions`). Cached under
     * the fixed [CHAT_SESSIONS_KEY], mirroring the web `chatKeys.sessions()` query key.
     */
    public fun chatSessions(): Flow<Resource<List<ChatSessionInfo>>>

    /**
     * `GET /chatbot/history?session_id={sessionId}` — one session's messages (web
     * `useChatHistory`). Cached under [chatHistoryKey] of [sessionId], mirroring the web
     * `chatKeys.history(sessionId)` query key.
     */
    public fun chatHistory(sessionId: String): Flow<Resource<List<ChatMessage>>>

    /**
     * `PATCH /chatbot/sessions/{sessionId}` with `{ title }` — renames a session (web
     * `useRenameChatSession`). An empty [title] clears the override. On success the cached
     * session list is optimistically patched (matching row's title normalised).
     */
    public suspend fun renameChatSession(
        sessionId: String,
        title: String,
    ): Result<RenameSessionResult>

    /**
     * `DELETE /chatbot/sessions/{sessionId}` — removes a session and all its messages (web
     * `useDeleteChatSession`). On success the cached session list is optimistically patched
     * (row removed) and the session's cached history is evicted.
     */
    public suspend fun deleteChatSession(sessionId: String): Result<Unit>

    /**
     * `POST /chatbot` with `{ message, session_id? }` — sends a user message and returns the
     * assistant reply (web `useSendChatMessage`). No cache interaction.
     */
    public suspend fun sendChatMessage(input: SendChatMessageInput): Result<ChatResponse>
}

/**
 * The fixed cache/feed key for the session list, mirroring the web `chatKeys.sessions()` tuple
 * `['chat', 'sessions']`. A constant because the list takes no params.
 */
public const val CHAT_SESSIONS_KEY: String = "sessions"

/**
 * Builds the stable cache/feed key for [sessionId]'s history, mirroring the web
 * `chatKeys.history(sessionId)` tuple `['chat', 'history', sessionId]`. Prefixed so it can never
 * collide with [CHAT_SESSIONS_KEY] in the shared partition. Locked by golden vectors shared with
 * the C# port.
 */
public fun chatHistoryKey(sessionId: String): String = "history:$sessionId"

/**
 * Builds the `/chatbot/history` query map — the port of the web
 * `request('/chatbot/history?session_id=${sessionId}')` call: a single snake_case `session_id`
 * parameter carrying [sessionId] verbatim. Locked by golden vectors shared with the C# port.
 */
public fun chatHistoryQuery(sessionId: String): Map<String, String> = mapOf("session_id" to sessionId)
