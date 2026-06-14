//
//  AINLGrafanaPanel.ModelTests.swift
//  TeslaSync — P4 shared surface · 0033 · AINLGrafanaPanel (Apple)
//
//  State-holder coverage split out of `…Tests.swift` (one file ≤ 400 lines per the SwiftLint
//  contract): `NLGrafanaPanelModel` wiring — the gate render axis, the P1/S11 `view.opened`
//  telemetry, the prompt-driven canStart, the ask double-submit / disabled guard + body
//  forwarding, the delta rationale accumulation, the `draft_grafana_panel` capture + the
//  propose-only `apply` forwarding, the stale auto-refresh, and the offline guard. Driven
//  entirely by `InMemoryNLGrafanaPanelSource`; no network, no real store. The cases are split
//  across two XCTestCase classes (wiring/actions vs draft/stream) to stay under the SwiftLint
//  `type_body_length` budget; both share the file-scope fixtures below.
//

import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures

@MainActor
private func makeGrafanaModel(
    _ input: NLGrafanaPanelInputSnapshot,
    prompt: String = "",
    telemetry: NLGrafanaPanelTelemetry = OSLogNLGrafanaPanelTelemetry(),
    onApply: @escaping (GrafanaPanelDraft) -> Void = { _ in }
) -> (NLGrafanaPanelModel, InMemoryNLGrafanaPanelSource) {
    let source = InMemoryNLGrafanaPanelSource(initial: input)
    let model = NLGrafanaPanelModel(source: source, telemetry: telemetry, onApply: onApply)
    model.prompt = prompt
    return (model, source)
}

private let grafanaReadyInput = NLGrafanaPanelInputSnapshot(gate: .on)

private let grafanaSampleDraft = GrafanaPanelDraft(
    prompt: "show me a daily time series of how far I drove this month",
    panel: GrafanaPanelEnvelope(
        title: "Daily Distance — This Month",
        type: "timeseries",
        datasource: GrafanaDatasourceRef(type: "postgres", uid: "teslasync-tsdb"),
        targets: [
            GrafanaPanelTarget(
                refID: "A",
                rawSQL: "SELECT 1",
                expr: nil,
                format: "time_series"
            )
        ],
        gridPos: GrafanaPanelGridPos(x: 0, y: 0, width: 12, height: 8)
    ),
    rationale: "Sums daily drive distance for the current month.",
    referencedTables: ["drives"]
)

private func grafanaDraftEnvelope() -> Data {
    InMemoryNLGrafanaPanelSource.envelope(for: grafanaSampleDraft)
}

// MARK: - State holder: wiring, gate, actions, lifecycle

