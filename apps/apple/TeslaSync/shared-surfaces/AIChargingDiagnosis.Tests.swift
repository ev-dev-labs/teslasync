//
//  AIChargingDiagnosis.Tests.swift
//  TeslaSync — P4 shared surface · 0011 · AIChargingDiagnosis (Apple)
//
//  Unit coverage for the AIChargingDiagnosis surface:
//    • Projection — gated / loading / error / ready, the `canStart = !!sessionId` rule (incl. the
//      nil and empty-string boundaries), the Ask-Helix label flip, the disabled rule, and every
//      localized `AiOutputPanel` branch (empty / no-session / thinking / prose / error /
//      unknown-error).
//    • State holder — `ChargingDiagnosisModel` wiring, the P1/S11 `view.opened` telemetry (deferred
//      past the gate), the stale one-shot auto-refresh + re-arm, and the generate / cancel /
//      refresh / stop delegation.
//    • Accessibility — the VoiceOver action + output label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryChargingDiagnosisSource`, and the locale is injected for determinism. In
//  the test bundle the per-surface strings table is absent, so the i18n facade returns the web
//  English `value:` fallbacks, which these assertions check.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Projection: phases

@MainActor final class ChargingDiagnosisProjectionPhaseTests: XCTestCase {
    func testGatedWhenFeatureDisabled() {
        let resolved = ChargingDiagnosisProjection.resolve(
            ChargingDiagnosisInput(availability: .resolved(enabled: false), sessionID: "4821"),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertNil(resolved.ready)
    }

    func testLoadingWhenAvailabilityLoading() {
        let resolved = ChargingDiagnosisProjection.resolve(
            ChargingDiagnosisInput(availability: .loading),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.ready)
    }

    func testErrorWhenAvailabilityFailed() {
        let resolved = ChargingDiagnosisProjection.resolve(
            ChargingDiagnosisInput(availability: .failed("boom")),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.ready)
    }

    func testReadyWhenEnabled() {
        let resolved = ChargingDiagnosisProjection.resolve(
            ChargingDiagnosisInput(availability: .resolved(enabled: true), sessionID: "4821"),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertNotNil(resolved.ready)
    }
}

// MARK: - Projection: ready card content

@MainActor final class ChargingDiagnosisProjectionReadyTests: XCTestCase {
    private func ready(
        sessionID: String? = "4821",
        stream: ChargingDiagnosisStreamSnapshot = .idle
    ) -> ChargingDiagnosisReady {
        let resolved = ChargingDiagnosisProjection.resolve(
            ChargingDiagnosisInput(
                availability: .resolved(enabled: true),
                sessionID: sessionID,
                stream: stream
            ),
            locale: enUS
        )
        return resolved.ready!
    }

    func testTitleDescriptionBadgeAreParityStrings() {
        let card = ready()
        XCTAssertEqual(card.title, "Charging diagnosis")
        XCTAssertEqual(card.badge, "Helix")
        XCTAssertTrue(card.description.contains("flags raised"))
        XCTAssertTrue(card.description.contains("deterministic aggregation metrics"))
        XCTAssertEqual(card.buttonContext, "Generate diagnosis")
    }

    func testCanStartRequiresNonEmptySessionID() {
        // Web `canStart={!!sessionId}`.
        XCTAssertTrue(ready(sessionID: "4821").canStart)
        XCTAssertFalse(ready(sessionID: nil).canStart)
        XCTAssertFalse(ready(sessionID: "").canStart)
    }

    func testActionLabelIsAskHelixWhenIdle() {
        let card = ready(stream: .idle)
        XCTAssertEqual(card.actionTitle, "Ask Helix")
        XCTAssertFalse(card.action.isStreaming)
    }

    func testActionLabelFlipsToThinkingWhileStreaming() {
        let card = ready(stream: ChargingDiagnosisStreamSnapshot(state: .streaming))
        XCTAssertTrue(card.action.isStreaming)
        XCTAssertTrue(card.actionTitle.contains("thinking"))
    }

    func testActionDisabledWithoutSessionOrWhileStreaming() {
        XCTAssertTrue(ready(sessionID: nil, stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(sessionID: "", stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(sessionID: "4821", stream: ChargingDiagnosisStreamSnapshot(state: .streaming)).action
            .isDisabled)
        XCTAssertFalse(ready(sessionID: "4821", stream: .idle).action.isDisabled)
    }

    func testActionAccessibilityLabelJoinsAskAndContext() {
        XCTAssertEqual(ready().actionAccessibilityLabel, "Ask Helix · Generate diagnosis")
    }
}

// MARK: - Projection: localized output branches

@MainActor final class ChargingDiagnosisProjectionOutputTests: XCTestCase {
    private func output(
        sessionID: String? = "4821",
        stream: ChargingDiagnosisStreamSnapshot
    ) -> ChargingDiagnosisResolvedOutput {
        ChargingDiagnosisProjection.resolve(
            ChargingDiagnosisInput(
                availability: .resolved(enabled: true),
                sessionID: sessionID,
                stream: stream
            ),
            locale: enUS
        ).ready!.output
    }

    func testEmptyHintWhenIdleWithSession() {
        let out = output(stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("No diagnosis yet"))
    }

    func testNoSessionHintWhenIdleWithoutSession() {
        let out = output(sessionID: nil, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Open a charging session"))
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        let out = output(stream: ChargingDiagnosisStreamSnapshot(state: .streaming, text: ""))
        XCTAssertEqual(out.kind, .thinking)
        XCTAssertTrue(out.body.contains("thinking"))
    }

    func testProseOnceTextArrives() {
        let out = output(stream: ChargingDiagnosisStreamSnapshot(state: .streaming, text: "Trickle charge."))
        XCTAssertEqual(out.kind, .prose)
        XCTAssertEqual(out.body, "Trickle charge.")
    }

    func testFailedComposesHelixErrorPrefix() {
        let out = output(stream: ChargingDiagnosisStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("Helix error:"))
        XCTAssertTrue(out.body.contains("stream_http_429"))
    }

    func testFailedFallsBackToUnknownMessage() {
        let out = output(stream: ChargingDiagnosisStreamSnapshot(state: .error, text: "", error: nil))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("unknown"))
    }
}

// MARK: - State holder: wiring, telemetry, freshness, gate, delegation

@MainActor final class ChargingDiagnosisModelTests: XCTestCase {
    private func makeModel(
        _ input: ChargingDiagnosisInput,
        telemetry: ChargingDiagnosisTelemetry = OSLogChargingDiagnosisTelemetry()
    ) -> (ChargingDiagnosisModel, InMemoryChargingDiagnosisSource) {
        let source = InMemoryChargingDiagnosisSource(initial: input)
        let model = ChargingDiagnosisModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func enabled(
        sessionID: String? = "4821",
        connection: ChargingDiagnosisConnection = .live,
        stream: ChargingDiagnosisStreamSnapshot = .idle
    ) -> ChargingDiagnosisInput {
        ChargingDiagnosisInput(
            availability: .resolved(enabled: true),
            sessionID: sessionID,
            connection: connection,
            stream: stream
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyChargingDiagnosisTelemetry()
        let (model, source) = makeModel(enabled(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(spy.surfaces, [AIChargingDiagnosis.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpyChargingDiagnosisTelemetry()
        let (model, _) = makeModel(
            ChargingDiagnosisInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertTrue(model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpyChargingDiagnosisTelemetry()
        let (model, source) = makeModel(
            ChargingDiagnosisInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertEqual(spy.surfaces, [])
        source.push(enabled())
        XCTAssertFalse(model.isGated)
        XCTAssertEqual(spy.surfaces, [AIChargingDiagnosis.surfaceSlug])
        // Staying presented must not re-emit.
        source.push(enabled(connection: .live))
        XCTAssertEqual(spy.surfaces, [AIChargingDiagnosis.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(ChargingDiagnosisInput(availability: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(enabled())
        XCTAssertEqual(model.phase, .ready)
    }

    func testStreamSnapshotFlowsIntoOutput() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(stream: ChargingDiagnosisStreamSnapshot(state: .done, text: "Trickle charge.")))
        XCTAssertEqual(model.ready?.output.kind, .prose)
        XCTAssertEqual(model.ready?.output.body, "Trickle charge.")
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
        XCTAssertEqual(AIChargingDiagnosis.surfaceSlug, "AIChargingDiagnosis")
    }
}

// MARK: - Accessibility summary

@MainActor final class ChargingDiagnosisAccessibilityTests: XCTestCase {
    func testActionLabelJoinsAskAndContext() {
        XCTAssertEqual(
            ChargingDiagnosisAccessibility.actionLabel(ask: "Ask Helix", context: "Generate diagnosis"),
            "Ask Helix · Generate diagnosis"
        )
    }

    func testOutputLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            ChargingDiagnosisAccessibility.outputLabel("Charging diagnosis narrative", "Trickle charge."),
            "Charging diagnosis narrative: Trickle charge."
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyChargingDiagnosisTelemetry: ChargingDiagnosisTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
