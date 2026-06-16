import XCTest
@testable import TeslaSync

/// State-machine tests for `ExportsPageModel` — the data states the page renders
/// (loading / empty / error / success), the bulk-selection contract (toggle / select-all
/// tri-state / clear), and the bulk-delete intent (optimistic drop + selection clear +
/// empty fold + failure preservation). Derivation + formatter coverage lives in the
/// extension below.
@MainActor
final class ExportsPageModelTests: XCTestCase {
    struct StubError: Error {}

    struct StubSource: ExportsDataSource {
        var jobs: [ExportJobSummary] = []
        var loadFails = false
        var deleteFails = false

        func loadJobs() async throws -> [ExportJobSummary] {
            if loadFails { throw StubError() }
            return jobs
        }

        func bulkDelete(ids: [String]) async throws -> ExportBulkResult {
            if deleteFails { throw StubError() }
            return ExportBulkResult(deleted: ids.count)
        }
    }

    static func job(
        id: String,
        status: ExportsJobStatus = .ready,
        type: String = "drives",
        format: String = "csv",
        fileSize: Int64? = 2048
    ) -> ExportJobSummary {
        ExportJobSummary(
            id: id,
            type: type,
            format: format,
            status: status,
            fileSize: fileSize,
            createdAt: "2026-06-14T09:12:00Z"
        )
    }

    static func threeJobs() -> [ExportJobSummary] {
        [
            job(id: "a", status: .ready),
            job(id: "b", status: .processing),
            job(id: "c", status: .failed)
        ]
    }

    // MARK: - Initial / load states

    func testInitialStateIsLoading() {
        let model = ExportsPageModel(dataSource: StubSource())
        XCTAssertEqual(model.state, .loading)
        XCTAssertTrue(model.jobs.isEmpty)
    }

    func testLoadSuccessPopulatesJobs() async {
        let model = ExportsPageModel(dataSource: StubSource(jobs: Self.threeJobs()))
        await model.load()
        XCTAssertEqual(model.jobs.count, 3)
        XCTAssertEqual(model.visibleIDs, ["a", "b", "c"])
        guard case .loaded = model.state else { return XCTFail("expected loaded") }
    }

    func testLoadEmptyYieldsEmptyState() async {
        let model = ExportsPageModel(dataSource: StubSource(jobs: []))
        await model.load()
        XCTAssertEqual(model.state, .empty)
        XCTAssertTrue(model.jobs.isEmpty)
    }

    func testLoadFailureYieldsErrorState() async {
        let model = ExportsPageModel(dataSource: StubSource(loadFails: true))
        await model.load()
        guard case .error = model.state else { return XCTFail("expected error, got \(model.state)") }
    }

    func testLoadIfNeededSkipsWhenAlreadyLoaded() async {
        let model = ExportsPageModel(dataSource: StubSource(jobs: Self.threeJobs()))
        await model.load()
        let before = model.jobs.map(\.id)
        await model.loadIfNeeded()
        XCTAssertEqual(model.jobs.map(\.id), before)
    }

    func testRefreshReloads() async {
        let model = ExportsPageModel(dataSource: StubSource(jobs: Self.threeJobs()))
        await model.refresh()
        XCTAssertEqual(model.jobs.count, 3)
    }

    // MARK: - Bulk selection (web `useBulkSelection`)

    func testToggleAndIsSelected() async {
        let model = ExportsPageModel(dataSource: StubSource(jobs: Self.threeJobs()))
        await model.load()
        XCTAssertFalse(model.isSelected("a"))
        model.toggle("a")
        XCTAssertTrue(model.isSelected("a"))
        model.toggle("a")
        XCTAssertFalse(model.isSelected("a"))
    }

    func testSetSelectedExplicit() async {
        let model = ExportsPageModel(dataSource: StubSource(jobs: Self.threeJobs()))
        await model.load()
        model.setSelected("b", true)
        XCTAssertTrue(model.isSelected("b"))
        model.setSelected("b", false)
        XCTAssertFalse(model.isSelected("b"))
    }

    func testSelectAllStateTransitions() async {
        let model = ExportsPageModel(dataSource: StubSource(jobs: Self.threeJobs()))
        await model.load()
        XCTAssertEqual(model.selectAllState, .none)
        model.toggle("a")
        XCTAssertEqual(model.selectAllState, .some)
        model.toggle("b")
        model.toggle("c")
        XCTAssertEqual(model.selectAllState, .all)
    }

    func testSelectAllStateIsNoneWhenEmpty() async {
        let model = ExportsPageModel(dataSource: StubSource(jobs: []))
        await model.load()
        XCTAssertEqual(model.selectAllState, .none)
    }

