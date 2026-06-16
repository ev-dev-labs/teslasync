// The state holder backing the ChatbotPage system surface (P1/S8) — the native counterpart of the web page's
// React state + the five `useChat*` TanStack-Query hooks (web/src/features/system/pages/ChatbotPage.tsx). It
// binds the shared KMP [ChatStore] (built lazily over its own scope via the injected source) and projects the
// two reads onto the lifecycle-aware [UiState] / [ChatbotConversation] surfaces the stateless screen renders,
// and orchestrates the send + the client-side typewriter reveal + the session mutations off the UI thread. All
// pure derivation lives in the framework-free model (ChatbotPageModel.kt); this holder is the thin orchestration
// layer and performs no HTTP.
//
// Baseline-path fidelity: the page's declared data sources are the five `useChat*` hooks (NOT the optional
// `useAiStream`/`useAiEnabled` LLM branch, a separate surface). So a send is a single `POST /chatbot`
// (store.sendChatMessage); the full reply is then revealed by a coroutine typewriter that grows each row's
// `streamedText`, exactly as the web typewriter does — the ChatMessageItem feature view already renders the
// blinking caret + partial text from those two fields. Stop instantly reveals the rest (web `stream.stop()`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.system

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.data.errorKindOf
import io.teslasync.android.featureviews.chatmessageitem.ChatRole
import io.teslasync.android.featureviews.chatmessageitem.UIChatMessage
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.chat.ChatMessage
import io.teslasync.shared.core.presentation.chat.ChatResponse
import io.teslasync.shared.core.presentation.chat.ChatSessionInfo
import io.teslasync.shared.core.presentation.chat.ChatStore
import io.teslasync.shared.core.presentation.chat.SendChatMessageInput
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import java.time.Instant

