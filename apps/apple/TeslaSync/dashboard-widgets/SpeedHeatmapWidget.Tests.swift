//
//  SpeedHeatmapWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0094 · SpeedHeatmapWidget (Apple)
//
//  Unit coverage for the SpeedHeatmapWidget surface:
//    • Adapter (cached → heatmap) — `SpeedHeatmapBuilder` parity with the web
//      SpeedHeatmapWidget.tsx derive block: buildHeatmap bucketing, speed
//      conversion, the speed→colour gradient, and the max/total/peak reductions.
//    • State holder — `SpeedHeatmapModel` phase resolution across loading /
//      empty / error / content, plus the P1/S11 `view.opened` telemetry +
//      source wiring and the compact/wide thresholds.
//    • Registry — canonical `speed-heatmap` metadata + size clamping.
//    • Accessibility — the VoiceOver summary + per-cell description content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemorySpeedHeatmapSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum SpeedHeatmapFixture {
    /// A UTC Gregorian calendar so weekday/hour buckets are deterministic.
    static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = Locale(identifier: "en_US")
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return calendar
    }()

    /// 2024-01-01 is a Monday; offsetting the day gives a known Mon-first index.
    static func date(day: Int, hour: Int) -> Date {
        var components = DateComponents()
        components.year = 2024
        components.month = 1
        components.day = 1 + day
        components.hour = hour
        components.timeZone = TimeZone(identifier: "UTC")
        return calendar.date(from: components) ?? Date()
    }
}

// MARK: - Adapter: cached drives → heatmap (port parity with the web derive block)

@MainActor
final class SpeedHeatmapAdapterTests: XCTestCase {
    func testConvertSpeedFromSI() {
        XCTAssertEqual(SpeedHeatmapBuilder.convertSpeedFromSI(10, to: .kilometersPerHour), 36, accuracy: 1e-9)
        XCTAssertEqual(
            SpeedHeatmapBuilder.convertSpeedFromSI(10, to: .milesPerHour),
            36000.0 / 1609.344,
            accuracy: 1e-9
        )
        XCTAssertEqual(SpeedHeatmapBuilder.convertSpeedFromSI(.nan, to: .kilometersPerHour), 0, accuracy: 1e-9)
    }

    func testBuildHeatmapDimensions() {
        let grid = SpeedHeatmapBuilder.buildHeatmap(drives: [], speedUnit: .kilometersPerHour)
        XCTAssertEqual(grid.count, SpeedHeatmapBuilder.rows)
        XCTAssertEqual(grid.first?.count, SpeedHeatmapBuilder.cols)
        XCTAssertEqual(SpeedHeatmapBuilder.totalDrives(in: grid), 0)
        XCTAssertEqual(SpeedHeatmapBuilder.maxSpeed(in: grid), 0, accuracy: 1e-9)
        XCTAssertNil(SpeedHeatmapBuilder.peakCell(in: grid))
    }

    func testMondayAndSundayBucketingRemap() {
        let drives = [
            SpeedHeatmapDrive(startDate: SpeedHeatmapFixture.date(day: 0, hour: 8), avgSpeedMps: 10),
            SpeedHeatmapDrive(startDate: SpeedHeatmapFixture.date(day: 6, hour: 20), avgSpeedMps: 20)
        ]
        let grid = SpeedHeatmapBuilder.buildHeatmap(
            drives: drives,
            speedUnit: .kilometersPerHour,
            calendar: SpeedHeatmapFixture.calendar
        )
        XCTAssertEqual(grid[0][8].driveCount, 1)
        XCTAssertEqual(grid[0][8].avgSpeed, 36, accuracy: 1e-9)
        XCTAssertEqual(grid[6][20].driveCount, 1)
        XCTAssertEqual(grid[6][20].avgSpeed, 72, accuracy: 1e-9)
    }

