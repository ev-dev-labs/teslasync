//
//  AIRAGHelp.Tests.swift
//  TeslaSync — P4 shared surface · 0042 · AIRAGHelp (Apple)
//
//  Unit coverage for the AIRAGHelp surface:
//    • Adapter — the request-body projection (the web `body` useMemo `{ prompt }` + `prompt
//      .trim()`) and the validity gate (web `canStart = prompt.trim().length > 0`).
//    • Logic — the prompt/stream-lifecycle button logic (isBusy / canStart / buttonDisabled /
//      output visibility / thinking / idle-invite / emptyHint).
//    • Accessibility — the spoken summary across phases.
//    • i18n facade — the per-surface table resolves each key to its English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store.
//  Per-state view rendering is covered by the #Preview blocks (compiled by the app targets);
//  the per-state *behaviour* is asserted in `…ModelTests.swift`.
//

import XCTest
@testable import TeslaSync

// MARK: - Request projection (web `body` useMemo + validity gate)

@MainActor final class RAGHelpRequestTests: XCTestCase {
    func testProjectTrimsPrompt() {
        let request = RAGHelpRequest.project(rawPrompt: "  how do I enable cost forecasting?\n")
        XCTAssertEqual(request.prompt, "how do I enable cost forecasting?")
    }

    func testPromptValidityRequiresNonEmpty() {
        XCTAssertTrue(RAGHelpRequest(prompt: "a").isPromptValid)
        XCTAssertFalse(RAGHelpRequest(prompt: "").isPromptValid)
    }

    func testCanStartRequiresNonEmptyPrompt() {
        XCTAssertTrue(RAGHelpRequest(prompt: "how do alerts work?").canStart)
        XCTAssertFalse(RAGHelpRequest(prompt: "").canStart)
    }

    func testProjectionFeedsValidityFromRawWhitespace() {
        // A whitespace-only prompt trims to empty → not a valid prompt (web `canStart`).
        let request = RAGHelpRequest.project(rawPrompt: "   \n\t ")
        XCTAssertEqual(request.prompt, "")
        XCTAssertFalse(request.isPromptValid)
        XCTAssertFalse(request.canStart)
    }

    func testProjectionHasNoCharacterCap() {
        // The web Textarea sets no `maxLength`, so a very long prompt stays valid + un-truncated.
        let long = String(repeating: "explain ", count: 1000)
        let request = RAGHelpRequest.project(rawPrompt: long + "  ")
        XCTAssertEqual(request.prompt, long.trimmingCharacters(in: .whitespacesAndNewlines))
        XCTAssertTrue(request.canStart)
    }

    func testSurfaceConstants() {
        XCTAssertEqual(RAGHelpSurface.slug, "AIRAGHelp")
        XCTAssertEqual(RAGHelpSurface.featureID, "rag-help")
    }
}

// MARK: - Button / output logic (web AIFeatureCard + AiOutputPanel)

@MainActor final class RAGHelpLogicTests: XCTestCase {
    func testIsBusy() {
        XCTAssertTrue(RAGHelpLogic.isBusy(.streaming))
        XCTAssertTrue(RAGHelpLogic.isBusy(.pausedConfirm))
        XCTAssertFalse(RAGHelpLogic.isBusy(.idle))
        XCTAssertFalse(RAGHelpLogic.isBusy(.done))
        XCTAssertFalse(RAGHelpLogic.isBusy(.error("x")))
    }

    func testCanStartRequiresPrompt() {
        XCTAssertTrue(RAGHelpLogic.canStart(prompt: "go"))
        XCTAssertFalse(RAGHelpLogic.canStart(prompt: ""))
        XCTAssertFalse(RAGHelpLogic.canStart(prompt: "   \n "))
    }

    func testButtonDisabled() {
        XCTAssertFalse(RAGHelpLogic.buttonDisabled(
            prompt: "go", phase: .idle, connection: .live
        ))
        XCTAssertTrue(RAGHelpLogic.buttonDisabled(
            prompt: "go", phase: .streaming, connection: .live
        ))
        XCTAssertTrue(RAGHelpLogic.buttonDisabled(
            prompt: "", phase: .idle, connection: .live
        ))
        XCTAssertTrue(RAGHelpLogic.buttonDisabled(
            prompt: "go", phase: .idle, connection: .offline
        ))
    }

