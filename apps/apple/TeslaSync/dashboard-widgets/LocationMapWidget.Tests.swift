//
//  LocationMapWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0060 · LocationMapWidget (Apple)
//
//  Unit coverage for the LocationMapWidget surface:
//    • Adapter (cached → projection) — `LocationProjectionBuilder` parity with the
//      web `hasCoords` / heading / `toFixed(4)` derivations in LocationMapWidget.tsx.
//    • State holder — `LocationMapModel` phase resolution across loading / empty /
//      error / content, plus the P1/S11 `view.opened` telemetry + source wiring.
//    • Registry — canonical `location-map` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content for each state.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryLocationMapSource`.
//

import CoreLocation
import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (web parity)

final class LocationMapAdapterTests: XCTestCase {
    func testNilInputProducesEmptyProjection() {
        let projection = LocationProjectionBuilder.build(nil)
        XCTAssertEqual(projection, .none)
        XCTAssertFalse(projection.hasCoordinate)
        XCTAssertNil(projection.heading)
        XCTAssertNil(projection.headingDegrees)
    }

    func testNullIslandIsNotUsable() {
        let projection = LocationProjectionBuilder.build(LocationInput(latitude: 0, longitude: 0, heading: 90))
        XCTAssertFalse(projection.hasCoordinate)
        XCTAssertNil(projection.heading)
    }

    func testSingleZeroComponentMatchesWebHasCoordsGuard() {
        // Web: `latitude !== 0 && longitude !== 0` — either zero ⇒ no coords.
        let zeroLat = LocationProjectionBuilder.build(LocationInput(latitude: 0, longitude: -122.4, heading: nil))
        let zeroLng = LocationProjectionBuilder.build(LocationInput(latitude: 37.7, longitude: 0, heading: nil))
        XCTAssertFalse(zeroLat.hasCoordinate)
        XCTAssertFalse(zeroLng.hasCoordinate)
    }

    func testOutOfRangeCoordinateIsRejected() {
        let projection = LocationProjectionBuilder.build(LocationInput(latitude: 120, longitude: 500, heading: nil))
        XCTAssertFalse(projection.hasCoordinate)
    }

    func testValidCoordinateProjectsThroughUnchanged() {
        let projection = LocationProjectionBuilder.build(
            LocationInput(latitude: 37.7749, longitude: -122.4194, heading: 295)
        )
        XCTAssertTrue(projection.hasCoordinate)
        XCTAssertEqual(projection.coordinate.latitude, 37.7749, accuracy: 0.0001)
        XCTAssertEqual(projection.coordinate.longitude, -122.4194, accuracy: 0.0001)
        XCTAssertEqual(projection.heading ?? -1, 295, accuracy: 0.001)
        XCTAssertEqual(projection.headingDegrees, 295)
    }

    func testHeadingNormalizationWrapsAndDropsNonFinite() {
        XCTAssertEqual(LocationProjectionBuilder.normalizeHeading(450) ?? -1, 90, accuracy: 0.001)
        XCTAssertEqual(LocationProjectionBuilder.normalizeHeading(-90) ?? -1, 270, accuracy: 0.001)
        XCTAssertEqual(LocationProjectionBuilder.normalizeHeading(0) ?? -1, 0, accuracy: 0.001)
        XCTAssertNil(LocationProjectionBuilder.normalizeHeading(nil))
        XCTAssertNil(LocationProjectionBuilder.normalizeHeading(.nan))
        XCTAssertNil(LocationProjectionBuilder.normalizeHeading(.infinity))
    }

    func testHeadingDegreesRoundsAndWrapsExactly360() {
        let projection = LocationProjectionBuilder.build(
            LocationInput(latitude: 37.0, longitude: -122.0, heading: 359.7)
        )
        // 359.7 rounds to 360 which must wrap back to 0 (a compass never reads 360°).
        XCTAssertEqual(projection.headingDegrees, 0)
    }

    func testMissingHeadingLeavesHeadingAbsentButKeepsCoordinate() {
        let projection = LocationProjectionBuilder.build(
            LocationInput(latitude: 51.5074, longitude: -0.1278, heading: nil)
        )
        XCTAssertTrue(projection.hasCoordinate)
        XCTAssertNil(projection.heading)
        XCTAssertNil(projection.headingDegrees)
    }

