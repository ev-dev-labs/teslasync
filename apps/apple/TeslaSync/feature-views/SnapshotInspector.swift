//
//  SnapshotInspector.swift
//  TeslaSync — P4 feature view · 0234 · SnapshotInspector (Apple)
//
//  The FSM-debugger snapshot inspector — the SwiftUI parity of
//  features/system/components/state-machine/SnapshotInspector.tsx. The web component is
//  the debugger's right rail: given a selected transition + its signal snapshot (and the
//  previous snapshot for diff mode) it renders the from/to/trigger/duration header and a
//  sorted, source-annotated list of signal values, or one of its empty branches. This
//  surface binds through `SnapshotInspectorModel` (P1/S8) and switches over the resolved
//  phase so every prompt-required state renders — loading / content / empty (no-selection
//  + outside-window) / error, with the stale + offline freshness chip — never a blank box.
//  No networking lives here.
//
//  States (every one renders):
//    • loading       — first fetch → web "Loading…".
//    • snapshot      — a transition is selected → the populated detail.
//    • outsideWindow — empty window but a later transition exists → jump affordance.
//    • noSelection   — nothing selected → web "Select a transition…".
//    • error         — fetch failed, nothing cached → retry (web `QueryError` peer).
//    • stale/offline — the orthogonal freshness axis → header chip + one-shot auto-refresh.
//

import SwiftUI

/// The FSM-debugger snapshot inspector — the SwiftUI parity of the web
/// `SnapshotInspector`, binding through `SnapshotInspectorModel` (P1/S8).
public struct SnapshotInspector: View {
    @State private var model: SnapshotInspectorModel

    public init(model: SnapshotInspectorModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        @Bindable var model = model
        return TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                if model.connection != .live {
                    HStack {
                        Spacer(minLength: 0)
                        SnapshotInspectorFreshnessChip(connection: model.connection)
                    }
                }
                content(diffMode: $model.diffMode)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    /// Switches over the resolved phase. Every case renders real chrome (no hidden surface).
    @ViewBuilder
    private func content(diffMode: Binding<Bool>) -> some View {
        switch model.phase {
        case .loading:
            SnapshotInspectorLoadingState()
        case let .snapshot(content):
            SnapshotInspectorDetail(content: content, diffMode: diffMode)
        case let .outsideWindow(relative):
            SnapshotInspectorOutsideWindowState(relative: relative) { model.jumpToLastTransition() }
        case .noSelection:
            SnapshotInspectorNoSelectionState()
        case let .error(message):
            SnapshotInspectorErrorState(message: message) { model.refresh() }
        }
    }
}

// MARK: - Surface identity

public extension SnapshotInspector {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        SnapshotInspectorSurface.slug
    }
}
