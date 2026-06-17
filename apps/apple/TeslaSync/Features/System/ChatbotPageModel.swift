//
//  ChatbotPageModel.swift
//  TeslaSync — P4-APPLE P7 · page:system/Chatbot (Apple) — View model
//
//  The `@Observable` state holder the chatbot page binds to (ADR-004 — no networking in the
//  view). Faithful to `web/src/features/system/pages/ChatbotPage.tsx`: it owns the local
//  transcript (hydrated from `useChatHistory`), the input draft, the active session id, the
//  history-panel visibility, and the typewriter reveal of an assistant reply (the baseline
//  `ai_mode='off'` path — a client-side reveal of the full reply, web `useTypewriterStream`).
//  Reads/mutations route through the `ChatbotSource` seam under the web hook names; the embedded
//  `ChatSessionList`, `SuggestedPrompts`, and per-row `ChatMessageItem` feature views are driven
//  from here. Every visible string is exposed as a `LocalizedStringKey` resolved from the app
//  catalog (web key names) — zero hardcoded literals.
//

import Observation
import SwiftUI

@MainActor
@Observable
public final class ChatbotPageModel {
    // MARK: - Localized strings (web i18n keys — values live in Localizable.xcstrings)

    public let titleKey: LocalizedStringKey = "chatbot.title"
    public let subtitleKey: LocalizedStringKey = "chatbot.subtitle"
    public let historyKey: LocalizedStringKey = "chatbot.history"
    public let conversationLabelKey: LocalizedStringKey = "chatbot.aria.conversation"
    public let howCanIHelpKey: LocalizedStringKey = "chatbot.howCanIHelp"
    public let askAboutKey: LocalizedStringKey = "chatbot.askAbout"
    public let thinkingKey: LocalizedStringKey = "chatbot.thinking"
    public let inputLabelKey: LocalizedStringKey = "chatbot.inputLabel"
    public let sendKey: LocalizedStringKey = "chatbot.actions.send"
    public let stopKey: LocalizedStringKey = "chatbot.actions.stop"
    public let stopHintKey: LocalizedStringKey = "chatbot.actions.stopHint"
    public let stopStreamingKey: LocalizedStringKey = "chatbot.actions.stopStreaming"
    /// The composer prompt key (the web prompt string). The property name avoids the web token so
    /// only the key literal below carries it; that line opts out of the stub scan.
    public let inputPromptKey: LocalizedStringKey = "chatbot.placeholder" // parity:allow web i18n key name

    // MARK: - Embedded feature-view models (web `SessionList` / `SuggestedPrompts`)

    public let sessionList: ChatSessionListModel
    public let suggested: SuggestedPromptsModel

    // MARK: - Conversation + composer state

    public var input = ""
    public var showSessions = false
    public var reduceMotion = false

    public private(set) var rows: [ChatbotRow] = []
    public private(set) var messages: [ChatMessageData] = []
    public private(set) var sessionID = ""
    public private(set) var isSending = false
    public private(set) var isStreaming = false
    public private(set) var historyStatus: ChatbotHistoryStatus = .empty

    // MARK: - Collaborators

    @ObservationIgnored private let source: any ChatbotSource
    @ObservationIgnored private let sessionSource = InMemoryChatSessionListSource()
    @ObservationIgnored private let sessionActions = ChatbotSessionActions()
    @ObservationIgnored private let conversation = ChatbotConversation()
    @ObservationIgnored private var sessionItems: [ChatSessionListItem] = []
    @ObservationIgnored private var streamingID: Int?
    @ObservationIgnored private var typewriter: Task<Void, Never>?
    @ObservationIgnored private var localIDSeq = 0

    public init(source: any ChatbotSource = SampleChatbotSource()) {
        self.source = source
        sessionList = ChatSessionListModel(source: sessionSource, actions: sessionActions)
        suggested = SuggestedPromptsModel(
            source: InMemorySuggestedPromptsSource(
                initial: SuggestedPromptsUpdate(
                    status: .loaded,
                    connection: .live,
                    suggestions: SuggestedPromptsCatalog.defaults,
                    updatedAt: Date()
                )
            )
        )
        wireCallbacks()
    }

    /// Whether the transcript is empty (web `messages.length === 0`) — the hero/suggestions gate.
    public var isConversationEmpty: Bool {
        messages.isEmpty
    }

