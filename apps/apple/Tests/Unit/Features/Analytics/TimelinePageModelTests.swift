import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for `TimelinePageModel`, plus the pure `TimelineFormat`
/// formatters and the state bucket/palette mappings. Covers every data state the page renders
/// (loading / empty / error / success), vehicle selection, the indexed transition rows, the daily
/// breakdown bucketing, the proportional distribution segments, and the four summary metrics.
@MainActor
final class TimelinePageModelTests: XCTestCase {
    // MARK: - Stub source

    private struct StubError: Error {}

    private struct StubSource: TimelineDataSource {
        var vehicles: [TimelineVehicle] = []
        var transitions: [TimelineTransitionRecord] = []
        var summary: TimelineSummary?
        var failTransitions = false
        var failSummary = false

        func loadVehicles() async throws -> [TimelineVehicle] {
            vehicles
        }

        func loadTransitions(vehicleID _: Int64) async throws -> [TimelineTransitionRecord] {
            if failTransitions { throw StubError() }
            return transitions
        }

        func loadSummary(vehicleID _: Int64) async throws -> TimelineSummary? {
            if failSummary { throw StubError() }
            return summary
        }
    }

    private static func date(_ iso: String) -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: iso) ?? Date(timeIntervalSince1970: 0)
    }

    private static func vehicle(_ id: Int64) -> TimelineVehicle {
        TimelineVehicle(id: id, displayName: "Veh\(id)", vin: "VIN\(id)")
    }

    // MARK: - Phases

    func testInitialPhaseIsLoading() {
        let model = TimelinePageModel(dataSource: StubSource())
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.vehicles.isEmpty)
    }

    func testLoadWithNoVehiclesYieldsEmpty() async {
        let model = TimelinePageModel(dataSource: StubSource())
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.selectedVehicleID)
    }

    func testLoadSuccessYieldsReadyAndSelectsFirstVehicle() async {
        let source = StubSource(
            vehicles: [Self.vehicle(7), Self.vehicle(8)],
            transitions: [
                TimelineTransitionRecord(
                    timestamp: Self.date("2024-01-01T10:00:00Z"),
                    fromState: "online",
                    toState: "driving"
                )
            ],
            summary: TimelineSummary(
                totalSeconds: 100,
                byState: [TimelineStateSummaryRow(
                    state: "driving",
                    totalSeconds: 100,
                    percentage: 100,
                    transitionCount: 1
                )]
            )
        )
        let model = TimelinePageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.selectedVehicleID, 7)
    }

    func testVehicleWithEmptyDataStillReady() async {
        let source = StubSource(
            vehicles: [Self.vehicle(1)],
            transitions: [],
            summary: TimelineSummary(totalSeconds: 0, byState: [])
        )
        let model = TimelinePageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.hasStateData)
        XCTAssertTrue(model.transitionRows.isEmpty)
        XCTAssertTrue(model.dailyBuckets.isEmpty)
        XCTAssertTrue(model.distributionSegments.isEmpty)
    }

    func testBothSourcesFailingYieldsError() async {
        let source = StubSource(vehicles: [Self.vehicle(1)], failTransitions: true, failSummary: true)
        let model = TimelinePageModel(dataSource: source)
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected error phase, got \(model.phase)")
        }
    }

    func testOneSourceFailingStaysReady() async {
        let source = StubSource(
            vehicles: [Self.vehicle(1)],
            transitions: [
                TimelineTransitionRecord(
                    timestamp: Self.date("2024-01-01T10:00:00Z"),
                    fromState: "online",
                    toState: "driving"
                )
            ],
            failSummary: true
        )
        let model = TimelinePageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.transitionRows.count, 1)
    }

    func testSelectVehicleSwitchesSelection() async {
        let source = StubSource(vehicles: [Self.vehicle(1), Self.vehicle(2)])
        let model = TimelinePageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.selectedVehicleID, 1)
        await model.selectVehicle(2)
        XCTAssertEqual(model.selectedVehicleID, 2)
    }

    // MARK: - Derivations

    func testTransitionRowsSortedIndexedAndChained() async {
        let source = StubSource(
            vehicles: [Self.vehicle(1)],
            transitions: [
                TimelineTransitionRecord(timestamp: Self.date("2024-01-01T12:00:00Z"), fromState: "a", toState: "b"),
                TimelineTransitionRecord(timestamp: Self.date("2024-01-01T08:00:00Z"), fromState: "x", toState: "y"),
                TimelineTransitionRecord(timestamp: Self.date("2024-01-01T10:00:00Z"), fromState: "m", toState: "n")
            ]
        )
        let model = TimelinePageModel(dataSource: source)
        await model.load()
        let rows = model.transitionRows
        XCTAssertEqual(rows.map(\.fromState), ["x", "m", "a"])
        XCTAssertEqual(rows.map(\.id), [0, 1, 2])
        XCTAssertEqual(rows[0].nextTimestamp, Self.date("2024-01-01T10:00:00Z"))
        XCTAssertNil(rows[2].nextTimestamp)
    }

    func testDailyBucketsGroupByUTCDayAndCategory() async {
        let source = StubSource(
            vehicles: [Self.vehicle(1)],
            transitions: [
                TimelineTransitionRecord(
                    timestamp: Self.date("2024-01-01T01:00:00Z"),
                    fromState: "_",
                    toState: "driving"
                ),
                TimelineTransitionRecord(
                    timestamp: Self.date("2024-01-01T02:00:00Z"),
                    fromState: "_",
                    toState: "online"
                ),
                TimelineTransitionRecord(
                    timestamp: Self.date("2024-01-01T03:00:00Z"),
                    fromState: "_",
                    toState: "offline"
                ),
                TimelineTransitionRecord(
                    timestamp: Self.date("2024-01-02T01:00:00Z"),
                    fromState: "_",
                    toState: "charging"
                ),
                TimelineTransitionRecord(
                    timestamp: Self.date("2024-01-02T02:00:00Z"),
                    fromState: "_",
                    toState: "parked"
                )
            ]
        )
        let model = TimelinePageModel(dataSource: source)
        await model.load()
        let buckets = model.dailyBuckets
        XCTAssertEqual(buckets.map(\.day), ["2024-01-01", "2024-01-02"])
        XCTAssertEqual(buckets[0].driving, 1)
        XCTAssertEqual(buckets[0].idle, 1) // online → idle
        XCTAssertEqual(buckets[0].sleeping, 1) // offline → sleeping
        XCTAssertEqual(buckets[1].charging, 1)
        XCTAssertEqual(buckets[1].idle, 1) // parked → idle
    }

    func testDistributionSegmentsComputeWidthAndDropSlivers() async {
        let source = StubSource(
            vehicles: [Self.vehicle(1)],
            summary: TimelineSummary(
                totalSeconds: 1000,
                byState: [
                    TimelineStateSummaryRow(state: "driving", totalSeconds: 600, percentage: 60, transitionCount: 3),
                    TimelineStateSummaryRow(state: "charging", totalSeconds: 398, percentage: 39.8, transitionCount: 2),
                    TimelineStateSummaryRow(state: "online", totalSeconds: 2, percentage: 0.2, transitionCount: 1)
                ]
            )
        )
        let model = TimelinePageModel(dataSource: source)
        await model.load()
        let segments = model.distributionSegments
        XCTAssertEqual(segments.map(\.state), ["driving", "charging"]) // online (0.2%) dropped
        XCTAssertEqual(segments[0].widthPercent, 60, accuracy: 0.001)
        XCTAssertEqual(segments[0].colorIndex, 2)
        XCTAssertTrue(model.hasStateData)
    }

    func testSummaryMetrics() async {
        let source = StubSource(
            vehicles: [Self.vehicle(1)],
            summary: TimelineSummary(
                totalSeconds: 270,
                byState: [
                    TimelineStateSummaryRow(state: "driving", totalSeconds: 100, percentage: 0, transitionCount: 4),
                    TimelineStateSummaryRow(state: "charging", totalSeconds: 50, percentage: 0, transitionCount: 3),
                    TimelineStateSummaryRow(state: "online", totalSeconds: 10, percentage: 0, transitionCount: 2),
                    TimelineStateSummaryRow(state: "parked", totalSeconds: 20, percentage: 0, transitionCount: 5),
                    TimelineStateSummaryRow(state: "idle", totalSeconds: 5, percentage: 0, transitionCount: 1),
                    TimelineStateSummaryRow(state: "asleep", totalSeconds: 30, percentage: 0, transitionCount: 2),
                    TimelineStateSummaryRow(state: "sleeping", totalSeconds: 40, percentage: 0, transitionCount: 3),
                    TimelineStateSummaryRow(state: "offline", totalSeconds: 15, percentage: 0, transitionCount: 1)
                ]
            )
        )
        let model = TimelinePageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.totalTransitions, 21)
        XCTAssertEqual(model.drivingSeconds, 100)
        XCTAssertEqual(model.chargingSeconds, 50)
        XCTAssertEqual(model.idleSeconds, 35) // online + parked + idle
        XCTAssertEqual(model.sleepingSeconds, 85) // asleep + sleeping + offline
        XCTAssertEqual(model.idleSleepSeconds, 120)
    }

    func testSampleDataSourceRendersSuccess() async {
        let model = TimelinePageModel(dataSource: SampleTimelineDataSource())
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.transitionRows.isEmpty)
        XCTAssertFalse(model.dailyBuckets.isEmpty)
        XCTAssertFalse(model.distributionSegments.isEmpty)
        XCTAssertGreaterThan(model.totalTransitions, 0)
    }
}

