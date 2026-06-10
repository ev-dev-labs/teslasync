//
//  QueueJobDrawer.ModelTests.swift
//  TeslaSync — P4 modal / dialog · 0020 · QueueJobDrawer (Apple)
//
//  State-holder coverage for `QueueJobDrawerModel`: the P1/S11 `view.opened` telemetry (once +
//  re-armed on re-present), the body-phase transitions across loading / loaded-empty / failed
//  (incl. the inline-error envelope when cached rows survive a failed reload), the drawer title
//  (with + without a worker name), the per-row display projection (title fallback, status word,
//  tone, the "Started … · Took …" caption, the duration presence/absence, the VoiceOver label),
//  the stale auto-refresh (once, re-armed on return to live), offline keeping cached jobs, and the
//  dismissal command (web `onClose`). Driven through the in-memory source — no network.
//

import XCTest
@testable import TeslaSync

/// Records the `view.opened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam
/// under Swift 6 strict concurrency.
private final class SpyQueueJobDrawerTelemetry: QueueJobDrawerTelemetry, @unchecked Sendable {
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

/// A fixed date facade so caption assertions never drift with the locale / wall clock.
private struct StubQueueJobDateFormatting: QueueJobDateFormatting {
    let value: String
    func dateTime(_: Date) -> String {
        value
    }
}

/// Records `onClose` invocations (MainActor-isolated; only touched from the test actor).
@MainActor
private final class CloseRecorder {
    private(set) var count = 0
    func record() {
        count += 1
    }
}

@MainActor
final class QueueJobDrawerModelTests: XCTestCase {
    private let anchor = Date(timeIntervalSince1970: 1_717_000_000)

    private func sent(_ id: String = "1") -> QueueJobRowData {
        QueueJobRowData(
            id: id, worker: "notification", status: "sent", title: "Charge complete",
            startedAt: anchor.addingTimeInterval(-600), finishedAt: anchor.addingTimeInterval(-598),
            durationMs: 1500
        )
    }

    private func processing(_ id: String = "2") -> QueueJobRowData {
        QueueJobRowData(
            id: id, worker: "notification", status: "processing", title: "Geofence arrival",
            startedAt: anchor.addingTimeInterval(-120)
        )
    }

    private func failed(_ id: String = "4") -> QueueJobRowData {
        QueueJobRowData(
            id: id, worker: "notification", status: "failed", title: "Push to device",
            startedAt: anchor.addingTimeInterval(-7200), finishedAt: anchor.addingTimeInterval(-7140),
            durationMs: 60000, error: "APNs 410 BadDeviceToken"
        )
    }

    private func makeModel(
        source: InMemoryQueueJobsSource,
        displayName: String? = "Notification",
        telemetry: SpyQueueJobDrawerTelemetry = SpyQueueJobDrawerTelemetry(),
        dates: any QueueJobDateFormatting = StubQueueJobDateFormatting(value: "AT"),
        onClose: @escaping @MainActor () -> Void = {}
    ) -> QueueJobDrawerModel {
        QueueJobDrawerModel(
            source: source,
            worker: "notification",
            displayName: displayName,
            telemetry: telemetry,
            dates: dates,
            onClose: onClose,
            localize: { _, fallback in fallback }
        )
    }

    // MARK: Telemetry

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyQueueJobDrawerTelemetry()
        let source = InMemoryQueueJobsSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["QueueJobDrawer"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testStopReArmsViewOpenedForNextPresentation() {
        let spy = SpyQueueJobDrawerTelemetry()
        let source = InMemoryQueueJobsSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, ["QueueJobDrawer", "QueueJobDrawer"])
        XCTAssertEqual(source.startCount, 2)
        XCTAssertEqual(source.stopCount, 1)
    }

    // MARK: Body phases

    func testLoadingThenPopulated() {
        let source = InMemoryQueueJobsSource(initial: QueueJobsUpdate(status: .loading))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(QueueJobsUpdate(status: .loaded, jobs: [sent(), processing()]))
        XCTAssertEqual(model.phase, .populated)
        XCTAssertTrue(model.hasJobs)
    }

    func testLoadedEmptyPhase() {
        let source = InMemoryQueueJobsSource(initial: QueueJobsUpdate(status: .loaded, jobs: []))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertFalse(model.hasJobs)
    }

