//
//  GeofenceWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0053 · GeofenceWidget (Apple)
//
//  Adapter + accessibility coverage for the GeofenceWidget surface: the
//  `GeofenceWidgetProjectionBuilder` parity with the web haversine / inside /
//  currentZone / fmtRadius derivations, and the VoiceOver summary / row label.
//  The state-holder + registry coverage lives in GeofenceWidget.ModelTests.swift.

import CoreLocation
import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (web parity)

@MainActor final class GeofenceWidgetAdapterTests: XCTestCase {
    private let vehicle = GeofenceWidgetVehicleFix(latitude: 37.7749, longitude: -122.4194)

    private func fence(
        id: String,
        name: String? = "Zone",
        radius: Double? = 200,
        lat: Double = 37.7749,
        lon: Double = -122.4194,
        enabled: Bool? = true
    ) -> GeofenceWidgetFenceInput {
        GeofenceWidgetFenceInput(
            id: id,
            name: name,
            radiusMeters: radius,
            latitude: lat,
            longitude: lon,
            enabled: enabled
        )
    }

    func testHaversineMatchesKnownEquatorialDegree() {
        let meters = GeofenceWidgetProjectionBuilder.haversineMeters(0, 0, 0, 1)
        XCTAssertEqual(meters, 111_194.93, accuracy: 1.0)
    }

    func testHaversineIsZeroForIdenticalPoints() {
        let meters = GeofenceWidgetProjectionBuilder.haversineMeters(37.7749, -122.4194, 37.7749, -122.4194)
        XCTAssertEqual(meters, 0, accuracy: 0.0001)
    }

    func testVehicleInsideRadiusIsInside() {
        let projection = GeofenceWidgetProjectionBuilder.build(
            fences: [fence(id: "home", radius: 200)],
            vehicle: vehicle,
            unit: .kilometers
        )
        let home = projection.fences[0]
        XCTAssertTrue(home.inside)
        XCTAssertEqual(home.distanceMeters, 0, accuracy: 0.0001)
        XCTAssertEqual(home.membership, .inside)
        XCTAssertTrue(home.isActive)
    }

    func testVehicleOutsideRadiusIsOutside() {
        let projection = GeofenceWidgetProjectionBuilder.build(
            fences: [fence(id: "far", radius: 150, lat: 37.7920, lon: -122.4030)],
            vehicle: vehicle,
            unit: .kilometers
        )
        let far = projection.fences[0]
        XCTAssertFalse(far.inside)
        XCTAssertGreaterThan(far.distanceMeters, 150)
        XCTAssertEqual(far.membership, .outside)
        XCTAssertFalse(far.isActive)
    }

    func testNoVehicleFixYieldsInfiniteDistanceAndNoCoordinate() {
        let projection = GeofenceWidgetProjectionBuilder.build(
            fences: [fence(id: "home", radius: 5_000_000)],
            vehicle: nil,
            unit: .kilometers
        )
        XCTAssertFalse(projection.hasVehicleCoordinate)
        XCTAssertNil(projection.vehicleCoordinate)
        let home = projection.fences[0]
        XCTAssertEqual(home.distanceMeters, .infinity)
        XCTAssertFalse(home.inside)
    }

    func testNullIslandVehicleHasNoCoordinate() {
        let projection = GeofenceWidgetProjectionBuilder.build(
            fences: [fence(id: "home")],
            vehicle: GeofenceWidgetVehicleFix(latitude: 0, longitude: 0),
            unit: .kilometers
        )
        XCTAssertFalse(projection.hasVehicleCoordinate)
    }

    func testSingleNonZeroComponentCountsAsCoordinate() {
        let projection = GeofenceWidgetProjectionBuilder.build(
            fences: [fence(id: "home")],
            vehicle: GeofenceWidgetVehicleFix(latitude: 0, longitude: -122.4194),
            unit: .kilometers
        )
        XCTAssertTrue(projection.hasVehicleCoordinate)
    }

    func testDefaultsForMissingFields() {
        let projection = GeofenceWidgetProjectionBuilder.build(
            fences: [GeofenceWidgetFenceInput(
                id: "x",
                name: nil,
                radiusMeters: nil,
                latitude: 1,
                longitude: 1,
                enabled: nil
            )],
            vehicle: vehicle,
            unit: .kilometers
        )
        let zone = projection.fences[0]
        XCTAssertEqual(zone.name, "—") // web `g.name ?? '—'`
        XCTAssertEqual(zone.radiusMeters, 0) // web `g.radius ?? 0`
        XCTAssertTrue(zone.enabled) // web `g.enabled ?? true`
    }

    func testDisabledFenceMembershipIsDisabledEvenWhenInside() {
        let projection = GeofenceWidgetProjectionBuilder.build(
            fences: [fence(id: "garage", radius: 500, enabled: false)],
            vehicle: vehicle,
            unit: .kilometers
        )
        let garage = projection.fences[0]
        XCTAssertTrue(garage.inside) // geometrically inside
        XCTAssertEqual(garage.membership, .disabled) // but disabled wins the badge
        XCTAssertFalse(garage.isActive) // not the active zone
    }

