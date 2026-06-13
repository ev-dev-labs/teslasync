//
//  AINLDashboardComposer.ModelTests.swift
//  TeslaSync — P4 shared surface · 0031 · AINLDashboardComposer (Apple)
//
//  State-holder coverage split out of `…Tests.swift` (one file ≤ 400 lines per the SwiftLint
//  contract): `NLDashboardComposerModel` wiring — the gate render axis, the P1/S11 `view.opened`
//  telemetry, the prompt-driven canStart, the ask double-submit / disabled guard + body
//  forwarding, the delta rationale accumulation, the `draft_dashboard_layout` capture + the
//  propose-only `apply` forwarding, the stale auto-refresh, and the offline guard. Driven
//  entirely by `InMemoryNLDashboardComposerSource`; no network, no real store. The cases are
//  split across two XCTestCase classes (wiring/actions vs draft/stream) to stay under the
//  SwiftLint `type_body_length` budget; both share the file-scope fixtures below.
//

import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures

@MainActor
private func makeDashModel(
    _ input: NLDashboardComposerInputSnapshot,
    prompt: String = "",
    telemetry: NLDashboardComposerTelemetry = OSLogNLDashboardComposerTelemetry(),
    onApply: @escaping (DashboardLayoutDraft) -> Void = { _ in }
) -> (NLDashboardComposerModel, InMemoryNLDashboardComposerSource) {
    let source = InMemoryNLDashboardComposerSource(initial: input)
    let model = NLDashboardComposerModel(source: source, telemetry: telemetry, onApply: onApply)
    model.prompt = prompt
    return (model, source)
}

private let dashReadyInput = NLDashboardComposerInputSnapshot(gate: .on)

private let dashSampleDraft = DashboardLayoutDraft(
    prompt: "give me an overview dashboard",
    dashboard: DashboardEnvelope(
        title: "Fleet Overview",
        slots: [
            DashboardSlot(
                panelName: "daily-drives",
                gridPos: DashboardSlotGrid(x: 0, y: 0, width: 12, height: 8)
            ),
            DashboardSlot(
                panelName: "current-battery",
                gridPos: DashboardSlotGrid(x: 0, y: 8, width: 6, height: 8)
            )
        ]
    ),
    rationale: "Daily drives plus the current battery state.",
    referencedPanels: ["daily-drives", "current-battery"]
)

private func dashDraftEnvelope() -> Data {
    InMemoryNLDashboardComposerSource.envelope(for: dashSampleDraft)
}

// MARK: - State holder: wiring, gate, actions, lifecycle

