import XCTest
@testable import TeslaSync

/// Privacy-redaction tests: VIN stripping, name truncation, and the coordinate guard
/// that keeps precise location out of the cached widget payload (ADR-005/ADR-013).
@MainActor
final class WidgetRedactionTests: XCTestCase {
    func testStripsEmbeddedVIN() {
        let result = WidgetRedaction.vehicleName("Tesla 5YJ3E1EA7KF000000")
        XCTAssertFalse(result.contains("5YJ3E1EA7KF000000"))
        XCTAssertTrue(result.contains("Tesla"))
    }

    func testTruncatesLongName() {
        let result = WidgetRedaction.vehicleName(String(repeating: "A", count: 60))
        XCTAssertLessThanOrEqual(result.count, WidgetRedaction.maxNameLength)
    }

    func testEmptyNameFallsBack() {
        XCTAssertEqual(WidgetRedaction.vehicleName("   "), "Vehicle")
        XCTAssertEqual(WidgetRedaction.vehicleName("", fallback: "Drive"), "Drive")
    }

    func testCoarseLocationDropsCoordinates() {
        XCTAssertNil(WidgetRedaction.coarseLocation("37.7749, -122.4194"))
    }

    func testCoarseLocationKeepsPlaceName() {
        XCTAssertEqual(WidgetRedaction.coarseLocation("San Jose"), "San Jose")
    }

    func testCoarseLocationNilForEmptyOrNil() {
        XCTAssertNil(WidgetRedaction.coarseLocation("  "))
        XCTAssertNil(WidgetRedaction.coarseLocation(nil))
    }

    func testLooksLikeCoordinates() {
        XCTAssertTrue(WidgetRedaction.looksLikeCoordinates("37.77,-122.41"))
        XCTAssertTrue(WidgetRedaction.looksLikeCoordinates("37.77 -122.41"))
        XCTAssertFalse(WidgetRedaction.looksLikeCoordinates("Cupertino"))
    }
}
