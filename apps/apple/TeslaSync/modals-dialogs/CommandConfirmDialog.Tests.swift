//
//  CommandConfirmDialog.Tests.swift
//  TeslaSync — P4 modal / dialog · 0029 · CommandConfirmDialog (Apple)
//
//  Adapter + projection + accessibility coverage for the CommandConfirmDialog surface:
//    • `CommandConfirmProjection.initialRemaining` / `decremented` / `countdownActive` — the countdown
//      arithmetic (web `def.countdown ?? 0` + the `setInterval` `prev <= 1 ? 0 : prev - 1`).
//    • `CommandConfirmProjection.hasTypedGate` / `inputMatches` — the web `confirmInput` truthiness +
//      the case-insensitive, trimmed `toUpperCase()` comparison.
//    • `CommandConfirmProjection.canConfirm` / `confirmDisabled` — the web `canConfirm` gate + the
//      disabled rule.
//    • `CommandConfirmProjection.resolvePhase` / `resolveVisibility` / `inlineFailure` — the body
//      phase, the visibility machine (incl. pinned), and the inline envelope.
//    • `CommandConfirmProjection.messageText` / `confirmButtonTitle` / `cancelButtonTitle` /
//      `typeToConfirmLabel` — the copy + the `{{word}}` / `{{seconds}}` substitutions.
//    • `CommandConfirmAccessibility` — the dialog summary, the "Warning"-prefixed message, the
//      countdown value, and the close VoiceOver copy.
//
//  Pure, bundle-free: copy resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the real copy (the
/// projection then applies any `{{word}}` / `{{seconds}}` / `{{label}}` substitution on top).
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - Countdown arithmetic (web def.countdown + setInterval)

final class CommandConfirmCountdownTests: XCTestCase {
    func testInitialRemainingClampsNegative() {
        XCTAssertEqual(CommandConfirmProjection.initialRemaining(countdown: 5), 5)
        XCTAssertEqual(CommandConfirmProjection.initialRemaining(countdown: 0), 0)
        XCTAssertEqual(CommandConfirmProjection.initialRemaining(countdown: -3), 0)
    }

    func testDecrementMirrorsWeb() {
        XCTAssertEqual(CommandConfirmProjection.decremented(remaining: 5), 4)
        XCTAssertEqual(CommandConfirmProjection.decremented(remaining: 1), 0)
        XCTAssertEqual(CommandConfirmProjection.decremented(remaining: 0), 0)
    }

    func testCountdownActive() {
        XCTAssertTrue(CommandConfirmProjection.countdownActive(remaining: 1))
        XCTAssertFalse(CommandConfirmProjection.countdownActive(remaining: 0))
    }
}

// MARK: - Typed gate + canConfirm + disabled (web confirmInput / canConfirm)

final class CommandConfirmGateTests: XCTestCase {
    func testHasTypedGateMirrorsTruthiness() {
        XCTAssertFalse(CommandConfirmProjection.hasTypedGate(confirmInput: nil))
        XCTAssertFalse(CommandConfirmProjection.hasTypedGate(confirmInput: ""))
        XCTAssertTrue(CommandConfirmProjection.hasTypedGate(confirmInput: "ERASE"))
    }

    func testNoGateAlwaysMatches() {
        XCTAssertTrue(CommandConfirmProjection.inputMatches(confirmInput: nil, typed: ""))
        XCTAssertTrue(CommandConfirmProjection.inputMatches(confirmInput: "", typed: "anything"))
    }

    func testGateMatchesCaseInsensitivelyAfterTrim() {
        XCTAssertFalse(CommandConfirmProjection.inputMatches(confirmInput: "ERASE", typed: ""))
        XCTAssertFalse(CommandConfirmProjection.inputMatches(confirmInput: "ERASE", typed: "eras"))
        // Web: input.trim().toUpperCase() === confirmInput.toUpperCase().
        XCTAssertTrue(CommandConfirmProjection.inputMatches(confirmInput: "ERASE", typed: "erase"))
        XCTAssertTrue(CommandConfirmProjection.inputMatches(confirmInput: "ERASE", typed: "  ErAsE \n"))
        // The required word is matched case-insensitively even when supplied lower-case.
        XCTAssertTrue(CommandConfirmProjection.inputMatches(confirmInput: "erase", typed: "ERASE"))
    }

    func testCanConfirmRequiresElapsedCountdownAndMatch() {
        // Countdown still running blocks confirm even with no typed gate.
        XCTAssertFalse(CommandConfirmProjection.canConfirm(remaining: 2, confirmInput: nil, typed: ""))
        // Elapsed countdown, no gate → confirmable.
        XCTAssertTrue(CommandConfirmProjection.canConfirm(remaining: 0, confirmInput: nil, typed: ""))
        // Elapsed countdown, gate unmet → blocked.
        XCTAssertFalse(CommandConfirmProjection.canConfirm(remaining: 0, confirmInput: "ERASE", typed: "no"))
        // Elapsed countdown, gate met → confirmable.
        XCTAssertTrue(CommandConfirmProjection.canConfirm(remaining: 0, confirmInput: "ERASE", typed: "erase"))
    }

    func testConfirmDisabledMirrorsWeb() {
        XCTAssertTrue(CommandConfirmProjection.confirmDisabled(busy: true, canConfirm: true))
        XCTAssertTrue(CommandConfirmProjection.confirmDisabled(busy: false, canConfirm: false))
        XCTAssertFalse(CommandConfirmProjection.confirmDisabled(busy: false, canConfirm: true))
    }
}

