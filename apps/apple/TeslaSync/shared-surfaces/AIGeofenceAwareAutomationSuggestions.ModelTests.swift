//
//  AIGeofenceAwareAutomationSuggestions.ModelTests.swift
//  TeslaSync — P4 shared surface · 0020 · AIGeofenceAwareAutomationSuggestions (Apple)
//
//  State-holder coverage split out of `…Tests.swift` (one file ≤ 400 lines per the
//  SwiftLint contract): `GeofenceAutomationModel` wiring — the gate render axis, the P1/S11
//  `view.opened` telemetry, the prompt-driven canStart, the suggest double-submit guard +
//  body forwarding, the draft capture, the ok-only apply forwarding, the vehicle-change
//  reset (prompt preserved), and the stale auto-refresh. Driven entirely by
//  `InMemoryGeofenceAutomationSource`; no network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: wiring, telemetry, actions, freshness

@MainActor final class GeofenceAutomationModelTests: XCTestCase {
    private func makeModel(
        _ input: GeofenceAutomationInputSnapshot,
        prompt: String = "",
        telemetry: GeofenceAutomationTelemetry = OSLogGeofenceAutomationTelemetry(),
        onApply: @escaping @MainActor (GeofenceAutomationInput) -> Void = { _ in }
    ) -> (GeofenceAutomationModel, InMemoryGeofenceAutomationSource) {
        let source = InMemoryGeofenceAutomationSource(initial: input)
        let model = GeofenceAutomationModel(source: source, telemetry: telemetry, onApply: onApply)
        model.prompt = prompt
        return (model, source)
    }

    private var readyInput: GeofenceAutomationInputSnapshot {
        GeofenceAutomationInputSnapshot(gate: .on, vehicleID: 42)
    }

