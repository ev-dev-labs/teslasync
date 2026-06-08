//
//  ChargerTypeChart.swift
//  TeslaSync — P4 feature view · 0087 · ChargerTypeChart (Apple)
//
//  The composable "Charge Rate by Charger Type" surface — the SwiftUI parity of
//  features/charging/components/charging-curve/ChargerTypeChart.tsx. Renders inside a
//  GlassPanel-equivalent card (web `ChartContainer`) fading in on appear (web
//  `<FadeIn>`), and switches over the bound model's phase so every prompt-required
//  state renders (loading / empty / error / stale / offline / content) — never a
//  blank box. Binds through `ChargerTypeChartModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable Charge Rate by Charger Type chart — the SwiftUI parity of the web
/// `ChargerTypeChart`, binding through `ChargerTypeChartModel` (P1/S8).
public struct ChargerTypeChart: View {
    @State private var model: ChargerTypeChartModel

    public init(model: ChargerTypeChartModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.2) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                ChargerTypeHeader(connection: model.connection)
                ChargerTypeSubtitle()
                if model.connection != .live {
                    ChargerTypeConnectivityBanner(connection: model.connection)
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

    /// The web `chargerTypeStats.length > 0 ? <chart> : <EmptyState>` branch, widened
    /// to the full load envelope (loading / error / empty / content) so no state is
    /// hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ChargerTypeLoadingChart()
        case let .error(message):
            ChargerTypeError(message: message) { model.refresh() }
        case .empty:
            ChargerTypeEmpty()
        case .content:
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                ChargerTypeBarChart(points: model.points, rows: model.rows)
                ChargerTypeMetricLegend()
                ChargerTypeBreakdownRows(points: model.points)
                Divider().overlay(Color.TS.border)
                ChargerTypeDataTable(points: model.points)
            }
        }
    }
}
