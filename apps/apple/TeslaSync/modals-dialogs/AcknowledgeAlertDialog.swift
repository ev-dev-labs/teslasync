//
//  AcknowledgeAlertDialog.swift
//  TeslaSync — P4 modal/dialog · 0017 · AcknowledgeAlertDialog (Apple)
//
//  The alert-acknowledgement surface — the SwiftUI parity of
//  features/admin/components/AcknowledgeAlertDialog.tsx. The web source is a `Modal` wrapping a small
//  form: an optional alert-title subtitle, a multi-line note `Textarea`, the "Up to {{max}}
//  characters…" hint, and the ghost Cancel + primary Acknowledge footer. The native surface presents
//  that same composition as HIG sheet content (web `Modal` → native sheet): it fades in inside a
//  `TSGlassPanel`, shows the title + freshness chip + close, surfaces a cached-data banner when the
//  bound live-state is not fresh, and switches over the model's resolved phase so every prompt-required
//  state renders (loading / empty / error / content) — never a blank box. Binds through `AckAlertModel`
//  (P1/S8); no HTTP or navigation lives here.
//
//  Dismissal mirrors the web `Modal`: acknowledging completes through the injected `AckAlertController`
//  (the parent's post-`onSubmit` close), and the close "×" routes to cancel (web `onClose`). The
//  presenting host observes those and dismisses around this surface.
//

import SwiftUI

/// The acknowledgement surface, binding through `AckAlertModel` (P1/S8). Acknowledging records the note
/// through the service then completes; cancelling (or the close "×") dismisses with no mutation.
public struct AcknowledgeAlertDialog: View {
    @State private var model: AckAlertModel

    public init(model: AckAlertModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.05) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    AckAlertHeader(
                        title: model.dialogTitle,
                        connection: model.connection,
                        closeLabel: model.closeAccessibilityLabel,
                        onClose: handleCancel
                    )
                    if model.connection != .live {
                        AckAlertConnectivityBanner(connection: model.connection)
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

    /// The web modal body under the title: the populated form for `.content`, else the loading / empty /
    /// error envelopes so no state is hidden behind a blank panel.
    @ViewBuilder
    private func body(for phase: AckAlertPhase) -> some View {
        switch phase {
        case .loading:
            AckAlertLoadingState()
        case .empty:
            AckAlertEmptyState()
        case let .error(message):
            AckAlertErrorState(message: message) { model.refresh() }
        case .content:
            AckAlertForm(model: model, onCancel: handleCancel, onSubmit: handleSubmit)
        }
    }

    /// Validate-then-submit (web `handleSubmit`). The async routing lives in the model; on success it
    /// completes through the controller, which dismisses the host.
    private func handleSubmit() {
        Task { await model.submit() }
    }

    /// Close-with-no-mutation (web `onClose`). A no-op while submitting.
    private func handleCancel() {
        model.cancel()
    }
}

// MARK: - Surface identity

public extension AcknowledgeAlertDialog {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        AckAlertSurface.slug
    }
}
