//
//  ClimatePanel.swift
//  TeslaSync — P4 feature view · 0278 · ClimatePanel (Apple)
//
//  The composable ClimatePanel feature view — the SwiftUI parity of
//  features/vehicles/components/telemetry-panels/ClimatePanel.tsx. A glass panel with the
//  "Climate" title and the climate readout (Cabin / Outside temperature cards, Driver / Passenger
//  setpoint rows, HVAC State, a six-bar Fan Speed meter, and the Defrost / Climate / Precondition
//  badges), binding through `CabinClimatePanelModel` (P1/S8). No networking lives here. Reproduces
//  every state from the web source — the `climateData` content branch and the `EmptyState` —
//  extended with the Apple HIG states contract: a loading skeleton, a QueryError-equivalent
//  failure with retry, and a freshness chip + stale/offline banner that keep the last-known
//  snapshot visible while reconnecting (stale) or offline. Emits the P1/S11 `view.opened`
//  diagnostics event on appear.
//
//  Naming note: the supporting types use the `CabinClimatePanel*` prefix to avoid colliding with
//  the dashboard widget `ClimateControlPanelWidget`, which already owns the `ClimatePanel*` prefix
//  in the shared module. The public entry point is this `ClimatePanel` view; the diagnostics slug
//  is "ClimatePanel".
//

import SwiftUI

/// The composable ClimatePanel surface — the SwiftUI parity of the web `ClimatePanel`, binding
/// through `CabinClimatePanelModel` (P1/S8). No networking lives here.
public struct ClimatePanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        ClimatePanelSurface.slug
    }

    @State private var model: CabinClimatePanelModel

    public init(model: CabinClimatePanelModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    CabinClimatePanelHeader(
                        connection: model.connection,
                        showsFreshness: model.showsFreshness
                    )
                    content
                }
                .frame(maxWidth: .infinity, alignment: .leading)
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
            CabinClimatePanelLoadingContent()
        case let .error(message):
            CabinClimatePanelErrorView(message: message) { model.refresh() }
        case .empty:
            CabinClimatePanelEmptyState()
        case .content:
            CabinClimatePanelContentView(
                content: model.content,
                connection: model.connection,
                onRefresh: { model.refresh() }
            )
        }
    }
}
