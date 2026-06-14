//
//  WidgetFlowDiagram.swift
//  TeslaSync — P4 widget primitive · 0006 · WidgetFlowDiagram (Apple)
//
//  The public API of the flow-diagram widget primitive — the SwiftUI parity of
//  `features/dashboard/widgets/shared/WidgetFlowDiagram.tsx`. Like the web component it is driven entirely
//  by its props (`nodes`, `arrows`, `compact`, `emptyMessage`); there is no fetcher. The view binds through
//  ``WidgetFlowDiagramModel`` for the derived projection + the once-only `view.opened` telemetry (P1/S11),
//  composes the token-driven canvas (P1/S9) — arrows behind animated node chips drawn against the web's
//  fixed `100 × 100` viewBox scaled uniformly to the live size — and pushes prop changes into the holder
//  via `.onChange` so a reused / rebound diagram re-renders faithfully. No networking, no Tailwind ports.
//

import SwiftUI

/// The flow-diagram widget primitive — the SwiftUI parity of `WidgetFlowDiagram.tsx`. Renders, faithfully
/// to the web source, either the friendly empty leaf (web `nodes.length === 0` → `<EmptyState
/// message={emptyMessage} />`) or the populated graph (web `<svg>`): magnitude-scaled, sign-toned edges —
/// animated marching-ants for the active ones — behind circular node chips that show an animated value and
/// a label. A shared widget building block: mount it inside a dashboard widget that supplies the nodes +
/// arrows (e.g. the energy / power-flow widgets).
///
/// The view emits the P1/S11 `view.opened` diagnostic once on appear and binds no data (the hosting widget
/// supplies every input), matching the web presentational component.
public struct WidgetFlowDiagram: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        WidgetFlowDiagramSurface.slug
    }

    private let input: WidgetFlowInput
    private let emptyMessage: String?
    @State private var model: WidgetFlowDiagramModel

    /// The prop-style initializer — the parity of `<WidgetFlowDiagram nodes arrows compact emptyMessage />`.
    /// `nodes` / `arrows` are the graph; `compact` (default `false`) selects the dense variant; `emptyMessage`
    /// overrides the empty-leaf copy (the web default is resolved through the P1/S10 facade when `nil`).
    public init(
        nodes: [FlowNode],
        arrows: [FlowArrow],
        compact: Bool = false,
        emptyMessage: String? = nil,
        telemetry: any WidgetFlowDiagramTelemetry = OSLogWidgetFlowDiagramTelemetry()
    ) {
        let resolved = WidgetFlowInput(nodes: nodes, arrows: arrows, compact: compact)
        input = resolved
        self.emptyMessage = emptyMessage
        _model = State(initialValue: WidgetFlowDiagramModel(input: resolved, telemetry: telemetry))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded input).
    public init(model: WidgetFlowDiagramModel, emptyMessage: String? = nil) {
        input = model.input
        self.emptyMessage = emptyMessage
        _model = State(initialValue: model)
    }

    public var body: some View {
        contentView
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .onChange(of: input) { _, newInput in
                model.update(newInput)
            }
    }

    /// The empty leaf or the populated graph — the native peer of the web render decision
    /// (`nodes.length === 0 ? <EmptyState/> : <svg/>`).
    @ViewBuilder
    private var contentView: some View {
        switch model.projection {
        case .empty:
            WidgetFlowDiagramEmptyState(message: resolvedEmptyMessage)
        case let .diagram(canvas):
            WidgetFlowDiagramCanvasView(canvas: canvas)
        }
    }

    /// Web `emptyMessage = 'No flow data available'` — the override falls back to the P1/S10 facade.
    private var resolvedEmptyMessage: String {
        emptyMessage ?? WidgetFlowDiagramStrings.emptyMessage
    }
}
