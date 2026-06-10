//
//  AINLDriveSearch.ModelTests.swift
//  TeslaSync — P4 shared surface · 0032 · AINLDriveSearch (Apple)
//
//  State-holder coverage split out of `…Tests.swift` (one file ≤ 400 lines per the SwiftLint
//  contract): `NLDriveSearchModel` wiring — the gate render axis, the P1/S11 `view.opened`
//  telemetry, the prompt-driven canStart, the ask double-submit / disabled guard + body
//  forwarding, the delta answer accumulation, the stale auto-refresh, and the offline guard.
//  Driven entirely by `InMemoryNLDriveSearchSource`; no network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: wiring, telemetry, actions, freshness

@MainActor final class NLDriveSearchModelTests: XCTestCase {
    private func makeModel(
        _ input: NLDriveSearchInputSnapshot,
        prompt: String = "",
        telemetry: NLDriveSearchTelemetry = OSLogNLDriveSearchTelemetry()
    ) -> (NLDriveSearchModel, InMemoryNLDriveSearchSource) {
        let source = InMemoryNLDriveSearchSource(initial: input)
        let model = NLDriveSearchModel(source: source, telemetry: telemetry)
        model.prompt = prompt
        return (model, source)
    }

    private var readyInput: NLDriveSearchInputSnapshot {
        NLDriveSearchInputSnapshot(gate: .on)
    }

    func testStartEmitsTelemetryOnceAndAppliesInitial() {
        let spy = SpyNLDriveSearchTelemetry()
        let (model, source) = makeModel(readyInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.renderState, .ready)
        XCTAssertEqual(spy.surfaces, [NLDriveSearchSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGateRenderAxis() {
        let (loading, _) = makeModel(NLDriveSearchInputSnapshot(gate: .loading))
        loading.start()
        XCTAssertEqual(loading.renderState, .gateLoading)

        let (off, _) = makeModel(NLDriveSearchInputSnapshot(gate: .off))
        off.start()
        XCTAssertEqual(off.renderState, .gatedOff)

        let (errored, _) = makeModel(
            NLDriveSearchInputSnapshot(gate: .loading, errorMessage: "boom")
        )
        errored.start()
        XCTAssertEqual(errored.renderState, .gateError("boom"))

        let (ready, _) = makeModel(readyInput)
        ready.start()
        XCTAssertEqual(ready.renderState, .ready)
    }

    func testGatedOffWinsOverError() {
        let (model, _) = makeModel(
            NLDriveSearchInputSnapshot(gate: .off, errorMessage: "ignored")
        )
        model.start()
        XCTAssertEqual(model.renderState, .gatedOff)
    }

    func testPromptDrivesCanStart() {
        let (model, _) = makeModel(readyInput)
        model.start()
        XCTAssertFalse(model.canStart)
        XCTAssertEqual(model.emptyHint, .enterPrompt)
        model.prompt = "last Friday's trip to the coast"
        XCTAssertTrue(model.canStart)
        XCTAssertNil(model.emptyHint)
        XCTAssertFalse(model.buttonDisabled)
    }

    func testAskStartsStreamWithProjectedBodyAndClearsPriorAnswer() {
        let (model, source) = makeModel(readyInput, prompt: "  last Friday's coastal trip  ")
        model.start()
        source.pushEvent(.delta(text: "stale answer"))
        XCTAssertEqual(model.streamText, "stale answer")
        model.ask()
        XCTAssertEqual(model.streamText, "")
        XCTAssertEqual(source.startStreamCount, 1)
        // The forwarded prompt is trimmed (web `prompt.trim()`).
        XCTAssertEqual(source.lastStreamPrompt, "last Friday's coastal trip")
        XCTAssertEqual(model.phase, .streaming)
    }

    func testAskIsNoOpWhileBusy() {
        let (model, source) = makeModel(readyInput, prompt: "go")
        model.start()
        source.pushStreamState(.streaming)
        model.ask()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testAskIsNoOpWithoutPrompt() {
        let (model, source) = makeModel(readyInput, prompt: "   ")
        model.start()
        model.ask()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testAskIsNoOpWhenOffline() {
        let (model, source) = makeModel(readyInput, prompt: "go")
        model.start()
        source.pushInput(NLDriveSearchInputSnapshot(gate: .on, connection: .offline))
        model.ask()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testDeltaAccumulatesAnswerText() {
        let (model, source) = makeModel(readyInput, prompt: "go")
        model.start()
        source.pushStreamState(.streaming)
        source.pushEvent(.delta(text: "Found your drive on "))
        source.pushEvent(.delta(text: "Fri 6 Jun. Opening replay…"))
        XCTAssertEqual(model.streamText, "Found your drive on Fri 6 Jun. Opening replay…")
        XCTAssertTrue(model.outputVisible)
    }

    func testPushAnswerConvenienceAccumulatesAndCompletes() {
        let (model, source) = makeModel(readyInput, prompt: "go")
        model.start()
        source.pushAnswer("Found a 78 km coastal run. Opening its replay…")
        XCTAssertEqual(model.streamText, "Found a 78 km coastal run. Opening its replay…")
        XCTAssertEqual(model.phase, .done)
        XCTAssertTrue(model.outputVisible)
        XCTAssertFalse(model.thinkingVisible)
    }

    func testNonDeltaEventsAreIgnored() {
        let (model, source) = makeModel(readyInput, prompt: "go")
        model.start()
        source.pushEvent(.toolCall(id: "tc-1", name: "search_drives"))
        source.pushEvent(.toolResult(id: "tr-1", name: "search_drives", ok: true))
        source.pushEvent(.confirmRequest(continuationID: "c-1", tool: "x", summary: "y"))
        source.pushEvent(.done(finishReason: "stop"))
        XCTAssertEqual(model.streamText, "")
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(readyInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.pushInput(NLDriveSearchInputSnapshot(gate: .on, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.pushInput(NLDriveSearchInputSnapshot(gate: .on, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefreshAndDisablesButton() {
        let (model, source) = makeModel(readyInput, prompt: "go")
        model.start()
        source.pushInput(NLDriveSearchInputSnapshot(gate: .on, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
        XCTAssertTrue(model.buttonDisabled)
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

    func testStreamErrorPhaseSurfacesAndKeepsCardReady() {
        let (model, source) = makeModel(readyInput, prompt: "go")
        model.start()
        source.pushStreamState(.error("rate limited"))
        XCTAssertEqual(model.phase, .error("rate limited"))
        XCTAssertEqual(model.renderState, .ready)
        XCTAssertTrue(model.outputVisible)
    }

    func testCancelDelegatesToSource() {
        let (model, source) = makeModel(readyInput)
        model.start()
        model.cancel()
        XCTAssertEqual(source.cancelStreamCount, 1)
    }

    func testRefreshClearsGateErrorAndDelegates() {
        let (model, source) = makeModel(
            NLDriveSearchInputSnapshot(gate: .loading, errorMessage: "down")
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

    func testSurfaceViewAliasesMatchConstants() {
        XCTAssertEqual(AINLDriveSearch.surfaceSlug, NLDriveSearchSurface.slug)
        XCTAssertEqual(AINLDriveSearch.featureID, NLDriveSearchSurface.featureID)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyNLDriveSearchTelemetry: NLDriveSearchTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
