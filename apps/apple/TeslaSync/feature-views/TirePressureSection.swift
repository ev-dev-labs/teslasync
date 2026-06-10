//
//  TirePressureSection.swift
//  TeslaSync — P4 feature view · 0299 · TirePressureSection (Apple)
//
//  The composable vehicle-detail "Tire Pressure" surface — the SwiftUI parity of
//  web/src/features/vehicles/components/vehicle-detail/TirePressureSection.tsx. Renders
//  inside a GlassPanel fading in on appear (web `GlassPanel` + the page's `FadeIn`), and
//  switches over the bound model's phase so every prompt-required state renders (loading
//  / empty / error / stale / offline / content) — never a blank box. Binds through
//  `TirePressureSectionModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable vehicle-detail Tire Pressure grid — the SwiftUI parity of the web
/// `TirePressureSection`, binding through `TirePressureSectionModel` (P1/S8).
public struct TirePressureSection: View {
    @State private var model: TirePressureSectionModel

    public init(model: TirePressureSectionModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    TPSectionHeader(connection: model.connection)
                    if model.connection != .live {
                        TPSectionConnectivityBanner(connection: model.connection)
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

    /// The web `tireData ? <grid> : <EmptyState>` branch, widened to the full load
    /// envelope (loading / error / empty / content) so no state is hidden behind a blank
    /// panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            TPSectionLoading()
        case let .error(message):
            TPSectionError(message: message) { model.refresh() }
        case .empty:
            TPSectionEmpty()
        case .content:
            TPSectionGrid(projection: model.projection)
        }
    }
}
