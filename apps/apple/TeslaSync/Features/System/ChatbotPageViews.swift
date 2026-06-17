//
//  ChatbotPageViews.swift
//  TeslaSync — P4-APPLE P7 · page:system/Chatbot (Apple) — Conversation views
//
//  The conversation column's render branches, kept apart from the page for the SwiftLint length
//  budget. `ChatbotConversationLog` switches over the `useChatHistory` read so every data state
//  renders — never a blank region: a `loading` spinner while the transcript loads, an `error`
//  view with Retry on failure, the empty hero (`HelixMark` + the help copy + `SuggestedPrompts`)
//  when there are no messages (web `messages.length === 0`), and the scrolling transcript of
//  `ChatMessageItem` rows otherwise, with the "thinking" bubble (GlassPanel2) appended while a
//  reply is awaited. All copy resolves from the model's web-named `LocalizedStringKey`s.
//

import SwiftUI

// MARK: - Conversation log (the GlassPanel1 body above the composer)

struct ChatbotConversationLog: View {
    let model: ChatbotPageModel
    let reduceMotion: Bool

    private let bottomAnchor = "chatbot-conversation-bottom"

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private var content: some View {
        switch model.historyStatus {
        case .loading where model.isConversationEmpty:
            loading
        case .failed where model.isConversationEmpty:
            failure
        default:
            if model.isConversationEmpty {
                ChatbotEmptyHero(model: model)
            } else {
                transcript
            }
        }
    }

    private var loading: some View {
        TSPageLoader(label: "loading")
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var failure: some View {
        TSErrorDisplay(onRetry: { Task { await model.refresh() } })
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: TSSpacing.md) {
                    ForEach(model.rows) { row in
                        ChatMessageItem(model: row.model)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if model.isWaiting {
                        ChatbotThinkingBubble(label: model.thinkingKey, reduceMotion: reduceMotion)
                    }
                    Color.clear.frame(height: 1).id(bottomAnchor)
                }
                .padding(TSSpacing.md)
            }
            .onAppear { scrollToBottom(proxy) }
            .onChange(of: model.rows.count) { _, _ in scrollToBottom(proxy) }
            .onChange(of: model.isWaiting) { _, _ in scrollToBottom(proxy) }
            .onChange(of: model.isStreaming) { _, _ in scrollToBottom(proxy) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(model.conversationLabelKey))
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        withAnimation(TSAnimation.fast(reduceMotion: reduceMotion)) {
            proxy.scrollTo(bottomAnchor, anchor: .bottom)
        }
    }
}

// MARK: - Empty hero (web: HelixMark + howCanIHelp + askAbout + SuggestedPrompts)

struct ChatbotEmptyHero: View {
    let model: ChatbotPageModel

    var body: some View {
        ScrollView {
            VStack(spacing: TSSpacing.x2xl) {
                Spacer(minLength: TSSpacing.x3xl)
                VStack(spacing: TSSpacing.lg) {
                    HelixMark(size: 48, tint: Color.TS.accent)
                        .padding(TSSpacing.lg)
                        .background(Color.TS.accent.opacity(0.12), in: Circle())
                    VStack(spacing: TSSpacing.xs) {
                        Text(model.howCanIHelpKey)
                            .font(Font.TS.section)
                            .foregroundStyle(Color.TS.textPrimary)
                            .multilineTextAlignment(.center)
                            .accessibilityAddTraits(.isHeader)
                        Text(model.askAboutKey)
                            .font(Font.TS.body)
                            .foregroundStyle(Color.TS.textSecondary)
                            .multilineTextAlignment(.center)
                    }
                }
                SuggestedPrompts(model: model.suggested, onPick: { model.pick($0) })
                Spacer(minLength: TSSpacing.x3xl)
            }
            .frame(maxWidth: .infinity)
            .padding(TSSpacing.lg)
        }
    }
}

// MARK: - Thinking bubble (GlassPanel2 — web `isWaiting` indicator)

struct ChatbotThinkingBubble: View {
    let label: LocalizedStringKey
    let reduceMotion: Bool

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            HelixMark(size: 16, tint: Color.TS.accent)
                .padding(TSSpacing.xs)
                .background(
                    Color.TS.accent.opacity(0.12),
                    in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                )
            HStack(spacing: TSSpacing.sm) {
                ChatbotTypingDots(reduceMotion: reduceMotion)
                Text(label)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            .padding(TSSpacing.sm)
            .tsGlassPanel(cornerRadius: TSRadius.md)
            .accessibilityIdentifier("GlassPanel2")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(label))
    }
}

/// Three-dot reveal indicator; collapses to a static trio under Reduce Motion (web `TypingDots`).
struct ChatbotTypingDots: View {
    let reduceMotion: Bool
    @State private var animating = false

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(0 ..< 3, id: \.self) { index in
                Circle()
                    .fill(Color.TS.accent)
                    .frame(width: 6, height: 6)
                    .opacity(animating ? 1 : 0.35)
                    .animation(dotAnimation(index: index), value: animating)
            }
        }
        .onAppear { animating = true }
        .accessibilityHidden(true)
    }

    private func dotAnimation(index: Int) -> Animation? {
        guard !reduceMotion else { return nil }
        return .easeInOut(duration: 0.6)
            .repeatForever(autoreverses: true)
            .delay(Double(index) * 0.18)
    }
}
