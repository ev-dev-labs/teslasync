//
//  AINLGrafanaPanel.Tests.swift
//  TeslaSync — P4 shared surface · 0033 · AINLGrafanaPanel (Apple)
//
//  Unit coverage for the AINLGrafanaPanel surface:
//    • Adapter — the request-body projection (the web `body` useMemo `{ prompt }` + `prompt
//      .trim()`) + the validity gate (web `hasPrompt`). The typed `tool_result` nested decode
//      (web `parseGrafanaPanelDraft`) lives in `…AdapterTests.swift`.
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

@MainActor final class NLGrafanaPanelRequestTests: XCTestCase {
    func testProjectTrimsPrompt() {
        let request = NLGrafanaPanelRequest.project(rawPrompt: "  show me daily drives\n")
        XCTAssertEqual(request.prompt, "show me daily drives")
    }

    func testPromptValidityRequiresNonEmpty() {
        XCTAssertTrue(NLGrafanaPanelRequest(prompt: "a").isPromptValid)
        XCTAssertFalse(NLGrafanaPanelRequest(prompt: "").isPromptValid)
    }

    func testCanStartRequiresNonEmptyPrompt() {
        XCTAssertTrue(NLGrafanaPanelRequest(prompt: "daily distance panel").canStart)
        XCTAssertFalse(NLGrafanaPanelRequest(prompt: "").canStart)
    }

    func testProjectionFeedsValidityFromRawWhitespace() {
        let request = NLGrafanaPanelRequest.project(rawPrompt: "   \n\t ")
        XCTAssertEqual(request.prompt, "")
        XCTAssertFalse(request.isPromptValid)
        XCTAssertFalse(request.canStart)
    }

    func testProjectionHasNoCharacterCap() {
        let long = String(repeating: "panel ", count: 1000)
        let request = NLGrafanaPanelRequest.project(rawPrompt: long + "  ")
        XCTAssertEqual(request.prompt, long.trimmingCharacters(in: .whitespacesAndNewlines))
        XCTAssertTrue(request.canStart)
    }

    func testSurfaceConstants() {
        XCTAssertEqual(NLGrafanaPanelSurface.slug, "AINLGrafanaPanel")
        XCTAssertEqual(NLGrafanaPanelSurface.featureID, "nl-grafana-panel")
        XCTAssertEqual(NLGrafanaPanelSurface.draftToolName, "draft_grafana_panel")
    }
}

// MARK: - Button / output logic (web AIFeatureCard + AiOutputPanel + canApply)

@MainActor final class NLGrafanaPanelLogicTests: XCTestCase {
    func testIsBusy() {
        XCTAssertTrue(NLGrafanaPanelLogic.isBusy(.streaming))
        XCTAssertTrue(NLGrafanaPanelLogic.isBusy(.pausedConfirm))
        XCTAssertFalse(NLGrafanaPanelLogic.isBusy(.idle))
        XCTAssertFalse(NLGrafanaPanelLogic.isBusy(.done))
        XCTAssertFalse(NLGrafanaPanelLogic.isBusy(.error("x")))
    }

    func testCanStartRequiresPrompt() {
        XCTAssertTrue(NLGrafanaPanelLogic.canStart(prompt: "go"))
        XCTAssertFalse(NLGrafanaPanelLogic.canStart(prompt: ""))
        XCTAssertFalse(NLGrafanaPanelLogic.canStart(prompt: "   \n "))
    }

    func testButtonDisabled() {
        XCTAssertFalse(NLGrafanaPanelLogic.buttonDisabled(
            prompt: "go", phase: .idle, connection: .live
        ))
        XCTAssertTrue(NLGrafanaPanelLogic.buttonDisabled(
            prompt: "go", phase: .streaming, connection: .live
        ))
        XCTAssertTrue(NLGrafanaPanelLogic.buttonDisabled(
            prompt: "", phase: .idle, connection: .live
        ))
        XCTAssertTrue(NLGrafanaPanelLogic.buttonDisabled(
            prompt: "go", phase: .idle, connection: .offline
        ))
    }

    func testCanApply() {
        XCTAssertTrue(NLGrafanaPanelLogic.canApply(hasDraft: true, phase: .done))
        XCTAssertTrue(NLGrafanaPanelLogic.canApply(hasDraft: true, phase: .idle))
        XCTAssertFalse(NLGrafanaPanelLogic.canApply(hasDraft: false, phase: .done))
        XCTAssertFalse(NLGrafanaPanelLogic.canApply(hasDraft: true, phase: .streaming))
    }

    func testOutputVisible() {
        XCTAssertFalse(NLGrafanaPanelLogic.outputVisible(phase: .idle, hasText: false))
        XCTAssertTrue(NLGrafanaPanelLogic.outputVisible(phase: .idle, hasText: true))
        XCTAssertTrue(NLGrafanaPanelLogic.outputVisible(phase: .streaming, hasText: false))
        XCTAssertTrue(NLGrafanaPanelLogic.outputVisible(phase: .done, hasText: false))
        XCTAssertTrue(NLGrafanaPanelLogic.outputVisible(phase: .error("x"), hasText: false))
    }

    func testThinkingVisible() {
        XCTAssertTrue(NLGrafanaPanelLogic.thinkingVisible(phase: .streaming, hasText: false))
        XCTAssertFalse(NLGrafanaPanelLogic.thinkingVisible(phase: .streaming, hasText: true))
        XCTAssertFalse(NLGrafanaPanelLogic.thinkingVisible(phase: .idle, hasText: false))
    }