/// Pure-logic tests for the Timeline formatters + state mappings (no view layer).
final class TimelineFormatTests: XCTestCase {
    func testInteger() {
        XCTAssertEqual(TimelineFormat.integer(1240), "1,240")
        XCTAssertEqual(TimelineFormat.integer(.nan), "—")
    }

    func testPercent() {
        XCTAssertEqual(TimelineFormat.percent(41.7), "41.7%")
        XCTAssertEqual(TimelineFormat.percent(.infinity), "—")
    }

    func testHoursFromSeconds() {
        XCTAssertEqual(TimelineFormat.hoursFromSeconds(18000), "5h") // exactly 5h
        XCTAssertEqual(TimelineFormat.hoursFromSeconds(19800), "5h 30m") // 5.5h
        XCTAssertEqual(TimelineFormat.hoursFromSeconds(1800), "30m") // 0.5h
        XCTAssertEqual(TimelineFormat.hoursFromSeconds(0), "0m")
    }

    func testDurationFromSeconds() {
        XCTAssertEqual(TimelineFormat.durationFromSeconds(45), "45s")
        XCTAssertEqual(TimelineFormat.durationFromSeconds(120), "2m")
        XCTAssertEqual(TimelineFormat.durationFromSeconds(3600), "1h")
    }

    func testStateBucketMapping() {
        XCTAssertEqual(TimelineStateCategory.bucket(for: "driving"), .driving)
        XCTAssertEqual(TimelineStateCategory.bucket(for: "online"), .idle)
        XCTAssertEqual(TimelineStateCategory.bucket(for: "parked"), .idle)
        XCTAssertEqual(TimelineStateCategory.bucket(for: "offline"), .sleeping)
        XCTAssertEqual(TimelineStateCategory.bucket(for: "asleep"), .sleeping)
        XCTAssertNil(TimelineStateCategory.bucket(for: "mystery"))
    }

