import XCTest
@testable import TeslaSync

/// Pure display-formatter + pure-derivation + navigation-registration tests for the Drive
/// Detail surface — `DriveDetailFormat` (number / duration / percent / pair / coordinate / cost
/// / efficiency), the unit-free `DriveDetailDerivations.speedBand` thresholds, and
/// `DriveDetailRouteRegistration`. Split from `DriveDetailPageModelTests` to keep each test type
/// focused and within the body-length budget.
final class DriveDetailFormatTests: XCTestCase {
    func testSpeedBands() {
        // Thresholds are 30 / 60 / 100 mph in SI m/s (13.41 / 26.82 / 44.70).
        XCTAssertEqual(DriveDetailDerivations.speedBand(2), .low)
        XCTAssertEqual(DriveDetailDerivations.speedBand(20), .medium)
        XCTAssertEqual(DriveDetailDerivations.speedBand(30), .high)
        XCTAssertEqual(DriveDetailDerivations.speedBand(50), .veryHigh)
    }

    func testNumberAndDuration() {
        XCTAssertEqual(DriveDetailFormat.number(1234.5, decimals: 1), "1,234.5")
        XCTAssertEqual(DriveDetailFormat.number(.nan), "—")
        XCTAssertEqual(DriveDetailFormat.int(nil), "—")
        XCTAssertEqual(DriveDetailFormat.duration(minutes: 75), "1h 15m")
        XCTAssertEqual(DriveDetailFormat.duration(minutes: 24), "24m")
    }

    func testPercentAndPairAndCoordinate() {
        XCTAssertEqual(DriveDetailFormat.percent(84), "84%")
        XCTAssertEqual(DriveDetailFormat.percent(nil), "—")
        XCTAssertEqual(DriveDetailFormat.pair(10, 20, decimals: 0), "10 → 20")
        XCTAssertEqual(DriveDetailFormat.coordinate(latitude: 37.42, longitude: -122.08), "37.42°N, 122.08°W")
    }

    func testCostAndEfficiency() {
        XCTAssertEqual(DriveDetailFormat.efficiencyDisplay(whPerKm: 100, isMiles: false), 100, accuracy: 0.001)
        XCTAssertEqual(DriveDetailFormat.efficiencyDisplay(whPerKm: 100, isMiles: true), 160.9344, accuracy: 0.001)
        XCTAssertEqual(DriveDetailFormat.efficiencyUnit(isMiles: true), "Wh/mi")
        XCTAssertEqual(DriveDetailFormat.evCost(energyWh: 10000), 1.3, accuracy: 0.001)
        XCTAssertGreaterThan(DriveDetailFormat.gasCost(distanceM: 16093.44), 0)
        XCTAssertNil(DriveDetailFormat.costPerDistance(energyWh: 1000, distanceM: 0, isMiles: false))
    }

    func testRouteRegistrationBuildsPage() {
        _ = DriveDetailRouteRegistration.make(driveID: 7)
        XCTAssertEqual(DriveDetailLink(driveID: 7).driveID, 7)
    }
}
