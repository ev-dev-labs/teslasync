//
//  TemperatureTrendChart.swift
//  TeslaSync — P4 feature view · 0162 · TemperatureTrendChart (Apple)
//
//  The composable "Temperature Trend" surface — the SwiftUI parity of
//  features/driving/components/drivetrain-health/TemperatureTrendChart.tsx. Renders
//  inside a GlassPanel-equivalent card fading in on appear (web `ChartContainer` +
//  `FadeIn`), and switches over the bound model's phase so every prompt-required state
//  renders (loading / empty / error / stale / offline / content) — never a blank box.
//  Binds through `TemperatureTrendChartModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable Temperature Trend chart — the SwiftUI parity of the web
/// `TemperatureTrendChart`, binding through `TemperatureTrendChartModel` (P1/S8).
public struct TemperatureTrendChart: View {
    @State private var model: TemperatureTrendChartModel

    public init(model: TemperatureTrendChartModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.25) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TemperatureTrendHeader(connection: model.connection)
                if model.connection != .live {
                    TemperatureTrendConnectivityBanner(connection: model.connection)
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

    /// The web `data.length <= 1 ? null : <chart>` branch, widened to the full load
    /// envelope (loading / error / empty / content) so no state is hidden behind a
    /// blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            TemperatureTrendLoadingChart()
        case let .error(message):
            TemperatureTrendError(message: message) { model.refresh() }
        case .empty:
            TemperatureTrendEmpty()
        case .content:
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TemperatureTrendLineChart(projection: model.projection, localeIdentifier: model.units.localeIdentifier)
                TemperatureTrendLegend()
            }
        }
    }
}
