//
//  AIPreheatPrecoolRecommender.Tests.swift
//  TeslaSync — P4 shared surface · 0040 · AIPreheatPrecoolRecommender (Apple)
//
//  Unit coverage for the AIPreheatPrecoolRecommender surface:
//    • Projection — gated / loading / error / ready, the five-part `canStart` rule, the Ask-Helix
//      label flip, the disabled rule, and every localized `AiOutputPanel` branch (empty /
//      missing-inputs / thinking / prose / error / unknown-error).
//    • State holder — `PreheatPrecoolModel` wiring, the P1/S11 `view.opened` telemetry (deferred
//      past the gate), the stale one-shot auto-refresh + re-arm, and the generate / cancel /
//      refresh / stop delegation.
//    • Accessibility — the VoiceOver action + output label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryPreheatPrecoolSource`, and the locale is injected for determinism. In
//  the test bundle the per-surface strings table is absent, so the i18n facade returns the web
//  English `value:` fallbacks, which these assertions check.
//

import Foundation
import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

private func fullRequest(
    vehicleID: Int? = 12,
    departBy: String? = "2026-01-15T08:00:00Z",
    currentCabinTempC: Double? = 9.5,
    outsideTempC: Double? = 2.0,
    targetCabinTempC: Double? = 21
) -> PreheatPrecoolRequest {
    PreheatPrecoolRequest(
        vehicleID: vehicleID,
        departBy: departBy,
        currentCabinTempC: currentCabinTempC,
        outsideTempC: outsideTempC,
        targetCabinTempC: targetCabinTempC
    )
}

// MARK: - Projection: phases

