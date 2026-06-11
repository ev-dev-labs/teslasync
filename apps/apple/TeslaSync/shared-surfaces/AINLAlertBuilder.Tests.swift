//
//  AINLAlertBuilder.Tests.swift
//  TeslaSync — P4 shared surface · 0029 · AINLAlertBuilder (Apple)
//
//  Unit coverage for the AINLAlertBuilder surface:
//    • Adapter/Projection — the cached-inputs → render-decisions map (the web `AIFeatureCard` +
//      `AiOutputPanel` branches) that the view reads and the model derives.
//    • Logic — the prompt/stream-lifecycle button predicates (isBusy / canStart / buttonDisabled
//      / output visibility / idle-invite / emptyHint) + the gate render axis.
//    • Accessibility — the spoken card summary across the stream lifecycle.
//    • i18n facade — the per-surface table resolves each key to its English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets and in the SwiftPM verification harness.
//  They have no network and no real store. Per-state view rendering is covered by the #Preview
//  blocks (compiled by the app targets); the per-state *behaviour* is asserted in
//  `…ModelTests.swift` through the model's derived flags.
//

import XCTest
@testable import TeslaSync

// MARK: - Render axis (web `withAiFeature` gate + P4 leaf gate-error)

@MainActor final class NLAlertBuilderRenderStateTests: XCTestCase {
    func testGatedOffWinsOverEverything() {
        XCTAssertEqual(NLAlertBuilderLogic.renderState(gate: .off, gateError: nil), .gatedOff)
        XCTAssertEqual(NLAlertBuilderLogic.renderState(gate: .off, gateError: "ignored"), .gatedOff)
    }

    func testErrorBeatsLoadingWhenGateOn() {
        XCTAssertEqual(
            NLAlertBuilderLogic.renderState(gate: .loading, gateError: "boom"), .gateError("boom")
        )
        XCTAssertEqual(
            NLAlertBuilderLogic.renderState(gate: .on, gateError: "boom"), .gateError("boom")
        )
    }

    func testEmptyErrorIsNotAnError() {
        XCTAssertEqual(NLAlertBuilderLogic.renderState(gate: .loading, gateError: ""), .gateLoading)
        XCTAssertEqual(NLAlertBuilderLogic.renderState(gate: .on, gateError: ""), .ready)
    }

    func testLoadingAndReady() {
        XCTAssertEqual(NLAlertBuilderLogic.renderState(gate: .loading, gateError: nil), .gateLoading)
        XCTAssertEqual(NLAlertBuilderLogic.renderState(gate: .on, gateError: nil), .ready)
    }
}

// MARK: - Button / output logic (web AIFeatureCard + AiOutputPanel)

@MainActor final class NLAlertBuilderLogicTests: XCTestCase {
    func testIsBusy() {
        XCTAssertTrue(NLAlertBuilderLogic.isBusy(.streaming))
        XCTAssertTrue(NLAlertBuilderLogic.isBusy(.pausedConfirm))
        XCTAssertFalse(NLAlertBuilderLogic.isBusy(.idle))
        XCTAssertFalse(NLAlertBuilderLogic.isBusy(.done))
        XCTAssertFalse(NLAlertBuilderLogic.isBusy(.error("x")))
    }

    func testCanStartUsesVehiclePresenceNotPositivity() {
        // Web `vehicleId != null` — a present id (even 0) satisfies the gate; nil does not.
        XCTAssertTrue(NLAlertBuilderLogic.canStart(vehicleID: 42, prompt: "go", phase: .idle))
        XCTAssertTrue(NLAlertBuilderLogic.canStart(vehicleID: 0, prompt: "go", phase: .idle))
        XCTAssertFalse(NLAlertBuilderLogic.canStart(vehicleID: nil, prompt: "go", phase: .idle))
    }

    func testCanStartRequiresNonBlankPromptAndNotPaused() {
        XCTAssertFalse(NLAlertBuilderLogic.canStart(vehicleID: 1, prompt: "", phase: .idle))
        XCTAssertFalse(NLAlertBuilderLogic.canStart(vehicleID: 1, prompt: "   \n ", phase: .idle))
        XCTAssertFalse(NLAlertBuilderLogic.canStart(vehicleID: 1, prompt: "go", phase: .pausedConfirm))
        XCTAssertTrue(NLAlertBuilderLogic.canStart(vehicleID: 1, prompt: "go", phase: .streaming))
    }

    func testButtonDisabled() {
        XCTAssertFalse(NLAlertBuilderLogic.buttonDisabled(
            vehicleID: 1, prompt: "go", phase: .idle, connection: .live
        ))
        XCTAssertTrue(NLAlertBuilderLogic.buttonDisabled(
            vehicleID: 1, prompt: "go", phase: .streaming, connection: .live
        ))
        XCTAssertTrue(NLAlertBuilderLogic.buttonDisabled(
            vehicleID: nil, prompt: "go", phase: .idle, connection: .live
        ))
        XCTAssertTrue(NLAlertBuilderLogic.buttonDisabled(
            vehicleID: 1, prompt: "", phase: .idle, connection: .live
        ))
        XCTAssertTrue(NLAlertBuilderLogic.buttonDisabled(
            vehicleID: 1, prompt: "go", phase: .idle, connection: .offline
        ))
    }

