//
//  AIChargingDiagnosis.swift
//  TeslaSync — P4 shared surface · 0011 · AIChargingDiagnosis (Apple)
//
//  The Helix charging-diagnosis card — the SwiftUI parity of
//  web/src/components/ai/AIChargingDiagnosis.tsx. It is `withAiFeature('charging-diagnosis')` in the
//  web source (a `useAiEnabled` gate; disabled ⇒ the HOC renders `null`); the InnerSection streams
//  from POST /ai/charging/{sessionID}/diagnose (empty `{}` body) and renders the shared
//  `AIFeatureCard` (title "Charging diagnosis", a description, the Ask-Helix button, the "Helix"
//  badge) feeding `AiOutputPanel`. This surface reproduces that composition natively, bound through
//  `ChargingDiagnosisModel` (P1/S8); no networking lives here.
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null). NOT a hidden section:
//                when on but no diagnosis has been generated, the friendly empty output renders.
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + Ask-Helix button + output panel (empty / thinking / prose /
//                error), plus the orthogonal connectivity axis (live / stale / offline) driving the
//                header freshness chip + banner with a one-shot auto-refresh on the stale
//                transition.
//

import SwiftUI

// MARK: - AIChargingDiagnosis (the shared surface)

/// The Helix charging-diagnosis card — the SwiftUI parity of `AIChargingDiagnosis.tsx`. Renders every
/// state from the web source plus the P4 leaf freshness states, binding through
/// `ChargingDiagnosisModel`.
public struct AIChargingDiagnosis: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AIChargingDiagnosis"

    @State private var model: ChargingDiagnosisModel

    public init(model: ChargingDiagnosisModel) {
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

private extension AIChargingDiagnosis {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                ChargingDiagnosisConnectivityBanner(connection: model.connection)
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
            Text(verbatim: ChargingDiagnosisStrings.string(
                "charging.detail.aiDiagnosis.title",
                "Charging diagnosis"
            ))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: ChargingDiagnosisStrings.string(
                "charging.detail.aiDiagnosis.title",
                "Charging diagnosis"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            ChargingDiagnosisHelixBadge(label: ChargingDiagnosisStrings.string(
                "charging.detail.aiDiagnosis.badge",
                "Helix"
            ))
            Spacer(minLength: TSSpacing.sm)
            ChargingDiagnosisFreshnessChip(connection: model.connection)
            ChargingDiagnosisRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AIChargingDiagnosis {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            ChargingDiagnosisLoadingView()
        case let .error(message):
            ChargingDiagnosisGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                ChargingDiagnosisReadyView(ready: ready) { model.generate() }
            }
        }
    }
}
