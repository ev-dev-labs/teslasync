//
//  TripReplayMap.AdapterTests.swift
//  TeslaSync — P4 feature view · 0274 · TripReplayMap (Apple)
//
//  Geometry + speed-band + accessibility coverage for the TripReplayMap domain core
//  (the projection + model coverage lives in `TripReplayMap.Tests`). Each test pins a
//  web `lib/geo.ts` / `TripReplayMap.tsx` expression — the haversine constant, the
//  (0,0)/bounds validity, the 10 m meaningful-route anchor scan, the first-valid-index,
//  the O(n) nearest-sample resolver, the great-circle heading + [0,360) normalisation,
//  and the `speedColor` thresholds. These run in the TeslaSync(/-macOS) XCTest targets —
//  no network, no real store, no rendered map.
//

import XCTest
@testable import TeslaSync

// MARK: - Geometry (web `lib/geo.ts`)

final class TripReplayGeoTests: XCTestCase {
    func testHaversineZeroForIdenticalPoints() {
        XCTAssertEqual(TripReplayGeo.haversineMeters(37.77, -122.41, 37.77, -122.41), 0, accuracy: 0.0001)
    }

    func testHaversineOneDegreeLongitudeAtEquator() {
        // 1° of longitude at the equator ≈ R · π/180 ≈ 111_194.9 m.
        XCTAssertEqual(TripReplayGeo.haversineMeters(0, 0, 0, 1), 111_194.9, accuracy: 1.0)
    }

    func testHaversineSanFranciscoToLosAngeles() {
        let meters = TripReplayGeo.haversineMeters(37.7749, -122.4194, 34.0522, -118.2437)
        XCTAssertGreaterThan(meters, 550_000)
        XCTAssertLessThan(meters, 570_000)
    }

    func testIsValidLatLngAcceptsRealCoordinates() {
        XCTAssertTrue(TripReplayGeo.isValidLatLng(37.77, -122.41))
        XCTAssertTrue(TripReplayGeo.isValidLatLng(-89.9, 179.9))
    }

    func testIsValidLatLngRejectsNullIslandBoundsAndNonFinite() {
        XCTAssertFalse(TripReplayGeo.isValidLatLng(0, 0), "the (0,0) GPS sentinel is rejected")
        XCTAssertFalse(TripReplayGeo.isValidLatLng(91, 0))
        XCTAssertFalse(TripReplayGeo.isValidLatLng(0, 181))
        XCTAssertFalse(TripReplayGeo.isValidLatLng(.nan, 10))
        XCTAssertFalse(TripReplayGeo.isValidLatLng(10, .infinity))
    }

    func testFirstValidIndexSkipsNullIsland() {
        let positions = [
            TripReplayPosition(latitude: 0, longitude: 0),
            TripReplayPosition(latitude: 0, longitude: 0),
            TripReplayPosition(latitude: 37.77, longitude: -122.41)
        ]
        XCTAssertEqual(TripReplayGeo.firstValidIndex(positions), 2)
    }

    func testFirstValidIndexIsMinusOneWhenNoneValid() {
        let positions = [
            TripReplayPosition(latitude: 0, longitude: 0),
            TripReplayPosition(latitude: .nan, longitude: 1)
        ]
        XCTAssertEqual(TripReplayGeo.firstValidIndex(positions), -1)
    }

    func testHasMeaningfulRouteTrueWhenSamplesSpreadBeyondTenMeters() {
        let positions = [
            TripReplayPosition(latitude: 37.7749, longitude: -122.4194),
            TripReplayPosition(latitude: 37.7849, longitude: -122.4094)
        ]
        XCTAssertTrue(TripReplayGeo.hasMeaningfulRoute(positions))
    }

    func testHasMeaningfulRouteFalseForStationaryCluster() {
        let positions = Array(repeating: TripReplayPosition(latitude: 37.7749, longitude: -122.4194), count: 6)
        XCTAssertFalse(TripReplayGeo.hasMeaningfulRoute(positions))
    }

    func testHasMeaningfulRouteFalseForSubThresholdJitter() {
        // ~1 m apart — below the 10 m threshold, so still a single cluster.
        let positions = [
            TripReplayPosition(latitude: 37.774900, longitude: -122.419400),
            TripReplayPosition(latitude: 37.774905, longitude: -122.419405)
        ]
        XCTAssertFalse(TripReplayGeo.hasMeaningfulRoute(positions))
    }