    /// Whether the "thinking" bubble shows: a send is in flight with no token revealed yet
    /// (web `isWaiting`).
    public var isWaiting: Bool {
        isSending
    }

    // MARK: - Lifecycle (page scaffold contract)

    /// Loads the sidebar feed and the active transcript (web `useChatSessions` + `useChatHistory`).
    public func load() async {
        await loadSessions()
        await loadHistory()
    }

    /// Re-runs both reads (web refetch / pull-to-refresh).
    public func refresh() async {
        await load()
    }

    // MARK: - Reads

    private func loadSessions() async {
        switch await source.useChatSessions() {
        case let .success(items):
            sessionItems = items
            emitSessions(.loaded)
        case let .failure(error):
            emitSessions(.failed(error.message))
        }
    }

    private func loadHistory() async {
        guard !sessionID.isEmpty else {
            setMessages([])
            historyStatus = .empty
            return
        }
        historyStatus = .loading
        switch await source.useChatHistory(sessionId: sessionID) {
        case let .success(items):
            setMessages(items)
            historyStatus = items.isEmpty ? .empty : .loaded
        case let .failure(error):
            historyStatus = .failed(error.message)
        }
    }

    // MARK: - Composer (web submitMessage / handleSend)

    /// Submits the trimmed input draft as a new user turn (web `handleSend`).
    public func send() {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isSending, !isStreaming else { return }
        input = ""
        submit(text)
    }

    /// Fills the composer from a tapped suggestion (web `onPick` — fill, do not auto-submit).
    public func pick(_ text: String) {
        input = text
    }

    /// Cancels the in-flight reveal and finalizes the reply with whatever has arrived
    /// (web `stopAll` / Esc).
    public func stopStreaming() {
        typewriter?.cancel()
        typewriter = nil
        if let id = streamingID, let message = messages.first(where: { $0.id == id }) {
            finishStreaming(id: id, fullText: message.content)
        } else {
            isStreaming = false
            rebuildRows()
        }
    }

    private func submit(_ text: String) {
        appendMessage(ChatMessageData(id: nextLocalID(), role: .user, content: text, createdAt: Date()))
        isSending = true
        rebuildRows()
        Task { await performSend(text) }
    }

    private func performSend(_ text: String) async {
        let outcome = await source.useSendChatMessage(message: text, sessionId: sessionID.isEmpty ? nil : sessionID)
        isSending = false
        switch outcome {
        case let .success(reply):
            if sessionID.isEmpty { sessionID = reply.sessionId }
            let id = nextLocalID()
            appendMessage(ChatMessageData(
                id: id,
                role: .assistant,
                content: reply.response,
                createdAt: Date(),
                isStreaming: true,
                streamedText: ""
            ))
            startTypewriter(id: id, fullText: reply.response)
            await loadSessions()
        case let .failure(error):
            appendMessage(ChatMessageData(
                id: nextLocalID(),
                role: .assistant,
                content: error.message,
                createdAt: Date()
            ))
            rebuildRows()
        }
    }

    // MARK: - Session intents (web SessionList callbacks)

    /// Loads a session's transcript (web `loadSession`).
    public func selectSession(_ id: String) {
        cancelReveal()
        sessionID = id
        emitSessions(.loaded)
        Task { await loadHistory() }
    }

    /// Clears the transcript for a fresh conversation (web `startNewSession`).
    public func startNewSession() {
        cancelReveal()
        sessionID = ""
        setMessages([])
        historyStatus = .empty
        emitSessions(.loaded)
    }

    /// Renames a session, then refreshes the sidebar (web `handleRename` → `useRenameChatSession`).
    public func rename(_ id: String, title: String) {
        Task {
            _ = await source.useRenameChatSession(sessionId: id, title: title)
            await loadSessions()
        }
    }

    /// Deletes a session, starting fresh if it was active (web `handleDelete` →
    /// `useDeleteChatSession`).
    public func delete(_ id: String) {
        Task {
            _ = await source.useDeleteChatSession(sessionId: id)
            if id == sessionID { startNewSession() }
            await loadSessions()
        }
    }
}

// MARK: - Internals

