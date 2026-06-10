//
//  AISignalExplorerNlFilter.ModelTests.swift
//  TeslaSync — P4 shared surface · 0046 · AISignalExplorerNlFilter (Apple)
//
//  State-holder coverage split out of `…Tests.swift` (one file ≤ 400 lines per the SwiftLint
//  contract): `SignalExplorerFilterModel` wiring — the gate render axis, the P1/S11 `view.opened`
//  telemetry, the prompt-driven canStart, the draftFilter double-submit guard + body forwarding, the
//  draft capture, the not-streaming-only apply forwarding, the vehicle-change NO-reset (faithful to
//  the web's absent cleanup effect), and the stale auto-refresh. Driven entirely by
//  `InMemorySignalExplorerFilterSource`; no network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: wiring, telemetry, actions, freshness

@MainActor final class SignalExplorerFilterModelTests: XCTestCase {
    private func makeModel(
        _ input: SignalExplorerFilterInputSnapshot,
        prompt: String = "",
        telemetry: SignalExplorerFilterTelemetry = OSLogSignalExplorerFilterTelemetry(),
        onApply: @escaping @MainActor (SignalExplorerFilterDraft) -> Void = { _ in }
    ) -> (SignalExplorerFilterModel, InMemorySignalExplorerFilterSource) {
        let source = InMemorySignalExplorerFilterSource(initial: input)
        let model = SignalExplorerFilterModel(source: source, telemetry: telemetry, onApply: onApply)
        model.prompt = prompt
        return (model, source)
    }

    private var readyInput: SignalExplorerFilterInputSnapshot {
        SignalExplorerFilterInputSnapshot(gate: .on, vehicleID: 42)
    }

