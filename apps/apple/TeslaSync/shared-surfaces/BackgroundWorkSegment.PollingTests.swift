//
//  BackgroundWorkSegment.PollingTests.swift
//  TeslaSync — P4 shared surface · 0177 · BackgroundWorkSegment (Apple)
//
//  Seam + production-source coverage: the in-memory source, the mutation-activity observer, the
//  custom-job registry (web `registerJob` idempotence + cleanup), the export status filter, the scripted
//  export probe, the manual poller, and the ``PollingBackgroundWorkSource`` orchestration — the loading
//  emit, the export mapping (web `activeExportJobs`), the composite mutation job (web `mutationJob`), the
//  custom rows, and the freshness axis (live → stale / offline with a cached baseline, error leaf without
//  one). Driven through the deterministic doubles — no real network, no real time.
//

import XCTest
@testable import TeslaSync

// MARK: - Recorder

@MainActor
private final class SnapshotRecorder {
    var snapshots: [BackgroundWorkSnapshot] = []
    var last: BackgroundWorkSnapshot? {
        snapshots.last
    }

    func bind(_ source: any BackgroundWorkSource) {
        source.onUpdate = { [weak self] snapshot in self?.snapshots.append(snapshot) }
    }
}

// MARK: - In-memory source + observers

@MainActor
final class BackgroundWorkSeamTests: XCTestCase {
    func testInMemorySourceAppliesInitialAndCounts() {
        let source = InMemoryBackgroundWorkSource(initial: BackgroundWorkSnapshot(isLoading: true))
        let recorder = SnapshotRecorder()
        recorder.bind(source)
        source.start()
        source.refresh()
        source.stop()
        XCTAssertEqual(recorder.snapshots.count, 1)
        XCTAssertEqual(recorder.last?.isLoading, true)
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testMutationObserverEmitsAndClampsNegative() {
        let observer = InMemoryMutationActivityObserver(count: 3)
        var seen: [Int] = []
        observer.onCountChange = { seen.append($0) }
        observer.start()
        observer.push(-5)
        XCTAssertEqual(observer.count, 0)
        XCTAssertEqual(seen, [3, 0])
    }

    func testCustomRegistryRegisterReplaceDeregisterClear() {
        let registry = BackgroundCustomJobRegistry(clock: { Date(timeIntervalSince1970: 0) })
        var latest: [BackgroundJob] = []
        registry.onJobsChange = { latest = $0 }
        registry.start()
        let cancel = registry.register(id: "backup", label: "Generating backup")
        XCTAssertEqual(latest.map(\.id), ["backup"])
        XCTAssertEqual(latest.first?.kind, .custom)
        registry.register(id: "backup", label: "Generating backup v2")
        XCTAssertEqual(latest.count, 1)
        XCTAssertEqual(latest.first?.label, "Generating backup v2")
        cancel()
        XCTAssertTrue(latest.isEmpty)
        registry.register(id: "a", label: "A")
        registry.clear()
        XCTAssertTrue(latest.isEmpty)
    }

    func testExportStatusActiveFilter() {
        XCTAssertTrue(BackgroundExportStatus.queued.isActive)
        XCTAssertTrue(BackgroundExportStatus.processing.isActive)
        XCTAssertFalse(BackgroundExportStatus.completed.isActive)
        XCTAssertFalse(BackgroundExportStatus.failed.isActive)
        XCTAssertFalse(BackgroundExportStatus.cancelled.isActive)
    }

    func testManualPollerStartFireStop() {
        let poller = ManualBackgroundWorkPoller()
        var ticks = 0
        poller.start(interval: 5) { ticks += 1 }
        XCTAssertTrue(poller.isRunning)
        poller.fire()
        poller.fire()
        XCTAssertEqual(ticks, 2)
        poller.stop()
        XCTAssertFalse(poller.isRunning)
        poller.fire()
        XCTAssertEqual(ticks, 2)
    }

    func testScriptedExportProbeReturnsInOrderThenRepeats() async {
        let probe = ScriptedExportJobsProbe([
            .jobs([]),
            .failed(message: "x", offline: true)
        ])
        if case .jobs = await probe.probe() {} else { XCTFail("expected jobs") }
        if case .failed = await probe.probe() {} else { XCTFail("expected failed") }
        if case .failed = await probe.probe() {} else { XCTFail("expected repeat failed") }
    }
}

// MARK: - Production polling source

@MainActor
final class PollingBackgroundWorkSourceTests: XCTestCase {
    private let resolve: BackgroundWorkResolve = { _, fallback in fallback }

