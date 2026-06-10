//
//  ScheduledExportsPanel.ModelTests.swift
//  TeslaSync — P4 feature view · 0262 · ScheduledExportsPanel (Apple)
//
//  State-holder coverage for `ScheduledExportsModel`: the P1/S11 `view.opened` telemetry
//  (once + idempotent), the phase transitions across loading / loaded-empty / failed
//  (incl. the inline-error envelope when cached rows survive a failed reload), the inline
//  form lifecycle (new vs edit seeds + close), the submit create/update/skip/failure
//  paths, the per-row run-now / toggle / delete flows (seam call + list refresh + dialog /
//  in-flight bookkeeping), the failure-skips-refresh paths, the stale auto-refresh (once,
//  re-armed on return to live), offline keeping cached rows, and pruning an in-flight id /
//  pending delete whose row vanished. Driven through the in-memory source — no network.
//

import XCTest
@testable import TeslaSync

/// Records the `view.opened` surfaces. Lock-guarded so it satisfies the `Sendable`
/// telemetry seam under Swift 6 strict concurrency.
private final class SpyScheduledExportsTelemetry: ScheduledExportsTelemetry, @unchecked Sendable {
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

/// Records the mutator calls and returns configured results.
private actor RecordingMutator: ScheduledExportsMutator {
    private(set) var savedEditingIDs: [Int?] = []
    private(set) var savedNames: [String] = []
    private(set) var setEnabledCalls: [(id: Int, enabled: Bool)] = []
    private(set) var deletedIDs: [Int] = []
    private(set) var runIDs: [Int] = []

    private let saveResult: Bool
    private let setEnabledResult: Bool
    private let deleteResult: Bool
    private let runResult: Bool

    init(
        saveResult: Bool = true,
        setEnabledResult: Bool = true,
        deleteResult: Bool = true,
        runResult: Bool = true
    ) {
        self.saveResult = saveResult
        self.setEnabledResult = setEnabledResult
        self.deleteResult = deleteResult
        self.runResult = runResult
    }

    func save(form: ScheduledExportFormState, editingID: Int?) async -> Bool {
        savedEditingIDs.append(editingID)
        savedNames.append(form.name)
        return saveResult
    }

    func setEnabled(item: ScheduledExportItem, enabled: Bool) async -> Bool {
        setEnabledCalls.append((item.id, enabled))
        return setEnabledResult
    }

    func delete(id: Int) async -> Bool {
        deletedIDs.append(id)
        return deleteResult
    }

    func runNow(id: Int) async -> Bool {
        runIDs.append(id)
        return runResult
    }
}

private enum ScheduledExportsPanelSampleSchedules {
    static func drives(id: Int = 1, enabled: Bool = true) -> ScheduledExportItem {
        ScheduledExportItem(
            id: id,
            name: "Drives weekly",
            exportType: .drives,
            format: .csv,
            scheduleCron: "0 9 * * 0",
            delivery: ScheduledExportDelivery(kind: .download),
            rangeWindow: "7d",
            enabled: enabled,
            nextRunAt: Date(timeIntervalSince1970: 1_717_000_000)
        )
    }

    static func charging(id: Int = 2) -> ScheduledExportItem {
        ScheduledExportItem(
            id: id,
            name: "Charging email",
            exportType: .charging,
            format: .json,
            scheduleCron: "0 0 * * *",
            delivery: ScheduledExportDelivery(kind: .email, target: "you@example.com"),
            rangeWindow: "24h",
            enabled: false,
            lastRunAt: Date(timeIntervalSince1970: 1_716_000_000),
            lastStatus: .failed
        )
    }