@MainActor final class PreheatPrecoolProjectionPhaseTests: XCTestCase {
    func testGatedWhenFeatureDisabled() {
        let resolved = PreheatPrecoolProjection.resolve(
            PreheatPrecoolInput(availability: .resolved(enabled: false), request: fullRequest()),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertNil(resolved.ready)
    }

    func testLoadingWhenAvailabilityLoading() {
        let resolved = PreheatPrecoolProjection.resolve(
            PreheatPrecoolInput(availability: .loading),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.ready)
    }

    func testErrorWhenAvailabilityFailed() {
        let resolved = PreheatPrecoolProjection.resolve(
            PreheatPrecoolInput(availability: .failed("boom")),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.ready)
    }

    func testReadyWhenEnabled() {
        let resolved = PreheatPrecoolProjection.resolve(
            PreheatPrecoolInput(availability: .resolved(enabled: true), request: fullRequest()),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertNotNil(resolved.ready)
    }
}

// MARK: - Projection: ready card content

@MainActor final class PreheatPrecoolProjectionReadyTests: XCTestCase {
    private func ready(
        request: PreheatPrecoolRequest = fullRequest(),
        stream: PreheatPrecoolStreamSnapshot = .idle
    ) -> PreheatPrecoolReady {
        let resolved = PreheatPrecoolProjection.resolve(
            PreheatPrecoolInput(
                availability: .resolved(enabled: true),
                request: request,
                stream: stream
            ),
            locale: enUS
        )
        return resolved.ready!
    }

    func testTitleDescriptionBadgeAreParityStrings() {
        let card = ready()
        XCTAssertEqual(card.title, "Suggest a preheat or precool schedule")
        XCTAssertEqual(card.badge, "Helix")
        XCTAssertTrue(card.description.contains("preheat or precool window"))
        XCTAssertTrue(card.description.contains("never persists a schedule"))
        XCTAssertEqual(card.buttonContext, "Draft schedule")
    }

    func testCanStartRequiresAllFourInputs() {
        // Web `haveInputs = haveVehicle && haveDepart && haveCabin && haveOutside`.
        XCTAssertTrue(ready(request: fullRequest()).canStart)
        XCTAssertFalse(ready(request: fullRequest(vehicleID: nil)).canStart)
        XCTAssertFalse(ready(request: fullRequest(departBy: nil)).canStart)
        XCTAssertFalse(ready(request: fullRequest(currentCabinTempC: nil)).canStart)
        XCTAssertFalse(ready(request: fullRequest(outsideTempC: nil)).canStart)
    }

    func testCanStartIgnoresTarget() {
        XCTAssertTrue(ready(request: fullRequest(targetCabinTempC: nil)).canStart)
    }

    func testActionLabelIsAskHelixWhenIdle() {
        let card = ready(stream: .idle)
        XCTAssertEqual(card.actionTitle, "Ask Helix")
        XCTAssertFalse(card.action.isStreaming)
    }

    func testActionLabelFlipsToThinkingWhileStreaming() {
        let card = ready(stream: PreheatPrecoolStreamSnapshot(state: .streaming))
        XCTAssertTrue(card.action.isStreaming)
        XCTAssertTrue(card.actionTitle.contains("thinking"))
    }

    func testActionDisabledWithoutInputsOrWhileStreaming() {
        XCTAssertTrue(ready(request: fullRequest(vehicleID: nil)).action.isDisabled)
        XCTAssertTrue(ready(request: fullRequest(departBy: nil)).action.isDisabled)
        XCTAssertTrue(
            ready(request: fullRequest(), stream: PreheatPrecoolStreamSnapshot(state: .streaming)).action.isDisabled
        )
        XCTAssertFalse(ready(request: fullRequest(), stream: .idle).action.isDisabled)
    }

    func testActionAccessibilityLabelJoinsAskAndContext() {
        XCTAssertEqual(ready().actionAccessibilityLabel, "Ask Helix · Draft schedule")
    }
}

// MARK: - Projection: localized output branches

@MainActor final class PreheatPrecoolProjectionOutputTests: XCTestCase {
    private func output(
        request: PreheatPrecoolRequest = fullRequest(),
        stream: PreheatPrecoolStreamSnapshot
    ) -> PreheatPrecoolResolvedOutput {
        PreheatPrecoolProjection.resolve(
            PreheatPrecoolInput(
                availability: .resolved(enabled: true),
                request: request,
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

    func testNoInputsHintWhenIdleWithoutInputs() {
        let out = output(request: PreheatPrecoolRequest(), stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Add a vehicle"))
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        let out = output(stream: PreheatPrecoolStreamSnapshot(state: .streaming, text: ""))
        XCTAssertEqual(out.kind, .thinking)
        XCTAssertTrue(out.body.contains("thinking"))
    }

    func testProseOnceTextArrives() {
        let out = output(stream: PreheatPrecoolStreamSnapshot(state: .streaming, text: "Preheat 07:38."))
        XCTAssertEqual(out.kind, .prose)
        XCTAssertEqual(out.body, "Preheat 07:38.")
    }

    func testFailedComposesHelixErrorPrefix() {
        let out = output(stream: PreheatPrecoolStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("Helix error:"))
        XCTAssertTrue(out.body.contains("stream_http_429"))
    }

    func testFailedFallsBackToUnknownMessage() {
        let out = output(stream: PreheatPrecoolStreamSnapshot(state: .error, text: "", error: nil))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("unknown"))
    }
}

// MARK: - State holder: wiring, telemetry, freshness, gate, delegation

@MainActor final class PreheatPrecoolModelTests: XCTestCase {
    private func makeModel(
        _ input: PreheatPrecoolInput,
        telemetry: PreheatPrecoolTelemetry = OSLogPreheatPrecoolTelemetry()
    ) -> (PreheatPrecoolModel, InMemoryPreheatPrecoolSource) {
        let source = InMemoryPreheatPrecoolSource(initial: input)
        let model = PreheatPrecoolModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func enabled(
        request: PreheatPrecoolRequest = fullRequest(),
        connection: PreheatPrecoolConnection = .live,
        stream: PreheatPrecoolStreamSnapshot = .idle
    ) -> PreheatPrecoolInput {
        PreheatPrecoolInput(
            availability: .resolved(enabled: true),
            request: request,
            connection: connection,
            stream: stream
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyPreheatPrecoolTelemetry()
        let (model, source) = makeModel(enabled(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(spy.surfaces, [AIPreheatPrecoolRecommender.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpyPreheatPrecoolTelemetry()
        let (model, _) = makeModel(
            PreheatPrecoolInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertTrue(model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpyPreheatPrecoolTelemetry()
        let (model, source) = makeModel(
            PreheatPrecoolInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertEqual(spy.surfaces, [])
        source.push(enabled())
        XCTAssertFalse(model.isGated)
        XCTAssertEqual(spy.surfaces, [AIPreheatPrecoolRecommender.surfaceSlug])
        // Staying presented must not re-emit.
        source.push(enabled(connection: .live))
        XCTAssertEqual(spy.surfaces, [AIPreheatPrecoolRecommender.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(PreheatPrecoolInput(availability: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(enabled())
        XCTAssertEqual(model.phase, .ready)
    }

    func testStreamSnapshotFlowsIntoOutput() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(stream: PreheatPrecoolStreamSnapshot(state: .done, text: "Preheat 07:38.")))
        XCTAssertEqual(model.ready?.output.kind, .prose)
        XCTAssertEqual(model.ready?.output.body, "Preheat 07:38.")
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
        XCTAssertEqual(AIPreheatPrecoolRecommender.surfaceSlug, "AIPreheatPrecoolRecommender")
    }
}

// MARK: - Accessibility summary

@MainActor final class PreheatPrecoolAccessibilityTests: XCTestCase {
    func testActionLabelJoinsAskAndContext() {
        XCTAssertEqual(
            PreheatPrecoolAccessibility.actionLabel(ask: "Ask Helix", context: "Draft schedule"),
            "Ask Helix · Draft schedule"
        )
    }

    func testOutputLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            PreheatPrecoolAccessibility.outputLabel("Preheat / precool schedule proposal", "Preheat 07:38."),
            "Preheat / precool schedule proposal: Preheat 07:38."
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyPreheatPrecoolTelemetry: PreheatPrecoolTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
