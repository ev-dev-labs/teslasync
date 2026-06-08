//
//  TOTPEnrollmentSection.ModelTests.swift
//  TeslaSync — P4 feature view · 0217 · TOTPEnrollmentSection (Apple)
//
//  The state-holder half of the surface's coverage: `TOTPEnrollmentModel` wiring
//  — the `view.opened` telemetry, the enroll / verify / revoke / regenerate
//  mutation flow + dialog state machine, the typed-"DISABLE" guard, and the
//  stale one-shot auto-refresh. Driven by `InMemoryTOTPEnrollmentSource`; no
//  network, no real store. The pure Adapter/projection tests live in
//  TOTPEnrollmentSection.Tests.
//

import XCTest
@testable import TeslaSync

/// Echo localizer: returns the web English fallback so model strings can be
/// asserted without the catalog.
private let echo: @Sendable (String, String) -> String = { _, fallback in fallback }

/// Deterministic date formatter for projection assertions (host-locale free).
private let fixedFormat: @Sendable (Date) -> String = { _ in "FMT" }

// MARK: - State holder: wiring + telemetry + mutation flow

@MainActor final class TOTPEnrollmentModelTests: XCTestCase {
    func testStartEmitsTelemetryOnceAndStarts() {
        let spy = SpyTOTPTelemetry()
        let (model, source) = makeModel(telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [TOTPEnrollmentSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel()
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testEnrollOpensQRDialog() async {
        let (model, source) = makeModel()
        model.start()
        model.enroll()
        await waitUntil { model.dialogStep == .enroll }
        XCTAssertEqual(model.enrollment, .preview)
        XCTAssertEqual(source.enrollCount, 1)
        XCTAssertFalse(model.enrollPending)
    }

    func testEnrollFailureKeepsDialogClosed() async {
        let (model, _) = makeModel(actionFailure: SampleError.boom)
        model.start()
        model.enroll()
        await waitUntil { !model.enrollPending }
        XCTAssertEqual(model.dialogStep, .closed)
        XCTAssertNil(model.enrollment)
    }

    func testSetVerifyCodeSanitizes() {
        let (model, _) = makeModel()
        model.setVerifyCode("12ab34cd56ef78")
        XCTAssertEqual(model.verifyCode, "123456")
    }

    func testVerifyIncompleteSetsLengthErrorWithoutCallingSource() {
        let (model, source) = makeModel()
        model.start()
        model.setVerifyCode("123")
        model.verify()
        XCTAssertEqual(model.verifyError, "Enter all 6 digits.")
        XCTAssertTrue(source.verifiedCodes.isEmpty)
        XCTAssertFalse(model.verifyPending)
    }

    func testVerifySuccessRevealsBackupCodes() async {
        let (model, source) = makeModel()
        model.start()
        model.enroll()
        await waitUntil { model.dialogStep == .enroll }
        model.setVerifyCode("123456")
        model.verify()
        await waitUntil { model.dialogStep == .backupCodes }
        XCTAssertEqual(model.revealedCodes, TOTPEnrollmentData.preview.backupCodes)
        XCTAssertEqual(source.verifiedCodes, ["123456"])
        XCTAssertNil(model.verifyError)
    }

    func testVerifyInvalidCodeMapsMessage() async {
        let (model, _) = makeModel(verifyFailure: .invalidCode)
        model.start()
        model.setVerifyCode("000000")
        model.verify()
        await waitUntil { model.verifyError != nil }
        XCTAssertEqual(model.verifyError, "Code did not match. Try the next one.")
        XCTAssertNotEqual(model.dialogStep, .backupCodes)
    }

    func testConfirmDisableRequiresTypedToken() async {
        let (model, source) = makeModel()
        model.start()
        model.openDisableConfirm()
        XCTAssertTrue(model.showDisableConfirm)
        XCTAssertFalse(model.canConfirmDisable)
        model.confirmDisable()
        XCTAssertEqual(source.revokeCount, 0)
        model.disableConfirmInput = TOTPEnrollmentModel.disableConfirmationToken
        XCTAssertTrue(model.canConfirmDisable)
        model.confirmDisable()
        await waitUntil { !model.showDisableConfirm }
        XCTAssertEqual(source.revokeCount, 1)
        XCTAssertEqual(model.disableConfirmInput, "")
    }

    func testCancelDisableConfirmResets() {
        let (model, _) = makeModel()
        model.openDisableConfirm()
        model.disableConfirmInput = "DIS"
        model.cancelDisableConfirm()
        XCTAssertFalse(model.showDisableConfirm)
        XCTAssertEqual(model.disableConfirmInput, "")
    }

    func testRegenerateRevealsFreshCodes() async {
        let (model, source) = makeModel(regenerateResult: ["regen-1", "regen-2"])
        model.start()
        model.regenerate()
        await waitUntil { model.dialogStep == .backupCodes }
        XCTAssertEqual(model.revealedCodes, ["regen-1", "regen-2"])
        XCTAssertNil(model.enrollment)
        XCTAssertEqual(source.regenerateCount, 1)
    }

    func testCloseDialogResetsFlow() async {
        let (model, _) = makeModel()
        model.start()
        model.enroll()
        await waitUntil { model.dialogStep == .enroll }
        model.setVerifyCode("123456")
        model.closeDialog()
        XCTAssertEqual(model.dialogStep, .closed)
        XCTAssertNil(model.enrollment)
        XCTAssertNil(model.revealedCodes)
        XCTAssertEqual(model.verifyCode, "")
        XCTAssertNil(model.verifyError)
    }

    func testBackupCodesFileContents() async {
        let (model, _) = makeModel(regenerateResult: ["aaaa", "bbbb"])
        model.start()
        XCTAssertNil(model.backupCodesFileContents())
        model.regenerate()
        await waitUntil { model.revealedCodes != nil }
        XCTAssertEqual(
            model.backupCodesFileContents(),
            "# TeslaSync TOTP backup codes — keep secret.\n\naaaa\nbbbb\n"
        )
    }

    func testActivatedSnapshotProjectsFields() {
        let data = TOTPStatusData(
            mode: .session, activated: true, lastUsedAt: Date(), backupCodesRemaining: 7
        )
        let (model, source) = makeModel()
        model.start()
        source.push(TOTPEnrollmentUpdate(status: .loaded, connection: .live, data: data))
        XCTAssertEqual(model.phase, .activated)
        XCTAssertEqual(model.statusModel.lastUsedText, "FMT")
        XCTAssertEqual(model.statusModel.backupCodesRemaining, 7)
        XCTAssertEqual(model.headerAccessibilityLabel, "Two-factor authentication: Active")
    }

    func testStaleTriggersExactlyOneAutoRefreshUntilLive() {
        let data = TOTPStatusData(mode: .session, activated: true)
        let (model, source) = makeModel(
            initial: TOTPEnrollmentUpdate(status: .loaded, connection: .live, data: data)
        )
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(TOTPEnrollmentUpdate(status: .loaded, connection: .stale, data: data))
        source.push(TOTPEnrollmentUpdate(status: .loaded, connection: .stale, data: data))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(TOTPEnrollmentUpdate(status: .loaded, connection: .live, data: data))
        source.push(TOTPEnrollmentUpdate(status: .loaded, connection: .stale, data: data))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let data = TOTPStatusData(mode: .session, activated: true)
        let (model, source) = makeModel(
            initial: TOTPEnrollmentUpdate(status: .loaded, connection: .live, data: data)
        )
        model.start()
        source.push(TOTPEnrollmentUpdate(status: .loaded, connection: .offline, data: data))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }
}

// MARK: - Test doubles + helpers

private enum SampleError: Error { case boom }

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyTOTPTelemetry: TOTPEnrollmentTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

@MainActor
private func makeModel(
    initial: TOTPEnrollmentUpdate = .init(status: .loading),
    enrollResult: TOTPEnrollmentData = .preview,
    verifyFailure: TOTPVerifyError? = nil,
    regenerateResult: [String] = ["regen-1", "regen-2"],
    actionFailure: Error? = nil,
    telemetry: TOTPEnrollmentTelemetry = OSLogTOTPEnrollmentTelemetry()
) -> (TOTPEnrollmentModel, InMemoryTOTPEnrollmentSource) {
    let source = InMemoryTOTPEnrollmentSource(
        initial: initial,
        enrollResult: enrollResult,
        verifyFailure: verifyFailure,
        regenerateResult: regenerateResult,
        actionFailure: actionFailure
    )
    let model = TOTPEnrollmentModel(
        source: source,
        telemetry: telemetry,
        localize: echo,
        formatDateTime: fixedFormat
    )
    return (model, source)
}

@MainActor
private func waitUntil(timeout: TimeInterval = 2.0, _ condition: () -> Bool) async {
    let deadline = Date().addingTimeInterval(timeout)
    while !condition(), Date() < deadline {
        await Task.yield()
        try? await Task.sleep(for: .milliseconds(2))
    }
}
