//
//  WidgetStatusGrid.swift
//  TeslaSync — P4 widget primitive · 0011 · WidgetStatusGrid (Apple)
//
//  The public API of the status grid — the SwiftUI parity of
//  `features/dashboard/widgets/shared/WidgetStatusGrid.tsx`. Like the web component it is driven entirely by
//  its props (`cells`, the optional `cols` / `compact` / `emptyMessage` / `emptyIcon`); there is no fetcher.
//  The view binds through ``WidgetStatusGridModel`` for the derived projection + the once-only `view.opened`
//  telemetry (P1/S11), composes the token-driven grid (P1/S9), and pushes prop changes into the holder via
//  `.onChange` so a reused / rebound grid re-renders faithfully. No networking, no Tailwind ports.
//

import SwiftUI

/// The status grid — the SwiftUI parity of `WidgetStatusGrid.tsx`. Renders a responsive grid of status
/// chips (each a tone-tinted rounded border with a corner status dot, an optional leading icon, a label,
/// and — outside compact mode — a value line), collapsing its column count by the widget's own rendered
/// width, and falling back to a friendly empty leaf when there are no cells. A shared widget building block —
/// mount it inside a dashboard widget that supplies the already-localized, already-resolved cells.
public struct WidgetStatusGrid: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = WidgetStatusGridSurface.slug

    private let input: WidgetStatusGridInput
    @State private var model: WidgetStatusGridModel

    /// The prop-style initializer — the parity of `<WidgetStatusGrid cells cols compact emptyMessage
    /// emptyIcon />`. `cells` are the already-localized status cells; `columns` (default `.two`) is the web
    /// `cols`; `compact` (default `false`) forces two columns, suppresses the value line, and tightens the
    /// padding; `emptyMessage` overrides the empty-leaf headline (the web default resolves through the
    /// facade); `emptySystemImage` is the empty-leaf glyph (web `emptyIcon`).
    public init(
        cells: [StatusCell],
        columns: StatusGridColumns = .two,
        compact: Bool = false,
        emptyMessage: String? = nil,
        emptySystemImage: String = WidgetStatusGridInput.defaultEmptySystemImage,
        telemetry: any WidgetStatusGridTelemetry = OSLogWidgetStatusGridTelemetry()
    ) {
        let resolved = WidgetStatusGridInput(
            cells: cells,
            columns: columns,
            compact: compact,
            emptyMessage: emptyMessage,
            emptySystemImage: emptySystemImage
        )
        input = resolved
        _model = State(initialValue: WidgetStatusGridModel(input: resolved, telemetry: telemetry))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded input).
    public init(model: WidgetStatusGridModel) {
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
    /// (`cells.length === 0 ? <EmptyState/> : <div className="grid">…`).
    @ViewBuilder
    private var content: some View {
        switch model.projection {
        case .empty:
            WidgetStatusGridEmptyState(
                message: model.resolvedEmptyMessage,
                systemImage: input.emptySystemImage
            )
        case let .populated(cells, columns):
            WidgetStatusGridContent(cells: cells, columns: columns, compact: input.compact)
        }
    }
}