    func testIsIdleInvite() {
        XCTAssertTrue(NLGrafanaPanelLogic.isIdleInvite(phase: .idle, hasText: false))
        XCTAssertFalse(NLGrafanaPanelLogic.isIdleInvite(phase: .idle, hasText: true))
        XCTAssertFalse(NLGrafanaPanelLogic.isIdleInvite(phase: .streaming, hasText: false))
    }

    func testEmptyHintReflectsPrompt() {
        XCTAssertEqual(NLGrafanaPanelLogic.emptyHint(prompt: "", phase: .idle), .enterPrompt)
        XCTAssertEqual(NLGrafanaPanelLogic.emptyHint(prompt: "  \n", phase: .idle), .enterPrompt)
        XCTAssertNil(NLGrafanaPanelLogic.emptyHint(prompt: "daily distance", phase: .idle))
        XCTAssertNil(NLGrafanaPanelLogic.emptyHint(prompt: "", phase: .streaming))
        XCTAssertNil(NLGrafanaPanelLogic.emptyHint(prompt: "", phase: .pausedConfirm))
    }
}

// MARK: - Accessibility summary

@MainActor final class NLGrafanaPanelAccessibilityTests: XCTestCase {
    private let labels = NLGrafanaPanelAccessibility.Labels(
        title: "Helix natural-language Grafana panel drafter",
        thinking: "Helix is thinking…",
        resultsReady: "Rationale ready",
        draftReady: "Panel draft ready to apply",
        error: "Helix error:"
    )

    func testIdleReadsTitleOnly() {
        let summary = NLGrafanaPanelAccessibility.summary(
            labels: labels, phase: .idle, hasAnswer: false, hasDraft: false
        )
        XCTAssertEqual(summary, "Helix natural-language Grafana panel drafter")
    }

    func testStreamingAppendsThinking() {
        let summary = NLGrafanaPanelAccessibility.summary(
            labels: labels, phase: .streaming, hasAnswer: false, hasDraft: false
        )
        XCTAssertEqual(summary, "Helix natural-language Grafana panel drafter. Helix is thinking…")
    }

    func testStreamingSuppressesDraftCue() {
        // While streaming the draft cue is held back (web `canApply` is false mid-stream).
        let summary = NLGrafanaPanelAccessibility.summary(
            labels: labels, phase: .streaming, hasAnswer: false, hasDraft: true
        )
        XCTAssertEqual(summary, "Helix natural-language Grafana panel drafter. Helix is thinking…")
    }

    func testDoneWithAnswerAppendsRationaleReady() {
        let summary = NLGrafanaPanelAccessibility.summary(
            labels: labels, phase: .done, hasAnswer: true, hasDraft: false
        )
        XCTAssertEqual(summary, "Helix natural-language Grafana panel drafter. Rationale ready")
    }

    func testDoneWithDraftAppendsDraftReady() {
        let summary = NLGrafanaPanelAccessibility.summary(
            labels: labels, phase: .done, hasAnswer: true, hasDraft: true
        )
        XCTAssertEqual(
            summary,
            "Helix natural-language Grafana panel drafter. Rationale ready. Panel draft ready to apply"
        )
    }

    func testErrorAppendsLabelAndMessage() {
        let summary = NLGrafanaPanelAccessibility.summary(
            labels: labels, phase: .error("rate limited"), hasAnswer: false, hasDraft: false
        )
        XCTAssertEqual(
            summary, "Helix natural-language Grafana panel drafter. Helix error: rate limited"
        )
    }

    func testEmptyErrorMessageReadsLabelOnly() {
        let summary = NLGrafanaPanelAccessibility.summary(
            labels: labels, phase: .error(""), hasAnswer: false, hasDraft: false
        )
        XCTAssertEqual(summary, "Helix natural-language Grafana panel drafter. Helix error:")
    }
}

// MARK: - i18n facade

@MainActor final class NLGrafanaPanelStringsTests: XCTestCase {
    /// The "AINLGrafanaPanel" table folds in at integration time, so the test bundle resolves
    /// each key to its `value:` fallback — deterministic for assertions.
    func testResolvesKeysToFallback() {
        XCTAssertEqual(
            NLGrafanaPanelStrings.string(
                "powerGrafana.aiDrafter.title", "Helix natural-language Grafana panel drafter"
            ),
            "Helix natural-language Grafana panel drafter"
        )
        XCTAssertEqual(
            NLGrafanaPanelStrings.string("powerGrafana.aiDrafter.button", "Draft panel"),
            "Draft panel"
        )
        XCTAssertEqual(
            NLGrafanaPanelStrings.string("powerGrafana.aiDrafter.applyButton", "Apply to editor"),
            "Apply to editor"
        )
        XCTAssertEqual(NLGrafanaPanelStrings.string("helix.askHelix", "Ask Helix"), "Ask Helix")
        XCTAssertEqual(
            NLGrafanaPanelStrings.string("powerGrafana.aiDrafter.promptLabel", "Grafana panel request"),
            "Grafana panel request"
        )
        XCTAssertEqual(NLGrafanaPanelStrings.table, "AINLGrafanaPanel")
    }
}
