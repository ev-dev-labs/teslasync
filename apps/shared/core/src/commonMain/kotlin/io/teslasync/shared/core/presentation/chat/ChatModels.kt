package io.teslasync.shared.core.presentation.chat

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Per-session metadata used to render the chatbot sidebar — the cross-platform port of the web
 * `ChatSessionInfo` interface (web/src/api/types.ts), itself mirroring the Go session rows
 * returned by `GET /chatbot/sessions`. Keys arrive snake_case and are matched verbatim via
 * [SerialName] so the cached payload round-trips unchanged.
 *
 * [title] is null when the user has not renamed the session — the UI then falls back to
 * [firstMessage]. None of the fields are unit-bearing, so there is no SI conversion at this layer;
 * display formatting is the render boundary's job (S5).
 */
@Serializable
public data class ChatSessionInfo(
    val id: String,
    val title: String? = null,
    @SerialName("first_message") val firstMessage: String? = null,
    @SerialName("message_count") val messageCount: Int = 0,
    @SerialName("last_message_at") val lastMessageAt: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
)

/**
 * One message in a chat session — the port of the web `ChatMessage` interface. Returned as a list
 * by `GET /chatbot/history?session_id=…`. [role] is `"user"` or `"assistant"` on the wire; it is
 * carried as a plain string so an unforeseen role never fails decoding.
 */
@Serializable
public data class ChatMessage(
    val id: Long,
    @SerialName("session_id") val sessionId: String,
    val role: String,
    val content: String,
    @SerialName("created_at") val createdAt: String,
)

/**
 * The assistant reply envelope — the port of the web `ChatResponse` interface. Returned by
 * `POST /chatbot`; [sessionId] is the (possibly newly-created) session the exchange belongs to,
 * which the caller threads back into subsequent sends.
 */
@Serializable
public data class ChatResponse(
    val response: String,
    @SerialName("session_id") val sessionId: String,
)

/**
 * The `PATCH /chatbot/sessions/{id}` response — the port of the web `{ id; title }` shape. The
 * server echoes the (trimmed) [title] it persisted; an empty string means the rename cleared the
 * override (the row falls back to its first message in the UI).
 */
@Serializable
public data class RenameSessionResult(
    val id: String,
    val title: String,
)

/**
 * The `POST /chatbot` body — the port of the web `sendChatMessage(message, sessionId?)` call. A
 * null [sessionId] starts a fresh session and is dropped from the wire body entirely (mirroring
 * `JSON.stringify` omitting an `undefined` `session_id`).
 */
public data class SendChatMessageInput(
    val message: String,
    val sessionId: String? = null,
)

/**
 * Normalises a raw rename [title] to the persisted shape — the exact derivation of the web
 * `useRenameChatSession` optimistic update: `vars.title.trim() === '' ? null : vars.title.trim()`.
 * A title that is empty or all-whitespace clears the override (returns null); otherwise the
 * trimmed title is kept. Locked by golden vectors shared with the Windows C# port (ADR-004).
 */
public fun normalizeChatTitle(title: String): String? = title.trim().ifEmpty { null }

/**
 * Applies a rename to the cached session list — the port of the web `useRenameChatSession`
 * `setQueryData` patch: the matching session's [ChatSessionInfo.title] is replaced with
 * [normalizeChatTitle] of [title]; every other session is left untouched. A [sessionId] that
 * matches no row returns the list unchanged. Locked by golden vectors shared with the C# port.
 */
public fun applyRenameToSessions(
    sessions: List<ChatSessionInfo>,
    sessionId: String,
    title: String,
): List<ChatSessionInfo> =
    sessions.map { session ->
        if (session.id == sessionId) session.copy(title = normalizeChatTitle(title)) else session
    }

/**
 * Removes a session from the cached list — the port of the web `useDeleteChatSession`
 * `setQueryData` patch: every session whose id is not [sessionId] is kept. Locked by golden
 * vectors shared with the C# port.
 */
public fun applyDeleteToSessions(
    sessions: List<ChatSessionInfo>,
    sessionId: String,
): List<ChatSessionInfo> = sessions.filter { it.id != sessionId }