    func testOutputVisible() {
        XCTAssertFalse(RAGHelpLogic.outputVisible(phase: .idle, hasText: false))
        XCTAssertTrue(RAGHelpLogic.outputVisible(phase: .idle, hasText: true))
        XCTAssertTrue(RAGHelpLogic.outputVisible(phase: .streaming, hasText: false))
        XCTAssertTrue(RAGHelpLogic.outputVisible(phase: .done, hasText: false))
        XCTAssertTrue(RAGHelpLogic.outputVisible(phase: .error("x"), hasText: false))
    }

    func testThinkingVisible() {
        XCTAssertTrue(RAGHelpLogic.thinkingVisible(phase: .streaming, hasText: false))
        XCTAssertFalse(RAGHelpLogic.thinkingVisible(phase: .streaming, hasText: true))
        XCTAssertFalse(RAGHelpLogic.thinkingVisible(phase: .idle, hasText: false))
    }

    func testIsIdleInvite() {
        XCTAssertTrue(RAGHelpLogic.isIdleInvite(phase: .idle, hasText: false))
        XCTAssertFalse(RAGHelpLogic.isIdleInvite(phase: .idle, hasText: true))
        XCTAssertFalse(RAGHelpLogic.isIdleInvite(phase: .streaming, hasText: false))
    }

    func testEmptyHintReflectsPrompt() {
        XCTAssertEqual(RAGHelpLogic.emptyHint(prompt: "", phase: .idle), .enterPrompt)
        XCTAssertEqual(RAGHelpLogic.emptyHint(prompt: "  \n", phase: .idle), .enterPrompt)
        XCTAssertNil(RAGHelpLogic.emptyHint(prompt: "how do I export?", phase: .idle))
        // No hint while busy — the disabled reason there is the stream, not input.
        XCTAssertNil(RAGHelpLogic.emptyHint(prompt: "", phase: .streaming))
        XCTAssertNil(RAGHelpLogic.emptyHint(prompt: "", phase: .pausedConfirm))
    }
}

// MARK: - Accessibility summary

@MainActor final class RAGHelpAccessibilityTests: XCTestCase {
    private let labels = RAGHelpAccessibility.Labels(
        title: "Ask the help assistant",
        thinking: "Helix is thinking…",
        answerReady: "Answer ready",
        error: "Helix error:"
    )

    func testIdleReadsTitleOnly() {
        let summary = RAGHelpAccessibility.summary(labels: labels, phase: .idle, hasAnswer: false)
        XCTAssertEqual(summary, "Ask the help assistant")
    }

    func testStreamingAppendsThinking() {
        let summary = RAGHelpAccessibility.summary(
            labels: labels, phase: .streaming, hasAnswer: false
        )
        XCTAssertEqual(summary, "Ask the help assistant. Helix is thinking…")
    }

    func testDoneWithAnswerAppendsAnswerReady() {
        let summary = RAGHelpAccessibility.summary(labels: labels, phase: .done, hasAnswer: true)
        XCTAssertEqual(summary, "Ask the help assistant. Answer ready")
    }

    func testDoneWithoutAnswerReadsTitleOnly() {
        let summary = RAGHelpAccessibility.summary(labels: labels, phase: .done, hasAnswer: false)
        XCTAssertEqual(summary, "Ask the help assistant")
    }

    func testErrorAppendsLabelAndMessage() {
        let summary = RAGHelpAccessibility.summary(
            labels: labels, phase: .error("rate limited"), hasAnswer: false
        )
        XCTAssertEqual(summary, "Ask the help assistant. Helix error: rate limited")
    }

    func testEmptyErrorMessageReadsLabelOnly() {
        let summary = RAGHelpAccessibility.summary(
            labels: labels, phase: .error(""), hasAnswer: false
        )
        XCTAssertEqual(summary, "Ask the help assistant. Helix error:")
    }
}

// MARK: - i18n facade

@MainActor final class RAGHelpStringsTests: XCTestCase {
    /// The "AIRAGHelp" table folds in at integration time, so the test bundle resolves each
    /// key to its `value:` fallback — deterministic for assertions.
    func testResolvesKeysToFallback() {
        XCTAssertEqual(
            RAGHelpStrings.string("help.aiHelp.title", "Ask the help assistant"),
            "Ask the help assistant"
        )
        XCTAssertEqual(
            RAGHelpStrings.string("help.aiHelp.askButton", "Ask the assistant"),
            "Ask the assistant"
        )
        XCTAssertEqual(RAGHelpStrings.string("helix.askHelix", "Ask Helix"), "Ask Helix")
        XCTAssertEqual(
            RAGHelpStrings.string(
                "help.aiHelp.placeholder", // parity:allow ui
                "e.g. How do I enable energy cost forecasting?"
            ),
            "e.g. How do I enable energy cost forecasting?"
        )
    }
}
