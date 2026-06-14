//
//  DateRangeFilter.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0152 · DateRangeFilter (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the local-day ISO helpers (the
//  web `<input type="date">` `YYYY-MM-DD` ⇄ `Date` bridge), the active-preset matcher (the port of the web
//  `matchPresetId` the component computes through `useMemo`), and the projector's props → view-ready
//  derivation (active preset + the conditional-render flags). Split from DateRangeFilter.Tests.swift (the
//  SwiftUI / state-holder half) to keep each file within the SwiftLint file-length budget. These run in the
//  TeslaSync(/-macOS) XCTest targets; the derivation is pure, with a fixed clock + a fixed-zone calendar.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class DateRangeFilterAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(DateRangeFilterSurface.slug, "DateRangeFilter")
    }
}

// MARK: - ISO date helpers (web `<input type="date">` value bridge)

final class DateRangeFilterDatesTests: XCTestCase {
    /// A fixed UTC Gregorian calendar so the ISO math is timezone-independent in CI.
    private let cal = DateRangeFilterDates.gregorian(timeZone: TimeZone(identifier: "UTC")!)

    func testISORoundTrip() throws {
        let date = try XCTUnwrap(DateRangeFilterDates.date(from: "2024-03-15", calendar: cal))
        XCTAssertEqual(DateRangeFilterDates.iso(from: date, calendar: cal), "2024-03-15")
    }

    func testISOZeroPadsSingleDigitFields() throws {
        let date = try XCTUnwrap(DateRangeFilterDates.date(from: "2024-3-5", calendar: cal))
        XCTAssertEqual(DateRangeFilterDates.iso(from: date, calendar: cal), "2024-03-05")
    }

    func testDateFromEmptyOrMalformedIsNil() {
        XCTAssertNil(DateRangeFilterDates.date(from: "", calendar: cal))
        XCTAssertNil(DateRangeFilterDates.date(from: "2024-03", calendar: cal))
        XCTAssertNil(DateRangeFilterDates.date(from: "not-a-date", calendar: cal))
    }

    func testNoonAnchorKeepsTheLocalDay() throws {
        // A non-UTC zone: the noon anchor must not roll the day backward/forward.
        let zone = try XCTUnwrap(TimeZone(identifier: "Asia/Tokyo"))
        let tokyo = DateRangeFilterDates.gregorian(timeZone: zone)
        let date = try XCTUnwrap(DateRangeFilterDates.date(from: "2024-12-31", calendar: tokyo))
        XCTAssertEqual(DateRangeFilterDates.iso(from: date, calendar: tokyo), "2024-12-31")
    }
}

// MARK: - Matcher (web `matchPresetId`)

final class DateRangeFilterMatcherTests: XCTestCase {
    private let cal = DateRangeFilterDates.gregorian(timeZone: TimeZone(identifier: "UTC")!)

    /// 2024-03-15 (a leap year, Q1) — the fixed "now" the expected matches below are computed against.
    private var now: Date {
        var components = DateComponents()
        components.year = 2024
        components.month = 3
        components.day = 15
        components.hour = 12
        return cal.date(from: components)!
    }

    private func match(_ start: String, _ end: String) -> String? {
        DateRangeFilterMatcher.matchPresetID(start: start, end: end, now: now, calendar: cal)
    }

    func testTodaySingleDayMatches() {
        XCTAssertEqual(match("2024-03-15", "2024-03-15"), "today")
    }

    func testLast7Matches() {
        XCTAssertEqual(match("2024-03-09", "2024-03-15"), "7d")
    }

    func testMonthToDateMatches() {
        XCTAssertEqual(match("2024-03-01", "2024-03-15"), "mtd")
    }

    func testAllTimeMatches() {
        XCTAssertEqual(match("2015-01-01", "2024-03-15"), "all")
    }

    func testEmptyRangeMatchesNothing() {
        XCTAssertNil(match("", ""))
    }

