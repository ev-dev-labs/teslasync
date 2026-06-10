//
//  AIMLChargingCurveClustering.Tests.swift
//  TeslaSync — P4 shared surface · 0027 · AIMLChargingCurveClustering (Apple)
//
//  Unit coverage for the AIMLChargingCurveClustering surface:
//    • Projection — gated / loading / error / ready, the `canStart = vehicleId != nil` rule, the
//      Ask-Helix label flip, the disabled rule, and every localized `AiOutputPanel` branch
//      (empty / no-vehicle / thinking / prose / error / unknown-error).
//    • State holder — `MLChargeCurveModel` wiring, the P1/S11 `view.opened` telemetry (deferred past
//      the gate), the stale one-shot auto-refresh + re-arm, and the
//      generate / cancel / refresh / stop delegation.
//    • Accessibility — the VoiceOver action + output label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryMLChargeCurveSource`, and the locale is injected for determinism. In
//  the test bundle the per-surface strings table is absent, so the i18n facade returns the web
//  English `value:` fallbacks, which these assertions check.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Projection: phases

@MainActor final class MLChargeCurveProjectionPhaseTests: XCTestCase {
    func testGatedWhenFeatureDisabled() {
        let resolved = MLChargeCurveProjection.resolve(
            MLChargeCurveInput(availability: .resolved(enabled: false), vehicleID: 7),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertNil(resolved.ready)
    }

    func testLoadingWhenAvailabilityLoading() {
        let resolved = MLChargeCurveProjection.resolve(
            MLChargeCurveInput(availability: .loading),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.ready)
    }

    func testErrorWhenAvailabilityFailed() {
        let resolved = MLChargeCurveProjection.resolve(
            MLChargeCurveInput(availability: .failed("boom")),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.ready)
    }

    func testReadyWhenEnabled() {
        let resolved = MLChargeCurveProjection.resolve(
            MLChargeCurveInput(availability: .resolved(enabled: true), vehicleID: 7),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertNotNil(resolved.ready)
    }
}

// MARK: - Projection: ready card content

@MainActor final class MLChargeCurveProjectionReadyTests: XCTestCase {
    private func ready(
        vehicleID: Int? = 7,
        stream: MLChargeCurveStreamSnapshot = .idle
    ) -> MLChargeCurveReady {
        let resolved = MLChargeCurveProjection.resolve(
            MLChargeCurveInput(
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
        XCTAssertEqual(card.title, "Learn per-vehicle charging-curve clusters")
        XCTAssertEqual(card.badge, "Helix")
        XCTAssertTrue(card.description.contains("per-cluster (L1 overnight / L2 workplace / DC fast)"))
        XCTAssertTrue(card.description.contains("Charging Curve page today"))
        XCTAssertEqual(card.buttonContext, "Train charging-curve clusters")
    }

    func testCanStartFollowsVehiclePresence() {
        XCTAssertTrue(ready(vehicleID: 7).canStart)
        XCTAssertFalse(ready(vehicleID: nil).canStart)
    }

    func testActionLabelIsAskHelixWhenIdle() {
        let card = ready(stream: .idle)
        XCTAssertEqual(card.actionTitle, "Ask Helix")
        XCTAssertFalse(card.action.isStreaming)
    }

    func testActionLabelFlipsToThinkingWhileStreaming() {
        let card = ready(stream: MLChargeCurveStreamSnapshot(state: .streaming))
        XCTAssertTrue(card.action.isStreaming)
        XCTAssertTrue(card.actionTitle.contains("thinking"))
    }

    func testActionDisabledWithoutVehicleOrWhileStreaming() {
        XCTAssertTrue(ready(vehicleID: nil, stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(vehicleID: 7, stream: MLChargeCurveStreamSnapshot(state: .streaming)).action.isDisabled)
        XCTAssertFalse(ready(vehicleID: 7, stream: .idle).action.isDisabled)
    }

    func testActionAccessibilityLabelJoinsAskAndContext() {
        XCTAssertEqual(ready().actionAccessibilityLabel, "Ask Helix · Train charging-curve clusters")
    }
}

// MARK: - Projection: localized output branches

@MainActor final class MLChargeCurveProjectionOutputTests: XCTestCase {
    private func output(
        vehicleID: Int? = 7,
        stream: MLChargeCurveStreamSnapshot
    ) -> MLChargeCurveResolvedOutput {
        MLChargeCurveProjection.resolve(
            MLChargeCurveInput(
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
        XCTAssertTrue(out.body.contains("No clusters trained yet"))
    }

    func testNoVehicleHintWhenIdleWithoutVehicle() {
        let out = output(vehicleID: nil, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Select a vehicle"))
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        let out = output(stream: MLChargeCurveStreamSnapshot(state: .streaming, text: ""))
        XCTAssertEqual(out.kind, .thinking)
        XCTAssertTrue(out.body.contains("thinking"))
    }

    func testProseOnceTextArrives() {
        let out = output(stream: MLChargeCurveStreamSnapshot(state: .streaming, text: "L1 cluster learned."))
        XCTAssertEqual(out.kind, .prose)
        XCTAssertEqual(out.body, "L1 cluster learned.")
    }

    func testFailedComposesHelixErrorPrefix() {
        let out = output(stream: MLChargeCurveStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("Helix error:"))
        XCTAssertTrue(out.body.contains("stream_http_429"))
    }

    func testFailedFallsBackToUnknownMessage() {
        let out = output(stream: MLChargeCurveStreamSnapshot(state: .error, text: "", error: nil))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("unknown"))
    }
}

// MARK: - State holder: wiring, telemetry, freshness, gate, delegation

@MainActor final class MLChargeCurveModelTests: XCTestCase {
    private func makeModel(
        _ input: MLChargeCurveInput,
        telemetry: MLChargeCurveTelemetry = OSLogMLChargeCurveTelemetry()
    ) -> (MLChargeCurveModel, InMemoryMLChargeCurveSource) {
        let source = InMemoryMLChargeCurveSource(initial: input)
        let model = MLChargeCurveModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func enabled(
        vehicleID: Int? = 7,
        connection: MLChargeCurveConnection = .live,
        stream: MLChargeCurveStreamSnapshot = .idle
    ) -> MLChargeCurveInput {
        MLChargeCurveInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            connection: connection,
            stream: stream
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyMLChargeCurveTelemetry()
        let (model, source) = makeModel(enabled(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(spy.surfaces, [AIMLChargingCurveClustering.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpyMLChargeCurveTelemetry()
        let (model, _) = makeModel(
            MLChargeCurveInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertTrue(model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpyMLChargeCurveTelemetry()
        let (model, source) = makeModel(
            MLChargeCurveInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertEqual(spy.surfaces, [])
        source.push(enabled())
        XCTAssertFalse(model.isGated)
        XCTAssertEqual(spy.surfaces, [AIMLChargingCurveClustering.surfaceSlug])
        // Staying presented must not re-emit.
        source.push(enabled(connection: .live))
        XCTAssertEqual(spy.surfaces, [AIMLChargingCurveClustering.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(MLChargeCurveInput(availability: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(enabled())
        XCTAssertEqual(model.phase, .ready)
    }

    func testStreamSnapshotFlowsIntoOutput() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(stream: MLChargeCurveStreamSnapshot(state: .done, text: "Clusters ready.")))
        XCTAssertEqual(model.ready?.output.kind, .prose)
        XCTAssertEqual(model.ready?.output.body, "Clusters ready.")
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
        XCTAssertEqual(AIMLChargingCurveClustering.surfaceSlug, "AIMLChargingCurveClustering")
    }
}

// MARK: - Accessibility summary

@MainActor final class MLChargeCurveAccessibilityTests: XCTestCase {
    func testActionLabelJoinsAskAndContext() {
        XCTAssertEqual(
            MLChargeCurveAccessibility.actionLabel(ask: "Ask Helix", context: "Train charging-curve clusters"),
            "Ask Helix · Train charging-curve clusters"
        )
    }

    func testOutputLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            MLChargeCurveAccessibility.outputLabel("Charging-curve clusters", "Clusters ready."),
            "Charging-curve clusters: Clusters ready."
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyMLChargeCurveTelemetry: MLChargeCurveTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
