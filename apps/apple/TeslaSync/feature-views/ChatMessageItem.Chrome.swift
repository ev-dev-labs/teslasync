//
//  ChatMessageItem.Chrome.swift
//  TeslaSync — P4 feature view · 0219 · ChatMessageItem (Apple)
//
//  The P4 leaf chrome for the chat message row, split out of `ChatMessageItem.Views`
//  to keep each file focused: the loading typing-indicator bubble, the empty-state
//  bubble, the error bubble with a retry affordance, and the stale /
//  offline freshness banner. All consume the P1/S10 facade + the shared P1/S9 tokens
//  and reuse the `ChatRowContainer` / `ChatBubble` scaffold so chrome rows align with
//  the data row.
//

import SwiftUI

// MARK: - Loading (web parent `isLoading` + pre-token `isStreaming`)

/// The initial-fetch / pre-token chrome: a typing indicator inside the bubble so the
/// row keeps its shape while the reply resolves.
struct ChatMessageLoadingRow: View {
    let isUser: Bool

    var body: some View {
        ChatRowContainer(isUser: isUser, avatarRole: isUser ? .user : .assistant, avatarVisible: true) {
            ChatBubble(isUser: isUser) {
                ChatTypingIndicator()
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: ChatStrings.string("chat.loadingA11y", "Generating response")))
    }
}

/// Three pulsing dots (the chat "typing" indicator). Static under Reduce Motion.
struct ChatTypingIndicator: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0 ..< 3, id: \.self) { index in
                Circle()
                    .fill(Color.TS.textMuted)
                    .frame(width: 6, height: 6)
                    .opacity(pulsing ? 1 : 0.3)
                    .animation(dotAnimation(index: index), value: pulsing)
            }
        }
        .frame(height: 14)
        .onAppear { pulsing = true }
        .accessibilityHidden(true)
    }

    private func dotAnimation(index: Int) -> Animation? {
        guard !reduceMotion else { return nil }
        return .easeInOut(duration: 0.6).repeatForever().delay(Double(index) * 0.15)
    }
}

// MARK: - Empty (web empty bubble)

/// The empty render: a friendly empty-state, never a blank box.
struct ChatMessageEmptyRow: View {
    let isUser: Bool

    var body: some View {
        ChatRowContainer(isUser: isUser, avatarRole: isUser ? .user : .assistant, avatarVisible: true) {
            ChatBubble(isUser: isUser) {
                Text(verbatim: ChatStrings.string("chat.empty", "No message content."))
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The fetch-failure state with a retry affordance.
struct ChatMessageErrorRow: View {
    let isUser: Bool
    let message: String
    let onRetry: () -> Void

    private var title: String {
        ChatStrings.string("chat.errorTitle", "Couldn't load this message")
    }

    private var retry: String {
        ChatStrings.string("chat.retry", "Retry")
    }

    var body: some View {
        ChatRowContainer(isUser: isUser, avatarRole: isUser ? .user : .assistant, avatarVisible: true) {
            ChatBubble(isUser: isUser) {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    HStack(spacing: TSSpacing.xs) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(Color.TS.statusDanger)
                        Text(verbatim: title)
                            .font(Font.TS.bodySm)
                            .foregroundStyle(Color.TS.textPrimary)
                    }
                    if !message.isEmpty {
                        Text(verbatim: message)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textSecondary)
                    }
                    TSButton(
                        variant: .secondary,
                        size: .small,
                        action: onRetry,
                        label: { Text(verbatim: retry) }
                    )
                    .accessibilityLabel(Text(verbatim: retry))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

// MARK: - Freshness banner (P4 connection axis)

/// The stale / offline banner shown under the row when the bound data is not live.
struct ChatConnectivityBanner: View {
    let connection: ChatConnection

    private var isOffline: Bool {
        connection == .offline
    }

    private var label: String {
        isOffline
            ? ChatStrings.string("chat.offlineBanner", "Offline — showing the last known message")
            : ChatStrings.string("chat.staleBanner", "Reconnecting — this reply may be stale")
    }

    private var tone: Color {
        isOffline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: label)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
