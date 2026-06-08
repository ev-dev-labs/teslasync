//
//  ChargingDetailSection.swift
//  TeslaSync — P4 feature view · 0053 · ChargingDetailSection (Apple)
//
//  The charging-analytics section — the SwiftUI parity of the web
//  features/analytics/components/analytics/ChargingDetailSection.tsx. Renders the
//  four stacked glass panels (Charger Brands leaderboard, Monthly Charging Trend
//  composed chart, Cost Analysis cards, Cost by Charger Type bars) and every state
//  (loading / loaded / per-panel empty / error / stale / offline), binding through
//  `ChargingDetailModel` (P1/S8). No networking lives here — the web section takes
//  `data` as a prop; the native model is fed by a `ChargingDetailSource`.
//

import SwiftUI

// MARK: - String facade `Text` helper (kept here so the Model layer stays SwiftUI-free)

public extension ChargingDetailStrings {
    /// A `Text` for a facade key, rendered verbatim so the resolved (possibly
    /// localized) value is never re-interpreted as a SwiftUI string key.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - ChargingDetailSection (the feature surface)

/// The charging-analytics section. Switches over the model's render phase and, in
/// the loaded phase, composes the four panels (each self-empties rather than
/// hiding, matching the web) above an optional freshness banner.
public struct ChargingDetailSection: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ChargingDetailSection"

    @State private var model: ChargingDetailModel

    /// - Parameter model: the bound view-model (built over a `ChargingDetailSource`).
    public init(model: ChargingDetailModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(ChargingDetailStrings.text("analytics.charging.detail.a11y", "Charging analytics"))
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ChargingDetailSkeleton()
        case let .error(message):
            ChargingDetailErrorView(message: message) { model.refresh() }
        case .loaded:
            loadedContent
        }
    }

    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if model.connection != .live {
                ChargingFreshnessBanner(connection: model.connection) { model.refresh() }
            }
            ChargerBrandsPanel(
                rows: model.brandLeaderboard,
                localize: model.localize,
                formatting: model.formatting
            )
            MonthlyTrendPanel(
                points: model.monthlyTrend,
                scale: model.monthlyTrendScale,
                localize: model.localize,
                formatting: model.formatting
            )
            CostAnalysisPanel(
                stats: model.costStats,
                localize: model.localize,
                formatting: model.formatting
            )
            CostByTypePanel(
                shares: model.chargerTypeShares,
                localize: model.localize,
                formatting: model.formatting
            )
        }
    }
}
