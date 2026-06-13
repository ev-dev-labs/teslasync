//
//  AINLDashboardComposer.Tests.swift
//  TeslaSync — P4 shared surface · 0031 · AINLDashboardComposer (Apple)
//
//  Unit coverage for the AINLDashboardComposer surface:
//    • Adapter — the request-body projection (the web `body` useMemo `{ prompt }` + `prompt
//      .trim()`) + the validity gate (web `hasPrompt`). The typed `tool_result` nested decode
//      (web `parseDashboardLayoutDraft`) lives in `…AdapterTests.swift`.
//    • Logic — the prompt/stream-lifecycle button logic (isBusy / canStart / buttonDisabled /
//      canApply / output visibility / thinking / idle-invite / emptyHint).
//    • Accessibility — the spoken summary across phases + the draft-ready cue.
//    • i18n facade — the per-surface table resolves each key to its English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store.
//  Per-state view rendering is covered by the #Preview blocks (compiled by the app targets);
//  the per-state *behaviour* is asserted in `…ModelTests.swift`.
//

import XCTest
@testable import TeslaSync

// MARK: - Request projection (web `body` useMemo + validity gate)

@MainActor final class NLDashboardComposerRequestTests: XCTestCase {
    func testProjectTrimsPrompt() {
        let request = NLDashboardComposerRequest.project(rawPrompt: "  give me a dashboard\n")
        XCTAssertEqual(request.prompt, "give me a dashboard")
    }

    func testPromptValidityRequiresNonEmpty() {
        XCTAssertTrue(NLDashboardComposerRequest(prompt: "a").isPromptValid)
        XCTAssertFalse(NLDashboardComposerRequest(prompt: "").isPromptValid)
    }

    func testCanStartRequiresNonEmptyPrompt() {
        XCTAssertTrue(NLDashboardComposerRequest(prompt: "overview dashboard").canStart)
        XCTAssertFalse(NLDashboardComposerRequest(prompt: "").canStart)
    }

    func testProjectionFeedsValidityFromRawWhitespace() {
        let request = NLDashboardComposerRequest.project(rawPrompt: "   \n\t ")
        XCTAssertEqual(request.prompt, "")
        XCTAssertFalse(request.isPromptValid)
        XCTAssertFalse(request.canStart)
    }

    func testProjectionHasNoCharacterCap() {
        let long = String(repeating: "panel ", count: 1000)
        let request = NLDashboardComposerRequest.project(rawPrompt: long + "  ")
        XCTAssertEqual(request.prompt, long.trimmingCharacters(in: .whitespacesAndNewlines))
        XCTAssertTrue(request.canStart)
    }

    func testSurfaceConstants() {
        XCTAssertEqual(NLDashboardComposerSurface.slug, "AINLDashboardComposer")
        XCTAssertEqual(NLDashboardComposerSurface.featureID, "nl-dashboard-composer")
        XCTAssertEqual(NLDashboardComposerSurface.draftToolName, "draft_dashboard_layout")
    }
}

// MARK: - Button / output logic (web AIFeatureCard + AiOutputPanel + canApply)

@MainActor final class NLDashboardComposerLogicTests: XCTestCase {
    func testIsBusy() {
        XCTAssertTrue(NLDashboardComposerLogic.isBusy(.streaming))
        XCTAssertTrue(NLDashboardComposerLogic.isBusy(.pausedConfirm))
        XCTAssertFalse(NLDashboardComposerLogic.isBusy(.idle))
        XCTAssertFalse(NLDashboardComposerLogic.isBusy(.done))
        XCTAssertFalse(NLDashboardComposerLogic.isBusy(.error("x")))
    }

    func testCanStartRequiresPrompt() {
        XCTAssertTrue(NLDashboardComposerLogic.canStart(prompt: "go"))
        XCTAssertFalse(NLDashboardComposerLogic.canStart(prompt: ""))
        XCTAssertFalse(NLDashboardComposerLogic.canStart(prompt: "   \n "))
    }

    func testButtonDisabled() {
        XCTAssertFalse(NLDashboardComposerLogic.buttonDisabled(
            prompt: "go", phase: .idle, connection: .live
        ))
        XCTAssertTrue(NLDashboardComposerLogic.buttonDisabled(
            prompt: "go", phase: .streaming, connection: .live
        ))
        XCTAssertTrue(NLDashboardComposerLogic.buttonDisabled(
            prompt: "", phase: .idle, connection: .live
        ))
        XCTAssertTrue(NLDashboardComposerLogic.buttonDisabled(
            prompt: "go", phase: .idle, connection: .offline
        ))
    }

    func testCanApply() {
        XCTAssertTrue(NLDashboardComposerLogic.canApply(hasDraft: true, phase: .done))
        XCTAssertTrue(NLDashboardComposerLogic.canApply(hasDraft: true, phase: .idle))
        XCTAssertFalse(NLDashboardComposerLogic.canApply(hasDraft: false, phase: .done))
        XCTAssertFalse(NLDashboardComposerLogic.canApply(hasDraft: true, phase: .streaming))
    }

    func testOutputVisible() {
        XCTAssertFalse(NLDashboardComposerLogic.outputVisible(phase: .idle, hasText: false))
        XCTAssertTrue(NLDashboardComposerLogic.outputVisible(phase: .idle, hasText: true))
        XCTAssertTrue(NLDashboardComposerLogic.outputVisible(phase: .streaming, hasText: false))
        XCTAssertTrue(NLDashboardComposerLogic.outputVisible(phase: .done, hasText: false))
        XCTAssertTrue(NLDashboardComposerLogic.outputVisible(phase: .error("x"), hasText: false))
    }

