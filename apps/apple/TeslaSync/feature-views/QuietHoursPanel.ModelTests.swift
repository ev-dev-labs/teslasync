//
//  QuietHoursPanel.ModelTests.swift
//  TeslaSync — P4 feature view · 0210 · QuietHoursPanel (Apple)
//
//  State-holder coverage for `QuietHoursModel`: the P1/S11 `view.opened` telemetry (once
//  + idempotent), the phase transitions across loading / loaded-empty / failed (incl. the
//  inline-error envelope when cached rows survive a failed reload), the draft open/edit/
//  cancel + field toggles + controlled bindings, the validate-blocks-save path, the
//  create / update / delete write flows (seam call + toast + list refresh), the failure
//  paths (toast, no refresh, form stays open), the stale auto-refresh (once, re-armed),
//  offline keeping cached rows, and pruning a pending delete whose row vanished. Driven
//  through the in-memory source + a recording writer — no network.
//

import XCTest
@testable import TeslaSync

private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

/// Records the `view.opened` surfaces. Lock-guarded for the `Sendable` telemetry seam.
private final class SpyQuietHoursTelemetry: QuietHoursTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }
}

/// Records save/delete calls and returns configured results.
private actor RecordingQuietHoursWriter: QuietHoursWriter {
    private(set) var savedPayloads: [QuietHoursSavePayload] = []
    private(set) var deletedIDs: [Int] = []
    private let saveResult: QuietHoursWriteResult
    private let deleteResult: QuietHoursWriteResult

    init(saveResult: QuietHoursWriteResult = .success, deleteResult: QuietHoursWriteResult = .success) {
        self.saveResult = saveResult
        self.deleteResult = deleteResult
    }

    func save(_ payload: QuietHoursSavePayload) async -> QuietHoursWriteResult {
        savedPayloads.append(payload)
        return saveResult
    }

    func delete(id: Int) async -> QuietHoursWriteResult {
        deletedIDs.append(id)
        return deleteResult
    }
}

private enum SampleWindows {
    static func enabled(id: Int = 1) -> QuietHoursWindowItem {
        QuietHoursWindowItem(
            id: id,
            enabled: true,
            startLocal: "23:00",
            endLocal: "07:00",
            timezone: "UTC",
            weekdays: QuietHoursWeekdays.all,
            bypassSeverities: ["critical"]
        )
    }

    static func both() -> [QuietHoursWindowItem] {
        [enabled(id: 1), enabled(id: 2)]
    }
}

