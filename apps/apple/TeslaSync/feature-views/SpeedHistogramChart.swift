//
//  SpeedHistogramChart.swift
//  TeslaSync — P4 feature view · 0149 · SpeedHistogramChart (Apple)
//
//  The composable drive-detail "Speed Histogram" surface — the SwiftUI parity of
//  features/driving/components/drive-detail/SpeedHistogramChart.tsx. Renders inside a
//  GlassPanel-equivalent card (web `ChartContainer`) fading in on appear (web
//  `<FadeIn>`), and switches over the bound model's phase so every prompt-required
//  state renders (loading / empty / error / stale / offline / content) — never a
//  blank box. Binds through `SpeedHistogramChartModel` (P1/S8); no networking here.
//

import SwiftUI

/// The composable Speed Histogram chart — the SwiftUI parity of the web
/// `SpeedHistogramChart`, binding through `SpeedHistogramChartModel` (P1/S8).
public struct SpeedHistogramChart: View {
    @State private var model: SpeedHistogramChartModel

    public init(model: SpeedHistogramChartModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                SpeedHistogramHeader(connection: model.connection)
                if model.connection != .live {
                    SpeedHistogramConnectivityBanner(connection: model.connection)
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

    /// The web `speedHistData.length > 0 ? <chart> : <empty>` branch, widened to the
    /// full load envelope (loading / error / empty / content) so no state is hidden
    /// behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            SpeedHistogramLoadingChart()
        case let .error(message):
            SpeedHistogramError(message: message) { model.refresh() }
        case .empty:
            SpeedHistogramEmpty()
        case .content:
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                SpeedHistogramBarChart(bars: model.bars)
                Divider().overlay(Color.TS.border)
                SpeedHistogramDataTable(bars: model.bars)
            }
        }
    }
}
