//
//  AIChargingCurveFingerprintClustering.Tests.swift
//  TeslaSync — P4 shared surface · 0010 · AIChargingCurveFingerprintClustering (Apple)
//
//  Unit coverage for the AIChargingCurveFingerprintClustering surface:
//    • Projection — gated / loading / error / ready, the `haveInputs = Number.isFinite(numeric) &&
//      numeric > 0` rule (incl. the nil, zero, negative, non-numeric-string, and numeric-string
//      boundaries), the Ask-Helix label flip, the disabled rule, and every localized `AiOutputPanel`
//      branch (empty / no-vehicle / thinking / prose / error / unknown-error).
//    • State holder — `ChargeCurveFingerprintModel` wiring, the P1/S11 `view.opened` telemetry
//      (deferred past the gate), the stale one-shot auto-refresh + re-arm, and the generate / cancel /
//      refresh / stop delegation.
//    • Accessibility — the VoiceOver action + output label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryChargeCurveFingerprintSource`, and the locale is injected for
//  determinism. In the test bundle the per-surface strings table is absent, so the i18n facade returns
//  the web English `value:` fallbacks, which these assertions check.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Projection: phases

@MainActor final class ChargeCurveFingerprintProjectionPhaseTests: XCTestCase {
    func testGatedWhenFeatureDisabled() {
        let resolved = ChargeCurveFingerprintProjection.resolve(
            ChargeCurveFingerprintInput(availability: .resolved(enabled: false), vehicleID: .number(4821)),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertNil(resolved.ready)
    }

    func testLoadingWhenAvailabilityLoading() {
        let resolved = ChargeCurveFingerprintProjection.resolve(
            ChargeCurveFingerprintInput(availability: .loading),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.ready)
    }

    func testErrorWhenAvailabilityFailed() {
        let resolved = ChargeCurveFingerprintProjection.resolve(
            ChargeCurveFingerprintInput(availability: .failed("boom")),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.ready)
    }

    func testReadyWhenEnabled() {
        let resolved = ChargeCurveFingerprintProjection.resolve(
            ChargeCurveFingerprintInput(availability: .resolved(enabled: true), vehicleID: .number(4821)),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertNotNil(resolved.ready)
    }
}

// MARK: - Projection: ready card content

@MainActor final class ChargeCurveFingerprintProjectionReadyTests: XCTestCase {
    private func ready(
        vehicleID: ChargeCurveFingerprintVehicleID = .number(4821),
        stream: ChargeCurveFingerprintStreamSnapshot = .idle
    ) -> ChargeCurveFingerprintReady {
        let resolved = ChargeCurveFingerprintProjection.resolve(
            ChargeCurveFingerprintInput(
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
        XCTAssertEqual(card.title, "Explain the charging-curve cluster fingerprints")
        XCTAssertEqual(card.badge, "Helix")
        XCTAssertTrue(card.description.contains("deterministic charging-curve cluster fingerprint"))
        XCTAssertTrue(card.description.contains("never changes the cluster bucketing"))
        XCTAssertEqual(card.buttonContext, "Explain clusters")
    }

    func testCanStartRequiresFinitePositiveVehicleID() {
        // Web `canStart={haveInputs}` where `haveInputs = Number.isFinite(numeric) && numeric > 0`.
        XCTAssertTrue(ready(vehicleID: .number(4821)).canStart)
        XCTAssertTrue(ready(vehicleID: .string("4821")).canStart)
        XCTAssertFalse(ready(vehicleID: .absent).canStart)
        XCTAssertFalse(ready(vehicleID: .number(0)).canStart)
        XCTAssertFalse(ready(vehicleID: .number(-5)).canStart)
        XCTAssertFalse(ready(vehicleID: .string("")).canStart)
        XCTAssertFalse(ready(vehicleID: .string("abc")).canStart)
    }

    func testActionLabelIsAskHelixWhenIdle() {
        let card = ready(stream: .idle)
        XCTAssertEqual(card.actionTitle, "Ask Helix")
        XCTAssertFalse(card.action.isStreaming)
    }

    func testActionLabelFlipsToThinkingWhileStreaming() {
        let card = ready(stream: ChargeCurveFingerprintStreamSnapshot(state: .streaming))
        XCTAssertTrue(card.action.isStreaming)
        XCTAssertTrue(card.actionTitle.contains("thinking"))
    }

    func testActionDisabledWithoutVehicleOrWhileStreaming() {
        XCTAssertTrue(ready(vehicleID: .absent, stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(vehicleID: .number(0), stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(
            vehicleID: .number(4821),
            stream: ChargeCurveFingerprintStreamSnapshot(state: .streaming)
        ).action.isDisabled)
        XCTAssertFalse(ready(vehicleID: .number(4821), stream: .idle).action.isDisabled)
    }

    func testActionAccessibilityLabelJoinsAskAndContext() {
        XCTAssertEqual(ready().actionAccessibilityLabel, "Ask Helix · Explain clusters")
    }
}

// MARK: - Projection: localized output branches

@MainActor final class ChargeCurveFingerprintProjectionOutputTests: XCTestCase {
    private func output(
        vehicleID: ChargeCurveFingerprintVehicleID = .number(4821),
        stream: ChargeCurveFingerprintStreamSnapshot
    ) -> ChargeCurveFingerprintResolvedOutput {
        ChargeCurveFingerprintProjection.resolve(
            ChargeCurveFingerprintInput(
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
        XCTAssertTrue(out.body.contains("No explanation yet"))
    }

    func testNoVehicleHintWhenIdleWithoutVehicle() {
        let out = output(vehicleID: .absent, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Select a vehicle"))
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        let out = output(stream: ChargeCurveFingerprintStreamSnapshot(state: .streaming, text: ""))
        XCTAssertEqual(out.kind, .thinking)
        XCTAssertTrue(out.body.contains("thinking"))
    }

    func testProseOnceTextArrives() {
        let out = output(stream: ChargeCurveFingerprintStreamSnapshot(state: .streaming, text: "L1 overnight."))
        XCTAssertEqual(out.kind, .prose)
        XCTAssertEqual(out.body, "L1 overnight.")
    }

    func testFailedComposesHelixErrorPrefix() {
        let out = output(stream: ChargeCurveFingerprintStreamSnapshot(
            state: .error,
            text: "",
            error: "stream_http_429"
        ))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("Helix error:"))
        XCTAssertTrue(out.body.contains("stream_http_429"))
    }

    func testFailedFallsBackToUnknownMessage() {
        let out = output(stream: ChargeCurveFingerprintStreamSnapshot(state: .error, text: "", error: nil))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("unknown"))
    }
}

// MARK: - State holder: wiring, telemetry, freshness, gate, delegation

@MainActor final class ChargeCurveFingerprintModelTests: XCTestCase {
    private func makeModel(
        _ input: ChargeCurveFingerprintInput,
        telemetry: ChargeCurveFingerprintTelemetry = OSLogChargeCurveFingerprintTelemetry()
    ) -> (ChargeCurveFingerprintModel, InMemoryChargeCurveFingerprintSource) {
        let source = InMemoryChargeCurveFingerprintSource(initial: input)
        let model = ChargeCurveFingerprintModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func enabled(
        vehicleID: ChargeCurveFingerprintVehicleID = .number(4821),
        connection: ChargeCurveFingerprintConnection = .live,
        stream: ChargeCurveFingerprintStreamSnapshot = .idle
    ) -> ChargeCurveFingerprintInput {
        ChargeCurveFingerprintInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            connection: connection,
            stream: stream
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyChargeCurveFingerprintTelemetry()
        let (model, source) = makeModel(enabled(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(spy.surfaces, [AIChargingCurveFingerprintClustering.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpyChargeCurveFingerprintTelemetry()
        let (model, _) = makeModel(
            ChargeCurveFingerprintInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertTrue(model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpyChargeCurveFingerprintTelemetry()
        let (model, source) = makeModel(
            ChargeCurveFingerprintInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertEqual(spy.surfaces, [])
        source.push(enabled())
        XCTAssertFalse(model.isGated)
        XCTAssertEqual(spy.surfaces, [AIChargingCurveFingerprintClustering.surfaceSlug])
        // Staying presented must not re-emit.
        source.push(enabled(connection: .live))
        XCTAssertEqual(spy.surfaces, [AIChargingCurveFingerprintClustering.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(ChargeCurveFingerprintInput(availability: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(enabled())
        XCTAssertEqual(model.phase, .ready)
    }

    func testStreamSnapshotFlowsIntoOutput() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(stream: ChargeCurveFingerprintStreamSnapshot(state: .done, text: "L1 overnight.")))
        XCTAssertEqual(model.ready?.output.kind, .prose)
        XCTAssertEqual(model.ready?.output.body, "L1 overnight.")
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
        XCTAssertEqual(
            AIChargingCurveFingerprintClustering.surfaceSlug,
            "AIChargingCurveFingerprintClustering"
        )
    }
}

// MARK: - Accessibility summary

@MainActor final class ChargeCurveFingerprintAccessibilityTests: XCTestCase {
    func testActionLabelJoinsAskAndContext() {
        XCTAssertEqual(
            ChargeCurveFingerprintAccessibility.actionLabel(ask: "Ask Helix", context: "Explain clusters"),
            "Ask Helix · Explain clusters"
        )
    }

    func testOutputLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            ChargeCurveFingerprintAccessibility.outputLabel("Charging-curve cluster narrative", "L1 overnight."),
            "Charging-curve cluster narrative: L1 overnight."
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyChargeCurveFingerprintTelemetry: ChargeCurveFingerprintTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
