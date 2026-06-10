//
//  AILearnedAnomalyBaselines.swift
//  TeslaSync — P4 shared surface · 0023 · AILearnedAnomalyBaselines (Apple)
//
//  The Helix learned-anomaly-baseline card — the SwiftUI parity of
//  web/src/components/ai/AILearnedAnomalyBaselines.tsx. It is
//  `withAiFeature('learned-per-vehicle-anomaly-baselines')` in the web source (a `useAiEnabled`
//  gate; disabled ⇒ the HOC renders `null`); the InnerSection streams from POST
//  /ai/ml/anomaly-baselines/train (`{ vehicle_id: vehicleId ?? 0, days: 14 }`) and renders the
//  shared `AIFeatureCard` (title "Learn per-vehicle baseline", a description, the Ask-Helix button,
//  the "Helix" badge) feeding `AiOutputPanel`. The AI is read-only narration over the learned
//  envelope returned by the trainer (ADR-015 §I3 + §I8 propose-only contract); this surface
//  reproduces that composition natively, bound through `LearnedBaselineModel` (P1/S8); no networking
//  lives here.
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null). NOT a hidden section:
//                when on but no baseline has been trained, the friendly empty output renders.
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + Ask-Helix button + output panel (empty / thinking / prose /
//                error), plus the orthogonal connectivity axis (live / stale / offline) driving the
//                header freshness chip + banner with a one-shot auto-refresh on the stale
//                transition.
//

import SwiftUI

// MARK: - AILearnedAnomalyBaselines (the shared surface)

/// The Helix learned-anomaly-baseline card — the SwiftUI parity of `AILearnedAnomalyBaselines.tsx`.
/// Renders every state from the web source plus the P4 leaf freshness states, binding through
/// `LearnedBaselineModel`.
public struct AILearnedAnomalyBaselines: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AILearnedAnomalyBaselines"

    @State private var model: LearnedBaselineModel

    public init(model: LearnedBaselineModel) {
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

private extension AILearnedAnomalyBaselines {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                BaselineConnectivityBanner(connection: model.connection)
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
            Text(verbatim: LearnedBaselineStrings.string("anomaly.aiBaseline.title", "Learn per-vehicle baseline"))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: LearnedBaselineStrings.string("anomaly.aiBaseline.title", "Learn per-vehicle baseline"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            BaselineHelixBadge(label: LearnedBaselineStrings.string("anomaly.aiBaseline.badge", "Helix"))
            Spacer(minLength: TSSpacing.sm)
            BaselineFreshnessChip(connection: model.connection)
            BaselineRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AILearnedAnomalyBaselines {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            BaselineLoadingView()
        case let .error(message):
            BaselineGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                BaselineReadyView(ready: ready) { model.generate() }
            }
        }
    }
}