@MainActor
final class QuietHoursModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryQuietHoursSource,
        writer: any QuietHoursWriter = RecordingQuietHoursWriter(),
        telemetry: SpyQuietHoursTelemetry = SpyQuietHoursTelemetry()
    ) -> QuietHoursModel {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return QuietHoursModel(
            source: source,
            writer: writer,
            telemetry: telemetry,
            localize: passthroughLocalize,
            defaultTimezone: { "UTC" },
            nowProvider: { Date(timeIntervalSince1970: 1_700_000_000) },
            calendar: calendar
        )
    }

    // MARK: Lifecycle + phase

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyQuietHoursTelemetry()
        let source = InMemoryQuietHoursSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["QuietHoursPanel"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadingThenContent() {
        let source = InMemoryQuietHoursSource(initial: QuietHoursUpdate(status: .loading))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(QuietHoursUpdate(status: .loaded, items: SampleWindows.both()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.items.count, 2)
    }

    func testLoadedEmptyResolvesEmpty() {
        let source = InMemoryQuietHoursSource(initial: QuietHoursUpdate(status: .loaded))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedNoRowsResolvesError() {
        let source = InMemoryQuietHoursSource(initial: QuietHoursUpdate(status: .failed("timeout")))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testFailedWithRowsKeepsContentAndSurfacesInlineError() {
        let rows = SampleWindows.both()
        let source = InMemoryQuietHoursSource(initial: QuietHoursUpdate(status: .loaded, items: rows))
        let model = makeModel(source: source)
        model.start()
        source.push(QuietHoursUpdate(status: .failed("stale read"), items: rows))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.inlineErrorMessage, "stale read")
    }

    // MARK: Draft open / edit / cancel + toggles

    func testStartCreateOpensDraftAndContentPhase() {
        let source = InMemoryQuietHoursSource(initial: QuietHoursUpdate(status: .loaded))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
        model.startCreate()
        XCTAssertTrue(model.hasDraft)
        XCTAssertFalse(model.isEditing)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.draft?.timezone, "UTC")
    }

    func testStartEditCopiesRow() {
        let source = InMemoryQuietHoursSource(initial: QuietHoursUpdate(status: .loaded, items: SampleWindows.both()))
        let model = makeModel(source: source)
        model.start()
        model.startEdit(SampleWindows.enabled(id: 2))
        XCTAssertTrue(model.isEditing)
        XCTAssertEqual(model.editingID, 2)
        XCTAssertEqual(model.draft?.startLocal, "23:00")
    }

    func testCancelClosesDraft() {
        let source = InMemoryQuietHoursSource(initial: QuietHoursUpdate(status: .loaded))
        let model = makeModel(source: source)
        model.start()
        model.startCreate()
        model.cancel()
        XCTAssertFalse(model.hasDraft)
        XCTAssertEqual(model.phase, .empty)
    }

    func testToggleWeekdayAndSeverity() {
        let source = InMemoryQuietHoursSource(initial: QuietHoursUpdate(status: .loaded))
        let model = makeModel(source: source)
        model.start()
        model.startCreate()
        let sunday = 1 << 0
        XCTAssertTrue(model.isWeekdayOn(sunday))
        model.toggleWeekday(sunday)
        XCTAssertFalse(model.isWeekdayOn(sunday))
        XCTAssertFalse(model.isSeverityOn("warn"))
        model.toggleSeverity("warn")
        XCTAssertTrue(model.isSeverityOn("warn"))
        model.toggleSeverity("critical")
        XCTAssertFalse(model.isSeverityOn("critical"))
    }

    func testControlledBindingsMutateDraft() {
        let source = InMemoryQuietHoursSource(initial: QuietHoursUpdate(status: .loaded))
        let model = makeModel(source: source)
        model.start()
        model.startCreate()
        model.draftEnabled = false
        XCTAssertEqual(model.draft?.enabled, false)
        model.draftTimezone = "America/New_York"
        XCTAssertEqual(model.draft?.timezone, "America/New_York")
        model.draftEndTime = model.draftStartTime
        XCTAssertEqual(model.draft?.endLocal, model.draft?.startLocal)
    }

    // MARK: Submit (create / update / invalid / failure)

    func testInvalidSubmitSetsErrorAndSkipsWrite() async {
        let source = InMemoryQuietHoursSource(initial: QuietHoursUpdate(status: .loaded))
        let writer = RecordingQuietHoursWriter()
        let model = makeModel(source: source, writer: writer)
        model.start()
        model.startCreate()
        model.draftEndTime = model.draftStartTime
        await model.submit()
        XCTAssertEqual(model.validationError, "End must differ from start.")
        let saved = await writer.savedPayloads
        XCTAssertTrue(saved.isEmpty)
        XCTAssertTrue(model.hasDraft)
    }

    func testCreateSubmitWritesRaisesToastClosesAndRefreshes() async {
        let source = InMemoryQuietHoursSource(initial: QuietHoursUpdate(status: .loaded))
        let writer = RecordingQuietHoursWriter()
        let model = makeModel(source: source, writer: writer)
        model.start()
        model.startCreate()
        await model.submit()
        let saved = await writer.savedPayloads
        XCTAssertEqual(saved.count, 1)
        XCTAssertNil(saved.first?.id)
        XCTAssertEqual(model.toast?.kind, .success)
        XCTAssertEqual(model.toast?.title, "Quiet hours window created")
        XCTAssertFalse(model.hasDraft)
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testUpdateSubmitUsesUpdatedToast() async {
        let source = InMemoryQuietHoursSource(initial: QuietHoursUpdate(status: .loaded, items: SampleWindows.both()))
        let writer = RecordingQuietHoursWriter()
        let model = makeModel(source: source, writer: writer)
        model.start()
        model.startEdit(SampleWindows.enabled(id: 2))
        await model.submit()
        let saved = await writer.savedPayloads
        XCTAssertEqual(saved.first?.id, 2)
        XCTAssertEqual(model.toast?.title, "Quiet hours window updated")
    }

    func testSaveFailureRaisesErrorToastAndKeepsForm() async {
        let source = InMemoryQuietHoursSource(initial: QuietHoursUpdate(status: .loaded))
        let writer = RecordingQuietHoursWriter(saveResult: .failure("boom"))
        let model = makeModel(source: source, writer: writer)
        model.start()
        model.startCreate()
        await model.submit()
        XCTAssertEqual(model.toast?.kind, .error)
        XCTAssertEqual(model.toast?.title, "Failed to save quiet hours window")
        XCTAssertEqual(model.toast?.message, "boom")
        XCTAssertTrue(model.hasDraft)
        XCTAssertEqual(source.refreshCount, 0)
    }

    // MARK: Delete

    func testDeleteSuccessRaisesToastAndRefreshes() async {
        let source = InMemoryQuietHoursSource(initial: QuietHoursUpdate(status: .loaded, items: SampleWindows.both()))
        let writer = RecordingQuietHoursWriter()
        let model = makeModel(source: source, writer: writer)
        model.start()
        await model.removeWindow(SampleWindows.enabled(id: 2))
        let deleted = await writer.deletedIDs
        XCTAssertEqual(deleted, [2])
        XCTAssertEqual(model.toast?.title, "Quiet hours window removed")
        XCTAssertNil(model.deletingID)
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testDeleteFailureSkipsRefresh() async {
        let source = InMemoryQuietHoursSource(initial: QuietHoursUpdate(status: .loaded, items: SampleWindows.both()))
        let writer = RecordingQuietHoursWriter(deleteResult: .failure("nope"))
        let model = makeModel(source: source, writer: writer)
        model.start()
        await model.removeWindow(SampleWindows.enabled(id: 1))
        XCTAssertEqual(model.toast?.kind, .error)
        XCTAssertEqual(model.toast?.message, "nope")
        XCTAssertEqual(source.refreshCount, 0)
    }

    // MARK: Freshness + pruning + toast dismiss

    func testStaleAutoRefreshesOnceThenReArms() {
        let rows = SampleWindows.both()
        let source = InMemoryQuietHoursSource(initial: QuietHoursUpdate(status: .loaded, items: rows))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(QuietHoursUpdate(status: .loaded, items: rows, connection: .stale))
        source.push(QuietHoursUpdate(status: .loaded, items: rows, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(QuietHoursUpdate(status: .loaded, items: rows, connection: .live))
        source.push(QuietHoursUpdate(status: .loaded, items: rows, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsRowsAndDoesNotRefresh() {
        let rows = SampleWindows.both()
        let source = InMemoryQuietHoursSource(initial: QuietHoursUpdate(status: .loaded, items: rows))
        let model = makeModel(source: source)
        model.start()
        source.push(QuietHoursUpdate(status: .loaded, items: rows, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testPendingDeletePrunedWhenRowVanishes() {
        let source = InMemoryQuietHoursSource(initial: QuietHoursUpdate(status: .loaded, items: SampleWindows.both()))
        let model = makeModel(source: source)
        model.start()
        model.deletingID = 2
        source.push(QuietHoursUpdate(status: .loaded, items: [SampleWindows.enabled(id: 1)]))
        XCTAssertNil(model.deletingID)
    }

    func testDismissToastClears() async {
        let source = InMemoryQuietHoursSource(initial: QuietHoursUpdate(status: .loaded))
        let model = makeModel(source: source)
        model.start()
        model.startCreate()
        await model.submit()
        XCTAssertNotNil(model.toast)
        model.dismissToast()
        XCTAssertNil(model.toast)
    }
}
