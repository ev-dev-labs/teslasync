//
//  ChartLegend.swift
//  TeslaSync — P4 shared surface · 0068 · ChartLegend (Apple)
//
//  The chart legend — the SwiftUI parity of `components/charts/ChartLegend.tsx`. The web component is
//  a Recharts `<Legend>` wrapper whose toggle source is `useChartHiddenSeries` (a `HiddenSeriesState`
//  or `null`): clicking an entry toggles its series, hidden entries render dimmed + struck-through,
//  and with no toggle source it renders passively. This native surface reproduces that composition —
//  the swatch + value entries, the dim + strike, the tap-to-toggle, the passive branch — binding
//  through `ChartLegendModel` (P1/S8); no networking lives in the view.
//
//  States (every one renders — no hidden surface):
//    • loading   — series resolving (parent chart fetch) → skeleton chrome.
//    • error     — fetch failed → a `QueryError` peer with retry.
//    • empty     — resolved + no series, `.emptyState` policy → friendly empty state (P4 default).
//    • withdrawn — resolved + no series, `.withdraw` policy → nothing (Recharts empty-payload peer).
//    • populated — the entries (interactive: tap-to-toggle + dim hidden / passive: static), decorated
//                  by the P4 freshness axis (stale / offline).
//

import SwiftUI

// MARK: - ChartLegend (the shared surface)

/// The chart legend — the SwiftUI parity of `components/charts/ChartLegend.tsx`. Renders every state
/// plus the P4 leaf freshness axis, binding through `ChartLegendModel`.
public struct ChartLegend: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ChartLegendMeta.surfaceSlug

    @State private var model: ChartLegendModel

    public init(model: ChartLegendModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the production series-backed source — the parity of mounting
    /// `<ChartLegend state={…} />` under a chart. `input` is the host's current series snapshot
    /// (Recharts legend payload) plus the connectivity / interactivity / alignment axes; `onToggle`
    /// is the web `resolved.toggle` bridge (the host persists to URL / localStorage); `initialHidden`
    /// seeds the owned hidden set (the native `useChartHiddenSeries` `hidden`).
    public init(
        input: ChartLegendInput,
        initialHidden: Set<String> = [],
        onToggle: (@MainActor (String) -> Void)? = nil
    ) {
        _model = State(initialValue: ChartLegendModel(
            source: LiveChartLegendSource(input: input),
            onToggle: onToggle,
            initialHidden: initialHidden
        ))
    }

    public var body: some View {
        ZStack {
            if case .withdrawn = model.resolved.phase {
                // Recharts renders nothing for an empty legend payload: under the `.withdraw` policy
                // an empty legend collapses to nothing (for chart-embedded use).
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
            ChartLegendLoadingView()
        case let .error(errorContent):
            ChartLegendErrorView(content: errorContent) { model.refresh() }
        case let .empty(empty):
            ChartLegendEmptyView(content: empty)
        case .withdrawn:
            EmptyView()
        case let .populated(rows):
            ChartLegendPopulatedView(
                legendAccessibilityLabel: model.resolved.legendAccessibilityLabel,
                alignment: model.resolved.alignment,
                freshness: model.resolved.freshness,
                rows: rows,
                onRefresh: { model.refresh() },
                onToggle: { model.toggle($0) }
            )
        }
    }
}
