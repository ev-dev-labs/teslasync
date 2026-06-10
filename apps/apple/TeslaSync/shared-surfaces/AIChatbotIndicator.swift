//
//  AIChatbotIndicator.swift
//  TeslaSync — P4 shared surface · 0012 · AIChatbotIndicator (Apple)
//
//  The chatbot AI-mode indicator — the SwiftUI parity of `components/ai/AIChatbotIndicator.tsx`. The
//  web component is `withAiFeature('chatbot-llm', InnerIndicator)`: a fail-closed AI-Off gate over a
//  small cyan "Helix" chip. This native surface reproduces that composition — the gate withdraws the
//  surface entirely when the feature is off, and renders the badge when it is on — binding through
//  `AIChatbotIndicatorModel` (P1/S8); no networking lives in the view.
//
//  States (every one renders — no hidden surface):
//    • gatedOff    — web `withAiFeature` off → no AI surface renders (ADR-015 AI-Off contract).
//    • loading     — settings resolving → neutral skeleton chip (no AI branding leaks).
//    • unavailable — settings query failed → neutral `QueryError`-peer retry chip.
//    • presented   — gate enabled → the cyan Helix badge.
//    • stale / offline — the orthogonal `connection` axis → freshness dot + one-shot auto-refresh.
//

import SwiftUI

// MARK: - AIChatbotIndicator (the shared surface)

/// The chatbot AI-mode indicator — the SwiftUI parity of `components/ai/AIChatbotIndicator.tsx`.
/// Renders every state plus the P4 leaf freshness axis, binding through `AIChatbotIndicatorModel`.
public struct AIChatbotIndicator: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = AIChatbotIndicatorMeta.surfaceSlug

    @State private var model: AIChatbotIndicatorModel

    public init(model: AIChatbotIndicatorModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the production settings-backed source — the parity of mounting
    /// `<AIChatbotIndicator />` in the chatbot page header. `input` is the host's current settings
    /// snapshot (web `useSettings` → `useAiEnabled('chatbot-llm')`) plus the connectivity axis.
    public init(input: AIChatbotIndicatorInput) {
        _model = State(initialValue: AIChatbotIndicatorModel(
            source: LiveAIChatbotIndicatorSource(input: input)
        ))
    }

    public var body: some View {
        ZStack {
            if case .gatedOff = model.phase {
                // Faithful `withAiFeature` / ADR-015 AI-Off parity: the gate's purpose is that no AI
                // surface leaks when the feature is off, so the surface collapses to nothing.
                EmptyView()
            } else {
                content
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .gatedOff:
            EmptyView()
        case .loading:
            AIChatbotLoadingChip()
        case .unavailable:
            AIChatbotUnavailableChip { model.refresh() }
        case .presented:
            AIChatbotPresentedView(connection: model.connection) {
                model.refresh()
            }
        }
    }
}