    func testCurrentZoneIsFirstInsideAndEnabled() {
        let fences = [
            fence(id: "office", radius: 150, lat: 37.7920, lon: -122.4030, enabled: true), // outside
            fence(id: "garage", radius: 500, enabled: false), // inside but disabled
            fence(id: "home", radius: 200, enabled: true) // inside + enabled
        ]
        let projection = GeofenceWidgetProjectionBuilder.build(fences: fences, vehicle: vehicle, unit: .kilometers)
        XCTAssertEqual(projection.currentZone?.id, "home")
    }

    func testCurrentZoneNilWhenNoneActive() {
        let projection = GeofenceWidgetProjectionBuilder.build(
            fences: [fence(id: "office", radius: 150, lat: 37.7920, lon: -122.4030)],
            vehicle: vehicle,
            unit: .kilometers
        )
        XCTAssertNil(projection.currentZone)
    }

    func testEmptyProjection() {
        let projection = GeofenceWidgetProjectionBuilder.build(fences: [], vehicle: vehicle, unit: .kilometers)
        XCTAssertTrue(projection.isEmpty)
        XCTAssertNil(projection.currentZone)
    }

    func testRadiusTextConvertsAndFormatsPerUnit() {
        XCTAssertEqual(GeofenceWidgetProjectionBuilder.radiusText(meters: 200, unit: .kilometers), "0.2 km")
        XCTAssertEqual(GeofenceWidgetProjectionBuilder.radiusText(meters: 500, unit: .kilometers), "0.5 km")
        XCTAssertEqual(GeofenceWidgetProjectionBuilder.radiusText(meters: 1609.344, unit: .miles), "1.0 mi")
        XCTAssertEqual(GeofenceWidgetProjectionBuilder.radiusText(meters: 1000, unit: .feet), "3280.8 ft")
    }

    func testDistanceUnitFromLabelDefaultsToKilometers() {
        XCTAssertEqual(GeofenceWidgetDistanceUnit.from(label: "mi"), .miles)
        XCTAssertEqual(GeofenceWidgetDistanceUnit.from(label: "ft"), .feet)
        XCTAssertEqual(GeofenceWidgetDistanceUnit.from(label: "km"), .kilometers)
        XCTAssertEqual(GeofenceWidgetDistanceUnit.from(label: nil), .kilometers)
        XCTAssertEqual(GeofenceWidgetDistanceUnit.from(label: "parsecs"), .kilometers)
    }

    func testMapCoordinatesIncludeVehicleAndFences() {
        let projection = GeofenceWidgetProjectionBuilder.build(
            fences: [fence(id: "home"), fence(id: "office", lat: 37.79, lon: -122.40)],
            vehicle: vehicle,
            unit: .kilometers
        )
        XCTAssertEqual(projection.mapCoordinates.count, 3) // 2 fences + vehicle
    }
}

// MARK: - Accessibility content

@MainActor final class GeofenceWidgetAccessibilityTests: XCTestCase {
    private let vehicle = GeofenceWidgetVehicleFix(latitude: 37.7749, longitude: -122.4194)

    private func projection(
        _ fences: [GeofenceWidgetFenceInput],
        unit: GeofenceWidgetDistanceUnit = .kilometers
    ) -> GeofenceWidgetProjection {
        GeofenceWidgetProjectionBuilder.build(fences: fences, vehicle: vehicle, unit: unit)
    }

    func testZoneSummaryAnnouncesActiveZone() {
        let proj = projection([
            GeofenceWidgetFenceInput(
                id: "home",
                name: "Home",
                radiusMeters: 200,
                latitude: 37.7749,
                longitude: -122.4194,
                enabled: true
            )
        ])
        XCTAssertEqual(GeofenceWidgetAccessibility.zoneSummary(proj), "Inside Home")
    }

    func testZoneSummaryAnnouncesNoZoneWhenNoneActive() {
        let proj = projection([
            GeofenceWidgetFenceInput(
                id: "office",
                name: "Office",
                radiusMeters: 150,
                latitude: 37.7920,
                longitude: -122.4030,
                enabled: true
            )
        ])
        XCTAssertEqual(GeofenceWidgetAccessibility.zoneSummary(proj), "No zone")
    }

    func testRowLabelIncludesNameMembershipAndRadius() {
        let proj = projection([
            GeofenceWidgetFenceInput(
                id: "home",
                name: "Home",
                radiusMeters: 200,
                latitude: 37.7749,
                longitude: -122.4194,
                enabled: true
            )
        ])
        let label = GeofenceWidgetAccessibility.rowLabel(proj.fences[0])
        XCTAssertTrue(label.contains("Home"))
        XCTAssertTrue(label.contains("Inside"))
        XCTAssertTrue(label.contains("Radius"))
        XCTAssertTrue(label.contains("0.2 km"))
    }

    func testMembershipLabels() {
        XCTAssertEqual(GeofenceWidgetAccessibility.membershipLabel(.disabled), "Disabled")
        XCTAssertEqual(GeofenceWidgetAccessibility.membershipLabel(.inside), "Inside")
        XCTAssertEqual(GeofenceWidgetAccessibility.membershipLabel(.outside), "Outside")
    }
}
