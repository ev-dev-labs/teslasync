//
//  TOTPEnrollmentSection.swift
//  TeslaSync — P4 feature view · 0217 · TOTPEnrollmentSection (Apple)
//
//  The composable TOTP enrollment surface — the SwiftUI parity of
//  features/settings/components/TOTPEnrollmentSection.tsx. Renders the status
//  surface (loading / open-mode / not-enrolled / activated / error) bound through
//  `TOTPEnrollmentModel` (P1/S8) and hosts the three modals the web component
//  drives off its local dialog state (enroll QR + verify, backup-codes reveal,
//  typed-"DISABLE" confirmation). No networking lives here — the model owns the
//  status query + the four mutations behind the `TOTPEnrollmentSource` seam.
//

import SwiftUI

/// The composable TOTP enrollment surface — the SwiftUI parity of
/// `features/settings/components/TOTPEnrollmentSection.tsx`, binding through
/// `TOTPEnrollmentModel` (P1/S8). No networking lives here.
public struct TOTPEnrollmentSection: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = TOTPEnrollmentSurface.slug

    @State private var model: TOTPEnrollmentModel

    public init(model: TOTPEnrollmentModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .sheet(isPresented: enrollSheetBinding) { enrollSheet }
            .sheet(isPresented: backupSheetBinding) { backupSheet }
            .sheet(isPresented: disableSheetBinding) { disableSheet }
            .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            TOTPLoadingPanel()
        case .openMode:
            TOTPOpenModePanel()
        case .notEnrolled:
            TOTPStatusPanel(model: model, isActivated: false)
        case .activated:
            TOTPStatusPanel(model: model, isActivated: true)
        case let .error(message):
            TOTPErrorPanel(message: message) { model.refresh() }
        }
    }

    // MARK: - Sheet presentation

    /// Web `open={dialogStep === 'enroll' && enrollment != null}`. Dismissing the
    /// sheet (swipe / close) resets the whole modal flow via `closeDialog`.
    private var enrollSheetBinding: Binding<Bool> {
        Binding(
            get: { model.dialogStep == .enroll && model.enrollment != nil },
            set: { if !$0 { model.closeDialog() } }
        )
    }

    /// Web `open={dialogStep === 'backupCodes' && revealedCodes != null}`.
    private var backupSheetBinding: Binding<Bool> {
        Binding(
            get: { model.dialogStep == .backupCodes && model.revealedCodes != nil },
            set: { if !$0 { model.closeDialog() } }
        )
    }

    /// Web `open={showDisableConfirm}`.
    private var disableSheetBinding: Binding<Bool> {
        Binding(
            get: { model.showDisableConfirm },
            set: { if !$0 { model.cancelDisableConfirm() } }
        )
    }

    @ViewBuilder
    private var enrollSheet: some View {
        if let enrollment = model.enrollment {
            TOTPModalScaffold(
                title: TOTPEnrollmentStrings.string("totp.modal.enrollTitle", "Enable TOTP"),
                onClose: { model.closeDialog() },
                content: {
                    TOTPEnrollModalContent(model: model, enrollment: enrollment)
                }
            )
        }
    }

    @ViewBuilder
    private var backupSheet: some View {
        if let codes = model.revealedCodes {
            TOTPModalScaffold(
                title: TOTPEnrollmentStrings.string("totp.backupCodes.title", "Save your backup codes"),
                onClose: { model.closeDialog() },
                content: {
                    TOTPBackupCodesModalContent(model: model, codes: codes)
                }
            )
        }
    }

    private var disableSheet: some View {
        TOTPModalScaffold(
            title: TOTPEnrollmentStrings.string(
                "totp.disable.title", "Disable two-factor authentication?"
            ),
            onClose: { model.cancelDisableConfirm() },
            content: {
                TOTPDisableConfirmContent(model: model)
            }
        )
    }
}
