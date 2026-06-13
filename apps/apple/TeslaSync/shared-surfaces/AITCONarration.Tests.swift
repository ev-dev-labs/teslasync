//
//  AITCONarration.Tests.swift
//  TeslaSync — P4 shared surface · 0052 · AITCONarration (Apple)
//
//  Unit coverage for the AITCONarration surface:
//    • Projection — gated / loading / error / ready, the `canStart = numericVehicleId > 0` rule
//      (incl. the id-0 and nil boundaries), the web `emptyHint` element (the "Pick a vehicle above
//      to enable Helix." hint shown only while disabled), the Ask-Helix label flip, the disabled
//      rule, and every localized `AiOutputPanel` branch (empty / no-vehicle / thinking / prose /
//      error / unknown-error).
//    • Input → request — the selected vehicle the web InnerSection folds into the `useAiStream` body
//      stays wired through `TCONarrationInput.request` (vehicle_id only, `?? 0` coercion, no months).
//    • State holder — `TCONarrationModel` wiring, the P1/S11 `view.opened` telemetry (deferred past
//      the gate), the stale one-shot auto-refresh + re-arm, and the generate / cancel / refresh /
//      stop delegation.
//    • Accessibility — the VoiceOver action + output label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryTCONarrationSource`, and the locale is injected for determinism.
//  In the test bundle the per-surface strings table is absent, so the i18n facade returns the web
//  English `value:` fallbacks, which these assertions check.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Projection: phases

