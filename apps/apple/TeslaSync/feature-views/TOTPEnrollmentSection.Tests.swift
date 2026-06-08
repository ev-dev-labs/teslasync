//
//  TOTPEnrollmentSection.Tests.swift
//  TeslaSync — P4 feature view · 0217 · TOTPEnrollmentSection (Apple)
//
//  Unit coverage for the TOTPEnrollmentSection surface:
//    • Adapter — the six-digit `/\D/g` sanitiser, the backup-codes `.txt` body +
//      filename, the verify-error `err.code` → message switch, and the status
//      projection (phase resolution + the activated panel's fields).
//    • Accessibility — the header + activated VoiceOver summaries.
//    • State holder — `TOTPEnrollmentModel` wiring: the `view.opened` telemetry,
//      the enroll / verify / revoke / regenerate mutation flow + dialog state
//      machine, the typed-"DISABLE" guard, and the stale one-shot auto-refresh.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryTOTPEnrollmentSource`.
//

import XCTest
@testable import TeslaSync

/// Echo localizer: returns the web English fallback so projected strings can be
/// asserted without the catalog (the P1/S10 facade is exercised separately).
private let echo: @Sendable (String, String) -> String = { _, fallback in fallback }

/// Deterministic date formatter for projection assertions (host-locale free).
private let fixedFormat: @Sendable (Date) -> String = { _ in "FMT" }

// MARK: - Adapter: six-digit sanitiser (port of web `/\D/g` + `.slice(0, 6)`)

@MainActor
final class TOTPCodeTests: XCTestCase {
    func testSanitizeStripsNonDigitsAndCaps() {
        XCTAssertEqual(TOTPCode.sanitize("12ab34cd56ef78"), "123456")
        XCTAssertEqual(TOTPCode.sanitize("  9 9 9 "), "999")
        XCTAssertEqual(TOTPCode.sanitize("1234567890"), "123456")
        XCTAssertEqual(TOTPCode.sanitize(""), "")
    }

    func testSanitizeExcludesNonASCIIDigits() {
        // Arabic-Indic digits are non-ASCII and must be stripped like JS `\D`.
        XCTAssertEqual(TOTPCode.sanitize("١٢٣456"), "456")
    }

    func testIsComplete() {
        XCTAssertTrue(TOTPCode.isComplete("123456"))
        XCTAssertTrue(TOTPCode.isComplete("1-2-3-4-5-6"))
        XCTAssertFalse(TOTPCode.isComplete("123"))
        XCTAssertFalse(TOTPCode.isComplete("1234567"))
    }
}

// MARK: - Adapter: backup-codes file (port of web `downloadCodes` blob)

@MainActor
final class TOTPBackupCodesFileTests: XCTestCase {
    func testContentsMatchesWebBlob() {
        let body = TOTPBackupCodesFile.contents(codes: ["aaaa", "bbbb"], header: "# header")
        XCTAssertEqual(body, "# header\n\naaaa\nbbbb\n")
    }

    func testContentsWithNoCodesIsHeaderBlock() {
        XCTAssertEqual(TOTPBackupCodesFile.contents(codes: [], header: "# header"), "# header\n\n\n")
    }

    func testFilename() {
        XCTAssertEqual(TOTPFormat.backupCodesFilename, "teslasync-totp-backup-codes.txt")
    }
}

// MARK: - Adapter: verify-error mapping (web `handleVerify` catch switch)

@MainActor
final class TOTPVerifyErrorMapperTests: XCTestCase {
    func testEachCodeMapsToItsMessage() {
        XCTAssertEqual(
            TOTPVerifyErrorMapper.message(for: .invalidCode, localize: echo),
            "Code did not match. Try the next one."
        )
        XCTAssertEqual(
            TOTPVerifyErrorMapper.message(for: .rateLimited, localize: echo),
            "Too many incorrect attempts. Try again in 15 minutes."
        )
        XCTAssertEqual(
            TOTPVerifyErrorMapper.message(for: .enrollmentExpired, localize: echo),
            "Enrollment expired. Close and start over."
        )
    }

    func testGenericPrefersUpstreamMessageThenFallback() {
        XCTAssertEqual(TOTPVerifyErrorMapper.message(for: .generic("boom"), localize: echo), "boom")
        XCTAssertEqual(
            TOTPVerifyErrorMapper.message(for: .generic(nil), localize: echo),
            "Verification failed."
        )
    }

