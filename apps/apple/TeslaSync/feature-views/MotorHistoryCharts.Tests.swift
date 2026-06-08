//
//  MotorHistoryCharts.Tests.swift
//  TeslaSync — P4 feature view · 0172 · MotorHistoryCharts (Apple)
//
//  Unit coverage for the MotorHistoryCharts surface:
//    • Adapter (`MotorHistoryChartsBuilder`) — the three-dataset projection
//      (power/regen, torque front/rear, rpm front/rear), null preservation,
//      unparseable-timestamp dropping, ascending time sort, ISO-8601 parsing, and
//      the content/empty phase split (parity with the web `useMemo` derivations).
//    • State holder (`MotorHistoryChartsModel`) — phase across loading / loaded /
//      empty / failed, the P1/S11 `view.opened` telemetry (once), the stale
//      auto-refresh (exactly once + re-arm), offline keeping cached traces, and the
//      power-chart legend toggle (web `useHiddenSeries`).
//    • Accessibility — the surface summary + per-chart min/max/latest summaries.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum MotorHistoryChartsFixture {
    static let base = Date(timeIntervalSince1970: 1_700_000_000)

    static func stamp(_ secondsOffset: Int) -> String {
        ISO8601DateFormatter().string(from: base.addingTimeInterval(Double(secondsOffset)))
    }

    static func sample(
        offset: Int,
        power: Double? = nil,
        regen: Double? = nil,
        torqueFront: Double? = nil,
        torqueRear: Double? = nil,
        rpmFront: Double? = nil,
        rpmRear: Double? = nil
    ) -> MotorHistoryChartsSample {
        MotorHistoryChartsSample(
            timestamp: stamp(offset),
            powerKw: power,
            regenKw: regen,
            torqueFront: torqueFront,
            torqueRear: torqueRear,
            rpmFront: rpmFront,
            rpmRear: rpmRear
        )
    }

    static let drive: [MotorHistoryChartsSample] = [
        sample(offset: 0, power: 40, regen: nil, torqueFront: 180, torqueRear: 160, rpmFront: 3000, rpmRear: 3100),
        sample(offset: 5, power: 80, regen: nil, torqueFront: 260, torqueRear: 240, rpmFront: 5200, rpmRear: 5300),
        sample(offset: 10, power: nil, regen: 30, torqueFront: -60, torqueRear: -50, rpmFront: 4800, rpmRear: 4900)
    ]
}

// MARK: - Adapter: projection (web useMemo parity)

final class MotorHistoryChartsBuilderTests: XCTestCase {
    func testProjectMapsEveryDatasetAndPreservesNulls() {
        let projection = MotorHistoryChartsBuilder.project(MotorHistoryChartsFixture.drive)
        XCTAssertEqual(projection.points.count, 3)
        let first = projection.points[0]
        XCTAssertEqual(first.powerKw, 40)
        XCTAssertNil(first.regenKw)
        XCTAssertEqual(first.torqueFront, 180)
        XCTAssertEqual(first.torqueRear, 160)
        XCTAssertEqual(first.rpmFront, 3000)
        XCTAssertEqual(first.rpmRear, 3100)
        // The regen-on-lift-off sample keeps its null power (web `?? null` gap).
        let last = projection.points[2]
        XCTAssertNil(last.powerKw)
        XCTAssertEqual(last.regenKw, 30)
    }

    func testProjectDropsRowsWithoutParseableTimestamp() {
        let samples = [
            MotorHistoryChartsSample(timestamp: nil, powerKw: 10),
            MotorHistoryChartsSample(timestamp: "not-a-date", powerKw: 20),
            MotorHistoryChartsFixture.sample(offset: 0, power: 30)
        ]
        let projection = MotorHistoryChartsBuilder.project(samples)
        XCTAssertEqual(projection.points.count, 1)
        XCTAssertEqual(projection.points.first?.powerKw, 30)
    }

    func testProjectSortsAscendingByTime() {
        let samples = [
            MotorHistoryChartsFixture.sample(offset: 30, power: 3),
            MotorHistoryChartsFixture.sample(offset: 10, power: 1),
            MotorHistoryChartsFixture.sample(offset: 20, power: 2)
        ]
        let points = MotorHistoryChartsBuilder.project(samples).points
        XCTAssertEqual(points.map(\.powerKw), [1, 2, 3])
        XCTAssertTrue(points[0].time < points[1].time)
        XCTAssertTrue(points[1].time < points[2].time)
    }

    func testProjectEmptyHasNoData() {
        let projection = MotorHistoryChartsBuilder.project([])
        XCTAssertFalse(projection.hasData)
        XCTAssertTrue(projection.points.isEmpty)
    }

    func testProjectionValuesFilterNilAndNonFinite() {
        let samples = [
            MotorHistoryChartsFixture.sample(offset: 0, power: 10),
            MotorHistoryChartsFixture.sample(offset: 5, power: nil),
            MotorHistoryChartsFixture.sample(offset: 10, power: .nan),
            MotorHistoryChartsFixture.sample(offset: 15, power: 20)
        ]
        let projection = MotorHistoryChartsBuilder.project(samples)
        XCTAssertEqual(projection.values(\.powerKw), [10, 20])
    }

    func testParseTimestampToleratesFractionalSeconds() {
        XCTAssertNotNil(MotorHistoryChartsBuilder.parseTimestamp("2023-11-14T22:13:20Z"))
        XCTAssertNotNil(MotorHistoryChartsBuilder.parseTimestamp("2023-11-14T22:13:20.500Z"))
        XCTAssertNil(MotorHistoryChartsBuilder.parseTimestamp(""))
        XCTAssertNil(MotorHistoryChartsBuilder.parseTimestamp("nonsense"))
    }

