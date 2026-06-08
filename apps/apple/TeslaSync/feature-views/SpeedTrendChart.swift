//
//  SpeedTrendChart.swift
//  TeslaSync — P4 feature view · 0092 · SpeedTrendChart (Apple)
//
//  The composable "Charging Speed Trend" surface — the SwiftUI parity of
//  features/charging/components/charging-curve/SpeedTrendChart.tsx. Renders inside
//  a GlassPanel-equivalent card fading in on appear (web `ChartContainer`), and
//  switches over the bound model's phase so every prompt-required state renders
//  (loading / empty / error / stale / offline / content) — never a blank box.
//  Binds through `SpeedTrendChartModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable Charging Speed Trend chart — the SwiftUI parity of the web
/// `SpeedTrendChart`, binding through `SpeedTrendChartModel` (P1/S8).
public struct SpeedTrendChart: View {
    @State private var model: SpeedTrendChartModel

    public init(model: SpeedTrendChartModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.2) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                SpeedTrendHeader(connection: model.connection)
                if model.connection != .live {
                    SpeedTrendConnectivityBanner(connection: model.connection)
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

    /// The web `monthlyTrend.length > 0 ? <chart> : <empty overlay>` branch,
    /// widened to the full load envelope (loading / error / empty / content) so no
    /// state is hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            SpeedTrendLoadingChart()
        case let .error(message):
            SpeedTrendError(message: message) { model.refresh() }
        case .empty:
            SpeedTrendEmpty()
        case .content:
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                SpeedTrendLineChart(points: model.points, rows: model.rows, locale: model.displayLocale)
                SpeedTrendLegend()
            }
        }
    }
}
