import XCTest
@testable import TeslaSync

/// Display-boundary formatter tests for the Route Efficiency surface (web `fmtNumber` / `fmtInt` +
/// `efficiencyUnit` / `toEfficiencyDisplay` + `efficiencyVariant` + the chart label truncation). The
/// SI/unit math lives in the shared KMP `Units` facade; these pin the page-local wrappers.
final class RouteEfficiencyFormatTests: XCTestCase {
    // MARK: - Efficiency unit + conversion (web `efficiencyUnit` / `toEfficiencyDisplay`)

    func testEfficiencyUnitFollowsDistancePreference() {
        XCTAssertEqual(RouteEfficiencyFormat.efficiencyUnit(.metric), "Wh/km")
        XCTAssertEqual(RouteEfficiencyFormat.efficiencyUnit(.imperial), "Wh/mi")
    }

    func testEfficiencyValueScalesForImperial() {
        XCTAssertEqual(RouteEfficiencyFormat.efficiencyValue(150, .metric), 150, accuracy: 0.0001)
        XCTAssertEqual(RouteEfficiencyFormat.efficiencyValue(150, .imperial), 150 * 1.609344, accuracy: 0.0001)
    }

    func testEfficiencyRoundedAndInt() {
        XCTAssertEqual(RouteEfficiencyFormat.efficiencyRounded(150.4, .metric), 150)
        XCTAssertEqual(RouteEfficiencyFormat.efficiencyRounded(150.6, .metric), 151)
        XCTAssertEqual(RouteEfficiencyFormat.efficiencyInt(160, .metric), "160 Wh/km")
    }

    // MARK: - Variant thresholds (web `efficiencyVariant`)

    func testVariantThresholds() {
        XCTAssertEqual(RouteEfficiencyFormat.variant(100), .success)
        XCTAssertEqual(RouteEfficiencyFormat.variant(139.9), .success)
        XCTAssertEqual(RouteEfficiencyFormat.variant(140), .info)
        XCTAssertEqual(RouteEfficiencyFormat.variant(179.9), .info)
        XCTAssertEqual(RouteEfficiencyFormat.variant(180), .warning)
        XCTAssertEqual(RouteEfficiencyFormat.variant(219.9), .warning)
        XCTAssertEqual(RouteEfficiencyFormat.variant(220), .danger)
        XCTAssertEqual(RouteEfficiencyFormat.variant(300), .danger)
    }

    // MARK: - Distance (web `fmtNumber(toDistanceDisplay(m))`)

    func testDistanceConvertsMetersToKilometers() {
        XCTAssertEqual(RouteEfficiencyFormat.distanceValue(40000, .metric), 40, accuracy: 0.0001)
        XCTAssertEqual(RouteEfficiencyFormat.distance(40000, .metric), "40.00 km")
    }

    // MARK: - Number safety (web `fmtNumber` / `fmtInt`)

    func testNonFiniteRendersEmDash() {
        XCTAssertEqual(RouteEfficiencyFormat.number(.infinity, decimals: 0), "—")
        XCTAssertEqual(RouteEfficiencyFormat.integer(.nan), "—")
    }

    func testIntegerGroupsThousands() {
        XCTAssertEqual(RouteEfficiencyFormat.integer(12345), "12,345")
    }

    // MARK: - Chart label (web `${start.substring(0,10)}→${end.substring(0,10)}`)

    func testChartLabelTruncatesEachEndpoint() {
        let label = RouteEfficiencyFormat.chartLabel(start: "Market St, San Francisco", end: "Sand Hill Rd")
        XCTAssertEqual(label, "Market St,→Sand Hill ")
    }

    func testChartLabelKeepsShortNames() {
        XCTAssertEqual(RouteEfficiencyFormat.chartLabel(start: "Home", end: "Work"), "Home→Work")
    }
}
