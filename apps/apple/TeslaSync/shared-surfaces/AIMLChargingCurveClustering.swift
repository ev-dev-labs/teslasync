//
//  AIMLChargingCurveClustering.swift
//  TeslaSync — P4 shared surface · 0027 · AIMLChargingCurveClustering (Apple)
//
//  The Helix ML charging-curve clustering card — the SwiftUI parity of
//  web/src/components/ai/AIMLChargingCurveClustering.tsx. It is
//  `withAiFeature('ml-charging-curve-clustering')` in the web source (a `useAiEnabled` gate; disabled
//  ⇒ the HOC renders `null`); the InnerSection streams from POST /ai/ml/charging-curves/cluster
//  (`{ vehicle_id: vehicleId ?? 0, lookback_days: 90 }`) and renders the shared `AIFeatureCard`
//  (title "Learn per-vehicle charging-curve clusters", a description, the Ask-Helix button, the
//  "Helix" badge) feeding `AiOutputPanel`. This surface reproduces that composition natively, bound
//  through `MLChargeCurveModel` (P1/S8); no networking lives here.
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null). NOT a hidden section:
//                when on but no clustering run has been generated, the friendly empty output renders.
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + Ask-Helix button + output panel (empty / thinking / prose /
//                error), plus the orthogonal connectivity axis (live / stale / offline) driving the
//                header freshness chip + banner with a one-shot auto-refresh on the stale
//                transition.
//

import SwiftUI

// MARK: - AIMLChargingCurveClustering (the shared surface)

/// The Helix ML charging-curve clustering card — the SwiftUI parity of
/// `AIMLChargingCurveClustering.tsx`. Renders every state from the web source plus the P4 leaf
/// freshness states, binding through `MLChargeCurveModel`.
public struct AIMLChargingCurveClustering: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AIMLChargingCurveClustering"

    @State private var model: MLChargeCurveModel

    public init(model: MLChargeCurveModel) {
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

private extension AIMLChargingCurveClustering {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                MLChargeCurveConnectivityBanner(connection: model.connection)
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
            Text(verbatim: MLChargeCurveStrings.string(
                "charging.aiMlClustering.title",
                "Learn per-vehicle charging-curve clusters"
            ))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: MLChargeCurveStrings.string(
                "charging.aiMlClustering.title",
                "Learn per-vehicle charging-curve clusters"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            MLChargeCurveHelixBadge(
                label: MLChargeCurveStrings.string("charging.aiMlClustering.badge", "Helix")
            )
            Spacer(minLength: TSSpacing.sm)
            MLChargeCurveFreshnessChip(connection: model.connection)
            MLChargeCurveRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AIMLChargingCurveClustering {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            MLChargeCurveLoadingView()
        case let .error(message):
            MLChargeCurveGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                MLChargeCurveReadyView(ready: ready) { model.generate() }
            }
        }
    }
}
