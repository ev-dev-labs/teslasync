//
//  FSMTimelineChart.swift
//  TeslaSync — P4 feature view · 0231 · FSMTimelineChart (Apple)
//
//  The composable "Transitions Over Time" surface — the SwiftUI parity of
//  features/system/components/FSMTimelineChart.tsx. Renders inside a GlassPanel-
//  equivalent card fading in on appear (web `ChartContainer`), and switches over the
//  bound model's phase so every prompt-required state renders (loading / empty /
//  error / stale / offline / content) — never a blank box. Binds through
//  `FSMTimelineChartModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable stacked FSM-transition timeline — the SwiftUI parity of the web
/// `FSMTimelineChart`, binding through `FSMTimelineChartModel` (P1/S8).
public struct FSMTimelineChart: View {
    @State private var model: FSMTimelineChartModel

    public init(model: FSMTimelineChartModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.2) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                FSMTimelineHeader(connection: model.connection)
                if model.connection != .live {
                    FSMTimelineConnectivityBanner(connection: model.connection)
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

    /// The web `buckets.length > 0 ? <area chart> : <empty>` branch, widened to the
    /// full load envelope (loading / error / empty / content) so no state is hidden
    /// behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            FSMTimelineLoadingChart()
        case let .error(message):
            FSMTimelineError(message: message) { model.refresh() }
        case .empty:
            FSMTimelineEmpty(message: model.emptyMessage)
        case .content:
            FSMTimelineStackedChart(
                buckets: model.buckets,
                series: model.series,
                points: FSMTimelineProjector.areaPoints(model.projection),
                selectedIndex: cursorBinding,
                locale: model.displayLocale,
                accessibilitySummary: model.accessibilitySummary
            )
        }
    }

    /// The tooltip cursor binding the chart drives — selection writes the hovered
    /// bucket index back through the model (web `<Tooltip>` active category).
    private var cursorBinding: Binding<Int?> {
        Binding(
            get: { model.selectedBucketIndex },
            set: { model.moveCursor(to: $0) }
        )
    }
}
