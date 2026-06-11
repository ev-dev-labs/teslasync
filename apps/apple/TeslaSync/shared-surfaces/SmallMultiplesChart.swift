//
//  SmallMultiplesChart.swift
//  TeslaSync — P4 shared surface · 0073 · SmallMultiplesChart (Apple)
//
//  The small-multiples grid — the SwiftUI parity of `components/charts/SmallMultiplesChart.tsx`. The
//  web component renders a grid of mini line charts, one per series, each with its own y-scale so
//  disparate magnitudes don't flatten one another; cells share a crosshair (web `syncId`), each cell
//  shows a `'No data'` fallback when its series has no finite points, and cells optionally drill in
//  (web `onCellClick`). This native surface reproduces that composition — the per-cell projected +
//  downsampled line charts, the shared crosshair, the per-cell empty fallback, the tap-to-drill-in
//  — binding through `SmallMultiplesChartModel` (P1/S8); no networking lives in the view.
//
//  States (every one renders — no hidden surface):
//    • loading   — data resolving (host fetch) → skeleton grid.
//    • error     — fetch failed → a `QueryError` peer with retry.
//    • empty     — resolved + no series, `.emptyState` policy → friendly empty state (P4 default).
//    • withdrawn — resolved + no series, `.withdraw` policy → nothing (web empty-grid peer).
//    • populated — the per-cell grid (each cell: chart or per-cell `'No data'` fallback),
//                  decorated by the P4 freshness axis (stale / offline).
//

import SwiftUI

// MARK: - SmallMultiplesChart (the shared surface)

/// The small-multiples grid — the SwiftUI parity of `components/charts/SmallMultiplesChart.tsx`.
/// Renders every state plus the P4 leaf freshness axis, binding through `SmallMultiplesChartModel`.
public struct SmallMultiplesChart: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = SmallMultiplesMeta.surfaceSlug

    @State private var model: SmallMultiplesChartModel

    public init(model: SmallMultiplesChartModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the production payload-backed source — the parity of mounting
    /// `<SmallMultiplesChart data={…} series={…} onCellClick={…} />`. `input` is the host's current
    /// payload (web `data` + `series`) plus the connectivity / interactivity / layout axes;
    /// `onCellClick` is the web drill-in bridge (the host navigates to the series' detail view).
    public init(
        input: SmallMultiplesInput,
        onCellClick: (@MainActor (String) -> Void)? = nil
    ) {
        _model = State(initialValue: SmallMultiplesChartModel(
            source: LiveSmallMultiplesSource(input: input),
            onCellClick: onCellClick
        ))
    }

    public var body: some View {
        ZStack {
            if case .withdrawn = model.resolved.phase {
                // The web component renders an empty grid (nothing) when `series` is empty: under the
                // `.withdraw` policy an empty payload collapses to nothing (for chart-embedded use).
                EmptyView()
            } else {
                content
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    @ViewBuilder
    private var content: some View {
        switch model.resolved.phase {
        case .loading:
            SmallMultiplesLoadingView(layout: model.resolved.layout)
        case let .error(errorContent):
            SmallMultiplesErrorView(content: errorContent) { model.refresh() }
        case let .empty(empty):
            SmallMultiplesEmptyView(content: empty)
        case .withdrawn:
            EmptyView()
        case let .populated(cells):
            SmallMultiplesPopulatedView(
                gridAccessibilityLabel: model.resolved.gridAccessibilityLabel,
                layout: model.resolved.layout,
                freshness: model.resolved.freshness,
                cells: cells,
                onRefresh: { model.refresh() },
                onSelect: { model.selectCell($0) }
            )
        }
    }
}
