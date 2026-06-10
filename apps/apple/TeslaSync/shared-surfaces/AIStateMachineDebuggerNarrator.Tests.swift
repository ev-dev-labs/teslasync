//
//  AIStateMachineDebuggerNarrator.Tests.swift
//  TeslaSync — P4 shared surface · 0050 · AIStateMachineDebuggerNarrator (Apple)
//
//  Unit coverage for the AIStateMachineDebuggerNarrator surface: the projection (gated / loading /
//  error / ready, the `canStart = haveScope` rule across the scope-triple boundaries, the header
//  `emptyHint`, the Ask-Helix label flip + disabled rule, and every localized `AiOutputPanel`
//  branch), the state holder (wiring, deferred `view.opened` telemetry, stale one-shot auto-refresh,
//  and the narrate / cancel / refresh / stop delegation), and the accessibility labels. No network,
//  no real store: the model is driven by `InMemoryFSMNarratorSource` with an injected locale.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// A valid in-scope triple: a positive vehicle plus a positive ordered window.
private let scopeVehicle = 7
private let scopeFrom = 1000
private let scopeTo = 2000

// MARK: - Projection: phases

@MainActor final class FSMNarratorProjectionPhaseTests: XCTestCase {
    func testGatedWhenFeatureDisabled() {
        let resolved = FSMNarratorProjection.resolve(
            FSMNarratorInput(
                availability: .resolved(enabled: false),
                vehicleID: scopeVehicle,
                fromUnix: scopeFrom,
                toUnix: scopeTo
            ),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertNil(resolved.ready)
    }

    func testLoadingWhenAvailabilityLoading() {
        let resolved = FSMNarratorProjection.resolve(
            FSMNarratorInput(availability: .loading),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.ready)
    }

    func testErrorWhenAvailabilityFailed() {
        let resolved = FSMNarratorProjection.resolve(
            FSMNarratorInput(availability: .failed("boom")),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.ready)
    }

    func testReadyWhenEnabled() {
        let resolved = FSMNarratorProjection.resolve(
            FSMNarratorInput(
                availability: .resolved(enabled: true),
                vehicleID: scopeVehicle,
                fromUnix: scopeFrom,
                toUnix: scopeTo
            ),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertNotNil(resolved.ready)
    }
}

// MARK: - Projection: ready card content

@MainActor final class FSMNarratorProjectionReadyTests: XCTestCase {
    private func ready(
        vehicleID: Int? = scopeVehicle,
        fromUnix: Int? = scopeFrom,
        toUnix: Int? = scopeTo,
        stream: FSMNarratorStreamSnapshot = .idle
    ) -> FSMNarratorReady {
        let resolved = FSMNarratorProjection.resolve(
            FSMNarratorInput(
                availability: .resolved(enabled: true),
                vehicleID: vehicleID,
                fromUnix: fromUnix,
                toUnix: toUnix,
                stream: stream
            ),
            locale: enUS
        )
        return resolved.ready!
    }

    func testTitleDescriptionBadgeAreParityStrings() {
        let card = ready()
        XCTAssertEqual(card.title, "Helix FSM narrator")
        XCTAssertEqual(card.badge, "Helix")
        XCTAssertTrue(card.description.contains("3-6 sentence factual narration"))
        XCTAssertTrue(card.description.contains("deterministic FSM envelope"))
        XCTAssertTrue(card.description.contains("redacted before the message reaches the provider"))
        XCTAssertEqual(card.buttonContext, "Narrate transitions")
    }

    func testCanStartRequiresValidScope() {
        // Web `haveScope = vehicleId > 0 && fromUnix > 0 && toUnix > fromUnix`.
        XCTAssertTrue(ready(vehicleID: scopeVehicle, fromUnix: scopeFrom, toUnix: scopeTo).canStart)
        XCTAssertTrue(ready(vehicleID: 1, fromUnix: 1, toUnix: 2).canStart)
        XCTAssertFalse(ready(vehicleID: nil, fromUnix: scopeFrom, toUnix: scopeTo).canStart)
        XCTAssertFalse(ready(vehicleID: 0, fromUnix: scopeFrom, toUnix: scopeTo).canStart)
        XCTAssertFalse(ready(vehicleID: -3, fromUnix: scopeFrom, toUnix: scopeTo).canStart)
        XCTAssertFalse(ready(vehicleID: scopeVehicle, fromUnix: nil, toUnix: scopeTo).canStart)
        XCTAssertFalse(ready(vehicleID: scopeVehicle, fromUnix: 0, toUnix: scopeTo).canStart)
        XCTAssertFalse(ready(vehicleID: scopeVehicle, fromUnix: scopeFrom, toUnix: nil).canStart)
        XCTAssertFalse(ready(vehicleID: scopeVehicle, fromUnix: scopeTo, toUnix: scopeFrom).canStart)
        XCTAssertFalse(ready(vehicleID: scopeVehicle, fromUnix: scopeFrom, toUnix: scopeFrom).canStart)
    }

    func testScopeHintShownOnlyWhenNoValidScope() {
        // Web `emptyHint={haveScope ? undefined : t('…emptyHint', 'Select a vehicle and a valid time
        // window first.')}`.
        XCTAssertNil(ready(vehicleID: scopeVehicle, fromUnix: scopeFrom, toUnix: scopeTo).scopeHint)
        XCTAssertEqual(
            ready(vehicleID: nil, fromUnix: nil, toUnix: nil).scopeHint,
            "Select a vehicle and a valid time window first."
        )
        XCTAssertEqual(
            ready(vehicleID: scopeVehicle, fromUnix: scopeTo, toUnix: scopeFrom).scopeHint,
            "Select a vehicle and a valid time window first."
        )
    }

    func testActionLabelIsAskHelixWhenIdle() {
        let card = ready(stream: .idle)
        XCTAssertEqual(card.actionTitle, "Ask Helix")
        XCTAssertFalse(card.action.isStreaming)
    }

    func testActionLabelFlipsToThinkingWhileStreaming() {
        let card = ready(stream: FSMNarratorStreamSnapshot(state: .streaming))
        XCTAssertTrue(card.action.isStreaming)
        XCTAssertTrue(card.actionTitle.contains("thinking"))
    }

    func testActionDisabledWithoutScopeOrWhileStreaming() {
        XCTAssertTrue(ready(vehicleID: nil, fromUnix: nil, toUnix: nil, stream: .idle).action.isDisabled)
        XCTAssertTrue(ready(vehicleID: 0, fromUnix: scopeFrom, toUnix: scopeTo, stream: .idle).action.isDisabled)
        XCTAssertTrue(
            ready(stream: FSMNarratorStreamSnapshot(state: .streaming)).action.isDisabled
        )
        XCTAssertFalse(ready(stream: .idle).action.isDisabled)
    }

    func testActionAccessibilityLabelJoinsAskAndContext() {
        XCTAssertEqual(ready().actionAccessibilityLabel, "Ask Helix · Narrate transitions")
    }
}

// MARK: - Projection: localized output branches

@MainActor final class FSMNarratorProjectionOutputTests: XCTestCase {
    private func output(
        vehicleID: Int? = scopeVehicle,
        fromUnix: Int? = scopeFrom,
        toUnix: Int? = scopeTo,
        stream: FSMNarratorStreamSnapshot
    ) -> FSMNarratorResolvedOutput {
        FSMNarratorProjection.resolve(
            FSMNarratorInput(
                availability: .resolved(enabled: true),
                vehicleID: vehicleID,
                fromUnix: fromUnix,
                toUnix: toUnix,
                stream: stream
            ),
            locale: enUS
        ).ready!.output
    }

    func testEmptyHintWhenIdleWithScope() {
        let out = output(stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("No narration yet"))
    }

    func testNoScopeHintWhenIdleWithoutScope() {
        let out = output(vehicleID: nil, fromUnix: nil, toUnix: nil, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Select a vehicle and a valid time window"))
    }

    func testNoScopeHintWhenVehicleMissing() {
        // canStart is false when the vehicle is absent even with a valid window → the no-scope hint.
        let out = output(vehicleID: nil, fromUnix: scopeFrom, toUnix: scopeTo, stream: .idle)
        XCTAssertEqual(out.kind, .empty)
        XCTAssertTrue(out.body.contains("Select a vehicle and a valid time window"))
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        let out = output(stream: FSMNarratorStreamSnapshot(state: .streaming, text: ""))
        XCTAssertEqual(out.kind, .thinking)
        XCTAssertTrue(out.body.contains("thinking"))
    }

    func testProseOnceTextArrives() {
        let out = output(stream: FSMNarratorStreamSnapshot(state: .streaming, text: "Eighteen transitions, no flaps."))
        XCTAssertEqual(out.kind, .prose)
        XCTAssertEqual(out.body, "Eighteen transitions, no flaps.")
    }

    func testFailedComposesHelixErrorPrefix() {
        let out = output(stream: FSMNarratorStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("Helix error:"))
        XCTAssertTrue(out.body.contains("stream_http_429"))
    }

    func testFailedFallsBackToUnknownMessage() {
        let out = output(stream: FSMNarratorStreamSnapshot(state: .error, text: "", error: nil))
        XCTAssertEqual(out.kind, .failed)
        XCTAssertTrue(out.body.contains("unknown"))
    }
}

// MARK: - State holder: wiring, telemetry, freshness, gate, delegation

@MainActor final class FSMNarratorModelTests: XCTestCase {
    private func makeModel(
        _ input: FSMNarratorInput,
        telemetry: FSMNarratorTelemetry = OSLogFSMNarratorTelemetry()
    ) -> (FSMNarratorModel, InMemoryFSMNarratorSource) {
        let source = InMemoryFSMNarratorSource(initial: input)
        let model = FSMNarratorModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func enabled(
        vehicleID: Int? = scopeVehicle,
        fromUnix: Int? = scopeFrom,
        toUnix: Int? = scopeTo,
        connection: FSMNarratorConnection = .live,
        stream: FSMNarratorStreamSnapshot = .idle
    ) -> FSMNarratorInput {
        FSMNarratorInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            fromUnix: fromUnix,
            toUnix: toUnix,
            connection: connection,
            stream: stream
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyFSMNarratorTelemetry()
        let (model, source) = makeModel(enabled(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(spy.surfaces, [AIStateMachineDebuggerNarrator.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpyFSMNarratorTelemetry()
        let (model, _) = makeModel(
            FSMNarratorInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertTrue(model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpyFSMNarratorTelemetry()
        let (model, source) = makeModel(
            FSMNarratorInput(availability: .resolved(enabled: false)),
            telemetry: spy
        )
        model.start()
        XCTAssertEqual(spy.surfaces, [])
        source.push(enabled())
        XCTAssertFalse(model.isGated)
        XCTAssertEqual(spy.surfaces, [AIStateMachineDebuggerNarrator.surfaceSlug])
        // Staying presented must not re-emit.
        source.push(enabled(connection: .live))
        XCTAssertEqual(spy.surfaces, [AIStateMachineDebuggerNarrator.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(FSMNarratorInput(availability: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(enabled())
        XCTAssertEqual(model.phase, .ready)
    }

    func testStreamSnapshotFlowsIntoOutput() {
        let (model, source) = makeModel(enabled())
        model.start()
        source.push(enabled(stream: FSMNarratorStreamSnapshot(state: .done, text: "No flaps.")))
        XCTAssertEqual(model.ready?.output.kind, .prose)
        XCTAssertEqual(model.ready?.output.body, "No flaps.")
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

    func testNarrateDelegatesToSource() {
        let (model, source) = makeModel(enabled())
        model.start()
        model.narrate()
        XCTAssertEqual(source.narrateCount, 1)
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
        XCTAssertEqual(AIStateMachineDebuggerNarrator.surfaceSlug, "AIStateMachineDebuggerNarrator")
    }
}

// MARK: - Accessibility summary

@MainActor final class FSMNarratorAccessibilityTests: XCTestCase {
    func testActionLabelJoinsAskAndContext() {
        XCTAssertEqual(
            FSMNarratorAccessibility.actionLabel(ask: "Ask Helix", context: "Narrate transitions"),
            "Ask Helix · Narrate transitions"
        )
    }

    func testOutputLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            FSMNarratorAccessibility.outputLabel("FSM transition narration", "No flaps."),
            "FSM transition narration: No flaps."
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyFSMNarratorTelemetry: FSMNarratorTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
