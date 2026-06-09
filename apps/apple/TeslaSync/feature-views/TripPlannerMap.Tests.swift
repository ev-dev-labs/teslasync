//
//  TripPlannerMap.Tests.swift
//  TeslaSync — P4 feature view · 0178 · TripPlannerMap (Apple)
//
//  Adapter + projection + formatting + label/accessibility coverage for the
//  TripPlannerMap surface (the model/state-holder coverage lives in
//  `TripPlannerMap.ModelTests`). Each test ports a web computation or branch
//  (`polylinePoints`, `center`, `zoom`, `hasData`, the popup templates). These run in
//  the TeslaSync(/-macOS) XCTest targets — no network, no real store, no rendered map.
//

import CoreLocation
import XCTest
@testable import TeslaSync

// MARK: - Adapter: guards + primitives

@MainActor final class TripPlannerMapAdapterTests: XCTestCase {
    func testIsFiniteAcceptsFiniteNumbersOnly() {
        XCTAssertTrue(TripPlannerMapNumeric.isFinite(37.77))
        XCTAssertTrue(TripPlannerMapNumeric.isFinite(0))
        XCTAssertFalse(TripPlannerMapNumeric.isFinite(.nan))
        XCTAssertFalse(TripPlannerMapNumeric.isFinite(.infinity))
    }

    func testLocationIsPlottableRequiresBothFiniteComponents() {
        XCTAssertTrue(TripPlannerLocation(latitude: 37.4, longitude: -122.0).isPlottable)
        XCTAssertFalse(TripPlannerLocation(latitude: .nan, longitude: -122.0).isPlottable)
        XCTAssertFalse(TripPlannerLocation(latitude: 37.4, longitude: .infinity).isPlottable)
    }
}

// MARK: - Projection: polyline (web `polylinePoints` memo)

@MainActor final class TripPlannerMapPolylineTests: XCTestCase {
    private let origin = TripPlannerLocation(latitude: 37.77, longitude: -122.41, name: "SF")
    private let destination = TripPlannerLocation(latitude: 34.05, longitude: -118.24, name: "LA")
    private let mid = TripPlannerLocation(latitude: 36.25, longitude: -120.23, name: "Mid")

    func testNoLegsButBothEndpointsYieldsDirectLine() {
        let line = TripPlannerMapProjection.polylineCoordinates(origin: origin, destination: destination, legs: [])
        XCTAssertEqual(line.count, 2)
        XCTAssertEqual(line.first, TripPlannerCoordinate(latitude: 37.77, longitude: -122.41))
        XCTAssertEqual(line.last, TripPlannerCoordinate(latitude: 34.05, longitude: -118.24))
    }

    func testLegsChainFromToVertices() {
        let legs = [
            TripPlannerLeg(from: origin, to: mid),
            TripPlannerLeg(from: mid, to: destination)
        ]
        let line = TripPlannerMapProjection.polylineCoordinates(origin: origin, destination: destination, legs: legs)
        // First leg contributes both endpoints; each later leg its `to`.
        XCTAssertEqual(line.count, 3)
        XCTAssertEqual(line.map(\.latitude), [37.77, 36.25, 34.05])
    }

    func testOnlyOriginNoLegsYieldsEmptyLine() {
        // Web: the direct-line branch needs both endpoints; the leg loop is empty.
        let line = TripPlannerMapProjection.polylineCoordinates(origin: origin, destination: nil, legs: [])
        XCTAssertTrue(line.isEmpty)
    }
}

// MARK: - Projection: center + zoom (web memos)

@MainActor final class TripPlannerMapCameraInputsTests: XCTestCase {
    private func location(_ lat: Double, _ lng: Double) -> TripPlannerLocation {
        TripPlannerLocation(latitude: lat, longitude: lng)
    }

    func testCenterIsMidpointWhenBothEndpointsExist() {
        let center = TripPlannerMapProjection.centerCoordinate(origin: location(10, 20), destination: location(30, 60))
        XCTAssertEqual(center.latitude, 20, accuracy: 0.0001)
        XCTAssertEqual(center.longitude, 40, accuracy: 0.0001)
    }

    func testCenterIsOriginWhenDestinationMissing() {
        let center = TripPlannerMapProjection.centerCoordinate(origin: location(12, -34), destination: nil)
        XCTAssertEqual(center.latitude, 12, accuracy: 0.0001)
        XCTAssertEqual(center.longitude, -34, accuracy: 0.0001)
    }

    func testCenterFallsBackToContinentalUSWhenEmpty() {
        let center = TripPlannerMapProjection.centerCoordinate(origin: nil, destination: nil)
        XCTAssertEqual(center.latitude, 39.8283, accuracy: 0.0001)
        XCTAssertEqual(center.longitude, -98.5795, accuracy: 0.0001)
    }

