//
//  SummaryStatsGrid.swift
//  TeslaSync — P4 feature view · 0093 · SummaryStatsGrid (Apple)
//
//  The composable charging-curve summary stats grid — the SwiftUI parity of
//  features/charging/components/charging-curve/SummaryStatsGrid.tsx. Binds through
//  `SummaryStatsGridModel` (no networking in the view) and renders the six metric
//  cards (Total Sessions · Total Energy · Avg Charge Rate · Peak Rate · Avg Duration ·
//  Total Cost) inside the shared fade-in. Each card renders the web `SummaryCard`
//  loading skeleton while its value is in flight and the resolved value otherwise.
//
//  The web component is a pure presentational leaf fed by its parent (the
//  ChargingCurve page), so the page-level error / empty / stale / offline lifecycle
//  chrome is owned by the parent surface and is intentionally not duplicated at this
//  leaf; a null `stats` renders zeros, exactly as the web `stats?.x ?? 0` fallbacks do.
//

import SwiftUI

/// The composable charging-curve summary stats grid — the SwiftUI parity of
/// `features/charging/components/charging-curve/SummaryStatsGrid.tsx`. Renders the six
/// summary cards and their per-card loading branch, binding through
/// `SummaryStatsGridModel` (P1/S8). No networking lives here.
public struct SummaryStatsGrid: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "SummaryStatsGrid"

    @State private var model: SummaryStatsGridModel

    public init(model: SummaryStatsGridModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        SSGStatsGrid(cards: model.cards)
            .frame(maxWidth: .infinity, alignment: .leading)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .accessibilityElement(children: .contain)
    }
}