    func testStartEmitsTelemetryOnceAndAppliesInitial() {
        let spy = SpySignalExplorerFilterTelemetry()
        let (model, source) = makeModel(readyInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.renderState, .ready)
        XCTAssertEqual(model.vehicleID, 42)
        XCTAssertEqual(spy.surfaces, [SignalExplorerFilterSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGateRenderAxis() {
        let (loading, _) = makeModel(SignalExplorerFilterInputSnapshot(gate: .loading, vehicleID: 1))
        loading.start()
        XCTAssertEqual(loading.renderState, .gateLoading)

        let (off, _) = makeModel(SignalExplorerFilterInputSnapshot(gate: .off, vehicleID: 1))
        off.start()
        XCTAssertEqual(off.renderState, .gatedOff)

        let (errored, _) = makeModel(
            SignalExplorerFilterInputSnapshot(gate: .loading, vehicleID: 1, errorMessage: "boom")
        )
        errored.start()
        XCTAssertEqual(errored.renderState, .gateError("boom"))

        let (ready, _) = makeModel(readyInput)
        ready.start()
        XCTAssertEqual(ready.renderState, .ready)
    }

    func testGatedOffWinsOverError() {
        let (model, _) = makeModel(
            SignalExplorerFilterInputSnapshot(gate: .off, vehicleID: 1, errorMessage: "ignored")
        )
        model.start()
        XCTAssertEqual(model.renderState, .gatedOff)
    }

    func testPromptDrivesCanStart() {
        let (model, _) = makeModel(readyInput)
        model.start()
        XCTAssertFalse(model.canStart)
        XCTAssertEqual(model.emptyHint, .describeFilter)
        model.prompt = "battery level for yesterday"
        XCTAssertTrue(model.canStart)
        XCTAssertNil(model.emptyHint)
        XCTAssertFalse(model.buttonDisabled)
    }

    func testNoVehicleHintTakesPriority() {
        let (model, _) = makeModel(SignalExplorerFilterInputSnapshot(gate: .on, vehicleID: 0), prompt: "go")
        model.start()
        XCTAssertEqual(model.emptyHint, .selectVehicle)
        XCTAssertFalse(model.canStart)
    }

    func testDraftFilterStartsStreamWithBodyAndClearsPriorDraft() {
        let (model, source) = makeModel(readyInput, prompt: "battery for yesterday")
        model.start()
        source.pushDraft(vehicleID: 42, signals: ["battery_level"], rangePreset: "24h", perPage: 50)
        XCTAssertNotNil(model.draft)
        model.draftFilter()
        XCTAssertNil(model.draft)
        XCTAssertEqual(model.streamText, "")
        XCTAssertEqual(source.startStreamCount, 1)
        XCTAssertEqual(source.lastStreamVehicleID, 42)
        XCTAssertEqual(source.lastStreamPrompt, "battery for yesterday")
        XCTAssertEqual(model.phase, .streaming)
    }

    func testDraftFilterIsNoOpWhileStreaming() {
        let (model, source) = makeModel(readyInput, prompt: "go")
        model.start()
        source.pushStreamState(.streaming)
        model.draftFilter()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testDraftFilterIsNoOpWhenCannotStart() {
        // No prompt → canStart false → handleDraft is a guarded no-op.
        let (noPrompt, noPromptSource) = makeModel(readyInput, prompt: "   ")
        noPrompt.start()
        noPrompt.draftFilter()
        XCTAssertEqual(noPromptSource.startStreamCount, 0)

        // No vehicle → canStart false → guarded no-op.
        let (noVehicle, noVehicleSource) = makeModel(
            SignalExplorerFilterInputSnapshot(gate: .on, vehicleID: 0), prompt: "go"
        )
        noVehicle.start()
        noVehicle.draftFilter()
        XCTAssertEqual(noVehicleSource.startStreamCount, 0)
    }

    func testToolResultCapturesDraft() {
        let (model, source) = makeModel(readyInput, prompt: "go")
        model.start()
        source.pushDraft(
            vehicleID: 42, signals: ["battery_level", "inside_temp"], rangePreset: "7d", perPage: 100
        )
        XCTAssertEqual(model.draft?.signals, ["battery_level", "inside_temp"])
        XCTAssertEqual(model.draft?.rangePreset, "7d")
        XCTAssertEqual(model.draft?.perPage, 100)
        XCTAssertEqual(model.phase, .done)
        XCTAssertTrue(model.canApply)
    }

    func testNonOKToolResultIsDropped() {
        let (model, source) = makeModel(readyInput, prompt: "go")
        model.start()
        source.pushDraft(vehicleID: 42, signals: [], rangePreset: "24h", perPage: 50, status: "invalid")
        XCTAssertNil(model.draft)
    }

    func testApplyForwardsDraftWhenNotStreaming() {
        let recorder = ApplyRecorder()
        let (model, source) = makeModel(readyInput, prompt: "go", onApply: { recorder.drafts.append($0) })
        model.start()
        source.pushDraft(vehicleID: 42, signals: ["battery_level"], rangePreset: "24h", perPage: 25)
        model.apply()
        XCTAssertEqual(recorder.drafts.count, 1)
        XCTAssertEqual(recorder.drafts.first?.signals, ["battery_level"])
        XCTAssertEqual(recorder.drafts.first?.perPage, 25)
    }

    func testApplyIsNoOpWhileStreaming() {
        let recorder = ApplyRecorder()
        let (model, source) = makeModel(readyInput, prompt: "go", onApply: { recorder.drafts.append($0) })
        model.start()
        source.pushDraft(vehicleID: 42, signals: ["battery_level"], rangePreset: "24h", perPage: 25)
        source.pushStreamState(.streaming)
        model.apply()
        XCTAssertTrue(recorder.drafts.isEmpty)
    }

    func testApplyWithoutDraftIsNoOp() {
        let recorder = ApplyRecorder()
        let (model, _) = makeModel(readyInput, prompt: "go", onApply: { recorder.drafts.append($0) })
        model.start()
        model.apply()
        XCTAssertTrue(recorder.drafts.isEmpty)
    }

    func testVehicleChangeKeepsDraftAndPrompt() {
        // Web fidelity: AISignalExplorerNlFilter has no cleanup effect, so a vehicle change does NOT
        // cancel the stream or clear the captured draft (unlike the geofence sibling).
        let (model, source) = makeModel(readyInput, prompt: "keep me")
        model.start()
        source.pushDraft(vehicleID: 42, signals: ["battery_level"], rangePreset: "24h", perPage: 50)
        XCTAssertNotNil(model.draft)

        source.pushInput(SignalExplorerFilterInputSnapshot(gate: .on, vehicleID: 99))
        XCTAssertEqual(source.cancelStreamCount, 0)
        XCTAssertNotNil(model.draft)
        XCTAssertEqual(model.vehicleID, 99)
        XCTAssertEqual(model.prompt, "keep me")
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(readyInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.pushInput(SignalExplorerFilterInputSnapshot(gate: .on, vehicleID: 42, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.pushInput(SignalExplorerFilterInputSnapshot(gate: .on, vehicleID: 42, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefreshAndDisablesButton() {
        let (model, source) = makeModel(readyInput, prompt: "go")
        model.start()
        source.pushInput(SignalExplorerFilterInputSnapshot(gate: .on, vehicleID: 42, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
        XCTAssertTrue(model.buttonDisabled)
    }

    func testDeltaAccumulatesStreamText() {
        let (model, source) = makeModel(readyInput, prompt: "go")
        model.start()
        source.pushStreamState(.streaming)
        source.pushEvent(.delta(text: "Drafting "))
        source.pushEvent(.delta(text: "filter…"))
        XCTAssertEqual(model.streamText, "Drafting filter…")
        XCTAssertTrue(model.outputVisible)
    }

    func testPhaseDrivesStreamingAndThinking() {
        let (model, source) = makeModel(readyInput, prompt: "go")
        model.start()
        XCTAssertFalse(model.buttonDisabled)
        source.pushStreamState(.streaming)
        XCTAssertTrue(model.isStreaming)
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
            SignalExplorerFilterInputSnapshot(gate: .loading, vehicleID: 1, errorMessage: "down")
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
        XCTAssertEqual(SignalExplorerFilterSurface.slug, "AISignalExplorerNlFilter")
        XCTAssertEqual(SignalExplorerFilterSurface.featureID, "signal-explorer-nl-filter")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySignalExplorerFilterTelemetry: SignalExplorerFilterTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// Records the filters forwarded to the parent `onApply` callback.
@MainActor private final class ApplyRecorder {
    var drafts: [SignalExplorerFilterDraft] = []
}
