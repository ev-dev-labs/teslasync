//
//  AILifetimeStatsQA.ModelTests.swift
//  TeslaSync — P4 shared surface · 0024 · AILifetimeStatsQA (Apple)
//
//  State-holder coverage split out of `…Tests.swift` (one file ≤ 400 lines per the SwiftLint
//  contract): `LifetimeStatsQAModel` wiring — the gate render axis, the P1/S11 `view.opened`
//  telemetry, the question-driven canStart, the ask double-submit / disabled guard + body
//  forwarding, the delta answer accumulation, the vehicle-change reset (question preserved),
//  and the stale auto-refresh. Driven entirely by `InMemoryLifetimeStatsQASource`; no
//  network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: wiring, telemetry, actions, freshness

@MainActor final class LifetimeStatsQAModelTests: XCTestCase {
    private func makeModel(
        _ input: LifetimeStatsQAInputSnapshot,
        question: String = "",
        telemetry: LifetimeStatsQATelemetry = OSLogLifetimeStatsQATelemetry()
    ) -> (LifetimeStatsQAModel, InMemoryLifetimeStatsQASource) {
        let source = InMemoryLifetimeStatsQASource(initial: input)
        let model = LifetimeStatsQAModel(source: source, telemetry: telemetry)
        model.question = question
        return (model, source)
    }

    private var readyInput: LifetimeStatsQAInputSnapshot {
        LifetimeStatsQAInputSnapshot(gate: .on, vehicleID: 42)
    }

