//
//  AILifetimeStatsQA.Tests.swift
//  TeslaSync — P4 shared surface · 0024 · AILifetimeStatsQA (Apple)
//
//  Unit coverage for the AILifetimeStatsQA surface:
//    • Adapter — the request-body projection (the web `body` useMemo + `trimmedQuestion`) and
//      the validity gates (web `haveVehicle` / `haveQuestion` / `canStart`, incl. the
//      MaxQuestionChars cap).
//    • Logic — the prompt/stream-lifecycle button logic (isBusy / canStart / buttonDisabled /
//      output visibility / thinking / idle-invite / emptyHint).
//    • Accessibility — the spoken summary across phases.
//    • i18n facade — the per-surface table resolves each key to its English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store. Per-state view rendering is covered by the #Preview blocks (compiled by the app
//  targets); the per-state *behaviour* is asserted in `…ModelTests.swift`.
//

import XCTest
@testable import TeslaSync

// MARK: - Request projection (web `body` useMemo + validity gates)

@MainActor final class LifetimeStatsQARequestTests: XCTestCase {
    func testProjectTrimsQuestionAndKeepsVehicle() {
        let request = LifetimeStatsQARequest.project(
            vehicleID: 42, rawQuestion: "  How far have I driven?\n"
        )
        XCTAssertEqual(request.vehicleID, 42)
        XCTAssertEqual(request.question, "How far have I driven?")
    }

    func testVehicleValidityRequiresPositiveID() {
        XCTAssertTrue(LifetimeStatsQARequest(vehicleID: 1, question: "q").isVehicleValid)
        XCTAssertFalse(LifetimeStatsQARequest(vehicleID: 0, question: "q").isVehicleValid)
        XCTAssertFalse(LifetimeStatsQARequest(vehicleID: -5, question: "q").isVehicleValid)
    }

    func testQuestionValidityRequiresNonEmptyWithinCap() {
        XCTAssertTrue(LifetimeStatsQARequest(vehicleID: 1, question: "hi").isQuestionValid)
        XCTAssertFalse(LifetimeStatsQARequest(vehicleID: 1, question: "").isQuestionValid)
    }

    func testQuestionValidityAtAndOverTheCap() {
        let cap = LifetimeStatsQAConstants.maxQuestionChars
        let atCap = String(repeating: "a", count: cap)
        let overCap = String(repeating: "a", count: cap + 1)
        XCTAssertTrue(LifetimeStatsQARequest(vehicleID: 1, question: atCap).isQuestionValid)
        XCTAssertFalse(LifetimeStatsQARequest(vehicleID: 1, question: overCap).isQuestionValid)
    }

    func testCanStartRequiresVehicleAndQuestion() {
        XCTAssertTrue(LifetimeStatsQARequest(vehicleID: 1, question: "q").canStart)
        XCTAssertFalse(LifetimeStatsQARequest(vehicleID: 0, question: "q").canStart)
        XCTAssertFalse(LifetimeStatsQARequest(vehicleID: 1, question: "").canStart)
    }

    func testProjectionFeedsValidityFromRawWhitespace() {
        // A whitespace-only prompt trims to empty → not a valid question (web `haveQuestion`).
        let request = LifetimeStatsQARequest.project(vehicleID: 7, rawQuestion: "   \n\t ")
        XCTAssertEqual(request.question, "")
        XCTAssertFalse(request.isQuestionValid)
        XCTAssertFalse(request.canStart)
    }

    func testMaxQuestionCharsMatchesBackendCap() {
        XCTAssertEqual(LifetimeStatsQAConstants.maxQuestionChars, 1024)
    }

    func testSurfaceConstants() {
        XCTAssertEqual(LifetimeStatsQASurface.slug, "AILifetimeStatsQA")
        XCTAssertEqual(LifetimeStatsQASurface.featureID, "lifetime-stats-qa")
    }
}

// MARK: - Button / output logic (web AIFeatureCard + AiOutputPanel)

@MainActor final class LifetimeStatsQALogicTests: XCTestCase {
    func testIsBusy() {
        XCTAssertTrue(LifetimeStatsQALogic.isBusy(.streaming))
        XCTAssertTrue(LifetimeStatsQALogic.isBusy(.pausedConfirm))
        XCTAssertFalse(LifetimeStatsQALogic.isBusy(.idle))
        XCTAssertFalse(LifetimeStatsQALogic.isBusy(.done))
        XCTAssertFalse(LifetimeStatsQALogic.isBusy(.error("x")))
    }

    func testCanStartRequiresVehicleAndQuestion() {
        XCTAssertTrue(LifetimeStatsQALogic.canStart(vehicleID: 1, question: "go"))
        XCTAssertFalse(LifetimeStatsQALogic.canStart(vehicleID: 0, question: "go"))
        XCTAssertFalse(LifetimeStatsQALogic.canStart(vehicleID: -2, question: "go"))
        XCTAssertFalse(LifetimeStatsQALogic.canStart(vehicleID: 1, question: ""))
        XCTAssertFalse(LifetimeStatsQALogic.canStart(vehicleID: 1, question: "   \n "))
    }

    func testButtonDisabled() {
        XCTAssertFalse(LifetimeStatsQALogic.buttonDisabled(
            vehicleID: 1, question: "go", phase: .idle, connection: .live
        ))
        XCTAssertTrue(LifetimeStatsQALogic.buttonDisabled(
            vehicleID: 1, question: "go", phase: .streaming, connection: .live
        ))
        XCTAssertTrue(LifetimeStatsQALogic.buttonDisabled(
            vehicleID: 0, question: "go", phase: .idle, connection: .live
        ))
        XCTAssertTrue(LifetimeStatsQALogic.buttonDisabled(
            vehicleID: 1, question: "", phase: .idle, connection: .live
        ))
        XCTAssertTrue(LifetimeStatsQALogic.buttonDisabled(
            vehicleID: 1, question: "go", phase: .idle, connection: .offline
        ))
    }

