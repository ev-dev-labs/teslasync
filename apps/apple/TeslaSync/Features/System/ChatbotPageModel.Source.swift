//
//  ChatbotPageModel.Source.swift
//  TeslaSync — P4-APPLE P7 · page:system/Chatbot (Apple) — Data seam
//
//  The chatbot page's data port + its sample binding, kept apart from the model for the
//  SwiftLint length budget. The page binds through `ChatbotSource`, whose five async
//  methods carry the exact web hook names so the Swift call sites read like the web page
//  (`useChatSessions` / `useChatHistory` / `useSendChatMessage` / `useRenameChatSession` /
//  `useDeleteChatSession`, web `web/src/api/hooks/useChat.ts`). Production wires this over the
//  shared KMP `ChatStore` (`apps/shared/core/.../presentation/chat/ChatStore.kt`, ADR-004);
//  previews/tests/standalone use `SampleChatbotSource`. The reads reuse the already-shipped
//  feature-view value types (`ChatSessionListItem`, `ChatMessageData`) so no parallel DTO is
//  introduced. No SI-bearing fields cross this seam, so there is no unit conversion here.
//

import Foundation

// MARK: - Reply envelope + error (web `ChatResponse` / query error)

/// The assistant reply envelope — the native parity of the web `ChatResponse`
/// (`{ response, session_id }`). `sessionId` is the possibly-new session the exchange
/// belongs to, threaded back into the next send (web `data.session_id`).
public struct ChatbotReply: Sendable, Equatable {
    public let response: String
    public let sessionId: String

    public init(response: String, sessionId: String) {
        self.response = response
        self.sessionId = sessionId
    }
}

/// The chatbot seam's failure type — the native analogue of a TanStack Query error. Carries
/// a human-readable message the conversation/sessions error states render with a Retry.
public enum ChatbotError: Error, Equatable, Sendable {
    case failed(String)

    /// The display message surfaced in the error state.
    public var message: String {
        switch self {
        case let .failed(message): message
        }
    }
}

// MARK: - The data port (the five web hooks, by name)

/// The seam the chatbot page binds through — one method per web `useChat` hook, keeping the
/// web names at the Swift call sites. Production implements this over the shared KMP
/// `ChatStore`; previews/tests use `SampleChatbotSource`. The model never talks to the
/// network directly (ADR-004).
@MainActor
public protocol ChatbotSource: AnyObject {
    /// Web `useChatSessions()` — the sidebar feed (`GET /chatbot/sessions`).
    func useChatSessions() async -> Result<[ChatSessionListItem], ChatbotError>

    /// Web `useChatHistory(sessionId)` — one session's messages (`GET /chatbot/history`). A blank
    /// id returns an empty transcript (the web hook's `enabled: !!sessionId` gate).
    func useChatHistory(sessionId: String) async -> Result<[ChatMessageData], ChatbotError>

    /// Web `useSendChatMessage()` — posts a user turn (`POST /chatbot`) and returns the reply.
    func useSendChatMessage(message: String, sessionId: String?) async -> Result<ChatbotReply, ChatbotError>

    /// Web `useRenameChatSession()` — renames a session (`PATCH /chatbot/sessions/{id}`).
    func useRenameChatSession(sessionId: String, title: String) async -> Result<Void, ChatbotError>

    /// Web `useDeleteChatSession()` — deletes a session (`DELETE /chatbot/sessions/{id}`).
    func useDeleteChatSession(sessionId: String) async -> Result<Void, ChatbotError>
}

// MARK: - Sample binding (previews / tests / standalone)

/// In-memory `ChatbotSource` that vends a small, deterministic transcript so the page renders
/// every state without a host and performs no networking — the chatbot analogue of the
/// notification inbox's `SampleInbox`. The production app injects a `ChatStore`-backed adapter
/// in place of this at composition time. A `variant` seeds the empty branch for the
/// empty-state previews/tests.
@MainActor
public final class SampleChatbotSource: ChatbotSource {
    /// The seeded content shape.
    public enum Variant: Sendable { case populated, empty }

    private let variant: Variant
    private var sessions: [ChatSessionListItem]
    private var histories: [String: [ChatMessageData]]
    private var nextID: Int

    public init(variant: Variant = .populated) {
        self.variant = variant
        if variant == .empty {
            sessions = []
            histories = [:]
            nextID = 1
        } else {
            let now = Date()
            sessions = [
                ChatSessionListItem(
                    id: "s_today",
                    title: "Fleet check-in",
                    firstMessage: "What did my fleet do yesterday?",
                    messageCount: 2,
                    lastMessageAt: now.addingTimeInterval(-600),
                    createdAt: now.addingTimeInterval(-3600)
                ),
                ChatSessionListItem(
                    id: "s_week",
                    title: nil,
                    firstMessage: "Why is my SoC dropping faster this week?",
                    messageCount: 4,
                    lastMessageAt: now.addingTimeInterval(-86400),
                    createdAt: now.addingTimeInterval(-90000)
                )
            ]
            histories = [
                "s_today": [
                    ChatMessageData(
                        id: 1,
                        role: .user,
                        content: "What did my fleet do yesterday?",
                        createdAt: now.addingTimeInterval(-660)
                    ),
                    ChatMessageData(
                        id: 2,
                        role: .assistant,
                        content: "Your fleet logged 3 drives totaling 142 km and 1 charging session "
                            + "that added 38 kWh. Average efficiency held at 168 Wh/km.",
                        createdAt: now.addingTimeInterval(-600)
                    )
                ]
            ]
            nextID = 3
        }
    }

    public func useChatSessions() async -> Result<[ChatSessionListItem], ChatbotError> {
        .success(sessions)
    }

    public func useChatHistory(sessionId: String) async -> Result<[ChatMessageData], ChatbotError> {
        guard !sessionId.isEmpty else { return .success([]) }
        return .success(histories[sessionId] ?? [])
    }

    public func useSendChatMessage(
        message: String,
        sessionId: String?
    ) async -> Result<ChatbotReply, ChatbotError> {
        let resolved = sessionId?.isEmpty == false ? sessionId! : "s_\(Int(Date().timeIntervalSince1970))"
        nextID += 1
        return .success(ChatbotReply(response: Self.reply(to: message), sessionId: resolved))
    }

    public func useRenameChatSession(sessionId: String, title: String) async -> Result<Void, ChatbotError> {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        sessions = sessions.map { $0.id == sessionId ? withTitle($0, trimmed.isEmpty ? nil : trimmed) : $0 }
        return .success(())
    }

    public func useDeleteChatSession(sessionId: String) async -> Result<Void, ChatbotError> {
        sessions.removeAll { $0.id == sessionId }
        histories[sessionId] = nil
        return .success(())
    }

    private func withTitle(_ item: ChatSessionListItem, _ title: String?) -> ChatSessionListItem {
        ChatSessionListItem(
            id: item.id,
            title: title,
            firstMessage: item.firstMessage,
            messageCount: item.messageCount,
            lastMessageAt: item.lastMessageAt,
            createdAt: item.createdAt
        )
    }

    /// A short deterministic heuristic reply — the native stand-in for the baseline
    /// `POST /chatbot` route (web `ai_mode='off'`), so the typewriter reveal has content.
    private static func reply(to message: String) -> String {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        let topic = trimmed.isEmpty ? "your fleet" : trimmed
        return "Here is what I found about \"\(topic)\": your 2 vehicles are healthy, "
            + "the last drive ended at 71% battery, and no alerts are active."
    }
}
