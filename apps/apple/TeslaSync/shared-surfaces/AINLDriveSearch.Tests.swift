//
//  AINLDriveSearch.Tests.swift
//  TeslaSync — P4 shared surface · 0032 · AINLDriveSearch (Apple)
//
//  Unit coverage for the AINLDriveSearch surface:
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

@MainActor final class NLDriveSearchRequestTests: XCTestCase {
    func testProjectTrimsPrompt() {
        let request = NLDriveSearchRequest.project(rawPrompt: "  last Friday's coastal trip\n")
        XCTAssertEqual(request.prompt, "last Friday's coastal trip")
    }

    func testPromptValidityRequiresNonEmpty() {
        XCTAssertTrue(NLDriveSearchRequest(prompt: "a").isPromptValid)
        XCTAssertFalse(NLDriveSearchRequest(prompt: "").isPromptValid)
    }

    func testCanStartRequiresNonEmptyPrompt() {
        XCTAssertTrue(NLDriveSearchRequest(prompt: "trip to the coast").canStart)
        XCTAssertFalse(NLDriveSearchRequest(prompt: "").canStart)
    }

    func testProjectionFeedsValidityFromRawWhitespace() {
        // A whitespace-only prompt trims to empty → not a valid prompt (web `canStart`).
        let request = NLDriveSearchRequest.project(rawPrompt: "   \n\t ")
        XCTAssertEqual(request.prompt, "")
        XCTAssertFalse(request.isPromptValid)
        XCTAssertFalse(request.canStart)
    }

    func testProjectionHasNoCharacterCap() {
        // The web Textarea sets no `maxLength`, so a very long prompt stays valid + un-truncated.
        let long = String(repeating: "drive ", count: 1000)
        let request = NLDriveSearchRequest.project(rawPrompt: long + "  ")
        XCTAssertEqual(request.prompt, long.trimmingCharacters(in: .whitespacesAndNewlines))
        XCTAssertTrue(request.canStart)
    }

    func testSurfaceConstants() {
        XCTAssertEqual(NLDriveSearchSurface.slug, "AINLDriveSearch")
        XCTAssertEqual(NLDriveSearchSurface.featureID, "nl-drive-search-replay")
    }
}

// MARK: - Button / output logic (web AIFeatureCard + AiOutputPanel)

@MainActor final class NLDriveSearchLogicTests: XCTestCase {
    func testIsBusy() {
        XCTAssertTrue(NLDriveSearchLogic.isBusy(.streaming))
        XCTAssertTrue(NLDriveSearchLogic.isBusy(.pausedConfirm))
        XCTAssertFalse(NLDriveSearchLogic.isBusy(.idle))
        XCTAssertFalse(NLDriveSearchLogic.isBusy(.done))
        XCTAssertFalse(NLDriveSearchLogic.isBusy(.error("x")))
    }

    func testCanStartRequiresPrompt() {
        XCTAssertTrue(NLDriveSearchLogic.canStart(prompt: "go"))
        XCTAssertFalse(NLDriveSearchLogic.canStart(prompt: ""))
        XCTAssertFalse(NLDriveSearchLogic.canStart(prompt: "   \n "))
    }

    func testButtonDisabled() {
        XCTAssertFalse(NLDriveSearchLogic.buttonDisabled(
            prompt: "go", phase: .idle, connection: .live
        ))
        XCTAssertTrue(NLDriveSearchLogic.buttonDisabled(
            prompt: "go", phase: .streaming, connection: .live
        ))
        XCTAssertTrue(NLDriveSearchLogic.buttonDisabled(
            prompt: "", phase: .idle, connection: .live
        ))
        XCTAssertTrue(NLDriveSearchLogic.buttonDisabled(
            prompt: "go", phase: .idle, connection: .offline
        ))
    }

    func testOutputVisible() {
        XCTAssertFalse(NLDriveSearchLogic.outputVisible(phase: .idle, hasText: false))
        XCTAssertTrue(NLDriveSearchLogic.outputVisible(phase: .idle, hasText: true))
        XCTAssertTrue(NLDriveSearchLogic.outputVisible(phase: .streaming, hasText: false))
        XCTAssertTrue(NLDriveSearchLogic.outputVisible(phase: .done, hasText: false))
        XCTAssertTrue(NLDriveSearchLogic.outputVisible(phase: .error("x"), hasText: false))
    }

