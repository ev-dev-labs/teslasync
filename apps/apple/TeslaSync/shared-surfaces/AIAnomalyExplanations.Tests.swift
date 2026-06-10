//
//  AIAnomalyExplanations.Tests.swift
//  TeslaSync — P4 shared surface · 0005 · AIAnomalyExplanations (Apple)
//
//  Unit coverage for the AIAnomalyExplanations surface:
//    • Projection — gated / loading / error / ready, the `canStart = vehicleId != nil` rule, the
//      Ask-Helix label flip, the disabled rule, and every localized `AiOutputPanel` branch
//      (empty / no-vehicle / thinking / prose / error / unknown-error).
//    • State holder — `AnomalyExplanationsModel` wiring, the P1/S11 `view.opened` telemetry
//      (deferred past the gate), the stale one-shot auto-refresh + re-arm, and the
//      generate / cancel / refresh / stop delegation.
//    • Accessibility — the VoiceOver action + output label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryAnomalyExplanationsSource`, and the locale is injected for
//  determinism. In the test bundle the per-surface strings table is absent, so the i18n facade
//  returns the web English `value:` fallbacks, which these assertions check.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Projection: phases

@MainActor final class AnomalyProjectionPhaseTests: XCTestCase {
    func testGatedWhenFeatureDisabled() {
        let resolved = AnomalyExplanationsProjection.resolve(
            AnomalyExplanationsInput(availability: .resolved(enabled: false), vehicleID: 7),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertNil(resolved.ready)
    }

    func testLoadingWhenAvailabilityLoading() {
        let resolved = AnomalyExplanationsProjection.resolve(
            AnomalyExplanationsInput(availability: .loading),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.ready)
    }

    func testErrorWhenAvailabilityFailed() {
        let resolved = AnomalyExplanationsProjection.resolve(
            AnomalyExplanationsInput(availability: .failed("boom")),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.ready)
    }

    func testReadyWhenEnabled() {
        let resolved = AnomalyExplanationsProjection.resolve(
            AnomalyExplanationsInput(availability: .resolved(enabled: true), vehicleID: 7),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertNotNil(resolved.ready)
    }
}

// MARK: - Projection: ready card content

@MainActor final class AnomalyProjectionReadyTests: XCTestCase {
    private func ready(
        vehicleID: Int? = 7,
        stream: AnomalyStreamSnapshot = .idle
    ) -> AnomalyReady {
        let resolved = AnomalyExplanationsProjection.resolve(
            AnomalyExplanationsInput(
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
        XCTAssertEqual(card.title, "Helix explanation")
        XCTAssertEqual(card.badge, "Helix")
        XCTAssertTrue(card.description.contains("plain-language explanation"))
        XCTAssertTrue(card.description.contains("already identified above"))
        XCTAssertEqual(card.buttonContext, "Generate explanation")
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
        let card = ready(stream: AnomalyStreamSnapshot(state: .streaming))
        XCTAssertTrue(card.action.isStreaming)
        XCTAssertTrue(card.actionTitle.contains("thinking"))
    }

    func testActionDisabledWithoutVehicleOrWhileStreaming() {
        XCTAssertTrue(ready(vehicleID: nil, stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(vehicleID: 7, stream: AnomalyStreamSnapshot(state: .streaming)).action.isDisabled)
        XCTAssertFalse(ready(vehicleID: 7, stream: .idle).action.isDisabled)
    }

    func testActionAccessibilityLabelJoinsAskAndContext() {
        XCTAssertEqual(ready().actionAccessibilityLabel, "Ask Helix · Generate explanation")
    }
}

// MARK: - Projection: localized output branches

@MainActor final class AnomalyProjectionOutputTests: XCTestCase {
    private func output(
        vehicleID: Int? = 7,
        stream: AnomalyStreamSnapshot
    ) -> AnomalyResolvedOutput {
        AnomalyExplanationsProjection.resolve(
            AnomalyExplanationsInput(
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
        let out = output(vehicleID: nil, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Select a vehicle"))
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        let out = output(stream: AnomalyStreamSnapshot(state: .streaming, text: ""))
        XCTAssertEqual(out.kind, .thinking)
        XCTAssertTrue(out.body.contains("thinking"))
    }

    func testProseOnceTextArrives() {
        let out = output(stream: AnomalyStreamSnapshot(state: .streaming, text: "Cell drift detected."))
        XCTAssertEqual(out.kind, .prose)
        XCTAssertEqual(out.body, "Cell drift detected.")
    }

    func testFailedComposesHelixErrorPrefix() {
        let out = output(stream: AnomalyStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("Helix error:"))
        XCTAssertTrue(out.body.contains("stream_http_429"))
    }

    func testFailedFallsBackToUnknownMessage() {
        let out = output(stream: AnomalyStreamSnapshot(state: .error, text: "", error: nil))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("unknown"))
    }
}

// MARK: - State holder: wiring, telemetry, freshness, gate, delegation

@MainActor final class AnomalyModelTests: XCTestCase {
    private func makeModel(
        _ input: AnomalyExplanationsInput,
        telemetry: AnomalyExplanationsTelemetry = OSLogAnomalyTelemetry()
    ) -> (AnomalyExplanationsModel, InMemoryAnomalyExplanationsSource) {
        let source = InMemoryAnomalyExplanationsSource(initial: input)
        let model = AnomalyExplanationsModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func enabled(
        vehicleID: Int? = 7,
        connection: AnomalyConnection = .live,
        stream: AnomalyStreamSnapshot = .idle
    ) -> AnomalyExplanationsInput {
        AnomalyExplanationsInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            connection: connection,
            stream: stream
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyAnomalyTelemetry()
        let (model, source) = makeModel(enabled(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(spy.surfaces, [AIAnomalyExplanations.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpyAnomalyTelemetry()
        let (model, _) = makeModel(
            AnomalyExplanationsInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertTrue(model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpyAnomalyTelemetry()
        let (model, source) = makeModel(
            AnomalyExplanationsInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertEqual(spy.surfaces, [])
        source.push(enabled())
        XCTAssertFalse(model.isGated)
        XCTAssertEqual(spy.surfaces, [AIAnomalyExplanations.surfaceSlug])
        // Staying presented must not re-emit.
        source.push(enabled(connection: .live))
        XCTAssertEqual(spy.surfaces, [AIAnomalyExplanations.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(AnomalyExplanationsInput(availability: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(enabled())
        XCTAssertEqual(model.phase, .ready)
    }

    func testStreamSnapshotFlowsIntoOutput() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(stream: AnomalyStreamSnapshot(state: .done, text: "All clear.")))
        XCTAssertEqual(model.ready?.output.kind, .prose)
        XCTAssertEqual(model.ready?.output.body, "All clear.")
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
        XCTAssertEqual(AIAnomalyExplanations.surfaceSlug, "AIAnomalyExplanations")
    }
}

// MARK: - Accessibility summary

@MainActor final class AnomalyAccessibilityTests: XCTestCase {
    func testActionLabelJoinsAskAndContext() {
        XCTAssertEqual(
            AnomalyAccessibility.actionLabel(ask: "Ask Helix", context: "Generate explanation"),
            "Ask Helix · Generate explanation"
        )
    }

    func testOutputLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            AnomalyAccessibility.outputLabel("Helix explanation", "All clear."),
            "Helix explanation: All clear."
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyAnomalyTelemetry: AnomalyExplanationsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
