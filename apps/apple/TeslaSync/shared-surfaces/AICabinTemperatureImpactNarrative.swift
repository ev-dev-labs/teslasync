//
//  AICabinTemperatureImpactNarrative.swift
//  TeslaSync — P4 shared surface · 0009 · AICabinTemperatureImpactNarrative (Apple)
//
//  The Helix cabin-temperature-impact narration card — the SwiftUI parity of
//  web/src/components/ai/AICabinTemperatureImpactNarrative.tsx. It is
//  `withAiFeature('cabin-temperature-impact-narrative')` in the web source (a `useAiEnabled` gate;
//  disabled ⇒ the HOC renders `null`); the InnerSection streams from POST
//  /ai/climate/temperature-impact/narrate (`{ vehicle_id: isFinite(n) ? n : 0 }`) and renders the
//  shared `AIFeatureCard` (title "Narrate the cabin-temperature impact", a description, the Ask-Helix
//  button, the "Helix" badge) feeding `AiOutputPanel`. This surface reproduces that composition
//  natively, bound through `CabinTempNarrativeModel` (P1/S8); no networking lives here.
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

// MARK: - AICabinTemperatureImpactNarrative (the shared surface)

/// The Helix cabin-temperature-impact narration card — the SwiftUI parity of
/// `AICabinTemperatureImpactNarrative.tsx`. Renders every state from the web source plus the P4 leaf
/// freshness states, binding through `CabinTempNarrativeModel`.
public struct AICabinTemperatureImpactNarrative: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AICabinTemperatureImpactNarrative"

    @State private var model: CabinTempNarrativeModel

    public init(model: CabinTempNarrativeModel) {
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

private extension AICabinTemperatureImpactNarrative {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                CabinTempNarrativeConnectivityBanner(connection: model.connection)
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
            Text(verbatim: CabinTempNarrativeStrings.string(
                "tempImpact.aiNarrative.title",
                "Narrate the cabin-temperature impact"
            ))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: CabinTempNarrativeStrings.string(
                "tempImpact.aiNarrative.title",
                "Narrate the cabin-temperature impact"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            CabinTempNarrativeHelixBadge(
                label: CabinTempNarrativeStrings.string("tempImpact.aiNarrative.badge", "Helix")
            )
            Spacer(minLength: TSSpacing.sm)
            CabinTempNarrativeFreshnessChip(connection: model.connection)
            CabinTempNarrativeRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AICabinTemperatureImpactNarrative {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            CabinTempNarrativeLoadingView()
        case let .error(message):
            CabinTempNarrativeGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                CabinTempNarrativeReadyView(ready: ready) { model.generate() }
            }
        }
    }
}