    static func both() -> [ScheduledExportItem] {
        [drives(), charging()]
    }
}

@MainActor final class ScheduledExportsModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryScheduledExportsSource,
        telemetry: SpyScheduledExportsTelemetry = SpyScheduledExportsTelemetry(),
        mutator: RecordingMutator = RecordingMutator()
    ) -> ScheduledExportsModel {
        ScheduledExportsModel(
            source: source,
            telemetry: telemetry,
            mutator: mutator,
            localize: { _, fallback in fallback }
        )
    }

    // MARK: Telemetry + phases

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyScheduledExportsTelemetry()
        let source = InMemoryScheduledExportsSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["ScheduledExportsPanel"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadingThenContent() {
        let source = InMemoryScheduledExportsSource(initial: ScheduledExportsUpdate(status: .loading))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(ScheduledExportsUpdate(status: .loaded, items: ScheduledExportsPanelSampleSchedules.both()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.items.count, 2)
    }

    func testLoadedEmptyResolvesEmpty() {
        let source = InMemoryScheduledExportsSource(initial: ScheduledExportsUpdate(status: .loaded))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedNoRowsResolvesError() {
        let source = InMemoryScheduledExportsSource(
            initial: ScheduledExportsUpdate(status: .failed("timeout"))
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testFailedWithRowsKeepsContentAndSurfacesInlineError() {
        let rows = ScheduledExportsPanelSampleSchedules.both()
        let source = InMemoryScheduledExportsSource(
            initial: ScheduledExportsUpdate(status: .loaded, items: rows)
        )
        let model = makeModel(source: source)
        model.start()
        source.push(ScheduledExportsUpdate(status: .failed("stale read"), items: rows))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.inlineErrorMessage, "stale read")
    }

    // MARK: Inline form lifecycle

    func testStartCreateSeedsEmptyForm() {
        let model = makeModel(source: InMemoryScheduledExportsSource())
        model.startEdit(ScheduledExportsPanelSampleSchedules.charging())
        model.startCreate()
        XCTAssertTrue(model.showForm)
        XCTAssertNil(model.editingID)
        XCTAssertEqual(model.form.name, "")
        XCTAssertEqual(model.form.deliveryKind, .download)
    }

    func testStartEditSeedsFromRow() {
        let model = makeModel(source: InMemoryScheduledExportsSource())
        model.startEdit(ScheduledExportsPanelSampleSchedules.charging())
        XCTAssertTrue(model.showForm)
        XCTAssertEqual(model.editingID, 2)
        XCTAssertEqual(model.form.name, "Charging email")
        XCTAssertEqual(model.form.deliveryKind, .email)
        XCTAssertEqual(model.form.deliveryTarget, "you@example.com")
    }

    func testCloseFormResets() {
        let model = makeModel(source: InMemoryScheduledExportsSource())
        model.startEdit(ScheduledExportsPanelSampleSchedules.charging())
        model.closeForm()
        XCTAssertFalse(model.showForm)
        XCTAssertNil(model.editingID)
        XCTAssertEqual(model.form.name, "")
    }

    // MARK: Submit

    func testSubmitCreateCallsSeamClosesAndRefreshes() async {
        let source = InMemoryScheduledExportsSource(initial: ScheduledExportsUpdate(status: .loaded))
        let mutator = RecordingMutator()
        let model = makeModel(source: source, mutator: mutator)
        model.start()
        model.startCreate()
        model.form.name = "Weekly drives"
        await model.submit()
        let editingIDs = await mutator.savedEditingIDs
        let names = await mutator.savedNames
        XCTAssertEqual(editingIDs, [Int?.none])
        XCTAssertEqual(names, ["Weekly drives"])
        XCTAssertFalse(model.showForm)
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testSubmitEditPassesEditingID() async {
        let source = InMemoryScheduledExportsSource(
            initial: ScheduledExportsUpdate(status: .loaded, items: ScheduledExportsPanelSampleSchedules.both())
        )
        let mutator = RecordingMutator()
        let model = makeModel(source: source, mutator: mutator)
        model.start()
        model.startEdit(ScheduledExportsPanelSampleSchedules.charging())
        await model.submit()
        let editingIDs = await mutator.savedEditingIDs
        XCTAssertEqual(editingIDs, [2])
        XCTAssertFalse(model.showForm)
    }

    func testSubmitSkipsWhenNotSubmittable() async {
        let mutator = RecordingMutator()
        let model = makeModel(source: InMemoryScheduledExportsSource(), mutator: mutator)
        model.startCreate() // name is empty → not submittable
        await model.submit()
        let editingIDs = await mutator.savedEditingIDs
        XCTAssertTrue(editingIDs.isEmpty)
        XCTAssertTrue(model.showForm)
    }

    func testSubmitFailureKeepsFormOpenAndSkipsRefresh() async {
        let source = InMemoryScheduledExportsSource(initial: ScheduledExportsUpdate(status: .loaded))
        let model = makeModel(source: source, mutator: RecordingMutator(saveResult: false))
        model.start()
        model.startCreate()
        model.form.name = "Weekly drives"
        await model.submit()
        XCTAssertTrue(model.showForm)
        XCTAssertEqual(source.refreshCount, 0)
        XCTAssertFalse(model.isFormBusy)
    }

    // MARK: Per-row actions

    func testToggleEnabledFlipsAndRefreshes() async {
        let source = InMemoryScheduledExportsSource(
            initial: ScheduledExportsUpdate(status: .loaded, items: ScheduledExportsPanelSampleSchedules.both())
        )
        let mutator = RecordingMutator()
        let model = makeModel(source: source, mutator: mutator)
        model.start()
        await model.toggleEnabled(ScheduledExportsPanelSampleSchedules.charging()) // currently disabled
        let calls = await mutator.setEnabledCalls
        XCTAssertEqual(calls.count, 1)
        XCTAssertEqual(calls.first?.id, 2)
        XCTAssertEqual(calls.first?.enabled, true)
        XCTAssertNil(model.togglingID)
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testRunNowCallsSeamAndRefreshes() async {
        let source = InMemoryScheduledExportsSource(
            initial: ScheduledExportsUpdate(status: .loaded, items: ScheduledExportsPanelSampleSchedules.both())
        )
        let mutator = RecordingMutator()
        let model = makeModel(source: source, mutator: mutator)
        model.start()
        await model.runNow(ScheduledExportsPanelSampleSchedules.drives())
        let ran = await mutator.runIDs
        XCTAssertEqual(ran, [1])
        XCTAssertNil(model.runningID)
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testRunNowFailureSkipsRefresh() async {
        let source = InMemoryScheduledExportsSource(
            initial: ScheduledExportsUpdate(status: .loaded, items: ScheduledExportsPanelSampleSchedules.both())
        )
        let model = makeModel(source: source, mutator: RecordingMutator(runResult: false))
        model.start()
        await model.runNow(ScheduledExportsPanelSampleSchedules.drives())
        XCTAssertEqual(source.refreshCount, 0)
    }

    // MARK: Delete

    func testDeleteFlowCallsSeamAndRefreshes() async {
        let source = InMemoryScheduledExportsSource(
            initial: ScheduledExportsUpdate(status: .loaded, items: ScheduledExportsPanelSampleSchedules.both())
        )
        let mutator = RecordingMutator()
        let model = makeModel(source: source, mutator: mutator)
        model.start()
        let target = ScheduledExportsPanelSampleSchedules.charging()
        model.requestDelete(target)
        XCTAssertEqual(model.pendingDelete?.id, target.id)
        await model.confirmDelete()
        XCTAssertNil(model.pendingDelete)
        let deleted = await mutator.deletedIDs
        XCTAssertEqual(deleted, [target.id])
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConfirmDeleteWithoutTargetIsNoOp() async {
        let source = InMemoryScheduledExportsSource(initial: ScheduledExportsUpdate(status: .loaded))
        let mutator = RecordingMutator()
        let model = makeModel(source: source, mutator: mutator)
        model.start()
        await model.confirmDelete()
        let deleted = await mutator.deletedIDs
        XCTAssertTrue(deleted.isEmpty)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testCancelDeleteClearsTarget() {
        let model = makeModel(source: InMemoryScheduledExportsSource())
        model.requestDelete(ScheduledExportsPanelSampleSchedules.drives())
        model.cancelDelete()
        XCTAssertNil(model.pendingDelete)
    }

    func testDeleteFailureSkipsRefresh() async {
        let source = InMemoryScheduledExportsSource(
            initial: ScheduledExportsUpdate(status: .loaded, items: ScheduledExportsPanelSampleSchedules.both())
        )
        let model = makeModel(source: source, mutator: RecordingMutator(deleteResult: false))
        model.start()
        model.requestDelete(ScheduledExportsPanelSampleSchedules.charging())
        await model.confirmDelete()
        XCTAssertEqual(source.refreshCount, 0)
    }

    // MARK: Freshness

    func testStaleAutoRefreshesOnceThenReArms() {
        let rows = ScheduledExportsPanelSampleSchedules.both()
        let source = InMemoryScheduledExportsSource(initial: ScheduledExportsUpdate(status: .loaded, items: rows))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(ScheduledExportsUpdate(status: .loaded, items: rows, connection: .stale))
        source.push(ScheduledExportsUpdate(status: .loaded, items: rows, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(ScheduledExportsUpdate(status: .loaded, items: rows, connection: .live))
        source.push(ScheduledExportsUpdate(status: .loaded, items: rows, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsRowsAndDoesNotRefresh() {
        let rows = ScheduledExportsPanelSampleSchedules.both()
        let source = InMemoryScheduledExportsSource(initial: ScheduledExportsUpdate(status: .loaded, items: rows))
        let model = makeModel(source: source)
        model.start()
        source.push(ScheduledExportsUpdate(status: .loaded, items: rows, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testPendingDeletePrunedWhenRowVanishes() {
        let source = InMemoryScheduledExportsSource(
            initial: ScheduledExportsUpdate(status: .loaded, items: ScheduledExportsPanelSampleSchedules.both())
        )
        let model = makeModel(source: source)
        model.start()
        model.requestDelete(ScheduledExportsPanelSampleSchedules.charging())
        XCTAssertNotNil(model.pendingDelete)
        source.push(ScheduledExportsUpdate(status: .loaded, items: [ScheduledExportsPanelSampleSchedules.drives()]))
        XCTAssertNil(model.pendingDelete)
    }
}
