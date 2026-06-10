//
//  ReauthDialog.Tests.swift
//  TeslaSync — P4 modal/dialog · 0007 · ReauthDialog (Apple)
//
//  Adapter + projection + accessibility coverage for the ReauthDialog surface:
//    • `ReauthProjection.resolvePhase` — the loading / empty / error / content envelope rules.
//    • `ReauthProjection.methods` — the web `credentialTabs` (password always; totp when offered).
//    • `ReauthProjection.sanitizeTOTP` — the verbatim port of `replace(/\D/g,'').slice(0,8)`.
//    • `ReauthProjection.confirmMatches` / `credentialBody` / `credentialFieldError` — the submit guards.
//    • `ReauthProjection.submitErrorMessage` — the not-configured / invalid-credential / unknown branch.
//    • mode-driven copy (title / body / submit / confirm-label) with `{{token}}` substitution.
//    • `ReauthAccessibility` — the dialog summary + method tab + close VoiceOver content.
//
//  Pure, bundle-free: copy resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the real copy without a
/// bundle (the projection then applies any `{{token}}` substitution on top).
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - Phase resolution

final class ReauthPhaseTests: XCTestCase {
    private let context = ReauthChallengeContext(path: "/x", mode: .credential, totpTabAvailable: true)

    func testLoadingResolvesByContextPresence() {
        XCTAssertEqual(ReauthProjection.resolvePhase(status: .loading, context: nil), .loading)
        XCTAssertEqual(ReauthProjection.resolvePhase(status: .loading, context: context), .content)
    }

    func testLoadedNoContextResolvesEmpty() {
        XCTAssertEqual(ReauthProjection.resolvePhase(status: .loaded, context: nil), .empty)
    }

    func testLoadedWithContextResolvesContent() {
        XCTAssertEqual(ReauthProjection.resolvePhase(status: .loaded, context: context), .content)
    }

    func testFailedResolvesErrorOrKeepsContent() {
        XCTAssertEqual(ReauthProjection.resolvePhase(status: .failed("boom"), context: nil), .error("boom"))
        XCTAssertEqual(ReauthProjection.resolvePhase(status: .failed("boom"), context: context), .content)
    }
}

// MARK: - Methods (web credentialTabs)

final class ReauthMethodsTests: XCTestCase {
    func testPasswordAlwaysPresent() {
        XCTAssertEqual(ReauthProjection.methods(totpTabAvailable: false), [.password])
    }

    func testTotpAppendedWhenAvailable() {
        XCTAssertEqual(ReauthProjection.methods(totpTabAvailable: true), [.password, .totp])
    }
}

// MARK: - TOTP sanitiser (web replace(/\D/g,'').slice(0,8))

final class ReauthSanitizeTOTPTests: XCTestCase {
    func testStripsNonDigits() {
        XCTAssertEqual(ReauthProjection.sanitizeTOTP("12a3-4 5"), "12345")
    }

    func testCapsAtEightDigits() {
        XCTAssertEqual(ReauthProjection.sanitizeTOTP("0123456789"), "01234567")
    }

    func testEmptyForNoDigits() {
        XCTAssertEqual(ReauthProjection.sanitizeTOTP("abc-..-"), "")
    }

    func testIgnoresNonASCIIDigits() {
        // Web `\d` (no unicode flag) matches ASCII 0-9 only; Arabic-Indic digits are stripped.
        XCTAssertEqual(ReauthProjection.sanitizeTOTP("12\u{0664}3"), "123")
    }
}

// MARK: - Confirm guard + body + field validation

final class ReauthSubmitGuardTests: XCTestCase {
    func testConfirmMatchesTrimsAndComparesToken() {
        XCTAssertTrue(ReauthProjection.confirmMatches("  CONFIRM "))
        XCTAssertFalse(ReauthProjection.confirmMatches("confirm"))
        XCTAssertFalse(ReauthProjection.confirmMatches("CONFIRMED"))
    }

    func testCredentialBodyCarriesActiveField() {
        let pwd = ReauthProjection.credentialBody(method: .password, password: "p", totp: "1")
        XCTAssertEqual(pwd, ReauthSubmitBody(password: "p"))
        let code = ReauthProjection.credentialBody(method: .totp, password: "p", totp: "1")
        XCTAssertEqual(code, ReauthSubmitBody(totpCode: "1"))
    }

    func testCredentialFieldErrorForEmptyActiveField() {
        let pwd = ReauthProjection.credentialFieldError(
            method: .password, password: "  ", totp: "123456", localize: passthroughLocalize
        )
        XCTAssertEqual(pwd, "Enter your password to continue.")
        let code = ReauthProjection.credentialFieldError(
            method: .totp, password: "secret", totp: "  ", localize: passthroughLocalize
        )
        XCTAssertEqual(code, "Enter the 6-digit code from your authenticator.")
    }

