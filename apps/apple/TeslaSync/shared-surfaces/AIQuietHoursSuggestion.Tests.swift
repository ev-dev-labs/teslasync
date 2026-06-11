//
//  AIQuietHoursSuggestion.Tests.swift
//  TeslaSync — P4 shared surface · 0041 · AIQuietHoursSuggestion (Apple)
//
//  Unit coverage for the AIQuietHoursSuggestion surface:
//    • Logic — the stream-lifecycle button predicates (isBusy / canStart / buttonDisabled / canApply
//      / output visibility / idle-hint) + the gate render axis + the `{{token}}` interpolation.
//    • Surface identity + stream event equality.
//    • i18n facade — the per-surface table resolves each key to its English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets and in the SwiftPM verification harness. They
//  have no network and no real store. The adapter projection, the proposal decode, and the
//  accessibility seam are covered in `…AdapterTests.swift`; the per-state model behaviour is asserted
//  in `…ModelTests.swift`; per-state view rendering is covered by the #Preview blocks.
//

import XCTest
@testable import TeslaSync

// MARK: - Render axis (web `withAiFeature` gate + P4 leaf gate-error)

@MainActor final class QuietHoursSuggestionRenderStateTests: XCTestCase {
    func testGatedOffWinsOverEverything() {
        XCTAssertEqual(QuietHoursSuggestionLogic.renderState(gate: .off, gateError: nil), .gatedOff)
        XCTAssertEqual(QuietHoursSuggestionLogic.renderState(gate: .off, gateError: "ignored"), .gatedOff)
    }

    func testErrorBeatsLoadingWhenGateOn() {
        XCTAssertEqual(
            QuietHoursSuggestionLogic.renderState(gate: .loading, gateError: "boom"), .gateError("boom")
        )
        XCTAssertEqual(
            QuietHoursSuggestionLogic.renderState(gate: .on, gateError: "boom"), .gateError("boom")
        )
    }

    func testEmptyErrorIsNotAnError() {
        XCTAssertEqual(QuietHoursSuggestionLogic.renderState(gate: .loading, gateError: ""), .gateLoading)
        XCTAssertEqual(QuietHoursSuggestionLogic.renderState(gate: .on, gateError: ""), .ready)
    }

    func testLoadingAndReady() {
        XCTAssertEqual(QuietHoursSuggestionLogic.renderState(gate: .loading, gateError: nil), .gateLoading)
        XCTAssertEqual(QuietHoursSuggestionLogic.renderState(gate: .on, gateError: nil), .ready)
    }
}

// MARK: - Button / output logic (web component + AIFeatureCard + AiOutputPanel)

@MainActor final class QuietHoursSuggestionLogicTests: XCTestCase {
    func testIsBusyCoversStreamingAndPausedConfirm() {
        XCTAssertTrue(QuietHoursSuggestionLogic.isBusy(.streaming))
        XCTAssertTrue(QuietHoursSuggestionLogic.isBusy(.pausedConfirm))
        XCTAssertFalse(QuietHoursSuggestionLogic.isBusy(.idle))
        XCTAssertFalse(QuietHoursSuggestionLogic.isBusy(.done))
        XCTAssertFalse(QuietHoursSuggestionLogic.isBusy(.error("x")))
    }

    func testCanStartIsBlockedOnlyByPausedConfirm() {
        // Web `canStart = stream.state !== 'paused-confirm'` — no vehicle/prompt predicate exists.
        XCTAssertTrue(QuietHoursSuggestionLogic.canStart(phase: .idle))
        XCTAssertTrue(QuietHoursSuggestionLogic.canStart(phase: .streaming))
        XCTAssertTrue(QuietHoursSuggestionLogic.canStart(phase: .done))
        XCTAssertTrue(QuietHoursSuggestionLogic.canStart(phase: .error("x")))
        XCTAssertFalse(QuietHoursSuggestionLogic.canStart(phase: .pausedConfirm))
    }

    func testButtonDisabledMirrorsBusyPlusOffline() {
        XCTAssertFalse(QuietHoursSuggestionLogic.buttonDisabled(phase: .idle, connection: .live))
        XCTAssertFalse(QuietHoursSuggestionLogic.buttonDisabled(phase: .done, connection: .live))
        XCTAssertTrue(QuietHoursSuggestionLogic.buttonDisabled(phase: .streaming, connection: .live))
        XCTAssertTrue(QuietHoursSuggestionLogic.buttonDisabled(phase: .pausedConfirm, connection: .live))
        XCTAssertTrue(QuietHoursSuggestionLogic.buttonDisabled(phase: .idle, connection: .offline))
    }

    func testCanApplyRequiresProposalAndNotBusy() {
        // Web Apply button `disabled={proposal == null || isBusy}`.
        XCTAssertTrue(QuietHoursSuggestionLogic.canApply(hasProposal: true, phase: .idle))
        XCTAssertTrue(QuietHoursSuggestionLogic.canApply(hasProposal: true, phase: .done))
        XCTAssertFalse(QuietHoursSuggestionLogic.canApply(hasProposal: true, phase: .streaming))
        XCTAssertFalse(QuietHoursSuggestionLogic.canApply(hasProposal: true, phase: .pausedConfirm))
        XCTAssertFalse(QuietHoursSuggestionLogic.canApply(hasProposal: false, phase: .idle))
    }

