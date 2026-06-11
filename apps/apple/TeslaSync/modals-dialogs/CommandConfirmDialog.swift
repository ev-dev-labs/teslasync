//
//  CommandConfirmDialog.swift
//  TeslaSync — P4 modal / dialog · 0029 · CommandConfirmDialog (Apple)
//
//  The command-confirmation dialog — the SwiftUI parity of
//  features/system/components/CommandConfirmDialog.tsx. The web source is a focus-trapped, red-bordered
//  `Modal` that gates a (usually destructive) vehicle command: a warning glyph + the command label, the
//  "Are you sure?"-style message, an optional live countdown that ticks the Confirm button before it
//  can be pressed, an optional "type the word to confirm" gate, and Cancel / Confirm affordances that
//  disable + show a spinner while the parent's dispatch is in flight. It renders nothing when there is
//  no command awaiting confirmation. The native surface switches over the model's resolved
//  `visibility` so that early-return is reproduced (hidden vs the presented panel, faded in), and the
//  presented panel switches over the body phase so every prompt-required state renders (loading /
//  empty / error / content) — never a blank box. All data + presentation lives in
//  `CommandConfirmModel` (P1/S8); no networking or command dispatch here.
//

import SwiftUI

/// The command-confirmation dialog, binding through `CommandConfirmModel` (P1/S8).
public struct CommandConfirmDialog: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = CommandConfirmSurface.slug

    @State private var model: CommandConfirmModel

    public init(model: CommandConfirmModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .onAppear { model.start() }
            .onDisappear { model.stop() }
    }

    /// The web early-return resolved to a rendered surface: nothing while hidden (web `null` — no
    /// pending command), else the presented panel faded in (web `Modal` content).
    @ViewBuilder
    private var content: some View {
        switch model.visibility {
        case .hidden:
            EmptyView()
        case .presented:
            TSFadeIn(delay: 0.05) {
                CommandConfirmPanel(model: model)
            }
        }
    }
}
