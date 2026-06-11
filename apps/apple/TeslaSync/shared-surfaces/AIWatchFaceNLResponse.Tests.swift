//
//  AIWatchFaceNLResponse.Tests.swift
//  TeslaSync — P4 shared surface · 0060 · AIWatchFaceNLResponse (Apple)
//
//  Unit coverage for the AIWatchFaceNLResponse surface:
//    • Adapter — the request-body projection (the web `body` useMemo + `trimmedMessage`,
//      including the empty → `nil` / `undefined` glance-summary case) and the within-cap gate
//      (web `messageWithinCap`, incl. the MaxMessageChars cap) + the wiring identity.
//    • Logic — the prompt/stream-lifecycle button logic (isBusy / canStart / buttonDisabled /
//      output visibility / thinking / idle-invite / over-cap hint), with the surface's
//      distinguishing rule that an EMPTY prompt is allowed.
//    • Accessibility — the spoken summary across phases.
//    • i18n facade — the per-surface table resolves each key to its English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store. Per-state view rendering is covered by the #Preview blocks (compiled by the app
//  targets); the per-state *behaviour* is asserted in `…ModelTests.swift`.
//

import XCTest
@testable import TeslaSync

// MARK: - Request projection (web `body` useMemo + within-cap gate)

@MainActor final class WatchFaceNLRequestTests: XCTestCase {
    func testProjectTrimsNonEmptyPrompt() {
        let request = WatchFaceNLRequest.project(rawMessage: "  How is my battery?\n")
        XCTAssertEqual(request.message, "How is my battery?")
    }

    func testEmptyPromptProjectsToNilForDefaultSummary() {
        // Web `message: trimmedMessage.length > 0 ? trimmedMessage : undefined` — an empty or
        // whitespace-only prompt drops to nil so the body is `{}` and the backend applies its
        // deterministic glance-summary default.
        XCTAssertNil(WatchFaceNLRequest.project(rawMessage: "").message)
        XCTAssertNil(WatchFaceNLRequest.project(rawMessage: "   \n\t ").message)
    }

    func testEmptyPromptIsWithinCap() {
        // Empty is allowed — the within-cap gate is satisfied at length 0.
        XCTAssertTrue(WatchFaceNLRequest.project(rawMessage: "").isWithinCap)
        XCTAssertTrue(WatchFaceNLRequest.project(rawMessage: "hi").isWithinCap)
    }

    func testWithinCapAtAndOverTheCap() {
        let cap = WatchFaceNLConstants.maxMessageChars
        let atCap = String(repeating: "a", count: cap)
        let overCap = String(repeating: "a", count: cap + 1)
        XCTAssertTrue(WatchFaceNLRequest(message: atCap).isWithinCap)
        XCTAssertFalse(WatchFaceNLRequest(message: overCap).isWithinCap)
    }

    func testWithinCapGateMirrorsIsWithinCap() {
        XCTAssertTrue(WatchFaceNLRequest(message: nil).isWithinCapGate)
        XCTAssertFalse(WatchFaceNLRequest(message: String(repeating: "x", count: 2000)).isWithinCapGate)
    }

    func testMaxMessageCharsMatchesBackendCap() {
        XCTAssertEqual(WatchFaceNLConstants.maxMessageChars, 1000)
    }

    func testSurfaceIdentity() {
        XCTAssertEqual(WatchFaceNLSurface.slug, "AIWatchFaceNLResponse")
        XCTAssertEqual(WatchFaceNLSurface.featureID, "watch-face-nl-response")
        XCTAssertEqual(WatchFaceNLSurface.endpointPath, "/ai/watch/respond")
    }
}

// MARK: - Button / output logic (web AIFeatureCard + AiOutputPanel)

@MainActor final class WatchFaceNLLogicTests: XCTestCase {
    func testIsBusy() {
        XCTAssertTrue(WatchFaceNLLogic.isBusy(.streaming))
        XCTAssertTrue(WatchFaceNLLogic.isBusy(.pausedConfirm))
        XCTAssertFalse(WatchFaceNLLogic.isBusy(.idle))
        XCTAssertFalse(WatchFaceNLLogic.isBusy(.done))
        XCTAssertFalse(WatchFaceNLLogic.isBusy(.error("x")))
    }

    func testCanStartAllowsEmptyPrompt() {
        // The distinguishing rule: an empty prompt is a valid ask (default glance summary).
        XCTAssertTrue(WatchFaceNLLogic.canStart(message: "", phase: .idle))
        XCTAssertTrue(WatchFaceNLLogic.canStart(message: "   ", phase: .idle))
        XCTAssertTrue(WatchFaceNLLogic.canStart(message: "how is my battery?", phase: .idle))
    }

    func testCanStartFalseWhenOverCapOrPausedConfirm() {
        let overCap = String(repeating: "a", count: WatchFaceNLConstants.maxMessageChars + 1)
        XCTAssertFalse(WatchFaceNLLogic.canStart(message: overCap, phase: .idle))
        XCTAssertFalse(WatchFaceNLLogic.canStart(message: "go", phase: .pausedConfirm))
    }

