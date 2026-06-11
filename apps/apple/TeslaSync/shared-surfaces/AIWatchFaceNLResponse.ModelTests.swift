//
//  AIWatchFaceNLResponse.ModelTests.swift
//  TeslaSync — P4 shared surface · 0060 · AIWatchFaceNLResponse (Apple)
//
//  State-holder coverage split out of `…Tests.swift` (one file ≤ 400 lines per the SwiftLint
//  contract): `WatchFaceNLModel` wiring — the gate render axis, the P1/S11 `view.opened`
//  telemetry, the empty-prompt-allowed canStart, the ask double-submit / disabled guard + body
//  forwarding (incl. the nil/summary body), the delta answer accumulation, the stale
//  auto-refresh, and the cancel-on-unmount (stop) parity. Driven entirely by
//  `InMemoryWatchFaceNLSource`; no network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: wiring, telemetry, actions, freshness

@MainActor final class WatchFaceNLModelTests: XCTestCase {
    private func makeModel(
        _ input: WatchFaceNLInputSnapshot,
        message: String = "",
        telemetry: WatchFaceNLTelemetry = OSLogWatchFaceNLTelemetry()
    ) -> (WatchFaceNLModel, InMemoryWatchFaceNLSource) {
        let source = InMemoryWatchFaceNLSource(initial: input)
        let model = WatchFaceNLModel(source: source, telemetry: telemetry)
        model.message = message
        return (model, source)
    }

    private var readyInput: WatchFaceNLInputSnapshot {
        WatchFaceNLInputSnapshot(gate: .on)
    }

