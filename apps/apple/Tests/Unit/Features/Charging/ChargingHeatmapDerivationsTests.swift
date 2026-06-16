import XCTest
@testable import TeslaSync

/// Pure-derivation + formatter tests for the Charging Patterns surface — the SwiftUI port of the
/// web `useMemo`s (`stats`, `buildGrid`, `locationData`), the `heatColor` ramp, the local
/// weekday / hour extraction and session-duration guard, the range-preset windows, the display
/// formatters (web `fmtNumber` / `fmtInt`), and the route metadata + registration.
final class ChargingHeatmapDerivationsTests: XCTestCase {
    private var utc: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return calendar
    }

    private func session(
        _ id: Int64,
        at startedAt: String,
        end endedAt: String? = nil,
        wh: Double = 0,
        cost: Double? = nil,
        place: String? = nil
    ) -> ChargingHeatmapSession {
        ChargingHeatmapSession(
            id: id,
            startedAt: startedAt,
            endedAt: endedAt,
            totalEnergyAddedWh: wh,
            costDecimal: cost,
            startPlace: place
        )
    }

    // MARK: Stats (web `stats` memo)

    func testStatsIsNilForNoSessions() {
        XCTAssertNil(ChargingHeatmapDerivations.stats([], calendar: utc))
    }

    func testStatsTotals() {
        let sessions = [
            session(1, at: "2026-06-01T10:00:00Z", end: "2026-06-01T10:30:00Z", wh: 1000, cost: 5),
            session(2, at: "2026-06-02T10:00:00Z", end: nil, wh: 2000, cost: nil)
        ]
        let stats = ChargingHeatmapDerivations.stats(sessions, calendar: utc)
        XCTAssertEqual(stats?.count, 2)
        XCTAssertEqual(stats?.totalEnergyWh, 3000)
        XCTAssertEqual(stats?.totalCost, 5)
        // (1800s + 0s) / 2 = 900s average (the missing end yields a 0 duration, web `?? 0`).
        XCTAssertEqual(stats?.avgDurationSeconds, 900)
    }

    // MARK: Weekly grid (web `buildGrid`)

    func testBuildGridFavoriteBucket() {
        // Three sessions 7 days apart at the same local hour share one weekday×hour bucket.
        let sessions = [
            session(1, at: "2026-06-01T14:00:00Z", wh: 1000),
            session(2, at: "2026-06-08T14:00:00Z", wh: 1000),
            session(3, at: "2026-06-15T14:00:00Z", wh: 1000),
            session(4, at: "2026-06-03T09:00:00Z", wh: 1000)
        ]
        let grid = ChargingHeatmapDerivations.buildGrid(sessions, calendar: utc)
        XCTAssertEqual(grid.maxCount, 3)
        XCTAssertEqual(grid.favHour, 14)
        XCTAssertEqual(grid.favDay, 1) // 2026-06-01 is a Monday (0 = Sunday).
        XCTAssertTrue(grid.hasData)
        XCTAssertEqual(grid.cell(day: 1, hour: 14).count, 3)
        XCTAssertEqual(grid.cell(day: 1, hour: 14).energyWh, 3000)
        XCTAssertTrue(grid.cell(day: 1, hour: 14).hasCharging)
        XCTAssertFalse(grid.cell(day: 5, hour: 5).hasCharging)
    }

    func testBuildGridEmptyForNoSessions() {
        let grid = ChargingHeatmapDerivations.buildGrid([], calendar: utc)
        XCTAssertEqual(grid.maxCount, 0)
        XCTAssertFalse(grid.hasData)
        XCTAssertEqual(grid.cells.count, 7)
        XCTAssertEqual(grid.cells.first?.count, 24)
    }

    // MARK: Top locations (web `locationData`)

    func testLocationsFilterSortAndCap() {
        let sessions = [
            session(1, at: "2026-06-01T10:00:00Z", place: "Home"),
            session(2, at: "2026-06-02T10:00:00Z", place: "Home"),
            session(3, at: "2026-06-03T10:00:00Z", place: "Home"),
            session(4, at: "2026-06-04T10:00:00Z", place: "Work"),
            session(5, at: "2026-06-05T10:00:00Z", place: "Work"),
            session(6, at: "2026-06-06T10:00:00Z", place: "Solo") // < 2 → filtered out.
        ]
        let locations = ChargingHeatmapDerivations.locations(sessions)
        XCTAssertEqual(locations.map(\.name), ["Home", "Work"])
        XCTAssertEqual(locations.first?.count, 3)
    }

    func testLocationsUnknownFallback() {
        let sessions = [
            session(1, at: "2026-06-01T10:00:00Z", place: nil),
            session(2, at: "2026-06-02T10:00:00Z", place: nil)
        ]
        let locations = ChargingHeatmapDerivations.locations(sessions)
        XCTAssertEqual(locations.first?.name, ChargingHeatmapDerivations.unknownPlace)
        XCTAssertEqual(locations.first?.count, 2)
    }

    func testLocationsEmptyForNoSessions() {
        XCTAssertTrue(ChargingHeatmapDerivations.locations([]).isEmpty)
    }

    // MARK: Timestamp + duration helpers

    func testWeekdayAndHour() {
        XCTAssertEqual(ChargingHeatmapDerivations.hour(fromISO: "2026-06-01T22:30:00Z", calendar: utc), 22)
        XCTAssertEqual(ChargingHeatmapDerivations.weekday(fromISO: "2026-06-01T22:30:00Z", calendar: utc), 1)
        XCTAssertNil(ChargingHeatmapDerivations.hour(fromISO: "not-a-date", calendar: utc))
    }

    func testDurationSecondsGuards() {
        XCTAssertEqual(
            ChargingHeatmapDerivations.durationSeconds("2026-06-01T10:00:00Z", "2026-06-01T10:30:00Z", calendar: utc),
            1800
        )
        XCTAssertEqual(ChargingHeatmapDerivations.durationSeconds("2026-06-01T10:00:00Z", nil, calendar: utc), 0)
        XCTAssertEqual(
            ChargingHeatmapDerivations.durationSeconds("2026-06-01T10:00:00Z", "2026-06-01T09:00:00Z", calendar: utc),
            0
        )
    }

    // MARK: Heat tier (web `heatColor`)

    func testHeatTierRamp() {
        XCTAssertEqual(ChargingHeatTier.tier(count: 0, max: 10), .none)
        XCTAssertEqual(ChargingHeatTier.tier(count: 5, max: 0), .none)
        XCTAssertEqual(ChargingHeatTier.tier(count: 1, max: 10), .low)
        XCTAssertEqual(ChargingHeatTier.tier(count: 3, max: 10), .medium)
        XCTAssertEqual(ChargingHeatTier.tier(count: 6, max: 10), .high)
        XCTAssertEqual(ChargingHeatTier.tier(count: 8, max: 10), .peak)
        XCTAssertEqual(ChargingHeatTier.tier(count: 10, max: 10), .peak)
    }

    // MARK: Range presets (web `RangePicker`)

    func testRangeStartDates() {
        let now = ChargingHeatmapDerivations.parseDate("2026-06-16T12:00:00Z") ?? .now
        XCTAssertNil(ChargingHeatmapRange.all.startDate(now: now, calendar: utc))
        XCTAssertEqual(ChargingHeatmapRange.today.startDate(now: now, calendar: utc), utc.startOfDay(for: now))
        XCTAssertNotNil(ChargingHeatmapRange.last7.startDate(now: now, calendar: utc))
        XCTAssertEqual(ChargingHeatmapRange.today.labelKey, "charging.heatmap.range.today")
    }

    func testRangeContains() {
        let now = ChargingHeatmapDerivations.parseDate("2026-06-16T12:00:00Z") ?? .now
        XCTAssertTrue(ChargingHeatmapRange.all.contains("2015-01-01T00:00:00Z", now: now, calendar: utc))
        XCTAssertTrue(ChargingHeatmapRange.last7.contains("2026-06-12T00:00:00Z", now: now, calendar: utc))
        XCTAssertFalse(ChargingHeatmapRange.last7.contains("2026-05-01T00:00:00Z", now: now, calendar: utc))
    }

    // MARK: Formatters (web `fmtNumber` / `fmtInt`)

    func testNumberAndIntFormatting() {
        XCTAssertEqual(ChargingHeatmapFormat.number(1234.5, decimals: 1), "1,234.5")
        XCTAssertEqual(ChargingHeatmapFormat.number(.nan, decimals: 1), "—")
        XCTAssertEqual(ChargingHeatmapFormat.int(8.6), "9")
        XCTAssertEqual(ChargingHeatmapFormat.int(1234), "1,234")
        XCTAssertEqual(ChargingHeatmapFormat.int(.infinity), "—")
    }

    func testHourLabel() {
        XCTAssertEqual(ChargingHeatmapFormat.hourLabel(2), "02:00")
        XCTAssertEqual(ChargingHeatmapFormat.hourLabel(22), "22:00")
    }

    // MARK: Route + registration

    func testRouteMetadata() {
        XCTAssertEqual(AppRoute.chargingHeatmap.pathSegment, "charging-heatmap")
        XCTAssertEqual(AppRoute.chargingHeatmap.path, "/charging-heatmap")
        XCTAssertEqual(AppRoute.chargingHeatmap.group, .vehicle)
        XCTAssertEqual(AppRouteParser.parse(path: "/charging-heatmap"), .chargingHeatmap)
    }

    @MainActor
    func testRouteRegistrationRegistersPage() {
        let registry = ChargingHeatmapRouteRegistration.registry()
        XCTAssertTrue(registry.registeredRoutes.contains(.chargingHeatmap))
    }
}