    private func makeSource(
        _ outcomes: [ExportJobsProbeOutcome],
        mutation: InMemoryMutationActivityObserver = InMemoryMutationActivityObserver(),
        custom: BackgroundCustomJobRegistry = BackgroundCustomJobRegistry(clock: { Date(timeIntervalSince1970: 0) })
    ) -> (PollingBackgroundWorkSource, SnapshotRecorder) {
        let source = PollingBackgroundWorkSource(
            exportProbe: ScriptedExportJobsProbe(outcomes),
            mutationObserver: mutation,
            customObserver: custom,
            poller: ManualBackgroundWorkPoller(),
            resolve: resolve,
            clock: { Date(timeIntervalSince1970: 0) }
        )
        let recorder = SnapshotRecorder()
        recorder.bind(source)
        return (source, recorder)
    }

    func testStartEmitsLoadingFirst() {
        let (source, recorder) = makeSource([.jobs([])])
        source.start()
        XCTAssertEqual(recorder.snapshots.first?.isLoading, true)
        source.stop()
    }

    func testExportJobsMappedAndFiltered() async {
        let (source, recorder) = makeSource([.jobs([
            BackgroundExportJob(id: "7", fileName: "a.csv", type: "drives", status: .processing, createdAt: "t1"),
            BackgroundExportJob(id: "8", fileName: nil, type: "charges", status: .queued, createdAt: "t2"),
            BackgroundExportJob(id: "9", fileName: "x", type: "y", status: .completed, createdAt: "t3")
        ])])
        source.start()
        await source.probeExportOnce()
        let jobs = recorder.last?.jobs ?? []
        XCTAssertEqual(jobs.map(\.id), ["export:7", "export:8"])
        XCTAssertEqual(jobs.first?.label, "a.csv")
        XCTAssertEqual(jobs.first?.description, "Processing")
        XCTAssertEqual(jobs[1].label, "charges export")
        XCTAssertEqual(jobs[1].description, "Queued")
        XCTAssertEqual(recorder.last?.connection, .live)
        XCTAssertEqual(recorder.last?.isLoading, false)
        source.stop()
    }

    func testCompositeMutationJob() {
        let mutation = InMemoryMutationActivityObserver()
        let (source, recorder) = makeSource([.jobs([])], mutation: mutation)
        source.start()
        mutation.push(1)
        XCTAssertEqual(recorder.last?.jobs.first { $0.kind == .mutation }?.label, "Saving…")
        mutation.push(3)
        XCTAssertEqual(recorder.last?.jobs.first { $0.kind == .mutation }?.label, "Saving 3 changes…")
        mutation.push(0)
        XCTAssertNil(recorder.last?.jobs.first { $0.kind == .mutation })
        source.stop()
    }

    func testCustomJobsAppended() {
        let custom = BackgroundCustomJobRegistry(clock: { Date(timeIntervalSince1970: 0) })
        let (source, recorder) = makeSource([.jobs([])], custom: custom)
        source.start()
        custom.register(id: "backup", label: "Generating backup", description: "Encrypting")
        let job = recorder.last?.jobs.first { $0.kind == .custom }
        XCTAssertEqual(job?.label, "Generating backup")
        XCTAssertEqual(job?.description, "Encrypting")
        source.stop()
    }

    func testLaterFailureMovesToStaleWithBaseline() async {
        let (source, recorder) = makeSource([
            .jobs([BackgroundExportJob(id: "1", fileName: "a", type: "d", status: .queued, createdAt: "t")]),
            .failed(message: "drop", offline: false)
        ])
        source.start()
        await source.probeExportOnce()
        XCTAssertEqual(recorder.last?.connection, .live)
        await source.probeExportOnce()
        XCTAssertEqual(recorder.last?.connection, .stale)
        XCTAssertNil(recorder.last?.errorMessage)
        source.stop()
    }

    func testFirstFailureSurfacesErrorLeaf() async {
        let (source, recorder) = makeSource([.failed(message: "boom", offline: false)])
        source.start()
        await source.probeExportOnce()
        XCTAssertEqual(recorder.last?.errorMessage, "boom")
        XCTAssertEqual(recorder.last?.isLoading, false)
        XCTAssertTrue(recorder.last?.jobs.isEmpty ?? false)
        source.stop()
    }

    func testOfflineFailureMovesToOfflineWithBaseline() async {
        let (source, recorder) = makeSource([
            .jobs([BackgroundExportJob(id: "1", fileName: "a", type: "d", status: .queued, createdAt: "t")]),
            .failed(message: "net", offline: true)
        ])
        source.start()
        await source.probeExportOnce()
        await source.probeExportOnce()
        XCTAssertEqual(recorder.last?.connection, .offline)
        source.stop()
    }
}
