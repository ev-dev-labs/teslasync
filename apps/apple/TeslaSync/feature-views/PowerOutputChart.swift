//
//  PowerOutputChart.swift
//  TeslaSync — P4 feature view · 0158 · PowerOutputChart (Apple)
//
//  The composable "Power Output History" surface — the SwiftUI parity of
//  features/driving/components/drivetrain-health/PowerOutputChart.tsx. Renders inside a
//  glass card fading in on appear (web `<FadeIn delay={0.3}>`) and switches over the bound
//  model's phase so every prompt-required state renders (loading / empty / error / stale /
//  offline / content) — never a blank box. Binds through `PowerOutputChartModel` (P1/S8);
//  no networking lives here.
//

import SwiftUI

/// The composable Power Output History chart — the SwiftUI parity of the web
/// `PowerOutputChart`, binding through `PowerOutputChartModel` (P1/S8).
public struct PowerOutputChart: View {
    @State private var model: PowerOutputChartModel

    public init(model: PowerOutputChartModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.3) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                PowerOutputHeader(
                    connection: model.connection,
                    canExport: isContent,
                    onExport: { TSClipboard.copy(model.exportCSV) }
                )
                if model.connection != .live {
                    PowerOutputConnectivityBanner(connection: model.connection)
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

    private var isContent: Bool {
        if case .content = model.phase { return true }
        return false
    }

    /// The web chart, widened to the full load envelope (loading / error / empty /
    /// content) so no state is hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            PowerOutputLoadingChart()
        case let .error(message):
            PowerOutputError(message: message) { model.refresh() }
        case .empty:
            PowerOutputEmpty()
        case .content:
            PowerOutputChartBody(
                series: model.series,
                hidden: model.hiddenSeries,
                summary: model.accessibilitySummary,
                onToggle: { role in model.toggleSeries(role) }
            )
        }
    }
}
