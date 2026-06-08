//
//  ChargerSpecsPanel.swift
//  TeslaSync — P4 feature view · 0098 · ChargerSpecsPanel (Apple)
//
//  The composable "Charger Specs Breakdown" feature view — the SwiftUI parity of
//  features/charging/components/charging-list/ChargerSpecsPanel.tsx. Renders every state from the
//  web source (the populated four-column grid, each column's own empty message, and the panel
//  empty state) plus the native query lifecycle the web parent owns (loading / error / stale /
//  offline), bound through `ChargerSpecsPanelModel` (P1/S8). No networking lives here; the
//  freshness chip + banner reflect the bound source's live-state.
//

import SwiftUI

/// The composable Charger Specs Breakdown surface — the SwiftUI parity of
/// `features/charging/components/charging-list/ChargerSpecsPanel.tsx`, binding through
/// `ChargerSpecsPanelModel` (P1/S8). No networking lives here.
public struct ChargerSpecsPanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ChargerSpecsPanelSurface.slug

    @State private var model: ChargerSpecsPanelModel

    public init(model: ChargerSpecsPanelModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                if model.connection != .live {
                    ChargerSpecsConnectivityBanner(connection: model.connection)
                }
                content
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    /// The panel heading (web `<h3 className="section-title">` with the lucide `Gauge`) plus the
    /// trailing freshness chip.
    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Image(systemName: "gauge.with.dots.needle.bottom.50percent")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.chartSeriesPower)
                .accessibilityHidden(true)
            ChargerSpecsStrings.text("charging.specs.title", "Charger Specs Breakdown")
                .font(Font.TS.panel)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
            ChargerSpecsFreshnessChip(connection: model.connection)
        }
    }

    /// The mutually-exclusive render branches the surface switches over.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ChargerSpecsLoadingGrid()
        case .empty:
            ChargerSpecsEmptyState()
        case let .error(message):
            ChargerSpecsErrorState(message: message) { model.refresh() }
        case .content:
            if let projection = model.projection {
                ChargerSpecsGrid(projection: projection)
            } else {
                ChargerSpecsEmptyState()
            }
        }
    }
}
