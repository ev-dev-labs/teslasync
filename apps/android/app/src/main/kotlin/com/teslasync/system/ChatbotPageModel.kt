// Pure, framework-free model + derivations for the ChatbotPage system surface — the native analogue of the
// non-UI logic the web page owns before it renders JSX
// (web/src/features/system/pages/ChatbotPage.tsx). No Compose, no Android framework, no HTTP lives here, so
// every type is exercised off-device and the composable + view-model stay thin.
//
// The web page is the Helix AI-assistant chat surface. Its declared data sources (apps/parity manifest record
// page:system/Chatbot) are exactly the five `useChat*` hooks — useChatSessions, useChatHistory,
// useSendChatMessage, useRenameChatSession, useDeleteChatSession — wired here through the shared KMP ChatStore
// (P1/S8). The optional `useAiStream`/`useAiEnabled` LLM-streaming branch (the AIChatbotIndicator / AIVoiceMode
// surfaces) is a separate parity unit and not among this page's declared data sources, so this port reproduces
// the baseline heuristic path: a `POST /chatbot` send whose full reply is revealed by a client-side typewriter
// — which on its own exercises all five hooks, both GlassPanels, and every one of the 13 strings.
//
// This file owns the parts the web component computes off-state: the local message id minting (web `nextLocalId`
// — negative ids that never collide with the backend's positive ids), the wire->UI message projection (web
// `toUIMessage`), and the truncate-then-resend reducers for the edit-and-resend (web `handleEditAndResend`) and
// regenerate (web `handleRegenerate`) flows. None of the chat fields are unit-bearing (ids, ISO timestamps,
// titles, free text), so there is no SI conversion; locale/clock formatting is the render boundary's job (S5,
// done inside ChatMessageItem).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory (com/teslasync/system —
// the P3 prompt's allowed-files path) cannot form the `io.teslasync.android.*` package the rest of the app uses,
// so the package intentionally diverges from the path — exactly as the sibling notifications/admin surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.featureviews.chatmessageitem.ChatRole
import io.teslasync.android.featureviews.chatmessageitem.UIChatMessage
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.chat.ChatMessage

/**
 * Canonical metadata for the ChatbotPage surface. The web page is a top-level system route, not a draggable
 * dashboard widget, so there is no web registry row to mirror — this object carries the navigation
 * [ROUTE_ID] / [WEB_PATH] the host wires (already a metadata-only destination at Destinations.kt) and the
 * diagnostics [SLUG] emitted with the one-shot `view.opened` event (P1/S11).
 */
object ChatbotPageRegistration {
    /** The navigation destination id (Destinations.kt `page("chatbot", "/chatbot", NavGroup.System)`). */
    const val ROUTE_ID: String = "chatbot"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/chatbot"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ChatbotPage"
}

/**
 * The mutually-exclusive surface the conversation region of GlassPanel1 renders — the native analogue of the
 * web page's `messages.length === 0 ? hero : list` branch plus the bound history feed's lifecycle (loading /
 * error). [Content] shows the message list; [Idle] shows the Helix hero + suggested prompts (a fresh chat or a
 * loaded-but-empty session); [Loading] shows a spinner while a selected session's history first-loads; [Error]
 * shows a retry affordance when that load hard-fails with nothing cached.
 */
enum class ConversationPhase { Idle, Loading, Error, Content }

/**
 * The immutable conversation state the stateless content renders — the projection the [ChatbotPageViewModel]
 * exposes for GlassPanel1 + GlassPanel2. Pure data (no Compose) so the phase/derivation logic is unit-tested
 * off-device.
 *
 * @property messages the local, render-ready message list (web `messages`) — hydrated from the history feed and
 *   mutated optimistically by send + the typewriter reveal; the source of truth for the active session.
 * @property phase which conversation surface to draw (list / hero / spinner / retry).
 * @property sessionId the active session id (web `sessionId`); blank for a fresh, unsent chat.
 * @property isWaiting whether the "Helix is thinking…" indicator (GlassPanel2) should show — the send is in
 *   flight and no reply text has started revealing yet (web `isWaiting`).
 * @property isStreaming whether a typewriter reveal is active, so the input's Send swaps to Stop (web
 *   `isStreaming`).
 * @property errorKind the classification of a hard history-load failure, for the localized retry surface.
 */
