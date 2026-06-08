//
//  SessionList.Views.swift
//  TeslaSync — P4 feature view · 0222 · SessionList (Apple)
//
//  The chrome around the session list: the persistent "New Chat" button (web `p-3
//  border-b` header), the "Sessions" header with the freshness chip, and the
//  scrollable rows container (web populated branch). Token-driven (P1/S9); copy via
//  the P1/S10 facade. No networking lives here.
//

import SwiftUI

// MARK: - New Chat header (web `p-3 border-b` Button)

/// The persistent "New Chat" action pinned to the top of the sidebar (web primary
/// full-width `Button` with the plus glyph).
struct ChatSessionNewChatHeader: View {
    @Bindable var model: ChatSessionListModel

    var body: some View {
        TSButton(
            variant: .primary,
            size: .small,
            action: { model.newChat() },
            label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "plus")
                        .font(.system(size: 12, weight: .bold))
                        .accessibilityHidden(true)
                    ChatSessionListStrings.text("chatbot.newChat", "New Chat")
                }
                .frame(maxWidth: .infinity)
            }
        )
        .padding(TSSpacing.md)
        .accessibilityLabel(ChatSessionListStrings.text("chatbot.newChat", "New Chat"))
    }
}

// MARK: - Sessions header (web uppercase "Sessions" label)

/// The "Sessions" section label with the trailing live-state freshness chip, so the
/// stale / offline / live state is always visible above the list.
struct ChatSessionsHeader: View {
    let connection: ChatSessionListConnection

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            ChatSessionListStrings.text("chatbot.sessions", "Sessions")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            ChatSessionFreshnessChip(connection: connection)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.top, TSSpacing.sm)
        .padding(.bottom, TSSpacing.xs)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Rows container (web scrollable `space-y-1` list)

/// The scrollable session rows (web populated `sessions.map(...)` branch). Each row
/// binds the shared model so selection / rename / delete route through the seam.
struct ChatSessionListContent: View {
    @Bindable var model: ChatSessionListModel

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: TSSpacing.xs) {
                ForEach(model.items) { item in
                    ChatSessionRow(model: model, item: item)
                }
            }
            .padding(TSSpacing.sm)
        }
        .accessibilityLabel(ChatSessionListStrings.text("chatbot.aria.list", "Conversations"))
    }
}

// MARK: - Localization Text helper

extension ChatSessionListStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated
    /// values are never re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
