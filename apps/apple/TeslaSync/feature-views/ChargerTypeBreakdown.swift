//
//  ChargerTypeBreakdown.swift
//  TeslaSync — P4 feature view · 0108 · ChargerTypeBreakdown (Apple)
//
//  The "Cost by Charger Type" feature view — the SwiftUI parity of the web
//  features/charging/components/cost-analysis/ChargerTypeBreakdown.tsx. Renders the
//  titled glass panel (Zap header), the cost donut + per-type breakdown bars, and
//  every state (loading / loaded / empty / error / stale / offline), binding
//  through `ChargerTypeModel` (P1/S8). No networking lives here — the web component
//  takes `data` + `totalCost` as props; the native model is fed by a
//  `ChargerTypeSource`.
//

import SwiftUI

// MARK: - ChargerTypeBreakdown (the feature surface)

/// The cost-by-charger-type section. Switches over the model's render phase and,
/// in the loaded phase, shows an optional freshness banner above the panel; the
/// panel itself self-empties (web `data.length > 0 ? … : noData`) rather than
/// hiding, matching the web.
public struct ChargerTypeBreakdown: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ChargerTypeBreakdown"

    @State private var model: ChargerTypeModel

    /// - Parameter model: the bound view-model (built over a `ChargerTypeSource`).
    public init(model: ChargerTypeModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(verbatim: model.localize(
                "costAnalysis.chargerType.a11y",
                "Cost by charger type"
            )))
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ChargerTypeSkeleton(localize: model.localize)
        case let .error(message):
            ChargerTypeErrorView(message: message, localize: model.localize) { model.refresh() }
        case .loaded:
            loadedContent
        }
    }

    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if model.connection != .live {
                ChargerTypeFreshnessBanner(connection: model.connection, localize: model.localize) {
                    model.refresh()
                }
            }
            ChargerTypeGlassPanel(title: model.localize("costAnalysis.chargerType.title", "Cost by Charger Type")) {
                if model.isEmpty {
                    ChargerTypeEmptyState(message: model.localize("costAnalysis.charts.noData", "Not enough data"))
                } else {
                    ChargerTypeBreakdownContent(
                        rows: model.rows,
                        title: model.localize("costAnalysis.chargerType.title", "Cost by Charger Type"),
                        localize: model.localize,
                        formatting: model.formatting
                    )
                }
            }
        }
    }
}
