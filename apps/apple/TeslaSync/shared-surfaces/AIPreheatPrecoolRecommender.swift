//
//  AIPreheatPrecoolRecommender.swift
//  TeslaSync — P4 shared surface · 0040 · AIPreheatPrecoolRecommender (Apple)
//
//  The Helix preheat / precool recommender card — the SwiftUI parity of
//  web/src/components/ai/AIPreheatPrecoolRecommender.tsx. It is
//  `withAiFeature('preheat-precool-recommender')` in the web source (a `useAiEnabled` gate; disabled
//  ⇒ the HOC renders `null`); the InnerSection streams from POST /ai/climate/schedule/draft (a
//  vehicle / depart-by / cabin-temperature body) and renders the shared `AIFeatureCard`
//  (title "Suggest a preheat or precool schedule", a description, the Ask-Helix button, the "Helix"
//  badge) feeding `AiOutputPanel`. The drafted schedule is PROPOSE-only — Helix never persists; the
//  user clicks the canonical climate-controls Apply button to save it. This surface reproduces that
//  composition natively, bound through `PreheatPrecoolModel` (P1/S8); no networking lives here.
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null). NOT a hidden section:
//                when on but no schedule has been drafted, the friendly empty output renders.
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + Ask-Helix button + output panel (empty / thinking / prose /
//                error), plus the orthogonal connectivity axis (live / stale / offline) driving the
//                header freshness chip + banner with a one-shot auto-refresh on the stale
//                transition.
//

import SwiftUI

// MARK: - AIPreheatPrecoolRecommender (the shared surface)

/// The Helix preheat / precool recommender card — the SwiftUI parity of
/// `AIPreheatPrecoolRecommender.tsx`. Renders every state from the web source plus the P4 leaf
/// freshness states, binding through `PreheatPrecoolModel`.
public struct AIPreheatPrecoolRecommender: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AIPreheatPrecoolRecommender"

    @State private var model: PreheatPrecoolModel

    public init(model: PreheatPrecoolModel) {
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

private extension AIPreheatPrecoolRecommender {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                PreheatPrecoolConnectivityBanner(connection: model.connection)
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
            Text(verbatim: PreheatPrecoolStrings.string(
                "climate.aiPreheatPrecool.title",
                "Suggest a preheat or precool schedule"
            ))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: PreheatPrecoolStrings.string(
                "climate.aiPreheatPrecool.title",
                "Suggest a preheat or precool schedule"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            PreheatPrecoolHelixBadge(
                label: PreheatPrecoolStrings.string("climate.aiPreheatPrecool.badge", "Helix")
            )
            Spacer(minLength: TSSpacing.sm)
            PreheatPrecoolFreshnessChip(connection: model.connection)
            PreheatPrecoolRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AIPreheatPrecoolRecommender {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            PreheatPrecoolLoadingView()
        case let .error(message):
            PreheatPrecoolGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                PreheatPrecoolReadyView(ready: ready) { model.generate() }
            }
        }
    }
}
