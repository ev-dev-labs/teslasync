//
//  FSMTimelineChart.ModelTests.swift
//  TeslaSync — P4 feature view · 0231 · FSMTimelineChart (Apple)
//
//  State-holder coverage for the FSMTimelineChart surface (`FSMTimelineChartModel`):
//  phase across loading / loaded / empty / failed, the parent `emptyMessage`
//  override, the window `hours` passthrough, the P1/S11 `view.opened` telemetry
//  (exactly once), the tooltip cursor (move + auto-clear on data change), the stale
//  auto-refresh (exactly once, re-armed on returning to live), offline keeping the
//  cached timeline, and the retry / stop plumbing. Driven through an in-memory source
//  with an injected fixed clock + UTC calendar — no network, no bundle.
//

import XCTest
@testable import TeslaSync

@MainActor
final class FSMTimelineChartModelTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")
    private let nowMs: Int64 = 1_700_000_400_000
    private var now: Date {
        Date(timeIntervalSince1970: Double(nowMs) / 1000)
    }

    private var utc: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        return calendar
    }

    private var transitions: [FSMTransitionInput] {
        [
            FSMTransitionInput(timestamp: now.addingTimeInterval(-5 * 60), fsmName: "vehicle"),
            FSMTransitionInput(timestamp: now.addingTimeInterval(-5 * 60), fsmName: "drive"),
            FSMTransitionInput(timestamp: now.addingTimeInterval(-65 * 60), fsmName: "telemetry_connection")
        ]
    }

    private func makeModel(
        initial: FSMTimelineChartUpdate?,
        telemetry: FSMTimelineChartTelemetry = SpyFSMTimelineChartTelemetry()
    ) -> (FSMTimelineChartModel, InMemoryFSMTimelineChartSource) {
        let source = InMemoryFSMTimelineChartSource(initial: initial)
        let model = FSMTimelineChartModel(
            source: source,
            telemetry: telemetry,
            locale: posix,
            calendar: utc,
            now: { [now] in now }
        )
        return (model, source)
    }

    private func loadedUpdate(
        connection: FSMTimelineConnection = .live,
        hours: Int = 6
    ) -> FSMTimelineChartUpdate {
        FSMTimelineChartUpdate(
            status: .loaded,
            transitions: transitions,
            hours: hours,
            connection: connection
        )
    }

    func testLoadedContentProjectsBucketsAndSeries() {
        let (model, source) = makeModel(initial: loadedUpdate())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.buckets.count, 37)
        XCTAssertEqual(model.series.map(\.name), ["drive", "telemetry_connection", "vehicle"])
        XCTAssertEqual(model.hours, 6)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedEmptyResolvesEmptyPhaseWithDefaultMessage() {
        let (model, _) = makeModel(initial: FSMTimelineChartUpdate(status: .loaded, transitions: [], hours: 6))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.buckets.isEmpty)
        XCTAssertTrue(model.series.isEmpty)
        XCTAssertEqual(model.emptyMessage, "No transition data for timeline")
    }

    func testParentEmptyMessageOverrideIsUsed() {
        let (model, _) = makeModel(
            initial: FSMTimelineChartUpdate(
                status: .loaded,
                transitions: [],
                hours: 6,
                emptyMessage: "No FSM activity yet"
            )
        )
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.emptyMessage, "No FSM activity yet")
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: FSMTimelineChartUpdate(status: .loading, transitions: [], hours: 6))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: FSMTimelineChartUpdate(status: .failed("timeout"), hours: 6))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testHoursPassThroughOnUpdate() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(loadedUpdate(hours: 24))
        XCTAssertEqual(model.hours, 24)
        // 24h / 30min grid = 49 cells.
        XCTAssertEqual(model.buckets.count, 49)
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyFSMTimelineChartTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [FSMTimelineChartSurface.slug])
    }

    func testMoveCursorSetsAndClearsSelectedIndex() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(loadedUpdate())
        model.moveCursor(to: 5)
        XCTAssertEqual(model.selectedBucketIndex, 5)
        XCTAssertNotNil(model.selectedBucket)
        model.moveCursor(to: nil)
        XCTAssertNil(model.selectedBucketIndex)
    }

    func testCursorAutoClearsWhenBucketsRemovedOnDataChange() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(loadedUpdate())
        model.moveCursor(to: 5)
        XCTAssertEqual(model.selectedBucketIndex, 5)
        // New data with no transitions → the lingering tooltip is dropped.
        source.push(FSMTimelineChartUpdate(status: .loaded, transitions: [], hours: 6))
        XCTAssertNil(model.selectedBucketIndex)
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(loadedUpdate(connection: .stale))
        source.push(loadedUpdate(connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(loadedUpdate(connection: .stale))
        source.push(loadedUpdate(connection: .live))
        source.push(loadedUpdate(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedTimelineWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(loadedUpdate(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.buckets.count, 37)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: FSMTimelineChartUpdate(status: .failed("x"), hours: 6))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopStopsSource() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyFSMTimelineChartTelemetry: FSMTimelineChartTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