    func testZoomStepsOverLargerDelta() {
        XCTAssertEqual(TripPlannerMapProjection.zoomLevel(origin: location(0, 0), destination: location(0, 30)), 4)
        XCTAssertEqual(TripPlannerMapProjection.zoomLevel(origin: location(0, 0), destination: location(0, 15)), 5)
        XCTAssertEqual(TripPlannerMapProjection.zoomLevel(origin: location(0, 0), destination: location(0, 8)), 6)
        XCTAssertEqual(TripPlannerMapProjection.zoomLevel(origin: location(0, 0), destination: location(0, 3)), 7)
        XCTAssertEqual(TripPlannerMapProjection.zoomLevel(origin: location(0, 0), destination: location(0, 1)), 9)
    }

    func testZoomIsFiveWhenAnEndpointIsMissing() {
        XCTAssertEqual(TripPlannerMapProjection.zoomLevel(origin: location(0, 0), destination: nil), 5)
        XCTAssertEqual(TripPlannerMapProjection.zoomLevel(origin: nil, destination: location(0, 0)), 5)
    }
}

// MARK: - Projection: markers + hasData (web body)

@MainActor final class TripPlannerMapProjectionTests: XCTestCase {
    private let origin = TripPlannerLocation(latitude: 37.77, longitude: -122.41, name: "SF")
    private let destination = TripPlannerLocation(latitude: 34.05, longitude: -118.24, name: "LA")

    private func stop(_ lat: Double, _ lng: Double, name: String) -> TripPlannerChargeStop {
        TripPlannerChargeStop(
            name: name,
            location: TripPlannerLocation(latitude: lat, longitude: lng, name: name),
            chargeFromSoc: 20,
            chargeToSoc: 80,
            chargeDurationS: 1800
        )
    }

    func testFullPlanBuildsAllMarkersInOrder() {
        let projection = TripPlannerMapProjection.make(
            origin: origin,
            destination: destination,
            legs: [],
            chargeStops: [stop(36.25, -120.23, name: "Harris"), stop(35.99, -119.95, name: "Kettleman")]
        )
        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.markerCount, 4)
        XCTAssertEqual(projection.markers.map(\.id), ["origin", "destination", "stop-0", "stop-1"])
        XCTAssertEqual(projection.markers.map(\.kind), [.origin, .destination, .chargeStop, .chargeStop])
        XCTAssertEqual(projection.chargeStopMarkers.count, 2)
    }

    func testHasDataIsTrueWithOnlyOrigin() {
        let projection = TripPlannerMapProjection.make(origin: origin, destination: nil, legs: [], chargeStops: [])
        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.markers.map(\.id), ["origin"])
    }

    func testHasDataIsFalseWithNoEndpoints() {
        let projection = TripPlannerMapProjection.make(origin: nil, destination: nil, legs: [], chargeStops: [])
        XCTAssertFalse(projection.hasData)
        XCTAssertTrue(projection.markers.isEmpty)
        XCTAssertFalse(projection.hasFittableSpan)
    }

    func testNonFiniteEndpointKeepsHasDataButDropsMarker() {
        // Web `hasData` is prop presence, not coordinate validity; Leaflet silently
        // skips the NaN marker, so the projection keeps hasData but omits the pin.
        let nanOrigin = TripPlannerLocation(latitude: .nan, longitude: -122.0, name: "Broken")
        let projection = TripPlannerMapProjection.make(
            origin: nanOrigin,
            destination: destination,
            legs: [],
            chargeStops: []
        )
        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.markers.map(\.id), ["destination"])
    }

    func testFittableSpanAndMapCoordinates() {
        let projection = TripPlannerMapProjection.make(
            origin: origin,
            destination: destination,
            legs: [],
            chargeStops: [stop(36.25, -120.23, name: "Harris")]
        )
        // 3 markers + 2 polyline vertices (direct origin→destination line) = 5 coords.
        XCTAssertEqual(projection.mapCoordinates.count, 5)
        XCTAssertTrue(projection.hasFittableSpan)
    }

    func testSinglePointIsNotFittable() {
        let projection = TripPlannerMapProjection.make(origin: origin, destination: nil, legs: [], chargeStops: [])
        XCTAssertFalse(projection.hasFittableSpan)
        XCTAssertEqual(projection.mapCoordinates.count, 1)
    }
}

// MARK: - Formatting (web popup `Math.round` templates)

@MainActor final class TripPlannerMapFormatTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")

    func testSocRoundsToWholeNumber() {
        XCTAssertEqual(TripPlannerMapFormat.soc(18, locale: posix), "18")
        XCTAssertEqual(TripPlannerMapFormat.soc(80.4, locale: posix), "80")
        XCTAssertEqual(TripPlannerMapFormat.soc(80.6, locale: posix), "81")
    }

    func testMinutesConvertsFromSeconds() {
        XCTAssertEqual(TripPlannerMapFormat.minutes(fromSeconds: 1800, locale: posix), "30")
        XCTAssertEqual(TripPlannerMapFormat.minutes(fromSeconds: 1500, locale: posix), "25")
        XCTAssertEqual(TripPlannerMapFormat.minutes(fromSeconds: 0, locale: posix), "0")
    }

    func testNonFiniteRendersEmDash() {
        XCTAssertEqual(TripPlannerMapFormat.soc(.nan, locale: posix), "—")
        XCTAssertEqual(TripPlannerMapFormat.minutes(fromSeconds: .infinity, locale: posix), "—")
    }
}

