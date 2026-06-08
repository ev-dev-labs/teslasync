//
//  FSMStateDiagram.swift
//  TeslaSync — P4 feature view · 0229 · FSMStateDiagram (Apple)
//
//  The composable FSM state-diagram feature view — the SwiftUI parity of
//  web/src/features/system/components/FSMStateDiagram.tsx. The web `{ fsmType,
//  transitions }` props plus the parent FSM-debugger page's lifecycle bind through
//  `FSMStateDiagramModel` (P1/S8); the surface renders the panel header, the optional
//  connectivity banner, and the phase body (loading / empty / error / data), and emits
//  the P1/S11 `view.opened` event with the slug `FSMStateDiagram` on appear. No
//  networking lives in the view.
//

import SwiftUI

/// Native, Apple-idiomatic parity of the web `FSMStateDiagram`: the state-machine diagram
/// for one FSM type. Renders every state the web source has (the empty "select an FSM"
/// surface + the node/edge diagram) plus the P4 leaf contract (loading / error and the
/// orthogonal live / stale / offline connectivity axis).
public struct FSMStateDiagram: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = FSMStateDiagramDiagnostics.surface

    @State private var model: FSMStateDiagramModel

    /// The canonical binding: the data hook binds through its P1/S8 model.
    public init(model: FSMStateDiagramModel) {
        _model = State(initialValue: model)
    }

    /// Web-prop binding: mirrors the web `{ fsmType, transitions }` props plus the parent
    /// leaf lifecycle (loading / error / connectivity), wiring an in-memory model.
    public init(
        fsmType: String,
        transitions: [FSMTransition],
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: FSMConnection = .live,
        telemetry: any FSMStateDiagramTelemetry = OSLogFSMStateDiagramTelemetry()
    ) {
        let input = FSMStateDiagramInput(
            fsmType: fsmType,
            transitions: transitions,
            isLoading: isLoading,
            errorMessage: errorMessage,
            connection: connection
        )
        _model = State(initialValue: FSMStateDiagramModel(input: input, telemetry: telemetry))
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                FSMDiagramHeader(connection: model.connection)
                if model.connection != .live {
                    FSMConnectivityBanner(connection: model.connection) { model.refresh() }
                }
                FSMDiagramContent(resolved: model.resolved) { model.refresh() }
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: FSMStateDiagramStrings.string("fsm.stateDiagram", "State Diagram")))
    }
}
