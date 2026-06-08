//
//  ChatMessageItem.Previews.swift
//  TeslaSync — P4 feature view · 0219 · ChatMessageItem (Apple)
//
//  Xcode previews for each surface state (user / assistant data, streaming, editing,
//  empty, loading, error, stale, offline). DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum ChatPreviewData {
        static let now = Date(timeIntervalSince1970: 1_700_000_000)

        static func user(_ text: String) -> ChatMessageData {
            ChatMessageData(id: 1, role: .user, content: text, createdAt: now)
        }

        static func assistant(
            _ text: String,
            streaming: Bool = false,
            streamed: String? = nil
        ) -> ChatMessageData {
            ChatMessageData(
                id: 2,
                role: .assistant,
                content: text,
                createdAt: now,
                isStreaming: streaming,
                streamedText: streamed
            )
        }

        static let reply = """
        Here's the **battery summary**:

        - Range added: 142 mi
        - Avg power: 48 kW

        Let me know if you'd like the per-cell breakdown.
        """
    }

    @MainActor
    private func previewModel(_ input: ChatMessageInput, edit: Bool = false) -> ChatMessageModel {
        let source = InMemoryChatMessageSource(initial: input)
        let model = ChatMessageModel(source: source)
        model.start()
        if edit { model.beginEdit() }
        return model
    }

    #Preview("User message") {
        ChatMessageItem(model: previewModel(ChatMessageInput(
            message: ChatPreviewData.user("What was my efficiency on the last drive?"),
            isLastUser: true
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Assistant message") {
        ChatMessageItem(model: previewModel(ChatMessageInput(
            message: ChatPreviewData.assistant(ChatPreviewData.reply),
            isLastAssistant: true
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Streaming") {
        ChatMessageItem(model: previewModel(ChatMessageInput(
            message: ChatPreviewData.assistant(
                ChatPreviewData.reply,
                streaming: true,
                streamed: "Here's the battery summary"
            ),
            isLastAssistant: true
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Editing") {
        ChatMessageItem(model: previewModel(
            ChatMessageInput(message: ChatPreviewData.user("Show me charging costs"), isLastUser: true),
            edit: true
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        ChatMessageItem(model: previewModel(ChatMessageInput(
            message: ChatPreviewData.assistant("")
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ChatMessageItem(model: previewModel(ChatMessageInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        ChatMessageItem(model: previewModel(ChatMessageInput(
            message: ChatPreviewData.assistant("partial"),
            errorMessage: "The assistant request timed out"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        ChatMessageItem(model: previewModel(ChatMessageInput(
            message: ChatPreviewData.assistant(ChatPreviewData.reply),
            isLastAssistant: true,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        ChatMessageItem(model: previewModel(ChatMessageInput(
            message: ChatPreviewData.assistant(ChatPreviewData.reply),
            isLastAssistant: true,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
