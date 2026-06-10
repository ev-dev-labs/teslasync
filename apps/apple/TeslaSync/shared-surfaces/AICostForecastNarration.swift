//
//  AICostForecastNarration.swift
//  TeslaSync — P4 shared surface · 0013 · AICostForecastNarration (Apple)
//
//  The Helix charging-cost forecast narrator card — the SwiftUI parity of
//  web/src/components/ai/AICostForecastNarration.tsx. It is
//  `withAiFeature('cost-forecast-narration')` in the web source (a `useAiEnabled` gate; disabled ⇒
//  the HOC renders `null`); the InnerSection streams from
//  POST /ai/charging/costs/forecast/narrate (`{ vehicle_id: numericVehicleId || 0, months? }`) and
//  renders the shared `AIFeatureCard` (title "Narrate the charging-cost forecast", a description, the
//  Ask-Helix button, the "Helix" badge) feeding `AiOutputPanel`. This surface reproduces that
//  composition natively, bound through `CostNarrationModel` (P1/S8); no networking lives here.
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null). NOT a hidden section:
//                when on but no narrative has been generated, the friendly empty output renders.
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + Ask-Helix button + output panel (empty / thinking / prose /
//                error), plus the orthogonal connectivity axis (live / stale / offline) driving the
//                header freshness chip + banner with a one-shot auto-refresh on the stale
//                transition.
//

import SwiftUI

// MARK: - AICostForecastNarration (the shared surface)

/// The Helix charging-cost forecast narrator card — the SwiftUI parity of
/// `AICostForecastNarration.tsx`. Renders every state from the web source plus the P4 leaf freshness
/// states, binding through `CostNarrationModel`.
public struct AICostForecastNarration: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AICostForecastNarration"

    @State private var model: CostNarrationModel

    public init(model: CostNarrationModel) {
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

private extension AICostForecastNarration {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                CostNarrationConnectivityBanner(connection: model.connection)
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
            Text(verbatim: CostNarrationStrings.string(
                "costAnalysis.aiNarrative.title",
                "Narrate the charging-cost forecast"
            ))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: CostNarrationStrings.string(
                "costAnalysis.aiNarrative.title",
                "Narrate the charging-cost forecast"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            CostNarrationHelixBadge(label: CostNarrationStrings.string("costAnalysis.aiNarrative.badge", "Helix"))
            Spacer(minLength: TSSpacing.sm)
            CostNarrationFreshnessChip(connection: model.connection)
            CostNarrationRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AICostForecastNarration {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            CostNarrationLoadingView()
        case let .error(message):
            CostNarrationGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                CostNarrationReadyView(ready: ready) { model.generate() }
            }
        }
    }
}
