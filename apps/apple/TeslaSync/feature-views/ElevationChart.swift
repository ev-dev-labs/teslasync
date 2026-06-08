//
//  ElevationChart.swift
//  TeslaSync — P4 feature view · 0141 · ElevationChart (Apple)
//
//  The composable "Elevation Profile" surface — the SwiftUI parity of
//  features/driving/components/drive-detail/ElevationChart.tsx. Renders inside a
//  GlassPanel-equivalent card (web `ChartContainer`) fading in on appear (web
//  `<FadeIn>`), and switches over the bound model's phase so every prompt-required
//  state renders (loading / empty / error / stale / offline / content) — never a
//  blank box. Binds through `ElevationChartModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable Elevation Profile chart — the SwiftUI parity of the web
/// `ElevationChart`, binding through `ElevationChartModel` (P1/S8).
public struct ElevationChart: View {
    @State private var model: ElevationChartModel

    public init(model: ElevationChartModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.2) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                ElevationHeader(connection: model.connection)
                if model.connection != .live {
                    ElevationConnectivityBanner(connection: model.connection)
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

    /// The web `chartData.length > 1 ? <chart> : <EmptyState>` branch, widened to
    /// the full load envelope (loading / error / empty / content) so no state is
    /// hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ElevationLoadingChart()
        case let .error(message):
            ElevationError(message: message) { model.refresh() }
        case .empty:
            ElevationEmpty()
        case .content:
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                ElevationStatRow(stats: model.stats, precision: model.precision)
                ElevationProfileChart(
                    points: model.points,
                    speedUnit: model.speedUnit,
                    cursorIndex: model.cursorIndex,
                    accessibilitySummary: model.accessibilitySummary,
                    onCursorChange: { model.updateCursor(to: $0) }
                )
                ElevationMetricLegend(speedUnit: model.speedUnit)
            }
        }
    }
}
