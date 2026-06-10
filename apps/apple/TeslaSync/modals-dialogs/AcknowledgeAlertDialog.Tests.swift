//
//  AcknowledgeAlertDialog.Tests.swift
//  TeslaSync — P4 modal/dialog · 0017 · AcknowledgeAlertDialog (Apple)
//
//  Adapter + projection + accessibility coverage for the AcknowledgeAlertDialog surface:
//    • `AckAlertProjection.resolvePhase` — the loading / empty / error / content envelope rules.
//    • `AckAlertProjection.length` / `trimmedNote` / `isTooLong` — the web `.length` + `trim` + `> NOTE_MAX`.
//    • `AckAlertProjection.clampToInputLimit` — the web `maxLength={NOTE_MAX + 50}` cap (grapheme-safe).
//    • `AckAlertProjection.submitBody` / `submitDisabled` / `fieldError` — the submit guards.
//    • `AckAlertProjection.submitErrorMessage` — the server-message / fallback branch.
//    • copy (title / label / prompt / hint with `{{max}}` / cancel / submit).
//    • `AckAlertAccessibility` — the dialog summary, close, and note-count VoiceOver content.
//
//  Pure, bundle-free: copy resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the real copy without a
/// bundle (the projection then applies any `{{max}}` / `{{count}}` substitution on top).
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - Phase resolution

final class AckAlertPhaseTests: XCTestCase {
    private let context = AckAlertContext(alertID: "a1", title: "High temp")

    func testLoadingResolvesByContextPresence() {
        XCTAssertEqual(AckAlertProjection.resolvePhase(status: .loading, context: nil), .loading)
        XCTAssertEqual(AckAlertProjection.resolvePhase(status: .loading, context: context), .content)
    }

    func testLoadedNoContextResolvesEmpty() {
        XCTAssertEqual(AckAlertProjection.resolvePhase(status: .loaded, context: nil), .empty)
    }

    func testLoadedWithContextResolvesContent() {
        XCTAssertEqual(AckAlertProjection.resolvePhase(status: .loaded, context: context), .content)
    }

    func testFailedResolvesErrorOrKeepsContent() {
        XCTAssertEqual(AckAlertProjection.resolvePhase(status: .failed("boom"), context: nil), .error("boom"))
        XCTAssertEqual(AckAlertProjection.resolvePhase(status: .failed("boom"), context: context), .content)
    }
}

// MARK: - Length / trim / too-long (web .length, trim, > NOTE_MAX)

final class AckAlertNoteLimitTests: XCTestCase {
    func testLengthCountsUTF16Units() {
        XCTAssertEqual(AckAlertProjection.length("abc"), 3)
        // Web `.length` counts UTF-16 code units: an astral emoji is 2 units (a surrogate pair).
        XCTAssertEqual(AckAlertProjection.length("🚗"), 2)
    }

    func testTrimmedNoteStripsWhitespace() {
        XCTAssertEqual(AckAlertProjection.trimmedNote("  hi \n"), "hi")
    }

    func testIsTooLongAtBoundary() {
        XCTAssertFalse(AckAlertProjection.isTooLong(String(repeating: "a", count: 1000)))
        XCTAssertTrue(AckAlertProjection.isTooLong(String(repeating: "a", count: 1001)))
    }

    func testIsTooLongUsesTrimmedValue() {
        let padded = "  " + String(repeating: "a", count: 1000) + "  "
        XCTAssertFalse(AckAlertProjection.isTooLong(padded))
    }

    func testClampLeavesShortNotesUnchanged() {
        let value = String(repeating: "a", count: 1050)
        XCTAssertEqual(AckAlertProjection.clampToInputLimit(value), value)
    }

    func testClampTruncatesAtInputLimit() {
        let clamped = AckAlertProjection.clampToInputLimit(String(repeating: "a", count: 1100))
        XCTAssertEqual(AckAlertProjection.length(clamped), 1050)
    }

    func testClampDoesNotSplitGrapheme() {
        // 1049 ASCII + a 2-unit emoji = 1051 units; the emoji would overflow the 1050 cap, so it is
        // dropped whole rather than split into a lone surrogate.
        let clamped = AckAlertProjection.clampToInputLimit(String(repeating: "a", count: 1049) + "🚗")
        XCTAssertEqual(clamped, String(repeating: "a", count: 1049))
        XCTAssertEqual(AckAlertProjection.length(clamped), 1049)
    }
}

