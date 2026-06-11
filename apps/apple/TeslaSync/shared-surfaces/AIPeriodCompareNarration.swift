//
//  AIPeriodCompareNarration.swift
//  TeslaSync — P4 shared surface · 0037 · AIPeriodCompareNarration (Apple)
//
//  The Helix period-compare narration card — the SwiftUI parity of
//  web/src/components/ai/AIPeriodCompareNarration.tsx. It is
//  `withAiFeature('period-compare-narration')` in the web source (a `useAiEnabled` gate; disabled ⇒
//  the HOC renders `null`); the InnerSection streams from POST /ai/analytics/period-compare/narrate
//  (`{ vehicle_id, days_a?, days_b? }`) and renders the shared `AIFeatureCard` (title "Narrate the
//  period comparison", a description, the Ask-Helix button, the "Helix" badge) feeding
//  `AiOutputPanel`. This surface reproduces that composition natively, bound through
//  `PeriodCompareNarrationModel` (P1/S8); no networking lives here.
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

// MARK: - AIPeriodCompareNarration (the shared surface)

/// The Helix period-compare narration card — the SwiftUI parity of `AIPeriodCompareNarration.tsx`.
/// Renders every state from the web source plus the P4 leaf freshness states, binding through
/// `PeriodCompareNarrationModel`.
public struct AIPeriodCompareNarration: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AIPeriodCompareNarration"

    @State private var model: PeriodCompareNarrationModel

    public init(model: PeriodCompareNarrationModel) {
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

private extension AIPeriodCompareNarration {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                PeriodCompareNarrationConnectivityBanner(connection: model.connection)
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
            Text(verbatim: PeriodCompareNarrationStrings.string(
                "compare.aiNarrative.title",
                "Narrate the period comparison"
            ))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: PeriodCompareNarrationStrings.string(
                "compare.aiNarrative.title",
                "Narrate the period comparison"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            PeriodCompareNarrationHelixBadge(
                label: PeriodCompareNarrationStrings.string("compare.aiNarrative.badge", "Helix")
            )
            Spacer(minLength: TSSpacing.sm)
            PeriodCompareNarrationFreshnessChip(connection: model.connection)
            PeriodCompareNarrationRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AIPeriodCompareNarration {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            PeriodCompareNarrationLoadingView()
        case let .error(message):
            PeriodCompareNarrationGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                PeriodCompareNarrationReadyView(ready: ready) { model.generate() }
            }
        }
    }
}
