//
//  BatteryRangeCharts.swift
//  TeslaSync — P4 feature view · 0288 · BatteryRangeCharts (Apple)
//
//  The composable BatteryRangeCharts feature view — the SwiftUI parity of
//  features/vehicles/components/vehicle-detail/BatteryRangeCharts.tsx. A responsive two-panel
//  grid (web `grid-cols-1 lg:grid-cols-2`) pairing a Battery Overview panel (a radial battery
//  gauge + Battery % / Range tiles over a Current-vs-Remaining bar chart) with a Drive Distance
//  Trend panel (a distance + duration area chart over the recent drives, or a "No drive data for
//  chart" empty leaf), binding through `BatteryRangeChartsModel` (P1/S8). No networking lives
//  here. Reproduces the web composition and extends it with the Apple HIG states contract: a
//  loading skeleton, a QueryError-equivalent failure with retry, and a freshness chip +
//  stale/offline banner that keep the last-known snapshot visible while reconnecting (stale) or
//  offline. Emits the P1/S11 `view.opened` diagnostics event on appear.
//

import SwiftUI

/// The composable BatteryRangeCharts surface — the SwiftUI parity of the web `BatteryRangeCharts`,
/// binding through `BatteryRangeChartsModel` (P1/S8). No networking lives here.
public struct BatteryRangeCharts: View {
    @State private var model: BatteryRangeChartsModel

    public init(model: BatteryRangeChartsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn {
            content
                .overlay(alignment: .topTrailing) {
                    if model.showsFreshness {
                        BatteryRangeChartsFreshnessChip(connection: model.connection)
                            .padding(TSSpacing.md)
                    }
                }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web's always-on two-panel grid, widened to the full load envelope (loading / error /
    /// empty / content) so no state is hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            panelGrid(
                battery: AnyView(loadingBatteryPanel),
                drive: AnyView(loadingDrivePanel)
            )
        case let .error(message):
            BatteryRangeChartsErrorView(message: message) { model.refresh() }
        case .empty:
            BatteryRangeChartsEmptyState()
        case .content:
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                if model.connection != .live {
                    BatteryRangeChartsBanner(connection: model.connection) { model.refresh() }
                }
                panelGrid(
                    battery: AnyView(batteryPanel),
                    drive: AnyView(drivePanel)
                )
            }
        }
    }

    // MARK: - Responsive two-panel grid (web `grid-cols-1 lg:grid-cols-2`)

    /// Lays the two panels side-by-side when there is room (web `lg:grid-cols-2`), stacking them
    /// vertically on narrow widths (web `grid-cols-1`). Each panel fills its column equally.
    private func panelGrid(battery: AnyView, drive: AnyView) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                battery.frame(maxWidth: .infinity, alignment: .top)
                drive.frame(maxWidth: .infinity, alignment: .top)
            }
            VStack(spacing: TSSpacing.lg) {
                battery
                drive
            }
        }
    }

    // MARK: - Content panels

    private var batteryPanel: some View {
        BatteryRangeChartsPanel(
            systemImage: "battery.100",
            titleKey: "vehicles.detail.batteryOverview",
            titleFallback: "Battery Overview"
        ) {
            BatteryRangeChartsBatteryBody(content: model.content)
        }
    }

    private var drivePanel: some View {
        BatteryRangeChartsPanel(
            systemImage: "road.lanes",
            titleKey: "vehicles.detail.driveTrend",
            titleFallback: "Drive Distance Trend"
        ) {
            if model.content.hasDriveData {
                BatteryRangeChartsDriveAreaChart(
                    points: model.content.drivePoints,
                    unitSymbol: model.content.distanceUnitSymbol
                )
            } else {
                BatteryRangeChartsDriveEmpty()
            }
        }
    }

    // MARK: - Loading panels

    private var loadingBatteryPanel: some View {
        BatteryRangeChartsPanel(
            systemImage: "battery.100",
            titleKey: "vehicles.detail.batteryOverview",
            titleFallback: "Battery Overview"
        ) {
            BatteryRangeChartsBatteryLoadingBody()
        }
    }

    private var loadingDrivePanel: some View {
        BatteryRangeChartsPanel(
            systemImage: "road.lanes",
            titleKey: "vehicles.detail.driveTrend",
            titleFallback: "Drive Distance Trend"
        ) {
            BatteryRangeChartsDriveLoadingBody()
        }
    }
}
