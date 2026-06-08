//
//  UserImpersonateButton.swift
//  TeslaSync — P4 feature view · 0050 · UserImpersonateButton (Apple)
//
//  The composable "Impersonate" control — the SwiftUI parity of
//  features/admin/components/UserImpersonateButton.tsx. A per-row action that
//  confirms then starts an impersonation session, gated by the impersonation
//  status and rendering every state (loading / unavailable / error / stale /
//  offline / idle / starting / started / failed) through
//  `UserImpersonateButtonModel` (P1/S8). The web `ConfirmDialog` maps to a native
//  `.alert`. No networking lives here; the surface emits the P1/S11 `view.opened`.
//

import SwiftUI

/// The composable UserImpersonateButton surface. Binds through
/// `UserImpersonateButtonModel`, renders the gated action (or the matching
/// non-actionable state), and presents the confirmation dialog. Emits the P1/S11
/// `view.opened` event on appear.
public struct UserImpersonateButton: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        UserImpersonateButtonSurface.slug
    }

    @State private var model: UserImpersonateButtonModel

    /// Binds an explicitly constructed model (production wires it over the shared
    /// P1/S8 holders; previews/tests inject in-memory seams).
    public init(model: UserImpersonateButtonModel) {
        _model = State(initialValue: model)
    }

    /// Convenience: builds the model from the status + start seams for the given
    /// subject (web `props.subject` / `props.disabled`).
    public init(
        subject: String,
        disabled: Bool = false,
        statusProvider: any ImpersonationStatusProviding,
        starter: any ImpersonationStarting,
        telemetry: any UserImpersonateButtonTelemetry = OSLogUserImpersonateButtonTelemetry(),
        onStarted: (@MainActor (String) -> Void)? = nil
    ) {
        _model = State(
            initialValue: UserImpersonateButtonModel(
                subject: subject,
                disabledByParent: disabled,
                statusProvider: statusProvider,
                starter: starter,
                telemetry: telemetry,
                onStarted: onStarted
            )
        )
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .alert(
            Text(verbatim: confirmContent.title),
            isPresented: Binding(
                get: { model.isConfirmPresented },
                set: { if !$0 { model.cancelStart() } }
            )
        ) {
            // Web `ConfirmDialog`: confirm (warning) + cancel.
            Button {
                model.confirmStart()
            } label: {
                Text(verbatim: confirmContent.confirmLabel)
            }
            Button(role: .cancel) {
                model.cancelStart()
            } label: {
                Text(verbatim: confirmContent.cancelLabel)
            }
        } message: {
            Text(verbatim: confirmContent.message)
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.statusPhase {
        case .loading:
            if model.isOffline {
                ImpersonateOfflineUnavailable()
            } else {
                ImpersonateLoading()
            }
        case .failed:
            if model.isOffline {
                ImpersonateOfflineUnavailable()
            } else {
                ImpersonateStatusError { model.retryStatus() }
            }
        case .empty:
            ImpersonateOfflineUnavailable(isOffline: model.isOffline)
        case .loaded:
            loadedContent
        }
    }

    @ViewBuilder
    private var loadedContent: some View {
        let availability = model.availability ?? .available
        if let note = ImpersonationUnavailableNote.project(availability), case .openMode = availability {
            // Web hides in open-mode installs; the native surface explains instead
            // of vanishing (empty state, never a blank box).
            ImpersonateUnavailableState(note: note)
        } else {
            ImpersonateActionState(model: model)
        }
    }

    private var confirmContent: ImpersonateConfirmContent {
        ImpersonateConfirmContent.build(
            subject: model.subject,
            localize: UserImpersonateButtonStrings.string,
            format: UserImpersonateButtonStrings.format
        )
    }
}
