//
//  AIDigestNarration.Tests.swift
//  TeslaSync — P4 shared surface · 0016 · AIDigestNarration (Apple)
//
//  Unit coverage for the AIDigestNarration surface:
//    • Projection — gated / loading / error / ready, the `canStart = vehicleId != null` rule (incl.
//      the nil, zero, and positive boundaries), the Ask-Helix label flip, the disabled rule, and
//      every localized `AiOutputPanel` branch (empty / no-vehicle / thinking / prose / error /
//      unknown-error).
//    • State holder — `DigestNarrationModel` wiring, the P1/S11 `view.opened` telemetry (deferred
//      past the gate), the stale one-shot auto-refresh + re-arm, and the generate / cancel /
//      refresh / stop delegation.
//    • Accessibility — the VoiceOver action + output label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryDigestNarrationSource`, and the locale is injected for determinism. In
//  the test bundle the per-surface strings table is absent, so the i18n facade returns the web
//  English `value:` fallbacks, which these assertions check.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Projection: phases

@MainActor final class DigestNarrationProjectionPhaseTests: XCTestCase {
    func testGatedWhenFeatureDisabled() {
        let resolved = DigestNarrationProjection.resolve(
            DigestNarrationInput(availability: .resolved(enabled: false), vehicleID: 7),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertNil(resolved.ready)
    }

    func testLoadingWhenAvailabilityLoading() {
        let resolved = DigestNarrationProjection.resolve(
            DigestNarrationInput(availability: .loading),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.ready)
    }

    func testErrorWhenAvailabilityFailed() {
        let resolved = DigestNarrationProjection.resolve(
            DigestNarrationInput(availability: .failed("boom")),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.ready)
    }

    func testReadyWhenEnabled() {
        let resolved = DigestNarrationProjection.resolve(
            DigestNarrationInput(availability: .resolved(enabled: true), vehicleID: 7),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertNotNil(resolved.ready)
    }
}

// MARK: - Projection: ready card content

@MainActor final class DigestNarrationProjectionReadyTests: XCTestCase {
    private func ready(
        vehicleID: Int? = 7,
        stream: DigestNarrationStreamSnapshot = .idle
    ) -> DigestNarrationReady {
        let resolved = DigestNarrationProjection.resolve(
            DigestNarrationInput(
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
        XCTAssertEqual(card.title, "Helix narration")
        XCTAssertEqual(card.badge, "Helix")
        XCTAssertTrue(card.description.contains("recap of your week"))
        XCTAssertTrue(card.description.contains("digest data above"))
        XCTAssertEqual(card.buttonContext, "Generate narration")
    }

    func testCanStartRequiresPresentVehicleID() {
        // Web `canStart={vehicleId != null}`: a present id (incl. 0) passes; only nil disables.
        XCTAssertTrue(ready(vehicleID: 7).canStart)
        XCTAssertTrue(ready(vehicleID: 0).canStart)
        XCTAssertFalse(ready(vehicleID: nil).canStart)
    }

    func testActionLabelIsAskHelixWhenIdle() {
        let card = ready(stream: .idle)
        XCTAssertEqual(card.actionTitle, "Ask Helix")
        XCTAssertFalse(card.action.isStreaming)
    }

    func testActionLabelFlipsToThinkingWhileStreaming() {
        let card = ready(stream: DigestNarrationStreamSnapshot(state: .streaming))
        XCTAssertTrue(card.action.isStreaming)
        XCTAssertTrue(card.actionTitle.contains("thinking"))
    }

    func testActionDisabledWithoutVehicleOrWhileStreaming() {
        XCTAssertTrue(ready(vehicleID: nil, stream: .idle).action.isDisabled)
        let streaming = DigestNarrationStreamSnapshot(state: .streaming)
        XCTAssertTrue(ready(vehicleID: 7, stream: streaming).action.isDisabled)
        XCTAssertFalse(ready(vehicleID: 7, stream: .idle).action.isDisabled)
        // Zero is a present id → enabled when idle.
        XCTAssertFalse(ready(vehicleID: 0, stream: .idle).action.isDisabled)
    }

    func testActionAccessibilityLabelJoinsAskAndContext() {
        XCTAssertEqual(ready().actionAccessibilityLabel, "Ask Helix · Generate narration")
    }
}

// MARK: - Projection: localized output branches

@MainActor final class DigestNarrationProjectionOutputTests: XCTestCase {
    private func output(
        vehicleID: Int? = 7,
        stream: DigestNarrationStreamSnapshot
    ) -> DigestNarrationResolvedOutput {
        DigestNarrationProjection.resolve(
            DigestNarrationInput(
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
        XCTAssertTrue(out.body.contains("Pick a vehicle"))
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        let out = output(stream: DigestNarrationStreamSnapshot(state: .streaming, text: ""))
        XCTAssertEqual(out.kind, .thinking)
        XCTAssertTrue(out.body.contains("thinking"))
    }

    func testProseOnceTextArrives() {
        let snapshot = DigestNarrationStreamSnapshot(state: .streaming, text: "A steady week.")
        let out = output(stream: snapshot)
        XCTAssertEqual(out.kind, .prose)
        XCTAssertEqual(out.body, "A steady week.")
    }

    func testFailedComposesHelixErrorPrefix() {
        let snapshot = DigestNarrationStreamSnapshot(state: .error, text: "", error: "stream_http_429")
        let out = output(stream: snapshot)
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("Helix error:"))
        XCTAssertTrue(out.body.contains("stream_http_429"))
    }

    func testFailedFallsBackToUnknownMessage() {
        let out = output(stream: DigestNarrationStreamSnapshot(state: .error, text: "", error: nil))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("unknown"))
    }
}

// MARK: - State holder: wiring, telemetry, freshness, gate, delegation

@MainActor final class DigestNarrationModelTests: XCTestCase {
    private func makeModel(
        _ input: DigestNarrationInput,
        telemetry: DigestNarrationTelemetry = OSLogDigestNarrationTelemetry()
    ) -> (DigestNarrationModel, InMemoryDigestNarrationSource) {
        let source = InMemoryDigestNarrationSource(initial: input)
        let model = DigestNarrationModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func enabled(
        vehicleID: Int? = 7,
        connection: DigestNarrationConnection = .live,
        stream: DigestNarrationStreamSnapshot = .idle
    ) -> DigestNarrationInput {
        DigestNarrationInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            connection: connection,
            stream: stream
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyDigestNarrationTelemetry()
        let (model, source) = makeModel(enabled(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(spy.surfaces, [AIDigestNarration.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpyDigestNarrationTelemetry()
        let (model, _) = makeModel(
            DigestNarrationInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertTrue(model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpyDigestNarrationTelemetry()
        let (model, source) = makeModel(
            DigestNarrationInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertEqual(spy.surfaces, [])
        source.push(enabled())
        XCTAssertFalse(model.isGated)
        XCTAssertEqual(spy.surfaces, [AIDigestNarration.surfaceSlug])
        // Staying presented must not re-emit.
        source.push(enabled(connection: .live))
        XCTAssertEqual(spy.surfaces, [AIDigestNarration.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(DigestNarrationInput(availability: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(enabled())
        XCTAssertEqual(model.phase, .ready)
    }

    func testStreamSnapshotFlowsIntoOutput() {
        let (model, source) = makeModel(enabled())
        model.start()
        let snapshot = DigestNarrationStreamSnapshot(state: .done, text: "A steady week.")
        source.push(enabled(stream: snapshot))
        XCTAssertEqual(model.ready?.output.kind, .prose)
        XCTAssertEqual(model.ready?.output.body, "A steady week.")
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
        XCTAssertEqual(AIDigestNarration.surfaceSlug, "AIDigestNarration")
    }
}

// MARK: - Accessibility summary

@MainActor final class DigestNarrationAccessibilityTests: XCTestCase {
    func testActionLabelJoinsAskAndContext() {
        XCTAssertEqual(
            DigestNarrationAccessibility.actionLabel(ask: "Ask Helix", context: "Generate narration"),
            "Ask Helix · Generate narration"
        )
    }

    func testOutputLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            DigestNarrationAccessibility.outputLabel("Helix narration", "A steady week."),
            "Helix narration: A steady week."
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyDigestNarrationTelemetry: DigestNarrationTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
