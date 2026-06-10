//
//  AIRangePrediction.Tests.swift
//  TeslaSync — P4 shared surface · 0043 · AIRangePrediction (Apple)
//
//  Unit coverage for the AIRangePrediction surface:
//    • Projection — gated / loading / error / ready, the `canStart = vehicleId != null` rule (incl.
//      the nil and the id-0 boundaries — 0 is a valid selection, unlike the `> 0` path surfaces),
//      the Ask-Helix label flip, the disabled rule, and every localized `AiOutputPanel` branch
//      (empty / no-vehicle / thinking / prose / error / unknown-error).
//    • State holder — `RangePredictionModel` wiring, the P1/S11 `view.opened` telemetry (deferred
//      past the gate), the stale one-shot auto-refresh + re-arm, and the generate / cancel /
//      refresh / stop delegation.
//    • Accessibility — the VoiceOver action + output label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryRangePredictionSource`, and the locale is injected for determinism. In
//  the test bundle the per-surface strings table is absent, so the i18n facade returns the web
//  English `value:` fallbacks, which these assertions check.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Projection: phases

@MainActor final class RangePredictionProjectionPhaseTests: XCTestCase {
    func testGatedWhenFeatureDisabled() {
        let resolved = RangePredictionProjection.resolve(
            RangePredictionInput(availability: .resolved(enabled: false), vehicleID: 7),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertNil(resolved.ready)
    }

    func testLoadingWhenAvailabilityLoading() {
        let resolved = RangePredictionProjection.resolve(
            RangePredictionInput(availability: .loading),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.ready)
    }

    func testErrorWhenAvailabilityFailed() {
        let resolved = RangePredictionProjection.resolve(
            RangePredictionInput(availability: .failed("boom")),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.ready)
    }

    func testReadyWhenEnabled() {
        let resolved = RangePredictionProjection.resolve(
            RangePredictionInput(availability: .resolved(enabled: true), vehicleID: 7),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertNotNil(resolved.ready)
    }
}

// MARK: - Projection: ready card content

@MainActor final class RangePredictionProjectionReadyTests: XCTestCase {
    private func ready(
        vehicleID: Int? = 7,
        stream: RangePredictionStreamSnapshot = .idle
    ) -> RangePredictionReady {
        let resolved = RangePredictionProjection.resolve(
            RangePredictionInput(
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
        XCTAssertEqual(card.title, "Learn per-vehicle range model")
        XCTAssertEqual(card.badge, "Helix")
        XCTAssertTrue(card.description.contains("per-bucket"))
        XCTAssertTrue(card.description.contains("heuristic curve"))
        XCTAssertEqual(card.buttonContext, "Train range model")
    }

    func testDescriptionPreservesUnicodeGlyphs() {
        // Parity: the web copy uses the × multiplication sign and the ’ typographic apostrophe.
        let card = ready()
        XCTAssertTrue(card.description.contains("temperature × speed"))
        XCTAssertTrue(card.description.contains("vehicle’s"))
    }

    func testCanStartRequiresNonNilVehicleID() {
        // Web `canStart={vehicleId != null}`.
        XCTAssertTrue(ready(vehicleID: 7).canStart)
        XCTAssertFalse(ready(vehicleID: nil).canStart)
    }

    func testCanStartAllowsZeroVehicleID() {
        // Web `vehicleId != null` is true for 0 (`0 != null`), unlike the `> 0` path surfaces.
        XCTAssertTrue(ready(vehicleID: 0).canStart)
    }

    func testActionLabelIsAskHelixWhenIdle() {
        let card = ready(stream: .idle)
        XCTAssertEqual(card.actionTitle, "Ask Helix")
        XCTAssertFalse(card.action.isStreaming)
    }

    func testActionLabelFlipsToThinkingWhileStreaming() {
        let card = ready(stream: RangePredictionStreamSnapshot(state: .streaming))
        XCTAssertTrue(card.action.isStreaming)
        XCTAssertTrue(card.actionTitle.contains("thinking"))
    }

    func testActionDisabledWithoutVehicleOrWhileStreaming() {
        XCTAssertTrue(ready(vehicleID: nil, stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(vehicleID: 7, stream: RangePredictionStreamSnapshot(state: .streaming)).action.isDisabled)
        XCTAssertFalse(ready(vehicleID: 7, stream: .idle).action.isDisabled)
        XCTAssertFalse(ready(vehicleID: 0, stream: .idle).action.isDisabled)
    }

    func testActionAccessibilityLabelJoinsAskAndContext() {
        XCTAssertEqual(ready().actionAccessibilityLabel, "Ask Helix · Train range model")
    }
}

// MARK: - Projection: localized output branches

@MainActor final class RangePredictionProjectionOutputTests: XCTestCase {
    private func output(
        vehicleID: Int? = 7,
        stream: RangePredictionStreamSnapshot
    ) -> RangePredictionResolvedOutput {
        RangePredictionProjection.resolve(
            RangePredictionInput(
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
        XCTAssertTrue(out.body.contains("No range model yet"))
    }

    func testNoVehicleHintWhenIdleWithoutVehicle() {
        let out = output(vehicleID: nil, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Select a vehicle"))
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        let out = output(stream: RangePredictionStreamSnapshot(state: .streaming, text: ""))
        XCTAssertEqual(out.kind, .thinking)
        XCTAssertTrue(out.body.contains("thinking"))
    }

    func testProseOnceTextArrives() {
        let out = output(stream: RangePredictionStreamSnapshot(state: .streaming, text: "Learned envelope."))
        XCTAssertEqual(out.kind, .prose)
        XCTAssertEqual(out.body, "Learned envelope.")
    }

    func testFailedComposesHelixErrorPrefix() {
        let out = output(stream: RangePredictionStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("Helix error:"))
        XCTAssertTrue(out.body.contains("stream_http_429"))
    }

    func testFailedFallsBackToUnknownMessage() {
        let out = output(stream: RangePredictionStreamSnapshot(state: .error, text: "", error: nil))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("unknown"))
    }
}

// MARK: - State holder: wiring, telemetry, freshness, gate, delegation

@MainActor final class RangePredictionModelTests: XCTestCase {
    private func makeModel(
        _ input: RangePredictionInput,
        telemetry: RangePredictionTelemetry = OSLogRangePredictionTelemetry()
    ) -> (RangePredictionModel, InMemoryRangePredictionSource) {
        let source = InMemoryRangePredictionSource(initial: input)
        let model = RangePredictionModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func enabled(
        vehicleID: Int? = 7,
        connection: RangePredictionConnection = .live,
        stream: RangePredictionStreamSnapshot = .idle
    ) -> RangePredictionInput {
        RangePredictionInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            connection: connection,
            stream: stream
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyRangePredictionTelemetry()
        let (model, source) = makeModel(enabled(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(spy.surfaces, [AIRangePrediction.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpyRangePredictionTelemetry()
        let (model, _) = makeModel(
            RangePredictionInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertTrue(model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpyRangePredictionTelemetry()
        let (model, source) = makeModel(
            RangePredictionInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertEqual(spy.surfaces, [])
        source.push(enabled())
        XCTAssertFalse(model.isGated)
        XCTAssertEqual(spy.surfaces, [AIRangePrediction.surfaceSlug])
        // Staying presented must not re-emit.
        source.push(enabled(connection: .live))
        XCTAssertEqual(spy.surfaces, [AIRangePrediction.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(RangePredictionInput(availability: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(enabled())
        XCTAssertEqual(model.phase, .ready)
    }

    func testStreamSnapshotFlowsIntoOutput() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(stream: RangePredictionStreamSnapshot(state: .done, text: "Learned envelope.")))
        XCTAssertEqual(model.ready?.output.kind, .prose)
        XCTAssertEqual(model.ready?.output.body, "Learned envelope.")
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
        XCTAssertEqual(AIRangePrediction.surfaceSlug, "AIRangePrediction")
    }
}

// MARK: - Accessibility summary

@MainActor final class RangePredictionAccessibilityTests: XCTestCase {
    func testActionLabelJoinsAskAndContext() {
        XCTAssertEqual(
            RangePredictionAccessibility.actionLabel(ask: "Ask Helix", context: "Train range model"),
            "Ask Helix · Train range model"
        )
    }

    func testOutputLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            RangePredictionAccessibility.outputLabel("Range model narrative", "Learned envelope."),
            "Range model narrative: Learned envelope."
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyRangePredictionTelemetry: RangePredictionTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