    func testToggleAllSelectsThenClears() async {
        let model = ExportsPageModel(dataSource: StubSource(jobs: Self.threeJobs()))
        await model.load()
        model.toggleAll()
        XCTAssertEqual(model.selectedCount, 3)
        XCTAssertEqual(model.selectAllState, .all)
        model.toggleAll()
        XCTAssertEqual(model.selectedCount, 0)
        XCTAssertEqual(model.selectAllState, .none)
    }

    func testToggleAllFromSomeSelectsAll() async {
        let model = ExportsPageModel(dataSource: StubSource(jobs: Self.threeJobs()))
        await model.load()
        model.toggle("a")
        model.toggleAll()
        XCTAssertEqual(model.selectedCount, 3)
    }

    func testClearSelection() async {
        let model = ExportsPageModel(dataSource: StubSource(jobs: Self.threeJobs()))
        await model.load()
        model.toggleAll()
        model.clearSelection()
        XCTAssertEqual(model.selectedCount, 0)
        XCTAssertFalse(model.hasSelection)
    }

    func testSelectionNounKeyPluralizes() async {
        let model = ExportsPageModel(dataSource: StubSource(jobs: Self.threeJobs()))
        await model.load()
        model.toggle("a")
        XCTAssertEqual(model.selectionNounKey, "exportsList.noun.one")
        model.toggle("b")
        XCTAssertEqual(model.selectionNounKey, "exportsList.noun.other")
    }
}

// MARK: - Delete, download, status + formatter coverage

extension ExportsPageModelTests {
    // MARK: Bulk delete (web `useBulkExportsDelete`)

    func testDeleteSelectedDropsRowsAndClears() async {
        let model = ExportsPageModel(dataSource: StubSource(jobs: Self.threeJobs()))
        await model.load()
        model.toggle("a")
        model.toggle("b")
        await model.deleteSelected()
        XCTAssertEqual(model.visibleIDs, ["c"])
        XCTAssertEqual(model.selectedCount, 0)
        XCTAssertFalse(model.isDeleting)
    }

    func testDeleteAllSelectedFoldsToEmpty() async {
        let model = ExportsPageModel(dataSource: StubSource(jobs: Self.threeJobs()))
        await model.load()
        model.toggleAll()
        await model.deleteSelected()
        XCTAssertEqual(model.state, .empty)
    }

    func testDeleteWithNoSelectionIsNoop() async {
        let model = ExportsPageModel(dataSource: StubSource(jobs: Self.threeJobs()))
        await model.load()
        await model.deleteSelected()
        XCTAssertEqual(model.visibleIDs, ["a", "b", "c"])
    }

    func testDeleteFailurePreservesSelectionAndRows() async {
        let model = ExportsPageModel(dataSource: StubSource(jobs: Self.threeJobs(), deleteFails: true))
        await model.load()
        model.toggle("a")
        await model.deleteSelected()
        XCTAssertEqual(model.visibleIDs, ["a", "b", "c"])
        XCTAssertTrue(model.isSelected("a"))
        XCTAssertFalse(model.isDeleting)
    }

    func testReloadPrunesStaleSelection() async {
        final class MutableSource: ExportsDataSource, @unchecked Sendable {
            var jobs: [ExportJobSummary]
            init(_ jobs: [ExportJobSummary]) {
                self.jobs = jobs
            }

            func loadJobs() async throws -> [ExportJobSummary] {
                jobs
            }

            func bulkDelete(ids: [String]) async throws -> ExportBulkResult {
                ExportBulkResult(deleted: ids.count)
            }
        }
        let source = MutableSource(Self.threeJobs())
        let model = ExportsPageModel(dataSource: source)
        await model.load()
        model.toggle("a")
        model.toggle("c")
        XCTAssertEqual(model.selectedCount, 2)
        source.jobs = [Self.job(id: "a")]
        await model.refresh()
        XCTAssertTrue(model.isSelected("a"))
        XCTAssertFalse(model.isSelected("c"))
        XCTAssertEqual(model.selectedCount, 1)
    }

    // MARK: Download derivation (web `exportDownloadUrl`, ready-only)

    func testDownloadHrefOnlyForReady() async throws {
        let model = ExportsPageModel(dataSource: StubSource(jobs: Self.threeJobs()))
        await model.load()
        let ready = try XCTUnwrap(model.jobs.first { $0.id == "a" })
        let processing = try XCTUnwrap(model.jobs.first { $0.id == "b" })
        XCTAssertEqual(model.downloadHref(for: ready), "/api/v1/export/jobs/a/download")
        XCTAssertNil(model.downloadHref(for: processing))
    }

