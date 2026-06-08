//
//  StatorTempChart.swift
//  TeslaSync — P4 feature view · 0159 · StatorTempChart (Apple)
//
//  The composable "Stator Temperature History" surface — the SwiftUI parity of
//  features/driving/components/drivetrain-health/StatorTempChart.tsx. Renders inside a
//  GlassPanel-equivalent card fading in on appear (web `FadeIn` + `ChartContainer`), and switches
//  over the bound model's phase so every prompt-required state renders (loading / empty / error /
//  stale / offline / content) — never a blank box. Binds through `StatorTempChartModel` (P1/S8);
//  no networking lives here.
//

import SwiftUI

/// The composable Stator Temperature History chart — the SwiftUI parity of the web
/// `StatorTempChart`, binding through `StatorTempChartModel` (P1/S8).
public struct StatorTempChart: View {
    @State private var model: StatorTempChartModel

    public init(model: StatorTempChartModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.23) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                StatorTempHeader(connection: model.connection)
                if model.connection != .live {
                    StatorTempConnectivityBanner(connection: model.connection)
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

    /// The web `data.length <= 1 ? null : <chart>` branch, widened to the full load envelope
    /// (loading / error / empty / content) so no state is hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            StatorTempLoadingChart()
        case let .error(message):
            StatorTempError(message: message) { model.refresh() }
        case .empty:
            StatorTempEmpty()
        case .content:
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                StatorTempLineChart(
                    points: model.points,
                    rows: model.rows,
                    thresholds: model.thresholds,
                    unitSymbol: model.projection.unitSymbol,
                    localeIdentifier: model.units.localeIdentifier
                )
                StatorTempLegend(unitSymbol: model.projection.unitSymbol)
            }
        }
    }
}
