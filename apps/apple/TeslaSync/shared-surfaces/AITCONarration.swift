//
//  AITCONarration.swift
//  TeslaSync — P4 shared surface · 0052 · AITCONarration (Apple)
//
//  The Helix total-cost-of-ownership narrator card — the SwiftUI parity of
//  web/src/components/ai/AITCONarration.tsx. It is `withAiFeature('tco-narration')` in the web source
//  (a `useAiEnabled` gate; disabled ⇒ the HOC renders `null`); the InnerSection streams from
//  POST /ai/analytics/tco/narrate (`{ vehicle_id: numericVehicleId || 0 }`) and renders the shared
//  `AIFeatureCard` (title "Explain my total cost of ownership", a long-form description, the optional
//  "Pick a vehicle above to enable Helix." empty hint, the Ask-Helix button, the "Helix" badge)
//  feeding `AiOutputPanel`. This surface reproduces that composition natively, bound through
//  `TCONarrationModel` (P1/S8); no networking lives here.
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null). NOT a hidden section:
//                when on but no narrative has been generated, the friendly empty output renders.
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + empty hint + Ask-Helix button + output panel (empty / thinking /
//                prose / error), plus the orthogonal connectivity axis (live / stale / offline)
//                driving the header freshness chip + banner with a one-shot auto-refresh on the
//                stale transition.
//

import SwiftUI

// MARK: - AITCONarration (the shared surface)

/// The Helix total-cost-of-ownership narrator card — the SwiftUI parity of `AITCONarration.tsx`.
/// Renders every state from the web source plus the P4 leaf freshness states, binding through
/// `TCONarrationModel`.
public struct AITCONarration: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AITCONarration"

    @State private var model: TCONarrationModel

    public init(model: TCONarrationModel) {
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

private extension AITCONarration {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                TCONarrationConnectivityBanner(connection: model.connection)
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
            Text(verbatim: TCONarrationStrings.string(
                "tco.aiNarration.title",
                "Explain my total cost of ownership"
            ))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: TCONarrationStrings.string(
                "tco.aiNarration.title",
                "Explain my total cost of ownership"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            TCONarrationHelixBadge(label: TCONarrationStrings.string("tco.aiNarration.badge", "Helix"))
            Spacer(minLength: TSSpacing.sm)
            TCONarrationFreshnessChip(connection: model.connection)
            TCONarrationRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AITCONarration {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            TCONarrationLoadingView()
        case let .error(message):
            TCONarrationGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                TCONarrationReadyView(ready: ready) { model.generate() }
            }
        }
    }
}
