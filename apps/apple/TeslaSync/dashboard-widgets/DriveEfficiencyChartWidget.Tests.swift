//
//  DriveEfficiencyChartWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0038 · DriveEfficiencyChartWidget (Apple)
//
//  Adapter-focused unit coverage for the DriveEfficiencyChartWidget surface
//  (state-holder / registry / accessibility coverage lives in
//  `DriveEfficiencyChartWidget.ModelTests.swift`):
//    • Per-drive estimate — `DriveEfficiencyBuilder.estimateWhPerKm` parity with
//      the web `estimateEfficiency` (energy first, SoC fallback, range guards).
//    • Cached → projection — `DriveEfficiencyBuilder.buildProjection` parity with
//      the web buildDailyEfficiency / displayData / overallAvg / bestDay / trend.
//    • Conversion — `StandardDriveEfficiencyConverter` Wh/km → Wh/mi factor.
//    • Formatting — `DriveEfficiencyFormat` parity with web `fmtNumber` + the
//      trend template literal.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store; the adapter is pure.
//

import XCTest
@testable import TeslaSync

// MARK: - Test fixtures

private func utcCalendar() -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
    return calendar
}

private func makeDate(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 12) -> Date {
    var components = DateComponents()
    components.year = year
    components.month = month
    components.day = day
    components.hour = hour
    return utcCalendar().date(from: components) ?? Date(timeIntervalSince1970: 0)
}

private func isoStamp(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 12) -> String {
    String(format: "%04d-%02d-%02dT%02d:00:00Z", year, month, day, hour)
}

/// An energy-based drive sample: `km` kilometres consuming `whPerKm` Wh/km.
private func energyDrive(_ year: Int, _ month: Int, _ day: Int, km: Double, whPerKm: Double) -> DriveEfficiencySample {
    DriveEfficiencySample(
        startTs: isoStamp(year, month, day),
        distanceM: km * 1000,
        energyUsedWh: whPerKm * km
    )
}

/// Identity labeler so adapter tests stay locale-independent.
private func identityLabel(_ key: String) -> String {
    key
}

// MARK: - Adapter: per-drive efficiency estimate (web estimateEfficiency)

final class DriveEfficiencyEstimateTests: XCTestCase {
    func testEnergyPathComputesWhPerKm() {
        let drive = DriveEfficiencySample(startTs: isoStamp(2026, 4, 1), distanceM: 20000, energyUsedWh: 3000)
        XCTAssertEqual(DriveEfficiencyBuilder.estimateWhPerKm(drive) ?? 0, 150, accuracy: 0.0001)
    }

    func testRejectsTinyDrives() {
        let drive = DriveEfficiencySample(startTs: isoStamp(2026, 4, 1), distanceM: 500, energyUsedWh: 200)
        XCTAssertNil(DriveEfficiencyBuilder.estimateWhPerKm(drive))
    }

    func testRejectsImplausiblyHighOrLow() {
        let high = DriveEfficiencySample(startTs: isoStamp(2026, 4, 1), distanceM: 1000, energyUsedWh: 600)
        let low = DriveEfficiencySample(startTs: isoStamp(2026, 4, 1), distanceM: 10000, energyUsedWh: 200)
        XCTAssertNil(DriveEfficiencyBuilder.estimateWhPerKm(high)) // 600 Wh/km > 500
        XCTAssertNil(DriveEfficiencyBuilder.estimateWhPerKm(low)) // 20 Wh/km < 30
    }

    func testFallsBackToStateOfChargeWhenEnergyMissing() {
        // 50 km, 10% of a 75 kWh pack = 7500 Wh → 150 Wh/km.
        let drive = DriveEfficiencySample(
            startTs: isoStamp(2026, 4, 1),
            distanceM: 50000,
            startSocPct: 80,
            endSocPct: 70,
            energyUsedWh: nil
        )
        XCTAssertEqual(DriveEfficiencyBuilder.estimateWhPerKm(drive) ?? 0, 150, accuracy: 0.0001)
    }

    func testZeroEnergyUsesStateOfChargeFallback() {
        let drive = DriveEfficiencySample(
            startTs: isoStamp(2026, 4, 1),
            distanceM: 50000,
            startSocPct: 80,
            endSocPct: 70,
            energyUsedWh: 0
        )
        XCTAssertEqual(DriveEfficiencyBuilder.estimateWhPerKm(drive) ?? 0, 150, accuracy: 0.0001)
    }

