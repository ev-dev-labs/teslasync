//
//  DrivingTab.Tests.swift
//  TeslaSync — P4 feature view · 0056 · DrivingTab (Apple)
//
//  Unit coverage for the DrivingTab surface:
//    • Adapter (cached → projection) — `DriveAnalyticsUnits` SI conversions (parity-pinned
//      to web `lib/unitConversion.ts`), the bubble-size scale, the `safe` / `shortDate` /
//      `hourLabel` helpers, `DrivingTabProjection.make` per-chart selection + the
//      temperature-vs-efficiency boundary conversions, the `efficiency > 0` filter, and
//      the per-status phase resolution.
//    • State holder — `DrivingTabModel` phase resolution across loading / empty / error /
//      content, cached-stays-content on failure, reactive unit re-projection, refresh
//      delegation, stale auto-refresh, and the P1/S11 `view.opened` telemetry.
//    • Accessibility — the VoiceOver value summaries.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryDriveAnalyticsSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Shared sample payload

private func sampleInput() -> DriveAnalyticsInput {
    DriveAnalyticsInput(
        speedDistribution: [
            DriveDistributionBinInput(range: "0-20", count: 10),
            DriveDistributionBinInput(range: "20-40", count: 20)
        ],
        distanceDistribution: [DriveDistributionBinInput(range: "0-5", count: 5)],
        hourlyPattern: [
            DriveHourlyPointInput(hour: 8, drives: 3, distance: 24),
            DriveHourlyPointInput(hour: 9, drives: 5, distance: 40)
        ],
        tempVsEfficiency: [
            DriveTempEfficiencyInput(temp: 20, efficiency: 0.15, distance: 10),
            DriveTempEfficiencyInput(temp: 0, efficiency: 0.20, distance: 20),
            DriveTempEfficiencyInput(temp: 30, efficiency: 0.16, distance: 30)
        ],
        dailyTrend: [
            DriveDailyTrendInput(date: "2024-04-01", drives: 4, distance: 42, efficiency: 0.158),
            DriveDailyTrendInput(date: "2024-04-02", drives: 6, distance: 71, efficiency: 0),
            DriveDailyTrendInput(date: "2024-04-03", drives: 3, distance: 28, efficiency: nil)
        ],
        durationDistribution: [DriveDistributionBinInput(range: "0-10", count: 7)]
    )
}

// MARK: - Adapter: SI conversions (web lib/unitConversion.ts parity pins)

@MainActor final class DriveAnalyticsUnitsTests: XCTestCase {
    func testConvertTempFromSI() {
        XCTAssertEqual(DriveAnalyticsUnits.convertTempFromSI(0, to: "°C"), 0, accuracy: 1e-9)
        XCTAssertEqual(DriveAnalyticsUnits.convertTempFromSI(20, to: "°C"), 20, accuracy: 1e-9)
        XCTAssertEqual(DriveAnalyticsUnits.convertTempFromSI(0, to: "°F"), 32, accuracy: 1e-9)
        XCTAssertEqual(DriveAnalyticsUnits.convertTempFromSI(100, to: "°F"), 212, accuracy: 1e-9)
        XCTAssertEqual(DriveAnalyticsUnits.convertTempFromSI(37, to: "°F"), 98.6, accuracy: 1e-9)
    }

    func testConvertDistanceFromSI() {
        XCTAssertEqual(DriveAnalyticsUnits.convertDistanceFromSI(1000, to: "km"), 1, accuracy: 1e-9)
        XCTAssertEqual(DriveAnalyticsUnits.convertDistanceFromSI(1609.344, to: "mi"), 1, accuracy: 1e-9)
        XCTAssertEqual(DriveAnalyticsUnits.convertDistanceFromSI(0.3048, to: "ft"), 1, accuracy: 1e-9)
        // Unknown unit falls back to kilometers (web default branch).
        XCTAssertEqual(DriveAnalyticsUnits.convertDistanceFromSI(2000, to: "??"), 2, accuracy: 1e-9)
    }

    func testScaleEfficiencyAndLabel() {
        XCTAssertEqual(DriveAnalyticsUnits.scaleEfficiency(0.15, distanceUnit: "km"), 0.15, accuracy: 1e-9)
        XCTAssertEqual(
            DriveAnalyticsUnits.scaleEfficiency(0.15, distanceUnit: "mi"),
            0.15 * 1.609344,
            accuracy: 1e-9
        )
        XCTAssertEqual(DriveAnalyticsUnits.efficiencyLabel(distanceUnit: "km"), "Wh/km")
        XCTAssertEqual(DriveAnalyticsUnits.efficiencyLabel(distanceUnit: "mi"), "Wh/mi")
    }

    func testSafeGuardsNonFinite() {
        XCTAssertEqual(DriveAnalyticsUnits.safe(5), 5, accuracy: 1e-9)
        XCTAssertEqual(DriveAnalyticsUnits.safe(.nan), 0, accuracy: 1e-9)
        XCTAssertEqual(DriveAnalyticsUnits.safe(.infinity), 0, accuracy: 1e-9)
        XCTAssertEqual(DriveAnalyticsUnits.safe(-.infinity), 0, accuracy: 1e-9)
    }

