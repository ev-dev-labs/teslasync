//
//  BatteryRangeCharts.ModelTests.swift
//  TeslaSync — P4 feature view · 0288 · BatteryRangeCharts (Apple)
//
//  State-holder coverage for the BatteryRangeCharts surface (split out of
//  BatteryRangeCharts.Tests.swift to keep both files within the file-length budget):
//    • `BatteryRangeChartsModel` — phase across loading / loaded / empty / failed, the P1/S11
//      `view.opened` telemetry (once), the stale auto-refresh (exactly once + re-arm once live),
//      and offline keeping cached panels without a refetch.
//
//  These run in the TeslaSync(/-macOS) XCTest targets and in the isolated SwiftPM harness. They
//  have no network and no bundle: the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder (BatteryRangeChartsModel)

@MainActor
final class BatteryRangeChartsModelTests: XCTestCase {
    private func makeModel(
        initial: BatteryRangeChartsUpdate?,
        telemetry: BatteryRangeChartsTelemetry = SpyBatteryRangeChartsTelemetry()
    ) -> (BatteryRangeChartsModel, InMemoryBatteryRangeChartsSource) {
        let source = InMemoryBatteryRangeChartsSource(initial: initial)
        let model = BatteryRangeChartsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var loadedSnapshot: BatteryRangeChartsSnapshot {
        BatteryRangeChartsSnapshot(
            state: BatteryRangeChartsState(batteryLevel: 64, ratedRangeMeters: 380_000),
            drives: [
                BatteryRangeChartsDrive(
                    id: "d1",
                    startTimestamp: Date(timeIntervalSince1970: 1_718_000_000),
                    distanceMeters: 25000,
                    durationSeconds: 1800
                )
            ]
        )
    }

    func testLoadedContentProjects() {
        let (model, source) = makeModel(
            initial: BatteryRangeChartsUpdate(status: .loaded, snapshot: loadedSnapshot)
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.content.hasState)
        XCTAssertTrue(model.content.hasDriveData)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedNoStateResolvesEmpty() {
        let (model, _) = makeModel(initial: BatteryRangeChartsUpdate(status: .loaded, snapshot: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: BatteryRangeChartsUpdate(status: .loading, snapshot: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: BatteryRangeChartsUpdate(status: .failed("timeout"), snapshot: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyBatteryRangeChartsTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [BatteryRangeChartsSurface.slug])
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(BatteryRangeChartsUpdate(status: .loaded, connection: .stale, snapshot: loadedSnapshot))
        source.push(BatteryRangeChartsUpdate(status: .loaded, connection: .stale, snapshot: loadedSnapshot))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertTrue(model.showsFreshness)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(BatteryRangeChartsUpdate(status: .loaded, connection: .stale, snapshot: loadedSnapshot))
        source.push(BatteryRangeChartsUpdate(status: .loaded, connection: .live, snapshot: loadedSnapshot))
        source.push(BatteryRangeChartsUpdate(status: .loaded, connection: .stale, snapshot: loadedSnapshot))
        XCTAssertEqual(source.refreshCount, 2)
        XCTAssertEqual(model.connection, .stale)
    }

    func testOfflineKeepsCachedPanelsWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(BatteryRangeChartsUpdate(status: .loaded, connection: .offline, snapshot: loadedSnapshot))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.content.hasState)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(
            initial: BatteryRangeChartsUpdate(status: .failed("x"), snapshot: nil)
        )
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

    func testSurfaceSlugExposedOnView() {
        XCTAssertEqual(BatteryRangeCharts.surfaceSlug, "BatteryRangeCharts")
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyBatteryRangeChartsTelemetry: BatteryRangeChartsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