    func testStartEmitsTelemetryOnceAndAppliesInitial() {
        let spy = SpyLifetimeStatsQATelemetry()
        let (model, source) = makeModel(readyInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.renderState, .ready)
        XCTAssertEqual(model.vehicleID, 42)
        XCTAssertEqual(spy.surfaces, [LifetimeStatsQASurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGateRenderAxis() {
        let (loading, _) = makeModel(LifetimeStatsQAInputSnapshot(gate: .loading, vehicleID: 1))
        loading.start()
        XCTAssertEqual(loading.renderState, .gateLoading)

        let (off, _) = makeModel(LifetimeStatsQAInputSnapshot(gate: .off, vehicleID: 1))
        off.start()
        XCTAssertEqual(off.renderState, .gatedOff)

        let (errored, _) = makeModel(
            LifetimeStatsQAInputSnapshot(gate: .loading, vehicleID: 1, errorMessage: "boom")
        )
        errored.start()
        XCTAssertEqual(errored.renderState, .gateError("boom"))

        let (ready, _) = makeModel(readyInput)
        ready.start()
        XCTAssertEqual(ready.renderState, .ready)
    }

    func testGatedOffWinsOverError() {
        let (model, _) = makeModel(
            LifetimeStatsQAInputSnapshot(gate: .off, vehicleID: 1, errorMessage: "ignored")
        )
        model.start()
        XCTAssertEqual(model.renderState, .gatedOff)
    }

    func testQuestionDrivesCanStart() {
        let (model, _) = makeModel(readyInput)
        model.start()
        XCTAssertFalse(model.canStart)
        XCTAssertEqual(model.emptyHint, .askQuestion)
        model.question = "How far have I driven in total?"
        XCTAssertTrue(model.canStart)
        XCTAssertNil(model.emptyHint)
        XCTAssertFalse(model.buttonDisabled)
    }

    func testNoVehicleHintTakesPriority() {
        let (model, _) = makeModel(LifetimeStatsQAInputSnapshot(gate: .on, vehicleID: 0), question: "go")
        model.start()
        XCTAssertEqual(model.emptyHint, .selectVehicle)
        XCTAssertFalse(model.canStart)
    }

    func testAskStartsStreamWithProjectedBodyAndClearsPriorAnswer() {
        let (model, source) = makeModel(readyInput, question: "  How far have I driven?  ")
        model.start()
        source.pushEvent(.delta(text: "stale answer"))
        XCTAssertEqual(model.streamText, "stale answer")
        model.ask()
        XCTAssertEqual(model.streamText, "")
        XCTAssertEqual(source.startStreamCount, 1)
        XCTAssertEqual(source.lastStreamVehicleID, 42)
        // The forwarded question is trimmed (web `trimmedQuestion`).
        XCTAssertEqual(source.lastStreamQuestion, "How far have I driven?")
        XCTAssertEqual(model.phase, .streaming)
    }

    func testAskIsNoOpWhileBusy() {
        let (model, source) = makeModel(readyInput, question: "go")
        model.start()
        source.pushStreamState(.streaming)
        model.ask()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testAskIsNoOpWithoutQuestion() {
        let (model, source) = makeModel(readyInput, question: "   ")
        model.start()
        model.ask()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testAskIsNoOpWhenOffline() {
        let (model, source) = makeModel(readyInput, question: "go")
        model.start()
        source.pushInput(LifetimeStatsQAInputSnapshot(gate: .on, vehicleID: 42, connection: .offline))
        model.ask()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testDeltaAccumulatesAnswerText() {
        let (model, source) = makeModel(readyInput, question: "go")
        model.start()
        source.pushStreamState(.streaming)
        source.pushEvent(.delta(text: "You've driven "))
        source.pushEvent(.delta(text: "48,210 km."))
        XCTAssertEqual(model.streamText, "You've driven 48,210 km.")
        XCTAssertTrue(model.outputVisible)
    }

    func testPushAnswerConvenienceAccumulatesAndCompletes() {
        let (model, source) = makeModel(readyInput, question: "go")
        model.start()
        source.pushAnswer("Lifetime distance is 48,210 km.")
        XCTAssertEqual(model.streamText, "Lifetime distance is 48,210 km.")
        XCTAssertEqual(model.phase, .done)
        XCTAssertTrue(model.outputVisible)
        XCTAssertFalse(model.thinkingVisible)
    }

    func testNonDeltaEventsAreIgnored() {
        let (model, source) = makeModel(readyInput, question: "go")
        model.start()
        source.pushEvent(.toolCall(id: "tc-1", name: "query_lifetime_stats"))
        source.pushEvent(.toolResult(id: "tr-1", name: "query_lifetime_stats", ok: true))
        source.pushEvent(.confirmRequest(continuationID: "c-1", tool: "x", summary: "y"))
        source.pushEvent(.done(finishReason: "stop"))
        XCTAssertEqual(model.streamText, "")
    }

    func testVehicleChangeCancelsResetsAnswerButKeepsQuestion() {
        let (model, source) = makeModel(readyInput, question: "keep me")
        model.start()
        source.pushEvent(.delta(text: "answer for 42"))
        XCTAssertEqual(model.streamText, "answer for 42")

        source.pushInput(LifetimeStatsQAInputSnapshot(gate: .on, vehicleID: 99))
        XCTAssertEqual(source.cancelStreamCount, 1)
        XCTAssertEqual(model.streamText, "")
        XCTAssertEqual(model.phase, .idle)
        XCTAssertEqual(model.vehicleID, 99)
        XCTAssertEqual(model.question, "keep me")
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

        source.pushInput(LifetimeStatsQAInputSnapshot(gate: .on, vehicleID: 42, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.pushInput(LifetimeStatsQAInputSnapshot(gate: .on, vehicleID: 42, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefreshAndDisablesButton() {
        let (model, source) = makeModel(readyInput, question: "go")
        model.start()
        source.pushInput(LifetimeStatsQAInputSnapshot(gate: .on, vehicleID: 42, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
        XCTAssertTrue(model.buttonDisabled)
    }

    func testPhaseDrivesBusyAndThinking() {
        let (model, source) = makeModel(readyInput, question: "go")
        model.start()
        XCTAssertFalse(model.buttonDisabled)
        source.pushStreamState(.streaming)
        XCTAssertTrue(model.isBusy)
        XCTAssertTrue(model.buttonDisabled)
        XCTAssertTrue(model.thinkingVisible)
    }

    func testStreamErrorPhaseSurfacesAndKeepsCardReady() {
        let (model, source) = makeModel(readyInput, question: "go")
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
            LifetimeStatsQAInputSnapshot(gate: .loading, vehicleID: 1, errorMessage: "down")
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
        XCTAssertEqual(AILifetimeStatsQA.surfaceSlug, LifetimeStatsQASurface.slug)
        XCTAssertEqual(AILifetimeStatsQA.featureID, LifetimeStatsQASurface.featureID)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyLifetimeStatsQATelemetry: LifetimeStatsQATelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
