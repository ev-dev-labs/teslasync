//
//  WeekOverWeekSummary.ModelTests.swift
//  TeslaSync — P4 feature view · 0078 · WeekOverWeekSummary (Apple)
//
//  State-holder coverage for the WeekOverWeekSummary surface, split out of
//  `WeekOverWeekSummary.Tests.swift` so each file stays within the SwiftLint
//  file-length budget. Exercises `WeekOverWeekSummaryModel`:
//    • the phase machine (loading → loaded / empty / failed),
//    • cached-keep-on-failure (the last comparison stays visible behind a retry),
//    • offline / stale freshness flags + the freshness-window helper,
//    • refresh forwarding, and the P1/S11 `view.opened` telemetry wiring.
//
//  No network and no real store: the model is driven by `InMemoryWeekOverWeekSource`
//  and a telemetry spy.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixture

private enum WeekOverWeekModelFixture {
    static let sample = WeekOverWeekMetrics(
        totalDistance: 312.4,
        prevDistance: 280.1,
        totalDrives: 18,
        prevDriveCount: 15,
        energyUsed: 64.2,
        prevEnergy: 70.5,
        chargingCost: 12.80,
        prevChargingCost: 15.10,
        avgEfficiency: 205.6,
        prevAvgEfficiency: 212.0,
        co2Saved: 22.6,
        prevCo2: 19.8
    )
}

// MARK: - State holder: phase, freshness, offline, telemetry

@MainActor final class WeekOverWeekSummaryModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryWeekOverWeekSource,
        telemetry: WeekOverWeekTelemetry = OSLogWeekOverWeekTelemetry()
    ) -> WeekOverWeekSummaryModel {
        WeekOverWeekSummaryModel(source: source, telemetry: telemetry)
    }

    func testPhaseStartsLoadingUntilSnapshotArrives() {
        let source = InMemoryWeekOverWeekSource(initial: nil)
        let model = makeModel(source: source)
        XCTAssertEqual(model.phase, .loading)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(WeekOverWeekUpdate(metrics: WeekOverWeekModelFixture.sample))
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertEqual(model.items.count, 6)
    }

    func testLoadedSnapshotProjectsItems() {
        let source = InMemoryWeekOverWeekSource(
            initial: WeekOverWeekUpdate(metrics: WeekOverWeekModelFixture.sample, updatedAt: Date())
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertFalse(model.isOffline)
        XCTAssertFalse(model.isStale)
        XCTAssertEqual(model.items.first?.value, "312.4")
    }

    func testEmptySnapshotClearsMetrics() {
        let source = InMemoryWeekOverWeekSource(initial: WeekOverWeekUpdate(metrics: nil))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertFalse(model.hasCachedMetrics)
        XCTAssertTrue(model.items.isEmpty)
    }

    func testFailureWithoutCacheIsError() {
        let source = InMemoryWeekOverWeekSource(initial: WeekOverWeekUpdate(metrics: nil, failed: true))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .failed)
        XCTAssertFalse(model.hasCachedMetrics)
    }

    func testFailureKeepsCachedMetricsVisible() {
        let source = InMemoryWeekOverWeekSource(initial: WeekOverWeekUpdate(metrics: WeekOverWeekModelFixture.sample))
        let model = makeModel(source: source)
        model.start()
        source.push(WeekOverWeekUpdate(metrics: nil, connection: .offline, failed: true))
        XCTAssertEqual(model.phase, .failed)
        XCTAssertTrue(model.hasCachedMetrics)
        XCTAssertEqual(model.items.count, 6)
    }

    func testConnectivityDrivesFreshnessFlags() {
        let source = InMemoryWeekOverWeekSource(initial: WeekOverWeekUpdate(metrics: WeekOverWeekModelFixture.sample))
        let model = makeModel(source: source)
        model.start()
        source.push(WeekOverWeekUpdate(metrics: WeekOverWeekModelFixture.sample, connection: .stale))
        XCTAssertTrue(model.isStale)
        source.push(WeekOverWeekUpdate(metrics: WeekOverWeekModelFixture.sample, connection: .offline))
        XCTAssertTrue(model.isOffline)
    }

    func testRefreshForwardsToSource() {
        let source = InMemoryWeekOverWeekSource(initial: WeekOverWeekUpdate(metrics: WeekOverWeekModelFixture.sample))
        let model = makeModel(source: source)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyWeekOverWeekTelemetry()
        let model = makeModel(source: InMemoryWeekOverWeekSource(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.opened, ["WeekOverWeekSummary"])
        XCTAssertEqual(WeekOverWeekSummary.surfaceSlug, "WeekOverWeekSummary")
    }

    func testStartStopLifecycleCountsOnSource() {
        let source = InMemoryWeekOverWeekSource()
        let model = makeModel(source: source)
        model.start()
        model.stop()
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testFreshnessHelperWindow() {
        let now = Date()
        XCTAssertFalse(WeekOverWeekFreshness.isStale(updatedAt: nil, now: now))
        XCTAssertFalse(WeekOverWeekFreshness.isStale(updatedAt: now, now: now))
        XCTAssertTrue(WeekOverWeekFreshness.isStale(updatedAt: now.addingTimeInterval(-120), now: now))
    }
}

// MARK: - Test doubles

/// Records the surface slugs reported to the telemetry seam.
private final class SpyWeekOverWeekTelemetry: WeekOverWeekTelemetry, @unchecked Sendable {
    private(set) var opened: [String] = []
    func viewOpened(surface: String) {
        opened.append(surface)
    }
}
