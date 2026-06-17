//
//  ChatbotPageModel.Rows.swift
//  TeslaSync — P4-APPLE P7 · page:system/Chatbot (Apple) — Conversation rows
//
//  The conversation's per-row plumbing for the embedded `ChatMessageItem` feature view
//  (`TeslaSync/feature-views/ChatMessageItem.swift`), kept apart from the page model for the
//  SwiftLint length budget. The web page renders `messages.map(<ChatMessageItem .../>)`; the
//  native page mirrors that by holding one stable `ChatMessageModel` per message id (so each
//  row's SwiftUI `@State` survives across re-renders) and pushing a fresh `ChatMessageInput`
//  only when a row's resolved shape changes — e.g. the streaming reply growing token by token.
//  Row regenerate / edit-and-resend intents are forwarded back to the page model.
//

import Foundation

/// One conversation row: a message id paired with its stable bound model (web `<ChatMessageItem
/// key={msg.id}/>`). `Identifiable` keys the SwiftUI `ForEach` off the message id exactly like
/// the web `key`.
@MainActor
public struct ChatbotRow: Identifiable {
    public let id: Int
    public let model: ChatMessageModel

    public init(id: Int, model: ChatMessageModel) {
        self.id = id
        self.model = model
    }
}

/// A `ChatMessageSource` that re-emits a fixed `ChatMessageInput` (the row never fetches on its
/// own — the page owns the transcript) and forwards the row's regenerate / edit-and-resend
/// intents to the page model. The native parity of the web `onRegenerate` / `onEditAndResend`
/// props threaded into each `ChatMessageItem`.
@MainActor
final class ChatbotRowSource: ChatMessageSource {
    var onUpdate: (@MainActor (ChatMessageInput) -> Void)?
    private(set) var current: ChatMessageInput
    private let regenerateHandler: (ChatMessageData) -> Void
    private let editHandler: (ChatMessageData, String) -> Void

    init(
        initial: ChatMessageInput,
        onRegenerate: @escaping (ChatMessageData) -> Void,
        onEditAndResend: @escaping (ChatMessageData, String) -> Void
    ) {
        current = initial
        regenerateHandler = onRegenerate
        editHandler = onEditAndResend
    }

    func start() {
        onUpdate?(current)
    }

    func stop() {}
    func refresh() {
        onUpdate?(current)
    }

    func regenerate(_ message: ChatMessageData) {
        regenerateHandler(message)
    }

    func editAndResend(_ message: ChatMessageData, text: String) {
        editHandler(message, text)
    }

    /// Replaces the emitted snapshot (the streaming reveal + grouping recompute).
    func push(_ input: ChatMessageInput) {
        current = input
        onUpdate?(input)
    }
}

/// Owns the stable per-message `ChatMessageModel` cache and projects the page's transcript into
/// ordered rows, creating models for new ids, updating changed rows, and dropping removed ones.
@MainActor
final class ChatbotConversation {
    private var rows: [Int: ChatbotRow] = [:]
    private var sources: [Int: ChatbotRowSource] = [:]

    /// Web `onRegenerate(assistantMsg)` — resubmit the preceding user turn for a fresh reply.
    var onRegenerate: ((ChatMessageData) -> Void)?
    /// Web `onEditAndResend(userMsg, newText)` — truncate at the turn and resubmit the edit.
    var onEditAndResend: ((ChatMessageData, String) -> Void)?

    /// Syncs the cache to `messages` and returns the ordered rows. `streamingID` marks the row
    /// whose actions stay enabled-but-quiet; `actionsDisabled` gates copy/regenerate/edit while
    /// a reveal is in flight (web `actionsDisabled={isStreaming || sendMut.isPending}`).
    func sync(messages: [ChatMessageData], actionsDisabled: Bool) -> [ChatbotRow] {
        let liveIDs = Set(messages.map(\.id))
        rows = rows.filter { liveIDs.contains($0.key) }
        sources = sources.filter { liveIDs.contains($0.key) }

        let lastAssistantID = messages.last { $0.role == .assistant }?.id
        let lastUserID = messages.last { $0.role == .user }?.id

        var ordered: [ChatbotRow] = []
        for (index, message) in messages.enumerated() {
            let input = makeInput(
                messages: messages,
                index: index,
                lastAssistantID: lastAssistantID,
                lastUserID: lastUserID,
                actionsDisabled: actionsDisabled
            )
            if let row = rows[message.id], let source = sources[message.id] {
                if source.current != input { source.push(input) }
                ordered.append(row)
            } else {
                let source = ChatbotRowSource(
                    initial: input,
                    onRegenerate: { [weak self] in self?.onRegenerate?($0) },
                    onEditAndResend: { [weak self] in self?.onEditAndResend?($0, $1) }
                )
                let row = ChatbotRow(id: message.id, model: ChatMessageModel(source: source))
                rows[message.id] = row
                sources[message.id] = source
                ordered.append(row)
            }
        }
        return ordered
    }

    private func makeInput(
        messages: [ChatMessageData],
        index: Int,
        lastAssistantID: Int?,
        lastUserID: Int?,
        actionsDisabled: Bool
    ) -> ChatMessageInput {
        let message = messages[index]
        let previous = index > 0 ? messages[index - 1] : nil
        let next = index < messages.count - 1 ? messages[index + 1] : nil
        return ChatMessageInput(
            message: message,
            isFirstInGroup: previous?.role != message.role,
            isLastInGroup: next?.role != message.role,
            isLastAssistant: message.id == lastAssistantID,
            isLastUser: message.id == lastUserID,
            actionsDisabled: actionsDisabled,
            regenerateEnabled: true,
            editEnabled: true,
            isLoading: false,
            errorMessage: nil,
            connection: .live
        )
    }
}
