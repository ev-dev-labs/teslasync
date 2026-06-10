//
//  AINLAutomationBuilder.Tests.swift
//  TeslaSync — P4 shared surface · 0030 · AINLAutomationBuilder (Apple)
//
//  Unit coverage for the AINLAutomationBuilder surface:
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

@MainActor final class NLAutomationBuilderRenderStateTests: XCTestCase {
    func testGatedOffWinsOverEverything() {
        XCTAssertEqual(NLAutomationBuilderLogic.renderState(gate: .off, gateError: nil), .gatedOff)
        XCTAssertEqual(NLAutomationBuilderLogic.renderState(gate: .off, gateError: "ignored"), .gatedOff)
    }

    func testErrorBeatsLoadingWhenGateOn() {
        XCTAssertEqual(
            NLAutomationBuilderLogic.renderState(gate: .loading, gateError: "boom"), .gateError("boom")
        )
        XCTAssertEqual(
            NLAutomationBuilderLogic.renderState(gate: .on, gateError: "boom"), .gateError("boom")
        )
    }

    func testEmptyErrorIsNotAnError() {
        XCTAssertEqual(NLAutomationBuilderLogic.renderState(gate: .loading, gateError: ""), .gateLoading)
        XCTAssertEqual(NLAutomationBuilderLogic.renderState(gate: .on, gateError: ""), .ready)
    }

    func testLoadingAndReady() {
        XCTAssertEqual(NLAutomationBuilderLogic.renderState(gate: .loading, gateError: nil), .gateLoading)
        XCTAssertEqual(NLAutomationBuilderLogic.renderState(gate: .on, gateError: nil), .ready)
    }
}

// MARK: - Button / output logic (web AIFeatureCard + AiOutputPanel)

@MainActor final class NLAutomationBuilderLogicTests: XCTestCase {
    func testIsBusy() {
        XCTAssertTrue(NLAutomationBuilderLogic.isBusy(.streaming))
        XCTAssertTrue(NLAutomationBuilderLogic.isBusy(.pausedConfirm))
        XCTAssertFalse(NLAutomationBuilderLogic.isBusy(.idle))
        XCTAssertFalse(NLAutomationBuilderLogic.isBusy(.done))
        XCTAssertFalse(NLAutomationBuilderLogic.isBusy(.error("x")))
    }

    func testCanStartUsesVehiclePresenceNotPositivity() {
        // Web `vehicleId != null` — a present id (even 0) satisfies the gate; nil does not.
        XCTAssertTrue(NLAutomationBuilderLogic.canStart(vehicleID: 42, prompt: "go", phase: .idle))
        XCTAssertTrue(NLAutomationBuilderLogic.canStart(vehicleID: 0, prompt: "go", phase: .idle))
        XCTAssertFalse(NLAutomationBuilderLogic.canStart(vehicleID: nil, prompt: "go", phase: .idle))
    }

    func testCanStartRequiresNonBlankPromptAndNotPaused() {
        XCTAssertFalse(NLAutomationBuilderLogic.canStart(vehicleID: 1, prompt: "", phase: .idle))
        XCTAssertFalse(NLAutomationBuilderLogic.canStart(vehicleID: 1, prompt: "   \n ", phase: .idle))
        XCTAssertFalse(NLAutomationBuilderLogic.canStart(vehicleID: 1, prompt: "go", phase: .pausedConfirm))
        XCTAssertTrue(NLAutomationBuilderLogic.canStart(vehicleID: 1, prompt: "go", phase: .streaming))
    }

    func testButtonDisabled() {
        XCTAssertFalse(NLAutomationBuilderLogic.buttonDisabled(
            vehicleID: 1, prompt: "go", phase: .idle, connection: .live
        ))
        XCTAssertTrue(NLAutomationBuilderLogic.buttonDisabled(
            vehicleID: 1, prompt: "go", phase: .streaming, connection: .live
        ))
        XCTAssertTrue(NLAutomationBuilderLogic.buttonDisabled(
            vehicleID: nil, prompt: "go", phase: .idle, connection: .live
        ))
        XCTAssertTrue(NLAutomationBuilderLogic.buttonDisabled(
            vehicleID: 1, prompt: "", phase: .idle, connection: .live
        ))
        XCTAssertTrue(NLAutomationBuilderLogic.buttonDisabled(
            vehicleID: 1, prompt: "go", phase: .idle, connection: .offline
        ))
    }

