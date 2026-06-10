//
//  JobProgressDrawer.ModelTests.swift
//  TeslaSync — P4 modal / dialog · 0005 · JobProgressDrawer (Apple)
//
//  State-holder coverage for `JobProgressDrawerModel`: the P1/S11 `view.opened` telemetry
//  (once + idempotent), the body-phase transitions across loading / loaded-empty / failed
//  (incl. the inline-error envelope when cached rows survive a failed reload), the active /
//  recent bucket split + recent cap, the persisted presentation actions (expand / minimize /
//  dismiss), the web auto-promote-from-dismissed effect (on a new active job + the immediate
//  resolved-visibility promotion), the ambient auto-hide + its `pinned` suppression, the stale
//  auto-refresh (once, re-armed on return to live), offline keeping cached jobs, the download
//  seam, and the per-row display projection. Driven through the in-memory source — no network.
//

import XCTest
@testable import TeslaSync

/// Records the `view.opened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry
/// seam under Swift 6 strict concurrency.
private final class SpyJobProgressDrawerTelemetry: JobProgressDrawerTelemetry, @unchecked Sendable {
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

/// Records the download action seam calls.
private final class RecordingExportDrawerActions: ExportDrawerActions, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func download(_ job: ExportDrawerJob) {
        lock.lock()
        storage.append(job.id)
        lock.unlock()
    }

    var downloadedIDs: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }
}

private enum JobDrawerModelSamples {
    static let anchor = Date(timeIntervalSince1970: 1_717_000_000)

    static func processing(_ id: String = "1") -> ExportDrawerJob {
        ExportDrawerJob(
            id: id, kind: .drives, format: "csv", status: .processing,
            createdAt: anchor.addingTimeInterval(-90)
        )
    }

    static func queued(_ id: String = "2") -> ExportDrawerJob {
        ExportDrawerJob(
            id: id, kind: .charging, format: "json", status: .queued,
            createdAt: anchor.addingTimeInterval(-30)
        )
    }

    static func ready(_ id: String = "3") -> ExportDrawerJob {
        ExportDrawerJob(
            id: id, kind: .analytics, format: "csv", status: .ready,
            fileSize: 1_048_576, createdAt: anchor.addingTimeInterval(-3600),
            completedAt: anchor.addingTimeInterval(-3000)
        )
    }

    static func manyRecent(_ count: Int) -> [ExportDrawerJob] {
        (0 ..< count).map { index in
            ExportDrawerJob(
                id: "r\(index)", kind: .drives, format: "csv", status: .ready,
                createdAt: anchor.addingTimeInterval(Double(-index * 60))
            )
        }
    }
}

