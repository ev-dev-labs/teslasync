//
//  SessionList.Previews.swift
//  TeslaSync — P4 feature view · 0222 · SessionList (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated list with
//  an active row, an untitled session, and a never-messaged session), empty (resolved
//  with no sessions), loading (initial skeleton chrome), error (fetch failed → retry),
//  the stale / offline freshness variants, and an inline-rename in progress.
//  Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentChatSessionListTelemetry: ChatSessionListTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op action sink so the rename / delete / select affordances render.
    @MainActor
    private struct PreviewChatSessionListActions: ChatSessionListActions {
        func selectSession(id _: String) {}
        func newChat() {}
        func renameSession(id _: String, title _: String) {}
        func deleteSession(id _: String) {}
    }

    /// Sample sessions spanning an explicit title, a first-message-derived title, a
    /// never-messaged (empty) session, and an older conversation.
    private enum ChatSessionListPreviewData {
        static func items() -> [ChatSessionListItem] {
            let now = Date()
            return [
                ChatSessionListItem(
                    id: "1",
                    title: "Battery degradation deep-dive",
                    messageCount: 14,
                    lastMessageAt: now.addingTimeInterval(-90)
                ),
                ChatSessionListItem(
                    id: "2",
                    title: nil,
                    firstMessage: "How much did I spend on Supercharging last month, and the costliest stop?",
                    messageCount: 6,
                    lastMessageAt: now.addingTimeInterval(-3600 * 5)
                ),
                ChatSessionListItem(id: "3", title: "   ", firstMessage: nil, messageCount: 0, lastMessageAt: nil),
                ChatSessionListItem(
                    id: "4",
                    title: "Road trip planning",
                    messageCount: 28,
                    lastMessageAt: now.addingTimeInterval(-86400 * 3)
                )
            ]
        }

        static func update(
            status: ChatSessionListLoadStatus = .loaded,
            connection: ChatSessionListConnection = .live,
            empty: Bool = false
        ) -> ChatSessionListUpdate {
            ChatSessionListUpdate(
                status: status,
                items: empty ? [] : items(),
                activeID: "1",
                connection: connection
            )
        }
    }

    @MainActor
    private func chatSessionListModel(_ update: ChatSessionListUpdate) -> ChatSessionListModel {
        ChatSessionListModel(
            source: InMemoryChatSessionListSource(initial: update),
            telemetry: SilentChatSessionListTelemetry(),
            actions: PreviewChatSessionListActions()
        )
    }

    @MainActor
    private func chatSessionListPreview(_ update: ChatSessionListUpdate) -> some View {
        ChatSessionList(model: chatSessionListModel(update))
            .frame(maxHeight: 520)
            .padding()
    }

    #Preview("Content") {
        chatSessionListPreview(ChatSessionListPreviewData.update())
    }

    #Preview("Empty") {
        chatSessionListPreview(ChatSessionListPreviewData.update(empty: true))
    }

    #Preview("Loading") {
        chatSessionListPreview(ChatSessionListPreviewData.update(status: .loading, empty: true))
    }

    #Preview("Error") {
        chatSessionListPreview(
            ChatSessionListPreviewData.update(status: .failed("The request timed out."), empty: true)
        )
    }

    #Preview("Stale") {
        chatSessionListPreview(ChatSessionListPreviewData.update(connection: .stale))
    }

    #Preview("Offline") {
        chatSessionListPreview(ChatSessionListPreviewData.update(connection: .offline))
    }

    #Preview("Renaming") {
        let update = ChatSessionListPreviewData.update()
        let model = chatSessionListModel(update)
        if let first = update.items.first {
            model.startRename(first)
        }
        return ChatSessionList(model: model)
            .frame(maxHeight: 520)
            .padding()
    }
#endif
