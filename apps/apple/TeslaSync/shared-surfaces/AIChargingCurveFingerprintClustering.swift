//
//  AIChargingCurveFingerprintClustering.swift
//  TeslaSync — P4 shared surface · 0010 · AIChargingCurveFingerprintClustering (Apple)
//
//  The Helix charging-curve fingerprint clustering card — the SwiftUI parity of
//  web/src/components/ai/AIChargingCurveFingerprintClustering.tsx. It is
//  `withAiFeature('charging-curve-fingerprint-clustering')` in the web source (a `useAiEnabled` gate;
//  disabled ⇒ the HOC renders `null`); the InnerSection streams from POST
//  /ai/charging/curves/clusters/explain (body `{ vehicle_id }`) and renders the shared `AIFeatureCard`
//  (title "Explain the charging-curve cluster fingerprints", a description, the Ask-Helix button, the
//  "Helix" badge) feeding `AiOutputPanel`. This surface reproduces that composition natively, bound
//  through `ChargeCurveFingerprintModel` (P1/S8); no networking lives here.
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null). NOT a hidden section:
//                when on but no explanation has been generated, the friendly empty output renders.
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + Ask-Helix button + output panel (empty / thinking / prose /
//                error), plus the orthogonal connectivity axis (live / stale / offline) driving the
//                header freshness chip + banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - AIChargingCurveFingerprintClustering (the shared surface)

/// The Helix charging-curve fingerprint clustering card — the SwiftUI parity of
/// `AIChargingCurveFingerprintClustering.tsx`. Renders every state from the web source plus the P4
/// leaf freshness states, binding through `ChargeCurveFingerprintModel`.
public struct AIChargingCurveFingerprintClustering: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AIChargingCurveFingerprintClustering"

    @State private var model: ChargeCurveFingerprintModel

    public init(model: ChargeCurveFingerprintModel) {
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

private extension AIChargingCurveFingerprintClustering {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                ChargeCurveFingerprintConnectivityBanner(connection: model.connection)
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
            Text(verbatim: ChargeCurveFingerprintStrings.string(
                "charging.aiClustering.title",
                "Explain the charging-curve cluster fingerprints"
            ))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: ChargeCurveFingerprintStrings.string(
                "charging.aiClustering.title",
                "Explain the charging-curve cluster fingerprints"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            ChargeCurveFingerprintHelixBadge(label: ChargeCurveFingerprintStrings.string(
                "charging.aiClustering.badge",
                "Helix"
            ))
            Spacer(minLength: TSSpacing.sm)
            ChargeCurveFingerprintFreshnessChip(connection: model.connection)
            ChargeCurveFingerprintRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AIChargingCurveFingerprintClustering {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            ChargeCurveFingerprintLoadingView()
        case let .error(message):
            ChargeCurveFingerprintGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                ChargeCurveFingerprintReadyView(ready: ready) { model.generate() }
            }
        }
    }
}
