//
//  SessionCurveChart.swift
//  TeslaSync — P4 feature view · 0090 · SessionCurveChart (Apple)
//
//  The composable "Power vs SOC" charging-curve surface — the SwiftUI parity of
//  features/charging/components/charging-curve/SessionCurveChart.tsx. Renders inside
//  a GlassPanel-equivalent card (web `ChartContainer`) fading in on appear, and
//  switches over the bound model's phase so every prompt-required state renders
//  (loading / empty / error / stale / offline / content) — never a blank box. Binds
//  through `SessionCurveChartModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable Power-vs-SOC charging-curve chart — the SwiftUI parity of the web
/// `SessionCurveChart`, binding through `SessionCurveChartModel` (P1/S8).
public struct SessionCurveChart: View {
    @State private var model: SessionCurveChartModel
    @Environment(\.locale) private var locale

    public init(model: SessionCurveChartModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.2) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                SessionCurveHeader(connection: model.connection)
                SessionCurveSubtitle()
                if model.connection != .live {
                    SessionCurveConnectivityBanner(connection: model.connection)
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
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary(locale: locale)))
    }

    /// The web `<AreaChart data={curveData}>` branch, widened to the full load
    /// envelope (loading / error / empty / content) so no state is hidden behind a
    /// blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            SessionCurveLoadingChart()
        case let .error(message):
            SessionCurveError(message: message) { model.refresh() }
        case .empty:
            SessionCurveEmpty()
        case .content:
            SessionCurveAreaChart(points: model.points, chartData: model.projection.chartData)
        }
    }
}