    func testFailedNoRowsErrorPhase() {
        let source = InMemoryQueueJobsSource(initial: QueueJobsUpdate(status: .failed("timeout"), jobs: []))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testFailedWithRowsKeepsPopulatedAndSurfacesInlineError() {
        let rows = [sent()]
        let source = InMemoryQueueJobsSource(initial: QueueJobsUpdate(status: .loaded, jobs: rows))
        let model = makeModel(source: source)
        model.start()
        source.push(QueueJobsUpdate(status: .failed("stale read"), jobs: rows))
        XCTAssertEqual(model.phase, .populated)
        XCTAssertEqual(model.inlineErrorMessage, "stale read")
    }

    // MARK: Title

    func testTitleWithAndWithoutWorkerName() {
        let withName = makeModel(source: InMemoryQueueJobsSource(), displayName: "Notification")
        XCTAssertEqual(withName.title, "Recent Notification jobs")
        XCTAssertEqual(withName.panelAccessibilityLabel, "Recent Notification jobs")
        let noName = makeModel(source: InMemoryQueueJobsSource(), displayName: nil)
        XCTAssertEqual(noName.title, "Recent jobs")
    }

    // MARK: Per-row display projection

    func testDisplayTitleAndStatusLabelAndTone() {
        let model = makeModel(source: InMemoryQueueJobsSource())
        let job = sent()
        XCTAssertEqual(model.displayTitle(job), "Charge complete")
        // The identity localizer returns the web fallback — the raw status token.
        XCTAssertEqual(model.statusLabel(job), "sent")
        XCTAssertEqual(model.statusTone(job), .success)
    }

    func testDurationLabelPresentFromDurationMs() {
        let model = makeModel(source: InMemoryQueueJobsSource())
        XCTAssertEqual(model.durationLabel(sent()), "Took 1.5s")
    }

    func testDurationLabelFromFinishedMinusStarted() {
        let model = makeModel(source: InMemoryQueueJobsSource())
        let job = QueueJobRowData(
            id: "x", worker: "w", status: "success", title: "t",
            startedAt: anchor, finishedAt: anchor.addingTimeInterval(60)
        )
        XCTAssertEqual(model.durationLabel(job), "Took 1m 0s")
    }

    func testDurationLabelAbsentWhenNoDurationOrFinished() {
        let model = makeModel(source: InMemoryQueueJobsSource())
        XCTAssertNil(model.durationLabel(processing()))
    }

    func testDetailLineStartedOnlyAndWithDuration() {
        let model = makeModel(source: InMemoryQueueJobsSource(), dates: StubQueueJobDateFormatting(value: "AT"))
        XCTAssertEqual(model.detailLine(processing()), "Started AT")
        XCTAssertEqual(model.detailLine(sent()), "Started AT · Took 1.5s")
    }

    func testRowAccessibilityLabelComposition() {
        let model = makeModel(source: InMemoryQueueJobsSource())
        let label = model.rowAccessibilityLabel(failed())
        XCTAssertTrue(label.hasPrefix("Push to device, failed, Started AT"))
        XCTAssertTrue(label.hasSuffix("APNs 410 BadDeviceToken"))
    }

    // MARK: Freshness

    func testStaleAutoRefreshesOnceThenReArms() {
        let rows = [sent()]
        let source = InMemoryQueueJobsSource(initial: QueueJobsUpdate(status: .loaded, jobs: rows))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(QueueJobsUpdate(status: .loaded, jobs: rows, connection: .stale))
        source.push(QueueJobsUpdate(status: .loaded, jobs: rows, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(QueueJobsUpdate(status: .loaded, jobs: rows, connection: .live))
        source.push(QueueJobsUpdate(status: .loaded, jobs: rows, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsJobsAndDoesNotRefresh() {
        let rows = [sent()]
        let source = InMemoryQueueJobsSource(initial: QueueJobsUpdate(status: .loaded, jobs: rows))
        let model = makeModel(source: source)
        model.start()
        source.push(QueueJobsUpdate(status: .loaded, jobs: rows, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .populated)
        XCTAssertEqual(source.refreshCount, 0)
    }

    // MARK: Command

    func testDismissInvokesOnClose() {
        let recorder = CloseRecorder()
        let model = makeModel(source: InMemoryQueueJobsSource(), onClose: { recorder.record() })
        model.dismiss()
        XCTAssertEqual(recorder.count, 1)
    }

    func testRefreshDelegatesToSource() {
        let source = InMemoryQueueJobsSource()
        let model = makeModel(source: source)
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }
}
