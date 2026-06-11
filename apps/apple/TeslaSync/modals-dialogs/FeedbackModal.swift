//
//  FeedbackModal.swift
//  TeslaSync — P4 modal/dialog · 0004 · FeedbackModal (Apple)
//
//  The in-app feedback / bug-report dialog — the SwiftUI parity of
//  components/feedback/FeedbackModal.tsx. The web source is a `Modal` wrapping a form: a category
//  `Select`, a required title `Input`, a required details `Textarea`, an "Auto-attached context"
//  panel (page route + app version + client identity + two consent toggles), an inline submit error,
//  and the Cancel / Send-feedback footer. The native surface presents that same composition as HIG
//  sheet content (web `Modal` → native sheet): it fades in inside a `TSGlassPanel`, shows the always-
//  on title header + freshness chip + close, surfaces a cached-data banner when the bound live-state
//  is not fresh, and renders the form whose auto-context panel switches over the model's resolved
//  phase so every prompt-required state renders (loading / empty / error / content) — never a blank
//  box. Binds through `FeedbackModel` (P1/S8); no network access or feedback mutation lives here.
//

import SwiftUI

/// The feedback surface, binding through `FeedbackModel` (P1/S8). `onClose` is the web `Modal`
/// `onClose` — the presenting host (the sheet that shows this surface) dismisses around it. A
/// successful submit resets the form and closes (web `await mutateAsync; onClose()`); a failed submit
/// keeps the form open with the inline error; Cancel simply closes.
public struct FeedbackModal: View {
    @State private var model: FeedbackModel
    private let onClose: () -> Void

    public init(model: FeedbackModel, onClose: @escaping () -> Void = {}) {
        _model = State(initialValue: model)
        self.onClose = onClose
    }

    public var body: some View {
        TSFadeIn(delay: 0.05) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    FeedbackHeader(connection: model.connection, onClose: onClose)
                    if model.connection != .live {
                        FeedbackConnectivityBanner(connection: model.connection)
                    }
                    FeedbackForm(model: model, onCancel: onClose, onSubmit: handleSubmit)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// Validate-then-submit-then-dismiss-on-success (web form `onSubmit` + `onClose` inside the
    /// `try`). The async submit drives the in-flight + failure state on the model; the dialog only
    /// dismisses when the submission actually succeeded.
    private func handleSubmit() {
        Task {
            let didSucceed = await model.submit()
            if didSucceed { onClose() }
        }
    }
}

// MARK: - Surface identity

public extension FeedbackModal {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        FeedbackSurface.slug
    }
}
