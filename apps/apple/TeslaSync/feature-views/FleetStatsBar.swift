//
//  FleetStatsBar.swift
//  TeslaSync — P4 feature view · 0123 · FleetStatsBar (Apple)
//
//  The composable dashboard fleet stats bar — the SwiftUI parity of
//  features/dashboard/components/FleetStatsBar.tsx. Switches over the bound model's
//  phase so every prompt-required state renders (loading / empty / error / stale /
//  offline / content) — never a blank box — and surfaces a stale/offline banner above
//  the cached cards while reconnecting. Binds through `FleetStatsBarViewModel` (P1/S8); no
//  networking lives here.
//

import SwiftUI

/// The composable fleet stats bar — the SwiftUI parity of the web `FleetStatsBar`,
/// binding through `FleetStatsBarViewModel` (P1/S8). The web leaf is a staggered grid of
/// five `<GlassPanel>` cards fed by `FleetStatsWidget`; this surface reproduces those
/// cards plus the parent widget's loading / empty / error / freshness lifecycle.
public struct FleetStatsBar: View {
    @State private var model: FleetStatsBarViewModel

    public init(model: FleetStatsBarViewModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live {
                FleetStatsConnectivityBanner(connection: model.connection)
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web five-card grid, widened to the full load envelope (loading / error /
    /// empty / content) so no state is hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            FleetStatsLoadingRow()
        case let .error(message):
            FleetStatsError(message: message) { model.refresh() }
        case .empty:
            FleetStatsEmpty()
        case .content:
            FleetStatsContentRow(cards: model.cards)
        }
    }
}
