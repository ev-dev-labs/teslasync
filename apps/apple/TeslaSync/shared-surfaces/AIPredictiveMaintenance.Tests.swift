//
//  AIPredictiveMaintenance.Tests.swift
//  TeslaSync — P4 shared surface · 0039 · AIPredictiveMaintenance (Apple)
//
//  Unit coverage for the AIPredictiveMaintenance surface:
//    • Projection — gated / loading / error / ready, the `canStart = haveScope` rule (incl. the nil,
//      the id-0, and the negative out-of-scope boundaries — unlike the `!= null` range surface, 0 is
//      NOT a valid selection here), the `emptyHint` (web "Select a vehicle first." shown when
//      `!canStart`), the Ask-Helix label flip, the disabled rule, and every localized `AiOutputPanel`
//      branch (empty / no-vehicle / thinking / prose / error / unknown-error).
//    • State holder — `PredictiveMaintenanceModel` wiring, the P1/S11 `view.opened` telemetry
//      (deferred past the gate), the stale one-shot auto-refresh + re-arm, and the generate / cancel
//      / refresh / stop delegation.
//    • Accessibility — the VoiceOver action + output label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryPredictiveMaintenanceSource`, and the locale is injected for
//  determinism. In the test bundle the per-surface strings table is absent, so the i18n facade
//  returns the web English `value:` fallbacks, which these assertions check.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Projection: phases

