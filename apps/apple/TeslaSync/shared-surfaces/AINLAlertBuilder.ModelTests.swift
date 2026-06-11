//
//  AINLAlertBuilder.ModelTests.swift
//  TeslaSync — P4 shared surface · 0029 · AINLAlertBuilder (Apple)
//
//  State-holder coverage split out of `…Tests.swift` (one file ≤ 400 lines per the SwiftLint
//  contract): `NLAlertBuilderModel` wiring — the gate render axis, the P1/S11 `view.opened`
//  telemetry, the prompt-driven canStart, the draft double-submit guard + body forwarding (incl.
//  the `vehicleId ?? 0` fallback), the delta text accumulation, the web-faithful absence of a
//  vehicle-change cleanup, and the stale auto-refresh. Driven entirely by
//  `InMemoryNLAlertBuilderSource`; no network, no real store.
//

import XCTest
@testable import TeslaSync

@MainActor final class NLAlertBuilderModelTests: XCTestCase {
    private func makeModel(
        _ input: NLAlertBuilderInputSnapshot,
        prompt: String = "",
        telemetry: NLAlertBuilderTelemetry = OSLogNLAlertBuilderTelemetry()
    ) -> (NLAlertBuilderModel, InMemoryNLAlertBuilderSource) {
        let source = InMemoryNLAlertBuilderSource(initial: input)
        let model = NLAlertBuilderModel(source: source, telemetry: telemetry)
        model.prompt = prompt
        return (model, source)
    }

    private var readyInput: NLAlertBuilderInputSnapshot {
        NLAlertBuilderInputSnapshot(gate: .on, vehicleID: 42)
    }

