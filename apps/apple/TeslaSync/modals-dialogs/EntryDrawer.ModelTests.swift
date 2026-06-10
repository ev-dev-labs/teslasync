//
//  EntryDrawer.ModelTests.swift
//  TeslaSync — P4 modal / dialog · 0018 · EntryDrawer (Apple)
//
//  State-holder coverage for `EntryDrawerModel`: the P1/S11 `view.opened` telemetry (once +
//  idempotent), the body-phase transitions across loading / summary-only-loading / loaded-content /
//  loaded-empty / failed (incl. the inline-error envelope when a cached head survives a failed
//  reload), the `head = full ?? summary` resolution + title, the KVList rows (em-dash fallbacks +
//  grouped redeliveries + absolute timestamp), the payload decode + binary fallback + copy
//  fallback, the tab switch (resets copied), the copy seam, the replay seam + its disable gates,
//  the stale auto-refresh (once, re-armed on return to live), and offline keeping the cached entry.
//  The exhaustive replay-disabled + phase matrices live in EntryDrawer.Tests.swift; here we verify
//  the model wires them through. Driven through the in-memory source — no network.
//

import XCTest
@testable import TeslaSync

/// Records the `view.opened` surfaces. Lock-guarded for the `Sendable` seam under Swift 6 strict
/// concurrency.
private final class SpyEntryDrawerTelemetry: EntryDrawerTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func viewOpened(surface: String) {
        lock.lock(); storage.append(surface); lock.unlock()
    }

    var surfaces: [String] {
        lock.lock(); defer { lock.unlock() }; return storage
    }
}

/// Records the clipboard copy seam calls.
private final class RecordingEntryDrawerClipboard: EntryDrawerClipboard, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func copy(_ text: String) {
        lock.lock(); storage.append(text); lock.unlock()
    }

    var copied: [String] {
        lock.lock(); defer { lock.unlock() }; return storage
    }
}

/// Records the replay action seam calls.
private final class RecordingEntryDrawerReplayAction: EntryDrawerReplayAction, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [Int64] = []

    func replay(id: Int64) {
        lock.lock(); storage.append(id); lock.unlock()
    }

    var replayedIDs: [Int64] {
        lock.lock(); defer { lock.unlock() }; return storage
    }
}

/// Deterministic date facade so the "Arrived" row is assertable without locale drift.
private struct FixedEntryDrawerDateFormatting: EntryDrawerDateFormatting {
    func absolute(_ date: Date) -> String {
        "ABS:\(Int(date.timeIntervalSince1970))"
    }
}

private enum EntryDrawerModelSamples {
    static let anchor = Date(timeIntervalSince1970: 1_717_000_000)

    static func summary(
        vin: String? = "5YJ3E1EA7KF000000",
        sourceTopic: String? = "telemetry/5YJ/v/VehicleSpeed",
        redeliveries: Int? = 3,
        parseError: String? = nil,
        replayable: Bool = true
    ) -> EntryDrawerSummary {
        EntryDrawerSummary(
            id: 4821,
            arrivedAt: anchor.addingTimeInterval(-3600),
            dlqTopic: "telemetry.dlq/5YJ/v/VehicleSpeed",
            parsedReason: "codec: unknown enum value 99",
            parsedVehicleID: 12,
            parsedVIN: vin,
            parsedSourceTopic: sourceTopic,
            parsedRedeliveries: redeliveries,
            parsedTimestamp: anchor.addingTimeInterval(-3605),
            parseError: parseError,
            replayable: replayable,
            rawPayloadSize: 412,
            innerPayloadSize: 128
        )
    }

    static func fullUTF8(replayable: Bool = true) -> EntryDrawerFull {
        EntryDrawerFull(
            summary: summary(replayable: replayable),
            rawPayloadBase64: Data(#"{"raw":true}"#.utf8).base64EncodedString(),
            innerPayloadBase64: Data(#"{"field":"VehicleSpeed"}"#.utf8).base64EncodedString()
        )
    }

    static func fullBinary() -> EntryDrawerFull {
        let bytes = Data([0xFF, 0xFE, 0xFD, 0x00])
        return EntryDrawerFull(
            summary: summary(),
            rawPayloadBase64: bytes.base64EncodedString(),
            innerPayloadBase64: bytes.base64EncodedString()
        )
    }
}

@MainActor
final class EntryDrawerModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryEntryDrawerSource,
        telemetry: SpyEntryDrawerTelemetry = SpyEntryDrawerTelemetry(),
        clipboard: RecordingEntryDrawerClipboard = RecordingEntryDrawerClipboard(),
        replayAction: RecordingEntryDrawerReplayAction = RecordingEntryDrawerReplayAction()
    ) -> EntryDrawerModel {
        EntryDrawerModel(
            source: source,
            telemetry: telemetry,
            clipboard: clipboard,
            replayAction: replayAction,
            dates: FixedEntryDrawerDateFormatting(),
            localize: { _, fallback in fallback }
        )
    }

