//
//  AiConfirmDialog.swift
//  TeslaSync — P4 modal / dialog · 0001 · ConfirmDialog (Apple)
//
//  The AI tool-use confirmation dialog — the SwiftUI parity of web/src/components/ai/ConfirmDialog.tsx
//  (exported `AiConfirmDialog`). The web source is a focus-trapped `Modal` that surfaces a
//  dispatcher-paused, LLM-proposed tool call (the tool name + verbatim JSON arguments + audit context)
//  so the user can verify the assistant is about to do exactly what they expect before approving. It
//  renders only when its parent says `open=true`. The native surface switches over the model's resolved
//  `visibility` so that render gate is reproduced (hidden vs the presented panel, faded in), and the
//  presented panel switches over the body phase so every prompt-required state renders (loading /
//  empty / error / content) — never a blank box. All data + presentation lives in `AiConfirmModel`
//  (P1/S8); no networking or continuation dispatch here.
//
//  Naming note: ships under `AiConfirmDialog` rather than the prompt's `ConfirmDialog` to avoid
//  clobbering sibling 0012's generic `components/ui/ConfirmDialog.tsx` surface (same native filename,
//  duplicate Swift symbols). See AiConfirmDialog.Adapter.swift for the full rationale.
//

import SwiftUI

/// The AI tool-use confirmation dialog, binding through `AiConfirmModel` (P1/S8).
public struct AiConfirmDialog: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = AiConfirmSurface.slug

    @State private var model: AiConfirmModel

    public init(model: AiConfirmModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .onAppear { model.start() }
            .onDisappear { model.stop() }
    }

    /// The web render gate resolved to a rendered surface: nothing while hidden (web `null` — no tool
    /// awaiting approval), else the presented panel faded in (web `Modal` content).
    @ViewBuilder
    private var content: some View {
        switch model.visibility {
        case .hidden:
            EmptyView()
        case .presented:
            TSFadeIn(delay: 0.05) {
                AiConfirmPanel(model: model)
            }
        }
    }
}