    func testNonPositiveStateOfChargeDeltaIsRejected() {
        let drive = DriveEfficiencySample(
            startTs: isoStamp(2026, 4, 1),
            distanceM: 50000,
            startSocPct: 70,
            endSocPct: 70
        )
        XCTAssertNil(DriveEfficiencyBuilder.estimateWhPerKm(drive))
    }

    func testMissingStateOfChargeIsRejected() {
        let drive = DriveEfficiencySample(startTs: isoStamp(2026, 4, 1), distanceM: 50000)
        XCTAssertNil(DriveEfficiencyBuilder.estimateWhPerKm(drive))
    }
}

// MARK: - Adapter: cached drives → daily projection (web buildDailyEfficiency)

final class DriveEfficiencyBuilderTests: XCTestCase {
    /// Eight consecutive days, one drive each, 100…170 Wh/km.
    private func ramp() -> [DriveEfficiencySample] {
        (1 ... 8).map { day in
            energyDrive(2026, 4, day, km: 10, whPerKm: Double(90 + day * 10))
        }
    }

    func testBuildsOnePointPerDayInChronologicalOrder() {
        let projection = DriveEfficiencyBuilder.buildProjection(
            samples: ramp(),
            unit: "km",
            now: makeDate(2026, 4, 30),
            calendar: utcCalendar(),
            label: identityLabel
        )
        XCTAssertEqual(projection.points.count, 8)
        XCTAssertEqual(projection.points.map(\.date).first, "2026-04-01")
        XCTAssertEqual(projection.points.map(\.date).last, "2026-04-08")
        XCTAssertEqual(projection.points.map(\.index), Array(0 ..< 8))
    }

    func testDailyAverageOfMultipleDrivesOnSameDay() {
        let drives = [
            energyDrive(2026, 4, 5, km: 10, whPerKm: 100),
            energyDrive(2026, 4, 5, km: 10, whPerKm: 140)
        ]
        let projection = DriveEfficiencyBuilder.buildProjection(
            samples: drives,
            unit: "km",
            now: makeDate(2026, 4, 30),
            calendar: utcCalendar(),
            label: identityLabel
        )
        XCTAssertEqual(projection.points.count, 1)
        XCTAssertEqual(projection.points[0].efficiency, 120, accuracy: 0.0001)
    }

    func testRollingAverageNeedsAtLeastTwoDays() {
        let projection = DriveEfficiencyBuilder.buildProjection(
            samples: ramp(),
            unit: "km",
            now: makeDate(2026, 4, 30),
            calendar: utcCalendar(),
            label: identityLabel
        )
        // Day 0 has no rolling average; day 1 averages the first two days.
        XCTAssertNil(projection.points[0].rollingAvg)
        XCTAssertEqual(projection.points[1].rollingAvg ?? 0, 105, accuracy: 0.0001)
        // Day 7 rolls the trailing 7 days (110…170) → mean 140.
        XCTAssertEqual(projection.points[7].rollingAvg ?? 0, 140, accuracy: 0.0001)
    }

    func testStatsAvgBestTrend() {
        let projection = DriveEfficiencyBuilder.buildProjection(
            samples: ramp(),
            unit: "km",
            now: makeDate(2026, 4, 30),
            calendar: utcCalendar(),
            label: identityLabel
        )
        XCTAssertEqual(projection.overallAvg ?? 0, 135, accuracy: 0.0001)
        XCTAssertEqual(projection.bestDay ?? 0, 100, accuracy: 0.0001)
        // first half avg 115, second half avg 155 → (155-115)/115 = +34.8%.
        XCTAssertEqual(projection.trend ?? 0, 34.8, accuracy: 0.0001)
        XCTAssertEqual(projection.efficiencyUnit, "Wh/km")
        XCTAssertTrue(projection.hasData)
    }

    func testTrendNilWithFewerThanFourPoints() {
        let drives = (1 ... 3).map { energyDrive(2026, 4, $0, km: 10, whPerKm: 120) }
        let projection = DriveEfficiencyBuilder.buildProjection(
            samples: drives,
            unit: "km",
            now: makeDate(2026, 4, 30),
            calendar: utcCalendar(),
            label: identityLabel
        )
        XCTAssertNil(projection.trend)
    }

    func testConvertsToMilesUnit() {
        let projection = DriveEfficiencyBuilder.buildProjection(
            samples: [energyDrive(2026, 4, 10, km: 10, whPerKm: 100)],
            unit: "mi",
            now: makeDate(2026, 4, 30),
            calendar: utcCalendar(),
            label: identityLabel
        )
        // 100 Wh/km × 1.609344 = 160.9344 → 160.9 (1-decimal).
        XCTAssertEqual(projection.points.first?.efficiency ?? 0, 160.9, accuracy: 0.0001)
        XCTAssertEqual(projection.efficiencyUnit, "Wh/mi")
        XCTAssertEqual(projection.distanceUnit, "mi")
    }

