import MapKit
import XCTest
@testable import TeslaSync

/// Pure-logic tests for the geospatial helpers.
@MainActor final class GeoTests: XCTestCase {
    func testCoordinateValidity() {
        XCTAssertTrue(TSGeo.isValid(CLLocationCoordinate2D(latitude: 37.77, longitude: -122.42)))
        XCTAssertFalse(TSGeo.isValid(CLLocationCoordinate2D(latitude: 0, longitude: 0)))
        XCTAssertFalse(TSGeo.isValid(CLLocationCoordinate2D(latitude: 200, longitude: 0)))
    }

    func testBoundingRegionCenter() {
        let coords = [
            CLLocationCoordinate2D(latitude: 10, longitude: 10),
            CLLocationCoordinate2D(latitude: 20, longitude: 30)
        ]
        let region = TSGeo.boundingRegion(for: coords)
        XCTAssertEqual(region?.center.latitude ?? -1, 15, accuracy: 0.001)
        XCTAssertEqual(region?.center.longitude ?? -1, 20, accuracy: 0.001)
        XCTAssertNil(TSGeo.boundingRegion(for: []))
    }

    func testInterpolateMidpoint() {
        let start = CLLocationCoordinate2D(latitude: 0, longitude: 0)
        let end = CLLocationCoordinate2D(latitude: 10, longitude: 20)
        let mid = TSGeo.interpolate(start, end, t: 0.5)
        XCTAssertEqual(mid.latitude, 5, accuracy: 0.001)
        XCTAssertEqual(mid.longitude, 10, accuracy: 0.001)
    }

    func testRoutePosition() {
        let route = [
            CLLocationCoordinate2D(latitude: 0, longitude: 0),
            CLLocationCoordinate2D(latitude: 10, longitude: 0),
            CLLocationCoordinate2D(latitude: 20, longitude: 0)
        ]
        XCTAssertEqual(TSGeo.routePosition(route, progress: 0)?.latitude ?? -1, 0, accuracy: 0.001)
        XCTAssertEqual(TSGeo.routePosition(route, progress: 1)?.latitude ?? -1, 20, accuracy: 0.001)
        XCTAssertEqual(TSGeo.routePosition(route, progress: 0.5)?.latitude ?? -1, 10, accuracy: 0.001)
    }
}