@MainActor final class NLGrafanaPanelModelTests: XCTestCase {
    func testStartEmitsTelemetryOnceAndAppliesInitial() {
        let spy = SpyNLGrafanaPanelTelemetry()
        let (model, source) = makeGrafanaModel(grafanaReadyInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.renderState, .ready)
        XCTAssertEqual(spy.surfaces, [NLGrafanaPanelSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGateRenderAxis() {
        let (loading, _) = makeGrafanaModel(NLGrafanaPanelInputSnapshot(gate: .loading))
        loading.start()
        XCTAssertEqual(loading.renderState, .gateLoading)

        let (off, _) = makeGrafanaModel(NLGrafanaPanelInputSnapshot(gate: .off))
        off.start()
        XCTAssertEqual(off.renderState, .gatedOff)

        let (errored, _) = makeGrafanaModel(
            NLGrafanaPanelInputSnapshot(gate: .loading, errorMessage: "boom")
        )
        errored.start()
        XCTAssertEqual(errored.renderState, .gateError("boom"))

        let (ready, _) = makeGrafanaModel(grafanaReadyInput)
        ready.start()
        XCTAssertEqual(ready.renderState, .ready)
    }

    func testGatedOffWinsOverError() {
        let (model, _) = makeGrafanaModel(
            NLGrafanaPanelInputSnapshot(gate: .off, errorMessage: "ignored")
        )
        model.start()
        XCTAssertEqual(model.renderState, .gatedOff)
    }

    func testPromptDrivesCanStart() {
        let (model, _) = makeGrafanaModel(grafanaReadyInput)
        model.start()
        XCTAssertFalse(model.canStart)
        XCTAssertEqual(model.emptyHint, .enterPrompt)
        model.prompt = "show me a daily time series"
        XCTAssertTrue(model.canStart)
        XCTAssertNil(model.emptyHint)
        XCTAssertFalse(model.buttonDisabled)
    }

    func testAskStartsStreamWithProjectedBodyAndClearsPriorDraftAndRationale() {
        let (model, source) = makeGrafanaModel(grafanaReadyInput, prompt: "  daily distance panel  ")
        model.start()
        source.pushEvent(.delta(text: "stale rationale"))
        source.pushDraft(grafanaSampleDraft)
        XCTAssertNotNil(model.draft)
        model.ask()
        XCTAssertNil(model.draft)
        XCTAssertEqual(model.streamText, "")
        XCTAssertEqual(source.startStreamCount, 1)
        XCTAssertEqual(source.lastStreamPrompt, "daily distance panel")
        XCTAssertEqual(model.phase, .streaming)
    }

    func testAskIsNoOpWhileBusy() {
        let (model, source) = makeGrafanaModel(grafanaReadyInput, prompt: "go")
        model.start()
        source.pushStreamState(.streaming)
        model.ask()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testAskIsNoOpWithoutPrompt() {
        let (model, source) = makeGrafanaModel(grafanaReadyInput, prompt: "   ")
        model.start()
        model.ask()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testAskIsNoOpWhenOffline() {
        let (model, source) = makeGrafanaModel(grafanaReadyInput, prompt: "go")
        model.start()
        source.pushInput(NLGrafanaPanelInputSnapshot(gate: .on, connection: .offline))
        model.ask()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testDeltaAccumulatesRationaleText() {
        let (model, source) = makeGrafanaModel(grafanaReadyInput, prompt: "go")
        model.start()
        source.pushStreamState(.streaming)
        source.pushEvent(.delta(text: "Drafting "))
        source.pushEvent(.delta(text: "a time-series panel."))
        XCTAssertEqual(model.streamText, "Drafting a time-series panel.")
        XCTAssertTrue(model.outputVisible)
    }

    func testCancelDelegatesToSource() {
        let (model, source) = makeGrafanaModel(grafanaReadyInput)
        model.start()
        model.cancel()
        XCTAssertEqual(source.cancelStreamCount, 1)
    }

    func testRefreshClearsGateErrorAndDelegates() {
        let (model, source) = makeGrafanaModel(
            NLGrafanaPanelInputSnapshot(gate: .loading, errorMessage: "down")
        )
        model.start()
        XCTAssertEqual(model.renderState, .gateError("down"))
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertNotEqual(model.renderState, .gateError("down"))
    }

    func testStopCancelsStreamAndReArms() {
        let (model, source) = makeGrafanaModel(grafanaReadyInput)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(source.cancelStreamCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceViewAliasesMatchConstants() {
        XCTAssertEqual(AINLGrafanaPanel.surfaceSlug, NLGrafanaPanelSurface.slug)
        XCTAssertEqual(AINLGrafanaPanel.featureID, NLGrafanaPanelSurface.featureID)
    }
}

// MARK: - State holder: draft capture, apply, stream + freshness

@MainActor final class NLGrafanaPanelDraftAndStreamTests: XCTestCase {
    func testToolResultCapturesDraft() {
        let (model, source) = makeGrafanaModel(grafanaReadyInput, prompt: "go")
        model.start()
        source.pushDraft(grafanaSampleDraft, rationaleDeltas: ["Drafting panel."])
        XCTAssertEqual(model.draft, grafanaSampleDraft)
        XCTAssertEqual(model.streamText, "Drafting panel.")
        XCTAssertEqual(model.phase, .done)
        XCTAssertTrue(model.canApply)
    }

    func testToolResultWithWrongNameIsIgnored() {
        let (model, source) = makeGrafanaModel(grafanaReadyInput, prompt: "go")
        model.start()
        // A well-formed draft envelope under a non-matching tool name must be ignored
        // (web `ev.name === 'draft_grafana_panel'` guard).
        source.pushEvent(.toolResult(
            id: "tr-1", name: "some_other_tool", ok: true, data: grafanaDraftEnvelope()
        ))
        XCTAssertNil(model.draft)
    }

    func testToolResultWithNonOkStatusIsIgnored() {
        let (model, source) = makeGrafanaModel(grafanaReadyInput, prompt: "go")
        model.start()
        source.pushToolResult(json: "{\"status\":\"error\",\"message\":\"denied\"}")
        XCTAssertNil(model.draft)
    }

    func testToolResultWithMalformedDataIsIgnored() {
        let (model, source) = makeGrafanaModel(grafanaReadyInput, prompt: "go")
        model.start()
        source.pushToolResult(json: "not even json")
        XCTAssertNil(model.draft)
    }

    func testCanApplyGate() {
        let (model, source) = makeGrafanaModel(grafanaReadyInput, prompt: "go")
        model.start()
        XCTAssertFalse(model.canApply)
        source.pushStreamState(.streaming)
        source.pushEvent(.toolResult(
            id: "tr-1",
            name: NLGrafanaPanelSurface.draftToolName,
            ok: true,
            data: grafanaDraftEnvelope()
        ))
        // Draft captured but still streaming → not yet applicable (web `canApply`).
        XCTAssertNotNil(model.draft)
        XCTAssertFalse(model.canApply)
        source.pushStreamState(.done)
        XCTAssertTrue(model.canApply)
    }

    func testApplyForwardsCapturedDraft() {
        var applied: [GrafanaPanelDraft] = []
        let (model, source) = makeGrafanaModel(grafanaReadyInput, prompt: "go") { applied.append($0) }
        model.start()
        source.pushDraft(grafanaSampleDraft)
        model.apply()
        XCTAssertEqual(applied, [grafanaSampleDraft])
    }

    func testApplyIsNoOpWithoutDraft() {
        var applied: [GrafanaPanelDraft] = []
        let (model, _) = makeGrafanaModel(grafanaReadyInput, prompt: "go") { applied.append($0) }
        model.start()
        model.apply()
        XCTAssertTrue(applied.isEmpty)
    }

    func testApplyIsNoOpWhileStreaming() {
        var applied: [GrafanaPanelDraft] = []
        let (model, source) = makeGrafanaModel(grafanaReadyInput, prompt: "go") { applied.append($0) }
        model.start()
        source.pushStreamState(.streaming)
        source.pushEvent(.toolResult(
            id: "tr-1",
            name: NLGrafanaPanelSurface.draftToolName,
            ok: true,
            data: grafanaDraftEnvelope()
        ))
        model.apply()
        XCTAssertTrue(applied.isEmpty)
    }

    func testNonDeltaNonToolEventsAreIgnored() {
        let (model, source) = makeGrafanaModel(grafanaReadyInput, prompt: "go")
        model.start()
        source.pushEvent(.toolCall(id: "tc-1", name: "draft_grafana_panel"))
        source.pushEvent(.confirmRequest(continuationID: "c-1", tool: "x", summary: "y"))
        source.pushEvent(.done(finishReason: "stop"))
        XCTAssertEqual(model.streamText, "")
        XCTAssertNil(model.draft)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeGrafanaModel(grafanaReadyInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.pushInput(NLGrafanaPanelInputSnapshot(gate: .on, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.pushInput(NLGrafanaPanelInputSnapshot(gate: .on, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefreshAndDisablesButton() {
        let (model, source) = makeGrafanaModel(grafanaReadyInput, prompt: "go")
        model.start()
        source.pushInput(NLGrafanaPanelInputSnapshot(gate: .on, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
        XCTAssertTrue(model.buttonDisabled)
    }

    func testPhaseDrivesBusyAndThinking() {
        let (model, source) = makeGrafanaModel(grafanaReadyInput, prompt: "go")
        model.start()
        XCTAssertFalse(model.buttonDisabled)
        source.pushStreamState(.streaming)
        XCTAssertTrue(model.isBusy)
        XCTAssertTrue(model.buttonDisabled)
        XCTAssertTrue(model.thinkingVisible)
    }

    func testStreamErrorPhaseSurfacesAndKeepsCardReady() {
        let (model, source) = makeGrafanaModel(grafanaReadyInput, prompt: "go")
        model.start()
        source.pushStreamState(.error("rate limited"))
        XCTAssertEqual(model.phase, .error("rate limited"))
        XCTAssertEqual(model.renderState, .ready)
        XCTAssertTrue(model.outputVisible)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyNLGrafanaPanelTelemetry: NLGrafanaPanelTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