    func testCoordinateTextFormatsFourDecimalsWithFixedLocale() {
        XCTAssertEqual(LocationProjectionBuilder.coordinateText(37.7749295), "37.7749")
        XCTAssertEqual(LocationProjectionBuilder.coordinateText(-122.4), "-122.4000")
        let projection = LocationProjectionBuilder.build(
            LocationInput(latitude: 37.7749295, longitude: -122.4194155, heading: nil)
        )
        XCTAssertEqual(projection.coordinatesText, "37.7749, -122.4194")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class LocationMapModelTests: XCTestCase {
    private func makeModel(
        _ update: LocationMapUpdate,
        telemetry: LocationMapTelemetry = OSLogLocationMapTelemetry()
    ) -> (LocationMapModel, InMemoryLocationMapSource) {
        let source = InMemoryLocationMapSource(initial: update)
        let model = LocationMapModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private let fix = LocationInput(latitude: 37.7749, longitude: -122.4194, heading: 90)

    func testLoadingWithoutCoordinateShowsLoading() {
        let (model, _) = makeModel(LocationMapUpdate(status: .loading, position: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutCoordinateShowsEmpty() {
        let (model, _) = makeModel(LocationMapUpdate(status: .loaded, position: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(LocationMapUpdate(status: .failed("boom"), position: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testCoordinatePresentShowsContentEvenWhileLoadingOrFailed() {
        let (loading, _) = makeModel(LocationMapUpdate(status: .loading, position: fix))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(LocationMapUpdate(status: .failed("net"), position: fix))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyLocationMapTelemetry()
        let (model, source) = makeModel(LocationMapUpdate(status: .loading, position: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [LocationMapWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(LocationMapUpdate(status: .loaded, position: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStopDelegatesAndAllowsTelemetryToReArm() {
        let spy = SpyLocationMapTelemetry()
        let (model, source) = makeModel(LocationMapUpdate(status: .loaded, position: fix), telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(spy.surfaces.count, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(LocationMapUpdate(status: .loading, position: nil))
        model.start()
        let now = Date()
        source.push(
            LocationMapUpdate(
                status: .loaded,
                connection: .offline,
                vehicle: LocationVehicle(id: 3, displayName: "Cybertruck"),
                position: fix,
                updatedAt: now
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.location.hasCoordinate)
        XCTAssertEqual(model.location.headingDegrees, 90)
        XCTAssertEqual(model.vehicle?.id, 3)
        XCTAssertEqual(model.updatedAt, now)
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(LocationMapModel.resolvePhase(status: .loading, hasCoordinate: false), .loading)
        XCTAssertEqual(LocationMapModel.resolvePhase(status: .loading, hasCoordinate: true), .content)
        XCTAssertEqual(LocationMapModel.resolvePhase(status: .empty, hasCoordinate: false), .empty)
        XCTAssertEqual(LocationMapModel.resolvePhase(status: .loaded, hasCoordinate: false), .empty)
        XCTAssertEqual(LocationMapModel.resolvePhase(status: .loaded, hasCoordinate: true), .content)
        XCTAssertEqual(LocationMapModel.resolvePhase(status: .failed("x"), hasCoordinate: false), .error("x"))
        XCTAssertEqual(LocationMapModel.resolvePhase(status: .failed("x"), hasCoordinate: true), .content)
    }

    func testConnectionIsLiveFlag() {
        XCTAssertTrue(LocationConnection.live.isLive)
        XCTAssertFalse(LocationConnection.stale.isLive)
        XCTAssertFalse(LocationConnection.offline.isLive)
    }
}

// MARK: - Registry parity

final class LocationMapRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = LocationMapWidget.registration
        XCTAssertEqual(registration.id, "location-map")
        XCTAssertEqual(registration.category, "maps")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 4))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testSurfaceSlugIsStable() {
        XCTAssertEqual(LocationMapWidget.surfaceSlug, "LocationMapWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = LocationMapWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 1)), DashboardWidgetSize(cols: 1, rows: 4))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 3, rows: 12)),
            DashboardWidgetSize(cols: 3, rows: 12)
        )
    }
}

// MARK: - Accessibility summary content

final class LocationMapAccessibilityTests: XCTestCase {
    func testSummaryReturnsEmptyCopyWhenNoCoordinate() {
        let summary = LocationMapAccessibility.summary(location: .none, connection: .live)
        XCTAssertEqual(summary, "No location data available")
    }

    func testLiveSummaryIncludesHeadingAndCoordinates() {
        let location = LocationProjectionBuilder.build(
            LocationInput(latitude: 37.7749, longitude: -122.4194, heading: 295)
        )
        let summary = LocationMapAccessibility.summary(location: location, connection: .live)
        XCTAssertTrue(summary.contains("Live"))
        XCTAssertTrue(summary.contains("Heading 295°"))
        XCTAssertTrue(summary.contains("37.7749, -122.4194"))
        XCTAssertFalse(summary.contains("Last known position"))
    }

    func testNotLiveSummaryAnnouncesLastKnownPosition() {
        let location = LocationProjectionBuilder.build(
            LocationInput(latitude: 51.5074, longitude: -0.1278, heading: nil)
        )
        let stale = LocationMapAccessibility.summary(location: location, connection: .stale)
        let offline = LocationMapAccessibility.summary(location: location, connection: .offline)
        XCTAssertTrue(stale.contains("Last known position"))
        XCTAssertTrue(offline.contains("Last known position"))
        // No heading known ⇒ no heading clause.
        XCTAssertFalse(stale.contains("Heading"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyLocationMapTelemetry: LocationMapTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