// MARK: - Submit guards (body / disabled / field error)

final class AckAlertSubmitGuardTests: XCTestCase {
    func testSubmitBodyTrimsNote() {
        XCTAssertEqual(AckAlertProjection.submitBody(for: "  done \n"), AckAlertSubmitBody(note: "done"))
    }

    func testSubmitBodyAllowsEmptyNote() {
        XCTAssertEqual(AckAlertProjection.submitBody(for: "   "), AckAlertSubmitBody(note: ""))
    }

    func testSubmitDisabledWhenSubmittingOrTooLong() {
        XCTAssertTrue(AckAlertProjection.submitDisabled(submitting: true, note: "ok"))
        XCTAssertTrue(AckAlertProjection.submitDisabled(submitting: false, note: String(repeating: "a", count: 1001)))
        XCTAssertFalse(AckAlertProjection.submitDisabled(submitting: false, note: "ok"))
        // Empty note is allowed (the backend records an ack with no note).
        XCTAssertFalse(AckAlertProjection.submitDisabled(submitting: false, note: ""))
    }

    func testFieldErrorOnlyWhenTooLong() {
        XCTAssertNil(AckAlertProjection.fieldError(note: "ok", localize: passthroughLocalize))
        let error = AckAlertProjection.fieldError(
            note: String(repeating: "a", count: 1001),
            localize: passthroughLocalize
        )
        XCTAssertEqual(error, "Up to 1000 characters. Shared in the audit timeline.")
    }
}

// MARK: - Server-error → message mapping

final class AckAlertSubmitErrorTests: XCTestCase {
    func testUsesServerMessageWhenPresent() {
        let message = AckAlertProjection.submitErrorMessage("HTTP 503", localize: passthroughLocalize)
        XCTAssertEqual(message, "HTTP 503")
    }

    func testFallsBackWhenMessageBlank() {
        let message = AckAlertProjection.submitErrorMessage("   ", localize: passthroughLocalize)
        XCTAssertEqual(message, "Couldn't acknowledge the alert. Try again.")
    }
}

// MARK: - Copy (+ token substitution)

final class AckAlertCopyTests: XCTestCase {
    func testStaticCopy() {
        XCTAssertEqual(AckAlertProjection.dialogTitle(localize: passthroughLocalize), "Acknowledge alert")
        XCTAssertEqual(AckAlertProjection.noteLabel(localize: passthroughLocalize), "Note (optional)")
        XCTAssertEqual(
            AckAlertProjection.notePromptText(localize: passthroughLocalize),
            "Optional: what's being done?"
        )
        XCTAssertEqual(AckAlertProjection.cancelTitle(localize: passthroughLocalize), "Cancel")
        XCTAssertEqual(AckAlertProjection.submitTitle(localize: passthroughLocalize), "Acknowledge")
    }

    func testNoteHintSubstitutesMax() {
        XCTAssertEqual(
            AckAlertProjection.noteHint(localize: passthroughLocalize),
            "Up to 1000 characters. Shared in the audit timeline."
        )
    }
}

// MARK: - Accessibility

final class AckAlertAccessibilityTests: XCTestCase {
    func testSummaryIsTitleAloneWhenNoSubtitle() {
        XCTAssertEqual(
            AckAlertAccessibility.summary(title: nil, localize: passthroughLocalize),
            "Acknowledge alert"
        )
        XCTAssertEqual(
            AckAlertAccessibility.summary(title: "   ", localize: passthroughLocalize),
            "Acknowledge alert"
        )
    }

    func testSummaryAppendsSubtitle() {
        XCTAssertEqual(
            AckAlertAccessibility.summary(title: "High temp", localize: passthroughLocalize),
            "Acknowledge alert, High temp"
        )
    }

    func testCloseLabel() {
        XCTAssertEqual(AckAlertAccessibility.closeLabel(localize: passthroughLocalize), "Close")
    }

    func testNoteCountLabelSubstitutesCountAndMax() {
        XCTAssertEqual(
            AckAlertAccessibility.noteCountLabel(note: "abcd", localize: passthroughLocalize),
            "4 of 1000 characters"
        )
    }
}
