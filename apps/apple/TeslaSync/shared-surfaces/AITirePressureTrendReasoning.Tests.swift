//
//  AITirePressureTrendReasoning.Tests.swift
//  TeslaSync — P4 shared surface · 0054 · AITirePressureTrendReasoning (Apple)
//
//  Unit coverage for the AITirePressureTrendReasoning surface:
//    • Projection — gated / loading / error / ready, the `canStart = isFinite(vehicleId) &&
//      vehicleId > 0` rule (incl. the 0 / negative edges), the Ask-Helix label flip, the disabled
//      rule, and every localized `AiOutputPanel` branch (empty / no-vehicle / thinking / prose /
//      error / unknown-error).
//    • State holder — `TirePressureTrendReasoningModel` wiring, the P1/S11 `view.opened` telemetry
//      (deferred past the gate), the stale one-shot auto-refresh + re-arm, and the
//      generate / cancel / refresh / stop delegation.
//    • Accessibility — the VoiceOver action + output label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryTirePressureTrendReasoningSource`, and the locale is injected for
//  determinism. In the test bundle the per-surface strings table is absent, so the i18n facade
//  returns the web English `value:` fallbacks, which these assertions check.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Projection: phases

@MainActor final class TirePressureTrendReasoningProjectionPhaseTests: XCTestCase {
    func testGatedWhenFeatureDisabled() {
        let resolved = TirePressureTrendReasoningProjection.resolve(
            TirePressureTrendReasoningInput(availability: .resolved(enabled: false), vehicleID: 7),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertNil(resolved.ready)
    }

    func testLoadingWhenAvailabilityLoading() {
        let resolved = TirePressureTrendReasoningProjection.resolve(
            TirePressureTrendReasoningInput(availability: .loading),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.ready)
    }

    func testErrorWhenAvailabilityFailed() {
        let resolved = TirePressureTrendReasoningProjection.resolve(
            TirePressureTrendReasoningInput(availability: .failed("boom")),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.ready)
    }

    func testReadyWhenEnabled() {
        let resolved = TirePressureTrendReasoningProjection.resolve(
            TirePressureTrendReasoningInput(availability: .resolved(enabled: true), vehicleID: 7),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertNotNil(resolved.ready)
    }
}

// MARK: - Projection: ready card content

@MainActor final class TirePressureTrendReasoningProjectionReadyTests: XCTestCase {
    private func ready(
        vehicleID: Int? = 7,
        stream: TirePressureTrendReasoningStreamSnapshot = .idle
    ) -> TirePressureTrendReasoningReady {
        let resolved = TirePressureTrendReasoningProjection.resolve(
            TirePressureTrendReasoningInput(
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
        XCTAssertEqual(card.title, "Narrate the 30-day tire-pressure trend")
        XCTAssertEqual(card.badge, "Helix")
        XCTAssertTrue(card.description.contains("four corner tire pressures"))
        XCTAssertTrue(card.description.contains("descriptive linear extrapolation"))
        XCTAssertTrue(card.description.contains("not a forecast"))
        XCTAssertEqual(card.buttonContext, "Narrate trend")
    }

    func testCanStartRequiresFiniteAndPositiveVehicle() {
        // Parity: web `haveInputs = Number.isFinite(numericVehicleId) && numericVehicleId > 0`.
        // 0 and negatives are disabled (stricter than a bare non-null check).
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
        let card = ready(stream: TirePressureTrendReasoningStreamSnapshot(state: .streaming))
        XCTAssertTrue(card.action.isStreaming)
        XCTAssertTrue(card.actionTitle.contains("thinking"))
    }

    func testActionDisabledWithoutVehicleOrWhileStreaming() {
        XCTAssertTrue(ready(vehicleID: nil, stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(vehicleID: 0, stream: .idle).action.isDisabled)
        XCTAssertTrue(
            ready(
                vehicleID: 7,
                stream: TirePressureTrendReasoningStreamSnapshot(state: .streaming)
            ).action.isDisabled
        )
        XCTAssertFalse(ready(vehicleID: 7, stream: .idle).action.isDisabled)
    }

    func testActionAccessibilityLabelJoinsAskAndContext() {
        XCTAssertEqual(ready().actionAccessibilityLabel, "Ask Helix · Narrate trend")
    }
}

// MARK: - Projection: localized output branches

@MainActor final class TirePressureTrendReasoningProjectionOutputTests: XCTestCase {
    private func output(
        vehicleID: Int? = 7,
        stream: TirePressureTrendReasoningStreamSnapshot
    ) -> TirePressureTrendReasoningResolvedOutput {
        TirePressureTrendReasoningProjection.resolve(
            TirePressureTrendReasoningInput(
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
        let out = output(stream: TirePressureTrendReasoningStreamSnapshot(state: .streaming, text: ""))
        XCTAssertEqual(out.kind, .thinking)
        XCTAssertTrue(out.body.contains("thinking"))
    }

    func testProseOnceTextArrives() {
        let out = output(
            stream: TirePressureTrendReasoningStreamSnapshot(state: .streaming, text: "Front-left is trending down.")
        )
        XCTAssertEqual(out.kind, .prose)
        XCTAssertEqual(out.body, "Front-left is trending down.")
    }

    func testFailedComposesHelixErrorPrefix() {
        let out = output(
            stream: TirePressureTrendReasoningStreamSnapshot(state: .error, text: "", error: "stream_http_429")
        )
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("Helix error:"))
        XCTAssertTrue(out.body.contains("stream_http_429"))
    }

    func testFailedFallsBackToUnknownMessage() {
        let out = output(stream: TirePressureTrendReasoningStreamSnapshot(state: .error, text: "", error: nil))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("unknown"))
    }
}

// MARK: - State holder: wiring, telemetry, freshness, gate, delegation

@MainActor final class TirePressureTrendReasoningModelTests: XCTestCase {
    private func makeModel(
        _ input: TirePressureTrendReasoningInput,
        telemetry: TirePressureTrendReasoningTelemetry = OSLogTirePressureTrendReasoningTelemetry()
    ) -> (TirePressureTrendReasoningModel, InMemoryTirePressureTrendReasoningSource) {
        let source = InMemoryTirePressureTrendReasoningSource(initial: input)
        let model = TirePressureTrendReasoningModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func enabled(
        vehicleID: Int? = 7,
        connection: TirePressureTrendReasoningConnection = .live,
        stream: TirePressureTrendReasoningStreamSnapshot = .idle
    ) -> TirePressureTrendReasoningInput {
        TirePressureTrendReasoningInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            connection: connection,
            stream: stream
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyTirePressureTrendReasoningTelemetry()
        let (model, source) = makeModel(enabled(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(spy.surfaces, [AITirePressureTrendReasoning.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpyTirePressureTrendReasoningTelemetry()
        let (model, _) = makeModel(
            TirePressureTrendReasoningInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertTrue(model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpyTirePressureTrendReasoningTelemetry()
        let (model, source) = makeModel(
            TirePressureTrendReasoningInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertEqual(spy.surfaces, [])
        source.push(enabled())
        XCTAssertFalse(model.isGated)
        XCTAssertEqual(spy.surfaces, [AITirePressureTrendReasoning.surfaceSlug])
        // Staying presented must not re-emit.
        source.push(enabled(connection: .live))
        XCTAssertEqual(spy.surfaces, [AITirePressureTrendReasoning.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(TirePressureTrendReasoningInput(availability: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(enabled())
        XCTAssertEqual(model.phase, .ready)
    }

    func testStreamSnapshotFlowsIntoOutput() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(stream: TirePressureTrendReasoningStreamSnapshot(
            state: .done,
            text: "Front-left slow leak."
        )))
        XCTAssertEqual(model.ready?.output.kind, .prose)
        XCTAssertEqual(model.ready?.output.body, "Front-left slow leak.")
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
        XCTAssertEqual(AITirePressureTrendReasoning.surfaceSlug, "AITirePressureTrendReasoning")
    }
}

// MARK: - Accessibility summary

@MainActor final class TirePressureTrendReasoningAccessibilityTests: XCTestCase {
    func testActionLabelJoinsAskAndContext() {
        XCTAssertEqual(
            TirePressureTrendReasoningAccessibility.actionLabel(ask: "Ask Helix", context: "Narrate trend"),
            "Ask Helix · Narrate trend"
        )
    }

    func testOutputLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            TirePressureTrendReasoningAccessibility.outputLabel(
                "Tire-pressure trend narration",
                "Front-left slow leak."
            ),
            "Tire-pressure trend narration: Front-left slow leak."
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyTirePressureTrendReasoningTelemetry: TirePressureTrendReasoningTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
