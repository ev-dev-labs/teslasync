//
//  ConfirmDialog.swift
//  TeslaSync — P4 modal / dialog · 0012 · ConfirmDialog (Apple)
//
//  The destructive-action confirmation dialog — the SwiftUI parity of components/ui/ConfirmDialog.tsx.
//  The web source is a focus-trapped `Modal` that warns before a destructive (or merely consequential)
//  action: a severity-tinted message, an optional typed-confirmation gate for extra-dangerous actions
//  ("type the vehicle name to delete"), an optional "Don't ask again" opt-out for non-destructive
//  prompts, and Cancel / Confirm affordances that disable + show a spinner while the parent's mutation
//  is in flight. It renders nothing when there is nothing to confirm, or when the action was
//  previously silenced (in which case it fires the confirm immediately). The native surface switches
//  over the model's resolved `visibility` so the early-return is reproduced (hidden vs the presented
//  panel, faded in), and the presented panel switches over the body phase so every prompt-required
//  state renders (loading / empty / error / content) — never a blank box. All data + presentation
//  lives in `ConfirmDialogModel` (P1/S8); no networking or persistence here.
//

import SwiftUI

/// The destructive-action confirmation dialog, binding through `ConfirmDialogModel` (P1/S8).
public struct ConfirmDialog: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ConfirmDialogSurface.slug

    @State private var model: ConfirmDialogModel

    public init(model: ConfirmDialogModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .onAppear { model.start() }
            .onDisappear { model.stop() }
    }

    /// The web early-return resolved to a rendered surface: nothing while hidden (web `null` — no
    /// pending action, or a silenced action that auto-confirms), else the presented panel faded in
    /// (web `Modal` content).
    @ViewBuilder
    private var content: some View {
        switch model.visibility {
        case .hidden:
            EmptyView()
        case .presented:
            TSFadeIn(delay: 0.05) {
                ConfirmDialogPanel(model: model)
            }
        }
    }
}