@MainActor final class TCONarrationProjectionPhaseTests: XCTestCase {
    func testGatedWhenFeatureDisabled() {
        let resolved = TCONarrationProjection.resolve(
            TCONarrationInput(availability: .resolved(enabled: false), vehicleID: 7),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertNil(resolved.ready)
    }

    func testLoadingWhenAvailabilityLoading() {
        let resolved = TCONarrationProjection.resolve(
            TCONarrationInput(availability: .loading),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.ready)
    }

    func testErrorWhenAvailabilityFailed() {
        let resolved = TCONarrationProjection.resolve(
            TCONarrationInput(availability: .failed("boom")),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.ready)
    }

    func testReadyWhenEnabled() {
        let resolved = TCONarrationProjection.resolve(
            TCONarrationInput(availability: .resolved(enabled: true), vehicleID: 7),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertNotNil(resolved.ready)
    }
}

// MARK: - Projection: ready card content

@MainActor final class TCONarrationProjectionReadyTests: XCTestCase {
    private func ready(
        vehicleID: Int? = 7,
        stream: TCONarrationStreamSnapshot = .idle
    ) -> TCONarrationReady {
        let resolved = TCONarrationProjection.resolve(
            TCONarrationInput(
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
        XCTAssertEqual(card.title, "Explain my total cost of ownership")
        XCTAssertEqual(card.badge, "Helix")
        XCTAssertTrue(card.description.contains("deterministic operating-cost figures shown below"))
        XCTAssertTrue(card.description.contains("four limiting assumptions"))
        XCTAssertTrue(card.description.contains("flat $50/month maintenance heuristic"))
        XCTAssertEqual(card.buttonContext, "Explain ownership cost")
    }

    func testCanStartRequiresPositiveVehicleId() {
        // Web `typeof vehicleId === 'number' && Number.isFinite(vehicleId) && vehicleId > 0`.
        XCTAssertTrue(ready(vehicleID: 7).canStart)
        XCTAssertFalse(ready(vehicleID: nil).canStart)
        XCTAssertFalse(ready(vehicleID: 0).canStart)
        XCTAssertFalse(ready(vehicleID: -3).canStart)
    }

    func testEmptyHintShownOnlyWhenDisabled() {
        // Web `emptyHint = haveInputs ? undefined : t('tco.aiNarration.noVehicleHint', …)`.
        XCTAssertEqual(ready(vehicleID: nil).emptyHint, "Pick a vehicle above to enable Helix.")
        XCTAssertEqual(ready(vehicleID: 0).emptyHint, "Pick a vehicle above to enable Helix.")
        XCTAssertNil(ready(vehicleID: 7).emptyHint)
    }

    func testActionLabelIsAskHelixWhenIdle() {
        let card = ready(stream: .idle)
        XCTAssertEqual(card.actionTitle, "Ask Helix")
        XCTAssertFalse(card.action.isStreaming)
    }

    func testActionLabelFlipsToThinkingWhileStreaming() {
        let card = ready(stream: TCONarrationStreamSnapshot(state: .streaming))
        XCTAssertTrue(card.action.isStreaming)
        XCTAssertTrue(card.actionTitle.contains("thinking"))
    }

    func testActionDisabledWithoutVehicleOrWhileStreaming() {
        XCTAssertTrue(ready(vehicleID: nil, stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(vehicleID: 0, stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(vehicleID: 7, stream: TCONarrationStreamSnapshot(state: .streaming)).action.isDisabled)
        XCTAssertFalse(ready(vehicleID: 7, stream: .idle).action.isDisabled)
    }

    func testActionAccessibilityLabelJoinsAskAndContext() {
        XCTAssertEqual(ready().actionAccessibilityLabel, "Ask Helix · Explain ownership cost")
    }
}

// MARK: - Projection: localized output branches

@MainActor final class TCONarrationProjectionOutputTests: XCTestCase {
    private func output(
        vehicleID: Int? = 7,
        stream: TCONarrationStreamSnapshot
    ) -> TCONarrationResolvedOutput {
        TCONarrationProjection.resolve(
            TCONarrationInput(
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
        let out = output(stream: TCONarrationStreamSnapshot(state: .streaming, text: ""))
        XCTAssertEqual(out.kind, .thinking)
        XCTAssertTrue(out.body.contains("thinking"))
    }

    func testProseOnceTextArrives() {
        let out = output(stream: TCONarrationStreamSnapshot(state: .streaming, text: "Savings widen."))
        XCTAssertEqual(out.kind, .prose)
        XCTAssertEqual(out.body, "Savings widen.")
    }

    func testFailedComposesHelixErrorPrefix() {
        let out = output(stream: TCONarrationStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("Helix error:"))
        XCTAssertTrue(out.body.contains("stream_http_429"))
    }

    func testFailedFallsBackToUnknownMessage() {
        let out = output(stream: TCONarrationStreamSnapshot(state: .error, text: "", error: nil))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("unknown"))
    }
}

// MARK: - Input → request (web `body` memo: vehicle_id only, no months)

final class TCONarrationInputRequestTests: XCTestCase {
    func testRequestCarriesVehicle() {
        let input = TCONarrationInput(availability: .resolved(enabled: true), vehicleID: 7)
        XCTAssertEqual(input.request.vehicleID, 7)
        XCTAssertEqual(input.request.body["vehicle_id"], 7)
    }

    func testRequestBodyHasNoMonthsKey() {
        // Unlike 0013's cost-forecast narrate body, the TCO body is vehicle_id alone.
        let input = TCONarrationInput(availability: .resolved(enabled: true), vehicleID: 7)
        XCTAssertNil(input.request.body["months"])
        XCTAssertEqual(input.request.body.count, 1)
    }

    func testRequestCoercesMissingVehicleToZero() {
        let input = TCONarrationInput(availability: .resolved(enabled: true), vehicleID: nil)
        XCTAssertEqual(input.request.body["vehicle_id"], 0)
    }
}

// MARK: - State holder: wiring, telemetry, freshness, gate, delegation

@MainActor final class TCONarrationModelTests: XCTestCase {
    private func makeModel(
        _ input: TCONarrationInput,
        telemetry: TCONarrationTelemetry = OSLogTCONarrationTelemetry()
    ) -> (TCONarrationModel, InMemoryTCONarrationSource) {
        let source = InMemoryTCONarrationSource(initial: input)
        let model = TCONarrationModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func enabled(
        vehicleID: Int? = 7,
        connection: TCONarrationConnection = .live,
        stream: TCONarrationStreamSnapshot = .idle
    ) -> TCONarrationInput {
        TCONarrationInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            connection: connection,
            stream: stream
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyTCONarrationTelemetry()
        let (model, source) = makeModel(enabled(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(spy.surfaces, [AITCONarration.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpyTCONarrationTelemetry()
        let (model, _) = makeModel(
            TCONarrationInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertTrue(model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpyTCONarrationTelemetry()
        let (model, source) = makeModel(
            TCONarrationInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertEqual(spy.surfaces, [])
        source.push(enabled())
        XCTAssertFalse(model.isGated)
        XCTAssertEqual(spy.surfaces, [AITCONarration.surfaceSlug])
        // Staying presented must not re-emit.
        source.push(enabled(connection: .live))
        XCTAssertEqual(spy.surfaces, [AITCONarration.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(TCONarrationInput(availability: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(enabled())
        XCTAssertEqual(model.phase, .ready)
    }

    func testStreamSnapshotFlowsIntoOutput() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(stream: TCONarrationStreamSnapshot(state: .done, text: "Costs nominal.")))
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
        XCTAssertEqual(AITCONarration.surfaceSlug, "AITCONarration")
    }
}

// MARK: - Accessibility summary

@MainActor final class TCONarrationAccessibilityTests: XCTestCase {
    func testActionLabelJoinsAskAndContext() {
        XCTAssertEqual(
            TCONarrationAccessibility.actionLabel(ask: "Ask Helix", context: "Explain ownership cost"),
            "Ask Helix · Explain ownership cost"
        )
    }

    func testOutputLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            TCONarrationAccessibility.outputLabel("Total-cost-of-ownership narrative", "Costs nominal."),
            "Total-cost-of-ownership narrative: Costs nominal."
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyTCONarrationTelemetry: TCONarrationTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
