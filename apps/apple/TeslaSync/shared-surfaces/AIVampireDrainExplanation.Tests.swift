//
//  AIVampireDrainExplanation.Tests.swift
//  TeslaSync — P4 shared surface · 0057 · AIVampireDrainExplanation (Apple)
//
//  Unit coverage for the AIVampireDrainExplanation surface:
//    • Projection — gated / loading / error / ready, the `canStart = isFinite(vehicleId) &&
//      vehicleId > 0` rule (incl. the 0 / negative edges), the Ask-Helix label flip, the disabled
//      rule, and every localized `AiOutputPanel` branch (empty / no-vehicle / thinking / prose /
//      error / unknown-error).
//    • State holder — `VampireDrainExplainModel` wiring, the P1/S11 `view.opened` telemetry
//      (deferred past the gate), the stale one-shot auto-refresh + re-arm, and the
//      generate / cancel / refresh / stop delegation.
//    • Accessibility — the VoiceOver action + output label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryVampireDrainExplainSource`, and the locale is injected for
//  determinism. In the test bundle the per-surface strings table is absent, so the i18n facade
//  returns the web English `value:` fallbacks, which these assertions check.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Projection: phases

@MainActor final class VampireDrainExplainProjectionPhaseTests: XCTestCase {
    func testGatedWhenFeatureDisabled() {
        let resolved = VampireDrainExplainProjection.resolve(
            VampireDrainExplainInput(availability: .resolved(enabled: false), vehicleID: 7),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertNil(resolved.ready)
    }

    func testLoadingWhenAvailabilityLoading() {
        let resolved = VampireDrainExplainProjection.resolve(
            VampireDrainExplainInput(availability: .loading),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.ready)
    }

    func testErrorWhenAvailabilityFailed() {
        let resolved = VampireDrainExplainProjection.resolve(
            VampireDrainExplainInput(availability: .failed("boom")),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.ready)
    }

    func testReadyWhenEnabled() {
        let resolved = VampireDrainExplainProjection.resolve(
            VampireDrainExplainInput(availability: .resolved(enabled: true), vehicleID: 7),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertNotNil(resolved.ready)
    }
}

// MARK: - Projection: ready card content

@MainActor final class VampireDrainExplainProjectionReadyTests: XCTestCase {
    private func ready(
        vehicleID: Int? = 7,
        stream: VampireDrainExplainStreamSnapshot = .idle
    ) -> VampireDrainExplainReady {
        let resolved = VampireDrainExplainProjection.resolve(
            VampireDrainExplainInput(
                availability: .resolved(enabled: true),
                vehicleID: vehicleID,
                stream: stream
            ),
            locale: enUS
        )
        return resolved.ready!
    }

    func testTitleDescriptionBadgeAreParityStrings() {
        let card = ready()
        XCTAssertEqual(card.title, "Explain the recent vampire drain")
        XCTAssertEqual(card.badge, "Helix")
        XCTAssertTrue(card.description.contains("deterministic vampire-drain signal"))
        XCTAssertTrue(card.description.contains("most-correlated per-event driver"))
        XCTAssertTrue(card.description.contains("correlational nature honestly"))
        XCTAssertEqual(card.buttonContext, "Narrate drain")
    }

    func testCanStartRequiresFiniteAndPositiveVehicle() {
        // Parity: web `haveInputs = Number.isFinite(numericVehicleId) && numericVehicleId > 0`.
        // 0 and negatives are disabled.
        XCTAssertTrue(ready(vehicleID: 7).canStart)
        XCTAssertFalse(ready(vehicleID: nil).canStart)
        XCTAssertFalse(ready(vehicleID: 0).canStart)
        XCTAssertFalse(ready(vehicleID: -3).canStart)
    }

    func testActionLabelIsAskHelixWhenIdle() {
        let card = ready(stream: .idle)
        XCTAssertEqual(card.actionTitle, "Ask Helix")
        XCTAssertFalse(card.action.isStreaming)
    }

    func testActionLabelFlipsToThinkingWhileStreaming() {
        let card = ready(stream: VampireDrainExplainStreamSnapshot(state: .streaming))
        XCTAssertTrue(card.action.isStreaming)
        XCTAssertTrue(card.actionTitle.contains("thinking"))
    }

    func testActionDisabledWithoutVehicleOrWhileStreaming() {
        XCTAssertTrue(ready(vehicleID: nil, stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(vehicleID: 0, stream: .idle).action.isDisabled)
        XCTAssertTrue(
            ready(vehicleID: 7, stream: VampireDrainExplainStreamSnapshot(state: .streaming)).action.isDisabled
        )
        XCTAssertFalse(ready(vehicleID: 7, stream: .idle).action.isDisabled)
    }

    func testActionAccessibilityLabelJoinsAskAndContext() {
        XCTAssertEqual(ready().actionAccessibilityLabel, "Ask Helix · Narrate drain")
    }
}

// MARK: - Projection: localized output branches

@MainActor final class VampireDrainExplainProjectionOutputTests: XCTestCase {
    private func output(
        vehicleID: Int? = 7,
        stream: VampireDrainExplainStreamSnapshot
    ) -> VampireDrainExplainResolvedOutput {
        VampireDrainExplainProjection.resolve(
            VampireDrainExplainInput(
                availability: .resolved(enabled: true),
                vehicleID: vehicleID,
                stream: stream
            ),
            locale: enUS
        ).ready!.output
    }

    func testEmptyHintWhenIdleWithVehicle() {
        let out = output(stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("No narration yet"))
    }

    func testNoVehicleHintWhenIdleWithoutVehicle() {
        let out = output(vehicleID: nil, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Select a vehicle"))
    }

    func testNoVehicleHintWhenVehicleIsZero() {
        // canStart is false for vehicleId 0 (not > 0) → the no-vehicle hint, not the idle hint.
        let out = output(vehicleID: 0, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Select a vehicle"))
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        let out = output(stream: VampireDrainExplainStreamSnapshot(state: .streaming, text: ""))
        XCTAssertEqual(out.kind, .thinking)
        XCTAssertTrue(out.body.contains("thinking"))
    }

    func testProseOnceTextArrives() {
        let out = output(
            stream: VampireDrainExplainStreamSnapshot(state: .streaming, text: "Sentry drains faster.")
        )
        XCTAssertEqual(out.kind, .prose)
        XCTAssertEqual(out.body, "Sentry drains faster.")
    }

    func testFailedComposesHelixErrorPrefix() {
        let out = output(stream: VampireDrainExplainStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("Helix error:"))
        XCTAssertTrue(out.body.contains("stream_http_429"))
    }

    func testFailedFallsBackToUnknownMessage() {
        let out = output(stream: VampireDrainExplainStreamSnapshot(state: .error, text: "", error: nil))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("unknown"))
    }
}

// MARK: - State holder: wiring, telemetry, freshness, gate, delegation

@MainActor final class VampireDrainExplainModelTests: XCTestCase {
    private func makeModel(
        _ input: VampireDrainExplainInput,
        telemetry: VampireDrainExplainTelemetry = OSLogVampireDrainExplainTelemetry()
    ) -> (VampireDrainExplainModel, InMemoryVampireDrainExplainSource) {
        let source = InMemoryVampireDrainExplainSource(initial: input)
        let model = VampireDrainExplainModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func enabled(
        vehicleID: Int? = 7,
        connection: VampireDrainExplainConnection = .live,
        stream: VampireDrainExplainStreamSnapshot = .idle
    ) -> VampireDrainExplainInput {
        VampireDrainExplainInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            connection: connection,
            stream: stream
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyVampireDrainExplainTelemetry()
        let (model, source) = makeModel(enabled(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(spy.surfaces, [AIVampireDrainExplanation.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpyVampireDrainExplainTelemetry()
        let (model, _) = makeModel(
            VampireDrainExplainInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertTrue(model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpyVampireDrainExplainTelemetry()
        let (model, source) = makeModel(
            VampireDrainExplainInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertEqual(spy.surfaces, [])
        source.push(enabled())
        XCTAssertFalse(model.isGated)
        XCTAssertEqual(spy.surfaces, [AIVampireDrainExplanation.surfaceSlug])
        // Staying presented must not re-emit.
        source.push(enabled(connection: .live))
        XCTAssertEqual(spy.surfaces, [AIVampireDrainExplanation.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(VampireDrainExplainInput(availability: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(enabled())
        XCTAssertEqual(model.phase, .ready)
    }

    func testStreamSnapshotFlowsIntoOutput() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(stream: VampireDrainExplainStreamSnapshot(state: .done, text: "Sentry is the driver.")))
        XCTAssertEqual(model.ready?.output.kind, .prose)
        XCTAssertEqual(model.ready?.output.body, "Sentry is the driver.")
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(enabled())
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(enabled(connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(enabled(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testLiveResetsStaleAutoRefreshArming() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(connection: .stale)) // refresh 1
        source.push(enabled(connection: .live)) // re-arm
        source.push(enabled(connection: .stale)) // refresh 2
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(enabled())
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testGenerateDelegatesToSource() {
        let (model, source) = makeModel(enabled())
        model.start()
        model.generate()
        XCTAssertEqual(source.generateCount, 1)
    }

    func testCancelDelegatesToSource() {
        let (model, source) = makeModel(enabled())
        model.start()
        model.cancel()
        XCTAssertEqual(source.cancelCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(enabled())
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(AIVampireDrainExplanation.surfaceSlug, "AIVampireDrainExplanation")
    }
}

// MARK: - Accessibility summary

@MainActor final class VampireDrainExplainAccessibilityTests: XCTestCase {
    func testActionLabelJoinsAskAndContext() {
        XCTAssertEqual(
            VampireDrainExplainAccessibility.actionLabel(ask: "Ask Helix", context: "Narrate drain"),
            "Ask Helix · Narrate drain"
        )
    }

    func testOutputLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            VampireDrainExplainAccessibility.outputLabel("Vampire-drain explanation", "Sentry is the driver."),
            "Vampire-drain explanation: Sentry is the driver."
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyVampireDrainExplainTelemetry: VampireDrainExplainTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