    func testHourAndShortDateLabels() {
        XCTAssertEqual(DriveAnalyticsUnits.hourLabel(0), "0:00")
        XCTAssertEqual(DriveAnalyticsUnits.hourLabel(17), "17:00")
        XCTAssertEqual(DriveAnalyticsUnits.shortDate("2024-04-04"), "04-04")
        XCTAssertEqual(DriveAnalyticsUnits.shortDate("abc"), "abc")
        XCTAssertEqual(DriveAnalyticsUnits.shortDate(""), "")
    }

    func testBubbleSizesScaleAcrossRange() {
        XCTAssertEqual(DriveAnalyticsUnits.bubbleSizes(for: []), [])
        XCTAssertEqual(DriveAnalyticsUnits.bubbleSizes(for: [5, 5]), [30, 30])
        let sizes = DriveAnalyticsUnits.bubbleSizes(for: [10, 20, 30])
        XCTAssertEqual(sizes[0], 30, accuracy: 1e-9)
        XCTAssertEqual(sizes[1], 165, accuracy: 1e-9)
        XCTAssertEqual(sizes[2], 300, accuracy: 1e-9)
    }
}

// MARK: - Adapter: projection (web chart `data`)

@MainActor final class DrivingTabProjectionTests: XCTestCase {
    func testEmptyProjectionCarriesLabelsOnly() {
        let projection = DrivingTabProjection.make(from: nil, units: .metric)
        XCTAssertFalse(projection.hasAny)
        XCTAssertTrue(projection.speedBars.isEmpty)
        XCTAssertEqual(projection.labels.efficiency, "Wh/km")
    }

    func testDistributionBarsPreserveOrderAndCount() {
        let projection = DrivingTabProjection.make(from: sampleInput(), units: .metric)
        XCTAssertEqual(projection.speedBars.map(\.range), ["0-20", "20-40"])
        XCTAssertEqual(projection.speedBars[0].count, 10, accuracy: 1e-9)
        XCTAssertEqual(projection.speedBars[0].id, "0-0-20")
        XCTAssertEqual(projection.durationBars.first?.count, 7)
    }

    func testHourlyProjection() {
        let projection = DrivingTabProjection.make(from: sampleInput(), units: .metric)
        XCTAssertEqual(projection.hourly.map(\.hour), [8, 9])
        XCTAssertEqual(projection.hourly[0].drives, 3, accuracy: 1e-9)
        XCTAssertEqual(projection.hourly[1].distance, 40, accuracy: 1e-9)
    }

    func testTempEfficiencyMetricConversion() {
        let projection = DrivingTabProjection.make(from: sampleInput(), units: .metric)
        XCTAssertEqual(projection.tempEff.count, 3)
        XCTAssertEqual(projection.tempEff[0].temp, 20, accuracy: 1e-9)
        XCTAssertEqual(projection.tempEff[0].efficiency, 0.15, accuracy: 1e-9)
        XCTAssertEqual(projection.tempEff[0].distance, 10, accuracy: 1e-9)
        // Distances 10/20/30 → bubble sizes 30/165/300.
        XCTAssertEqual(projection.tempEff[0].bubbleSize, 30, accuracy: 1e-9)
        XCTAssertEqual(projection.tempEff[2].bubbleSize, 300, accuracy: 1e-9)
    }

    func testTempEfficiencyImperialConversion() {
        let projection = DrivingTabProjection.make(from: sampleInput(), units: .imperial)
        XCTAssertEqual(projection.tempEff[0].temp, 68, accuracy: 1e-9)
        XCTAssertEqual(projection.tempEff[0].efficiency, 0.15 * 1.609344, accuracy: 1e-9)
        XCTAssertEqual(projection.tempEff[0].distance, 10000 / 1609.344, accuracy: 1e-9)
        XCTAssertEqual(projection.labels.efficiency, "Wh/mi")
    }

    func testDailyTrendAndEfficiencyFilter() {
        let projection = DrivingTabProjection.make(from: sampleInput(), units: .metric)
        XCTAssertEqual(projection.dailyTrend.count, 3)
        XCTAssertEqual(projection.dailyTrend[0].shortDate, "04-01")
        // Only the first day has efficiency > 0 (the 0 and nil rows are dropped).
        XCTAssertEqual(projection.effTrend.count, 1)
        XCTAssertEqual(projection.effTrend[0].date, "2024-04-01")
        XCTAssertEqual(projection.effTrend[0].efficiency, 0.158, accuracy: 1e-9)
    }

    func testResolvePhaseMatrix() {
        let full = DrivingTabProjection.make(from: sampleInput(), units: .metric)
        let blank = DrivingTabProjection.make(from: nil, units: .metric)
        XCTAssertEqual(DrivingTabProjection.resolvePhase(.loading, projection: blank), .loading)
        XCTAssertEqual(DrivingTabProjection.resolvePhase(.loading, projection: full), .content)
        XCTAssertEqual(DrivingTabProjection.resolvePhase(.empty, projection: blank), .empty)
        XCTAssertEqual(DrivingTabProjection.resolvePhase(.loaded, projection: blank), .empty)
        XCTAssertEqual(DrivingTabProjection.resolvePhase(.loaded, projection: full), .content)
        XCTAssertEqual(DrivingTabProjection.resolvePhase(.failed("e"), projection: blank), .error("e"))
        XCTAssertEqual(DrivingTabProjection.resolvePhase(.failed("e"), projection: full), .content)
    }
}

