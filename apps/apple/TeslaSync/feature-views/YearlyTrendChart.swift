//
//  YearlyTrendChart.swift
//  TeslaSync — P4 feature view · 0095 · YearlyTrendChart (Apple)
//
//  The composable "Yearly Charging Speed Trend" surface — the SwiftUI parity of
//  features/charging/components/charging-curve/YearlyTrendChart.tsx. The panel
//  chrome (title + subtitle + aria + freshness chip) is always present, and the
//  body swaps by load state (loading skeleton / "No data available" empty /
//  error with retry / the composed chart), mirroring the web `ChartContainer`
//  shell. Bound through `YearlyTrendChartModel` (P1/S8); no networking lives
//  here, and every visible string resolves through the P1/S10 facade.
//

import SwiftUI

/// The composable Yearly Charging Speed Trend surface — the SwiftUI parity of
/// `features/charging/components/charging-curve/YearlyTrendChart.tsx`, binding
/// through `YearlyTrendChartModel` (P1/S8). No networking lives here.
public struct YearlyTrendChart: View {
    @State private var model: YearlyTrendChartModel

    public init(model: YearlyTrendChartModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        YearlyTrendPanel(
            titleKey: "charging.curve.yearlyTrend",
            titleFallback: "Yearly Charging Speed Trend",
            subtitleKey: "charging.curve.yearlyTrendDesc",
            subtitleFallback: "Average time-to-charge and session count by year",
            ariaKey: "charging.curve.yearlyTrend.aria",
            ariaFallback: "Yearly average charge-time and session-count composed chart",
            accessory: { YearlyTrendFreshnessChip(connection: model.connection) },
            content: { panelBody }
        )
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    private var panelBody: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if model.connection != .live {
                YearlyTrendConnectivityBanner(connection: model.connection)
            }
            phaseBody
        }
    }

    @ViewBuilder private var phaseBody: some View {
        switch model.phase {
        case .loading:
            YearlyTrendLoadingBody()
        case .empty:
            YearlyTrendEmptyRow()
        case let .error(message):
            YearlyTrendErrorState(message: message) { model.refresh() }
        case .content:
            TSFadeIn {
                YearlyTrendChartBody(bars: model.projection.bars)
            }
        }
    }
}
