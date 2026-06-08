//
//  ChargingSection.swift
//  TeslaSync — P4 feature view · 0074 · ChargingSection (Apple)
//
//  The composable weekly-digest "Charging" surface — the SwiftUI parity of
//  features/analytics/components/weekly-digest/ChargingSection.tsx. Renders inside a
//  GlassPanel-equivalent card (web `<GlassPanel className="space-y-6 p-6">`) fading
//  in on appear (web `<FadeIn delay={0.15}>`), and switches over the bound model's
//  phase so every prompt-required state renders (loading / empty / error / stale /
//  offline / content) — never a blank box. Binds through `ChargingSectionModel`
//  (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable Charging section — the SwiftUI parity of the web
/// `ChargingSection`, binding through `ChargingSectionModel` (P1/S8).
public struct ChargingSection: View {
    @State private var model: ChargingSectionModel

    public init(model: ChargingSectionModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.15) {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                ChargingHeader(connection: model.connection)
                if model.connection != .live {
                    ChargingConnectivityBanner(connection: model.connection)
                }
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web composition (chart + stats + week-over-week), widened to the full load
    /// envelope (loading / error / empty / content) so no state is hidden behind a
    /// blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ChargingLoading()
        case let .error(message):
            ChargingError(message: message) { model.refresh() }
        case .empty:
            ChargingEmpty()
        case .content:
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                ChargingEnergyCard(bars: model.bars, locale: model.displayLocale)
                if !model.stats.isEmpty {
                    ChargingStatsGrid(stats: model.stats)
                }
                ChargingWeekOverWeekRow(trend: model.trend)
            }
        }
    }
}