data class ChatbotConversation(
    val messages: List<UIChatMessage>,
    val phase: ConversationPhase,
    val sessionId: String,
    val isWaiting: Boolean,
    val isStreaming: Boolean,
    val errorKind: ErrorKind? = null,
)

/**
 * Mints client-side message ids — the native analogue of the web `nextLocalId()`. Ids are strictly negative and
 * monotonically decreasing so they never collide with the backend's positive ids and stay stable as list keys.
 * Single-confinement (driven from the view-model's main scope), matching the web module-level counter.
 */
class LocalMessageIds {
    private var counter: Long = 0L

    /** The next unique, negative local id. */
    fun next(): Long {
        counter -= 1
        return counter
    }
}

/** Projects a wire [ChatMessage] onto the feature-view [UIChatMessage] — the native `toUIMessage`. */
fun ChatMessage.toUiMessage(): UIChatMessage =
    UIChatMessage(
        id = id,
        role = ChatRole.fromWire(role),
        content = content,
        createdAt = createdAt,
        sessionId = sessionId,
    )

/** Projects a whole history page in order — the native `data.map(toUIMessage)`. */
fun List<ChatMessage>.toUiMessages(): List<UIChatMessage> = map { it.toUiMessage() }

/**
 * The result of a truncate-then-resend reducer: the optimistic message list to display now plus the text to
 * resend to the backend. Returned by [planEditAndResend] / [planRegenerate]; a `null` from either means the
 * action is a no-op (the target row was not found, or no preceding user turn exists).
 */
data class ResendPlan(
    val messages: List<UIChatMessage>,
    val textToSend: String,
)

/**
 * Plans an edit-and-resend — the native mirror of the web `handleEditAndResend`: truncate the conversation at
 * the edited user [target], append the edited copy carrying [newText] with a fresh [ids] id, and resend
 * [newText]. Returns `null` when [target] is absent so the caller leaves the list untouched.
 */
fun planEditAndResend(
    messages: List<UIChatMessage>,
    target: UIChatMessage,
    newText: String,
    ids: LocalMessageIds,
    nowIso: String,
): ResendPlan? {
    val index = messages.indexOfFirst { it.id == target.id }
    if (index < 0) return null
    val edited =
        target.copy(
            id = ids.next(),
            content = newText,
            createdAt = nowIso,
            isStreaming = false,
            streamedText = null,
        )
    return ResendPlan(messages.take(index) + edited, newText)
}

/**
 * Plans a regenerate — the native mirror of the web `handleRegenerate`: find the user turn immediately
 * preceding the [assistant] message and truncate the conversation just before that assistant row, then resend
 * the user turn's text so the backend produces a fresh reply. Returns `null` when the assistant row is missing
 * or no preceding user turn exists.
 */
fun planRegenerate(
    messages: List<UIChatMessage>,
    assistant: UIChatMessage,
): ResendPlan? {
    val index = messages.indexOfFirst { it.id == assistant.id }
    if (index <= 0) return null
    val priorUser = messages.take(index).lastOrNull { it.role == ChatRole.User } ?: return null
    return ResendPlan(messages.take(index), priorUser.content)
}

/**
 * Hydrates the local message list from a freshly-loaded history [serverMessages] for [feedSessionId] — the
 * native mirror of the web hydration effect's race guards. The local optimistic list stays authoritative when
 * a reveal is in flight for the current session, and an empty server read for the current session (a stale read
 * of a brand-new, not-yet-persisted chat) is ignored; otherwise the server rows replace the list.
 */
fun hydrateMessages(
    previous: List<UIChatMessage>,
    serverMessages: List<ChatMessage>,
    feedSessionId: String,
    activeSessionId: String,
    streaming: Boolean,
): List<UIChatMessage> {
    if (feedSessionId != activeSessionId) return previous
    val firstSessionId = previous.firstOrNull()?.sessionId
    val optimisticForCurrent = firstSessionId != null && firstSessionId == activeSessionId
    if (optimisticForCurrent && streaming) return previous
    if (serverMessages.isEmpty() && optimisticForCurrent) return previous
    return serverMessages.toUiMessages()
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ChatbotPageRegistration.SLUG] (P1/S11);
 * carries no message content. The composable calls it from its first-composition effect.
 */
fun recordChatbotPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ChatbotPageRegistration.SLUG))
}
