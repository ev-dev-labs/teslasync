//
//  AiOutputPanel.Tests.swift
//  TeslaSync — P4 shared surface · 0036 · AiOutputPanel (Apple)
//
//  Unit coverage for the AiOutputPanel surface logic:
//    • Logic — the web `hasAnything` gate, the `text-empty && streaming` thinking predicate, the
//      full render projection (the verbatim port of the JSX ternary, incl. error-takes-precedence
//      over text), and the `error ?? unknown` message resolution.
//    • Accessibility — the spoken label seam across every render branch.
//    • i18n facade — the per-surface table resolves each web key to its English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no store. Per-branch
//  view rendering is covered by the #Preview blocks (compiled by the app targets); the telemetry
//  + render-visibility contract is asserted in `…ModelTests.swift`.
//

import XCTest
@testable import TeslaSync

// MARK: - Render projection (web hasAnything gate + JSX ternary)

@MainActor final class AiOutputPanelLogicTests: XCTestCase {
    func testHasAnythingMatchesWebGate() {
        XCTAssertFalse(AiOutputPanelLogic.hasAnything(text: "", state: .idle))
        XCTAssertFalse(AiOutputPanelLogic.hasAnything(text: "", state: .pausedConfirm))
        XCTAssertTrue(AiOutputPanelLogic.hasAnything(text: "", state: .streaming))
        XCTAssertTrue(AiOutputPanelLogic.hasAnything(text: "", state: .done))
        XCTAssertTrue(AiOutputPanelLogic.hasAnything(text: "", state: .error))
        // Any non-empty text is enough on its own (web `text.length > 0`).
        XCTAssertTrue(AiOutputPanelLogic.hasAnything(text: "hi", state: .idle))
        XCTAssertTrue(AiOutputPanelLogic.hasAnything(text: "hi", state: .pausedConfirm))
    }

    func testThinkingVisibleOnlyWhenStreamingAndEmpty() {
        XCTAssertTrue(AiOutputPanelLogic.thinkingVisible(text: "", state: .streaming))
        XCTAssertFalse(AiOutputPanelLogic.thinkingVisible(text: "x", state: .streaming))
        XCTAssertFalse(AiOutputPanelLogic.thinkingVisible(text: "", state: .done))
        XCTAssertFalse(AiOutputPanelLogic.thinkingVisible(text: "", state: .idle))
    }

    func testRenderHiddenBeforeAnythingStreamed() {
        XCTAssertEqual(AiOutputPanelLogic.render(text: "", state: .idle, error: nil), .hidden)
        XCTAssertEqual(
            AiOutputPanelLogic.render(text: "", state: .pausedConfirm, error: nil),
            .hidden
        )
    }

    func testRenderPendingWhenStreamingEmpty() {
        XCTAssertEqual(AiOutputPanelLogic.render(text: "", state: .streaming, error: nil), .pending)
    }

    func testRenderTextWhenStreamingWithText() {
        XCTAssertEqual(
            AiOutputPanelLogic.render(text: "partial", state: .streaming, error: nil),
            .text("partial")
        )
    }

    func testRenderTextWhenDone() {
        XCTAssertEqual(
            AiOutputPanelLogic.render(text: "answer", state: .done, error: nil),
            .text("answer")
        )
    }

    func testRenderErrorTakesPrecedenceOverText() {
        // Web checks `state === 'error'` before the text branch, so text is suppressed.
        XCTAssertEqual(
            AiOutputPanelLogic.render(text: "ignored", state: .error, error: "boom"),
            .error("boom")
        )
        XCTAssertEqual(
            AiOutputPanelLogic.render(text: "", state: .error, error: nil),
            .error(nil)
        )
    }

    func testResolveErrorMessageFallsBackToUnknown() {
        XCTAssertEqual(AiOutputPanelLogic.resolveErrorMessage(nil, unknown: "unknown"), "unknown")
        XCTAssertEqual(AiOutputPanelLogic.resolveErrorMessage("", unknown: "unknown"), "unknown")
        XCTAssertEqual(AiOutputPanelLogic.resolveErrorMessage("   \n", unknown: "unknown"), "unknown")
        XCTAssertEqual(AiOutputPanelLogic.resolveErrorMessage("429", unknown: "unknown"), "429")
    }
}

// MARK: - Accessibility label seam

@MainActor final class AiOutputPanelAccessibilityTests: XCTestCase {
    private let labels = AiOutputPanelLabels(
        errorLabel: "Helix error:",
        unknownLabel: "unknown",
        thinkingLabel: "Helix is thinking"
    )

    func testHiddenHasNoSpokenLabel() {
        XCTAssertNil(AiOutputPanelLogic.accessibilityLabel(for: .hidden, labels: labels))
    }

    func testErrorLabelComposesLabelAndMessage() {
        XCTAssertEqual(
            AiOutputPanelLogic.accessibilityLabel(for: .error("boom"), labels: labels),
            "Helix error: boom"
        )
    }

    func testErrorLabelUsesUnknownWhenNil() {
        XCTAssertEqual(
            AiOutputPanelLogic.accessibilityLabel(for: .error(nil), labels: labels),
            "Helix error: unknown"
        )
    }

    func testPendingLabelIsThinking() {
        XCTAssertEqual(
            AiOutputPanelLogic.accessibilityLabel(for: .pending, labels: labels),
            "Helix is thinking"
        )
    }

    func testTextLabelIsTheNarrative() {
        XCTAssertEqual(
            AiOutputPanelLogic.accessibilityLabel(for: .text("the answer"), labels: labels),
            "the answer"
        )
    }
}

// MARK: - i18n facade (web `t(key, default)` parity)

@MainActor final class AiOutputPanelStringsTests: XCTestCase {
    func testKeysResolveToWebFallbacks() {
        XCTAssertEqual(AiOutputPanelStrings.errorLabel, "Helix error:")
        XCTAssertEqual(AiOutputPanelStrings.unknownLabel, "unknown")
        XCTAssertEqual(AiOutputPanelStrings.thinkingLabel, "Helix is thinking")
    }

    func testResolvedLabelsBundleTheFacadeValues() {
        let resolved = AiOutputPanelLabels.resolved
        XCTAssertEqual(resolved.errorLabel, "Helix error:")
        XCTAssertEqual(resolved.unknownLabel, "unknown")
        XCTAssertEqual(resolved.thinkingLabel, "Helix is thinking")
    }

    func testFacadeTableNameIsStable() {
        XCTAssertEqual(AiOutputPanelStrings.table, "AiOutputPanel")
    }
}
