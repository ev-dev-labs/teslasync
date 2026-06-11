//
//  BatteryComparison.swift
//  TeslaSync — P4 feature view · 0275 · BatteryComparison (Apple)
//
//  The composable "Fleet Battery Status" surface — the SwiftUI parity of
//  features/vehicles/components/BatteryComparison.tsx. Renders inside a `GlassPanel`-equivalent
//  (`TSGlassPanel`) fading in on appear, and switches over the bound model's phase so every
//  prompt-required state renders (loading / empty / error / stale / offline / content) — never a
//  blank box. Binds through `BatteryComparisonModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable Fleet Battery Status panel — the SwiftUI parity of the web `BatteryComparison`,
/// binding through `BatteryComparisonModel` (P1/S8).
public struct BatteryComparison: View {
    @State private var model: BatteryComparisonModel

    public init(model: BatteryComparisonModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    BatteryComparisonHeader(connection: model.connection)
                    if model.connection != .live {
                        BatteryComparisonConnectivityBanner(connection: model.connection)
                    }
                    content
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web `bars.map(...)` branch, widened to the full load envelope (loading / error / empty /
    /// content) so no state is hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            BatteryComparisonLoading()
        case let .error(message):
            BatteryComparisonErrorView(message: message) { model.refresh() }
        case .empty:
            BatteryComparisonEmpty()
        case .content:
            BatteryComparisonList(bars: model.bars)
        }
    }
}
