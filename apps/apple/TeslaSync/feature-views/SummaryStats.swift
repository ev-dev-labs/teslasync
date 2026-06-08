//
//  SummaryStats.swift
//  TeslaSync — P4 feature view · 0175 · SummaryStats (Apple)
//
//  The composable driving-dynamics summary stats grid — the SwiftUI parity of
//  features/driving/components/driving-dynamics/SummaryStats.tsx. Binds through
//  `DynamicsSummaryStatsModel` (no networking in the view) and renders the six metric
//  tiles (Total Readings · Avg Torque · Peak Power · Peak Regen · Avg Power · Avg Motor
//  Temp) inside the shared fade-in + stagger. Each tile renders the in-flight skeleton
//  while loading, the resolved value otherwise, and — for the temperature tile — the
//  web em-dash sentinel when `motorStats` is null.
//
//  The web component is a pure presentational leaf fed by its parent (the Driving
//  Dynamics page), so the page-level error / empty / stale / offline lifecycle chrome
//  is owned by the parent surface and is intentionally not duplicated at this leaf; a
//  null `motorStats` renders zeros (and the temperature em-dash), exactly as the web
//  `stats?.x ?? 0` / `stats ? … : '—'` fallbacks do.
//

import SwiftUI

/// The composable driving-dynamics summary stats grid — the SwiftUI parity of
/// `features/driving/components/driving-dynamics/SummaryStats.tsx`. Renders the six
/// summary tiles and their loading / value / em-dash branches, binding through
/// `DynamicsSummaryStatsModel` (P1/S8). No networking lives here.
public struct SummaryStats: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "SummaryStats"

    @State private var model: DynamicsSummaryStatsModel

    public init(model: DynamicsSummaryStatsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        SSDStatsGrid(cards: model.cards)
            .frame(maxWidth: .infinity, alignment: .leading)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .accessibilityElement(children: .contain)
    }
}