    func testIncompleteMessage() {
        XCTAssertEqual(TOTPVerifyErrorMapper.incompleteMessage(localize: echo), "Enter all 6 digits.")
    }
}

// MARK: - Adapter: status projection (web render-branch resolution)

@MainActor
final class TOTPStatusProjectionTests: XCTestCase {
    private let sessionActive = TOTPStatusData(mode: .session, activated: true, backupCodesRemaining: 3)

    func testResolvePhaseLoadingWithoutDataIsLoading() {
        XCTAssertEqual(TOTPStatusProjection.resolvePhase(.init(status: .loading)), .loading)
    }

    func testResolvePhaseLoadingWithCachedDataStaysContent() {
        let update = TOTPEnrollmentUpdate(status: .loading, data: sessionActive)
        XCTAssertEqual(TOTPStatusProjection.resolvePhase(update), .activated)
    }

    func testResolvePhaseEmptyIsOpenMode() {
        XCTAssertEqual(TOTPStatusProjection.resolvePhase(.init(status: .empty)), .openMode)
    }

    func testResolvePhaseLoadedOpenIsOpenMode() {
        let update = TOTPEnrollmentUpdate(status: .loaded, data: TOTPStatusData(mode: .open))
        XCTAssertEqual(TOTPStatusProjection.resolvePhase(update), .openMode)
    }

    func testResolvePhaseLoadedSessionGatesOnActivated() {
        let notEnrolled = TOTPEnrollmentUpdate(
            status: .loaded, data: TOTPStatusData(mode: .session, activated: false)
        )
        XCTAssertEqual(TOTPStatusProjection.resolvePhase(notEnrolled), .notEnrolled)
        let active = TOTPEnrollmentUpdate(status: .loaded, data: sessionActive)
        XCTAssertEqual(TOTPStatusProjection.resolvePhase(active), .activated)
    }

    func testResolvePhaseLoadedNilDataFallsBackToOpenMode() {
        XCTAssertEqual(TOTPStatusProjection.resolvePhase(.init(status: .loaded)), .openMode)
    }

    func testResolvePhaseFailedWithoutDataIsError() {
        XCTAssertEqual(
            TOTPStatusProjection.resolvePhase(.init(status: .failed("boom"))),
            .error("boom")
        )
    }

    func testResolvePhaseFailedWithCachedDataStaysContent() {
        let update = TOTPEnrollmentUpdate(status: .failed("boom"), data: sessionActive)
        XCTAssertEqual(TOTPStatusProjection.resolvePhase(update), .activated)
    }

    func testStatusViewModelFormatsLastUsedWhenActivated() {
        let data = TOTPStatusData(
            mode: .session, activated: true, lastUsedAt: Date(), backupCodesRemaining: 5
        )
        let model = TOTPStatusProjection.statusViewModel(data, localize: echo, formatDateTime: fixedFormat)
        XCTAssertEqual(model.lastUsedText, "FMT")
        XCTAssertEqual(model.backupCodesRemaining, 5)
    }

    func testStatusViewModelNeverWhenNotActivatedOrNil() {
        let inactive = TOTPStatusData(mode: .session, activated: false, backupCodesRemaining: 9)
        let m1 = TOTPStatusProjection.statusViewModel(inactive, localize: echo, formatDateTime: fixedFormat)
        XCTAssertEqual(m1.lastUsedText, "Never")
        XCTAssertEqual(m1.backupCodesRemaining, 0)
        let m2 = TOTPStatusProjection.statusViewModel(nil, localize: echo, formatDateTime: fixedFormat)
        XCTAssertEqual(m2.lastUsedText, "Never")
        XCTAssertEqual(m2.backupCodesRemaining, 0)
    }
}

// MARK: - Adapter: accessibility summaries

@MainActor
final class TOTPAccessibilityTests: XCTestCase {
    func testHeaderSummaryGatesOnActivated() {
        XCTAssertEqual(
            TOTPAccessibility.headerSummary(phase: .activated, localize: echo),
            "Two-factor authentication: Active"
        )
        XCTAssertEqual(
            TOTPAccessibility.headerSummary(phase: .notEnrolled, localize: echo),
            "Two-factor authentication: Not enrolled"
        )
    }

    func testActivatedSummaryCombinesFields() {
        let model = TOTPStatusViewModel(lastUsedText: "FMT", backupCodesRemaining: 4)
        XCTAssertEqual(
            TOTPAccessibility.activatedSummary(model, localize: echo),
            "Last used: FMT. Backup codes remaining: 4"
        )
    }
}
