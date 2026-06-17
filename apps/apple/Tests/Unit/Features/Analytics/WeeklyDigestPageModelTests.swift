import XCTest
@testable import TeslaSync

/// Unit tests for the Weekly Digest model core — phases, week navigation, vehicle selection, and the
/// `useWeeklyDigest` projection / trend / format parity. Pure logic (no SwiftUI), driven by the
/// injectable sample / empty / failing data sources and a fixed clock.
@MainActor
final class WeeklyDigestPageModelTests: XCTestCase {
    private var calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        cal.locale = Locale(identifier: "en_US")
        return cal
    }()

    private let locale = Locale(identifier: "en_US")

    private func fixedNow() -> Date {
        var comps = DateComponents()
        comps.year = 2026
        comps.month = 6
        comps.day = 17 // Wednesday
        comps.hour = 10
        return calendar.date(from: comps)!
    }

    private func makeModel(dataSource: any WeeklyDigestDataSource) -> WeeklyDigestPageModel {
        let now = fixedNow()
        return WeeklyDigestPageModel(dataSource: dataSource, now: { now }, calendar: calendar, locale: locale)
    }

    // MARK: Phases

    func testLoadsToReadyWithSampleData() async {
        let model = makeModel(dataSource: SampleWeeklyDigestDataSource(now: { [self] in fixedNow() }))
        XCTAssertEqual(model.phase, .loading)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.selectedVehicleID, "1")
        XCTAssertEqual(model.vehicleOptions.count, 3)
        XCTAssertTrue(model.computed.hasData)
        XCTAssertGreaterThan(model.computed.metrics.totalDistance, 0)
    }

    func testEmptyDataSourceResolvesToEmptyPhase() async {
        let model = makeModel(dataSource: EmptyWeeklyDigestDataSource())
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertFalse(model.computed.hasData)
    }

    func testFailingDataSourceResolvesToErrorPhase() async {
        let model = makeModel(dataSource: FailingWeeklyDigestDataSource())
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected error phase, got \(model.phase)")
        }
    }

    // MARK: Navigation

    func testNextWeekIsGatedOnCurrentWeek() async {
        let model = makeModel(dataSource: SampleWeeklyDigestDataSource(now: { [self] in fixedNow() }))
        await model.load()
        XCTAssertTrue(model.isCurrentWeek)
        model.goToNextWeek()
        XCTAssertEqual(model.weekOffset, 0, "next-week is a no-op on the current week")
    }

    func testPreviousAndNextWeekNavigation() async {
        let model = makeModel(dataSource: SampleWeeklyDigestDataSource(now: { [self] in fixedNow() }))
        await model.load()
        model.goToPreviousWeek()
        XCTAssertEqual(model.weekOffset, -1)
        XCTAssertFalse(model.isCurrentWeek)
        model.goToNextWeek()
        XCTAssertEqual(model.weekOffset, 0)
        XCTAssertTrue(model.isCurrentWeek)
    }

    func testSelectVehicleIsNoOpForSameID() async {
        let model = makeModel(dataSource: SampleWeeklyDigestDataSource(now: { [self] in fixedNow() }))
        await model.load()
        model.selectVehicle("1")
        XCTAssertEqual(model.selectedVehicleID, "1")
    }

    // MARK: Week math

    func testWeekRangeIsMondayAnchored() throws {
        let week = WeeklyDigestCalendar.weekRange(offset: 0, now: fixedNow(), calendar: calendar)
        XCTAssertEqual(calendar.component(.weekday, from: week.start), 2, "week starts on Monday")
        XCTAssertLessThan(week.start, week.end)
        let monday = week.start
        let sunday = try XCTUnwrap(calendar.date(byAdding: .day, value: 6, to: monday))
        XCTAssertEqual(WeeklyDigestCalendar.dayOfWeekIndex(monday, calendar: calendar), 0)
        XCTAssertEqual(WeeklyDigestCalendar.dayOfWeekIndex(sunday, calendar: calendar), 6)
    }

    // MARK: Trend math

    func testTrendDirectionAndPolarity() {
        let up = DigestTrendCalculator.trend(current: 120, previous: 100)
        XCTAssertEqual(up.direction, .up)
        XCTAssertTrue(up.positive)
        XCTAssertEqual(up.value, "+20.0%")

        let inverted = DigestTrendCalculator.trend(current: 80, previous: 100, invertPositive: true)
        XCTAssertEqual(inverted.direction, .down)
        XCTAssertTrue(inverted.positive, "a decrease is good for lower-is-better metrics")

        let flat = DigestTrendCalculator.trend(current: 100, previous: 100)
        XCTAssertEqual(flat.direction, .flat)
        XCTAssertEqual(flat.value, "0%")

        XCTAssertEqual(DigestTrendCalculator.pctChange(current: 5, previous: 0), 100)
    }

    // MARK: Format

    func testFormatters() {
        XCTAssertEqual(WeeklyDigestFormat.number(1234.5, decimals: 1), "1,234.5")
        XCTAssertEqual(WeeklyDigestFormat.int(42), "42")
        XCTAssertEqual(WeeklyDigestFormat.currency(12.3, decimals: 2), "$12.30")
        XCTAssertEqual(WeeklyDigestFormat.drivingTime(minutes: 125), "2h 5m")
        XCTAssertEqual(WeeklyDigestFormat.percent(9.25, decimals: 1), "9.3%")
    }

    // MARK: Projection

    func testProjectionAggregatesSampleActivity() {
        let activity = SampleWeeklyDigestFixture.activity(now: fixedNow())
        let computed = WeeklyDigestProjection.compute(
            activity: activity, offset: 0, now: fixedNow(), calendar: calendar
        )
        XCTAssertTrue(computed.hasData)
        XCTAssertGreaterThan(computed.metrics.totalDrives, 0)
        XCTAssertEqual(computed.dailyDistance.count, 7)
        XCTAssertEqual(computed.dailyEnergy.count, 7)
        XCTAssertEqual(
            computed.metrics.alertCounts.reduce(0) { $0 + $1.count },
            computed.metrics.alertTotal,
            "severity tallies sum to the total"
        )
    }

    func testProjectionOfEmptyActivityHasNoData() {
        let computed = WeeklyDigestProjection.compute(
            activity: .empty, offset: 0, now: fixedNow(), calendar: calendar
        )
        XCTAssertFalse(computed.hasData)
        XCTAssertEqual(computed.metrics.totalDrives, 0)
        XCTAssertNil(computed.funFact)
    }
}
