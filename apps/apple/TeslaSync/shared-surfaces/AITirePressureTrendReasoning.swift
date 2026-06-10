//
//  AITirePressureTrendReasoning.swift
//  TeslaSync — P4 shared surface · 0054 · AITirePressureTrendReasoning (Apple)
//
//  The Helix tire-pressure-trend-reasoning card — the SwiftUI parity of
//  web/src/components/ai/AITirePressureTrendReasoning.tsx. It is
//  `withAiFeature('tire-pressure-trend-reasoning')` in the web source (a `useAiEnabled` gate;
//  disabled ⇒ the HOC renders `null`); the InnerSection streams from POST
//  /ai/tire-pressure/trends/explain (`{ vehicle_id: isFinite(n) ? n : 0 }`) and renders the shared
//  `AIFeatureCard` (title "Narrate the 30-day tire-pressure trend", a description, the Ask-Helix
//  button, the "Helix" badge) feeding `AiOutputPanel`. This surface reproduces that composition
//  natively, bound through `TirePressureTrendReasoningModel` (P1/S8); no networking lives here.
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null). NOT a hidden section:
//                when on but no narration has been generated, the friendly empty output renders.
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + Ask-Helix button + output panel (empty / thinking / prose /
//                error), plus the orthogonal connectivity axis (live / stale / offline) driving the
//                header freshness chip + banner with a one-shot auto-refresh on the stale
//                transition.
//

import SwiftUI

// MARK: - AITirePressureTrendReasoning (the shared surface)

/// The Helix tire-pressure-trend-reasoning card — the SwiftUI parity of
/// `AITirePressureTrendReasoning.tsx`. Renders every state from the web source plus the P4 leaf
/// freshness states, binding through `TirePressureTrendReasoningModel`.
public struct AITirePressureTrendReasoning: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AITirePressureTrendReasoning"

    @State private var model: TirePressureTrendReasoningModel

    public init(model: TirePressureTrendReasoningModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        Group {
            if model.isGated {
                // Web `withAiFeature` off → the whole surface is withdrawn.
                EmptyView()
            } else {
                card
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }
}

// MARK: - Card chrome

private extension AITirePressureTrendReasoning {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                TirePressureTrendReasoningConnectivityBanner(connection: model.connection)
            }
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            Text(verbatim: TirePressureTrendReasoningStrings.string(
                "tirePressure.aiTrendReasoning.title",
                "Narrate the 30-day tire-pressure trend"
            ))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: TirePressureTrendReasoningStrings.string(
                "tirePressure.aiTrendReasoning.title",
                "Narrate the 30-day tire-pressure trend"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            TirePressureTrendReasoningHelixBadge(
                label: TirePressureTrendReasoningStrings.string("tirePressure.aiTrendReasoning.badge", "Helix")
            )
            Spacer(minLength: TSSpacing.sm)
            TirePressureTrendReasoningFreshnessChip(connection: model.connection)
            TirePressureTrendReasoningRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AITirePressureTrendReasoning {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            TirePressureTrendReasoningLoadingView()
        case let .error(message):
            TirePressureTrendReasoningGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                TirePressureTrendReasoningReadyView(ready: ready) { model.generate() }
            }
        }
    }
}
