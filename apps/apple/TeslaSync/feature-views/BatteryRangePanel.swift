//
//  BatteryRangePanel.swift
//  TeslaSync — P4 feature view · 0289 · BatteryRangePanel (Apple)
//
//  The composable BatteryRangePanel feature view — the SwiftUI parity of
//  features/vehicles/components/vehicle-detail/BatteryRangePanel.tsx. A glass panel that pairs a
//  radial battery gauge (web `RadialGauge`) with three metric cards (web `MetricCard`) — Rated
//  Range, Ideal Range, and Charging — binding through `BatteryRangePanelModel` (P1/S8). No
//  networking lives here. Reproduces the web composition (the gauge beside the metric grid, stacking
//  on narrow widths) and extends it with the Apple HIG states contract: a loading skeleton, a
//  QueryError-equivalent failure with retry, and a freshness chip + stale/offline banner that keep
//  the last-known snapshot visible while reconnecting (stale) or offline. Emits the P1/S11
//  `view.opened` diagnostics event on appear.
//

import SwiftUI

/// The composable BatteryRangePanel surface — the SwiftUI parity of the web `BatteryRangePanel`,
/// binding through `BatteryRangePanelModel` (P1/S8). No networking lives here.
public struct BatteryRangePanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        BatteryRangePanelSurface.slug
    }

    @State private var model: BatteryRangePanelModel

    public init(model: BatteryRangePanelModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn {
            TSGlassPanel {
                content
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .overlay(alignment: .topTrailing) {
                if model.showsFreshness {
                    BatteryRangePanelFreshnessChip(connection: model.connection)
                        .padding(TSSpacing.md)
                }
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            BatteryRangePanelLoadingContent()
        case let .error(message):
            BatteryRangePanelErrorView(message: message) { model.refresh() }
        case .empty:
            BatteryRangePanelEmptyState()
        case .content:
            BatteryRangePanelContentView(
                content: model.content,
                connection: model.connection,
                onRefresh: { model.refresh() }
            )
        }
    }
}