    func testStateColorIndexStable() {
        XCTAssertEqual(TimelineStateColor.colorIndex(for: "driving"), 2)
        XCTAssertEqual(TimelineStateColor.colorIndex(for: "charging"), 4)
        XCTAssertEqual(TimelineStateColor.colorIndex(for: .idle), 1)
        XCTAssertEqual(TimelineStateColor.legendStates.count, 8)
    }

    func testTransitionRowDuration() {
        let start = Date(timeIntervalSince1970: 1_000_000)
        let withNext = TimelineTransitionRow(
            id: 0, timestamp: start, fromState: "a", toState: "b",
            triggerField: nil, triggerValue: nil, nextTimestamp: start.addingTimeInterval(3600)
        )
        XCTAssertEqual(withNext.durationSeconds(now: start.addingTimeInterval(9999)), 3600)

        let liveRow = TimelineTransitionRow(
            id: 1, timestamp: start, fromState: "a", toState: "b",
            triggerField: nil, triggerValue: nil, nextTimestamp: nil
        )
        XCTAssertEqual(liveRow.durationSeconds(now: start.addingTimeInterval(1800)), 1800)
        XCTAssertNil(liveRow.durationSeconds(now: start)) // non-positive interval → nil
    }

    func testUTCDayKey() {
        let date = TimelinePageModelTestsDateBridge.date("2024-03-15T23:30:00Z")
        XCTAssertEqual(TimelinePageModel.utcDayKey(date), "2024-03-15")
    }
}

/// Tiny ISO date bridge so the non-`@MainActor` format tests can build fixed timestamps.
enum TimelinePageModelTestsDateBridge {
    static func date(_ iso: String) -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: iso) ?? Date(timeIntervalSince1970: 0)
    }
}
