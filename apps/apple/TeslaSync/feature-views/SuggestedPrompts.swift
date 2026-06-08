//
//  SuggestedPrompts.swift
//  TeslaSync — P4 feature view · 0223 · SuggestedPrompts (Apple)
//
//  The chatbot empty-state suggestion strip — the SwiftUI parity of
//  features/system/components/chatbot/SuggestedPrompts.tsx. Renders the web source's
//  composition (a compact, centered, wrapping row of sparkle-prefixed chips reported
//  through `onPick`) plus the P4 leaf contract states, binding through
//  `SuggestedPromptsModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton chips.
//    • empty    — feed resolved with no suggestions → friendly empty state, never a
//                 blank box (the future backend-fed "no suggestions" case).
//    • error    — feed fetch failed → retry affordance (web `QueryError` peer).
//    • content  — the chip strip (the web's actual render).
//    • stale / offline — the orthogonal `connection` axis → freshness chip + banner
//                 with a one-shot auto-refresh on the stale transition; cached chips
//                 stay visible behind it.
//
//  Parity of chrome: the web component is a bare centered `<ul>` with no visible
//  heading — the title "Suggested prompts" lives only on its `aria-label`. The native
//  surface keeps that: the freshness chip / refresh only appear when the feed is not
//  live, so the healthy state is exactly the web's chrome-free chip strip.
//

import SwiftUI

// MARK: - SuggestedPrompts (the feature surface)

/// The chatbot empty-state suggestion strip — the SwiftUI parity of
/// `features/system/components/chatbot/SuggestedPrompts.tsx`. Renders every state plus
/// the P4 leaf freshness states, binding through `SuggestedPromptsModel`. Chip picks
/// are reported through `onPick`, matching the web `onPick(text)` prop (the parent
/// fills the input and focuses it but does not auto-submit).
public struct SuggestedPrompts: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "SuggestedPrompts"

    @State private var model: SuggestedPromptsModel
    private let onPick: (String) -> Void

    /// - Parameters:
    ///   - model: the bound state holder (the suggestions + load state arrive here).
    ///   - onPick: web `onPick(text)` — the parent fills the input with the chip text.
    public init(
        model: SuggestedPromptsModel,
        onPick: @escaping (String) -> Void = { _ in }
    ) {
        _model = State(initialValue: model)
        self.onPick = onPick
    }

    public var body: some View {
        VStack(spacing: TSSpacing.sm) {
            if model.connection != .live {
                connectivityBanner
            }
            content
                .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: SuggestedPromptsAccessibility.containerLabel()))
    }
}

// MARK: - Connectivity (freshness chip + banner, web has no equivalent when live)

private extension SuggestedPrompts {
    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? SuggestedPromptsStrings.string("chatbot.suggestion.offline", "Offline")
            : SuggestedPromptsStrings.string("chatbot.suggestion.stale", "Stale")
        let bannerKey = isOffline ? "chatbot.suggestion.offlineBanner" : "chatbot.suggestion.staleBanner"
        let bannerFallback = isOffline
            ? "Offline — showing saved suggestions"
            : "Reconnecting — suggestions may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            HStack(spacing: 4) {
                Circle().fill(tone).frame(width: 6, height: 6)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: label))

            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            SuggestedPromptsStrings.text(bannerKey, bannerFallback)
                .font(Font.TS.caption)

            Spacer(minLength: TSSpacing.xs)

            Button {
                model.refresh()
            } label: {
                Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(SuggestedPromptsStrings.text("chatbot.suggestion.refresh", "Refresh"))
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
    }
}

// MARK: - Content states (web render + the P4 leaf contract)

private extension SuggestedPrompts {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            SuggestedPromptsLoadingView()
        case .empty:
            SuggestedPromptsEmptyView()
        case let .error(message):
            SuggestedPromptsErrorView(message: message) { model.refresh() }
        case .content:
            chipStrip
        }
    }

    /// The web non-empty render: the centered, wrapping chip strip (web `flex
    /// flex-wrap gap-2 justify-center max-w-2xl mx-auto`), each chip reporting its
    /// resolved text through `onPick`.
    var chipStrip: some View {
        TSFadeIn {
            SuggestedPromptsFlowLayout(spacing: TSSpacing.sm) {
                ForEach(model.projection.items) { item in
                    let text = SuggestedPromptsStrings.string(item.i18nKey, item.fallback)
                    SuggestedPromptChip(text: text) { onPick(text) }
                }
            }
            .frame(maxWidth: SuggestedPromptsMetrics.maxStripWidth)
            .frame(maxWidth: .infinity)
        }
    }
}