    func testOutputVisible() {
        XCTAssertFalse(LifetimeStatsQALogic.outputVisible(phase: .idle, hasText: false))
        XCTAssertTrue(LifetimeStatsQALogic.outputVisible(phase: .idle, hasText: true))
        XCTAssertTrue(LifetimeStatsQALogic.outputVisible(phase: .streaming, hasText: false))
        XCTAssertTrue(LifetimeStatsQALogic.outputVisible(phase: .done, hasText: false))
        XCTAssertTrue(LifetimeStatsQALogic.outputVisible(phase: .error("x"), hasText: false))
    }

    func testThinkingVisible() {
        XCTAssertTrue(LifetimeStatsQALogic.thinkingVisible(phase: .streaming, hasText: false))
        XCTAssertFalse(LifetimeStatsQALogic.thinkingVisible(phase: .streaming, hasText: true))
        XCTAssertFalse(LifetimeStatsQALogic.thinkingVisible(phase: .idle, hasText: false))
    }

    func testIsIdleInvite() {
        XCTAssertTrue(LifetimeStatsQALogic.isIdleInvite(phase: .idle, hasText: false))
        XCTAssertFalse(LifetimeStatsQALogic.isIdleInvite(phase: .idle, hasText: true))
        XCTAssertFalse(LifetimeStatsQALogic.isIdleInvite(phase: .streaming, hasText: false))
    }

    func testEmptyHintPicksFirstUnmetPredicate() {
        XCTAssertEqual(
            LifetimeStatsQALogic.emptyHint(vehicleID: 0, question: "go", phase: .idle), .selectVehicle
        )
        XCTAssertEqual(
            LifetimeStatsQALogic.emptyHint(vehicleID: 5, question: "  ", phase: .idle), .askQuestion
        )
        XCTAssertNil(LifetimeStatsQALogic.emptyHint(vehicleID: 5, question: "go", phase: .idle))
        // No hint while busy — the disabled reason there is the stream, not input.
        XCTAssertNil(LifetimeStatsQALogic.emptyHint(vehicleID: 0, question: "", phase: .streaming))
        XCTAssertNil(LifetimeStatsQALogic.emptyHint(vehicleID: 0, question: "", phase: .pausedConfirm))
    }
}

// MARK: - Accessibility summary

@MainActor final class LifetimeStatsQAAccessibilityTests: XCTestCase {
    private let labels = LifetimeStatsQAAccessibility.Labels(
        title: "Ask about your lifetime stats",
        thinking: "Helix is thinking…",
        answerReady: "Answer ready",
        error: "Helix error:"
    )

    func testIdleReadsTitleOnly() {
        let summary = LifetimeStatsQAAccessibility.summary(labels: labels, phase: .idle, hasAnswer: false)
        XCTAssertEqual(summary, "Ask about your lifetime stats")
    }

    func testStreamingAppendsThinking() {
        let summary = LifetimeStatsQAAccessibility.summary(
            labels: labels, phase: .streaming, hasAnswer: false
        )
        XCTAssertEqual(summary, "Ask about your lifetime stats. Helix is thinking…")
    }

    func testDoneWithAnswerAppendsAnswerReady() {
        let summary = LifetimeStatsQAAccessibility.summary(labels: labels, phase: .done, hasAnswer: true)
        XCTAssertEqual(summary, "Ask about your lifetime stats. Answer ready")
    }

    func testDoneWithoutAnswerReadsTitleOnly() {
        let summary = LifetimeStatsQAAccessibility.summary(labels: labels, phase: .done, hasAnswer: false)
        XCTAssertEqual(summary, "Ask about your lifetime stats")
    }

    func testErrorAppendsLabelAndMessage() {
        let summary = LifetimeStatsQAAccessibility.summary(
            labels: labels, phase: .error("rate limited"), hasAnswer: false
        )
        XCTAssertEqual(summary, "Ask about your lifetime stats. Helix error: rate limited")
    }

    func testEmptyErrorMessageReadsLabelOnly() {
        let summary = LifetimeStatsQAAccessibility.summary(
            labels: labels, phase: .error(""), hasAnswer: false
        )
        XCTAssertEqual(summary, "Ask about your lifetime stats. Helix error:")
    }
}

// MARK: - i18n facade

@MainActor final class LifetimeStatsQAStringsTests: XCTestCase {
    /// The "AILifetimeStatsQA" table folds in at integration time, so the test bundle resolves
    /// each key to its `value:` fallback — deterministic for assertions.
    func testResolvesKeysToFallback() {
        XCTAssertEqual(
            LifetimeStatsQAStrings.string("lifetime.aiQA.title", "Ask about your lifetime stats"),
            "Ask about your lifetime stats"
        )
        XCTAssertEqual(LifetimeStatsQAStrings.string("lifetime.aiQA.askButton", "Ask"), "Ask")
        XCTAssertEqual(LifetimeStatsQAStrings.string("helix.askHelix", "Ask Helix"), "Ask Helix")
        XCTAssertEqual(
            LifetimeStatsQAStrings.string("lifetime.aiQA.inputLabel", "Your question"),
            "Your question"
        )
    }
}