@MainActor
final class JobProgressDrawerModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryExportDrawerJobsSource,
        pinned: Bool = false,
        telemetry: SpyJobProgressDrawerTelemetry = SpyJobProgressDrawerTelemetry(),
        store: InMemoryJobDrawerPresentationStore = InMemoryJobDrawerPresentationStore(initial: .minimized),
        actions: RecordingExportDrawerActions = RecordingExportDrawerActions()
    ) -> JobProgressDrawerModel {
        JobProgressDrawerModel(
            source: source,
            pinned: pinned,
            telemetry: telemetry,
            store: store,
            actions: actions,
            dates: DefaultExportDrawerDateFormatting(),
            localize: { _, fallback in fallback },
            now: { JobDrawerModelSamples.anchor }
        )
    }

    // MARK: Telemetry

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyJobProgressDrawerTelemetry()
        let source = InMemoryExportDrawerJobsSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["JobProgressDrawer"])
        XCTAssertEqual(source.startCount, 1)
    }

    // MARK: Body phases

    func testLoadingThenPopulated() {
        let source = InMemoryExportDrawerJobsSource(initial: ExportDrawerJobsUpdate(status: .loading))
        let model = makeModel(source: source, pinned: true, store: openStore())
        model.start()
        XCTAssertEqual(model.bodyPhase, .loading)
        source.push(ExportDrawerJobsUpdate(
            status: .loaded,
            jobs: [JobDrawerModelSamples.processing(), JobDrawerModelSamples.ready()]
        ))
        XCTAssertEqual(model.bodyPhase, .populated)
    }

    func testLoadedEmptyBodyPhase() {
        let source = InMemoryExportDrawerJobsSource(initial: ExportDrawerJobsUpdate(status: .loaded, jobs: []))
        let model = makeModel(source: source, pinned: true, store: openStore())
        model.start()
        XCTAssertEqual(model.bodyPhase, .empty)
        XCTAssertEqual(model.visibility, .open)
    }

    func testFailedNoRowsBodyError() {
        let source = InMemoryExportDrawerJobsSource(
            initial: ExportDrawerJobsUpdate(status: .failed("timeout"), jobs: [])
        )
        let model = makeModel(source: source, pinned: true, store: openStore())
        model.start()
        XCTAssertEqual(model.bodyPhase, .error("timeout"))
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testFailedWithRowsKeepsPopulatedAndSurfacesInlineError() {
        let rows = [JobDrawerModelSamples.ready()]
        let source = InMemoryExportDrawerJobsSource(initial: ExportDrawerJobsUpdate(status: .loaded, jobs: rows))
        let model = makeModel(source: source, store: openStore())
        model.start()
        source.push(ExportDrawerJobsUpdate(status: .failed("stale read"), jobs: rows))
        XCTAssertEqual(model.bodyPhase, .populated)
        XCTAssertEqual(model.inlineErrorMessage, "stale read")
    }

    // MARK: Buckets

    func testBucketsAndRecentCap() {
        let jobs = [JobDrawerModelSamples.processing("a1"), JobDrawerModelSamples.queued("a2")]
            + JobDrawerModelSamples.manyRecent(7)
        let source = InMemoryExportDrawerJobsSource(initial: ExportDrawerJobsUpdate(status: .loaded, jobs: jobs))
        let model = makeModel(source: source, store: openStore())
        model.start()
        XCTAssertEqual(model.activeJobs.count, 2)
        XCTAssertEqual(model.activeCount, 2)
        XCTAssertEqual(model.recentJobs.count, 5)
    }

    // MARK: Presentation

    func testPresentationActionsPersistAndResolve() {
        let store = openStore()
        let source = InMemoryExportDrawerJobsSource(
            initial: ExportDrawerJobsUpdate(status: .loaded, jobs: [JobDrawerModelSamples.ready()])
        )
        let model = makeModel(source: source, store: store)
        model.start()
        model.expand()
        XCTAssertEqual(model.presentation, .open)
        XCTAssertEqual(store.load(), .open)
        XCTAssertEqual(model.visibility, .open)
        model.minimize()
        XCTAssertEqual(model.presentation, .minimized)
        XCTAssertEqual(model.visibility, .minimized)
        model.dismiss()
        XCTAssertEqual(model.presentation, .dismissed)
        XCTAssertEqual(store.load(), .dismissed)
        // No active jobs → a dismissed drawer hides.
        XCTAssertEqual(model.visibility, .hidden)
    }

    func testDismissWithActiveAutoPromotesToMinimized() {
        let source = InMemoryExportDrawerJobsSource(
            initial: ExportDrawerJobsUpdate(status: .loaded, jobs: [JobDrawerModelSamples.processing()])
        )
        let model = makeModel(source: source, store: openStore())
        model.start()
        model.dismiss()
        XCTAssertEqual(model.presentation, .dismissed)
        // An active job auto-promotes the resolved visibility back to the minimized chip.
        XCTAssertEqual(model.visibility, .minimized)
    }

    func testAutoPromoteFromDismissedOnNewActiveJob() {
        let store = InMemoryJobDrawerPresentationStore(initial: .dismissed)
        let source = InMemoryExportDrawerJobsSource(initial: ExportDrawerJobsUpdate(status: .loaded, jobs: []))
        let model = makeModel(source: source, store: store)
        model.start()
        XCTAssertEqual(model.visibility, .hidden)
        source.push(ExportDrawerJobsUpdate(status: .loaded, jobs: [JobDrawerModelSamples.processing()]))
        XCTAssertEqual(model.presentation, .minimized)
        XCTAssertEqual(store.load(), .minimized)
        XCTAssertEqual(model.visibility, .minimized)
    }

    // MARK: Ambient hide / pinned

    func testAmbientHideWhenEmptyAndSettled() {
        let source = InMemoryExportDrawerJobsSource(initial: ExportDrawerJobsUpdate(status: .loaded, jobs: []))
        let model = makeModel(source: source) // store defaults to .minimized, not pinned
        model.start()
        XCTAssertEqual(model.visibility, .hidden)
    }

    func testPinnedSuppressesAmbientHide() {
        let source = InMemoryExportDrawerJobsSource(initial: ExportDrawerJobsUpdate(status: .loaded, jobs: []))
        let model = makeModel(source: source, pinned: true, store: openStore())
        model.start()
        XCTAssertEqual(model.visibility, .open)
    }

    // MARK: Freshness

    func testStaleAutoRefreshesOnceThenReArms() {
        let rows = [JobDrawerModelSamples.ready()]
        let source = InMemoryExportDrawerJobsSource(initial: ExportDrawerJobsUpdate(status: .loaded, jobs: rows))
        let model = makeModel(source: source, store: openStore())
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(ExportDrawerJobsUpdate(status: .loaded, jobs: rows, connection: .stale))
        source.push(ExportDrawerJobsUpdate(status: .loaded, jobs: rows, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(ExportDrawerJobsUpdate(status: .loaded, jobs: rows, connection: .live))
        source.push(ExportDrawerJobsUpdate(status: .loaded, jobs: rows, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsJobsAndDoesNotRefresh() {
        let rows = [JobDrawerModelSamples.ready()]
        let source = InMemoryExportDrawerJobsSource(initial: ExportDrawerJobsUpdate(status: .loaded, jobs: rows))
        let model = makeModel(source: source, store: openStore())
        model.start()
        source.push(ExportDrawerJobsUpdate(status: .loaded, jobs: rows, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.bodyPhase, .populated)
        XCTAssertEqual(model.visibility, .open)
        XCTAssertEqual(source.refreshCount, 0)
    }

    // MARK: Download + display

    func testDownloadInvokesActionSeam() {
        let actions = RecordingExportDrawerActions()
        let model = makeModel(source: InMemoryExportDrawerJobsSource(), actions: actions)
        model.download(JobDrawerModelSamples.ready("9"))
        XCTAssertEqual(actions.downloadedIDs, ["9"])
    }

    func testDetailLineActiveAndRecent() {
        let model = makeModel(source: InMemoryExportDrawerJobsSource())
        XCTAssertEqual(model.detailLine(JobDrawerModelSamples.processing()), "Processing · started 1m ago")
        XCTAssertEqual(model.detailLine(JobDrawerModelSamples.ready()), "1.0 MB · 50m ago")
    }

    func testRelativeLabelUsesInjectedClock() {
        let model = makeModel(source: InMemoryExportDrawerJobsSource())
        XCTAssertEqual(
            model.relativeLabel(JobDrawerModelSamples.anchor.addingTimeInterval(-3600)),
            "1h ago"
        )
    }

    func testSizeLabelZeroIsEmDash() {
        let model = makeModel(source: InMemoryExportDrawerJobsSource())
        let zeroSize = ExportDrawerJob(
            id: "z", kind: .drives, format: "csv", status: .ready,
            fileSize: 0, createdAt: JobDrawerModelSamples.anchor
        )
        XCTAssertEqual(model.sizeLabel(zeroSize), "—")
    }

    // MARK: Helpers

    private func openStore() -> InMemoryJobDrawerPresentationStore {
        InMemoryJobDrawerPresentationStore(initial: .open)
    }
}