    func testAveragesContributingDrivesPerSlot() {
        let drives = [
            SpeedHeatmapDrive(startDate: SpeedHeatmapFixture.date(day: 2, hour: 9), avgSpeedMps: 10),
            SpeedHeatmapDrive(startDate: SpeedHeatmapFixture.date(day: 2, hour: 9), avgSpeedMps: 20)
        ]
        let grid = SpeedHeatmapBuilder.buildHeatmap(
            drives: drives,
            speedUnit: .kilometersPerHour,
            calendar: SpeedHeatmapFixture.calendar
        )
        XCTAssertEqual(grid[2][9].driveCount, 2)
        XCTAssertEqual(grid[2][9].avgSpeed, 54, accuracy: 1e-9) // mean(10,20)=15 mps → 54 km/h
    }

    func testFallsBackToMaxSpeedAndSkipsInvalid() {
        let drives = [
            SpeedHeatmapDrive(startDate: SpeedHeatmapFixture.date(day: 1, hour: 7), avgSpeedMps: nil, maxSpeedMps: 25),
            SpeedHeatmapDrive(startDate: nil, avgSpeedMps: 30),
            SpeedHeatmapDrive(startDate: SpeedHeatmapFixture.date(day: 1, hour: 7), avgSpeedMps: 0),
            SpeedHeatmapDrive(startDate: SpeedHeatmapFixture.date(day: 1, hour: 7), avgSpeedMps: -5)
        ]
        let grid = SpeedHeatmapBuilder.buildHeatmap(
            drives: drives,
            speedUnit: .kilometersPerHour,
            calendar: SpeedHeatmapFixture.calendar
        )
        XCTAssertEqual(SpeedHeatmapBuilder.totalDrives(in: grid), 1)
        XCTAssertEqual(grid[1][7].driveCount, 1)
        XCTAssertEqual(grid[1][7].avgSpeed, 90, accuracy: 1e-9) // 25 mps → 90 km/h
    }

    func testMaxTotalAndPeakReductions() {
        let drives = [
            SpeedHeatmapDrive(startDate: SpeedHeatmapFixture.date(day: 0, hour: 8), avgSpeedMps: 10),
            SpeedHeatmapDrive(startDate: SpeedHeatmapFixture.date(day: 3, hour: 17), avgSpeedMps: 30),
            SpeedHeatmapDrive(startDate: SpeedHeatmapFixture.date(day: 3, hour: 17), avgSpeedMps: 30)
        ]
        let grid = SpeedHeatmapBuilder.buildHeatmap(
            drives: drives,
            speedUnit: .kilometersPerHour,
            calendar: SpeedHeatmapFixture.calendar
        )
        XCTAssertEqual(SpeedHeatmapBuilder.totalDrives(in: grid), 3)
        XCTAssertEqual(SpeedHeatmapBuilder.maxSpeed(in: grid), 108, accuracy: 1e-9) // 30 mps → 108 km/h
        let peak = SpeedHeatmapBuilder.peakCell(in: grid)
        XCTAssertEqual(peak?.day, 3)
        XCTAssertEqual(peak?.hour, 17)
        XCTAssertEqual(peak?.driveCount, 2)
    }
}

// MARK: - Adapter: colour ramp + axis labels + value types

@MainActor
final class SpeedHeatmapColorTests: XCTestCase {
    private func assertColor(_ color: RGBAColor, _ red: Double, _ green: Double, _ blue: Double, _ alpha: Double) {
        XCTAssertEqual(color.red, red, accuracy: 1e-9)
        XCTAssertEqual(color.green, green, accuracy: 1e-9)
        XCTAssertEqual(color.blue, blue, accuracy: 1e-9)
        XCTAssertEqual(color.alpha, alpha, accuracy: 1e-9)
    }

    func testEmptyCellColorForNonPositiveSpeed() {
        assertColor(SpeedHeatmapBuilder.speedColor(speed: 0, maxSpeed: 50), 1, 1, 1, 0.03)
        assertColor(SpeedHeatmapBuilder.speedColor(speed: 10, maxSpeed: 0), 1, 1, 1, 0.03)
    }

