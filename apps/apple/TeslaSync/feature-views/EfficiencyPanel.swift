//
//  EfficiencyPanel.swift
//  TeslaSync — P4 feature view · 0102 · EfficiencyPanel (Apple)
//
//  The composable Charging Efficiency feature view — the SwiftUI parity of
//  features/charging/components/charging-list/EfficiencyPanel.tsx. Renders the titled
//  glass panel (the Activity-icon header + the "wall-to-battery energy conversion"
//  hint with the session count) wrapping the four metric tiles (Average Efficiency,
//  Best Session, Worst Session, Wall-to-Battery Loss), bound through
//  `EfficiencyPanelModel` (P1/S8). No networking lives here. The web component is a
//  presentational leaf its parent renders only when stats exist; this surface adds the
//  Apple HIG states contract around that rendering — a skeleton on the initial fetch, a
//  friendly empty rendering, a QueryError-equivalent failure with retry, and a freshness
//  chip + banner that keep the last-known tiles visible while reconnecting or offline.
//

import SwiftUI

/// The composable Charging Efficiency surface — the SwiftUI parity of
/// `features/charging/components/charging-list/EfficiencyPanel.tsx`, binding through
/// `EfficiencyPanelModel` (P1/S8). No networking lives here.
public struct EfficiencyPanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "EfficiencyPanel"

    @State private var model: EfficiencyPanelModel

    public init(model: EfficiencyPanelModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                EfficiencyPanelHeader(count: model.headerCount, connection: model.connection)
                if model.connection != .live {
                    EfficiencyConnectivityBanner(connection: model.connection)
                }
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            EfficiencyLoadingGrid()
        case .empty:
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                EfficiencyMetricsGrid(metrics: model.metrics)
                EfficiencyEmptyHint()
            }
        case let .error(message):
            EfficiencyErrorView(message: message) { model.refresh() }
        case .content:
            EfficiencyMetricsGrid(metrics: model.metrics)
        }
    }
}
