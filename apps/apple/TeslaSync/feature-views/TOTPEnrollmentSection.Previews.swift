//
//  TOTPEnrollmentSection.Previews.swift
//  TeslaSync — P4 feature view · 0217 · TOTPEnrollmentSection (Apple)
//
//  Xcode previews for each surface state (loading / open-mode / not-enrolled /
//  activated / error / stale / offline) plus the three modal contents (enroll /
//  backup-codes / disable). DEBUG-only; compiled by the app targets and skipped
//  by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: TOTPEnrollmentUpdate) -> TOTPEnrollmentModel {
        let source = InMemoryTOTPEnrollmentSource(initial: update)
        let model = TOTPEnrollmentModel(source: source)
        model.start()
        return model
    }

    private let activatedData = TOTPStatusData(
        mode: .session,
        activated: true,
        lastUsedAt: Date(timeIntervalSince1970: 1_717_000_000),
        backupCodesRemaining: 7
    )

    #Preview("Loading") {
        TOTPEnrollmentSection(model: previewModel(TOTPEnrollmentUpdate(status: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Open mode / empty") {
        TOTPEnrollmentSection(model: previewModel(
            TOTPEnrollmentUpdate(status: .loaded, data: TOTPStatusData(mode: .open))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Not enrolled") {
        TOTPEnrollmentSection(model: previewModel(
            TOTPEnrollmentUpdate(status: .loaded, data: TOTPStatusData(mode: .session, activated: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Activated") {
        TOTPEnrollmentSection(model: previewModel(
            TOTPEnrollmentUpdate(status: .loaded, connection: .live, data: activatedData)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        TOTPEnrollmentSection(model: previewModel(
            TOTPEnrollmentUpdate(status: .failed("Tesla API returned 503 Service Unavailable"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        TOTPEnrollmentSection(model: previewModel(
            TOTPEnrollmentUpdate(status: .loaded, connection: .stale, data: activatedData)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        TOTPEnrollmentSection(model: previewModel(
            TOTPEnrollmentUpdate(status: .loaded, connection: .offline, data: activatedData)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Modal — enroll") {
        let model = previewModel(
            TOTPEnrollmentUpdate(status: .loaded, data: TOTPStatusData(mode: .session))
        )
        return TOTPModalScaffold(
            title: TOTPEnrollmentStrings.string("totp.modal.enrollTitle", "Enable TOTP"),
            onClose: {},
            content: {
                TOTPEnrollModalContent(model: model, enrollment: .preview)
            }
        )
    }

    #Preview("Modal — backup codes") {
        let model = previewModel(
            TOTPEnrollmentUpdate(status: .loaded, data: activatedData)
        )
        return TOTPModalScaffold(
            title: TOTPEnrollmentStrings.string("totp.backupCodes.title", "Save your backup codes"),
            onClose: {},
            content: {
                TOTPBackupCodesModalContent(model: model, codes: TOTPEnrollmentData.preview.backupCodes)
            }
        )
    }

    #Preview("Modal — disable") {
        let model = previewModel(
            TOTPEnrollmentUpdate(status: .loaded, data: activatedData)
        )
        return TOTPModalScaffold(
            title: TOTPEnrollmentStrings.string("totp.disable.title", "Disable two-factor authentication?"),
            onClose: {},
            content: {
                TOTPDisableConfirmContent(model: model)
            }
        )
    }
#endif