/**
 * @param source the P1/S8 data seam (the shared chat store over the resilient repository in production ↔ a test
 *   fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + the send/mutation
 *   outcomes (never message content).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChatbotPageViewModel(
    source: ChatbotPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val store: ChatStore = source.chatStore(stateScope)
    private val ids = LocalMessageIds()
    private var viewOpenedRecorded = false

    private val selectedSessionId = MutableStateFlow("")
    private val localMessages = MutableStateFlow<List<UIChatMessage>>(emptyList())
    private val sending = MutableStateFlow(false)
    private val streaming = MutableStateFlow(false)

    private var typewriterJob: Job? = null
    private var sendJob: Job? = null

    /**
     * The selected session's history feed (web `useChatHistory`), shared and re-collected whenever the active
     * session changes. A blank session id resolves to the store's disabled feed (never fetches), so the page can
     * bind before a session is chosen.
     */
    private val historyResource: StateFlow<Resource<List<ChatMessage>>> =
        selectedSessionId
            .flatMapLatest { sessionId -> store.chatHistory(sessionId) }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), INITIAL_HISTORY)

    /** The sidebar session feed as cache-then-network UI state (web `useChatSessions`) — loading / content / empty / error. */
    val sessionsState: StateFlow<UiState<List<ChatSessionInfo>>> =
        store.chatSessions().asUiState(isEmpty = { it.isEmpty() })

    /**
     * The conversation projection for GlassPanel1 + GlassPanel2 — the local message list, the surface phase
     * (hero / spinner / retry / list), and the waiting/streaming flags, folded from the local optimistic list,
     * the bound history feed, and the send/typewriter flags.
     */
    val conversation: StateFlow<ChatbotConversation> =
        combine(localMessages, historyResource, sending, streaming, selectedSessionId) { messages, history, isSending, isStreaming, sessionId ->
            buildConversation(messages, history, isSending, isStreaming, sessionId)
        }.stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), INITIAL_CONVERSATION)

    init {
        // Hydrate the local message list from the loaded history (web hydration effect), preserving the local
        // optimistic/streaming state through the model's race guards.
        launch {
            historyResource.collect { resource ->
                val server = resource.dataOrCached() ?: return@collect
                val sessionId = selectedSessionId.value
                localMessages.update { previous ->
                    hydrateMessages(previous, server, sessionId, sessionId, streaming.value)
                }
            }
        }
    }

    // ---- Reads / lifecycle -------------------------------------------------------

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordChatbotPageOpened(logger)
    }

    /** Re-fetches the sidebar session feed (the SessionList hard-error retry). */
    fun refreshSessions() = store.refreshSessions()

    /** Re-fetches the active session's history feed (the conversation hard-error retry). */
    fun retryHistory() {
        val sessionId = selectedSessionId.value
        if (sessionId.isNotBlank()) store.refreshHistory(sessionId)
    }

    // ---- Send + typewriter -------------------------------------------------------

    /** Sends the trimmed [text] as a new user turn (web `submitMessage`, baseline path). */
    fun submit(text: String) {
        val message = text.trim()
        if (message.isEmpty() || sending.value || streaming.value) return
        dispatchSend(message, localMessages.value, addUserOptimistic = true)
    }

    /** Stops the typewriter and instantly reveals the rest of every streaming row (web `stopAll` / Esc). */
    fun stopStreaming() {
        typewriterJob?.cancel()
        typewriterJob = null
        localMessages.update { list ->
            list.map { if (it.isStreaming) it.copy(isStreaming = false, streamedText = null) else it }
        }
        streaming.value = false
    }

    /** Truncates at the edited user [message] and resends [newText] (web `handleEditAndResend`). */
    fun editAndResend(
        message: UIChatMessage,
        newText: String,
    ) {
        if (sending.value || streaming.value) return
        val plan = planEditAndResend(localMessages.value, message, newText, ids, nowIso()) ?: return
        dispatchSend(plan.textToSend, plan.messages, addUserOptimistic = false)
    }

    /** Drops the [assistant] reply and resends the preceding user turn for a fresh reply (web `handleRegenerate`). */
    fun regenerate(assistant: UIChatMessage) {
        if (sending.value || streaming.value) return
        val plan = planRegenerate(localMessages.value, assistant) ?: return
        dispatchSend(plan.textToSend, plan.messages, addUserOptimistic = false)
    }

    // ---- Session navigation + mutations -----------------------------------------

    /** Switches to an existing session, clearing the local list so the bound history hydrates it (web `loadSession`). */
    fun loadSession(sessionId: String) {
        resetActiveConversation()
        selectedSessionId.value = sessionId
    }

    /** Starts a fresh, unsent chat (web `startNewSession`). */
    fun startNewSession() {
        resetActiveConversation()
        selectedSessionId.value = ""
    }

    /** Renames a session (web `useRenameChatSession`); the store refreshes the sidebar on success. */
    fun rename(
        sessionId: String,
        title: String,
    ): Unit = mutate { store.renameChatSession(sessionId, title) }

    /** Deletes a session (web `useDeleteChatSession`); resets the active chat if it was the open one. */
    fun delete(sessionId: String) {
        mutate { store.deleteChatSession(sessionId) }
        if (sessionId == selectedSessionId.value) startNewSession()
    }

    // ---- Internals ---------------------------------------------------------------

    private fun resetActiveConversation() {
        stopStreaming()
        sendJob?.cancel()
        sendJob = null
        sending.value = false
        localMessages.value = emptyList()
    }

    private fun dispatchSend(
        text: String,
        base: List<UIChatMessage>,
        addUserOptimistic: Boolean,
    ) {
        val sessionId = selectedSessionId.value
        localMessages.value =
            if (addUserOptimistic) {
                base +
                    UIChatMessage(
                        id = ids.next(),
                        role = ChatRole.User,
                        content = text,
                        createdAt = nowIso(),
                        sessionId = sessionId.ifBlank { PENDING_SESSION },
                    )
            } else {
                base
            }
        sending.value = true
        sendJob =
            stateScope.launch {
                store
                    .sendChatMessage(SendChatMessageInput(message = text, sessionId = sessionId.takeIf { it.isNotBlank() }))
                    .onSuccess { response -> onSendSuccess(response, sessionId) }
                    .onFailure {
                        sending.value = false
                        logger.warn("chatbot.sendFailed")
                    }
            }
    }

    private fun onSendSuccess(
        response: ChatResponse,
        priorSessionId: String,
    ) {
        sending.value = false
        val newSessionId = response.sessionId
        // Adopt the (possibly newly-created) session id onto the optimistic user turn so the hydration guard
        // recognizes it as the current session's optimistic state.
        localMessages.update { list ->
            list.map { if (it.sessionId == PENDING_SESSION || it.sessionId.isBlank()) it.copy(sessionId = newSessionId) else it }
        }
        val assistantId = ids.next()
        localMessages.update { list ->
            list +
                UIChatMessage(
                    id = assistantId,
                    role = ChatRole.Assistant,
                    content = response.response,
                    createdAt = nowIso(),
                    sessionId = newSessionId,
                    isStreaming = true,
                    streamedText = "",
                )
        }
        startReveal(assistantId, response.response)
        if (priorSessionId.isBlank()) selectedSessionId.value = newSessionId
        store.refreshSessions()
    }

    private fun startReveal(
        id: Long,
        full: String,
    ) {
        typewriterJob?.cancel()
        streaming.value = true
        if (full.isEmpty()) {
            finishReveal(id, full)
            return
        }
        typewriterJob =
            stateScope.launch {
                var position = 0
                while (position < full.length) {
                    position = minOf(full.length, position + REVEAL_CHARS_PER_TICK)
                    val partial = full.substring(0, position)
                    localMessages.update { list -> list.map { if (it.id == id) it.copy(streamedText = partial) else it } }
                    delay(REVEAL_TICK_MILLIS)
                }
                finishReveal(id, full)
            }
    }

    private fun finishReveal(
        id: Long,
        full: String,
    ) {
        localMessages.update { list ->
            list.map { if (it.id == id) it.copy(isStreaming = false, streamedText = null, content = full) else it }
        }
        streaming.value = false
    }

    private fun buildConversation(
        messages: List<UIChatMessage>,
        history: Resource<List<ChatMessage>>,
        isSending: Boolean,
        isStreaming: Boolean,
        sessionId: String,
    ): ChatbotConversation {
        val phase =
            when {
                messages.isNotEmpty() -> ConversationPhase.Content
                sessionId.isBlank() -> ConversationPhase.Idle
                history is Resource.Loading && history.cached.isNullOrEmpty() -> ConversationPhase.Loading
                history is Resource.Error && history.cached.isNullOrEmpty() -> ConversationPhase.Error
                else -> ConversationPhase.Idle
            }
        return ChatbotConversation(
            messages = messages,
            phase = phase,
            sessionId = sessionId,
            isWaiting = isSending && !isStreaming,
            isStreaming = isStreaming,
            errorKind = (history as? Resource.Error)?.let { errorKindOf(it.error) },
        )
    }

    private fun mutate(block: suspend () -> Result<*>) {
        launch {
            block().onFailure { logger.warn("chatbot.mutationFailed") }
        }
    }

    private fun nowIso(): String = Instant.now().toString()

    private companion object {
        /** Reveal rate — ~40 chars per 16 ms tick (≈2,500 chars/s), tuned snappy without flooding recomposition (web parity). */
        const val REVEAL_CHARS_PER_TICK = 40
        const val REVEAL_TICK_MILLIS = 16L

        /** Sentinel session id stamped on an optimistic user turn before the server assigns the real id (web `'pending'`). */
        const val PENDING_SESSION = "pending"

        val INITIAL_HISTORY: Resource<List<ChatMessage>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
        val INITIAL_CONVERSATION =
            ChatbotConversation(
                messages = emptyList(),
                phase = ConversationPhase.Idle,
                sessionId = "",
                isWaiting = false,
                isStreaming = false,
            )
    }
}

/** The renderable payload of a [Resource] — fresh `data`, or the last cached value during a load/after an error. */
private fun <T> Resource<T>.dataOrCached(): T? =
    when (this) {
        is Resource.Success -> data
        is Resource.Loading -> cached
        is Resource.Error -> cached
    }
