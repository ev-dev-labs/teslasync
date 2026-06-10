//
//  AISpeedProfileInsights.swift
//  TeslaSync — P4 shared surface · 0049 · AISpeedProfileInsights (Apple)
//
//  The Helix speed-profile-insights card — the SwiftUI parity of
//  web/src/components/ai/AISpeedProfileInsights.tsx. It is
//  `withAiFeature('speed-profile-insights')` in the web source (a `useAiEnabled` gate; disabled
//  ⇒ the HOC renders `null`); the InnerSection streams from POST
//  /ai/drives/{driveID}/speed-profile/insights (empty `{}` body, the {driveID} slot is the parent page's
//  driveId as an opaque anchor) and renders the shared `AIFeatureCard` (title "Speed-profile
//  insights", a description, the Ask-Helix button, the "Helix" badge) feeding `AiOutputPanel`. This
//  surface reproduces that composition natively, bound through `SpeedProfileInsightsModel`
//  (P1/S8); no networking lives here.
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null). NOT a hidden section:
//                when on but no insights have been generated, the friendly empty output renders.
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + Ask-Helix button + output panel (empty / thinking / prose /
//                error), plus the orthogonal connectivity axis (live / stale / offline) driving the
//                header freshness chip + banner with a one-shot auto-refresh on the stale
//                transition.
//

import SwiftUI

// MARK: - AISpeedProfileInsights (the shared surface)

/// The Helix speed-profile-insights card — the SwiftUI parity of
/// `AISpeedProfileInsights.tsx`. Renders every state from the web source plus the P4 leaf
/// freshness states, binding through `SpeedProfileInsightsModel`.
public struct AISpeedProfileInsights: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AISpeedProfileInsights"

    @State private var model: SpeedProfileInsightsModel

    public init(model: SpeedProfileInsightsModel) {
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

private extension AISpeedProfileInsights {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                SpeedProfileInsightsConnectivityBanner(connection: model.connection)
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
            Text(verbatim: SpeedProfileInsightsStrings.string(
                "driveDetail.aiSpeedProfile.title",
                "Speed-profile insights"
            ))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: SpeedProfileInsightsStrings.string(
                "driveDetail.aiSpeedProfile.title",
                "Speed-profile insights"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            SpeedProfileInsightsHelixBadge(
                label: SpeedProfileInsightsStrings.string("driveDetail.aiSpeedProfile.badge", "Helix")
            )
            Spacer(minLength: TSSpacing.sm)
            SpeedProfileInsightsFreshnessChip(connection: model.connection)
            SpeedProfileInsightsRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AISpeedProfileInsights {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            SpeedProfileInsightsLoadingView()
        case let .error(message):
            SpeedProfileInsightsGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                SpeedProfileInsightsReadyView(ready: ready) { model.generate() }
            }
        }
    }
}
