//
//  AreaChartWrapper.swift
//  TeslaSync — P4 shared surface · 0064 · AreaChartWrapper (Apple)
//
//  The gradient area chart — the SwiftUI parity of `components/charts/AreaChartWrapper.tsx`. The web
//  component is a reusable, purely-presentational chart: it takes a `data` matrix, an `xKey`, a list of
//  `series` ({ key, label, color }), an optional `height`, and optional `xFormatter` / `yFormatter`,
//  then renders one monotone gradient-filled `<Area>` per series over a shared cartesian grid with a
//  hover tooltip. This native surface reproduces that composition — the per-series monotone areas with
//  their 0.3→0 gradient fills + 2pt strokes, the formatted x / y axes, the scrub tooltip — binding
//  through `AreaChartWrapperModel` (P1/S8); no networking lives in the view. Because the web component
//  itself ships no loading / empty / error chrome (its host owns that), this standalone surface adds
//  the P4 leaf states so it is never a blank box.
//
//  States (every one renders — no hidden surface):
//    • loading   — data resolving (host fetch) → skeleton chart.
//    • error     — fetch failed → a `QueryError` peer with retry.
//    • empty     — resolved + nothing to chart, `.emptyState` policy → friendly empty state (P4
//                  default).
//    • withdrawn — resolved + nothing to chart, `.withdraw` policy → nothing (host hides the region).
//    • populated — the gradient area chart, decorated by the P4 freshness axis (stale / offline).
//

import SwiftUI

// MARK: - AreaChartWrapper (the shared surface)

/// The gradient area chart — the SwiftUI parity of `components/charts/AreaChartWrapper.tsx`. Renders
/// every state plus the P4 leaf freshness axis, binding through `AreaChartWrapperModel`.
public struct AreaChartWrapper: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = AreaChartMeta.surfaceSlug

    @State private var model: AreaChartWrapperModel

    public init(model: AreaChartWrapperModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the production payload-backed source — the parity of mounting
    /// `<AreaChartWrapper data={…} xKey={…} series={…} … />`. `input` is the host's current payload
    /// (web `data` + `series` + `height` + formatters) plus the connectivity axis; the feed is local +
    /// synchronous (no HTTP in the view).
    public init(input: AreaChartInput) {
        _model = State(initialValue: AreaChartWrapperModel(
            source: LiveAreaChartSource(input: input)
        ))
    }

    public var body: some View {
        ZStack {
            if case .withdrawn = model.resolved.phase {
                // The host hides the whole region when there is nothing to chart under the `.withdraw`
                // policy (the web component embedded in a host that conditionally renders it).
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
            AreaChartLoadingView(height: model.resolved.height)
        case let .error(errorContent):
            AreaChartErrorView(content: errorContent) { model.refresh() }
        case let .empty(empty):
            AreaChartEmptyView(content: empty, height: model.resolved.height)
        case .withdrawn:
            EmptyView()
        case let .populated(plot):
            AreaChartPopulatedView(
                chartAccessibilityLabel: model.resolved.chartAccessibilityLabel,
                plot: plot,
                height: model.resolved.height,
                freshness: model.resolved.freshness,
                onRefresh: { model.refresh() }
            )
        }
    }
}
