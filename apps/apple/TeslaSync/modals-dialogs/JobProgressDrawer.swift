//
//  JobProgressDrawer.swift
//  TeslaSync — P4 modal / dialog · 0005 · JobProgressDrawer (Apple)
//
//  Export job-progress drawer — the SwiftUI parity of components/feedback/JobProgressDrawer
//  .tsx. Switches over the model's resolved `visibility` so the web drawer-state machine
//  renders natively: hidden (web early-return `null`), the minimized chip, or the open panel
//  (faded in). The panel itself reproduces every prompt-required state (loading / empty /
//  error / populated, with the inline-error + stale + offline branches) — never a blank box.
//  All data + presentation lives in `JobProgressDrawerModel` (P1/S8); no networking here.
//

import SwiftUI

/// The export job-progress drawer — the SwiftUI parity of the web `JobProgressDrawer`, binding
/// through `JobProgressDrawerModel` (P1/S8).
public struct JobProgressDrawer: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = JobProgressDrawerSurface.slug

    @State private var model: JobProgressDrawerModel

    public init(model: JobProgressDrawerModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .onAppear { model.start() }
            .onDisappear { model.stop() }
    }

    /// The web drawer-state machine resolved to a rendered surface.
    @ViewBuilder
    private var content: some View {
        switch model.visibility {
        case .hidden:
            EmptyView()
        case .minimized:
            JobDrawerMinimizedChip(model: model)
        case .open:
            TSFadeIn(delay: 0.05) {
                JobDrawerPanel(model: model)
            }
        }
    }
}
