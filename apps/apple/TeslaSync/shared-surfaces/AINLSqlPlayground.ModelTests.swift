//
//  AINLSqlPlayground.ModelTests.swift
//  TeslaSync — P4 shared surface · 0035 · AINLSqlPlayground (Apple)
//
//  State-holder coverage split out of `…Tests.swift` (one file ≤ 400 lines per the SwiftLint
//  contract): `NLSqlPlaygroundModel` wiring — the gate render axis, the P1/S11 `view.opened`
//  telemetry, the prompt-driven canStart, the ask double-submit / disabled guard + body
//  forwarding, the delta rationale accumulation, the `draft_readonly_sql` capture + the
//  propose-only `apply` forwarding, the stale auto-refresh, and the offline guard. Driven
//  entirely by `InMemoryNLSqlPlaygroundSource`; no network, no real store. The cases are split
//  across two XCTestCase classes (wiring/actions vs draft/stream) to stay under the SwiftLint
//  `type_body_length` budget; both share the file-scope fixtures below.
//

import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures

@MainActor
private func makeSqlModel(
    _ input: NLSqlPlaygroundInputSnapshot,
    prompt: String = "",
    telemetry: NLSqlPlaygroundTelemetry = OSLogNLSqlPlaygroundTelemetry(),
    onApply: @escaping (ReadonlySQLDraft) -> Void = { _ in }
) -> (NLSqlPlaygroundModel, InMemoryNLSqlPlaygroundSource) {
    let source = InMemoryNLSqlPlaygroundSource(initial: input)
    let model = NLSqlPlaygroundModel(source: source, telemetry: telemetry, onApply: onApply)
    model.prompt = prompt
    return (model, source)
}

private let sqlReadyInput = NLSqlPlaygroundInputSnapshot(gate: .on)

private let sqlSampleDraft = ReadonlySQLDraft(
    prompt: "how many drives last week",
    sql: "SELECT count(*) FROM drives WHERE started_at >= now() - interval '7 days';",
    rationale: "Count drives in the trailing week.",
    referencedTables: ["drives"]
)

private func sqlDraftEnvelope() -> Data {
    InMemoryNLSqlPlaygroundSource.envelope(for: sqlSampleDraft)
}

// MARK: - State holder: wiring, gate, actions, lifecycle

