//
//  ChatMessageItem.swift
//  TeslaSync — P4 feature view · 0219 · ChatMessageItem (Apple)
//
//  The single chat row — the SwiftUI parity of
//  features/system/components/chatbot/ChatMessageItem.tsx. Renders a user or
//  assistant bubble with the web source's branches (inline editor, plain user text,
//  assistant markdown, streaming cursor, grouped avatar, last-in-group timestamp, and
//  the action row: copy on every message, regenerate on the last assistant reply,
//  edit on the last user message), plus the P4 leaf contract states. Binds through
//  `ChatMessageModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch / a streaming reply with no token yet → typing
//                 indicator bubble (web parent `isLoading` + `isStreaming`).
//    • empty    — a resolved message with no content → friendly empty-state bubble,
//                 never a blank box.
//    • error    — parent query failure → bubble with a retry affordance (web
//                 `QueryError` peer).
//    • data     — the full bubble (text / markdown / editor + timestamp + actions).
//    • stale / offline — the orthogonal `connection` axis → a banner under the row
//                 with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - ChatMessageItem (the feature surface)

/// The single chat row — the SwiftUI parity of
/// `features/system/components/chatbot/ChatMessageItem.tsx`. Renders every state from
/// the web source plus the P4 leaf freshness states, binding through
/// `ChatMessageModel`.
public struct ChatMessageItem: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ChatMessageItem"

    @State private var model: ChatMessageModel

    public init(model: ChatMessageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: rowAlignment, spacing: TSSpacing.xs) {
            phaseRow
            if model.connection != .live {
                ChatConnectivityBanner(connection: model.connection)
            }
        }
        .frame(maxWidth: .infinity, alignment: model.resolved.isUser ? .trailing : .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    private var rowAlignment: HorizontalAlignment {
        model.resolved.isUser ? .trailing : .leading
    }

    @ViewBuilder
    private var phaseRow: some View {
        switch model.resolved.phase {
        case .loading:
            ChatMessageLoadingRow(isUser: model.resolved.isUser)
        case .empty:
            ChatMessageEmptyRow(isUser: model.resolved.isUser)
        case let .error(message):
            ChatMessageErrorRow(isUser: model.resolved.isUser, message: message) {
                model.refresh()
            }
        case .data:
            ChatMessageDataRow(model: model)
        }
    }
}
