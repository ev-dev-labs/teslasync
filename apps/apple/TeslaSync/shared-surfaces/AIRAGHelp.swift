//
//  AIRAGHelp.swift
//  TeslaSync — P4 shared surface · 0042 · AIRAGHelp (Apple)
//
//  The RAG-backed "Ask the help assistant" Helix panel — the SwiftUI parity of
//  components/ai/AIRAGHelp.tsx. Reproduces the web source's composition (the `withAiFeature`
//  gate, the `AIFeatureCard` scaffold — title + cyan Helix badge + description + the prompt
//  `inputSlot` + the universal "Ask Helix" action — and the streamed `AiOutputPanel`) plus the
//  P4 leaf contract states. Binds through `RAGHelpModel` (P1/S8); no networking lives here.
//  Read-only help: the answer streams in but the panel never writes — the assistant answers
//  using the project's own documentation, runbooks, and i18n strings, with explicit citations
//  to each source (ADR-015 §I3).
//
//  States (every one renders — no hidden surface, except the AI-Off gate which is the
//  sanctioned ADR-015 "render nothing" contract, faithful to web `withAiFeature` → null):
//    • gateLoading — the AI-Off gate is resolving → skeleton chrome.
//    • ready/idle  — gate on, nothing streamed yet → the resting invite card (header +
//                    description + prompt field + "Ask Helix"); never a blank surface.
//    • streaming   — SSE open → "Helix is thinking…" + the output thinking indicator.
//    • answer      — delta frames accumulated → the streamed narrative in the output panel.
//    • stream error— the SSE ended in `error` → the Helix error row in the output panel.
//    • gateError   — the gate / context fetch failed → `QueryError` peer with retry.
//    • stale/offline — the orthogonal `connection` axis → freshness chip + banner with a
//                    one-shot auto-refresh on the stale transition; offline disables the action
//                    (no stream is possible) while keeping the cached context.
//    • gatedOff    — the feature is disabled → renders nothing (web `withAiFeature` null).
//

import SwiftUI

// MARK: - AIRAGHelp (the feature surface)

/// The RAG-backed "Ask the help assistant" Helix panel — the SwiftUI parity of
/// `components/ai/AIRAGHelp.tsx`. Renders every state from the web source plus the P4 leaf
/// states, binding through `RAGHelpModel`.
public struct AIRAGHelp: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = RAGHelpSurface.slug

    /// The AI feature id this surface gates on (web `withAiFeature` argument).
    public static let featureID = RAGHelpSurface.featureID

    @State private var model: RAGHelpModel

    public init(model: RAGHelpModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ZStack {
            switch model.renderState {
            case .gatedOff:
                // AI-Off contract (ADR-015): the surface renders nothing, faithful to the web
                // `withAiFeature` returning `null`. The model keeps observing so the card
                // appears the moment the gate flips on.
                EmptyView()
            case .gateLoading:
                glass { RAGHelpGateLoadingView() }
            case let .gateError(message):
                glass {
                    RAGHelpGateErrorView(message: message) { model.refresh() }
                }
            case .ready:
                readyCard
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    // MARK: Ready card (web `AIFeatureCard` + `inputSlot` + `AiOutputPanel`)

    private var readyCard: some View {
        glass {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                statusRow
                if model.connection != .live {
                    connectivityBanner
                }
                RAGHelpHeader(hint: model.emptyHint)
                RAGHelpPromptField(text: promptBinding)
                RAGHelpActionButton(
                    isStreaming: model.phase == .streaming,
                    disabled: model.buttonDisabled
                ) {
                    model.ask()
                }
                RAGHelpOutputPanel(phase: model.phase, text: model.streamText)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
    }

    /// Two-way binding to the model's `prompt` (web `useState`) for the input field. Manual
    /// (rather than `@Bindable`) so the surface keeps owning the model via `@State`.
    private var promptBinding: Binding<String> {
        Binding(get: { model.prompt }, set: { model.prompt = $0 })
    }

    /// The VoiceOver overview — the title plus the live phase (thinking / answer-ready /
    /// error), built through the testable `RAGHelpAccessibility` seam so it is asserted
    /// without rendering.
    private var accessibilitySummary: String {
        RAGHelpAccessibility.summary(
            labels: .init(
                title: RAGHelpStrings.string(
                    "help.aiHelp.title", "Ask the help assistant"
                ),
                thinking: RAGHelpStrings.string("helix.thinking", "Helix is thinking…"),
                answerReady: RAGHelpStrings.string("help.aiHelp.answerReady", "Answer ready"),
                error: RAGHelpStrings.string("helix.errorLabel", "Helix error:")
            ),
            phase: model.phase,
            hasAnswer: !model.streamText.isEmpty
        )
    }

    // MARK: Panel shell

    private func glass(@ViewBuilder _ content: @escaping () -> some View) -> some View {
        TSGlassPanel {
            content()
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Freshness chip + banner (P4 leaf connectivity axis)

private extension AIRAGHelp {
    var statusRow: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            freshnessChip
            refreshButton
        }
    }

    var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = RAGHelpStrings.string("help.aiHelp.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = RAGHelpStrings.string("help.aiHelp.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = RAGHelpStrings.string("help.aiHelp.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(Text(verbatim: RAGHelpStrings.string(
            "help.aiHelp.refresh", "Refresh"
        )))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? RAGHelpStrings.string(
                "help.aiHelp.offlineBanner", "Offline — showing last known data"
            )
            : RAGHelpStrings.string(
                "help.aiHelp.staleBanner", "Reconnecting — data may be stale"
            )
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}