@MainActor final class NLSqlPlaygroundModelTests: XCTestCase {
    func testStartEmitsTelemetryOnceAndAppliesInitial() {
        let spy = SpyNLSqlPlaygroundTelemetry()
        let (model, source) = makeSqlModel(sqlReadyInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.renderState, .ready)
        XCTAssertEqual(spy.surfaces, [NLSqlPlaygroundSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGateRenderAxis() {
        let (loading, _) = makeSqlModel(NLSqlPlaygroundInputSnapshot(gate: .loading))
        loading.start()
        XCTAssertEqual(loading.renderState, .gateLoading)

        let (off, _) = makeSqlModel(NLSqlPlaygroundInputSnapshot(gate: .off))
        off.start()
        XCTAssertEqual(off.renderState, .gatedOff)

        let (errored, _) = makeSqlModel(
            NLSqlPlaygroundInputSnapshot(gate: .loading, errorMessage: "boom")
        )
        errored.start()
        XCTAssertEqual(errored.renderState, .gateError("boom"))

        let (ready, _) = makeSqlModel(sqlReadyInput)
        ready.start()
        XCTAssertEqual(ready.renderState, .ready)
    }

    func testGatedOffWinsOverError() {
        let (model, _) = makeSqlModel(
            NLSqlPlaygroundInputSnapshot(gate: .off, errorMessage: "ignored")
        )
        model.start()
        XCTAssertEqual(model.renderState, .gatedOff)
    }

    func testPromptDrivesCanStart() {
        let (model, _) = makeSqlModel(sqlReadyInput)
        model.start()
        XCTAssertFalse(model.canStart)
        XCTAssertEqual(model.emptyHint, .enterPrompt)
        model.prompt = "how many drives last week"
        XCTAssertTrue(model.canStart)
        XCTAssertNil(model.emptyHint)
        XCTAssertFalse(model.buttonDisabled)
    }

    func testAskStartsStreamWithProjectedBodyAndClearsPriorDraftAndAnswer() {
        let (model, source) = makeSqlModel(sqlReadyInput, prompt: "  how many drives last week  ")
        model.start()
        source.pushEvent(.delta(text: "stale rationale"))
        source.pushDraft(sqlSampleDraft)
        XCTAssertNotNil(model.draft)
        model.ask()
        XCTAssertNil(model.draft)
        XCTAssertEqual(model.streamText, "")
        XCTAssertEqual(source.startStreamCount, 1)
        XCTAssertEqual(source.lastStreamPrompt, "how many drives last week")
        XCTAssertEqual(model.phase, .streaming)
    }

    func testAskIsNoOpWhileBusy() {
        let (model, source) = makeSqlModel(sqlReadyInput, prompt: "go")
        model.start()
        source.pushStreamState(.streaming)
        model.ask()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testAskIsNoOpWithoutPrompt() {
        let (model, source) = makeSqlModel(sqlReadyInput, prompt: "   ")
        model.start()
        model.ask()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testAskIsNoOpWhenOffline() {
        let (model, source) = makeSqlModel(sqlReadyInput, prompt: "go")
        model.start()
        source.pushInput(NLSqlPlaygroundInputSnapshot(gate: .on, connection: .offline))
        model.ask()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testDeltaAccumulatesRationaleText() {
        let (model, source) = makeSqlModel(sqlReadyInput, prompt: "go")
        model.start()
        source.pushStreamState(.streaming)
        source.pushEvent(.delta(text: "Counting rows "))
        source.pushEvent(.delta(text: "in the drives table."))
        XCTAssertEqual(model.streamText, "Counting rows in the drives table.")
        XCTAssertTrue(model.outputVisible)
    }

    func testCancelDelegatesToSource() {
        let (model, source) = makeSqlModel(sqlReadyInput)
        model.start()
        model.cancel()
        XCTAssertEqual(source.cancelStreamCount, 1)
    }

    func testRefreshClearsGateErrorAndDelegates() {
        let (model, source) = makeSqlModel(
            NLSqlPlaygroundInputSnapshot(gate: .loading, errorMessage: "down")
        )
        model.start()
        XCTAssertEqual(model.renderState, .gateError("down"))
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertNotEqual(model.renderState, .gateError("down"))
    }

    func testStopCancelsStreamAndReArms() {
        let (model, source) = makeSqlModel(sqlReadyInput)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(source.cancelStreamCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceViewAliasesMatchConstants() {
        XCTAssertEqual(AINLSqlPlayground.surfaceSlug, NLSqlPlaygroundSurface.slug)
        XCTAssertEqual(AINLSqlPlayground.featureID, NLSqlPlaygroundSurface.featureID)
    }
}

// MARK: - State holder: draft capture, apply, stream + freshness

@MainActor final class NLSqlPlaygroundDraftAndStreamTests: XCTestCase {
    func testToolResultCapturesDraft() {
        let (model, source) = makeSqlModel(sqlReadyInput, prompt: "go")
        model.start()
        source.pushDraft(sqlSampleDraft, rationaleDeltas: ["Counting drives."])
        XCTAssertEqual(model.draft, sqlSampleDraft)
        XCTAssertEqual(model.streamText, "Counting drives.")
        XCTAssertEqual(model.phase, .done)
        XCTAssertTrue(model.canApply)
    }

    func testToolResultWithWrongNameIsIgnored() {
        let (model, source) = makeSqlModel(sqlReadyInput, prompt: "go")
        model.start()
        // A well-formed draft envelope under a non-matching tool name must be ignored
        // (web `ev.name === 'draft_readonly_sql'` guard).
        source.pushEvent(.toolResult(
            id: "tr-1", name: "some_other_tool", ok: true, data: sqlDraftEnvelope()
        ))
        XCTAssertNil(model.draft)
    }

    func testToolResultWithNonOkStatusIsIgnored() {
        let (model, source) = makeSqlModel(sqlReadyInput, prompt: "go")
        model.start()
        source.pushToolResult(json: "{\"status\":\"error\",\"message\":\"denied\"}")
        XCTAssertNil(model.draft)
    }

    func testToolResultWithMalformedDataIsIgnored() {
        let (model, source) = makeSqlModel(sqlReadyInput, prompt: "go")
        model.start()
        source.pushToolResult(json: "not even json")
        XCTAssertNil(model.draft)
    }

    func testCanApplyGate() {
        let (model, source) = makeSqlModel(sqlReadyInput, prompt: "go")
        model.start()
        XCTAssertFalse(model.canApply)
        source.pushStreamState(.streaming)
        source.pushEvent(.toolResult(
            id: "tr-1",
            name: NLSqlPlaygroundSurface.draftToolName,
            ok: true,
            data: sqlDraftEnvelope()
        ))
        // Draft captured but still streaming → not yet applicable (web `canApply`).
        XCTAssertNotNil(model.draft)
        XCTAssertFalse(model.canApply)
        source.pushStreamState(.done)
        XCTAssertTrue(model.canApply)
    }

    func testApplyForwardsCapturedDraft() {
        var applied: [ReadonlySQLDraft] = []
        let (model, source) = makeSqlModel(sqlReadyInput, prompt: "go") { applied.append($0) }
        model.start()
        source.pushDraft(sqlSampleDraft)
        model.apply()
        XCTAssertEqual(applied, [sqlSampleDraft])
    }

    func testApplyIsNoOpWithoutDraft() {
        var applied: [ReadonlySQLDraft] = []
        let (model, _) = makeSqlModel(sqlReadyInput, prompt: "go") { applied.append($0) }
        model.start()
        model.apply()
        XCTAssertTrue(applied.isEmpty)
    }

    func testApplyIsNoOpWhileStreaming() {
        var applied: [ReadonlySQLDraft] = []
        let (model, source) = makeSqlModel(sqlReadyInput, prompt: "go") { applied.append($0) }
        model.start()
        source.pushStreamState(.streaming)
        source.pushEvent(.toolResult(
            id: "tr-1",
            name: NLSqlPlaygroundSurface.draftToolName,
            ok: true,
            data: sqlDraftEnvelope()
        ))
        model.apply()
        XCTAssertTrue(applied.isEmpty)
    }

    func testNonDeltaNonToolEventsAreIgnored() {
        let (model, source) = makeSqlModel(sqlReadyInput, prompt: "go")
        model.start()
        source.pushEvent(.toolCall(id: "tc-1", name: "draft_readonly_sql"))
        source.pushEvent(.confirmRequest(continuationID: "c-1", tool: "x", summary: "y"))
        source.pushEvent(.done(finishReason: "stop"))
        XCTAssertEqual(model.streamText, "")
        XCTAssertNil(model.draft)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeSqlModel(sqlReadyInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.pushInput(NLSqlPlaygroundInputSnapshot(gate: .on, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.pushInput(NLSqlPlaygroundInputSnapshot(gate: .on, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefreshAndDisablesButton() {
        let (model, source) = makeSqlModel(sqlReadyInput, prompt: "go")
        model.start()
        source.pushInput(NLSqlPlaygroundInputSnapshot(gate: .on, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
        XCTAssertTrue(model.buttonDisabled)
    }

    func testPhaseDrivesBusyAndThinking() {
        let (model, source) = makeSqlModel(sqlReadyInput, prompt: "go")
        model.start()
        XCTAssertFalse(model.buttonDisabled)
        source.pushStreamState(.streaming)
        XCTAssertTrue(model.isBusy)
        XCTAssertTrue(model.buttonDisabled)
        XCTAssertTrue(model.thinkingVisible)
    }

    func testStreamErrorPhaseSurfacesAndKeepsCardReady() {
        let (model, source) = makeSqlModel(sqlReadyInput, prompt: "go")
        model.start()
        source.pushStreamState(.error("rate limited"))
        XCTAssertEqual(model.phase, .error("rate limited"))
        XCTAssertEqual(model.renderState, .ready)
        XCTAssertTrue(model.outputVisible)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyNLSqlPlaygroundTelemetry: NLSqlPlaygroundTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