    func testArbitraryRangeMatchesNothing() {
        XCTAssertNil(match("2020-01-01", "2020-01-02"))
    }

    func testCatalogOrderPicksTheFirstEquivalentPreset() {
        // 2024-03-15 is both "today" and the single day "yesterday+1"; catalog order returns the first match.
        XCTAssertEqual(match("2024-03-15", "2024-03-15"), "today")
    }
}

// MARK: - Projector (web render decision)

final class DateRangeFilterProjectorTests: XCTestCase {
    private let cal = DateRangeFilterDates.gregorian(timeZone: TimeZone(identifier: "UTC")!)

    private var now: Date {
        var components = DateComponents()
        components.year = 2024
        components.month = 3
        components.day = 15
        components.hour = 12
        return cal.date(from: components)!
    }

    private func resolve(_ input: DateRangeFilterInput) -> DateRangeFilterProjection {
        DateRangeFilterProjector.resolve(input, now: now, calendar: cal)
    }

    func testActivePresetResolvesFromBoundRange() {
        let projection = resolve(DateRangeFilterInput(startDate: "2024-03-09", endDate: "2024-03-15"))
        XCTAssertEqual(projection.activePresetID, "7d")
    }

    func testNoActiveWhenRangeMatchesNoPreset() {
        let projection = resolve(DateRangeFilterInput(startDate: "2020-01-01", endDate: "2020-06-01"))
        XCTAssertNil(projection.activePresetID)
    }

    func testForwardsPresetVisibilityAndIDs() {
        let custom = ["7d", "30d", "90d"]
        let projection = resolve(DateRangeFilterInput(
            startDate: "",
            endDate: "",
            showPresets: true,
            presetIDs: custom
        ))
        XCTAssertTrue(projection.showPresets)
        XCTAssertEqual(projection.presetIDs, custom)
    }

    func testHidesPresetsWhenDisabled() {
        let projection = resolve(DateRangeFilterInput(startDate: "", endDate: "", showPresets: false))
        XCTAssertFalse(projection.showPresets)
    }

    func testApplyVisibilityMirrorsInput() {
        XCTAssertFalse(resolve(DateRangeFilterInput(startDate: "", endDate: "")).showApply)
        XCTAssertTrue(resolve(DateRangeFilterInput(startDate: "", endDate: "", showApply: true)).showApply)
    }

    func testDefaultPresetIDsMirrorCatalog() {
        let projection = resolve(DateRangeFilterInput(startDate: "", endDate: ""))
        XCTAssertEqual(projection.presetIDs, DatePresetChipsCatalog.defaultIDs)
    }
}

// MARK: - Value-type equality

final class DateRangeFilterValueTypeTests: XCTestCase {
    func testRangeEquality() {
        XCTAssertEqual(
            DateRangeFilterRange(start: "2024-01-01", end: "2024-01-31"),
            DateRangeFilterRange(start: "2024-01-01", end: "2024-01-31")
        )
        XCTAssertNotEqual(
            DateRangeFilterRange(start: "2024-01-01", end: "2024-01-31"),
            DateRangeFilterRange(start: "2024-01-01", end: "2024-02-01")
        )
    }

    func testInputEquality() {
        let lhs = DateRangeFilterInput(startDate: "2024-01-01", endDate: "2024-01-31", showApply: true)
        let rhs = DateRangeFilterInput(startDate: "2024-01-01", endDate: "2024-01-31", showApply: true)
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(
            lhs,
            DateRangeFilterInput(startDate: "2024-01-02", endDate: "2024-01-31", showApply: true)
        )
    }

    func testProjectionEquality() {
        let lhs = DateRangeFilterProjection(
            activePresetID: "7d",
            presetIDs: ["7d", "30d"],
            showPresets: true,
            showApply: false
        )
        let rhs = DateRangeFilterProjection(
            activePresetID: "7d",
            presetIDs: ["7d", "30d"],
            showPresets: true,
            showApply: false
        )
        XCTAssertEqual(lhs, rhs)
    }
}
