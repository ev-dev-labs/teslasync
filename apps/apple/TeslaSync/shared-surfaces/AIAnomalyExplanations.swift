//
//  AIAnomalyExplanations.swift
//  TeslaSync — P4 shared surface · 0005 · AIAnomalyExplanations (Apple)
//
//  The Helix anomaly-explanation card — the SwiftUI parity of
//  web/src/components/ai/AIAnomalyExplanations.tsx. It is `withAiFeature('anomaly-explanations')`
//  in the web source (a `useAiEnabled` gate; disabled ⇒ the HOC renders `null`); the InnerSection
//  streams from POST /ai/anomalies/explain (`{ vehicle_id: vehicleId ?? 0, days: 30 }`) and renders
//  the shared `AIFeatureCard` (title "Helix explanation", a description, the Ask-Helix button, the
//  "Helix" badge) feeding `AiOutputPanel`. This surface reproduces that composition natively, bound
//  through `AnomalyExplanationsModel` (P1/S8); no networking lives here.
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null). NOT a hidden section:
//                when on but no explanation has been generated, the friendly empty output renders.
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + Ask-Helix button + output panel (empty / thinking / prose /
//                error), plus the orthogonal connectivity axis (live / stale / offline) driving the
//                header freshness chip + banner with a one-shot auto-refresh on the stale
//                transition.
//

import SwiftUI

// MARK: - AIAnomalyExplanations (the shared surface)

/// The Helix anomaly-explanation card — the SwiftUI parity of `AIAnomalyExplanations.tsx`. Renders
/// every state from the web source plus the P4 leaf freshness states, binding through
/// `AnomalyExplanationsModel`.
public struct AIAnomalyExplanations: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AIAnomalyExplanations"

    @State private var model: AnomalyExplanationsModel

    public init(model: AnomalyExplanationsModel) {
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

private extension AIAnomalyExplanations {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                AnomalyConnectivityBanner(connection: model.connection)
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
            Text(verbatim: AnomalyExplanationsStrings.string("anomaly.aiExplanation.title", "Helix explanation"))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: AnomalyExplanationsStrings.string("anomaly.aiExplanation.title", "Helix explanation"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            AnomalyHelixBadge(label: AnomalyExplanationsStrings.string("anomaly.aiExplanation.badge", "Helix"))
            Spacer(minLength: TSSpacing.sm)
            AnomalyFreshnessChip(connection: model.connection)
            AnomalyRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AIAnomalyExplanations {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            AnomalyLoadingView()
        case let .error(message):
            AnomalyGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                AnomalyReadyView(ready: ready) { model.generate() }
            }
        }
    }
}
