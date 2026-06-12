//
//  CopyButton.Tests.swift
//  TeslaSync — P4 shared surface · 0207 · CopyButton (Apple)
//
//  Unit coverage for the CopyButton surface logic:
//    • Logic — the icon switch on the `copied` flag (web `Copy` / `CheckCircle`), the visible-label
//      resolution (web `label ?? (copied ? copiedLabel : copyLabel)`), the accessibility-label
//      resolution (web `ariaLabel ?? (iconOnly ? … : undefined)`), the outcome → toast mapping (web
//      `success → toast.success` / `catch → toast.error`), and the clipboard-result → outcome.
//    • View-state — the per-state projection the view renders (the deterministic snapshot of the
//      view's inputs in the resting / copied / icon-only / disabled / custom-label states); the
//      on-screen rendering is covered by the #Preview blocks (precedent: ChartExportMenu 0066).
//    • Accessibility — the spoken-label seam: a non-empty, state-reflecting accessibility label.
//    • i18n facade — the per-surface table resolves each web key to its English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no store. The telemetry +
//  copy-flow contract is asserted in `…ModelTests.swift`.
//

import XCTest
@testable import TeslaSync

// MARK: - Pure logic (web icon / label / aria switch, outcome → toast mapping)

@MainActor final class CopyButtonLogicTests: XCTestCase {
    private let labels = CopyButtonLabelStrings(copy: "Copy", copied: "Copied")

    func testIconSwitch() {
        XCTAssertEqual(CopyButtonLogic.iconSystemImage(copied: false), "doc.on.doc")
        XCTAssertEqual(CopyButtonLogic.iconSystemImage(copied: true), "checkmark.circle")
    }

    func testVisibleLabelDefaultTogglesWithCopied() {
        XCTAssertEqual(
            CopyButtonLogic.visibleLabel(labelOverride: nil, copied: false, labels: labels),
            "Copy"
        )
        XCTAssertEqual(
            CopyButtonLogic.visibleLabel(labelOverride: nil, copied: true, labels: labels),
            "Copied"
        )
    }

    func testVisibleLabelOverrideWinsAndDoesNotToggle() {
        for copied in [false, true] {
            XCTAssertEqual(
                CopyButtonLogic.visibleLabel(labelOverride: "Copy link", copied: copied, labels: labels),
                "Copy link",
                "a caller `label` override stays fixed regardless of the copied flag (web parity)"
            )
        }
    }

    func testAccessibilityLabelAriaOverrideWins() {
        XCTAssertEqual(
            CopyButtonLogic.accessibilityLabel(
                ariaLabel: "Copy the API token",
                iconOnly: true,
                labelOverride: "ignored",
                copied: true,
                labels: labels
            ),
            "Copy the API token"
        )
    }

    func testAccessibilityLabelIconOnlyReflectsState() {
        XCTAssertEqual(
            CopyButtonLogic.accessibilityLabel(
                ariaLabel: nil,
                iconOnly: true,
                labelOverride: nil,
                copied: false,
                labels: labels
            ),
            "Copy"
        )
        XCTAssertEqual(
            CopyButtonLogic.accessibilityLabel(
                ariaLabel: nil,
                iconOnly: true,
                labelOverride: nil,
                copied: true,
                labels: labels
            ),
            "Copied"
        )
    }

    func testAccessibilityLabelIconOnlyUsesOverrideWhenNotCopied() {
        XCTAssertEqual(
            CopyButtonLogic.accessibilityLabel(
                ariaLabel: nil,
                iconOnly: true,
                labelOverride: "Copy link",
                copied: false,
                labels: labels
            ),
            "Copy link"
        )
        XCTAssertEqual(
            CopyButtonLogic.accessibilityLabel(
                ariaLabel: nil,
                iconOnly: true,
                labelOverride: "Copy link",
                copied: true,
                labels: labels
            ),
            "Copied",
            "the icon-only confirmed state announces the confirmed label, not the override (web parity)"
        )
    }

    func testAccessibilityLabelLabelledMatchesVisibleText() {
        XCTAssertEqual(
            CopyButtonLogic.accessibilityLabel(
                ariaLabel: nil,
                iconOnly: false,
                labelOverride: nil,
                copied: false,
                labels: labels
            ),
            "Copy"
        )
        XCTAssertEqual(
            CopyButtonLogic.accessibilityLabel(
                ariaLabel: nil,
                iconOnly: false,
                labelOverride: "Copy link",
                copied: true,
                labels: labels
            ),
            "Copy link",
            "a labelled button speaks its visible text (web leaves aria-label undefined)"
        )
    }

