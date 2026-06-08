//
//  BatteryHealthSection.swift
//  TeslaSync — P4 feature view · 0072 · BatteryHealthSection (Apple)
//
//  The composable weekly-digest Battery Health section — the SwiftUI parity of
//  features/analytics/components/weekly-digest/BatteryHealthSection.tsx. Binds through
//  `BatteryHealthModel` (no networking in the view) and renders every state the P4
//  surface contract requires: loading · error · empty · data (two battery pills above
//  three range stats) plus the stale / offline overlays. The always-visible header
//  sits above the state body, exactly like the web `GlassPanel` title row.
//

import SwiftUI

/// The composable weekly-digest Battery Health section — the SwiftUI parity of
/// `features/analytics/components/weekly-digest/BatteryHealthSection.tsx`. Renders
/// every state from the surface contract, binding through `BatteryHealthModel`
/// (P1/S8). No networking lives here.
public struct BatteryHealthSection: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "BatteryHealthSection"

    @State private var model: BatteryHealthModel

    public init(model: BatteryHealthModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.2) {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                BHSectionHeader(
                    isFetching: model.isFetching,
                    isStale: model.isStale,
                    isOffline: model.isOffline
                )
                stateBody
            }
            .padding(TSSpacing.x2xl)
            .frame(maxWidth: .infinity, alignment: .leading)
            .tsGlassPanel()
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var stateBody: some View {
        switch model.phase {
        case .loading:
            BHLoadingBody()
        case let .error(message):
            BHErrorBody(message: message) { model.refresh() }
        case .empty:
            BHEmptyBody()
        case .data:
            BHDataBody(pills: model.pills, stats: model.stats)
        }
    }
}
