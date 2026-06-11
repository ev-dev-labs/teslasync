//
//  AINLSearch.Tests.swift
//  TeslaSync — P4 shared surface · 0034 · AINLSearch (Apple)
//
//  Unit coverage for the AINLSearch surface:
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

@MainActor final class NLSearchRequestTests: XCTestCase {
    func testProjectTrimsPrompt() {
        let request = NLSearchRequest.project(rawPrompt: "  drives over 200 km last weekend\n")
        XCTAssertEqual(request.prompt, "drives over 200 km last weekend")
    }

    func testPromptValidityRequiresNonEmpty() {
        XCTAssertTrue(NLSearchRequest(prompt: "a").isPromptValid)
        XCTAssertFalse(NLSearchRequest(prompt: "").isPromptValid)
    }

    func testCanStartRequiresNonEmptyPrompt() {
        XCTAssertTrue(NLSearchRequest(prompt: "phantom drain alerts").canStart)
        XCTAssertFalse(NLSearchRequest(prompt: "").canStart)
    }

    func testProjectionFeedsValidityFromRawWhitespace() {
        // A whitespace-only prompt trims to empty → not a valid prompt (web `canStart`).
        let request = NLSearchRequest.project(rawPrompt: "   \n\t ")
        XCTAssertEqual(request.prompt, "")
        XCTAssertFalse(request.isPromptValid)
        XCTAssertFalse(request.canStart)
    }

    func testProjectionHasNoCharacterCap() {
        // The web Textarea sets no `maxLength`, so a very long prompt stays valid + un-truncated.
        let long = String(repeating: "search ", count: 1000)
        let request = NLSearchRequest.project(rawPrompt: long + "  ")
        XCTAssertEqual(request.prompt, long.trimmingCharacters(in: .whitespacesAndNewlines))
        XCTAssertTrue(request.canStart)
    }

    func testSurfaceConstants() {
        XCTAssertEqual(NLSearchSurface.slug, "AINLSearch")
        XCTAssertEqual(NLSearchSurface.featureID, "nl-search")
    }
}

// MARK: - Button / output logic (web AIFeatureCard + AiOutputPanel)

@MainActor final class NLSearchLogicTests: XCTestCase {
    func testIsBusy() {
        XCTAssertTrue(NLSearchLogic.isBusy(.streaming))
        XCTAssertTrue(NLSearchLogic.isBusy(.pausedConfirm))
        XCTAssertFalse(NLSearchLogic.isBusy(.idle))
        XCTAssertFalse(NLSearchLogic.isBusy(.done))
        XCTAssertFalse(NLSearchLogic.isBusy(.error("x")))
    }

    func testCanStartRequiresPrompt() {
        XCTAssertTrue(NLSearchLogic.canStart(prompt: "go"))
        XCTAssertFalse(NLSearchLogic.canStart(prompt: ""))
        XCTAssertFalse(NLSearchLogic.canStart(prompt: "   \n "))
    }

    func testButtonDisabled() {
        XCTAssertFalse(NLSearchLogic.buttonDisabled(
            prompt: "go", phase: .idle, connection: .live
        ))
        XCTAssertTrue(NLSearchLogic.buttonDisabled(
            prompt: "go", phase: .streaming, connection: .live
        ))
        XCTAssertTrue(NLSearchLogic.buttonDisabled(
            prompt: "", phase: .idle, connection: .live
        ))
        XCTAssertTrue(NLSearchLogic.buttonDisabled(
            prompt: "go", phase: .idle, connection: .offline
        ))
    }

    func testOutputVisible() {
        XCTAssertFalse(NLSearchLogic.outputVisible(phase: .idle, hasText: false))
        XCTAssertTrue(NLSearchLogic.outputVisible(phase: .idle, hasText: true))
        XCTAssertTrue(NLSearchLogic.outputVisible(phase: .streaming, hasText: false))
        XCTAssertTrue(NLSearchLogic.outputVisible(phase: .done, hasText: false))
        XCTAssertTrue(NLSearchLogic.outputVisible(phase: .error("x"), hasText: false))
    }