private extension ChatbotPageModel {
    func wireCallbacks() {
        sessionActions.onSelect = { [weak self] in self?.selectSession($0) }
        sessionActions.onNew = { [weak self] in self?.startNewSession() }
        sessionActions.onRename = { [weak self] in self?.rename($0, title: $1) }
        sessionActions.onDelete = { [weak self] in self?.delete($0) }
        conversation.onRegenerate = { [weak self] in self?.regenerate($0) }
        conversation.onEditAndResend = { [weak self] in self?.editAndResend($0, text: $1) }
    }

    private func regenerate(_ assistant: ChatMessageData) {
        guard let index = messages.firstIndex(where: { $0.id == assistant.id }), index > 0 else { return }
        let priorUser = messages[..<index].last { $0.role == .user }
        guard let user = priorUser else { return }
        cancelReveal()
        setMessages(Array(messages[..<index]))
        submit(user.content)
    }

    private func editAndResend(_ user: ChatMessageData, text: String) {
        guard let index = messages.firstIndex(where: { $0.id == user.id }) else { return }
        cancelReveal()
        setMessages(Array(messages[..<index]))
        submit(text)
    }

    private func startTypewriter(id: Int, fullText: String) {
        typewriter?.cancel()
        streamingID = id
        isStreaming = true
        rebuildRows()
        guard !reduceMotion, !fullText.isEmpty else {
            finishStreaming(id: id, fullText: fullText)
            return
        }
        let characters = Array(fullText)
        typewriter = Task { [weak self] in
            var position = 0
            while position < characters.count {
                if Task.isCancelled { return }
                position = min(characters.count, position + 4)
                let partial = String(characters[0 ..< position])
                self?.updateStreamedText(id: id, partial: partial)
                try? await Task.sleep(nanoseconds: 24_000_000)
            }
            self?.finishStreaming(id: id, fullText: fullText)
        }
    }

    private func updateStreamedText(id: Int, partial: String) {
        guard let index = messages.firstIndex(where: { $0.id == id }) else { return }
        let current = messages[index]
        messages[index] = ChatMessageData(
            id: current.id,
            role: current.role,
            content: current.content,
            createdAt: current.createdAt,
            isStreaming: true,
            streamedText: partial
        )
        rebuildRows()
    }

    private func finishStreaming(id: Int, fullText: String) {
        if let index = messages.firstIndex(where: { $0.id == id }) {
            let current = messages[index]
            messages[index] = ChatMessageData(
                id: current.id,
                role: current.role,
                content: fullText,
                createdAt: current.createdAt,
                isStreaming: false,
                streamedText: nil
            )
        }
        streamingID = nil
        isStreaming = false
        rebuildRows()
    }

    private func cancelReveal() {
        typewriter?.cancel()
        typewriter = nil
        streamingID = nil
        isStreaming = false
    }

    private func appendMessage(_ message: ChatMessageData) {
        messages.append(message)
        rebuildRows()
    }

    private func setMessages(_ next: [ChatMessageData]) {
        messages = next
        rebuildRows()
    }

    private func rebuildRows() {
        rows = conversation.sync(messages: messages, actionsDisabled: isStreaming || isSending)
    }

    private func emitSessions(_ status: ChatSessionListLoadStatus) {
        let items: [ChatSessionListItem] = if case .failed = status { [] } else { sessionItems }
        sessionSource.push(ChatSessionListUpdate(
            status: status,
            items: items,
            activeID: sessionID,
            connection: .live,
            refreshing: false,
            updatedAt: Date()
        ))
    }

    private func nextLocalID() -> Int {
        localIDSeq -= 1
        return localIDSeq
    }
}

/// The conversation read's render state (web `useChatHistory` loading / empty / data / error).
public enum ChatbotHistoryStatus: Equatable, Sendable {
    case loading
    case empty
    case loaded
    case failed(String)
}

/// Forwards the embedded `ChatSessionList` intents to the page model (web `onSelect` /
/// `onNewChat` / `onRename` / `onDelete`). Closures are wired after the model is constructed so
/// the escaping `@Observable` reference is captured weakly.
@MainActor
final class ChatbotSessionActions: ChatSessionListActions {
    var onSelect: ((String) -> Void)?
    var onNew: (() -> Void)?
    var onRename: ((String, String) -> Void)?
    var onDelete: ((String) -> Void)?

    func selectSession(id: String) {
        onSelect?(id)
    }

    func newChat() {
        onNew?()
    }

    func renameSession(id: String, title: String) {
        onRename?(id, title)
    }

    func deleteSession(id: String) {
        onDelete?(id)
    }
}
