//
//  AIPiiRedactionSharedExports.ModelTests.swift
//  TeslaSync — P4 shared surface · 0038 · AIPiiRedactionSharedExports (Apple)
//
//  State-holder coverage split out of `…Tests.swift` (one file ≤ 400 lines per the SwiftLint
//  contract): `PiiRedactionExportsModel` wiring — the gate render axis, the P1/S11 `view.opened`
//  telemetry, the export-type-driven canStart, the suggest double-submit guard + body forwarding
//  (incl. the empty-string body when nothing is picked), the delta text accumulation, the
//  web-faithful absence of a context-change cleanup, and the stale auto-refresh. Driven entirely
//  by `InMemoryPiiRedactionExportsSource`; no network, no real store.
//

import XCTest
@testable import TeslaSync

@MainActor final class PiiRedactionExportsModelTests: XCTestCase {
    private func makeModel(
        _ input: PiiRedactionExportsInputSnapshot,
        selectedType: PiiRedactionExportType? = nil,
        telemetry: PiiRedactionExportsTelemetry = OSLogPiiRedactionExportsTelemetry()
    ) -> (PiiRedactionExportsModel, InMemoryPiiRedactionExportsSource) {
        let source = InMemoryPiiRedactionExportsSource(initial: input)
        let model = PiiRedactionExportsModel(source: source, telemetry: telemetry)
        model.selectedType = selectedType
        return (model, source)
    }

    private var readyInput: PiiRedactionExportsInputSnapshot {
        PiiRedactionExportsInputSnapshot(gate: .on)
    }

    func testStartEmitsTelemetryOnceAndAppliesInitial() {
        let spy = SpyPiiRedactionExportsTelemetry()
        let (model, source) = makeModel(readyInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.renderState, .ready)
        XCTAssertEqual(spy.surfaces, [PiiRedactionExportsSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGateRenderAxis() {
        let (loading, _) = makeModel(PiiRedactionExportsInputSnapshot(gate: .loading))
        loading.start()
        XCTAssertEqual(loading.renderState, .gateLoading)

        let (off, _) = makeModel(PiiRedactionExportsInputSnapshot(gate: .off))
        off.start()
        XCTAssertEqual(off.renderState, .gatedOff)

        let (errored, _) = makeModel(
            PiiRedactionExportsInputSnapshot(gate: .loading, errorMessage: "boom")
        )
        errored.start()
        XCTAssertEqual(errored.renderState, .gateError("boom"))

        let (ready, _) = makeModel(readyInput)
        ready.start()
        XCTAssertEqual(ready.renderState, .ready)
    }

    func testGatedOffWinsOverError() {
        let (model, _) = makeModel(
            PiiRedactionExportsInputSnapshot(gate: .off, errorMessage: "ignored")
        )
        model.start()
        XCTAssertEqual(model.renderState, .gatedOff)
    }

    func testExportTypeDrivesCanStart() {
        let (model, _) = makeModel(readyInput)
        model.start()
        XCTAssertFalse(model.canStart)
        XCTAssertEqual(model.emptyHint, .pickExportType)
        model.selectedType = .drives
        XCTAssertTrue(model.canStart)
        XCTAssertNil(model.emptyHint)
        XCTAssertFalse(model.buttonDisabled)
    }

    func testSuggestStartsStreamWithBodyAndClearsText() {
        let (model, source) = makeModel(readyInput, selectedType: .charging)
        model.start()
        source.pushNarrative(["partial output"])
        XCTAssertEqual(model.streamText, "partial output")
        model.suggest()
        XCTAssertEqual(model.streamText, "")
        XCTAssertEqual(source.startStreamCount, 1)
        XCTAssertEqual(source.lastStreamExportType, "charging")
        XCTAssertEqual(model.phase, .streaming)
    }

    func testSuggestIsNoOpWhileBusy() {
        let (model, source) = makeModel(readyInput, selectedType: .drives)
        model.start()
        source.pushStreamState(.streaming)
        model.suggest()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testSuggestForwardsEmptyStringWhenNoTypeChosen() {
        // Web body sends `export_type: exportType` where the resting value is the empty string.
        // The action is normally disabled with no type, but the model still forwards "" if
        // `suggest()` is invoked directly.
        let (model, source) = makeModel(readyInput, selectedType: nil)
        model.start()
        model.suggest()
        XCTAssertEqual(source.lastStreamExportType, "")
    }

    func testDeltaAccumulatesStreamText() {
        let (model, source) = makeModel(readyInput, selectedType: .trips)
        model.start()
        source.pushStreamState(.streaming)
        source.pushEvent(.delta(text: "Redact "))
        source.pushEvent(.delta(text: "GPS…"))
        XCTAssertEqual(model.streamText, "Redact GPS…")
        XCTAssertTrue(model.outputVisible)
    }

    func testNonDeltaEventsDoNotMutateText() {
        let (model, source) = makeModel(readyInput, selectedType: .drives)
        model.start()
        source.pushEvent(.toolResult(id: "1", name: "plan", ok: true))
        source.pushEvent(.done(finishReason: "stop"))
        XCTAssertEqual(model.streamText, "")
    }

    func testPhaseDrivesBusyAndThinking() {
        let (model, source) = makeModel(readyInput, selectedType: .drives)
        model.start()
        XCTAssertFalse(model.buttonDisabled)
        source.pushStreamState(.streaming)
        XCTAssertTrue(model.isBusy)
        XCTAssertTrue(model.buttonDisabled)
        XCTAssertTrue(model.thinkingVisible)
    }

    func testErrorPhaseSurfacesInProjection() {
        let (model, source) = makeModel(readyInput, selectedType: .drives)
        model.start()
        source.pushStreamState(.error("rate limited"))
        XCTAssertEqual(model.phase, .error("rate limited"))
        XCTAssertTrue(model.outputVisible)
        XCTAssertFalse(model.thinkingVisible)
    }

    func testContextChangeKeepsStreamAndText() {
        // AIPiiRedactionSharedExports has NO web context-change cleanup effect: a gate/context
        // snapshot update keeps the stream + the accumulated output + the chosen type intact.
        let (model, source) = makeModel(readyInput, selectedType: .analytics)
        model.start()
        source.pushNarrative(["streamed output"])
        XCTAssertEqual(model.streamText, "streamed output")
        XCTAssertEqual(model.phase, .done)

        source.pushInput(PiiRedactionExportsInputSnapshot(gate: .on))
        XCTAssertEqual(source.cancelStreamCount, 0)
        XCTAssertEqual(model.streamText, "streamed output")
        XCTAssertEqual(model.phase, .done)
        XCTAssertEqual(model.selectedType, .analytics)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(readyInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.pushInput(PiiRedactionExportsInputSnapshot(gate: .on, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.pushInput(PiiRedactionExportsInputSnapshot(gate: .on, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefreshAndDisablesButton() {
        let (model, source) = makeModel(readyInput, selectedType: .drives)
        model.start()
        source.pushInput(PiiRedactionExportsInputSnapshot(gate: .on, connection: .offline))
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
            PiiRedactionExportsInputSnapshot(gate: .loading, errorMessage: "down")
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
private final class SpyPiiRedactionExportsTelemetry: PiiRedactionExportsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