    func testStartEmitsTelemetryOnceAndAppliesInitial() {
        let spy = SpyGeofenceAutomationTelemetry()
        let (model, source) = makeModel(readyInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.renderState, .ready)
        XCTAssertEqual(model.vehicleID, 42)
        XCTAssertEqual(spy.surfaces, [GeofenceAutomationSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGateRenderAxis() {
        let (loading, _) = makeModel(GeofenceAutomationInputSnapshot(gate: .loading, vehicleID: 1))
        loading.start()
        XCTAssertEqual(loading.renderState, .gateLoading)

        let (off, _) = makeModel(GeofenceAutomationInputSnapshot(gate: .off, vehicleID: 1))
        off.start()
        XCTAssertEqual(off.renderState, .gatedOff)

        let (errored, _) = makeModel(
            GeofenceAutomationInputSnapshot(gate: .loading, vehicleID: 1, errorMessage: "boom")
        )
        errored.start()
        XCTAssertEqual(errored.renderState, .gateError("boom"))

        let (ready, _) = makeModel(readyInput)
        ready.start()
        XCTAssertEqual(ready.renderState, .ready)
    }

    func testGatedOffWinsOverError() {
        let (model, _) = makeModel(
            GeofenceAutomationInputSnapshot(gate: .off, vehicleID: 1, errorMessage: "ignored")
        )
        model.start()
        XCTAssertEqual(model.renderState, .gatedOff)
    }

    func testPromptDrivesCanStart() {
        let (model, _) = makeModel(readyInput)
        model.start()
        XCTAssertFalse(model.canStart)
        XCTAssertEqual(model.emptyHint, .describeAutomation)
        model.prompt = "When I get home, precondition the cabin"
        XCTAssertTrue(model.canStart)
        XCTAssertNil(model.emptyHint)
        XCTAssertFalse(model.buttonDisabled)
    }

    func testNoVehicleHintTakesPriority() {
        let (model, _) = makeModel(GeofenceAutomationInputSnapshot(gate: .on, vehicleID: 0), prompt: "go")
        model.start()
        XCTAssertEqual(model.emptyHint, .selectVehicle)
        XCTAssertFalse(model.canStart)
    }

    func testSuggestStartsStreamWithBodyAndClearsPriorDraft() {
        let (model, source) = makeModel(readyInput, prompt: "Precondition at Home")
        model.start()
        source.pushDraft(name: "Old", vehicleID: 42, status: "ok")
        XCTAssertNotNil(model.draft)
        model.suggest()
        XCTAssertNil(model.draft)
        XCTAssertEqual(model.streamText, "")
        XCTAssertEqual(source.startStreamCount, 1)
        XCTAssertEqual(source.lastStreamVehicleID, 42)
        XCTAssertEqual(source.lastStreamPrompt, "Precondition at Home")
        XCTAssertEqual(model.phase, .streaming)
    }

    func testSuggestIsNoOpWhileBusy() {
        let (model, source) = makeModel(readyInput, prompt: "go")
        model.start()
        source.pushStreamState(.streaming)
        model.suggest()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testToolResultCapturesDraft() {
        let (model, source) = makeModel(readyInput, prompt: "go")
        model.start()
        source.pushDraft(
            name: "Home overheat guard", description: "Guards cabin", vehicleID: 42,
            triggers: 1, conditions: 2, actions: 1, status: "ok"
        )
        XCTAssertEqual(model.draft?.input.name, "Home overheat guard")
        XCTAssertEqual(model.draft?.input.conditions.count, 2)
        XCTAssertEqual(model.draft?.isOK, true)
        XCTAssertEqual(model.phase, .done)
    }

    func testApplyForwardsOnlyOKProposalGraph() {
        let recorder = ApplyRecorder()
        let (model, source) = makeModel(readyInput, prompt: "go", onApply: { recorder.inputs.append($0) })
        model.start()

        // Rejected → not forwarded.
        source.pushDraft(name: "Bad", vehicleID: 42, status: "invalid")
        model.apply()
        XCTAssertTrue(recorder.inputs.isEmpty)

        // OK → the full graph is forwarded.
        source.pushDraft(name: "Good", vehicleID: 42, triggers: 2, conditions: 0, actions: 1, status: "ok")
        model.apply()
        XCTAssertEqual(recorder.inputs.count, 1)
        XCTAssertEqual(recorder.inputs.first?.name, "Good")
        XCTAssertEqual(recorder.inputs.first?.triggers.count, 2)
        XCTAssertEqual(recorder.inputs.first?.actions.count, 1)
    }

    func testApplyWithoutDraftIsNoOp() {
        let recorder = ApplyRecorder()
        let (model, _) = makeModel(readyInput, prompt: "go", onApply: { recorder.inputs.append($0) })
        model.start()
        model.apply()
        XCTAssertTrue(recorder.inputs.isEmpty)
    }

    func testVehicleChangeCancelsResetsDraftButKeepsPrompt() {
        let (model, source) = makeModel(readyInput, prompt: "keep me")
        model.start()
        source.pushDraft(name: "Cafe", vehicleID: 42, status: "ok")
        XCTAssertNotNil(model.draft)

        source.pushInput(GeofenceAutomationInputSnapshot(gate: .on, vehicleID: 99))
        XCTAssertEqual(source.cancelStreamCount, 1)
        XCTAssertNil(model.draft)
        XCTAssertEqual(model.streamText, "")
        XCTAssertEqual(model.phase, .idle)
        XCTAssertEqual(model.vehicleID, 99)
        XCTAssertEqual(model.prompt, "keep me")
    }

    func testFirstSnapshotDoesNotCancel() {
        let (model, source) = makeModel(readyInput)
        model.start()
        XCTAssertEqual(source.cancelStreamCount, 0)
        XCTAssertEqual(model.vehicleID, 42)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(readyInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.pushInput(GeofenceAutomationInputSnapshot(gate: .on, vehicleID: 42, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.pushInput(GeofenceAutomationInputSnapshot(gate: .on, vehicleID: 42, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefreshAndDisablesButton() {
        let (model, source) = makeModel(readyInput, prompt: "go")
        model.start()
        source.pushInput(GeofenceAutomationInputSnapshot(gate: .on, vehicleID: 42, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
        XCTAssertTrue(model.buttonDisabled)
    }

    func testDeltaAccumulatesStreamText() {
        let (model, source) = makeModel(readyInput, prompt: "go")
        model.start()
        source.pushStreamState(.streaming)
        source.pushEvent(.delta(text: "Drafting "))
        source.pushEvent(.delta(text: "graph…"))
        XCTAssertEqual(model.streamText, "Drafting graph…")
        XCTAssertTrue(model.outputVisible)
    }

    func testPhaseDrivesBusyAndThinking() {
        let (model, source) = makeModel(readyInput, prompt: "go")
        model.start()
        XCTAssertFalse(model.buttonDisabled)
        source.pushStreamState(.streaming)
        XCTAssertTrue(model.isBusy)
        XCTAssertTrue(model.buttonDisabled)
        XCTAssertTrue(model.thinkingVisible)
    }

    func testCancelDelegatesToSource() {
        let (model, source) = makeModel(readyInput)
        model.start()
        model.cancel()
        XCTAssertEqual(source.cancelStreamCount, 1)
    }

    func testRefreshClearsGateErrorAndDelegates() {
        let (model, source) = makeModel(
            GeofenceAutomationInputSnapshot(gate: .loading, vehicleID: 1, errorMessage: "down")
        )
        model.start()
        XCTAssertEqual(model.renderState, .gateError("down"))
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertNotEqual(model.renderState, .gateError("down"))
    }

    func testStopCancelsStreamAndReArms() {
        let (model, source) = makeModel(readyInput)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(source.cancelStreamCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceConstants() {
        // The View's public `surfaceSlug` / `featureID` are aliases of these non-UI
        // constants (verified compiling by the dual-SDK typecheck); assert the source of
        // truth here so the check also runs in the SwiftUI-free harness.
        XCTAssertEqual(GeofenceAutomationSurface.slug, "AIGeofenceAwareAutomationSuggestions")
        XCTAssertEqual(GeofenceAutomationSurface.featureID, "geofence-aware-automation-suggestions")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyGeofenceAutomationTelemetry: GeofenceAutomationTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// Records the automation graphs forwarded to the parent `onApply` callback.
@MainActor private final class ApplyRecorder {
    var inputs: [GeofenceAutomationInput] = []
}
