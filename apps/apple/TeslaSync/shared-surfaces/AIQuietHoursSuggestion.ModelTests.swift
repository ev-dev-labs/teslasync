//
//  AIQuietHoursSuggestion.ModelTests.swift
//  TeslaSync — P4 shared surface · 0041 · AIQuietHoursSuggestion (Apple)
//
//  State-holder coverage split out of `…Tests.swift` (one file ≤ 400 lines per the SwiftLint
//  contract): `QuietHoursSuggestionModel` wiring — the gate render axis, the P1/S11 `view.opened`
//  telemetry, the suggest double-submit guard (busy = streaming || paused-confirm) + prior-proposal
//  clear, the `tool_result` proposal capture, the apply hand-off to the parent callback, the delta
//  text accumulation, the web-faithful unmount (stop clears the proposal), and the stale
//  auto-refresh. Driven entirely by `InMemoryQuietHoursSuggestionSource`; no network, no real store.
//

import XCTest
@testable import TeslaSync

@MainActor final class QuietHoursSuggestionModelTests: XCTestCase {
    private func makeModel(
        _ input: QuietHoursSuggestionInputSnapshot,
        telemetry: QuietHoursSuggestionTelemetry = OSLogQuietHoursSuggestionTelemetry(),
        onApply: @escaping @MainActor (QuietHoursWindowPatch) -> Void = { _ in }
    ) -> (QuietHoursSuggestionModel, InMemoryQuietHoursSuggestionSource) {
        let source = InMemoryQuietHoursSuggestionSource(initial: input)
        let model = QuietHoursSuggestionModel(source: source, telemetry: telemetry, onApply: onApply)
        return (model, source)
    }

    private var readyInput: QuietHoursSuggestionInputSnapshot {
        QuietHoursSuggestionInputSnapshot(gate: .on)
    }

    func testStartEmitsTelemetryOnceAndAppliesInitial() {
        let spy = SpyQuietHoursSuggestionTelemetry()
        let (model, source) = makeModel(readyInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.renderState, .ready)
        XCTAssertEqual(spy.surfaces, [QuietHoursSuggestionSurface.slug])
        XCTAssertEqual(source.startCount, 1)
        XCTAssertTrue(model.showIdleHint)
    }

    func testGateRenderAxis() {
        let (loading, _) = makeModel(QuietHoursSuggestionInputSnapshot(gate: .loading))
        loading.start()
        XCTAssertEqual(loading.renderState, .gateLoading)

        let (off, _) = makeModel(QuietHoursSuggestionInputSnapshot(gate: .off))
        off.start()
        XCTAssertEqual(off.renderState, .gatedOff)

        let (errored, _) = makeModel(
            QuietHoursSuggestionInputSnapshot(gate: .loading, errorMessage: "boom")
        )
        errored.start()
        XCTAssertEqual(errored.renderState, .gateError("boom"))

        let (ready, _) = makeModel(readyInput)
        ready.start()
        XCTAssertEqual(ready.renderState, .ready)
    }

    func testGatedOffWinsOverError() {
        let (model, _) = makeModel(
            QuietHoursSuggestionInputSnapshot(gate: .off, errorMessage: "ignored")
        )
        model.start()
        XCTAssertEqual(model.renderState, .gatedOff)
    }

    func testSuggestStartsStreamAndClearsPriorProposal() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushProposal(startLocal: "22:00", endLocal: "07:00")
        XCTAssertNotNil(model.proposal)
        XCTAssertEqual(model.phase, .done)

