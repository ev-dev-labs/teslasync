//
//  AICostForecastNarration.Tests.swift
//  TeslaSync — P4 shared surface · 0013 · AICostForecastNarration (Apple)
//
//  Unit coverage for the AICostForecastNarration surface:
//    • Projection — gated / loading / error / ready, the `canStart = numericVehicleId > 0` rule
//      (incl. the id-0 and nil boundaries), the Ask-Helix label flip, the disabled rule, and every
//      localized `AiOutputPanel` branch (empty / no-vehicle / thinking / prose / error /
//      unknown-error).
//    • Input → request — the `months` horizon the web InnerSection folds into the `useAiStream` body
//      stays wired through `CostNarrationInput.request` (sent only when > 0).
//    • State holder — `CostNarrationModel` wiring, the P1/S11 `view.opened` telemetry (deferred past
//      the gate), the stale one-shot auto-refresh + re-arm, and the generate / cancel / refresh /
//      stop delegation.
//    • Accessibility — the VoiceOver action + output label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryCostNarrationSource`, and the locale is injected for determinism.
//  In the test bundle the per-surface strings table is absent, so the i18n facade returns the web
//  English `value:` fallbacks, which these assertions check.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Projection: phases

@MainActor final class CostNarrationProjectionPhaseTests: XCTestCase {
    func testGatedWhenFeatureDisabled() {
        let resolved = CostNarrationProjection.resolve(
            CostNarrationInput(availability: .resolved(enabled: false), vehicleID: 7),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertNil(resolved.ready)
    }

    func testLoadingWhenAvailabilityLoading() {
        let resolved = CostNarrationProjection.resolve(
            CostNarrationInput(availability: .loading),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.ready)
    }

    func testErrorWhenAvailabilityFailed() {
        let resolved = CostNarrationProjection.resolve(
            CostNarrationInput(availability: .failed("boom")),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.ready)
    }

    func testReadyWhenEnabled() {
        let resolved = CostNarrationProjection.resolve(
            CostNarrationInput(availability: .resolved(enabled: true), vehicleID: 7),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertNotNil(resolved.ready)
    }
}

// MARK: - Projection: ready card content

@MainActor final class CostNarrationProjectionReadyTests: XCTestCase {
    private func ready(
        vehicleID: Int? = 7,
        stream: CostNarrationStreamSnapshot = .idle
    ) -> CostNarrationReady {
        let resolved = CostNarrationProjection.resolve(
            CostNarrationInput(
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
        XCTAssertEqual(card.title, "Narrate the charging-cost forecast")
        XCTAssertEqual(card.badge, "Helix")
        XCTAssertTrue(card.description.contains("deterministic charging-cost forecast"))
        XCTAssertTrue(card.description.contains("cost_low / cost_high band"))
        XCTAssertTrue(card.description.contains("not a strict 95% confidence interval"))
        XCTAssertEqual(card.buttonContext, "Narrate forecast")
    }

    func testCanStartRequiresPositiveVehicleId() {
        // Web `Number.isFinite(numericVehicleId) && numericVehicleId > 0`.
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
        let card = ready(stream: CostNarrationStreamSnapshot(state: .streaming))
        XCTAssertTrue(card.action.isStreaming)
        XCTAssertTrue(card.actionTitle.contains("thinking"))
    }

    func testActionDisabledWithoutVehicleOrWhileStreaming() {
        XCTAssertTrue(ready(vehicleID: nil, stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(vehicleID: 0, stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(vehicleID: 7, stream: CostNarrationStreamSnapshot(state: .streaming)).action.isDisabled)
        XCTAssertFalse(ready(vehicleID: 7, stream: .idle).action.isDisabled)
    }

    func testActionAccessibilityLabelJoinsAskAndContext() {
        XCTAssertEqual(ready().actionAccessibilityLabel, "Ask Helix · Narrate forecast")
    }
}

// MARK: - Projection: localized output branches

@MainActor final class CostNarrationProjectionOutputTests: XCTestCase {
    private func output(
        vehicleID: Int? = 7,
        stream: CostNarrationStreamSnapshot
    ) -> CostNarrationResolvedOutput {
        CostNarrationProjection.resolve(
            CostNarrationInput(
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
        XCTAssertTrue(out.body.contains("No narrative yet"))
    }

    func testNoVehicleHintWhenIdleWithoutVehicle() {
        let out = output(vehicleID: nil, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Select a vehicle"))
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        let out = output(stream: CostNarrationStreamSnapshot(state: .streaming, text: ""))
        XCTAssertEqual(out.kind, .thinking)
        XCTAssertTrue(out.body.contains("thinking"))
    }

    func testProseOnceTextArrives() {
        let out = output(stream: CostNarrationStreamSnapshot(state: .streaming, text: "Costs are flat."))
        XCTAssertEqual(out.kind, .prose)
        XCTAssertEqual(out.body, "Costs are flat.")
    }

    func testFailedComposesHelixErrorPrefix() {
        let out = output(stream: CostNarrationStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("Helix error:"))
        XCTAssertTrue(out.body.contains("stream_http_429"))
    }

    func testFailedFallsBackToUnknownMessage() {
        let out = output(stream: CostNarrationStreamSnapshot(state: .error, text: "", error: nil))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("unknown"))
    }
}

// MARK: - Input → request (web `body` memo: vehicle_id + optional months)

final class CostNarrationInputRequestTests: XCTestCase {
    func testRequestCarriesVehicleAndMonths() {
        let input = CostNarrationInput(
            availability: .resolved(enabled: true),
            vehicleID: 7,
            months: 6
        )
        XCTAssertEqual(input.request.vehicleID, 7)
        XCTAssertEqual(input.request.months, 6)
        XCTAssertEqual(input.request.body["vehicle_id"], 7)
        XCTAssertEqual(input.request.body["months"], 6)
    }

    func testRequestOmitsMonthsWhenAbsent() {
        let input = CostNarrationInput(availability: .resolved(enabled: true), vehicleID: 7, months: nil)
        XCTAssertNil(input.request.body["months"])
        XCTAssertEqual(input.request.body["vehicle_id"], 7)
    }

    func testRequestCoercesMissingVehicleToZero() {
        let input = CostNarrationInput(availability: .resolved(enabled: true), vehicleID: nil, months: 3)
        XCTAssertEqual(input.request.body["vehicle_id"], 0)
        XCTAssertEqual(input.request.body["months"], 3)
    }
}

// MARK: - State holder: wiring, telemetry, freshness, gate, delegation

@MainActor final class CostNarrationModelTests: XCTestCase {
    private func makeModel(
        _ input: CostNarrationInput,
        telemetry: CostNarrationTelemetry = OSLogCostNarrationTelemetry()
    ) -> (CostNarrationModel, InMemoryCostNarrationSource) {
        let source = InMemoryCostNarrationSource(initial: input)
        let model = CostNarrationModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func enabled(
        vehicleID: Int? = 7,
        months: Int? = 6,
        connection: CostNarrationConnection = .live,
        stream: CostNarrationStreamSnapshot = .idle
    ) -> CostNarrationInput {
        CostNarrationInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            months: months,
            connection: connection,
            stream: stream
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyCostNarrationTelemetry()
        let (model, source) = makeModel(enabled(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(spy.surfaces, [AICostForecastNarration.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpyCostNarrationTelemetry()
        let (model, _) = makeModel(
            CostNarrationInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertTrue(model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpyCostNarrationTelemetry()
        let (model, source) = makeModel(
            CostNarrationInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertEqual(spy.surfaces, [])
        source.push(enabled())
        XCTAssertFalse(model.isGated)
        XCTAssertEqual(spy.surfaces, [AICostForecastNarration.surfaceSlug])
        // Staying presented must not re-emit.
        source.push(enabled(connection: .live))
        XCTAssertEqual(spy.surfaces, [AICostForecastNarration.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(CostNarrationInput(availability: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(enabled())
        XCTAssertEqual(model.phase, .ready)
    }

    func testStreamSnapshotFlowsIntoOutput() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(stream: CostNarrationStreamSnapshot(state: .done, text: "Costs nominal.")))
        XCTAssertEqual(model.ready?.output.kind, .prose)
        XCTAssertEqual(model.ready?.output.body, "Costs nominal.")
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
        XCTAssertEqual(AICostForecastNarration.surfaceSlug, "AICostForecastNarration")
    }
}

// MARK: - Accessibility summary

@MainActor final class CostNarrationAccessibilityTests: XCTestCase {
    func testActionLabelJoinsAskAndContext() {
        XCTAssertEqual(
            CostNarrationAccessibility.actionLabel(ask: "Ask Helix", context: "Narrate forecast"),
            "Ask Helix · Narrate forecast"
        )
    }

    func testOutputLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            CostNarrationAccessibility.outputLabel("Charging-cost narrative", "Costs nominal."),
            "Charging-cost narrative: Costs nominal."
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyCostNarrationTelemetry: CostNarrationTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
