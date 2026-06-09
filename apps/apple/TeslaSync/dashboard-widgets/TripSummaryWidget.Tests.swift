//
//  TripSummaryWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0103 · TripSummaryWidget (Apple)
//
//  Unit coverage for the TripSummaryWidget surface:
//    • Adapter (cached → projection) — `TripSummaryProjector` value parity with the web widget's
//      last-trip + recent-row pipeline (distance convert + fmtNumber, formatDurationRange, fmtInt,
//      formatDateShort, `Unnamed trip` fallback, `recentTrips.slice(1)` capping).
//    • Format helpers — fmtNumber/fmtInt rounding, duration + duration-range + date shapes.
//    • Layout — `isCompact` + `statColumns` parity with the web `size.cols <= 1` math.
//    • State holder — `TripSummaryModel.resolvePhase` across loading / empty / error / content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryTripSummarySource`. Shared fixtures here are reused by
//  TripSummaryWidget.ModelTests.swift within the same test target.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

func tripSummaryUTCDate(year: Int, month: Int, day: Int) -> Date {
    var components = DateComponents()
    components.year = year
    components.month = month
    components.day = day
    components.hour = 12
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
    return calendar.date(from: components) ?? Date(timeIntervalSince1970: 0)
}

enum TripSummaryFixtures {
    static let unitsKm = TripSummaryUnitPrefs(
        distance: .kilometers,
        localeIdentifier: "en_US",
        timeZoneIdentifier: "UTC"
    )
    static let unitsMi = TripSummaryUnitPrefs(distance: .miles, localeIdentifier: "en_US", timeZoneIdentifier: "UTC")

    static let tripA = TripSummaryDTO(
        id: 1,
        name: "Tahoe Weekend",
        startDate: tripSummaryUTCDate(year: 2026, month: 6, day: 7),
        endDate: tripSummaryUTCDate(year: 2026, month: 6, day: 7).addingTimeInterval(1860),
        totalDistanceM: 12000,
        driveCount: 4,
        chargeCount: 2
    )

    static let tripB = TripSummaryDTO(
        id: 2,
        name: nil,
        startDate: tripSummaryUTCDate(year: 2026, month: 1, day: 3),
        endDate: tripSummaryUTCDate(year: 2026, month: 1, day: 3).addingTimeInterval(7320),
        totalDistanceM: 500,
        driveCount: 1,
        chargeCount: 0
    )

    static let tripC = TripSummaryDTO(
        id: 3,
        name: "Airport Run",
        startDate: tripSummaryUTCDate(year: 2026, month: 3, day: 15),
        endDate: nil,
        totalDistanceM: 0,
        driveCount: 3,
        chargeCount: 1
    )

    static let all = [tripA, tripB, tripC]
}

// MARK: - Adapter: cached trips → projection (port parity with the web widget)

@MainActor final class TripSummaryAdapterTests: XCTestCase {
    func testProjectionWideKilometers() throws {
        let projection = TripSummaryProjector.project(
            trips: TripSummaryFixtures.all,
            units: TripSummaryFixtures.unitsKm,
            isCompact: false
        )
        XCTAssertFalse(projection.isCompact)
        XCTAssertFalse(projection.isEmpty)

        let last = try XCTUnwrap(projection.lastTrip)
        XCTAssertEqual(last.id, 1)
        XCTAssertEqual(last.name, "Tahoe Weekend")
        XCTAssertEqual(last.dateText, "Jun 7")
        XCTAssertEqual(last.distanceValue, "12.0")
        XCTAssertEqual(last.distanceUnit, "km")
        XCTAssertEqual(last.durationText, "31m")
        XCTAssertEqual(last.drivesText, "4")
        XCTAssertEqual(last.chargeStopsText, "2")

        XCTAssertEqual(projection.recentRows.map(\.id), [2, 3])

        let rowB = projection.recentRows[0]
        XCTAssertEqual(rowB.name, "Unnamed trip")
        XCTAssertEqual(rowB.dateText, "Jan 3")
        XCTAssertEqual(rowB.distanceValue, "0.5")
        XCTAssertEqual(rowB.durationText, "2h 2m")
        XCTAssertEqual(rowB.driveCountText, "1")

        let rowC = projection.recentRows[1]
        XCTAssertEqual(rowC.name, "Airport Run")
        XCTAssertEqual(rowC.dateText, "Mar 15")
        XCTAssertEqual(rowC.distanceValue, "0.0")
        XCTAssertEqual(rowC.durationText, "—", "missing end date → em-dash duration")
        XCTAssertEqual(rowC.driveCountText, "3")
    }