        model.suggest()
        XCTAssertNil(model.proposal)
        XCTAssertEqual(model.streamText, "")
        XCTAssertEqual(source.startStreamCount, 1)
        XCTAssertEqual(model.phase, .streaming)
    }

    func testSuggestIsNoOpWhileStreaming() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushStreamState(.streaming)
        model.suggest()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testSuggestIsNoOpWhilePausedConfirm() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushStreamState(.pausedConfirm)
        model.suggest()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testApplyForwardsPatchToCallback() {
        var captured: [QuietHoursWindowPatch] = []
        let (model, source) = makeModel(readyInput, onApply: { captured.append($0) })
        model.start()
        source.pushProposal(
            startLocal: "22:00",
            endLocal: "07:00",
            timezone: "America/New_York",
            weekdays: 96,
            bypassSeverities: ["critical"]
        )
        model.apply()
        XCTAssertEqual(captured.count, 1)
        XCTAssertEqual(captured.first?.enabled, true)
        XCTAssertEqual(captured.first?.startLocal, "22:00")
        XCTAssertEqual(captured.first?.endLocal, "07:00")
        XCTAssertEqual(captured.first?.timezone, "America/New_York")
        XCTAssertEqual(captured.first?.weekdays, 96)
        XCTAssertEqual(captured.first?.bypassSeverities, ["critical"])
    }

    func testApplyIsNoOpWithoutProposal() {
        var captured: [QuietHoursWindowPatch] = []
        let (model, _) = makeModel(readyInput, onApply: { captured.append($0) })
        model.start()
        model.apply()
        XCTAssertTrue(captured.isEmpty)
    }

    func testToolResultCapturesProposalAndHidesIdleHint() {
        let (model, source) = makeModel(readyInput)
        model.start()
        XCTAssertTrue(model.showIdleHint)
        source.pushProposal()
        XCTAssertNotNil(model.proposal)
        XCTAssertTrue(model.canApply)
        XCTAssertFalse(model.showIdleHint)
    }

    func testInvalidToolResultDoesNotCapture() {
        let (model, source) = makeModel(readyInput)
        model.start()
        // ok=false is dropped by the web `&& ev.ok` guard.
        source.pushProposal(ok: false)
        XCTAssertNil(model.proposal)
    }

    func testDeltaAccumulatesStreamText() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushStreamState(.streaming)
        source.pushEvent(.delta(text: "Analyzing "))
        source.pushEvent(.delta(text: "cadence…"))
        XCTAssertEqual(model.streamText, "Analyzing cadence…")
        XCTAssertTrue(model.outputVisible)
    }

    func testNonDeltaNonToolResultEventsDoNotMutateState() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushEvent(.toolCall(id: "1", name: QuietHoursDraftProposal.toolName))
        source.pushEvent(.done(finishReason: "stop"))
        XCTAssertEqual(model.streamText, "")
        XCTAssertNil(model.proposal)
    }

    func testPhaseDrivesBusyAndThinking() {
        let (model, source) = makeModel(readyInput)
        model.start()
        XCTAssertFalse(model.buttonDisabled)
        source.pushStreamState(.streaming)
        XCTAssertTrue(model.isBusy)
        XCTAssertTrue(model.buttonDisabled)
        XCTAssertTrue(model.thinkingVisible)
    }

    func testErrorPhaseSurfacesInProjection() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushStreamState(.error("rate limited"))
        XCTAssertEqual(model.phase, .error("rate limited"))
        XCTAssertTrue(model.outputVisible)
        XCTAssertFalse(model.thinkingVisible)
    }

    func testStopCancelsStreamClearsProposalAndReArms() {
        // Web unmount effect runs cancelStream() AND setProposal(null).
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushProposal()
        XCTAssertNotNil(model.proposal)

        model.stop()
        XCTAssertEqual(source.cancelStreamCount, 1)
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertNil(model.proposal)

        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(readyInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.pushInput(QuietHoursSuggestionInputSnapshot(gate: .on, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.pushInput(QuietHoursSuggestionInputSnapshot(gate: .on, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefreshAndDisablesButton() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushInput(QuietHoursSuggestionInputSnapshot(gate: .on, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
        XCTAssertTrue(model.buttonDisabled)
    }

    func testCancelDelegatesToSourceWithoutClearingProposal() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushProposal()
        model.cancel()
        XCTAssertEqual(source.cancelStreamCount, 1)
        XCTAssertNotNil(model.proposal)
    }

    func testRefreshClearsGateErrorAndDelegates() {
        let (model, source) = makeModel(
            QuietHoursSuggestionInputSnapshot(gate: .loading, errorMessage: "down")
        )
        model.start()
        XCTAssertEqual(model.renderState, .gateError("down"))
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertNotEqual(model.renderState, .gateError("down"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyQuietHoursSuggestionTelemetry: QuietHoursSuggestionTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