@MainActor final class PredictiveMaintenanceProjectionPhaseTests: XCTestCase {
    func testGatedWhenFeatureDisabled() {
        let resolved = PredictiveMaintenanceProjection.resolve(
            PredictiveMaintenanceInput(availability: .resolved(enabled: false), vehicleID: 7),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertNil(resolved.ready)
    }

    func testLoadingWhenAvailabilityLoading() {
        let resolved = PredictiveMaintenanceProjection.resolve(
            PredictiveMaintenanceInput(availability: .loading),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.ready)
    }

    func testErrorWhenAvailabilityFailed() {
        let resolved = PredictiveMaintenanceProjection.resolve(
            PredictiveMaintenanceInput(availability: .failed("boom")),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.ready)
    }

    func testReadyWhenEnabled() {
        let resolved = PredictiveMaintenanceProjection.resolve(
            PredictiveMaintenanceInput(availability: .resolved(enabled: true), vehicleID: 7),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertNotNil(resolved.ready)
    }
}

// MARK: - Projection: ready card content

@MainActor final class PredictiveMaintenanceProjectionReadyTests: XCTestCase {
    private func ready(
        vehicleID: Int? = 7,
        stream: PredictiveMaintenanceStreamSnapshot = .idle
    ) -> PredictiveMaintenanceReady {
        let resolved = PredictiveMaintenanceProjection.resolve(
            PredictiveMaintenanceInput(
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
        XCTAssertEqual(card.title, "Helix maintenance advisor")
        XCTAssertEqual(card.badge, "Helix")
        XCTAssertEqual(card.buttonContext, "Predict maintenance")
        XCTAssertTrue(card.description.contains("maintenance envelope"))
        XCTAssertTrue(card.description.contains("redacted before"))
        XCTAssertTrue(card.description.contains("canonical raw view"))
    }

    func testDescriptionPreservesUnicodeGlyphs() {
        // Parity: the web copy uses the — em dash and the 3-6 sentence count.
        let card = ready()
        XCTAssertTrue(card.description.contains("3-6 sentence"))
        XCTAssertTrue(card.description.contains("—"))
    }

    func testCanStartRequiresPositiveVehicleID() {
        // Web `haveScope = … && vehicleId > 0`.
        XCTAssertTrue(ready(vehicleID: 7).canStart)
        XCTAssertFalse(ready(vehicleID: nil).canStart)
    }

    func testCanStartRejectsZeroAndNegativeVehicleID() {
        // Unlike the `vehicleId != null` range surface, 0 (and any negative) is OUT of scope here.
        XCTAssertFalse(ready(vehicleID: 0).canStart)
        XCTAssertFalse(ready(vehicleID: -3).canStart)
    }

    func testEmptyHintPresentOnlyWhenCannotStart() {
        // Web `emptyHint = haveScope ? undefined : t('…', 'Select a vehicle first.')`.
        XCTAssertEqual(ready(vehicleID: nil).emptyHint, "Select a vehicle first.")
        XCTAssertEqual(ready(vehicleID: 0).emptyHint, "Select a vehicle first.")
        XCTAssertNil(ready(vehicleID: 7).emptyHint)
    }

    func testActionLabelIsAskHelixWhenIdle() {
        let card = ready(stream: .idle)
        XCTAssertEqual(card.actionTitle, "Ask Helix")
        XCTAssertFalse(card.action.isStreaming)
    }

    func testActionLabelFlipsToThinkingWhileStreaming() {
        let card = ready(stream: PredictiveMaintenanceStreamSnapshot(state: .streaming))
        XCTAssertTrue(card.action.isStreaming)
        XCTAssertTrue(card.actionTitle.contains("thinking"))
    }

    func testActionDisabledWithoutVehicleOrWhileStreaming() {
        XCTAssertTrue(ready(vehicleID: nil, stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(vehicleID: 0, stream: .idle).action.isDisabled)
        XCTAssertTrue(
            ready(vehicleID: 7, stream: PredictiveMaintenanceStreamSnapshot(state: .streaming)).action.isDisabled
        )
        XCTAssertFalse(ready(vehicleID: 7, stream: .idle).action.isDisabled)
    }

    func testActionAccessibilityLabelJoinsAskAndContext() {
        XCTAssertEqual(ready().actionAccessibilityLabel, "Ask Helix · Predict maintenance")
    }
}

// MARK: - Projection: localized output branches

@MainActor final class PredictiveMaintenanceProjectionOutputTests: XCTestCase {
    private func output(
        vehicleID: Int? = 7,
        stream: PredictiveMaintenanceStreamSnapshot
    ) -> PredictiveMaintenanceResolvedOutput {
        PredictiveMaintenanceProjection.resolve(
            PredictiveMaintenanceInput(
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
        XCTAssertTrue(out.body.contains("No advisory yet"))
    }

    func testNoVehicleHintWhenIdleWithoutVehicle() {
        let out = output(vehicleID: nil, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Select a vehicle"))
    }

    func testNoVehicleHintWhenIdleWithZeroVehicle() {
        // 0 is out of scope → the output panel shows the no-vehicle hint, not the in-scope hint.
        let out = output(vehicleID: 0, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Select a vehicle"))
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        let out = output(stream: PredictiveMaintenanceStreamSnapshot(state: .streaming, text: ""))
        XCTAssertEqual(out.kind, .thinking)
        XCTAssertTrue(out.body.contains("thinking"))
    }

    func testProseOnceTextArrives() {
        let out = output(stream: PredictiveMaintenanceStreamSnapshot(state: .streaming, text: "Tire rotation due."))
        XCTAssertEqual(out.kind, .prose)
        XCTAssertEqual(out.body, "Tire rotation due.")
    }

    func testFailedComposesHelixErrorPrefix() {
        let out = output(stream: PredictiveMaintenanceStreamSnapshot(
            state: .error,
            text: "",
            error: "stream_http_429"
        ))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("Helix error:"))
        XCTAssertTrue(out.body.contains("stream_http_429"))
    }

    func testFailedFallsBackToUnknownMessage() {
        let out = output(stream: PredictiveMaintenanceStreamSnapshot(state: .error, text: "", error: nil))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("unknown"))
    }
}

// MARK: - State holder: wiring, telemetry, freshness, gate, delegation

@MainActor final class PredictiveMaintenanceModelTests: XCTestCase {
    private func makeModel(
        _ input: PredictiveMaintenanceInput,
        telemetry: PredictiveMaintenanceTelemetry = OSLogPredictiveMaintenanceTelemetry()
    ) -> (PredictiveMaintenanceModel, InMemoryPredictiveMaintenanceSource) {
        let source = InMemoryPredictiveMaintenanceSource(initial: input)
        let model = PredictiveMaintenanceModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func enabled(
        vehicleID: Int? = 7,
        connection: PredictiveMaintenanceConnection = .live,
        stream: PredictiveMaintenanceStreamSnapshot = .idle
    ) -> PredictiveMaintenanceInput {
        PredictiveMaintenanceInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            connection: connection,
            stream: stream
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyPredictiveMaintenanceTelemetry()
        let (model, source) = makeModel(enabled(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(spy.surfaces, [AIPredictiveMaintenance.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpyPredictiveMaintenanceTelemetry()
        let (model, _) = makeModel(
            PredictiveMaintenanceInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertTrue(model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpyPredictiveMaintenanceTelemetry()
        let (model, source) = makeModel(
            PredictiveMaintenanceInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertEqual(spy.surfaces, [])
        source.push(enabled())
        XCTAssertFalse(model.isGated)
        XCTAssertEqual(spy.surfaces, [AIPredictiveMaintenance.surfaceSlug])
        // Staying presented must not re-emit.
        source.push(enabled(connection: .live))
        XCTAssertEqual(spy.surfaces, [AIPredictiveMaintenance.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(PredictiveMaintenanceInput(availability: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(enabled())
        XCTAssertEqual(model.phase, .ready)
    }

    func testStreamSnapshotFlowsIntoOutput() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(stream: PredictiveMaintenanceStreamSnapshot(state: .done, text: "Tire rotation due.")))
        XCTAssertEqual(model.ready?.output.kind, .prose)
        XCTAssertEqual(model.ready?.output.body, "Tire rotation due.")
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
        XCTAssertEqual(AIPredictiveMaintenance.surfaceSlug, "AIPredictiveMaintenance")
    }
}

// MARK: - Accessibility summary

@MainActor final class PredictiveMaintenanceAccessibilityTests: XCTestCase {
    func testActionLabelJoinsAskAndContext() {
        XCTAssertEqual(
            PredictiveMaintenanceAccessibility.actionLabel(ask: "Ask Helix", context: "Predict maintenance"),
            "Ask Helix · Predict maintenance"
        )
    }

    func testOutputLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            PredictiveMaintenanceAccessibility.outputLabel("Maintenance advisory", "Tire rotation due."),
            "Maintenance advisory: Tire rotation due."
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyPredictiveMaintenanceTelemetry: PredictiveMaintenanceTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
