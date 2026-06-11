//
//  InsightsEngine.swift
//  TeslaSync — P4 shared surface · 0092 · InsightsEngine (Apple)
//
//  The Smart-Insights engine card — the SwiftUI parity of
//  web/src/components/data-display/InsightsEngine.tsx. The web component derives up to eight
//  plain-language insights from the page's drive / charging / energy / battery / vampire-drain data
//  and renders them as a titled grid of severity-bordered cards (it returns `null` when none apply).
//  This surface reproduces that composition natively, bound through `InsightsEngineModel` (P1/S8); no
//  networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading — upstream queries resolving → skeleton card grid.
//    • error   — an upstream query failed → a retryable error.
//    • empty   — data resolved but no insight applies (web `null`) → a friendly empty state.
//    • ready   — the localized insight grid, plus the orthogonal connectivity axis (live / stale /
//                offline) driving the header freshness chip + banner with a one-shot auto-refresh on
//                the stale transition.
//

import SwiftUI

// MARK: - InsightsEngine (the shared surface)

/// The Smart-Insights engine card — the SwiftUI parity of `InsightsEngine.tsx`. Renders every state
/// from the web source plus the P4 leaf freshness states, binding through `InsightsEngineModel`.
public struct InsightsEngine: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "InsightsEngine"

    @State private var model: InsightsEngineModel

    public init(model: InsightsEngineModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.15) {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                InsightsEngineHeader(connection: model.connection) { model.refresh() }
                if model.connection != .live {
                    InsightsEngineConnectivityBanner(connection: model.connection)
                }
                content
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            InsightsEngineLoadingView()
        case let .error(message):
            InsightsEngineErrorView(message: message) { model.refresh() }
        case .empty:
            InsightsEngineEmptyView()
        case .ready:
            InsightsEngineGrid(insights: model.insights)
        }
    }
}