    func testProjectionMilesAndSingleTrip() {
        let projection = TripSummaryProjector.project(
            trips: [TripSummaryFixtures.tripA],
            units: TripSummaryFixtures.unitsMi,
            isCompact: false
        )
        XCTAssertEqual(projection.lastTrip?.distanceValue, "7.5")
        XCTAssertEqual(projection.lastTrip?.distanceUnit, "mi")
        XCTAssertTrue(projection.recentRows.isEmpty, "one trip → no recent rows (web recentTrips.length > 1)")
    }

    func testEmptyTripsProjectsEmpty() {
        let projection = TripSummaryProjector.project(
            trips: [],
            units: TripSummaryFixtures.unitsKm,
            isCompact: false
        )
        XCTAssertNil(projection.lastTrip)
        XCTAssertTrue(projection.recentRows.isEmpty)
        XCTAssertTrue(projection.isEmpty)
    }

    func testRecentRowsCapAtTwoFromFirstThree() {
        let many = TripSummaryFixtures.all + [
            TripSummaryDTO(id: 4, name: "Costco"),
            TripSummaryDTO(id: 5, name: "School")
        ]
        let projection = TripSummaryProjector.project(
            trips: many,
            units: TripSummaryFixtures.unitsKm,
            isCompact: false
        )
        XCTAssertEqual(projection.lastTrip?.id, 1)
        XCTAssertEqual(projection.recentRows.map(\.id), [2, 3], "recentTrips = slice(0,3); rows = slice(1)")
    }

    func testCompactRowOmitsDurationAndDriveCountInLabel() {
        let projection = TripSummaryProjector.project(
            trips: TripSummaryFixtures.all,
            units: TripSummaryFixtures.unitsKm,
            isCompact: true
        )
        XCTAssertTrue(projection.isCompact)
        let label = projection.recentRows[0].accessibilityLabel
        XCTAssertTrue(label.contains("0.5 km"))
        XCTAssertFalse(label.contains("2h 2m"), "compact hides duration")
        XCTAssertFalse(label.contains("drv"), "compact hides drive count")
    }
}

// MARK: - Format helpers (port parity with numberFormat.ts + dateFormat.ts)

@MainActor final class TripSummaryFormatTests: XCTestCase {
    func testNumberRoundsHalfAwayFromZero() {
        XCTAssertEqual(TripSummaryFormat.number(1000, decimals: 0), "1,000")
        XCTAssertEqual(TripSummaryFormat.number(0.5, decimals: 0), "1")
        XCTAssertEqual(TripSummaryFormat.number(1234.4, decimals: 0), "1,234")
        XCTAssertEqual(TripSummaryFormat.number(7.4565, decimals: 1), "7.5")
        XCTAssertEqual(TripSummaryFormat.number(.infinity, decimals: 1), "0.0")
    }

    func testIntegerFormatting() {
        XCTAssertEqual(TripSummaryFormat.integer(4), "4")
        XCTAssertEqual(TripSummaryFormat.integer(0), "0")
        XCTAssertEqual(TripSummaryFormat.integer(1500), "1,500")
    }

    func testDurationMinutesShapes() {
        XCTAssertEqual(TripSummaryFormat.durationMinutes(minutes: 31, subMinuteLabel: nil), "31m")
        XCTAssertEqual(TripSummaryFormat.durationMinutes(minutes: 122, subMinuteLabel: nil), "2h 2m")
        XCTAssertEqual(TripSummaryFormat.durationMinutes(minutes: 60, subMinuteLabel: nil), "1h 0m")
        XCTAssertEqual(TripSummaryFormat.durationMinutes(minutes: 0.4, subMinuteLabel: nil), "0m")
        XCTAssertEqual(TripSummaryFormat.durationMinutes(minutes: 0.5, subMinuteLabel: "<1m"), "<1m")
        XCTAssertEqual(TripSummaryFormat.durationMinutes(minutes: -5, subMinuteLabel: nil), "—")
        XCTAssertEqual(TripSummaryFormat.durationMinutes(minutes: .infinity, subMinuteLabel: nil), "—")
    }