    /// A "loaded with full UTF-8 payload" snapshot — the common content fixture.
    private func loadedFull(
        connection: EntryDrawerConnection = .live,
        replayEnabled: Bool = true,
        replayInFlight: Bool = false
    ) -> EntryDrawerUpdate {
        EntryDrawerUpdate(
            status: .loaded,
            summary: EntryDrawerModelSamples.summary(),
            full: EntryDrawerModelSamples.fullUTF8(),
            replayEnabled: replayEnabled,
            replayInFlight: replayInFlight,
            connection: connection
        )
    }

    private func value(_ model: EntryDrawerModel, _ key: String) -> String? {
        model.rows.first { $0.key == key }?.value
    }

    // MARK: Telemetry

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyEntryDrawerTelemetry()
        let source = InMemoryEntryDrawerSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["EntryDrawer"])
        XCTAssertEqual(source.startCount, 1)
    }

    // MARK: Phases

    func testLoadingWithoutFullShowsLoading() {
        let model = makeModel(source: InMemoryEntryDrawerSource(initial: EntryDrawerUpdate(status: .loading)))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testSummaryOnlyWhileLoadingStillShowsSpinner() {
        // Web: `loading && !full` shows the spinner even though the summary is cached.
        let update = EntryDrawerUpdate(status: .loading, summary: EntryDrawerModelSamples.summary())
        let model = makeModel(source: InMemoryEntryDrawerSource(initial: update))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.hasHead)
    }

    func testFullResolvesToContentEvenWhileBackgroundLoading() {
        let update = EntryDrawerUpdate(
            status: .loading,
            summary: EntryDrawerModelSamples.summary(),
            full: EntryDrawerModelSamples.fullUTF8()
        )
        let model = makeModel(source: InMemoryEntryDrawerSource(initial: update))
        model.start()
        XCTAssertEqual(model.phase, .content)
    }

    func testLoadedWithFullIsContentWithRowsAndTitle() {
        let model = makeModel(source: InMemoryEntryDrawerSource(initial: loadedFull()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.rows.count, 8)
        XCTAssertEqual(model.title, "DLQ entry #4821")
    }

    func testLoadedWithoutHeadIsEmptyWithFallbackTitle() {
        let model = makeModel(source: InMemoryEntryDrawerSource(initial: EntryDrawerUpdate(status: .loaded)))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.title, "DLQ entry")
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testFailedWithoutHeadIsError() {
        let update = EntryDrawerUpdate(status: .failed("boom"))
        let model = makeModel(source: InMemoryEntryDrawerSource(initial: update))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testFailedWithHeadKeepsContentAndSurfacesInlineError() {
        let source = InMemoryEntryDrawerSource(initial: loadedFull())
        let model = makeModel(source: source)
        model.start()
        source.push(EntryDrawerUpdate(
            status: .failed("stale read"),
            summary: EntryDrawerModelSamples.summary(),
            full: EntryDrawerModelSamples.fullUTF8()
        ))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.inlineErrorMessage, "stale read")
    }

    // MARK: Head + rows

    func testHeadPrefersFullSummary() {
        let update = EntryDrawerUpdate(
            status: .loaded,
            summary: EntryDrawerModelSamples.summary(),
            full: EntryDrawerModelSamples.fullUTF8()
        )
        let model = makeModel(source: InMemoryEntryDrawerSource(initial: update))
        model.start()
        XCTAssertEqual(model.head?.id, 4821)
    }

    func testRowsRenderEmDashFallbacksAndTimestamp() {
        let summary = EntryDrawerModelSamples.summary(
            vin: nil, sourceTopic: nil, redeliveries: nil, parseError: nil
        )
        let update = EntryDrawerUpdate(status: .loaded, summary: summary)
        let model = makeModel(source: InMemoryEntryDrawerSource(initial: update))
        model.start()
        XCTAssertEqual(value(model, "vin"), "—")
        XCTAssertEqual(value(model, "sourceTopic"), "—")
        XCTAssertEqual(value(model, "redeliveries"), "—")
        XCTAssertEqual(value(model, "parseError"), "—")
        XCTAssertEqual(value(model, "arrivedAt"), "ABS:\(Int(summary.arrivedAt.timeIntervalSince1970))")
    }

    func testRowsRenderGroupedRedeliveriesAndID() {
        let update = EntryDrawerUpdate(status: .loaded, summary: EntryDrawerModelSamples.summary(redeliveries: 12345))
        let model = makeModel(source: InMemoryEntryDrawerSource(initial: update))
        model.start()
        XCTAssertEqual(value(model, "redeliveries"), "12,345")
        XCTAssertEqual(value(model, "id"), "4821")
    }

    // MARK: Payload + copy

    func testPayloadDecodesUTF8AndCopiesDecoded() {
        let model = makeModel(source: InMemoryEntryDrawerSource(initial: loadedFull()))
        model.start()
        XCTAssertEqual(model.payloadDisplayText, #"{"field":"VehicleSpeed"}"#)
        XCTAssertEqual(model.activeCopyText, #"{"field":"VehicleSpeed"}"#)
    }

    func testBinaryPayloadShowsFallbackAndCopiesBase64() {
        let full = EntryDrawerModelSamples.fullBinary()
        let update = EntryDrawerUpdate(status: .loaded, summary: EntryDrawerModelSamples.summary(), full: full)
        let model = makeModel(source: InMemoryEntryDrawerSource(initial: update))
        model.start()
        XCTAssertTrue(model.payloadDisplayText.contains("128"))
        XCTAssertTrue(model.payloadDisplayText.contains("non-UTF-8 binary"))
        XCTAssertEqual(model.activeCopyText, full.innerPayloadBase64)
    }

    func testTabSwitchChangesActiveAndResetsCopied() {
        let model = makeModel(source: InMemoryEntryDrawerSource(initial: loadedFull()))
        model.start()
        model.copyActivePayload()
        XCTAssertTrue(model.copied)
        model.selectTab(.raw)
        XCTAssertEqual(model.activeTab, .raw)
        XCTAssertFalse(model.copied)
        XCTAssertEqual(model.activeCopyText, #"{"raw":true}"#)
    }

    func testCopyInvokesClipboardAndResets() {
        let clipboard = RecordingEntryDrawerClipboard()
        let model = makeModel(source: InMemoryEntryDrawerSource(initial: loadedFull()), clipboard: clipboard)
        model.start()
        model.copyActivePayload()
        XCTAssertEqual(clipboard.copied, [#"{"field":"VehicleSpeed"}"#])
        XCTAssertTrue(model.copied)
        model.resetCopied()
        XCTAssertFalse(model.copied)
    }

    // MARK: Replay

    func testReplayEnabledInvokesActionWithHeadID() {
        let replay = RecordingEntryDrawerReplayAction()
        let model = makeModel(source: InMemoryEntryDrawerSource(initial: loadedFull()), replayAction: replay)
        model.start()
        XCTAssertFalse(model.replayDisabled)
        model.replay()
        XCTAssertEqual(replay.replayedIDs, [4821])
    }

    func testReplayDisabledWhenServerFlagOffIsNoOp() {
        let replay = RecordingEntryDrawerReplayAction()
        let source = InMemoryEntryDrawerSource(initial: loadedFull(replayEnabled: false))
        let model = makeModel(source: source, replayAction: replay)
        model.start()
        XCTAssertTrue(model.replayDisabled)
        model.replay()
        XCTAssertEqual(replay.replayedIDs, [])
    }

    func testReplayDisabledWhileLoading() {
        let update = EntryDrawerUpdate(
            status: .loading,
            summary: EntryDrawerModelSamples.summary(),
            full: EntryDrawerModelSamples.fullUTF8()
        )
        let model = makeModel(source: InMemoryEntryDrawerSource(initial: update))
        model.start()
        XCTAssertTrue(model.replayDisabled)
    }

    // MARK: Freshness

    func testStaleAutoRefreshesOnceThenReArms() {
        let source = InMemoryEntryDrawerSource(initial: loadedFull())
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(loadedFull(connection: .stale))
        source.push(loadedFull(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(loadedFull(connection: .live))
        source.push(loadedFull(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsContentAndDoesNotRefresh() {
        let source = InMemoryEntryDrawerSource(initial: loadedFull())
        let model = makeModel(source: source)
        model.start()
        source.push(loadedFull(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }
}
