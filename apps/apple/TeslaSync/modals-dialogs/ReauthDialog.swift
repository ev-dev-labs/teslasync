//
//  ReauthDialog.swift
//  TeslaSync — P4 modal/dialog · 0007 · ReauthDialog (Apple)
//
//  The step-up reauth surface — the SwiftUI parity of components/feedback/ReauthDialog.tsx. The web
//  source is a `Modal` wrapping a mode-aware form: forward-auth installs render the credential form (a
//  Password tab, plus an Authenticator tab when TOTP is offered) and POST to mint a sudo token;
//  open-mode installs render a typed-confirmation field that resolves locally. The native surface
//  presents that same composition as HIG sheet content (web `Modal` → native sheet): it fades in inside
//  a `TSGlassPanel`, shows the always-on mode title + freshness chip + close, surfaces a cached-data
//  banner when the bound live-state is not fresh, and switches over the model's resolved phase so every
//  prompt-required state renders (loading / empty / error / content) — never a blank box. Binds through
//  `ReauthDialogModel` (P1/S8); no HTTP or queue access lives here.
//
//  Dismissal is a queue consequence (web parity): completing or cancelling drives the injected
//  `ReauthController`, which resolves/rejects the active sudo challenge; the presenting host observes
//  that and dismisses around this surface. The close "×" routes to cancel, exactly like the web
//  `Modal onClose={handleCancel}`.
//

import SwiftUI

/// The reauth surface, binding through `ReauthDialogModel` (P1/S8). Submitting hands the credential to
/// the controller (web `onSubmit`); cancelling (or the close "×") rejects the challenge (web
/// `onCancel`). Both empty the sudo queue, which the presenting host reacts to by dismissing.
public struct ReauthDialog: View {
    @State private var model: ReauthDialogModel

    public init(model: ReauthDialogModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.05) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    ReauthHeader(
                        title: model.dialogTitle,
                        connection: model.connection,
                        closeLabel: model.closeAccessibilityLabel,
                        onClose: handleCancel
                    )
                    if model.connection != .live {
                        ReauthConnectivityBanner(connection: model.connection)
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
    private func body(for phase: ReauthPhase) -> some View {
        switch phase {
        case .loading:
            ReauthLoadingState()
        case .empty:
            ReauthEmptyState()
        case let .error(message):
            ReauthErrorState(message: message) { model.refresh() }
        case .content:
            ReauthForm(model: model, onCancel: handleCancel, onSubmit: handleSubmit)
        }
    }

    /// Validate-then-submit (web `handleSubmit`). The async routing lives in the model; on success it
    /// completes the challenge through the controller, which empties the queue and dismisses the host.
    private func handleSubmit() {
        Task { await model.submit() }
    }

    /// Reject-the-challenge (web `handleCancel` + the `Modal onClose`). A no-op while submitting.
    private func handleCancel() {
        model.cancel()
    }
}

// MARK: - Surface identity

public extension ReauthDialog {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        ReauthSurface.slug
    }
}
