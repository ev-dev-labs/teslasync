//
//  GeofenceWidget.ModelTests.swift
//  TeslaSync — P4 dashboard widget · 0053 · GeofenceWidget (Apple)
//
//  State-holder + registry coverage for the GeofenceWidget surface:
//  `GeofenceWidgetModel` phase resolution across loading / empty / error /
//  content, the P1/S11 `view.opened` telemetry + source wiring, and the
//  canonical `geofence-status` registry metadata + size clamping. Driven by
//  `InMemoryGeofenceWidgetSource` — no network, no real store.

import CoreLocation
import XCTest
@testable import TeslaSync

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class GeofenceWidgetModelTests: XCTestCase {
    private let vehicle = GeofenceWidgetVehicleFix(latitude: 37.7749, longitude: -122.4194)
    private let fences = [
        GeofenceWidgetFenceInput(
            id: "home",
            name: "Home",
            radiusMeters: 200,
            latitude: 37.7749,
            longitude: -122.4194,
            enabled: true
        )
    ]

    private func makeModel(
        _ update: GeofenceWidgetUpdate,
        telemetry: GeofenceWidgetTelemetry = OSLogGeofenceWidgetTelemetry()
    ) -> (GeofenceWidgetModel, InMemoryGeofenceWidgetSource) {
        let source = InMemoryGeofenceWidgetSource(initial: update)
        let model = GeofenceWidgetModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutFencesShowsLoading() {
        let (model, _) = makeModel(GeofenceWidgetUpdate(status: .loading, fences: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutFencesShowsEmpty() {
        let (model, _) = makeModel(GeofenceWidgetUpdate(status: .loaded, fences: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(GeofenceWidgetUpdate(status: .failed("boom"), fences: []))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testFencesPresentShowContentEvenWhileLoadingOrFailed() {
        let (loading, _) = makeModel(GeofenceWidgetUpdate(status: .loading, fences: fences, vehicle: vehicle))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(GeofenceWidgetUpdate(status: .failed("net"), fences: fences, vehicle: vehicle))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyGeofenceWidgetTelemetry()
        let (model, source) = makeModel(GeofenceWidgetUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [GeofenceWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(GeofenceWidgetUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStopDelegatesAndAllowsTelemetryToReArm() {
        let spy = SpyGeofenceWidgetTelemetry()
        let (model, source) = makeModel(
            GeofenceWidgetUpdate(status: .loaded, fences: fences, vehicle: vehicle),
            telemetry: spy
        )
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(spy.surfaces.count, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(GeofenceWidgetUpdate(status: .loading, fences: []))
        model.start()
        let now = Date()
        source.push(
            GeofenceWidgetUpdate(
                status: .loaded,
                connection: .offline,
                fences: fences,
                vehicle: vehicle,
                distanceUnit: .miles,
                updatedAt: now
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertFalse(model.projection.isEmpty)
        XCTAssertEqual(model.projection.currentZone?.id, "home")
        XCTAssertEqual(model.updatedAt, now)
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(GeofenceWidgetModel.resolvePhase(status: .loading, hasFences: false), .loading)
        XCTAssertEqual(GeofenceWidgetModel.resolvePhase(status: .loading, hasFences: true), .content)
        XCTAssertEqual(GeofenceWidgetModel.resolvePhase(status: .empty, hasFences: false), .empty)
        XCTAssertEqual(GeofenceWidgetModel.resolvePhase(status: .loaded, hasFences: false), .empty)
        XCTAssertEqual(GeofenceWidgetModel.resolvePhase(status: .loaded, hasFences: true), .content)
        XCTAssertEqual(GeofenceWidgetModel.resolvePhase(status: .failed("x"), hasFences: false), .error("x"))
        XCTAssertEqual(GeofenceWidgetModel.resolvePhase(status: .failed("x"), hasFences: true), .content)
    }

    func testConnectionIsLiveFlag() {
        XCTAssertTrue(GeofenceWidgetConnection.live.isLive)
        XCTAssertFalse(GeofenceWidgetConnection.stale.isLive)
        XCTAssertFalse(GeofenceWidgetConnection.offline.isLive)
    }
}

// MARK: - Registry parity

@MainActor final class GeofenceWidgetRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = GeofenceWidget.registration
        XCTAssertEqual(registration.id, "geofence-status")
        XCTAssertEqual(registration.category, "maps")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testSurfaceSlugIsStable() {
        XCTAssertEqual(GeofenceWidget.surfaceSlug, "GeofenceWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = GeofenceWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 1)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 4)),
            DashboardWidgetSize(cols: 2, rows: 4)
        )
    }
}

// MARK: - Test doubles

private final class SpyGeofenceWidgetTelemetry: GeofenceWidgetTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
