import XCTest
@testable import TeslaSync

/// Pure display-boundary formatter tests for the Navigation & Route surface (web `fmtNumber` /
/// `headingToCardinal` + the coordinate / date / traffic-delay-variant helpers). The SI→unit
/// conversions (`distance` / `speed` / `duration`) route through the shared KMP `Units` facade and are
/// exercised by the building app + previews; these tests pin the pure, KMP-independent helpers.
final class NavigationRouteFormatTests: XCTestCase {
    // MARK: - Numbers

    func testNumberFixedDecimals() {
        XCTAssertEqual(NavigationRouteFormat.number(58.234, decimals: 1), "58.2")
        XCTAssertEqual(NavigationRouteFormat.number(47, decimals: 0), "47")
        XCTAssertEqual(NavigationRouteFormat.number(1234.5, decimals: 1), "1,234.5")
    }

    func testNumberNonFiniteIsEmDash() {
        XCTAssertEqual(NavigationRouteFormat.number(.nan, decimals: 1), "—")
        XCTAssertEqual(NavigationRouteFormat.number(.infinity, decimals: 0), "—")
    }

    func testMinutes() {
        XCTAssertEqual(NavigationRouteFormat.minutes(47.6), "48")
        XCTAssertEqual(NavigationRouteFormat.minutes(0), "0")
    }

    // MARK: - Heading (web headingToCardinal)

    func testHeadingCardinalAllOctants() {
        XCTAssertEqual(NavigationRouteFormat.headingCardinal(0), "N")
        XCTAssertEqual(NavigationRouteFormat.headingCardinal(45), "NE")
        XCTAssertEqual(NavigationRouteFormat.headingCardinal(90), "E")
        XCTAssertEqual(NavigationRouteFormat.headingCardinal(135), "SE")
        XCTAssertEqual(NavigationRouteFormat.headingCardinal(180), "S")
        XCTAssertEqual(NavigationRouteFormat.headingCardinal(225), "SW")
        XCTAssertEqual(NavigationRouteFormat.headingCardinal(270), "W")
        XCTAssertEqual(NavigationRouteFormat.headingCardinal(315), "NW")
        XCTAssertEqual(NavigationRouteFormat.headingCardinal(360), "N")
    }

    func testHeadingCardinalNilIsEmDash() {
        XCTAssertEqual(NavigationRouteFormat.headingCardinal(nil), "—")
    }

    func testHeadingValueFormatsCardinalAndDegrees() {
        let result = NavigationRouteFormat.heading(142)
        XCTAssertTrue(result.contains("SE"), result)
        XCTAssertTrue(result.contains("142"), result)
        XCTAssertEqual(NavigationRouteFormat.heading(nil), "—")
    }

    // MARK: - Coordinates

    func testCoordinatePairValid() {
        XCTAssertEqual(
            NavigationRouteFormat.coordinate(latitude: 37.78339, longitude: -122.40901),
            "37.7834, -122.4090"
        )
    }

    func testCoordinateZeroIsNil() {
        XCTAssertNil(NavigationRouteFormat.coordinate(latitude: 0, longitude: 0))
        XCTAssertNil(NavigationRouteFormat.coordinate(latitude: nil, longitude: -122))
    }

    func testCoordinateComponent() {
        XCTAssertEqual(NavigationRouteFormat.coordinateComponent(37.123456), "37.123456")
        XCTAssertEqual(NavigationRouteFormat.coordinateComponent(0), "—")
        XCTAssertEqual(NavigationRouteFormat.coordinateComponent(nil), "—")
    }

    // MARK: - Dates

    func testDateTimeNilIsEmDash() {
        XCTAssertEqual(NavigationRouteFormat.dateTime(nil), "—")
    }

    func testDateTimeRendersValue() {
        let date = Date(timeIntervalSince1970: 1_700_000_000)
        XCTAssertNotEqual(NavigationRouteFormat.dateTime(date), "—")
        XCTAssertFalse(NavigationRouteFormat.timeOnly(date).isEmpty)
    }

    // MARK: - Traffic-delay variants (web TrafficDelayBadge thresholds)

    func testTrafficDelayTone() {
        XCTAssertEqual(NavigationRouteFormat.trafficDelayTone(0), .success)
        XCTAssertEqual(NavigationRouteFormat.trafficDelayTone(299), .success)
        XCTAssertEqual(NavigationRouteFormat.trafficDelayTone(300), .warning)
        XCTAssertEqual(NavigationRouteFormat.trafficDelayTone(900), .warning)
        XCTAssertEqual(NavigationRouteFormat.trafficDelayTone(901), .danger)
    }

    func testTrafficDelayHeadlineTone() {
        XCTAssertEqual(NavigationRouteFormat.trafficDelayHeadlineTone(0), .success)
        XCTAssertEqual(NavigationRouteFormat.trafficDelayHeadlineTone(300), .warning)
        XCTAssertEqual(NavigationRouteFormat.trafficDelayHeadlineTone(301), .danger)
    }
}