    func testDurationRangeShapes() {
        let start = tripSummaryUTCDate(year: 2026, month: 6, day: 7)
        XCTAssertEqual(TripSummaryFormat.durationRange(start: start, end: start.addingTimeInterval(1860)), "31m")
        XCTAssertEqual(TripSummaryFormat.durationRange(start: start, end: start.addingTimeInterval(7320)), "2h 2m")
        XCTAssertEqual(TripSummaryFormat.durationRange(start: start, end: nil), "—")
        XCTAssertEqual(TripSummaryFormat.durationRange(start: nil, end: start), "—")
        XCTAssertEqual(TripSummaryFormat.durationRange(start: start, end: start), "—", "zero-length range")
        XCTAssertEqual(
            TripSummaryFormat.durationRange(start: start, end: start.addingTimeInterval(-600)),
            "—",
            "negative range"
        )
    }

    func testShortDate() {
        let date = tripSummaryUTCDate(year: 2026, month: 6, day: 7)
        XCTAssertEqual(
            TripSummaryFormat.shortDate(date, localeIdentifier: "en_US", timeZoneIdentifier: "UTC"),
            "Jun 7"
        )
        XCTAssertEqual(
            TripSummaryFormat.shortDate(nil, localeIdentifier: "en_US", timeZoneIdentifier: "UTC"),
            "—"
        )
    }

    func testDistanceConversionFactors() {
        XCTAssertEqual(convertTripDistanceFromSI(1000, to: .kilometers), 1, accuracy: 1e-9)
        XCTAssertEqual(convertTripDistanceFromSI(1609.344, to: .miles), 1, accuracy: 1e-9)
        XCTAssertEqual(convertTripDistanceFromSI(0.3048, to: .feet), 1, accuracy: 1e-9)
        XCTAssertEqual(convertTripDistanceFromSI(.nan, to: .kilometers), 0)
    }
}

// MARK: - Layout (web `size.cols <= 1` → isCompact)

@MainActor final class TripSummaryLayoutTests: XCTestCase {
    func testIsCompact() {
        XCTAssertTrue(TripSummaryLayout.isCompact(cols: 0))
        XCTAssertTrue(TripSummaryLayout.isCompact(cols: 1))
        XCTAssertFalse(TripSummaryLayout.isCompact(cols: 2))
        XCTAssertFalse(TripSummaryLayout.isCompact(cols: 4))
    }

    func testStatColumns() {
        XCTAssertEqual(TripSummaryLayout.statColumns(cols: 1), 2)
        XCTAssertEqual(TripSummaryLayout.statColumns(cols: 2), 4)
        XCTAssertEqual(TripSummaryLayout.statColumns(cols: 4), 4)
    }
}

// MARK: - State holder: phase resolution

@MainActor final class TripSummaryPhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        XCTAssertEqual(TripSummaryModel.resolvePhase(status: .loading, hasRows: false), .loading)
        XCTAssertEqual(TripSummaryModel.resolvePhase(status: .loading, hasRows: true), .content)
        XCTAssertEqual(TripSummaryModel.resolvePhase(status: .empty, hasRows: false), .empty)
        XCTAssertEqual(TripSummaryModel.resolvePhase(status: .empty, hasRows: true), .empty)
        XCTAssertEqual(TripSummaryModel.resolvePhase(status: .loaded, hasRows: false), .empty)
        XCTAssertEqual(TripSummaryModel.resolvePhase(status: .loaded, hasRows: true), .content)
        XCTAssertEqual(TripSummaryModel.resolvePhase(status: .failed("x"), hasRows: false), .error("x"))
        XCTAssertEqual(TripSummaryModel.resolvePhase(status: .failed("x"), hasRows: true), .content)
    }
}