    func testOutputVisible() {
        XCTAssertFalse(NLAutomationBuilderLogic.outputVisible(phase: .idle, hasText: false))
        XCTAssertTrue(NLAutomationBuilderLogic.outputVisible(phase: .idle, hasText: true))
        XCTAssertTrue(NLAutomationBuilderLogic.outputVisible(phase: .streaming, hasText: false))
        XCTAssertTrue(NLAutomationBuilderLogic.outputVisible(phase: .done, hasText: false))
        XCTAssertTrue(NLAutomationBuilderLogic.outputVisible(phase: .error("x"), hasText: false))
    }

    func testThinkingVisible() {
        XCTAssertTrue(NLAutomationBuilderLogic.thinkingVisible(phase: .streaming, hasText: false))
        XCTAssertFalse(NLAutomationBuilderLogic.thinkingVisible(phase: .streaming, hasText: true))
        XCTAssertFalse(NLAutomationBuilderLogic.thinkingVisible(phase: .idle, hasText: false))
    }

    func testIsIdleInvite() {
        XCTAssertTrue(NLAutomationBuilderLogic.isIdleInvite(phase: .idle, hasText: false))
        XCTAssertFalse(NLAutomationBuilderLogic.isIdleInvite(phase: .idle, hasText: true))
        XCTAssertFalse(NLAutomationBuilderLogic.isIdleInvite(phase: .streaming, hasText: false))
    }

    func testEmptyHintPicksFirstUnmetPredicate() {
        XCTAssertEqual(
            NLAutomationBuilderLogic.emptyHint(vehicleID: nil, prompt: "go", phase: .idle), .selectVehicle
        )
        XCTAssertEqual(
            NLAutomationBuilderLogic.emptyHint(vehicleID: 5, prompt: "  ", phase: .idle), .describeAutomation
        )
        XCTAssertNil(NLAutomationBuilderLogic.emptyHint(vehicleID: 5, prompt: "go", phase: .idle))
        // No hint while busy/paused — the disabled reason there is the stream, not input.
        XCTAssertNil(NLAutomationBuilderLogic.emptyHint(vehicleID: nil, prompt: "", phase: .streaming))
        XCTAssertNil(NLAutomationBuilderLogic.emptyHint(vehicleID: nil, prompt: "", phase: .pausedConfirm))
    }
}

// MARK: - Projection (cached inputs → render decisions)

@MainActor final class NLAutomationBuilderProjectionTests: XCTestCase {
    private func project(
        _ snapshot: NLAutomationBuilderInputSnapshot,
        prompt: String,
        phase: NLAutomationBuilderStreamPhase,
        streamText: String = ""
    ) -> NLAutomationBuilderProjection {
        NLAutomationBuilderProjection.make(
            snapshot: snapshot, prompt: prompt, phase: phase, streamText: streamText
        )
    }

    func testReadyIdleInviteProjection() {
        let projection = project(
            NLAutomationBuilderInputSnapshot(gate: .on, vehicleID: 42), prompt: "", phase: .idle
        )
        XCTAssertEqual(projection.renderState, .ready)
        XCTAssertFalse(projection.canStart)
        XCTAssertTrue(projection.buttonDisabled)
        XCTAssertFalse(projection.isStreaming)
        XCTAssertFalse(projection.outputVisible)
        XCTAssertFalse(projection.thinkingVisible)
        XCTAssertEqual(projection.emptyHint, .describeAutomation)
        XCTAssertEqual(projection.connection, .live)
    }

    func testReadyWithPromptEnablesAction() {
        let projection = project(
            NLAutomationBuilderInputSnapshot(gate: .on, vehicleID: 42),
            prompt: "precondition cabin", phase: .idle
        )
        XCTAssertTrue(projection.canStart)
        XCTAssertFalse(projection.buttonDisabled)
        XCTAssertNil(projection.emptyHint)
    }

    func testStreamingProjection() {
        let projection = project(
            NLAutomationBuilderInputSnapshot(gate: .on, vehicleID: 42), prompt: "go", phase: .streaming
        )
        XCTAssertTrue(projection.isStreaming)
        XCTAssertTrue(projection.buttonDisabled)
        XCTAssertTrue(projection.outputVisible)
        XCTAssertTrue(projection.thinkingVisible)
        XCTAssertNil(projection.emptyHint)
    }

    func testStreamedTextHidesThinking() {
        let projection = project(
            NLAutomationBuilderInputSnapshot(gate: .on, vehicleID: 42),
            prompt: "go", phase: .streaming, streamText: "Drafting…"
        )
        XCTAssertTrue(projection.outputVisible)
        XCTAssertFalse(projection.thinkingVisible)
    }

    func testOfflineDisablesAction() {
        let projection = project(
            NLAutomationBuilderInputSnapshot(gate: .on, vehicleID: 42, connection: .offline),
            prompt: "go", phase: .idle
        )
        XCTAssertTrue(projection.canStart)
        XCTAssertTrue(projection.buttonDisabled)
        XCTAssertEqual(projection.connection, .offline)
    }

