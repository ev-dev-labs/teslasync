//
//  BatteryLevelChart.swift
//  TeslaSync — P4 feature view · 0097 · BatteryLevelChart (Apple)
//
//  The composable "Battery Level at Charge Start" surface — the SwiftUI parity of
//  features/charging/components/charging-list/BatteryLevelChart.tsx. Renders inside
//  a GlassPanel-equivalent card (web `<GlassPanel className="p-6">`) fading in on
//  appear, and switches over the bound model's phase so every prompt-required state
//  renders (loading / empty / error / stale / offline / content) — never a blank
//  box. Binds through `BatteryLevelChartModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable Battery-Level-at-Charge-Start chart — the SwiftUI parity of the
/// web `BatteryLevelChart`, binding through `BatteryLevelChartModel` (P1/S8).
public struct BatteryLevelChart: View {
    @State private var model: BatteryLevelChartModel

    public init(model: BatteryLevelChartModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.2) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                BatteryLevelHeader(connection: model.connection)
                if model.connection != .live {
                    BatteryLevelConnectivityBanner(connection: model.connection)
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

    /// The web `<BarChart data={data}>` branch, widened to the full load envelope
    /// (loading / error / empty / content) so no state is hidden behind a blank
    /// panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            BatteryLevelLoadingChart()
        case let .error(message):
            BatteryLevelError(message: message) { model.refresh() }
        case .empty:
            BatteryLevelEmpty()
        case .content:
            BatteryLevelBarChart(buckets: model.buckets)
        }
    }
}
