//
//  AddAnnotationPopover.swift
//  TeslaSync — P4 modal/dialog · 0002 · AddAnnotationPopover (Apple)
//
//  The add-annotation dialog — the SwiftUI parity of components/charts/AddAnnotationPopover.tsx. The
//  web source is a `Modal` wrapping a form: an optional editable date or a read-only timestamp, a
//  required label input, a row of six category pills (each with its glyph + `ANNOTATION_COLORS`
//  tint), an optional description input, and the Cancel / Add-Annotation footer actions. The native
//  surface presents that same composition as HIG sheet content (web `Modal` → native sheet): it
//  fades in inside a `TSGlassPanel`, shows the always-on title header + freshness chip + close,
//  surfaces a cached-data banner when the bound live-state is not fresh, and switches over the
//  model's resolved phase so every prompt-required state renders (loading / empty / error / content)
//  — never a blank box. Binds through `AddAnnotationModel` (P1/S8); no persistence access or
//  annotation mutation lives here.
//

import SwiftUI

/// The add-annotation surface, binding through `AddAnnotationModel` (P1/S8). `onClose` is the web
/// `Modal` `onClose` — the presenting host (the sheet that shows this surface) dismisses around it;
/// submitting hands the draft to the controller (web `onAdd`) and then closes, cancelling resets the
/// fields (web `handleClose`) and then closes.
public struct AddAnnotationPopover: View {
    @State private var model: AddAnnotationModel
    private let onClose: () -> Void

    public init(model: AddAnnotationModel, onClose: @escaping () -> Void = {}) {
        _model = State(initialValue: model)
        self.onClose = onClose
    }

    public var body: some View {
        TSFadeIn(delay: 0.05) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    AddAnnotationHeader(connection: model.connection, onClose: handleClose)
                    if model.connection != .live {
                        AddAnnotationConnectivityBanner(connection: model.connection)
                    }
                    body(for: model.phase)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web modal body under the title: the populated form for `.content`, else the loading /
    /// empty / error envelopes so no state is hidden behind a blank panel.
    @ViewBuilder
    private func body(for phase: AddAnnotationPhase) -> some View {
        switch phase {
        case .loading:
            AddAnnotationLoadingState()
        case .empty:
            AddAnnotationEmptyState()
        case let .error(message):
            AddAnnotationErrorState(message: message) { model.refresh() }
        case .content:
            AddAnnotationForm(model: model, onCancel: handleClose, onSubmit: handleSubmit)
        }
    }

    /// Validate-then-submit-then-dismiss (web `handleSubmit` + the host closing on `onAdd`). The Add
    /// button is disabled while `canSubmit` is false, so this is a no-op guard for safety.
    private func handleSubmit() {
        guard model.canSubmit else { return }
        model.submit()
        onClose()
    }

    /// Reset-then-cancel-then-dismiss (web `handleClose` + `onCancel`).
    private func handleClose() {
        model.cancel()
        onClose()
    }
}

// MARK: - Surface identity

public extension AddAnnotationPopover {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        AddAnnotationSurface.slug
    }
}
