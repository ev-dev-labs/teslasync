//
//  AISmartChargeScheduleSuggestion.Tests.swift
//  TeslaSync — P4 shared surface · 0047 · AISmartChargeScheduleSuggestion (Apple)
//
//  Unit coverage for the AISmartChargeScheduleSuggestion surface:
//    • Projection — gated / loading / error / ready, the `canStart = haveInputs` rule (both the
//      vehicle and the rate-plan halves, incl. the nil / 0 / empty boundaries), the Ask-Helix label
//      flip, the disabled rule, and every localized `AiOutputPanel` branch (empty-with-inputs /
//      missing-inputs / thinking / prose / error / unknown-error). The web source passes NO
//      `emptyHint`, so there is no description-level hint (asserted via the absence of a hint field).
//    • State holder — `SmartChargeScheduleModel` wiring, the P1/S11 `view.opened` telemetry (deferred
//      past the gate), the stale one-shot auto-refresh + re-arm, and the generate / cancel / refresh /
//      stop delegation.
//    • Accessibility — the VoiceOver action + output label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemorySmartChargeScheduleSource`, and the locale is injected for
//  determinism. In the test bundle the per-surface strings table is absent, so the i18n facade
//  returns the web English `value:` fallbacks, which these assertions check.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Projection: phases