    func testStartEmitsTelemetryOnceAndAppliesInitial() {
        let spy = SpyWatchFaceNLTelemetry()
        let (model, source) = makeModel(readyInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.renderState, .ready)
        XCTAssertEqual(spy.surfaces, [WatchFaceNLSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGateRenderAxis() {
        let (loading, _) = makeModel(WatchFaceNLInputSnapshot(gate: .loading))
        loading.start()
        XCTAssertEqual(loading.renderState, .gateLoading)

        let (off, _) = makeModel(WatchFaceNLInputSnapshot(gate: .off))
        off.start()
        XCTAssertEqual(off.renderState, .gatedOff)

        let (errored, _) = makeModel(WatchFaceNLInputSnapshot(gate: .loading, errorMessage: "boom"))
        errored.start()
        XCTAssertEqual(errored.renderState, .gateError("boom"))

        let (ready, _) = makeModel(readyInput)
        ready.start()
        XCTAssertEqual(ready.renderState, .ready)
    }

    func testGatedOffWinsOverError() {
        let (model, _) = makeModel(WatchFaceNLInputSnapshot(gate: .off, errorMessage: "ignored"))
        model.start()
        XCTAssertEqual(model.renderState, .gatedOff)
    }

    func testEmptyPromptCanStartAndButtonEnabled() {
        // The distinguishing rule from the lifetime-stats Q&A analog: an empty prompt is a
        // valid ask (the backend answers with a default glance summary), so the resting card's
        // action is enabled with no text typed and shows no blocking hint.
        let (model, _) = makeModel(readyInput)
        model.start()
        XCTAssertTrue(model.canStart)
        XCTAssertFalse(model.buttonDisabled)
        XCTAssertNil(model.hint)
    }

    func testOverCapDisablesAndHints() {
        let (model, _) = makeModel(
            readyInput,
            message: String(repeating: "a", count: WatchFaceNLConstants.maxMessageChars + 1)
        )
        model.start()
        XCTAssertFalse(model.canStart)
        XCTAssertTrue(model.buttonDisabled)
        XCTAssertEqual(model.hint, .overCap)
    }

    func testAskWithEmptyPromptStartsSummaryStreamAndClearsPriorAnswer() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushEvent(.delta(text: "stale answer"))
        XCTAssertEqual(model.streamText, "stale answer")
        model.ask()
        XCTAssertEqual(model.streamText, "")
        XCTAssertEqual(source.startStreamCount, 1)
        // Empty prompt → nil body (web `undefined` → backend default glance summary).
        XCTAssertNil(source.lastStreamMessage)
        XCTAssertEqual(model.phase, .streaming)
    }

    func testAskForwardsTrimmedPromptAndKeepsMessage() {
        let (model, source) = makeModel(readyInput, message: "  How is my battery?  ")
        model.start()
        model.ask()
        XCTAssertEqual(source.startStreamCount, 1)
        XCTAssertEqual(source.lastStreamMessage, "How is my battery?")
        // The prompt itself is not cleared by asking (web `message` useState is preserved).
        XCTAssertEqual(model.message, "  How is my battery?  ")
    }

    func testAskIsNoOpWhileBusy() {
        let (model, source) = makeModel(readyInput, message: "go")
        model.start()
        source.pushStreamState(.streaming)
        model.ask()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testAskIsNoOpWhenOverCap() {
        let (model, source) = makeModel(
            readyInput,
            message: String(repeating: "a", count: WatchFaceNLConstants.maxMessageChars + 1)
        )
        model.start()
        model.ask()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testAskIsNoOpWhenOffline() {
        let (model, source) = makeModel(readyInput, message: "go")
        model.start()
        source.pushInput(WatchFaceNLInputSnapshot(gate: .on, connection: .offline))
        model.ask()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testDeltaAccumulatesAnswerText() {
        let (model, source) = makeModel(readyInput, message: "go")
        model.start()
        source.pushStreamState(.streaming)
        source.pushEvent(.delta(text: "Battery is "))
        source.pushEvent(.delta(text: "at 72%."))
        XCTAssertEqual(model.streamText, "Battery is at 72%.")
        XCTAssertTrue(model.outputVisible)
    }

    func testPushAnswerConvenienceAccumulatesAndCompletes() {
        let (model, source) = makeModel(readyInput, message: "go")
        model.start()
        source.pushAnswer("Battery is at 72% and the car is locked.")
        XCTAssertEqual(model.streamText, "Battery is at 72% and the car is locked.")
        XCTAssertEqual(model.phase, .done)
        XCTAssertTrue(model.outputVisible)
        XCTAssertFalse(model.thinkingVisible)
    }

    func testNonDeltaEventsAreIgnored() {
        let (model, source) = makeModel(readyInput, message: "go")
        model.start()
        source.pushEvent(.toolCall(id: "tc-1", name: "read_watch_state"))
        source.pushEvent(.toolResult(id: "tr-1", name: "read_watch_state", ok: true))
        source.pushEvent(.confirmRequest(continuationID: "c-1", tool: "x", summary: "y"))
        source.pushEvent(.done(finishReason: "stop"))
        XCTAssertEqual(model.streamText, "")
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(readyInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.pushInput(WatchFaceNLInputSnapshot(gate: .on, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.pushInput(WatchFaceNLInputSnapshot(gate: .on, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefreshAndDisablesButton() {
        let (model, source) = makeModel(readyInput, message: "go")
        model.start()
        source.pushInput(WatchFaceNLInputSnapshot(gate: .on, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
        XCTAssertTrue(model.buttonDisabled)
    }

    func testPhaseDrivesBusyAndThinking() {
        let (model, source) = makeModel(readyInput, message: "go")
        model.start()
        XCTAssertFalse(model.buttonDisabled)
        source.pushStreamState(.streaming)
        XCTAssertTrue(model.isBusy)
        XCTAssertTrue(model.buttonDisabled)
        XCTAssertTrue(model.thinkingVisible)
    }

    func testStreamErrorPhaseSurfacesAndKeepsCardReady() {
        let (model, source) = makeModel(readyInput, message: "go")
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
        let (model, source) = makeModel(WatchFaceNLInputSnapshot(gate: .loading, errorMessage: "down"))
        model.start()
        XCTAssertEqual(model.renderState, .gateError("down"))
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertNotEqual(model.renderState, .gateError("down"))
    }

    func testStopCancelsStreamAndReArms() {
        // Cancel-on-unmount parity: stop() aborts any in-flight stream (web cleanup useEffect).
        let (model, source) = makeModel(readyInput)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(source.cancelStreamCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceViewAliasesMatchConstants() {
        XCTAssertEqual(AIWatchFaceNLResponse.surfaceSlug, WatchFaceNLSurface.slug)
        XCTAssertEqual(AIWatchFaceNLResponse.featureID, WatchFaceNLSurface.featureID)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyWatchFaceNLTelemetry: WatchFaceNLTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