    func testGateProjectionAxes() {
        XCTAssertEqual(
            project(
                NLAutomationBuilderInputSnapshot(gate: .off, vehicleID: 42), prompt: "go", phase: .idle
            ).renderState, .gatedOff
        )
        XCTAssertEqual(
            project(
                NLAutomationBuilderInputSnapshot(gate: .loading, vehicleID: nil), prompt: "", phase: .idle
            ).renderState, .gateLoading
        )
        XCTAssertEqual(
            project(
                NLAutomationBuilderInputSnapshot(gate: .on, vehicleID: 42, errorMessage: "down"),
                prompt: "go", phase: .idle
            ).renderState, .gateError("down")
        )
    }
}

// MARK: - Accessibility summary

@MainActor final class NLAutomationBuilderAccessibilityTests: XCTestCase {
    private let labels = NLAutomationBuilderAccessibility.Labels(
        title: "Draft from natural language",
        thinking: "Helix is thinking…",
        errorLabel: "Helix error:",
        errorUnknown: "unknown"
    )

    func testTitleOnlyWhenIdle() {
        let summary = NLAutomationBuilderAccessibility.summary(labels: labels, phase: .idle, streamText: "")
        XCTAssertEqual(summary, "Draft from natural language")
    }

    func testThinkingWhileStreamingWithNoText() {
        let summary = NLAutomationBuilderAccessibility.summary(labels: labels, phase: .streaming, streamText: "")
        XCTAssertEqual(summary, "Draft from natural language. Helix is thinking…")
    }

    func testStreamedTextIsRead() {
        let summary = NLAutomationBuilderAccessibility.summary(
            labels: labels, phase: .streaming, streamText: "Drafting a graph"
        )
        XCTAssertEqual(summary, "Draft from natural language. Drafting a graph")
    }

    func testDoneWithTextIsRead() {
        let summary = NLAutomationBuilderAccessibility.summary(
            labels: labels, phase: .done, streamText: "Saved draft ready"
        )
        XCTAssertEqual(summary, "Draft from natural language. Saved draft ready")
    }

    func testErrorReadsLabelAndMessage() {
        let summary = NLAutomationBuilderAccessibility.summary(
            labels: labels, phase: .error("rate limited"), streamText: ""
        )
        XCTAssertEqual(summary, "Draft from natural language. Helix error: rate limited")
    }

    func testEmptyErrorMessageFallsBackToUnknown() {
        let summary = NLAutomationBuilderAccessibility.summary(labels: labels, phase: .error(""), streamText: "")
        XCTAssertEqual(summary, "Draft from natural language. Helix error: unknown")
    }
}

// MARK: - Surface identity + stream event

@MainActor final class NLAutomationBuilderSurfaceTests: XCTestCase {
    func testSurfaceConstants() {
        XCTAssertEqual(NLAutomationBuilderSurface.slug, "AINLAutomationBuilder")
        XCTAssertEqual(NLAutomationBuilderSurface.featureID, "nl-automation-builder")
        // The View's public aliases match the non-UI constants (source of truth here so the
        // assertion also runs in the SwiftUI-free harness).
        XCTAssertEqual(AINLAutomationBuilder.surfaceSlug, NLAutomationBuilderSurface.slug)
        XCTAssertEqual(AINLAutomationBuilder.featureID, NLAutomationBuilderSurface.featureID)
    }

    func testStreamEventEquatable() {
        XCTAssertEqual(NLAutomationBuilderStreamEvent.delta(text: "a"), .delta(text: "a"))
        XCTAssertNotEqual(NLAutomationBuilderStreamEvent.delta(text: "a"), .delta(text: "b"))
        XCTAssertNotEqual(NLAutomationBuilderStreamEvent.done(finishReason: "stop"), .error(message: "x"))
    }
}

// MARK: - i18n facade

@MainActor final class NLAutomationBuilderStringsTests: XCTestCase {
    /// The "AINLAutomationBuilder" table folds in at integration time, so the test bundle
    /// resolves each key to its `value:` fallback — deterministic for assertions.
    func testResolvesKeysToFallback() {
        XCTAssertEqual(
            NLAutomationBuilderStrings.string(
                "automations.builder.aiBuilder.title", "Draft from natural language"
            ),
            "Draft from natural language"
        )
        XCTAssertEqual(NLAutomationBuilderStrings.string("helix.askHelix", "Ask Helix"), "Ask Helix")
        XCTAssertEqual(NLAutomationBuilderStrings.table, "AINLAutomationBuilder")
    }
}