    func testGradientStopsAtSegmentBoundaries() {
        // t=1/3 → cyan stop, t=2/3 → amber stop, t=1 → red stop.
        assertColor(SpeedHeatmapBuilder.speedColor(speed: 50.0 / 3.0, maxSpeed: 50), 6 / 255, 182 / 255, 212 / 255, 1)
        assertColor(SpeedHeatmapBuilder.speedColor(speed: 100.0 / 3.0, maxSpeed: 50), 245 / 255, 158 / 255, 11 / 255, 1)
        assertColor(SpeedHeatmapBuilder.speedColor(speed: 50, maxSpeed: 50), 239 / 255, 68 / 255, 68 / 255, 1)
    }

    func testGradientInterpolatesAndRoundsLikeWeb() {
        // t=1/6 → halfway between teal(20,184,166) and cyan(6,182,212), rounded.
        let color = SpeedHeatmapBuilder.speedColor(speed: 50.0 / 6.0, maxSpeed: 50)
        assertColor(color, 13 / 255, 183 / 255, 189 / 255, 1)
    }

    func testHourLabels() {
        XCTAssertEqual(SpeedHeatmapBuilder.hourLabels(wide: true), [0, 3, 6, 9, 12, 15, 18, 21])
        XCTAssertEqual(SpeedHeatmapBuilder.hourLabels(wide: false), [0, 6, 12, 18])
    }

    func testDayLabelsAreLocaleWeekdaysMondayFirst() {
        let calendar = SpeedHeatmapFixture.calendar
        XCTAssertEqual(
            SpeedHeatmapBuilder.dayLabels(wide: false, calendar: calendar),
            ["M", "T", "W", "T", "F", "S", "S"]
        )
        XCTAssertEqual(
            SpeedHeatmapBuilder.dayLabels(wide: true, calendar: calendar),
            ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        )
    }

    func testUnitLabelParsing() {
        XCTAssertEqual(SpeedHeatmapWidgetUnit.fromLabel("mph"), .milesPerHour)
        XCTAssertEqual(SpeedHeatmapWidgetUnit.fromLabel("KM/H"), .kilometersPerHour)
        XCTAssertEqual(SpeedHeatmapWidgetUnit.fromLabel(nil), .kilometersPerHour)
        XCTAssertEqual(SpeedHeatmapWidgetUnit.fromLabel("knots"), .kilometersPerHour)
        XCTAssertEqual(SpeedHeatmapWidgetUnit.milesPerHour.symbol, "mph")
    }

