//
//  FlagEditDrawer.swift
//  TeslaSync — P4 modal / dialog · 0019 · FlagEditDrawer (Apple)
//
//  The feature-flag edit / create drawer — the SwiftUI parity of
//  features/admin/components/feature-flags/FlagEditDrawer.tsx. The web source is a controlled form
//  that powers BOTH "edit existing flag" (a seeded, read-only key) AND "create new flag" (an empty,
//  editable key): a free-form JSON value textarea that disables Save + shows a parse-error helper on
//  invalid JSON, and a required audit reason. It renders nothing when closed. The native surface
//  switches over the model's resolved `visibility` so the closed state is reproduced (hidden vs the
//  presented drawer, faded in), and the presented drawer switches over the body phase so every
//  prompt-required state renders (loading / empty / error / content) — never a blank box. All data +
//  presentation lives in `FlagEditDrawerModel` (P1/S8); no networking or persistence here.
//

import SwiftUI

/// The feature-flag edit / create drawer, binding through `FlagEditDrawerModel` (P1/S8).
public struct FlagEditDrawer: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = FlagEditDrawerSurface.slug

    @State private var model: FlagEditDrawerModel

    public init(model: FlagEditDrawerModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .onAppear { model.start() }
            .onDisappear { model.stop() }
    }

    /// The web "render nothing while closed" resolved to a rendered surface: nothing while hidden
    /// (web `open === false`), else the presented drawer faded in (web `Drawer` content).
    @ViewBuilder
    private var content: some View {
        switch model.visibility {
        case .hidden:
            EmptyView()
        case .presented:
            TSFadeIn(delay: 0.05) {
                FlagEditDrawerPanel(model: model)
            }
        }
    }
}