// MARK: - Labels + accessibility (no hardcoded literals in the view)

@MainActor final class TripPlannerMapLabelsTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let posix = Locale(identifier: "en_US_POSIX")

    func testEndpointNamesResolveBlankToRoleFallback() {
        XCTAssertEqual(TripPlannerMapLabels.originName("San Francisco", localize: echo), "San Francisco")
        XCTAssertEqual(TripPlannerMapLabels.originName("", localize: echo), "Origin")
        XCTAssertEqual(TripPlannerMapLabels.originName("   ", localize: echo), "Origin")
        XCTAssertEqual(TripPlannerMapLabels.destinationName("Los Angeles", localize: echo), "Los Angeles")
        XCTAssertEqual(TripPlannerMapLabels.destinationName("", localize: echo), "Destination")
        XCTAssertEqual(TripPlannerMapLabels.chargeStopName("Harris Ranch", localize: echo), "Harris Ranch")
        XCTAssertEqual(TripPlannerMapLabels.chargeStopName("", localize: echo), "Charge stop")
    }

    func testMapLabel() {
        XCTAssertEqual(TripPlannerMapLabels.mapLabel(localize: echo), "Trip route map")
    }

    func testChargeRangeReproducesWebPopupTemplate() {
        XCTAssertEqual(
            TripPlannerMapLabels.chargeRange(fromSoc: 18, toSoc: 80, durationS: 1800, localize: echo, locale: posix),
            "18% → 80% (30 min)"
        )
    }

    func testHasName() {
        XCTAssertTrue(TripPlannerMapLabels.hasName("SF"))
        XCTAssertFalse(TripPlannerMapLabels.hasName(""))
        XCTAssertFalse(TripPlannerMapLabels.hasName("  \n "))
    }
}

// MARK: - Callout display (port of the web Leaflet popups)

@MainActor final class TripPlannerMarkerDisplayTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let posix = Locale(identifier: "en_US_POSIX")

    func testOriginCalloutHasTitleNoDetailAndSpokenLabel() {
        let marker = TripPlannerMarker(id: "origin", kind: .origin, latitude: 37.77, longitude: -122.41, name: "SF")
        let display = TripPlannerMarkerDisplay.make(marker: marker, localize: echo, locale: posix)
        XCTAssertEqual(display.title, "SF")
        XCTAssertNil(display.detail)
        XCTAssertEqual(display.accessibilityLabel, "Origin: SF")
    }

    func testUnnamedOriginSpeaksJustTheRoleWord() {
        let marker = TripPlannerMarker(id: "origin", kind: .origin, latitude: 37.77, longitude: -122.41, name: "")
        let display = TripPlannerMarkerDisplay.make(marker: marker, localize: echo, locale: posix)
        XCTAssertEqual(display.title, "Origin")
        XCTAssertEqual(display.accessibilityLabel, "Origin")
    }

    func testDestinationCallout() {
        let marker = TripPlannerMarker(
            id: "destination",
            kind: .destination,
            latitude: 34.05,
            longitude: -118.24,
            name: "LA"
        )
        let display = TripPlannerMarkerDisplay.make(marker: marker, localize: echo, locale: posix)
        XCTAssertEqual(display.title, "LA")
        XCTAssertNil(display.detail)
        XCTAssertEqual(display.accessibilityLabel, "Destination: LA")
    }

    func testChargeStopCalloutHasRangeDetailAndSpokenLabel() {
        let marker = TripPlannerMarker(
            id: "stop-0",
            kind: .chargeStop,
            latitude: 36.25,
            longitude: -120.23,
            name: "Harris Ranch",
            chargeFromSoc: 18,
            chargeToSoc: 80,
            chargeDurationS: 1800
        )
        let display = TripPlannerMarkerDisplay.make(marker: marker, localize: echo, locale: posix)
        XCTAssertEqual(display.title, "Harris Ranch")
        XCTAssertEqual(display.detail, "18% → 80% (30 min)")
        XCTAssertEqual(display.accessibilityLabel, "Harris Ranch, 18% to 80%, 30 minutes")
    }

    func testChargeStopWithMissingSocDefaultsToZero() {
        let marker = TripPlannerMarker(id: "stop-1", kind: .chargeStop, latitude: 36, longitude: -120, name: "Edge")
        let display = TripPlannerMarkerDisplay.make(marker: marker, localize: echo, locale: posix)
        XCTAssertEqual(display.detail, "0% → 0% (0 min)")
    }

    @MainActor
    func testSurfaceSlug() {
        XCTAssertEqual(TripPlannerMapSurface.slug, "TripPlannerMap")
        XCTAssertEqual(TripPlannerMap.surfaceSlug, "TripPlannerMap")
    }
}
