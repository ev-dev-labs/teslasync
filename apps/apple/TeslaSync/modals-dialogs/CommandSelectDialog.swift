//
//  CommandSelectDialog.swift
//  TeslaSync — P4 modal / dialog · 0031 · CommandSelectDialog (Apple)
//
//  The command option-picker dialog — the SwiftUI parity of
//  features/system/components/CommandSelectDialog.tsx. The web source is a focus-trapped `Modal`
//  (`size="sm"`) for a vehicle command that carries a `selectConfig`: a header (the command icon +
//  its translated label) over a vertical list of option buttons (each an already-translated label +
//  an optional description) and a trailing Cancel. Every option is disabled while the parent's
//  command dispatch is in flight (`loading`); tapping one fires `onSelect(value)`, and Cancel /
//  Escape fire `onClose`. The native surface switches over the model's resolved `visibility` so the
//  web early-return is reproduced (hidden vs the presented panel, faded in), and the presented panel
//  switches over the body phase so every prompt-required state renders (loading / empty / error /
//  content) — never a blank box. All data + presentation lives in `CommandSelectModel` (P1/S8); no
//  networking or navigation here.
//
//  Dismissal mirrors the web `Modal`: the close "×" and the Cancel button both route to `onClose`
//  through the injected `CommandSelectController`; the dismiss is swallowed while a dispatch is in
//  flight so the dialog stays mounted until the command resolves. The presenting host observes the
//  controller and tears down the sheet around this surface.
//

import SwiftUI

/// The command option-picker dialog, binding through `CommandSelectModel` (P1/S8).
public struct CommandSelectDialog: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = CommandSelectSurface.slug

    @State private var model: CommandSelectModel

    public init(model: CommandSelectModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .onAppear { model.start() }
            .onDisappear { model.stop() }
    }

    /// The web early-return resolved to a rendered surface: nothing while hidden (web `Modal` closed —
    /// no command awaiting a selection), else the presented panel faded in (web `Modal` content).
    @ViewBuilder
    private var content: some View {
        switch model.visibility {
        case .hidden:
            EmptyView()
        case .presented:
            TSFadeIn(delay: 0.05) {
                CommandSelectDialogPanel(model: model)
            }
        }
    }
}