// MARK: - State holder: phases + units + refresh + telemetry

@MainActor final class DrivingTabModelTests: XCTestCase {
    private func makeModel(
        _ update: DriveAnalyticsUpdate,
        telemetry: DrivingTabTelemetry = OSLogDrivingTabTelemetry()
    ) -> (DrivingTabModel, InMemoryDriveAnalyticsSource) {
        let source = InMemoryDriveAnalyticsSource(initial: update)
        let model = DrivingTabModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testInitialContentPhase() {
        let (model, _) = makeModel(DriveAnalyticsUpdate(status: .loaded, analytics: sampleInput()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasAny)
    }

    func testEmptyAndLoadingAndErrorPhases() {
        let (empty, _) = makeModel(DriveAnalyticsUpdate(status: .loaded, analytics: DriveAnalyticsInput()))
        empty.start()
        XCTAssertEqual(empty.phase, .empty)

        let (loading, _) = makeModel(DriveAnalyticsUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (failed, _) = makeModel(DriveAnalyticsUpdate(status: .failed("boom")))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
    }

    func testCachedChartsStayContentWhileFailing() {
        let (model, source) = makeModel(DriveAnalyticsUpdate(status: .loaded, analytics: sampleInput()))
        model.start()
        source.push(DriveAnalyticsUpdate(status: .failed("net"), analytics: nil))
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasAny)
    }

    func testUnitChangeReprojectsTemperature() {
        let (model, source) = makeModel(DriveAnalyticsUpdate(status: .loaded, analytics: sampleInput(), units: .metric))
        model.start()
        XCTAssertEqual(model.projection.tempEff.first?.temp ?? .nan, 20, accuracy: 1e-9)
        // A later snapshot with no fresh payload but imperial units re-projects the cache.
        source.push(DriveAnalyticsUpdate(status: .loaded, analytics: nil, units: .imperial))
        XCTAssertEqual(model.projection.tempEff.first?.temp ?? .nan, 68, accuracy: 1e-9)
        XCTAssertEqual(model.projection.labels.efficiency, "Wh/mi")
    }

    func testRefreshDelegates() {
        let (model, source) = makeModel(DriveAnalyticsUpdate(status: .loaded, analytics: sampleInput()))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshFiresOncePerEpisode() {
        let (model, source) = makeModel(DriveAnalyticsUpdate(status: .loaded, analytics: sampleInput()))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(DriveAnalyticsUpdate(status: .loaded, analytics: sampleInput(), connection: .stale))
        source.push(DriveAnalyticsUpdate(status: .loaded, analytics: sampleInput(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(DriveAnalyticsUpdate(status: .loaded, analytics: sampleInput(), connection: .live))
        source.push(DriveAnalyticsUpdate(status: .loaded, analytics: sampleInput(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyDrivingTabTelemetry()
        let (model, source) = makeModel(DriveAnalyticsUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [DrivingTab.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testConnectionAndRefreshingTrackUpdates() {
        let (model, source) = makeModel(DriveAnalyticsUpdate(status: .loading))
        model.start()
        source.push(
            DriveAnalyticsUpdate(
                status: .loaded,
                analytics: sampleInput(),
                refreshing: true,
                connection: .offline,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.refreshing)
        XCTAssertNotNil(model.updatedAt)
    }
}

// MARK: - Accessibility summaries

@MainActor final class DrivingTabDriveAnalyticsAccessibilityTests: XCTestCase {
    func testDistributionSummary() {
        let bars = [
            DriveBar(id: "0", range: "0-20", count: 10),
            DriveBar(id: "1", range: "20-40", count: 20),
            DriveBar(id: "2", range: "40-60", count: 30)
        ]
        let summary = DriveAnalyticsAccessibility.distributionSummary(
            bars: bars,
            rangesNoun: "ranges",
            totalNoun: "trips",
            emptyFallback: "No data"
        )
        XCTAssertEqual(summary, "3 ranges, 60 trips")
    }

    func testDistributionSummaryEmptyFallback() {
        let summary = DriveAnalyticsAccessibility.distributionSummary(
            bars: [],
            rangesNoun: "ranges",
            totalNoun: "trips",
            emptyFallback: "No data"
        )
        XCTAssertEqual(summary, "No data")
    }

    func testCountSummary() {
        XCTAssertEqual(DriveAnalyticsAccessibility.countSummary(5, noun: "days", emptyFallback: "No data"), "5 days")
        XCTAssertEqual(DriveAnalyticsAccessibility.countSummary(0, noun: "days", emptyFallback: "No data"), "No data")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyDrivingTabTelemetry: DrivingTabTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
