//
//  VehicleConfigSection.swift
//  TeslaSync — P4 feature view · 0300 · VehicleConfigSection (Apple)
//
//  The composable vehicle-detail "Vehicle Configuration" surface — the SwiftUI parity of
//  web/src/features/vehicles/components/vehicle-detail/VehicleConfigSection.tsx. Renders
//  inside a GlassPanel fading in on appear (web `GlassPanel` + the page's `FadeIn`), and
//  switches over the bound model's phase so every prompt-required state renders (loading /
//  empty / error / stale / offline / content) — never a blank box. Binds through
//  `VehicleConfigSectionModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable vehicle-detail Vehicle Configuration list — the SwiftUI parity of the web
/// `VehicleConfigSection`, binding through `VehicleConfigSectionModel` (P1/S8).
public struct VehicleConfigSection: View {
    @State private var model: VehicleConfigSectionModel

    public init(model: VehicleConfigSectionModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    VCSectionHeader(connection: model.connection)
                    if model.connection != .live {
                        VCSectionConnectivityBanner(connection: model.connection)
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

    /// The web `configItems.length > 0 ? <KVList> : <Skeleton>` branch, widened to the full
    /// load envelope (loading / error / empty / content) so no state is hidden behind a blank
    /// panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            VCSectionLoading()
        case let .error(message):
            VCSectionError(message: message) { model.refresh() }
        case .empty:
            VCSectionEmpty()
        case .content:
            VCSectionGrid(projection: model.projection)
        }
    }
}