    func testThinkingVisible() {
        XCTAssertTrue(NLSearchLogic.thinkingVisible(phase: .streaming, hasText: false))
        XCTAssertFalse(NLSearchLogic.thinkingVisible(phase: .streaming, hasText: true))
        XCTAssertFalse(NLSearchLogic.thinkingVisible(phase: .idle, hasText: false))
    }

    func testIsIdleInvite() {
        XCTAssertTrue(NLSearchLogic.isIdleInvite(phase: .idle, hasText: false))
        XCTAssertFalse(NLSearchLogic.isIdleInvite(phase: .idle, hasText: true))
        XCTAssertFalse(NLSearchLogic.isIdleInvite(phase: .streaming, hasText: false))
    }

    func testEmptyHintReflectsPrompt() {
        XCTAssertEqual(NLSearchLogic.emptyHint(prompt: "", phase: .idle), .enterPrompt)
        XCTAssertEqual(NLSearchLogic.emptyHint(prompt: "  \n", phase: .idle), .enterPrompt)
        XCTAssertNil(NLSearchLogic.emptyHint(prompt: "phantom drain", phase: .idle))
        // No hint while busy — the disabled reason there is the stream, not input.
        XCTAssertNil(NLSearchLogic.emptyHint(prompt: "", phase: .streaming))
        XCTAssertNil(NLSearchLogic.emptyHint(prompt: "", phase: .pausedConfirm))
    }
}

// MARK: - Accessibility summary

@MainActor final class NLSearchAccessibilityTests: XCTestCase {
    private let labels = NLSearchAccessibility.Labels(
        title: "Search with natural language",
        thinking: "Helix is thinking…",
        resultsReady: "Results ready",
        error: "Helix error:"
    )

    func testIdleReadsTitleOnly() {
        let summary = NLSearchAccessibility.summary(labels: labels, phase: .idle, hasAnswer: false)
        XCTAssertEqual(summary, "Search with natural language")
    }

    func testStreamingAppendsThinking() {
        let summary = NLSearchAccessibility.summary(
            labels: labels, phase: .streaming, hasAnswer: false
        )
        XCTAssertEqual(summary, "Search with natural language. Helix is thinking…")
    }

    func testDoneWithAnswerAppendsResultsReady() {
        let summary = NLSearchAccessibility.summary(labels: labels, phase: .done, hasAnswer: true)
        XCTAssertEqual(summary, "Search with natural language. Results ready")
    }

    func testDoneWithoutAnswerReadsTitleOnly() {
        let summary = NLSearchAccessibility.summary(labels: labels, phase: .done, hasAnswer: false)
        XCTAssertEqual(summary, "Search with natural language")
    }

    func testErrorAppendsLabelAndMessage() {
        let summary = NLSearchAccessibility.summary(
            labels: labels, phase: .error("rate limited"), hasAnswer: false
        )
        XCTAssertEqual(summary, "Search with natural language. Helix error: rate limited")
    }

    func testEmptyErrorMessageReadsLabelOnly() {
        let summary = NLSearchAccessibility.summary(
            labels: labels, phase: .error(""), hasAnswer: false
        )
        XCTAssertEqual(summary, "Search with natural language. Helix error:")
    }
}

// MARK: - i18n facade

@MainActor final class NLSearchStringsTests: XCTestCase {
    /// The "AINLSearch" table folds in at integration time, so the test bundle resolves each
    /// key to its `value:` fallback — deterministic for assertions.
    func testResolvesKeysToFallback() {
        XCTAssertEqual(
            NLSearchStrings.string("search.aiSearch.title", "Search with natural language"),
            "Search with natural language"
        )
        XCTAssertEqual(
            NLSearchStrings.string("search.aiSearch.searchButton", "Search with Helix"),
            "Search with Helix"
        )
        XCTAssertEqual(NLSearchStrings.string("helix.askHelix", "Ask Helix"), "Ask Helix")
        XCTAssertEqual(
            NLSearchStrings.string(
                "search.aiSearch.placeholder",
                "e.g. drives last weekend over 200 km with phantom drain"
            ),
            "e.g. drives last weekend over 200 km with phantom drain"
        )
    }
}
