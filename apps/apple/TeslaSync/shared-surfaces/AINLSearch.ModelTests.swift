//
//  AINLSearch.ModelTests.swift
//  TeslaSync — P4 shared surface · 0034 · AINLSearch (Apple)
//
//  State-holder coverage split out of `…Tests.swift` (one file ≤ 400 lines per the SwiftLint
//  contract): `NLSearchModel` wiring — the gate render axis, the P1/S11 `view.opened`
//  telemetry, the prompt-driven canStart, the ask double-submit / disabled guard + body
//  forwarding, the delta answer accumulation, the stale auto-refresh, and the offline guard.
//  Driven entirely by `InMemoryNLSearchSource`; no network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: wiring, telemetry, actions, freshness

@MainActor final class NLSearchModelTests: XCTestCase {
    private func makeModel(
        _ input: NLSearchInputSnapshot,
        prompt: String = "",
        telemetry: NLSearchTelemetry = OSLogNLSearchTelemetry()
    ) -> (NLSearchModel, InMemoryNLSearchSource) {
        let source = InMemoryNLSearchSource(initial: input)
        let model = NLSearchModel(source: source, telemetry: telemetry)
        model.prompt = prompt
        return (model, source)
    }

    private var readyInput: NLSearchInputSnapshot {
        NLSearchInputSnapshot(gate: .on)
    }

    func testStartEmitsTelemetryOnceAndAppliesInitial() {
        let spy = SpyNLSearchTelemetry()
        let (model, source) = makeModel(readyInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.renderState, .ready)
        XCTAssertEqual(spy.surfaces, [NLSearchSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGateRenderAxis() {
        let (loading, _) = makeModel(NLSearchInputSnapshot(gate: .loading))
        loading.start()
        XCTAssertEqual(loading.renderState, .gateLoading)

        let (off, _) = makeModel(NLSearchInputSnapshot(gate: .off))
        off.start()
        XCTAssertEqual(off.renderState, .gatedOff)

        let (errored, _) = makeModel(
            NLSearchInputSnapshot(gate: .loading, errorMessage: "boom")
        )
        errored.start()
        XCTAssertEqual(errored.renderState, .gateError("boom"))

        let (ready, _) = makeModel(readyInput)
        ready.start()
        XCTAssertEqual(ready.renderState, .ready)
    }

    func testGatedOffWinsOverError() {
        let (model, _) = makeModel(
            NLSearchInputSnapshot(gate: .off, errorMessage: "ignored")
        )
        model.start()
        XCTAssertEqual(model.renderState, .gatedOff)
    }

    func testPromptDrivesCanStart() {
        let (model, _) = makeModel(readyInput)
        model.start()
        XCTAssertFalse(model.canStart)
        XCTAssertEqual(model.emptyHint, .enterPrompt)
        model.prompt = "drives over 200 km last weekend"
        XCTAssertTrue(model.canStart)
        XCTAssertNil(model.emptyHint)
        XCTAssertFalse(model.buttonDisabled)
    }

    func testAskStartsStreamWithProjectedBodyAndClearsPriorAnswer() {
        let (model, source) = makeModel(readyInput, prompt: "  phantom drain over 3% last week  ")
        model.start()
        source.pushEvent(.delta(text: "stale answer"))
        XCTAssertEqual(model.streamText, "stale answer")
        model.ask()
        XCTAssertEqual(model.streamText, "")
        XCTAssertEqual(source.startStreamCount, 1)
        // The forwarded prompt is trimmed (web `prompt.trim()`).
        XCTAssertEqual(source.lastStreamPrompt, "phantom drain over 3% last week")
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
        source.pushInput(NLSearchInputSnapshot(gate: .on, connection: .offline))
        model.ask()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testDeltaAccumulatesAnswerText() {
        let (model, source) = makeModel(readyInput, prompt: "go")
        model.start()
        source.pushStreamState(.streaming)
        source.pushEvent(.delta(text: "Found 2 matches across "))
        source.pushEvent(.delta(text: "drives and alerts."))
        XCTAssertEqual(model.streamText, "Found 2 matches across drives and alerts.")
        XCTAssertTrue(model.outputVisible)
    }

    func testPushAnswerConvenienceAccumulatesAndCompletes() {
        let (model, source) = makeModel(readyInput, prompt: "go")
        model.start()
        source.pushAnswer("Found 2 matching drives and 1 alert. Tap any to open it.")
        XCTAssertEqual(model.streamText, "Found 2 matching drives and 1 alert. Tap any to open it.")
        XCTAssertEqual(model.phase, .done)
        XCTAssertTrue(model.outputVisible)
        XCTAssertFalse(model.thinkingVisible)
    }

    func testNonDeltaEventsAreIgnored() {
        let (model, source) = makeModel(readyInput, prompt: "go")
        model.start()
        source.pushEvent(.toolCall(id: "tc-1", name: "search_entities"))
        source.pushEvent(.toolResult(id: "tr-1", name: "search_entities", ok: true))
        source.pushEvent(.confirmRequest(continuationID: "c-1", tool: "x", summary: "y"))
        source.pushEvent(.done(finishReason: "stop"))
        XCTAssertEqual(model.streamText, "")
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(readyInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.pushInput(NLSearchInputSnapshot(gate: .on, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.pushInput(NLSearchInputSnapshot(gate: .on, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefreshAndDisablesButton() {
        let (model, source) = makeModel(readyInput, prompt: "go")
        model.start()
        source.pushInput(NLSearchInputSnapshot(gate: .on, connection: .offline))
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
            NLSearchInputSnapshot(gate: .loading, errorMessage: "down")
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
        XCTAssertEqual(AINLSearch.surfaceSlug, NLSearchSurface.slug)
        XCTAssertEqual(AINLSearch.featureID, NLSearchSurface.featureID)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyNLSearchTelemetry: NLSearchTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
