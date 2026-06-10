//
//  TelemetryPipelineCard.swift
//  TeslaSync — P4 feature view · 0256 · TelemetryPipelineCard (Apple)
//
//  The composable "Telemetry Pipeline" operator card — the SwiftUI parity of
//  features/system/components/status/TelemetryPipelineCard.tsx. Renders the fleet-rollup
//  grid, the per-vehicle liveness list (union of the Fleet Telemetry stream + REST poll
//  ingest paths), the broker/polling connectivity chips, and the footer links, across every
//  state from the web source (loading / empty / error / stale / offline / content) bound
//  through `TelemetryPipelineModel` (P1/S8). No networking lives here; links route through
//  the navigation seam and the freshness chip + banner reflect the bound source's live-state.
//

import SwiftUI

/// The composable Telemetry Pipeline card — the SwiftUI parity of
/// `features/system/components/status/TelemetryPipelineCard.tsx`, binding through
/// `TelemetryPipelineModel` (P1/S8). No networking lives here.
public struct TelemetryPipelineCard: View {
    @State private var model: TelemetryPipelineModel

    public init(model: TelemetryPipelineModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            switch model.phase {
            case .loading:
                TelemetryPipelineLoadingState()
            case let .error(message):
                TelemetryPipelineErrorState(message: message) { model.refresh() }
            case .empty:
                resolvedBody(showVehicles: false)
            case .content:
                resolvedBody(showVehicles: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Resolved body (content / empty share the rollup grid + footer)

private extension TelemetryPipelineCard {
    /// The resolved card body shared by the content + empty phases: the freshness banner
    /// (only when the bound source is not live), the always-present rollup grid, then either
    /// the liveness summary + per-vehicle list (content) or the "no vehicles" empty block,
    /// and the footer links. Mirrors the web shell, which keeps the grid + footer visible
    /// regardless of whether any vehicles are configured.
    @ViewBuilder
    func resolvedBody(showVehicles: Bool) -> some View {
        if model.connection != .live {
            TelemetryPipelineConnectivityBanner(connection: model.connection)
        }
        TelemetryFleetRollupGrid(vehicleCount: model.vehicleCount, totals: model.totals)
        if showVehicles {
            TelemetryPipelineSummaryRow(
                summary: model.summary,
                mqttConnected: model.mqttConnected,
                pollingEnabled: model.pollingEnabled
            )
            TelemetryPipelineVehicleList(rows: model.rows) { model.navigate(to: $0) }
        } else {
            TelemetryPipelineEmptyVehicles { model.navigate(to: $0) }
        }
        TelemetryPipelineFooterLinks { model.navigate(to: $0) }
    }
}