    func testOutputVisible() {
        XCTAssertFalse(NLAlertBuilderLogic.outputVisible(phase: .idle, hasText: false))
        XCTAssertTrue(NLAlertBuilderLogic.outputVisible(phase: .idle, hasText: true))
        XCTAssertTrue(NLAlertBuilderLogic.outputVisible(phase: .streaming, hasText: false))
        XCTAssertTrue(NLAlertBuilderLogic.outputVisible(phase: .done, hasText: false))
        XCTAssertTrue(NLAlertBuilderLogic.outputVisible(phase: .error("x"), hasText: false))
    }

    func testThinkingVisible() {
        XCTAssertTrue(NLAlertBuilderLogic.thinkingVisible(phase: .streaming, hasText: false))
        XCTAssertFalse(NLAlertBuilderLogic.thinkingVisible(phase: .streaming, hasText: true))
        XCTAssertFalse(NLAlertBuilderLogic.thinkingVisible(phase: .idle, hasText: false))
    }

    func testIsIdleInvite() {
        XCTAssertTrue(NLAlertBuilderLogic.isIdleInvite(phase: .idle, hasText: false))
        XCTAssertFalse(NLAlertBuilderLogic.isIdleInvite(phase: .idle, hasText: true))
        XCTAssertFalse(NLAlertBuilderLogic.isIdleInvite(phase: .streaming, hasText: false))
    }

    func testEmptyHintPicksFirstUnmetPredicate() {
        XCTAssertEqual(
            NLAlertBuilderLogic.emptyHint(vehicleID: nil, prompt: "go", phase: .idle), .selectVehicle
        )
        XCTAssertEqual(
            NLAlertBuilderLogic.emptyHint(vehicleID: 5, prompt: "  ", phase: .idle), .describeAlert
        )
        XCTAssertNil(NLAlertBuilderLogic.emptyHint(vehicleID: 5, prompt: "go", phase: .idle))
        // No hint while busy/paused — the disabled reason there is the stream, not input.
        XCTAssertNil(NLAlertBuilderLogic.emptyHint(vehicleID: nil, prompt: "", phase: .streaming))
        XCTAssertNil(NLAlertBuilderLogic.emptyHint(vehicleID: nil, prompt: "", phase: .pausedConfirm))
    }
}

// MARK: - Projection (cached inputs → render decisions)

@MainActor final class NLAlertBuilderProjectionTests: XCTestCase {
    private func project(
        _ snapshot: NLAlertBuilderInputSnapshot,
        prompt: String,
        phase: NLAlertBuilderStreamPhase,
        streamText: String = ""
    ) -> NLAlertBuilderProjection {
        NLAlertBuilderProjection.make(
            snapshot: snapshot, prompt: prompt, phase: phase, streamText: streamText
        )
    }

    func testReadyIdleInviteProjection() {
        let projection = project(
            NLAlertBuilderInputSnapshot(gate: .on, vehicleID: 42), prompt: "", phase: .idle
        )
        XCTAssertEqual(projection.renderState, .ready)
        XCTAssertFalse(projection.canStart)
        XCTAssertTrue(projection.buttonDisabled)
        XCTAssertFalse(projection.isStreaming)
        XCTAssertFalse(projection.outputVisible)
        XCTAssertFalse(projection.thinkingVisible)
        XCTAssertEqual(projection.emptyHint, .describeAlert)
        XCTAssertEqual(projection.connection, .live)
    }

    func testReadyWithPromptEnablesAction() {
        let projection = project(
            NLAlertBuilderInputSnapshot(gate: .on, vehicleID: 42),
            prompt: "alert on voltage spread", phase: .idle
        )
        XCTAssertTrue(projection.canStart)
        XCTAssertFalse(projection.buttonDisabled)
        XCTAssertNil(projection.emptyHint)
    }

    func testStreamingProjection() {
        let projection = project(
            NLAlertBuilderInputSnapshot(gate: .on, vehicleID: 42), prompt: "go", phase: .streaming
        )
        XCTAssertTrue(projection.isStreaming)
        XCTAssertTrue(projection.buttonDisabled)
        XCTAssertTrue(projection.outputVisible)
        XCTAssertTrue(projection.thinkingVisible)
        XCTAssertNil(projection.emptyHint)
    }

    func testStreamedTextHidesThinking() {
        let projection = project(
            NLAlertBuilderInputSnapshot(gate: .on, vehicleID: 42),
            prompt: "go", phase: .streaming, streamText: "Drafting…"
        )
        XCTAssertTrue(projection.outputVisible)
        XCTAssertFalse(projection.thinkingVisible)
    }