    func testNumberFormatGroupsAndRounds() {
        XCTAssertEqual(SpeedNumberFormat.integer(36), "36")
        XCTAssertEqual(SpeedNumberFormat.integer(1234.6), "1,235")
        XCTAssertEqual(SpeedNumberFormat.integer(.nan), "0")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class SpeedHeatmapModelTests: XCTestCase {
    private func makeModel(
        _ update: SpeedHeatmapUpdate,
        telemetry: SpeedHeatmapTelemetry = OSLogSpeedHeatmapTelemetry()
    ) -> (SpeedHeatmapModel, InMemorySpeedHeatmapSource) {
        let source = InMemorySpeedHeatmapSource(initial: update)
        let model = SpeedHeatmapModel(source: source, telemetry: telemetry, calendar: SpeedHeatmapFixture.calendar)
        return (model, source)
    }

    private func driveUpdate(
        status: SpeedHeatmapLoadStatus,
        connection: SpeedHeatmapConnection = .live
    ) -> SpeedHeatmapUpdate {
        SpeedHeatmapUpdate(
            status: status,
            connection: connection,
            drives: [SpeedHeatmapDrive(startDate: SpeedHeatmapFixture.date(day: 0, hour: 8), avgSpeedMps: 10)],
            speedUnitLabel: "km/h"
        )
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(SpeedHeatmapUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDrivesShowsEmpty() {
        let (model, _) = makeModel(SpeedHeatmapUpdate(status: .loaded))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.totalDrives, 0)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(SpeedHeatmapUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileFetchingOrFailed() {
        let (loading, _) = makeModel(driveUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(driveUpdate(status: .failed("net")))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpySpeedHeatmapTelemetry()
        let (model, source) = makeModel(SpeedHeatmapUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SpeedHeatmapWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(SpeedHeatmapUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionUnitAndGridTrackUpdates() {
        let (model, source) = makeModel(SpeedHeatmapUpdate(status: .loading))
        model.start()
        source.push(
            SpeedHeatmapUpdate(
                status: .loaded,
                connection: .offline,
                vehicle: SpeedHeatmapVehicleRef(id: 3, displayName: "Cybertruck"),
                drives: [SpeedHeatmapDrive(startDate: SpeedHeatmapFixture.date(day: 4, hour: 18), avgSpeedMps: 20)],
                speedUnitLabel: "mph",
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.unit, .milesPerHour)
        XCTAssertEqual(model.totalDrives, 1)
        XCTAssertEqual(model.maxSpeed, 20 * 3600.0 / 1609.344, accuracy: 1e-9)
    }

    func testCompactAndWideThresholds() {
        XCTAssertTrue(SpeedHeatmapModel.isCompact(for: DashboardWidgetSize(cols: 1, rows: 4)))
        XCTAssertFalse(SpeedHeatmapModel.isCompact(for: DashboardWidgetSize(cols: 2, rows: 4)))
        XCTAssertFalse(SpeedHeatmapModel.isWide(for: DashboardWidgetSize(cols: 2, rows: 4)))
        XCTAssertTrue(SpeedHeatmapModel.isWide(for: DashboardWidgetSize(cols: 3, rows: 4)))
    }
}

// MARK: - Registry parity

@MainActor
final class SpeedHeatmapRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = SpeedHeatmapWidget.registration
        XCTAssertEqual(registration.id, "speed-heatmap")
        XCTAssertEqual(registration.category, "driving")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 4))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = SpeedHeatmapWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)),
            DashboardWidgetSize(cols: 1, rows: 4)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 3, rows: 12)),
            DashboardWidgetSize(cols: 3, rows: 12)
        )
    }
}

// MARK: - Accessibility summary + per-cell description content

@MainActor
final class SpeedHeatmapAccessibilityTests: XCTestCase {
    private func grid() -> [[HeatCell]] {
        SpeedHeatmapBuilder.buildHeatmap(
            drives: [SpeedHeatmapDrive(startDate: SpeedHeatmapFixture.date(day: 0, hour: 8), avgSpeedMps: 10)],
            speedUnit: .kilometersPerHour,
            calendar: SpeedHeatmapFixture.calendar
        )
    }

    func testSummaryIncludesTitleDriveCountAndPeak() {
        let summary = SpeedHeatmapAccessibility.summary(
            grid: grid(),
            unit: .kilometersPerHour,
            calendar: SpeedHeatmapFixture.calendar
        )
        XCTAssertTrue(summary.contains("Speed Heatmap"))
        XCTAssertTrue(summary.contains("1 drives"))
        XCTAssertTrue(summary.contains("Peak avg 36 km/h"))
    }

    func testEmptySummaryReportsNoData() {
        let empty = SpeedHeatmapBuilder.buildHeatmap(drives: [], speedUnit: .kilometersPerHour)
        let summary = SpeedHeatmapAccessibility.summary(grid: empty, unit: .kilometersPerHour)
        XCTAssertTrue(summary.contains("Speed Heatmap"))
        XCTAssertTrue(summary.contains("No drive data yet"))
    }

    func testCellDescriptionBothBranches() {
        let labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        let populated = HeatCell(day: 0, hour: 8, avgSpeed: 36, driveCount: 3)
        let populatedText = SpeedHeatmapAccessibility.cellDescription(
            populated,
            dayLabels: labels,
            unit: .kilometersPerHour
        )
        XCTAssertTrue(populatedText.contains("Mon 8:00"))
        XCTAssertTrue(populatedText.contains("36 km/h"))
        XCTAssertTrue(populatedText.contains("3 drives"))

        let empty = HeatCell(day: 0, hour: 8, avgSpeed: 0, driveCount: 0)
        let emptyText = SpeedHeatmapAccessibility.cellDescription(empty, dayLabels: labels, unit: .kilometersPerHour)
        XCTAssertTrue(emptyText.contains("No data"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySpeedHeatmapTelemetry: SpeedHeatmapTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
