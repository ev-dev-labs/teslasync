//
//  SessionList.swift
//  TeslaSync — P4 feature view · 0222 · SessionList (Apple)
//
//  The chatbot session sidebar — the SwiftUI parity of
//  features/system/components/chatbot/SessionList.tsx. A glass panel column with a
//  persistent "New Chat" button, a "Sessions" header (with the live-state freshness
//  chip), and the session list that switches over the bound model's phase so every
//  prompt-required state renders (loading / empty / error / content, plus the stale +
//  offline freshness branches) — never a blank box. A delete raises a native
//  confirmation dialog (web `ConfirmDialog`). Binds through `ChatSessionListModel`
//  (P1/S8); no networking lives here.
//

import SwiftUI

/// The chatbot session sidebar — the SwiftUI parity of the web `SessionList`, binding
/// through `ChatSessionListModel` (P1/S8).
public struct ChatSessionList: View {
    @State private var model: ChatSessionListModel

    public init(model: ChatSessionListModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: 0) {
                ChatSessionNewChatHeader(model: model)
                Divider().overlay(Color.TS.border)
                ChatSessionsHeader(connection: model.connection)
                if model.connection != .live {
                    ChatSessionConnectivityBanner(connection: model.connection)
                        .padding(.horizontal, TSSpacing.md)
                        .padding(.bottom, TSSpacing.xs)
                }
                content
            }
            .frame(width: 288, alignment: .leading)
            .frame(maxHeight: .infinity, alignment: .top)
            .tsGlassPanel()
            .clipShape(RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .confirmationDialog(
            Text(verbatim: model.deleteConfirmTitle),
            isPresented: deleteBinding,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) { model.confirmDelete() } label: {
                ChatSessionListStrings.text("chatbot.delete.confirm", "Delete")
            }
            Button(role: .cancel) { model.cancelDelete() } label: {
                ChatSessionListStrings.text("common.cancel", "Cancel")
            }
        } message: {
            Text(verbatim: model.deleteConfirmMessage)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web top-level branch (`isLoading && !sessions.length` → loading text;
    /// `!sessions.length` → EmptyState; otherwise the rows), widened with the
    /// page-owned error envelope so no state is hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ChatSessionLoadingState()
        case let .error(message):
            ChatSessionErrorState(message: message) { model.refresh() }
        case .empty:
            ChatSessionEmptyState()
        case .content:
            ChatSessionListContent(model: model)
        }
    }

    /// Presents the delete confirmation while a session is pending (web
    /// `open={!!pendingDelete}`); dismissing clears it (web `onCancel`).
    private var deleteBinding: Binding<Bool> {
        Binding(
            get: { model.pendingDelete != nil },
            set: { presenting in if !presenting { model.cancelDelete() } }
        )
    }
}

// MARK: - Surface identity

public extension ChatSessionList {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        ChatSessionListSurface.slug
    }
}