    func testExcludesDrivesOlderThanThirtyDays() {
        var drives = ramp()
        drives.append(energyDrive(2026, 2, 1, km: 10, whPerKm: 999)) // far past + implausible
        let projection = DriveEfficiencyBuilder.buildProjection(
            samples: drives,
            unit: "km",
            now: makeDate(2026, 4, 30),
            calendar: utcCalendar(),
            label: identityLabel
        )
        XCTAssertEqual(projection.points.count, 8)
        XCTAssertFalse(projection.points.contains { $0.date == "2026-02-01" })
    }

    func testEmptyWhenNoValidDrives() {
        let projection = DriveEfficiencyBuilder.buildProjection(
            samples: [],
            unit: "km",
            now: makeDate(2026, 4, 30),
            calendar: utcCalendar(),
            label: identityLabel
        )
        XCTAssertFalse(projection.hasData)
        XCTAssertNil(projection.overallAvg)
        XCTAssertNil(projection.bestDay)
        XCTAssertNil(projection.trend)
    }

    func testLabelClosureDrivesAxisLabels() {
        let projection = DriveEfficiencyBuilder.buildProjection(
            samples: [energyDrive(2026, 4, 7, km: 10, whPerKm: 120)],
            unit: "km",
            now: makeDate(2026, 4, 30),
            calendar: utcCalendar(),
            label: { _ in "DAY" }
        )
        XCTAssertEqual(projection.points.first?.label, "DAY")
    }

    func testTimestampParsingToleratesFractionalAndBareDates() {
        XCTAssertNotNil(DriveEfficiencyBuilder.parseTimestamp("2026-04-07T12:00:00.250Z"))
        XCTAssertNotNil(DriveEfficiencyBuilder.parseTimestamp("2026-04-07T12:00:00Z"))
        XCTAssertNotNil(DriveEfficiencyBuilder.parseTimestamp("2026-04-07"))
        XCTAssertNil(DriveEfficiencyBuilder.parseTimestamp("not-a-date"))
    }
}

// MARK: - Distance converter

final class DriveEfficiencyConverterTests: XCTestCase {
    func testMilesFactorAndUnitLabels() {
        let converter = StandardDriveEfficiencyConverter()
        XCTAssertEqual(converter.displayEfficiency(whPerKm: 100, unit: "mi"), 160.9344, accuracy: 0.0001)
        XCTAssertEqual(converter.displayEfficiency(whPerKm: 100, unit: "km"), 100, accuracy: 0.0001)
        // Unknown labels fall back to kilometres (web non-'mi' branch).
        XCTAssertEqual(converter.displayEfficiency(whPerKm: 100, unit: "parsec"), 100, accuracy: 0.0001)
        XCTAssertEqual(converter.efficiencyUnitLabel(unit: "mi"), "Wh/mi")
        XCTAssertEqual(converter.efficiencyUnitLabel(unit: "km"), "Wh/km")
    }
}

// MARK: - Number formatting parity (web fmtNumber / trend template)

final class DriveEfficiencyFormatTests: XCTestCase {
    func testIntRoundsAndGroups() {
        XCTAssertEqual(DriveEfficiencyFormat.int(150.4), "150")
        XCTAssertEqual(DriveEfficiencyFormat.int(1234.6), "1,235")
        XCTAssertEqual(DriveEfficiencyFormat.int(0), "0")
    }

    func testTrendSignsAndDecimals() {
        XCTAssertEqual(DriveEfficiencyFormat.trend(5), "+5%")
        XCTAssertEqual(DriveEfficiencyFormat.trend(5.3), "+5.3%")
        XCTAssertEqual(DriveEfficiencyFormat.trend(-2), "-2%")
        XCTAssertEqual(DriveEfficiencyFormat.trend(0), "0%")
    }

    func testNilAndNonFiniteRenderEmDash() {
        XCTAssertEqual(DriveEfficiencyFormat.int(nil), "—")
        XCTAssertEqual(DriveEfficiencyFormat.int(.nan), "—")
        XCTAssertEqual(DriveEfficiencyFormat.trend(nil), "—")
        XCTAssertEqual(DriveEfficiencyFormat.trend(.infinity), "—")
    }
}
