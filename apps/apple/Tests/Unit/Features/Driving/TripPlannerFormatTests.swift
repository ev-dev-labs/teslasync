import XCTest
@testable import TeslaSync

/// Pure display-formatter + speed-option + route-wiring tests for the Trip Planner surface —
/// `TripPlannerFormat` (number / duration / currency / weather-factor + the SI distance/energy
/// boundary conversions), the `TripSpeedOption` factor mapping, and the `.tripPlanner` route's
/// canonical path segment + deep-link resolution.
final class TripPlannerFormatTests: XCTestCase {
    // MARK: Pure helpers (no KMP facade)

    func testNumber() {
        XCTAssertEqual(TripPlannerFormat.number(1234.5, decimals: 1), "1,234.5")
        XCTAssertEqual(TripPlannerFormat.number(28.5, decimals: 2), "28.50")
        XCTAssertEqual(TripPlannerFormat.number(.nan, decimals: 0), "—")
    }

    func testDuration() {
        // Web `formatDuration(seconds / 60)`: floor hours + rounded minutes, `${m}m` under an hour.
        XCTAssertEqual(TripPlannerFormat.duration(seconds: 27000), "7h 30m")
        XCTAssertEqual(TripPlannerFormat.duration(seconds: 5400), "1h 30m")
        XCTAssertEqual(TripPlannerFormat.duration(seconds: 3600), "1h 0m")
        XCTAssertEqual(TripPlannerFormat.duration(seconds: 1440), "24m")
        XCTAssertEqual(TripPlannerFormat.duration(seconds: 0), "0m")
        XCTAssertEqual(TripPlannerFormat.duration(seconds: .nan), "—")
    }

    func testCurrency() {
        XCTAssertEqual(TripPlannerFormat.currency(28.5, .metric, symbol: "$"), "$28.50")
        XCTAssertEqual(TripPlannerFormat.currency(1234.5, .metric, symbol: "$"), "$1,234.50")
        XCTAssertEqual(TripPlannerFormat.currency(0, .metric, symbol: "€"), "€0.00")
        XCTAssertEqual(TripPlannerFormat.currency(.nan, .metric, symbol: "$"), "—")
    }

    func testWeatherFactor() {
        XCTAssertEqual(TripPlannerFormat.weatherFactor(1.12), "1.12")
        XCTAssertEqual(TripPlannerFormat.weatherFactor(1), "1.00")
        XCTAssertEqual(TripPlannerFormat.weatherFactor(0.875), "0.88")
    }

    // MARK: Boundary conversions (SI in → user unit, via the shared `Units` facade)

    func testDistanceConversion() {
        // SI meters → the user's distance unit, whole-number + label.
        XCTAssertEqual(TripPlannerFormat.distance(612_000, .metric), "612 km")
        XCTAssertEqual(TripPlannerFormat.distance(612_000, .imperial), "380 mi")
        XCTAssertEqual(TripPlannerFormat.distance(.nan, .metric), "—")
    }

    func testEnergyAtPrecisionOne() {
        // Web `formatEnergy(wh, { precision: 1 })` — non-empty, carries the user's energy unit label.
        let imperial = TripPlannerFormat.energy(95400, .imperial)
        XCTAssertFalse(imperial.isEmpty)
        XCTAssertNotEqual(imperial, "—")
        XCTAssertTrue(imperial.contains("kWh"), "expected kWh label, got \(imperial)")
    }

    // MARK: Speed options (web `speedOptions`)

    func testSpeedOptionFactors() {
        XCTAssertEqual(TripSpeedOption.relaxed.factor, 0.8, accuracy: 0.0001)
        XCTAssertEqual(TripSpeedOption.normal.factor, 1.0, accuracy: 0.0001)
        XCTAssertEqual(TripSpeedOption.brisk.factor, 1.1, accuracy: 0.0001)
        XCTAssertEqual(TripSpeedOption.fast.factor, 1.2, accuracy: 0.0001)
        XCTAssertEqual(TripSpeedOption.allCases.count, 4)
    }

    func testSpeedOptionFromFactor() {
        XCTAssertEqual(TripSpeedOption.from(factor: 0.79), .relaxed)
        XCTAssertEqual(TripSpeedOption.from(factor: 1.01), .normal)
        XCTAssertEqual(TripSpeedOption.from(factor: 1.09), .brisk)
        XCTAssertEqual(TripSpeedOption.from(factor: 5.0), .fast)
    }

    // MARK: Route wiring (web `/trip-planner`)

    func testRouteSegmentAndGroup() {
        XCTAssertEqual(AppRoute.tripPlanner.pathSegment, "trip-planner")
        XCTAssertEqual(AppRoute.tripPlanner.path, "/trip-planner")
        XCTAssertEqual(AppRoute.tripPlanner.group, .vehicle)
    }

    func testDeepLinkResolves() {
        XCTAssertEqual(AppRouteParser.parse(path: "/trip-planner"), .tripPlanner)
        XCTAssertEqual(AppRouteParser.parse(path: "/trip-planner/"), .tripPlanner)
    }
}