    func testToastIntentMapping() {
        XCTAssertEqual(CopyButtonLogic.toastIntent(for: .copied).severity, .success)
        XCTAssertEqual(CopyButtonLogic.toastIntent(for: .failed).severity, .error)
        XCTAssertEqual(
            CopyButtonLogic.toastIntent(for: .copied).messageKey,
            "common.copyButton.successToast"
        )
        XCTAssertEqual(
            CopyButtonLogic.toastIntent(for: .failed).messageKey,
            "common.copyButton.errorToast"
        )
    }

    func testOutcomeResolution() {
        XCTAssertEqual(CopyButtonLogic.outcome(clipboardSucceeded: true), .copied)
        XCTAssertEqual(
            CopyButtonLogic.outcome(clipboardSucceeded: false),
            .failed,
            "a failed clipboard write is the web `catch` branch"
        )
    }
}

// MARK: - View-state projection (per-state snapshot of the view's inputs)

@MainActor final class CopyButtonViewStateTests: XCTestCase {
    func testRestingStateRendersCopyGlyphAndCopy() {
        XCTAssertEqual(CopyButtonLogic.iconSystemImage(copied: false), "doc.on.doc")
        XCTAssertEqual(CopyButtonStrings.visibleLabel(labelOverride: nil, copied: false), "Copy")
    }

    func testCopiedStateRendersCheckGlyphAndCopied() {
        XCTAssertEqual(CopyButtonLogic.iconSystemImage(copied: true), "checkmark.circle")
        XCTAssertEqual(CopyButtonStrings.visibleLabel(labelOverride: nil, copied: true), "Copied")
    }

    func testSurfaceConstructsForEveryState() {
        // Exercises the view's construction path for the resting, copied, icon-only, disabled, and
        // custom-label states.
        let resting = CopyButton(text: "abc")
        let iconOnly = CopyButton(text: "abc", iconOnly: true)
        let labelled = CopyButton(text: "abc", label: "Copy link")
        let disabled = CopyButton(text: "", disabled: true)
        let copiedModel = CopyButtonModel(
            textProvider: StaticCopyButtonTextSource("abc"),
            clipboard: InMemoryCopyButtonClipboard()
        )
        copiedModel.copyText()
        XCTAssertTrue(copiedModel.copied)
        let copied = CopyButton(model: copiedModel)
        _ = (resting, iconOnly, labelled, disabled, copied)
    }
}

// MARK: - Accessibility label seam (the spoken content VoiceOver reads)

@MainActor final class CopyButtonAccessibilityTests: XCTestCase {
    func testAccessibilityLabelIsNeverEmpty() {
        XCTAssertFalse(
            CopyButtonStrings.accessibilityLabel(
                ariaLabel: nil,
                iconOnly: true,
                labelOverride: nil,
                copied: false
            ).isEmpty
        )
    }

    func testAccessibilityLabelReflectsState() {
        XCTAssertEqual(
            CopyButtonStrings.accessibilityLabel(
                ariaLabel: nil,
                iconOnly: false,
                labelOverride: nil,
                copied: false
            ),
            "Copy"
        )
        XCTAssertEqual(
            CopyButtonStrings.accessibilityLabel(
                ariaLabel: nil,
                iconOnly: false,
                labelOverride: nil,
                copied: true
            ),
            "Copied"
        )
    }
}

// MARK: - i18n facade (web `t(key, default)` parity)

@MainActor final class CopyButtonStringsTests: XCTestCase {
    func testEveryWebKeyResolvesToItsFallback() {
        XCTAssertEqual(CopyButtonStrings.string("common.copyButton.copy", "Copy"), "Copy")
        XCTAssertEqual(CopyButtonStrings.string("common.copyButton.copied", "Copied"), "Copied")
        XCTAssertEqual(
            CopyButtonStrings.string("common.copyButton.successToast", "Copied to clipboard"),
            "Copied to clipboard"
        )
        XCTAssertEqual(
            CopyButtonStrings.string("common.copyButton.errorToast", "Failed to copy"),
            "Failed to copy"
        )
    }

    func testToastMessagesResolveToWebFallbacks() {
        XCTAssertEqual(CopyButtonStrings.toastMessage(for: .copied), "Copied to clipboard")
        XCTAssertEqual(CopyButtonStrings.toastMessage(for: .failed), "Failed to copy")
    }

    func testLabelHelpersResolveToWebFallbacks() {
        XCTAssertEqual(CopyButtonStrings.copyLabel(), "Copy")
        XCTAssertEqual(CopyButtonStrings.copiedLabel(), "Copied")
    }

    func testFacadeTableNameIsStable() {
        XCTAssertEqual(CopyButtonStrings.table, "CopyButton")
    }
}