    func testHasMeaningfulRouteFalseWhenEmpty() {
        XCTAssertFalse(TripReplayGeo.hasMeaningfulRoute([]))
    }

    func testNearestSampleIndexEmptyIsZero() {
        XCTAssertEqual(TripReplayGeo.nearestSampleIndex([], latitude: 1, longitude: 1), 0)
    }

    func testNearestSampleIndexPicksClosest() {
        let positions = [
            TripReplayPosition(latitude: 37.0, longitude: -122.0),
            TripReplayPosition(latitude: 38.0, longitude: -121.0),
            TripReplayPosition(latitude: 39.0, longitude: -120.0)
        ]
        XCTAssertEqual(TripReplayGeo.nearestSampleIndex(positions, latitude: 37.95, longitude: -121.05), 1)
    }

    func testHeadingCardinalDirections() {
        let origin = TripReplayPosition(latitude: 0, longitude: 0)
        let north = TripReplayPosition(latitude: 1, longitude: 0)
        let east = TripReplayPosition(latitude: 0, longitude: 1)
        let west = TripReplayPosition(latitude: 0, longitude: -1)
        XCTAssertEqual(TripReplayGeo.heading(from: origin, to: north), 0, accuracy: 0.5)
        XCTAssertEqual(TripReplayGeo.heading(from: origin, to: east), 90, accuracy: 0.5)
        XCTAssertEqual(TripReplayGeo.heading(from: origin, to: west), 270, accuracy: 0.5)
        XCTAssertEqual(TripReplayGeo.heading(from: north, to: origin), 180, accuracy: 0.5)
    }
}

// MARK: - Speed bands (web `speedColor`)

final class TripReplaySpeedBandTests: XCTestCase {
    func testBandThresholdsMatchWebSpeedColor() {
        XCTAssertEqual(TripReplaySpeedBand.forSpeed(0), .slow)
        XCTAssertEqual(TripReplaySpeedBand.forSpeed(29.9), .slow)
        XCTAssertEqual(TripReplaySpeedBand.forSpeed(30), .moderate)
        XCTAssertEqual(TripReplaySpeedBand.forSpeed(59.9), .moderate)
        XCTAssertEqual(TripReplaySpeedBand.forSpeed(60), .fast)
        XCTAssertEqual(TripReplaySpeedBand.forSpeed(99.9), .fast)
        XCTAssertEqual(TripReplaySpeedBand.forSpeed(100), .veryFast)
        XCTAssertEqual(TripReplaySpeedBand.forSpeed(180), .veryFast)
    }
}

// MARK: - Accessibility labels (no hardcoded literals in the view)

final class TripReplayMapLabelsTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testCanvasSummaryEmpty() {
        XCTAssertEqual(
            TripReplayMapLabels.canvasSummary(for: .empty, localize: echo),
            "No position data available for this drive"
        )
    }

    func testCanvasSummaryRoute() {
        let route = TripReplayRoute.make(
            positions: [
                TripReplayPosition(latitude: 37.7749, longitude: -122.4194),
                TripReplayPosition(latitude: 37.7849, longitude: -122.4094)
            ],
            currentIndex: 0
        )
        XCTAssertEqual(TripReplayMapLabels.canvasSummary(for: route, localize: echo), "Trip replay route map")
    }

    func testCanvasSummaryStationary() {
        let route = TripReplayRoute.make(
            positions: Array(repeating: TripReplayPosition(latitude: 37.7749, longitude: -122.4194), count: 4),
            currentIndex: 0
        )
        XCTAssertEqual(TripReplayMapLabels.canvasSummary(for: route, localize: echo), "Route can't be plotted")
    }

    func testMarkerLabels() {
        XCTAssertEqual(TripReplayMapLabels.startLabel(localize: echo), "Start")
        XCTAssertEqual(TripReplayMapLabels.endLabel(localize: echo), "End")
        XCTAssertEqual(TripReplayMapLabels.anchorLabel(localize: echo), "Last known location")
        XCTAssertEqual(TripReplayMapLabels.playheadLabel(localize: echo), "Current position")
    }

    func testSurfaceSlug() {
        XCTAssertEqual(TripReplayMapSurface.slug, "TripReplayMap")
    }
}