    func testDownloadURLResolvesAgainstBase() async throws {
        let model = ExportsPageModel(dataSource: StubSource(jobs: Self.threeJobs()))
        await model.load()
        let ready = try XCTUnwrap(model.jobs.first { $0.id == "a" })
        XCTAssertEqual(
            model.downloadURL(for: ready)?.absoluteString,
            "http://localhost:8080/api/v1/export/jobs/a/download"
        )
    }

    func testExportDownloadUrlFreeFunction() {
        XCTAssertEqual(exportDownloadUrl("xyz"), "/api/v1/export/jobs/xyz/download")
    }

    // MARK: Status fold + tone (web status union / `statusVariant`)

    func testStatusWireFold() {
        XCTAssertEqual(ExportsJobStatus(wire: "ready"), .ready)
        XCTAssertEqual(ExportsJobStatus(wire: "queued"), .queued)
        XCTAssertEqual(ExportsJobStatus(wire: "processing"), .processing)
        XCTAssertEqual(ExportsJobStatus(wire: "expired"), .expired)
        XCTAssertEqual(ExportsJobStatus(wire: "bogus"), .unknown)
    }

    func testRawStatusPreservedForUnknown() {
        let summary = ExportJobSummary(
            id: "x",
            type: "drives",
            format: "csv",
            status: ExportsJobStatus(wire: "weird"),
            rawStatus: "weird",
            createdAt: "2026-06-14T09:12:00Z"
        )
        XCTAssertEqual(summary.status, .unknown)
        XCTAssertEqual(summary.rawStatus, "weird")
    }

    func testStatusToneMapping() {
        XCTAssertEqual(ExportsJobStatus.ready.tone, .success)
        XCTAssertEqual(ExportsJobStatus.failed.tone, .danger)
        XCTAssertEqual(ExportsJobStatus.processing.tone, .info)
        XCTAssertEqual(ExportsJobStatus.queued.tone, .info)
        XCTAssertEqual(ExportsJobStatus.expired.tone, .neutral)
        XCTAssertEqual(ExportsJobStatus.unknown.tone, .neutral)
    }

    func testIsDownloadable() {
        XCTAssertTrue(Self.job(id: "a", status: .ready).isDownloadable)
        XCTAssertFalse(Self.job(id: "b", status: .processing).isDownloadable)
        XCTAssertFalse(Self.job(id: "c", status: .expired).isDownloadable)
    }

    // MARK: Formatters (web `formatBytes` / `formatDateTime`)

    func testFormatBytesBinaryUnits() {
        XCTAssertEqual(ExportsFormat.bytes(Int64(0)), "0 B")
        XCTAssertEqual(ExportsFormat.bytes(Int64(512)), "512 B")
        XCTAssertEqual(ExportsFormat.bytes(Int64(1024)), "1.0 KB")
        XCTAssertEqual(ExportsFormat.bytes(Int64(1536)), "1.5 KB")
        XCTAssertEqual(ExportsFormat.bytes(Int64(1_048_576)), "1.0 MB")
        XCTAssertEqual(ExportsFormat.bytes(Int64(1_073_741_824)), "1.0 GB")
    }

    func testFormatBytesEmptyForNilAndNonFinite() {
        XCTAssertEqual(ExportsFormat.bytes(nil as Int64?), "—")
        XCTAssertEqual(ExportsFormat.bytes(Double.infinity), "—")
        XCTAssertEqual(ExportsFormat.bytes(Double.nan), "—")
    }

    func testFormatDateTimeEmptyForBadInput() {
        XCTAssertEqual(ExportsFormat.dateTime(nil), "—")
        XCTAssertEqual(ExportsFormat.dateTime(""), "—")
        XCTAssertEqual(ExportsFormat.dateTime("garbage"), "—")
    }

    func testParseISOHandlesFractionalSeconds() {
        XCTAssertNotNil(ExportsFormat.parseISO("2026-06-14T09:12:00.500Z"))
        XCTAssertNotNil(ExportsFormat.parseISO("2026-06-14T09:12:00Z"))
    }

    func testUpperFormat() {
        XCTAssertEqual(ExportsFormat.upper("csv"), "CSV")
        XCTAssertEqual(ExportsFormat.upper("json"), "JSON")
    }

    // MARK: Default seed

    func testSampleDataSourceIsWellFormed() async throws {
        let jobs = try await SampleExportsDataSource().loadJobs()
        XCTAssertFalse(jobs.isEmpty)
        XCTAssertTrue(jobs.contains { $0.status == .ready })
        XCTAssertTrue(jobs.allSatisfy { !$0.id.isEmpty })
        let result = try await SampleExportsDataSource().bulkDelete(ids: ["a", "b"])
        XCTAssertEqual(result.deleted, 2)
    }
}