    func testOutputVisible() {
        XCTAssertFalse(QuietHoursSuggestionLogic.outputVisible(phase: .idle, hasText: false))
        XCTAssertTrue(QuietHoursSuggestionLogic.outputVisible(phase: .idle, hasText: true))
        XCTAssertTrue(QuietHoursSuggestionLogic.outputVisible(phase: .streaming, hasText: false))
        XCTAssertTrue(QuietHoursSuggestionLogic.outputVisible(phase: .done, hasText: false))
        XCTAssertTrue(QuietHoursSuggestionLogic.outputVisible(phase: .error("x"), hasText: false))
    }

    func testThinkingVisible() {
        XCTAssertTrue(QuietHoursSuggestionLogic.thinkingVisible(phase: .streaming, hasText: false))
        XCTAssertFalse(QuietHoursSuggestionLogic.thinkingVisible(phase: .streaming, hasText: true))
        XCTAssertFalse(QuietHoursSuggestionLogic.thinkingVisible(phase: .idle, hasText: false))
    }

    func testShowIdleHintOnlyWhenRestingAndEmpty() {
        XCTAssertTrue(QuietHoursSuggestionLogic.showIdleHint(phase: .idle, hasProposal: false, hasText: false))
        XCTAssertFalse(QuietHoursSuggestionLogic.showIdleHint(phase: .idle, hasProposal: true, hasText: false))
        XCTAssertFalse(QuietHoursSuggestionLogic.showIdleHint(phase: .idle, hasProposal: false, hasText: true))
        XCTAssertFalse(QuietHoursSuggestionLogic.showIdleHint(phase: .streaming, hasProposal: false, hasText: false))
    }
}

// MARK: - i18n `{{token}}` interpolation (web `t(key, vars)`)

@MainActor final class QuietHoursSuggestionInterpolationTests: XCTestCase {
    func testReplacesEveryToken() {
        let out = QuietHoursSuggestionLogic.interpolate(
            "Window: {{start}} → {{end}} ({{tz}})",
            ["start": "22:00", "end": "07:00", "tz": "America/Los_Angeles"]
        )
        XCTAssertEqual(out, "Window: 22:00 → 07:00 (America/Los_Angeles)")
    }

    func testLeavesUnmatchedTokensIntact() {
        let out = QuietHoursSuggestionLogic.interpolate("Weekday bitmask: {{weekdays}}", [:])
        XCTAssertEqual(out, "Weekday bitmask: {{weekdays}}")
    }

    func testCountTokenSubstitution() {
        let out = QuietHoursSuggestionLogic.interpolate(
            "You already have {{count}} quiet-hours window(s) configured.", ["count": "2"]
        )
        XCTAssertEqual(out, "You already have 2 quiet-hours window(s) configured.")
    }
}

// MARK: - Surface identity + stream event

@MainActor final class QuietHoursSuggestionSurfaceTests: XCTestCase {
    func testSurfaceConstants() {
        XCTAssertEqual(QuietHoursSuggestionSurface.slug, "AIQuietHoursSuggestion")
        XCTAssertEqual(QuietHoursSuggestionSurface.featureID, "quiet-hours-suggestion")
        // The View's public aliases match the non-UI constants (source of truth here so the assertion
        // also runs in the SwiftUI-free harness).
        XCTAssertEqual(AIQuietHoursSuggestion.surfaceSlug, QuietHoursSuggestionSurface.slug)
        XCTAssertEqual(AIQuietHoursSuggestion.featureID, QuietHoursSuggestionSurface.featureID)
    }

    func testToolNameConstant() {
        XCTAssertEqual(QuietHoursDraftProposal.toolName, "draft_quiet_hours_window")
    }

    func testStreamEventEquatable() {
        XCTAssertEqual(QuietHoursSuggestionStreamEvent.delta(text: "a"), .delta(text: "a"))
        XCTAssertNotEqual(QuietHoursSuggestionStreamEvent.delta(text: "a"), .delta(text: "b"))
        XCTAssertNotEqual(
            QuietHoursSuggestionStreamEvent.done(finishReason: "stop"), .error(message: "x")
        )
    }
}

// MARK: - i18n facade

@MainActor final class QuietHoursSuggestionStringsTests: XCTestCase {
    /// The "AIQuietHoursSuggestion" table folds in at integration time, so the test bundle resolves
    /// each key to its `value:` fallback — deterministic for assertions.
    func testResolvesKeysToFallback() {
        XCTAssertEqual(
            QuietHoursSuggestionStrings.string(
                "notifications.quietHours.aiSuggestion.button", "Suggest quiet hours"
            ),
            "Suggest quiet hours"
        )
        XCTAssertEqual(QuietHoursSuggestionStrings.string("helix.askHelix", "Ask Helix"), "Ask Helix")
        XCTAssertEqual(QuietHoursSuggestionStrings.table, "AIQuietHoursSuggestion")
    }
}