    func testButtonDisabled() {
        // Idle + empty prompt → enabled (empty is allowed).
        XCTAssertFalse(WatchFaceNLLogic.buttonDisabled(message: "", phase: .idle, connection: .live))
        // Streaming → disabled (double-submit guard).
        XCTAssertTrue(WatchFaceNLLogic.buttonDisabled(message: "go", phase: .streaming, connection: .live))
        // Paused-confirm → disabled.
        XCTAssertTrue(WatchFaceNLLogic.buttonDisabled(message: "go", phase: .pausedConfirm, connection: .live))
        // Over-cap → disabled.
        let overCap = String(repeating: "a", count: WatchFaceNLConstants.maxMessageChars + 1)
        XCTAssertTrue(WatchFaceNLLogic.buttonDisabled(message: overCap, phase: .idle, connection: .live))
        // Offline → disabled (no stream possible).
        XCTAssertTrue(WatchFaceNLLogic.buttonDisabled(message: "go", phase: .idle, connection: .offline))
    }

    func testOutputVisible() {
        XCTAssertFalse(WatchFaceNLLogic.outputVisible(phase: .idle, hasText: false))
        XCTAssertTrue(WatchFaceNLLogic.outputVisible(phase: .idle, hasText: true))
        XCTAssertTrue(WatchFaceNLLogic.outputVisible(phase: .streaming, hasText: false))
        XCTAssertTrue(WatchFaceNLLogic.outputVisible(phase: .done, hasText: false))
        XCTAssertTrue(WatchFaceNLLogic.outputVisible(phase: .error("x"), hasText: false))
    }

    func testThinkingVisible() {
        XCTAssertTrue(WatchFaceNLLogic.thinkingVisible(phase: .streaming, hasText: false))
        XCTAssertFalse(WatchFaceNLLogic.thinkingVisible(phase: .streaming, hasText: true))
        XCTAssertFalse(WatchFaceNLLogic.thinkingVisible(phase: .idle, hasText: false))
    }

    func testIsIdleInvite() {
        XCTAssertTrue(WatchFaceNLLogic.isIdleInvite(phase: .idle, hasText: false))
        XCTAssertFalse(WatchFaceNLLogic.isIdleInvite(phase: .idle, hasText: true))
        XCTAssertFalse(WatchFaceNLLogic.isIdleInvite(phase: .streaming, hasText: false))
    }

    func testHintIsNilForValidPromptAndOverCapOtherwise() {
        XCTAssertNil(WatchFaceNLLogic.hint(message: "", phase: .idle))
        XCTAssertNil(WatchFaceNLLogic.hint(message: "go", phase: .idle))
        let overCap = String(repeating: "a", count: WatchFaceNLConstants.maxMessageChars + 1)
        XCTAssertEqual(WatchFaceNLLogic.hint(message: overCap, phase: .idle), .overCap)
        // No hint while busy — the disabled reason there is the stream, not the prompt.
        XCTAssertNil(WatchFaceNLLogic.hint(message: overCap, phase: .streaming))
        XCTAssertNil(WatchFaceNLLogic.hint(message: overCap, phase: .pausedConfirm))
    }
}

// MARK: - Accessibility summary

@MainActor final class WatchFaceNLAccessibilityTests: XCTestCase {
    private let labels = WatchFaceNLAccessibility.Labels(
        title: "Ask Helix about your watch face",
        thinking: "Helix is thinking…",
        answerReady: "Answer ready",
        error: "Helix error:"
    )

    func testIdleReadsTitleOnly() {
        let summary = WatchFaceNLAccessibility.summary(labels: labels, phase: .idle, hasAnswer: false)
        XCTAssertEqual(summary, "Ask Helix about your watch face")
    }

    func testStreamingAppendsThinking() {
        let summary = WatchFaceNLAccessibility.summary(labels: labels, phase: .streaming, hasAnswer: false)
        XCTAssertEqual(summary, "Ask Helix about your watch face. Helix is thinking…")
    }

    func testDoneWithAnswerAppendsAnswerReady() {
        let summary = WatchFaceNLAccessibility.summary(labels: labels, phase: .done, hasAnswer: true)
        XCTAssertEqual(summary, "Ask Helix about your watch face. Answer ready")
    }

    func testDoneWithoutAnswerReadsTitleOnly() {
        let summary = WatchFaceNLAccessibility.summary(labels: labels, phase: .done, hasAnswer: false)
        XCTAssertEqual(summary, "Ask Helix about your watch face")
    }

    func testErrorAppendsLabelAndMessage() {
        let summary = WatchFaceNLAccessibility.summary(
            labels: labels, phase: .error("rate limited"), hasAnswer: false
        )
        XCTAssertEqual(summary, "Ask Helix about your watch face. Helix error: rate limited")
    }

    func testEmptyErrorMessageReadsLabelOnly() {
        let summary = WatchFaceNLAccessibility.summary(labels: labels, phase: .error(""), hasAnswer: false)
        XCTAssertEqual(summary, "Ask Helix about your watch face. Helix error:")
    }
}

// MARK: - i18n facade

@MainActor final class WatchFaceNLStringsTests: XCTestCase {
    /// The "AIWatchFaceNLResponse" table folds in at integration time, so the test bundle
    /// resolves each key to its `value:` fallback — deterministic for assertions.
    func testResolvesKeysToFallback() {
        XCTAssertEqual(
            WatchFaceNLStrings.string("watchFaceNL.title", "Ask Helix about your watch face"),
            "Ask Helix about your watch face"
        )
        XCTAssertEqual(
            WatchFaceNLStrings.string("watchFaceNL.button", "Ask about my car"),
            "Ask about my car"
        )
        XCTAssertEqual(WatchFaceNLStrings.string("watchFaceNL.badge", "Helix"), "Helix")
        XCTAssertEqual(
            WatchFaceNLStrings.string("watchFaceNL.inputLabel", "Your question for Helix"),
            "Your question for Helix"
        )
    }
}
