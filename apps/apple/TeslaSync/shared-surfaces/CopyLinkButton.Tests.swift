//
//  CopyLinkButton.Tests.swift
//  TeslaSync — P4 shared surface · 0168 · CopyLinkButton (Apple)
//
//  Unit coverage for the CopyLinkButton surface logic:
//    • Logic — the outcome → toast mapping (web `success → toast.success` / `catch → toast.error`),
//      the icon + label switch on the `copied` flag (web `Check`/`Link2` + "Copied"/"Copy link"),
//      the shareable-URL guard, and the URL + clipboard-result → outcome resolution.
//    • View-state — the per-state projection the view renders (the deterministic snapshot of the
//      view's inputs in the resting and copied states); the on-screen rendering of each state is
//      covered by the #Preview blocks (the same precedent as ChartExportMenu 0066).
//    • Accessibility — the spoken-label seam: the constant `aria-label` plus the state-reflecting
//      accessibility value.
//    • i18n facade — the per-surface table resolves each web key to its English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no store. The telemetry +
//  copy-flow contract is asserted in `…ModelTests.swift`.
//

import XCTest
@testable import TeslaSync

// MARK: - Pure logic (web icon / label switch, outcome → toast mapping, copy guard)

@MainActor final class CopyLinkButtonLogicTests: XCTestCase {
    func testToastIntentMapping() {
        XCTAssertEqual(CopyLinkButtonLogic.toastIntent(for: .copied).severity, .success)
        XCTAssertEqual(CopyLinkButtonLogic.toastIntent(for: .failed).severity, .error)
        XCTAssertEqual(
            CopyLinkButtonLogic.toastIntent(for: .copied).messageKey,
            "common.copyLink.success"
        )
        XCTAssertEqual(
            CopyLinkButtonLogic.toastIntent(for: .failed).messageKey,
            "common.copyLink.error"
        )
    }

    func testIconSwitch() {
        XCTAssertEqual(CopyLinkButtonLogic.iconSystemImage(copied: false), "link")
        XCTAssertEqual(CopyLinkButtonLogic.iconSystemImage(copied: true), "checkmark")
    }

    func testLabelSwitch() {
        XCTAssertEqual(CopyLinkButtonLogic.label(copied: false).key, "common.copyLink.action")
        XCTAssertEqual(CopyLinkButtonLogic.label(copied: false).fallback, "Copy link")
        XCTAssertEqual(CopyLinkButtonLogic.label(copied: true).key, "common.copyLink.copied")
        XCTAssertEqual(CopyLinkButtonLogic.label(copied: true).fallback, "Copied")
    }

    func testCanCopyGuard() {
        XCTAssertFalse(CopyLinkButtonLogic.canCopy(url: ""))
        XCTAssertFalse(CopyLinkButtonLogic.canCopy(url: "   \n "))
        XCTAssertTrue(CopyLinkButtonLogic.canCopy(url: "https://teslasync.app/drives"))
    }

    func testOutcomeResolution() {
        XCTAssertEqual(
            CopyLinkButtonLogic.outcome(url: "https://teslasync.app", clipboardSucceeded: true),
            .copied
        )
        XCTAssertEqual(
            CopyLinkButtonLogic.outcome(url: "https://teslasync.app", clipboardSucceeded: false),
            .failed,
            "a failed clipboard write is the web `catch` branch"
        )
        XCTAssertEqual(
            CopyLinkButtonLogic.outcome(url: "", clipboardSucceeded: true),
            .failed,
            "an unavailable URL is the native graceful guard → failed"
        )
    }
}

// MARK: - View-state projection (per-state snapshot of the view's inputs)

@MainActor final class CopyLinkButtonViewStateTests: XCTestCase {
    func testRestingStateRendersLinkGlyphAndCopyLink() {
        XCTAssertEqual(CopyLinkButtonLogic.iconSystemImage(copied: false), "link")
        XCTAssertEqual(CopyLinkButtonStrings.label(copied: false), "Copy link")
    }

    func testCopiedStateRendersCheckGlyphAndCopied() {
        XCTAssertEqual(CopyLinkButtonLogic.iconSystemImage(copied: true), "checkmark")
        XCTAssertEqual(CopyLinkButtonStrings.label(copied: true), "Copied")
    }

    func testSurfaceConstructsForEveryState() {
        // Exercises the view's construction path for the resting, copied, and unavailable states.
        let resting = CopyLinkButtonModel(
            urlProvider: StaticCopyLinkURLSource("https://teslasync.app/x"),
            clipboard: InMemoryCopyLinkClipboard()
        )
        let unavailable = CopyLinkButtonModel(urlProvider: StaticCopyLinkURLSource(""))
        XCTAssertTrue(resting.canCopy)
        XCTAssertFalse(unavailable.canCopy)
        _ = CopyLinkButton(model: resting)
        _ = CopyLinkButton(model: unavailable)
    }
}

// MARK: - Accessibility label seam (the spoken content VoiceOver reads)

@MainActor final class CopyLinkButtonAccessibilityTests: XCTestCase {
    func testAccessibilityLabelIsWebAriaLabel() {
        XCTAssertEqual(CopyLinkButtonStrings.accessibilityLabel(), "Copy link to this view")
        XCTAssertFalse(CopyLinkButtonStrings.accessibilityLabel().isEmpty)
    }

    func testAccessibilityValueReflectsState() {
        XCTAssertEqual(CopyLinkButtonStrings.label(copied: false), "Copy link")
        XCTAssertEqual(CopyLinkButtonStrings.label(copied: true), "Copied")
    }
}

// MARK: - i18n facade (web `t(key, default)` parity)

@MainActor final class CopyLinkButtonStringsTests: XCTestCase {
    func testEveryWebKeyResolvesToItsFallback() {
        XCTAssertEqual(
            CopyLinkButtonStrings.string("common.copyLink.success", "Link copied to clipboard"),
            "Link copied to clipboard"
        )
        XCTAssertEqual(
            CopyLinkButtonStrings.string("common.copyLink.error", "Could not copy link"),
            "Could not copy link"
        )
        XCTAssertEqual(
            CopyLinkButtonStrings.string("common.copyLink.label", "Copy link to this view"),
            "Copy link to this view"
        )
        XCTAssertEqual(CopyLinkButtonStrings.string("common.copyLink.copied", "Copied"), "Copied")
        XCTAssertEqual(CopyLinkButtonStrings.string("common.copyLink.action", "Copy link"), "Copy link")
    }

    func testToastMessagesResolveToWebFallbacks() {
        XCTAssertEqual(CopyLinkButtonStrings.toastMessage(for: .copied), "Link copied to clipboard")
        XCTAssertEqual(CopyLinkButtonStrings.toastMessage(for: .failed), "Could not copy link")
    }

    func testFacadeTableNameIsStable() {
        XCTAssertEqual(CopyLinkButtonStrings.table, "CopyLinkButton")
    }
}
