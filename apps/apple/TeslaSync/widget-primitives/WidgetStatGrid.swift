//
//  WidgetStatGrid.swift
//  TeslaSync — P4 widget primitive · 0010 · WidgetStatGrid (Apple)
//
//  The public API of the stat grid — the SwiftUI parity of
//  `features/dashboard/widgets/shared/WidgetStatGrid.tsx`. Like the web component it is driven entirely by
//  its props (`stats`, the optional `compact` / `cols`); there is no fetcher. The view binds through
//  ``WidgetStatGridModel`` for the derived projection + the once-only `view.opened` telemetry (P1/S11),
//  composes the token-driven grid (P1/S9), and pushes prop changes into the holder via `.onChange` so a
//  reused / rebound grid re-renders faithfully. No networking, no Tailwind ports.
//

import SwiftUI

/// The stat grid — the SwiftUI parity of `WidgetStatGrid.tsx`. Renders a responsive grid of stat cells
/// (each a label, the formatted value with an optional unit, an optional icon, and an optional direction-
/// aware trend chip), collapsing to a single column when `compact`, choosing 2/3/4 columns from the stat
/// count (or an explicit `cols`), and falling back to a friendly empty leaf when there is nothing to show.
/// A shared widget building block — mount it inside a dashboard widget that supplies the already-formatted,
/// already-converted stats.
public struct WidgetStatGrid: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = WidgetStatGridSurface.slug

    private let input: WidgetStatGridInput
    @State private var model: WidgetStatGridModel

    /// The prop-style initializer — the parity of `<WidgetStatGrid stats compact cols />`. `stats` are the
    /// already-formatted, already-converted cells; `compact` (default `false`) collapses to one column;
    /// `cols` (default `nil`) overrides the auto column count, exactly like the web `cols ?? autoCols(…)`.
    public init(
        stats: [StatGridItem],
        compact: Bool = false,
        cols: StatGridColumns? = nil,
        telemetry: any WidgetStatGridTelemetry = OSLogWidgetStatGridTelemetry()
    ) {
        let resolved = WidgetStatGridInput(stats: stats, compact: compact, cols: cols)
        input = resolved
        _model = State(initialValue: WidgetStatGridModel(input: resolved, telemetry: telemetry))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded input).
    public init(model: WidgetStatGridModel) {
        input = model.input
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .onChange(of: input) { _, newInput in
                model.update(newInput)
            }
    }

    /// The resolved grid or the empty leaf — the native peer of the web render decision
    /// (`stats.length === 0 ? <EmptyState/> : <div className="grid …">…`).
    @ViewBuilder
    private var content: some View {
        switch model.projection {
        case .empty:
            WidgetStatGridEmptyState()
        case let .populated(layout):
            StatGridLayoutView(layout: layout)
        }
    }
}