@MainActor final class NLDashboardComposerModelTests: XCTestCase {
    func testStartEmitsTelemetryOnceAndAppliesInitial() {
        let spy = SpyNLDashboardComposerTelemetry()
        let (model, source) = makeDashModel(dashReadyInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.renderState, .ready)
        XCTAssertEqual(spy.surfaces, [NLDashboardComposerSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGateRenderAxis() {
        let (loading, _) = makeDashModel(NLDashboardComposerInputSnapshot(gate: .loading))
        loading.start()
        XCTAssertEqual(loading.renderState, .gateLoading)

        let (off, _) = makeDashModel(NLDashboardComposerInputSnapshot(gate: .off))
        off.start()
        XCTAssertEqual(off.renderState, .gatedOff)

        let (errored, _) = makeDashModel(
            NLDashboardComposerInputSnapshot(gate: .loading, errorMessage: "boom")
        )
        errored.start()
        XCTAssertEqual(errored.renderState, .gateError("boom"))

        let (ready, _) = makeDashModel(dashReadyInput)
        ready.start()
        XCTAssertEqual(ready.renderState, .ready)
    }

    func testGatedOffWinsOverError() {
        let (model, _) = makeDashModel(
            NLDashboardComposerInputSnapshot(gate: .off, errorMessage: "ignored")
        )
        model.start()
        XCTAssertEqual(model.renderState, .gatedOff)
    }

    func testPromptDrivesCanStart() {
        let (model, _) = makeDashModel(dashReadyInput)
        model.start()
        XCTAssertFalse(model.canStart)
        XCTAssertEqual(model.emptyHint, .enterPrompt)
        model.prompt = "give me an overview dashboard"
        XCTAssertTrue(model.canStart)
        XCTAssertNil(model.emptyHint)
        XCTAssertFalse(model.buttonDisabled)
    }

    func testAskStartsStreamWithProjectedBodyAndClearsPriorDraftAndRationale() {
        let (model, source) = makeDashModel(dashReadyInput, prompt: "  give me an overview dashboard  ")
        model.start()
        source.pushEvent(.delta(text: "stale rationale"))
        source.pushDraft(dashSampleDraft)
        XCTAssertNotNil(model.draft)
        model.ask()
        XCTAssertNil(model.draft)
        XCTAssertEqual(model.streamText, "")
        XCTAssertEqual(source.startStreamCount, 1)
        XCTAssertEqual(source.lastStreamPrompt, "give me an overview dashboard")
        XCTAssertEqual(model.phase, .streaming)
    }

    func testAskIsNoOpWhileBusy() {
        let (model, source) = makeDashModel(dashReadyInput, prompt: "go")
        model.start()
        source.pushStreamState(.streaming)
        model.ask()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testAskIsNoOpWithoutPrompt() {
        let (model, source) = makeDashModel(dashReadyInput, prompt: "   ")
        model.start()
        model.ask()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testAskIsNoOpWhenOffline() {
        let (model, source) = makeDashModel(dashReadyInput, prompt: "go")
        model.start()
        source.pushInput(NLDashboardComposerInputSnapshot(gate: .on, connection: .offline))
        model.ask()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testDeltaAccumulatesRationaleText() {
        let (model, source) = makeDashModel(dashReadyInput, prompt: "go")
        model.start()
        source.pushStreamState(.streaming)
        source.pushEvent(.delta(text: "Composing "))
        source.pushEvent(.delta(text: "an overview dashboard."))
        XCTAssertEqual(model.streamText, "Composing an overview dashboard.")
        XCTAssertTrue(model.outputVisible)
    }

    func testCancelDelegatesToSource() {
        let (model, source) = makeDashModel(dashReadyInput)
        model.start()
        model.cancel()
        XCTAssertEqual(source.cancelStreamCount, 1)
    }

    func testRefreshClearsGateErrorAndDelegates() {
        let (model, source) = makeDashModel(
            NLDashboardComposerInputSnapshot(gate: .loading, errorMessage: "down")
        )
        model.start()
        XCTAssertEqual(model.renderState, .gateError("down"))
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertNotEqual(model.renderState, .gateError("down"))
    }

    func testStopCancelsStreamAndReArms() {
        let (model, source) = makeDashModel(dashReadyInput)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(source.cancelStreamCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceViewAliasesMatchConstants() {
        XCTAssertEqual(AINLDashboardComposer.surfaceSlug, NLDashboardComposerSurface.slug)
        XCTAssertEqual(AINLDashboardComposer.featureID, NLDashboardComposerSurface.featureID)
    }
}

// MARK: - State holder: draft capture, apply, stream + freshness

@MainActor final class NLDashboardComposerDraftAndStreamTests: XCTestCase {
    func testToolResultCapturesDraft() {
        let (model, source) = makeDashModel(dashReadyInput, prompt: "go")
        model.start()
        source.pushDraft(dashSampleDraft, rationaleDeltas: ["Composing dashboard."])
        XCTAssertEqual(model.draft, dashSampleDraft)
        XCTAssertEqual(model.streamText, "Composing dashboard.")
        XCTAssertEqual(model.phase, .done)
        XCTAssertTrue(model.canApply)
    }

    func testToolResultWithWrongNameIsIgnored() {
        let (model, source) = makeDashModel(dashReadyInput, prompt: "go")
        model.start()
        // A well-formed draft envelope under a non-matching tool name must be ignored
        // (web `ev.name === 'draft_dashboard_layout'` guard).
        source.pushEvent(.toolResult(
            id: "tr-1", name: "some_other_tool", ok: true, data: dashDraftEnvelope()
        ))
        XCTAssertNil(model.draft)
    }

    func testToolResultWithNonOkStatusIsIgnored() {
        let (model, source) = makeDashModel(dashReadyInput, prompt: "go")
        model.start()
        source.pushToolResult(json: "{\"status\":\"error\",\"message\":\"denied\"}")
        XCTAssertNil(model.draft)
    }

    func testToolResultWithMalformedDataIsIgnored() {
        let (model, source) = makeDashModel(dashReadyInput, prompt: "go")
        model.start()
        source.pushToolResult(json: "not even json")
        XCTAssertNil(model.draft)
    }

    func testCanApplyGate() {
        let (model, source) = makeDashModel(dashReadyInput, prompt: "go")
        model.start()
        XCTAssertFalse(model.canApply)
        source.pushStreamState(.streaming)
        source.pushEvent(.toolResult(
            id: "tr-1",
            name: NLDashboardComposerSurface.draftToolName,
            ok: true,
            data: dashDraftEnvelope()
        ))
        // Draft captured but still streaming → not yet applicable (web `canApply`).
        XCTAssertNotNil(model.draft)
        XCTAssertFalse(model.canApply)
        source.pushStreamState(.done)
        XCTAssertTrue(model.canApply)
    }

    func testApplyForwardsCapturedDraft() {
        var applied: [DashboardLayoutDraft] = []
        let (model, source) = makeDashModel(dashReadyInput, prompt: "go") { applied.append($0) }
        model.start()
        source.pushDraft(dashSampleDraft)
        model.apply()
        XCTAssertEqual(applied, [dashSampleDraft])
    }

    func testApplyIsNoOpWithoutDraft() {
        var applied: [DashboardLayoutDraft] = []
        let (model, _) = makeDashModel(dashReadyInput, prompt: "go") { applied.append($0) }
        model.start()
        model.apply()
        XCTAssertTrue(applied.isEmpty)
    }

    func testApplyIsNoOpWhileStreaming() {
        var applied: [DashboardLayoutDraft] = []
        let (model, source) = makeDashModel(dashReadyInput, prompt: "go") { applied.append($0) }
        model.start()
        source.pushStreamState(.streaming)
        source.pushEvent(.toolResult(
            id: "tr-1",
            name: NLDashboardComposerSurface.draftToolName,
            ok: true,
            data: dashDraftEnvelope()
        ))
        model.apply()
        XCTAssertTrue(applied.isEmpty)
    }

    func testNonDeltaNonToolEventsAreIgnored() {
        let (model, source) = makeDashModel(dashReadyInput, prompt: "go")
        model.start()
        source.pushEvent(.toolCall(id: "tc-1", name: "draft_dashboard_layout"))
        source.pushEvent(.confirmRequest(continuationID: "c-1", tool: "x", summary: "y"))
        source.pushEvent(.done(finishReason: "stop"))
        XCTAssertEqual(model.streamText, "")
        XCTAssertNil(model.draft)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeDashModel(dashReadyInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.pushInput(NLDashboardComposerInputSnapshot(gate: .on, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.pushInput(NLDashboardComposerInputSnapshot(gate: .on, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefreshAndDisablesButton() {
        let (model, source) = makeDashModel(dashReadyInput, prompt: "go")
        model.start()
        source.pushInput(NLDashboardComposerInputSnapshot(gate: .on, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
        XCTAssertTrue(model.buttonDisabled)
    }

    func testPhaseDrivesBusyAndThinking() {
        let (model, source) = makeDashModel(dashReadyInput, prompt: "go")
        model.start()
        XCTAssertFalse(model.buttonDisabled)
        source.pushStreamState(.streaming)
        XCTAssertTrue(model.isBusy)
        XCTAssertTrue(model.buttonDisabled)
        XCTAssertTrue(model.thinkingVisible)
    }

    func testStreamErrorPhaseSurfacesAndKeepsCardReady() {
        let (model, source) = makeDashModel(dashReadyInput, prompt: "go")
        model.start()
        source.pushStreamState(.error("rate limited"))
        XCTAssertEqual(model.phase, .error("rate limited"))
        XCTAssertEqual(model.renderState, .ready)
        XCTAssertTrue(model.outputVisible)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyNLDashboardComposerTelemetry: NLDashboardComposerTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