    func testStartEmitsTelemetryOnceAndAppliesInitial() {
        let spy = SpyNLAlertBuilderTelemetry()
        let (model, source) = makeModel(readyInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.renderState, .ready)
        XCTAssertEqual(model.vehicleID, 42)
        XCTAssertEqual(spy.surfaces, [NLAlertBuilderSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGateRenderAxis() {
        let (loading, _) = makeModel(NLAlertBuilderInputSnapshot(gate: .loading, vehicleID: 1))
        loading.start()
        XCTAssertEqual(loading.renderState, .gateLoading)

        let (off, _) = makeModel(NLAlertBuilderInputSnapshot(gate: .off, vehicleID: 1))
        off.start()
        XCTAssertEqual(off.renderState, .gatedOff)

        let (errored, _) = makeModel(
            NLAlertBuilderInputSnapshot(gate: .loading, vehicleID: 1, errorMessage: "boom")
        )
        errored.start()
        XCTAssertEqual(errored.renderState, .gateError("boom"))

        let (ready, _) = makeModel(readyInput)
        ready.start()
        XCTAssertEqual(ready.renderState, .ready)
    }

    func testGatedOffWinsOverError() {
        let (model, _) = makeModel(
            NLAlertBuilderInputSnapshot(gate: .off, vehicleID: 1, errorMessage: "ignored")
        )
        model.start()
        XCTAssertEqual(model.renderState, .gatedOff)
    }

    func testPromptDrivesCanStart() {
        let (model, _) = makeModel(readyInput)
        model.start()
        XCTAssertFalse(model.canStart)
        XCTAssertEqual(model.emptyHint, .describeAlert)
        model.prompt = "Alert me when the cell voltage spread exceeds 50 mV"
        XCTAssertTrue(model.canStart)
        XCTAssertNil(model.emptyHint)
        XCTAssertFalse(model.buttonDisabled)
    }

    func testNoVehicleHintTakesPriority() {
        let (model, _) = makeModel(NLAlertBuilderInputSnapshot(gate: .on, vehicleID: nil), prompt: "go")
        model.start()
        XCTAssertEqual(model.emptyHint, .selectVehicle)
        XCTAssertFalse(model.canStart)
    }

    func testDraftStartsStreamWithBodyAndClearsText() {
        let (model, source) = makeModel(readyInput, prompt: "Alert on voltage spread")
        model.start()
        source.pushNarrative(["partial output"])
        XCTAssertEqual(model.streamText, "partial output")
        model.draft()
        XCTAssertEqual(model.streamText, "")
        XCTAssertEqual(source.startStreamCount, 1)
        XCTAssertEqual(source.lastStreamVehicleID, 42)
        XCTAssertEqual(source.lastStreamPrompt, "Alert on voltage spread")
        XCTAssertEqual(model.phase, .streaming)
    }

    func testDraftIsNoOpWhileBusy() {
        let (model, source) = makeModel(readyInput, prompt: "go")
        model.start()
        source.pushStreamState(.streaming)
        model.draft()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testDraftFallsBackToZeroVehicleIDWhenNil() {
        // Web body sends `vehicle_id: vehicleId ?? 0`. With a nil id the action is normally
        // disabled, but the model still forwards 0 if `draft()` is invoked directly.
        let (model, source) = makeModel(NLAlertBuilderInputSnapshot(gate: .on, vehicleID: nil), prompt: "go")
        model.start()
        model.draft()
        XCTAssertEqual(source.lastStreamVehicleID, 0)
    }

    func testDeltaAccumulatesStreamText() {
        let (model, source) = makeModel(readyInput, prompt: "go")
        model.start()
        source.pushStreamState(.streaming)
        source.pushEvent(.delta(text: "Drafting "))
        source.pushEvent(.delta(text: "AlertRule…"))
        XCTAssertEqual(model.streamText, "Drafting AlertRule…")
        XCTAssertTrue(model.outputVisible)
    }

    func testNonDeltaEventsDoNotMutateText() {
        let (model, source) = makeModel(readyInput, prompt: "go")
        model.start()
        source.pushEvent(.toolResult(id: "1", name: "draft", ok: true))
        source.pushEvent(.done(finishReason: "stop"))
        XCTAssertEqual(model.streamText, "")
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

    func testErrorPhaseSurfacesInProjection() {
        let (model, source) = makeModel(readyInput, prompt: "go")
        model.start()
        source.pushStreamState(.error("rate limited"))
        XCTAssertEqual(model.phase, .error("rate limited"))
        XCTAssertTrue(model.outputVisible)
        XCTAssertFalse(model.thinkingVisible)
    }

    func testVehicleChangeKeepsStreamAndText() {
        // AINLAlertBuilder has NO web vehicle-change cleanup effect: a vehicle change updates
        // scope WITHOUT cancelling the stream or clearing text.
        let (model, source) = makeModel(readyInput, prompt: "keep me")
        model.start()
        source.pushNarrative(["streamed output"])
        XCTAssertEqual(model.streamText, "streamed output")
        XCTAssertEqual(model.phase, .done)

        source.pushInput(NLAlertBuilderInputSnapshot(gate: .on, vehicleID: 99))
        XCTAssertEqual(source.cancelStreamCount, 0)
        XCTAssertEqual(model.streamText, "streamed output")
        XCTAssertEqual(model.phase, .done)
        XCTAssertEqual(model.vehicleID, 99)
        XCTAssertEqual(model.prompt, "keep me")
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(readyInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.pushInput(NLAlertBuilderInputSnapshot(gate: .on, vehicleID: 42, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.pushInput(NLAlertBuilderInputSnapshot(gate: .on, vehicleID: 42, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefreshAndDisablesButton() {
        let (model, source) = makeModel(readyInput, prompt: "go")
        model.start()
        source.pushInput(NLAlertBuilderInputSnapshot(gate: .on, vehicleID: 42, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
        XCTAssertTrue(model.buttonDisabled)
    }

    func testCancelDelegatesToSource() {
        let (model, source) = makeModel(readyInput)
        model.start()
        model.cancel()
        XCTAssertEqual(source.cancelStreamCount, 1)
    }

    func testRefreshClearsGateErrorAndDelegates() {
        let (model, source) = makeModel(
            NLAlertBuilderInputSnapshot(gate: .loading, vehicleID: 1, errorMessage: "down")
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
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyNLAlertBuilderTelemetry: NLAlertBuilderTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