@MainActor final class SmartChargeScheduleProjectionPhaseTests: XCTestCase {
    func testGatedWhenFeatureDisabled() {
        let resolved = SmartChargeScheduleProjection.resolve(
            SmartChargeScheduleInput(availability: .resolved(enabled: false), vehicleID: 7, ratePlanID: "x"),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertNil(resolved.ready)
    }

    func testLoadingWhenAvailabilityLoading() {
        let resolved = SmartChargeScheduleProjection.resolve(
            SmartChargeScheduleInput(availability: .loading),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.ready)
    }

    func testErrorWhenAvailabilityFailed() {
        let resolved = SmartChargeScheduleProjection.resolve(
            SmartChargeScheduleInput(availability: .failed("boom")),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.ready)
    }

    func testReadyWhenEnabled() {
        let resolved = SmartChargeScheduleProjection.resolve(
            SmartChargeScheduleInput(availability: .resolved(enabled: true), vehicleID: 7, ratePlanID: "x"),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertNotNil(resolved.ready)
    }
}

// MARK: - Projection: ready card content

@MainActor final class SmartChargeScheduleProjectionReadyTests: XCTestCase {
    private func ready(
        vehicleID: Int? = 7,
        ratePlanID: String? = "pge-ev2a",
        stream: SmartChargeScheduleStreamSnapshot = .idle
    ) -> SmartChargeScheduleReady {
        let resolved = SmartChargeScheduleProjection.resolve(
            SmartChargeScheduleInput(
                availability: .resolved(enabled: true),
                vehicleID: vehicleID,
                ratePlanID: ratePlanID,
                stream: stream
            ),
            locale: enUS
        )
        return resolved.ready!
    }

    func testTitleDescriptionBadgeAreParityStrings() {
        let card = ready()
        XCTAssertEqual(card.title, "Draft a schedule with Helix")
        XCTAssertEqual(card.badge, "Helix")
        XCTAssertEqual(card.buttonContext, "Draft a schedule")
        XCTAssertTrue(card.description.contains("time-of-use-optimized charge schedule"))
        XCTAssertTrue(card.description.contains("never saved automatically"))
        XCTAssertTrue(card.description.contains("click Schedule below to apply it"))
    }

    func testDescriptionPreservesUnicodeEmDash() {
        // Parity: the web copy uses the — em dash (\u2014).
        XCTAssertTrue(ready().description.contains("—"))
    }

    func testCanStartRequiresBothVehicleAndRatePlan() {
        // Web `haveInputs = !!vehicleId && !!ratePlanId`.
        XCTAssertTrue(ready(vehicleID: 7, ratePlanID: "pge-ev2a").canStart)
        XCTAssertFalse(ready(vehicleID: nil, ratePlanID: "pge-ev2a").canStart)
        XCTAssertFalse(ready(vehicleID: 7, ratePlanID: nil).canStart)
        XCTAssertFalse(ready(vehicleID: 7, ratePlanID: "").canStart)
    }

    func testCanStartRejectsZeroVehicle() {
        XCTAssertFalse(ready(vehicleID: 0, ratePlanID: "pge-ev2a").canStart)
    }

    func testActionLabelIsAskHelixWhenIdle() {
        let card = ready(stream: .idle)
        XCTAssertEqual(card.actionTitle, "Ask Helix")
        XCTAssertFalse(card.action.isStreaming)
    }

    func testActionLabelFlipsToThinkingWhileStreaming() {
        let card = ready(stream: SmartChargeScheduleStreamSnapshot(state: .streaming))
        XCTAssertTrue(card.action.isStreaming)
        XCTAssertTrue(card.actionTitle.contains("thinking"))
    }

    func testActionDisabledWithoutInputsOrWhileStreaming() {
        XCTAssertTrue(ready(vehicleID: nil, ratePlanID: "x", stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(vehicleID: 7, ratePlanID: nil, stream: .idle).action.isDisabled)
        XCTAssertTrue(
            ready(stream: SmartChargeScheduleStreamSnapshot(state: .streaming)).action.isDisabled
        )
        XCTAssertFalse(ready(stream: .idle).action.isDisabled)
    }

    func testActionAccessibilityLabelJoinsAskAndContext() {
        XCTAssertEqual(ready().actionAccessibilityLabel, "Ask Helix · Draft a schedule")
    }
}

// MARK: - Projection: localized output branches

@MainActor final class SmartChargeScheduleProjectionOutputTests: XCTestCase {
    private func output(
        vehicleID: Int? = 7,
        ratePlanID: String? = "pge-ev2a",
        stream: SmartChargeScheduleStreamSnapshot
    ) -> SmartChargeScheduleResolvedOutput {
        SmartChargeScheduleProjection.resolve(
            SmartChargeScheduleInput(
                availability: .resolved(enabled: true),
                vehicleID: vehicleID,
                ratePlanID: ratePlanID,
                stream: stream
            ),
            locale: enUS
        ).ready!.output
    }

    func testEmptyHintWhenIdleWithInputs() {
        let out = output(stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("No schedule drafted yet"))
    }

    func testNoInputsHintWhenIdleWithoutVehicle() {
        let out = output(vehicleID: nil, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Select a vehicle and a rate plan"))
    }

    func testNoInputsHintWhenIdleWithoutRatePlan() {
        let out = output(ratePlanID: nil, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Select a vehicle and a rate plan"))
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        let out = output(stream: SmartChargeScheduleStreamSnapshot(state: .streaming, text: ""))
        XCTAssertEqual(out.kind, .thinking)
        XCTAssertTrue(out.body.contains("thinking"))
    }

    func testProseOnceTextArrives() {
        let out = output(stream: SmartChargeScheduleStreamSnapshot(state: .streaming, text: "Charge 00:30."))
        XCTAssertEqual(out.kind, .prose)
        XCTAssertEqual(out.body, "Charge 00:30.")
    }

    func testFailedComposesHelixErrorPrefix() {
        let out = output(stream: SmartChargeScheduleStreamSnapshot(
            state: .error,
            text: "",
            error: "stream_http_429"
        ))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("Helix error:"))
        XCTAssertTrue(out.body.contains("stream_http_429"))
    }

    func testFailedFallsBackToUnknownMessage() {
        let out = output(stream: SmartChargeScheduleStreamSnapshot(state: .error, text: "", error: nil))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("unknown"))
    }

    func testProseAccessibilityLabelPrependsTitle() {
        let out = output(stream: SmartChargeScheduleStreamSnapshot(state: .done, text: "Charge 00:30."))
        XCTAssertEqual(out.accessibilityLabel, "Charge schedule proposal: Charge 00:30.")
    }
}

// MARK: - State holder: wiring, telemetry, freshness, gate, delegation

@MainActor final class SmartChargeScheduleModelTests: XCTestCase {
    private func makeModel(
        _ input: SmartChargeScheduleInput,
        telemetry: SmartChargeScheduleTelemetry = OSLogSmartChargeScheduleTelemetry()
    ) -> (SmartChargeScheduleModel, InMemorySmartChargeScheduleSource) {
        let source = InMemorySmartChargeScheduleSource(initial: input)
        let model = SmartChargeScheduleModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func enabled(
        vehicleID: Int? = 7,
        ratePlanID: String? = "pge-ev2a",
        connection: SmartChargeScheduleConnection = .live,
        stream: SmartChargeScheduleStreamSnapshot = .idle
    ) -> SmartChargeScheduleInput {
        SmartChargeScheduleInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            ratePlanID: ratePlanID,
            connection: connection,
            stream: stream
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpySmartChargeScheduleTelemetry()
        let (model, source) = makeModel(enabled(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(spy.surfaces, [AISmartChargeScheduleSuggestion.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpySmartChargeScheduleTelemetry()
        let (model, _) = makeModel(
            SmartChargeScheduleInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertTrue(model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpySmartChargeScheduleTelemetry()
        let (model, source) = makeModel(
            SmartChargeScheduleInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertEqual(spy.surfaces, [])
        source.push(enabled())
        XCTAssertFalse(model.isGated)
        XCTAssertEqual(spy.surfaces, [AISmartChargeScheduleSuggestion.surfaceSlug])
        // Staying presented must not re-emit.
        source.push(enabled(connection: .live))
        XCTAssertEqual(spy.surfaces, [AISmartChargeScheduleSuggestion.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(SmartChargeScheduleInput(availability: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(enabled())
        XCTAssertEqual(model.phase, .ready)
    }

    func testStreamSnapshotFlowsIntoOutput() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(stream: SmartChargeScheduleStreamSnapshot(state: .done, text: "Charge 00:30.")))
        XCTAssertEqual(model.ready?.output.kind, .prose)
        XCTAssertEqual(model.ready?.output.body, "Charge 00:30.")
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
        XCTAssertEqual(AISmartChargeScheduleSuggestion.surfaceSlug, "AISmartChargeScheduleSuggestion")
    }
}

// MARK: - Accessibility summary

@MainActor final class SmartChargeScheduleAccessibilityTests: XCTestCase {
    func testActionLabelJoinsAskAndContext() {
        XCTAssertEqual(
            SmartChargeScheduleAccessibility.actionLabel(ask: "Ask Helix", context: "Draft a schedule"),
            "Ask Helix · Draft a schedule"
        )
    }

    func testOutputLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            SmartChargeScheduleAccessibility.outputLabel("Charge schedule proposal", "Charge 00:30."),
            "Charge schedule proposal: Charge 00:30."
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySmartChargeScheduleTelemetry: SmartChargeScheduleTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
