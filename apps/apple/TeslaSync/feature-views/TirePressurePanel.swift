//
//  TirePressurePanel.swift
//  TeslaSync — P4 feature view · 0286 · TirePressurePanel (Apple)
//
//  The composable telemetry-panels "Tire Pressure" surface — the SwiftUI parity of
//  web/src/features/vehicles/components/telemetry-panels/TirePressurePanel.tsx. Renders
//  inside a GlassPanel fading in on appear (web `GlassPanel` + the page's `FadeIn`), and
//  switches over the bound model's phase so every prompt-required state renders (loading /
//  empty / error / stale / offline / content) — never a blank box. Binds through
//  `TirePressurePanelModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable telemetry-panels Tire Pressure grid — the SwiftUI parity of the web
/// `TirePressurePanel`, binding through `TirePressurePanelModel` (P1/S8).
public struct TirePressurePanel: View {
    @State private var model: TirePressurePanelModel

    public init(model: TirePressurePanelModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    TPPanelHeader(connection: model.connection)
                    if model.connection != .live {
                        TPPanelConnectivityBanner(connection: model.connection)
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

    /// The web `tireData ? <grid + summary chip> : <empty text>` branch, widened to the full
    /// load envelope (loading / error / empty / content) so no state is hidden behind a
    /// blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            TPPanelLoading()
        case let .error(message):
            TPPanelError(message: message) { model.refresh() }
        case .empty:
            TPPanelEmpty()
        case .content:
            TPPanelContent(projection: model.projection)
        }
    }
}