// MARK: - phase / visibility / inline failure

final class CommandConfirmVisibilityTests: XCTestCase {
    func testBodyPhase() {
        XCTAssertEqual(CommandConfirmProjection.resolvePhase(status: .loading, hasRequest: false), .loading)
        XCTAssertEqual(CommandConfirmProjection.resolvePhase(status: .loading, hasRequest: true), .content)
        XCTAssertEqual(CommandConfirmProjection.resolvePhase(status: .loaded, hasRequest: false), .empty)
        XCTAssertEqual(CommandConfirmProjection.resolvePhase(status: .loaded, hasRequest: true), .content)
        XCTAssertEqual(CommandConfirmProjection.resolvePhase(status: .failed("x"), hasRequest: false), .error("x"))
        XCTAssertEqual(CommandConfirmProjection.resolvePhase(status: .failed("x"), hasRequest: true), .content)
    }

    func testVisibilityPresentsWithRequestAndHidesWithout() {
        XCTAssertEqual(CommandConfirmProjection.resolveVisibility(hasRequest: true, pinned: false), .presented)
        XCTAssertEqual(CommandConfirmProjection.resolveVisibility(hasRequest: false, pinned: false), .hidden)
    }

    func testPinnedSuppressesAmbientHide() {
        XCTAssertEqual(CommandConfirmProjection.resolveVisibility(hasRequest: false, pinned: true), .presented)
    }

    func testInlineFailureEnvelope() {
        XCTAssertEqual(CommandConfirmProjection.inlineFailure(status: .failed("boom"), hasRequest: true), "boom")
        XCTAssertNil(CommandConfirmProjection.inlineFailure(status: .failed("boom"), hasRequest: false))
        XCTAssertNil(CommandConfirmProjection.inlineFailure(status: .loaded, hasRequest: true))
    }
}

// MARK: - Copy (message default / confirm title / cancel / type-to-confirm)

final class CommandConfirmCopyTests: XCTestCase {
    private func request(message: String = "", confirmInput: String? = nil) -> CommandConfirmRequest {
        CommandConfirmRequest(commandID: "cmd", title: "Lock?", message: message, confirmInput: confirmInput)
    }

    func testMessageFallsBackToAreYouSure() {
        XCTAssertEqual(
            CommandConfirmProjection.messageText(request(), localize: passthroughLocalize),
            "Are you sure?"
        )
        XCTAssertEqual(
            CommandConfirmProjection.messageText(request(message: "   "), localize: passthroughLocalize),
            "Are you sure?"
        )
        XCTAssertEqual(
            CommandConfirmProjection.messageText(request(message: "Lock now?"), localize: passthroughLocalize),
            "Lock now?"
        )
    }

    func testConfirmButtonTitleShowsCountdownSuffix() {
        XCTAssertEqual(
            CommandConfirmProjection.confirmButtonTitle(remaining: 0, localize: passthroughLocalize),
            "Confirm"
        )
        XCTAssertEqual(
            CommandConfirmProjection.confirmButtonTitle(remaining: 5, localize: passthroughLocalize),
            "Confirm (5s)"
        )
    }

    func testCancelButtonTitle() {
        XCTAssertEqual(CommandConfirmProjection.cancelButtonTitle(localize: passthroughLocalize), "Cancel")
    }

    func testTypeToConfirmLabelTemplate() {
        // No gate → empty label.
        XCTAssertEqual(
            CommandConfirmProjection.typeToConfirmLabel(confirmInput: nil, localize: passthroughLocalize), ""
        )
        XCTAssertEqual(
            CommandConfirmProjection.typeToConfirmLabel(confirmInput: "", localize: passthroughLocalize), ""
        )
        // Gate → template with the required word substituted.
        XCTAssertEqual(
            CommandConfirmProjection.typeToConfirmLabel(confirmInput: "ERASE", localize: passthroughLocalize),
            "Type \"ERASE\" to confirm:"
        )
    }
}

// MARK: - Accessibility

final class CommandConfirmAccessibilityTests: XCTestCase {
    func testSummaryUsesTitleAndFallsBack() {
        XCTAssertEqual(
            CommandConfirmAccessibility.summary(title: "Lock vehicle?", localize: passthroughLocalize),
            "Lock vehicle?"
        )
        XCTAssertEqual(CommandConfirmAccessibility.summary(title: "  ", localize: passthroughLocalize), "Confirm")
    }

    func testMessageLabelPrefixesWarning() {
        XCTAssertEqual(
            CommandConfirmAccessibility.messageLabel(message: "This is permanent.", localize: passthroughLocalize),
            "Warning. This is permanent."
        )
        XCTAssertEqual(
            CommandConfirmAccessibility.messageLabel(message: "  ", localize: passthroughLocalize), "Warning"
        )
    }

    func testCountdownValueOnlyWhileTicking() {
        XCTAssertEqual(CommandConfirmAccessibility.countdownValue(remaining: 0, localize: passthroughLocalize), "")
        XCTAssertEqual(
            CommandConfirmAccessibility.countdownValue(remaining: 3, localize: passthroughLocalize),
            "Available in 3 seconds"
        )
    }

    func testTypedFieldLabelPassesThrough() {
        XCTAssertEqual(
            CommandConfirmAccessibility.typedFieldLabel("Type \"X\" to confirm:"), "Type \"X\" to confirm:"
        )
    }

    func testCloseLabel() {
        XCTAssertEqual(CommandConfirmAccessibility.closeLabel(localize: passthroughLocalize), "Close")
    }
}