    func testThinkingVisible() {
        XCTAssertTrue(NLDashboardComposerLogic.thinkingVisible(phase: .streaming, hasText: false))
        XCTAssertFalse(NLDashboardComposerLogic.thinkingVisible(phase: .streaming, hasText: true))
        XCTAssertFalse(NLDashboardComposerLogic.thinkingVisible(phase: .idle, hasText: false))
    }

    func testIsIdleInvite() {
        XCTAssertTrue(NLDashboardComposerLogic.isIdleInvite(phase: .idle, hasText: false))
        XCTAssertFalse(NLDashboardComposerLogic.isIdleInvite(phase: .idle, hasText: true))
        XCTAssertFalse(NLDashboardComposerLogic.isIdleInvite(phase: .streaming, hasText: false))
    }

    func testEmptyHintReflectsPrompt() {
        XCTAssertEqual(NLDashboardComposerLogic.emptyHint(prompt: "", phase: .idle), .enterPrompt)
        XCTAssertEqual(NLDashboardComposerLogic.emptyHint(prompt: "  \n", phase: .idle), .enterPrompt)
        XCTAssertNil(NLDashboardComposerLogic.emptyHint(prompt: "overview dashboard", phase: .idle))
        XCTAssertNil(NLDashboardComposerLogic.emptyHint(prompt: "", phase: .streaming))
        XCTAssertNil(NLDashboardComposerLogic.emptyHint(prompt: "", phase: .pausedConfirm))
    }
}

// MARK: - Accessibility summary

@MainActor final class NLDashboardComposerAccessibilityTests: XCTestCase {
    private let labels = NLDashboardComposerAccessibility.Labels(
        title: "Helix natural-language dashboard composer",
        thinking: "Helix is thinking…",
        resultsReady: "Rationale ready",
        draftReady: "Dashboard draft ready to apply",
        error: "Helix error:"
    )

    func testIdleReadsTitleOnly() {
        let summary = NLDashboardComposerAccessibility.summary(
            labels: labels, phase: .idle, hasAnswer: false, hasDraft: false
        )
        XCTAssertEqual(summary, "Helix natural-language dashboard composer")
    }

    func testStreamingAppendsThinking() {
        let summary = NLDashboardComposerAccessibility.summary(
            labels: labels, phase: .streaming, hasAnswer: false, hasDraft: false
        )
        XCTAssertEqual(summary, "Helix natural-language dashboard composer. Helix is thinking…")
    }

    func testStreamingSuppressesDraftCue() {
        // While streaming the draft cue is held back (web `canApply` is false mid-stream).
        let summary = NLDashboardComposerAccessibility.summary(
            labels: labels, phase: .streaming, hasAnswer: false, hasDraft: true
        )
        XCTAssertEqual(summary, "Helix natural-language dashboard composer. Helix is thinking…")
    }

    func testDoneWithAnswerAppendsRationaleReady() {
        let summary = NLDashboardComposerAccessibility.summary(
            labels: labels, phase: .done, hasAnswer: true, hasDraft: false
        )
        XCTAssertEqual(summary, "Helix natural-language dashboard composer. Rationale ready")
    }

    func testDoneWithDraftAppendsDraftReady() {
        let summary = NLDashboardComposerAccessibility.summary(
            labels: labels, phase: .done, hasAnswer: true, hasDraft: true
        )
        XCTAssertEqual(
            summary,
            "Helix natural-language dashboard composer. Rationale ready. Dashboard draft ready to apply"
        )
    }

    func testErrorAppendsLabelAndMessage() {
        let summary = NLDashboardComposerAccessibility.summary(
            labels: labels, phase: .error("rate limited"), hasAnswer: false, hasDraft: false
        )
        XCTAssertEqual(
            summary, "Helix natural-language dashboard composer. Helix error: rate limited"
        )
    }

    func testEmptyErrorMessageReadsLabelOnly() {
        let summary = NLDashboardComposerAccessibility.summary(
            labels: labels, phase: .error(""), hasAnswer: false, hasDraft: false
        )
        XCTAssertEqual(summary, "Helix natural-language dashboard composer. Helix error:")
    }
}

// MARK: - i18n facade

@MainActor final class NLDashboardComposerStringsTests: XCTestCase {
    /// The "AINLDashboardComposer" table folds in at integration time, so the test bundle
    /// resolves each key to its `value:` fallback — deterministic for assertions.
    func testResolvesKeysToFallback() {
        XCTAssertEqual(
            NLDashboardComposerStrings.string(
                "powerDashboards.aiDrafter.title", "Helix natural-language dashboard composer"
            ),
            "Helix natural-language dashboard composer"
        )
        XCTAssertEqual(
            NLDashboardComposerStrings.string("powerDashboards.aiDrafter.button", "Draft dashboard"),
            "Draft dashboard"
        )
        XCTAssertEqual(
            NLDashboardComposerStrings.string("powerDashboards.aiDrafter.applyButton", "Apply to editor"),
            "Apply to editor"
        )
        XCTAssertEqual(NLDashboardComposerStrings.string("helix.askHelix", "Ask Helix"), "Ask Helix")
        XCTAssertEqual(
            NLDashboardComposerStrings.string("powerDashboards.aiDrafter.promptLabel", "Dashboard request"),
            "Dashboard request"
        )
        XCTAssertEqual(NLDashboardComposerStrings.table, "AINLDashboardComposer")
    }
}