    func testResolvePhase() {
        XCTAssertEqual(MotorHistoryChartsBuilder.resolvePhase(.loading, hasData: false), .loading)
        XCTAssertEqual(MotorHistoryChartsBuilder.resolvePhase(.loaded, hasData: true), .content)
        XCTAssertEqual(MotorHistoryChartsBuilder.resolvePhase(.loaded, hasData: false), .empty)
        XCTAssertEqual(MotorHistoryChartsBuilder.resolvePhase(.failed("boom"), hasData: true), .error("boom"))
    }

    func testSurfaceSlug() {
        XCTAssertEqual(MotorHistoryChartsSurface.slug, "MotorHistoryCharts")
    }

    func testSeriesIdsMatchWeb() {
        XCTAssertEqual(MotorHistoryChartsSeries.power, "power")
        XCTAssertEqual(MotorHistoryChartsSeries.regen, "regen")
    }
}

// MARK: - State holder: MotorHistoryChartsModel

@MainActor
final class MotorHistoryChartsModelTests: XCTestCase {
    private func makeModel(
        initial: MotorHistoryChartsUpdate?,
        telemetry: MotorHistoryChartsTelemetry = SpyMotorHistoryChartsTelemetry()
    ) -> (MotorHistoryChartsModel, InMemoryMotorHistoryChartsSource) {
        let source = InMemoryMotorHistoryChartsSource(initial: initial)
        let model = MotorHistoryChartsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private let drive = MotorHistoryChartsFixture.drive

    func testLoadedContentProjectsPoints() {
        let (model, source) = makeModel(initial: MotorHistoryChartsUpdate(status: .loaded, samples: drive))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.points.count, 3)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedEmptyResolvesEmptyPhase() {
        let (model, _) = makeModel(initial: MotorHistoryChartsUpdate(status: .loaded, samples: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertFalse(model.projection.hasData)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: MotorHistoryChartsUpdate(status: .loading, samples: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: MotorHistoryChartsUpdate(status: .failed("timeout"), samples: []))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyMotorHistoryChartsTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [MotorHistoryChartsSurface.slug])
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(MotorHistoryChartsUpdate(status: .loaded, samples: drive, connection: .stale))
        source.push(MotorHistoryChartsUpdate(status: .loaded, samples: drive, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(MotorHistoryChartsUpdate(status: .loaded, samples: drive, connection: .stale))
        source.push(MotorHistoryChartsUpdate(status: .loaded, samples: drive, connection: .live))
        source.push(MotorHistoryChartsUpdate(status: .loaded, samples: drive, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedTracesWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(MotorHistoryChartsUpdate(status: .loaded, samples: drive, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.points.count, 3)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: MotorHistoryChartsUpdate(status: .failed("x"), samples: []))
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

    func testTogglePowerSeriesHidesAndShows() {
        let (model, _) = makeModel(initial: MotorHistoryChartsUpdate(status: .loaded, samples: drive))
        model.start()
        XCTAssertFalse(model.isPowerSeriesHidden(MotorHistoryChartsSeries.power))
        model.togglePowerSeries(MotorHistoryChartsSeries.power)
        XCTAssertTrue(model.isPowerSeriesHidden(MotorHistoryChartsSeries.power))
        XCTAssertEqual(model.hiddenPowerSeries, [MotorHistoryChartsSeries.power])
        model.togglePowerSeries(MotorHistoryChartsSeries.power)
        XCTAssertFalse(model.isPowerSeriesHidden(MotorHistoryChartsSeries.power))
        XCTAssertTrue(model.hiddenPowerSeries.isEmpty)
    }

    func testSurfaceSlugExposedOnView() {
        XCTAssertEqual(MotorHistoryCharts.surfaceSlug, "MotorHistoryCharts")
    }
}

// MARK: - Accessibility: VoiceOver summaries

final class MotorHistoryChartsAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testSummaryIncludesTitlesAndSampleCount() {
        let projection = MotorHistoryChartsBuilder.project(MotorHistoryChartsFixture.drive)
        let summary = MotorHistoryChartsAccessibility.summary(projection: projection, localize: echo)
        XCTAssertTrue(summary.contains("Motor Power Over Time"))
        XCTAssertTrue(summary.contains("Motor Torque History"))
        XCTAssertTrue(summary.contains("Motor RPM History"))
        XCTAssertTrue(summary.contains("3 samples"))
    }

    func testSummaryEmptyShowsAwaitingData() {
        let summary = MotorHistoryChartsAccessibility.summary(
            projection: .empty,
            localize: echo
        )
        XCTAssertTrue(summary.contains("Awaiting motor telemetry data..."))
    }

    func testChartSummaryReportsMinMaxLatest() {
        let summary = MotorHistoryChartsAccessibility.chartSummary(
            title: "Motor Power Over Time",
            series: [("Power", [10, 30, 20]), ("Regen", [])],
            unit: "kW",
            localize: echo
        )
        XCTAssertTrue(summary.contains("Motor Power Over Time"))
        XCTAssertTrue(summary.contains("Power min 10 kW"))
        XCTAssertTrue(summary.contains("max 30 kW"))
        XCTAssertTrue(summary.contains("latest 20 kW"))
        XCTAssertTrue(summary.contains("Regen: No data available"))
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyMotorHistoryChartsTelemetry: MotorHistoryChartsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