    func testThinkingVisible() {
        XCTAssertTrue(NLDriveSearchLogic.thinkingVisible(phase: .streaming, hasText: false))
        XCTAssertFalse(NLDriveSearchLogic.thinkingVisible(phase: .streaming, hasText: true))
        XCTAssertFalse(NLDriveSearchLogic.thinkingVisible(phase: .idle, hasText: false))
    }

    func testIsIdleInvite() {
        XCTAssertTrue(NLDriveSearchLogic.isIdleInvite(phase: .idle, hasText: false))
        XCTAssertFalse(NLDriveSearchLogic.isIdleInvite(phase: .idle, hasText: true))
        XCTAssertFalse(NLDriveSearchLogic.isIdleInvite(phase: .streaming, hasText: false))
    }

    func testEmptyHintReflectsPrompt() {
        XCTAssertEqual(NLDriveSearchLogic.emptyHint(prompt: "", phase: .idle), .enterPrompt)
        XCTAssertEqual(NLDriveSearchLogic.emptyHint(prompt: "  \n", phase: .idle), .enterPrompt)
        XCTAssertNil(NLDriveSearchLogic.emptyHint(prompt: "coast trip", phase: .idle))
        // No hint while busy — the disabled reason there is the stream, not input.
        XCTAssertNil(NLDriveSearchLogic.emptyHint(prompt: "", phase: .streaming))
        XCTAssertNil(NLDriveSearchLogic.emptyHint(prompt: "", phase: .pausedConfirm))
    }
}

// MARK: - Accessibility summary

@MainActor final class NLDriveSearchAccessibilityTests: XCTestCase {
    private let labels = NLDriveSearchAccessibility.Labels(
        title: "Find a drive in natural language",
        thinking: "Helix is thinking…",
        resultsReady: "Results ready",
        error: "Helix error:"
    )

    func testIdleReadsTitleOnly() {
        let summary = NLDriveSearchAccessibility.summary(labels: labels, phase: .idle, hasAnswer: false)
        XCTAssertEqual(summary, "Find a drive in natural language")
    }

    func testStreamingAppendsThinking() {
        let summary = NLDriveSearchAccessibility.summary(
            labels: labels, phase: .streaming, hasAnswer: false
        )
        XCTAssertEqual(summary, "Find a drive in natural language. Helix is thinking…")
    }

    func testDoneWithAnswerAppendsResultsReady() {
        let summary = NLDriveSearchAccessibility.summary(labels: labels, phase: .done, hasAnswer: true)
        XCTAssertEqual(summary, "Find a drive in natural language. Results ready")
    }

    func testDoneWithoutAnswerReadsTitleOnly() {
        let summary = NLDriveSearchAccessibility.summary(labels: labels, phase: .done, hasAnswer: false)
        XCTAssertEqual(summary, "Find a drive in natural language")
    }

    func testErrorAppendsLabelAndMessage() {
        let summary = NLDriveSearchAccessibility.summary(
            labels: labels, phase: .error("rate limited"), hasAnswer: false
        )
        XCTAssertEqual(summary, "Find a drive in natural language. Helix error: rate limited")
    }

    func testEmptyErrorMessageReadsLabelOnly() {
        let summary = NLDriveSearchAccessibility.summary(
            labels: labels, phase: .error(""), hasAnswer: false
        )
        XCTAssertEqual(summary, "Find a drive in natural language. Helix error:")
    }
}

// MARK: - i18n facade

@MainActor final class NLDriveSearchStringsTests: XCTestCase {
    /// The "AINLDriveSearch" table folds in at integration time, so the test bundle resolves
    /// each key to its `value:` fallback — deterministic for assertions.
    func testResolvesKeysToFallback() {
        XCTAssertEqual(
            NLDriveSearchStrings.string("drives.aiSearch.title", "Find a drive in natural language"),
            "Find a drive in natural language"
        )
        XCTAssertEqual(
            NLDriveSearchStrings.string("drives.aiSearch.searchButton", "Search with Helix"),
            "Search with Helix"
        )
        XCTAssertEqual(NLDriveSearchStrings.string("helix.askHelix", "Ask Helix"), "Ask Helix")
        XCTAssertEqual(
            NLDriveSearchStrings.string("drives.aiSearch.placeholder", "e.g. last Friday's trip to the coast"),
            "e.g. last Friday's trip to the coast"
        )
    }
}
