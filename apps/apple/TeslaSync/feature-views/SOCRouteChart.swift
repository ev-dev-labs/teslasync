//
//  SOCRouteChart.swift
//  TeslaSync — P4 feature view · 0176 · SOCRouteChart (Apple)
//
//  The composable "Battery Along Route" surface — the SwiftUI parity of
//  features/driving/components/SOCRouteChart.tsx. Renders inside a GlassPanel-
//  equivalent card fading in on appear (web `ChartContainer`), and switches over the
//  bound model's phase so every prompt-required state renders (loading / empty /
//  error / stale / offline / content) — never a blank box. Binds through
//  `SOCRouteChartModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable planned-route SOC area chart — the SwiftUI parity of the web
/// `SOCRouteChart`, binding through `SOCRouteChartModel` (P1/S8).
public struct SOCRouteChart: View {
    @State private var model: SOCRouteChartModel

    public init(model: SOCRouteChartModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.2) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                SOCRouteChartHeader(connection: model.connection)
                if model.connection != .live {
                    SOCRouteChartConnectivityBanner(connection: model.connection)
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

    /// The web `chartData.length === 0 ? <empty> : <area chart>` branch, widened to
    /// the full load envelope (loading / error / empty / content) so no state is
    /// hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            SOCRouteChartLoadingChart()
        case let .error(message):
            SOCRouteChartError(message: message) { model.refresh() }
        case .empty:
            SOCRouteChartEmpty()
        case .content:
            SOCRouteChartAreaChart(
                samples: model.samples,
                markers: model.markers,
                minArrivalSoc: model.minArrivalSoc,
                selectedDistance: cursorBinding,
                locale: model.displayLocale
            )
        }
    }

    /// The tooltip cursor binding the chart drives — selection writes the hovered
    /// distance back through the model (web `<Tooltip>` active point).
    private var cursorBinding: Binding<Double?> {
        Binding(
            get: { model.selectedDistance },
            set: { model.moveCursor(to: $0) }
        )
    }
}