    func testCredentialFieldErrorNilWhenFieldPresent() {
        XCTAssertNil(ReauthProjection.credentialFieldError(
            method: .password, password: "secret", totp: "", localize: passthroughLocalize
        ))
        XCTAssertNil(ReauthProjection.credentialFieldError(
            method: .totp, password: "", totp: "123456", localize: passthroughLocalize
        ))
    }
}

// MARK: - Server-error → message mapping (web catch branch)

final class ReauthSubmitErrorTests: XCTestCase {
    func testNotConfiguredMessage() {
        let message = ReauthProjection.submitErrorMessage(
            code: ReauthErrorCode.notConfigured, message: "", method: .password, localize: passthroughLocalize
        )
        XCTAssertTrue(message.contains("not configured"))
        XCTAssertTrue(message.contains("TESLASYNC_SUDO_PASSWORD"))
    }

    func testInvalidCredentialIsMethodSpecific() {
        let pwd = ReauthProjection.submitErrorMessage(
            code: ReauthErrorCode.invalidCredential, message: "x", method: .password, localize: passthroughLocalize
        )
        XCTAssertEqual(pwd, "Password did not match.")
        let totp = ReauthProjection.submitErrorMessage(
            code: ReauthErrorCode.invalidCredential, message: "x", method: .totp, localize: passthroughLocalize
        )
        XCTAssertEqual(totp, "Authenticator code was rejected.")
    }

    func testUnknownUsesServerMessageElseFallback() {
        let withMessage = ReauthProjection.submitErrorMessage(
            code: nil, message: "HTTP 503", method: .password, localize: passthroughLocalize
        )
        XCTAssertEqual(withMessage, "HTTP 503")
        let blank = ReauthProjection.submitErrorMessage(
            code: "WHATEVER", message: "   ", method: .password, localize: passthroughLocalize
        )
        XCTAssertEqual(blank, "Reauthentication failed.")
    }
}

// MARK: - Mode-driven copy (+ token substitution)

final class ReauthCopyTests: XCTestCase {
    func testTitleByMode() {
        XCTAssertEqual(
            ReauthProjection.title(mode: .credential, localize: passthroughLocalize),
            "Confirm your identity"
        )
        XCTAssertEqual(
            ReauthProjection.title(mode: .confirm, localize: passthroughLocalize),
            "Confirm sensitive action"
        )
    }

    func testSubmitTitleByMode() {
        XCTAssertEqual(ReauthProjection.submitTitle(mode: .credential, localize: passthroughLocalize), "Confirm")
        XCTAssertEqual(ReauthProjection.submitTitle(mode: .confirm, localize: passthroughLocalize), "Continue")
    }

    func testConfirmBodySubstitutesToken() {
        let body = ReauthProjection.bodyText(mode: .confirm, localize: passthroughLocalize)
        XCTAssertEqual(body, "This is a destructive action. Type CONFIRM to continue.")
    }

    func testCredentialBodyCopy() {
        let body = ReauthProjection.bodyText(mode: .credential, localize: passthroughLocalize)
        XCTAssertTrue(body.hasPrefix("For your security"))
    }

    func testConfirmFieldLabelSubstitutesToken() {
        XCTAssertEqual(ReauthProjection.confirmFieldLabel(localize: passthroughLocalize), "Type CONFIRM to confirm")
    }

    func testTypedConfirmationMismatchSubstitutesToken() {
        let message = ReauthProjection.typedConfirmationMismatchMessage(localize: passthroughLocalize)
        XCTAssertEqual(message, "Type CONFIRM exactly to confirm.")
    }

    func testMethodAndFieldLabels() {
        XCTAssertEqual(ReauthProjection.methodLabel(.password, localize: passthroughLocalize), "Password")
        XCTAssertEqual(ReauthProjection.methodLabel(.totp, localize: passthroughLocalize), "Authenticator")
        XCTAssertEqual(ReauthProjection.fieldLabel(.totp, localize: passthroughLocalize), "Authenticator code")
    }
}

// MARK: - Accessibility

final class ReauthAccessibilityTests: XCTestCase {
    func testSummaryIsModeTitle() {
        XCTAssertEqual(
            ReauthAccessibility.summary(mode: .confirm, localize: passthroughLocalize),
            "Confirm sensitive action"
        )
    }

    func testMethodTabLabelAppendsSelectedState() {
        XCTAssertEqual(
            ReauthAccessibility.methodTabLabel(.totp, selected: false, localize: passthroughLocalize),
            "Authenticator"
        )
        XCTAssertEqual(
            ReauthAccessibility.methodTabLabel(.totp, selected: true, localize: passthroughLocalize),
            "Authenticator, selected"
        )
    }

    func testCloseLabel() {
        XCTAssertEqual(ReauthAccessibility.closeLabel(localize: passthroughLocalize), "Close")
    }
}
