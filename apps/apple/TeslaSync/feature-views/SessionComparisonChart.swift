//
//  SessionComparisonChart.swift
//  TeslaSync — P4 feature view · 0089 · SessionComparisonChart (Apple)
//
//  The composable "Session Comparison" surface — the SwiftUI parity of
//  features/charging/components/charging-curve/SessionComparisonChart.tsx. Renders
//  inside a glass card fading in on appear (web `<FadeIn delay={0.15}>`) and switches
//  over the bound model's phase so every prompt-required state renders (loading /
//  empty / error / stale / offline / content) — never a blank box. Binds through
//  `SessionComparisonChartModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable Session Comparison chart — the SwiftUI parity of the web
/// `SessionComparisonChart`, binding through `SessionComparisonChartModel` (P1/S8).
public struct SessionComparisonChart: View {
    @State private var model: SessionComparisonChartModel

    public init(model: SessionComparisonChartModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.15) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                SessionComparisonHeader(connection: model.connection)
                if model.connection != .live {
                    SessionComparisonConnectivityBanner(connection: model.connection)
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

    /// The web `comparisonData` overlay, widened to the full load envelope (loading /
    /// error / empty / content) so no state is hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            SessionComparisonLoadingChart()
        case let .error(message):
            SessionComparisonError(message: message) { model.refresh() }
        case .empty:
            SessionComparisonEmpty()
        case .content:
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                SessionComparisonCurveChart(series: model.series)
                SessionComparisonLegend(series: model.series)
            }
        }
    }
}