    func testOfflineDisablesAction() {
        let projection = project(
            NLAlertBuilderInputSnapshot(gate: .on, vehicleID: 42, connection: .offline),
            prompt: "go", phase: .idle
        )
        XCTAssertTrue(projection.canStart)
        XCTAssertTrue(projection.buttonDisabled)
        XCTAssertEqual(projection.connection, .offline)
    }

    func testGateProjectionAxes() {
        XCTAssertEqual(
            project(
                NLAlertBuilderInputSnapshot(gate: .off, vehicleID: 42), prompt: "go", phase: .idle
            ).renderState, .gatedOff
        )
        XCTAssertEqual(
            project(
                NLAlertBuilderInputSnapshot(gate: .loading, vehicleID: nil), prompt: "", phase: .idle
            ).renderState, .gateLoading
        )
        XCTAssertEqual(
            project(
                NLAlertBuilderInputSnapshot(gate: .on, vehicleID: 42, errorMessage: "down"),
                prompt: "go", phase: .idle
            ).renderState, .gateError("down")
        )
    }
}

// MARK: - Accessibility summary

@MainActor final class NLAlertBuilderAccessibilityTests: XCTestCase {
    private let labels = NLAlertBuilderAccessibility.Labels(
        title: "Draft from natural language",
        thinking: "Helix is thinking…",
        errorLabel: "Helix error:",
        errorUnknown: "unknown"
    )

    func testTitleOnlyWhenIdle() {
        let summary = NLAlertBuilderAccessibility.summary(labels: labels, phase: .idle, streamText: "")
        XCTAssertEqual(summary, "Draft from natural language")
    }

    func testThinkingWhileStreamingWithNoText() {
        let summary = NLAlertBuilderAccessibility.summary(labels: labels, phase: .streaming, streamText: "")
        XCTAssertEqual(summary, "Draft from natural language. Helix is thinking…")
    }

    func testStreamedTextIsRead() {
        let summary = NLAlertBuilderAccessibility.summary(
            labels: labels, phase: .streaming, streamText: "Drafting an AlertRule"
        )
        XCTAssertEqual(summary, "Draft from natural language. Drafting an AlertRule")
    }

    func testDoneWithTextIsRead() {
        let summary = NLAlertBuilderAccessibility.summary(
            labels: labels, phase: .done, streamText: "Saved draft ready"
        )
        XCTAssertEqual(summary, "Draft from natural language. Saved draft ready")
    }

    func testErrorReadsLabelAndMessage() {
        let summary = NLAlertBuilderAccessibility.summary(
            labels: labels, phase: .error("rate limited"), streamText: ""
        )
        XCTAssertEqual(summary, "Draft from natural language. Helix error: rate limited")
    }

    func testEmptyErrorMessageFallsBackToUnknown() {
        let summary = NLAlertBuilderAccessibility.summary(labels: labels, phase: .error(""), streamText: "")
        XCTAssertEqual(summary, "Draft from natural language. Helix error: unknown")
    }
}

// MARK: - Surface identity + stream event

@MainActor final class NLAlertBuilderSurfaceTests: XCTestCase {
    func testSurfaceConstants() {
        XCTAssertEqual(NLAlertBuilderSurface.slug, "AINLAlertBuilder")
        XCTAssertEqual(NLAlertBuilderSurface.featureID, "nl-alert-builder")
        // The View's public aliases match the non-UI constants (source of truth here so the
        // assertion also runs in the SwiftUI-free harness).
        XCTAssertEqual(AINLAlertBuilder.surfaceSlug, NLAlertBuilderSurface.slug)
        XCTAssertEqual(AINLAlertBuilder.featureID, NLAlertBuilderSurface.featureID)
    }

    func testStreamEventEquatable() {
        XCTAssertEqual(NLAlertBuilderStreamEvent.delta(text: "a"), .delta(text: "a"))
        XCTAssertNotEqual(NLAlertBuilderStreamEvent.delta(text: "a"), .delta(text: "b"))
        XCTAssertNotEqual(NLAlertBuilderStreamEvent.done(finishReason: "stop"), .error(message: "x"))
    }
}

// MARK: - i18n facade

@MainActor final class NLAlertBuilderStringsTests: XCTestCase {
    /// The "AINLAlertBuilder" table folds in at integration time, so the test bundle
    /// resolves each key to its `value:` fallback — deterministic for assertions.
    func testResolvesKeysToFallback() {
        XCTAssertEqual(
            NLAlertBuilderStrings.string(
                "notifications.alertStudio.aiBuilder.title", "Draft from natural language"
            ),
            "Draft from natural language"
        )
        XCTAssertEqual(NLAlertBuilderStrings.string("helix.askHelix", "Ask Helix"), "Ask Helix")
        XCTAssertEqual(NLAlertBuilderStrings.table, "AINLAlertBuilder")
    }
}
