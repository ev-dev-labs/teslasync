//
//  TripPlannerMap.ModelTests.swift
//  TeslaSync — P4 feature view · 0178 · TripPlannerMap (Apple)
//
//  State-holder coverage for the TripPlannerMap surface (`TripPlannerMapModel`):
//  phase resolution across loading / loaded / empty / failed, projection wiring
//  (markers + polyline + hasData), the P1/S11 `view.opened` telemetry (exactly once),
//  the stale auto-refresh (exactly once, re-armed on returning to live), offline
//  keeping the cached route, connection tracking, and the retry / stop plumbing.
//  Driven through an in-memory source — no network, no real store.
//

import XCTest
@testable import TeslaSync

@MainActor final class TripPlannerMapModelTests: XCTestCase {
    private let origin = TripPlannerLocation(latitude: 37.77, longitude: -122.41, name: "SF")
    private let destination = TripPlannerLocation(latitude: 34.05, longitude: -118.24, name: "LA")

    private var chargeStops: [TripPlannerChargeStop] {
        [
            TripPlannerChargeStop(
                name: "Harris Ranch",
                location: TripPlannerLocation(latitude: 36.25, longitude: -120.23, name: "Harris Ranch"),
                chargeFromSoc: 18,
                chargeToSoc: 80,
                chargeDurationS: 1800
            )
        ]
    }

    private func makeModel(
        _ update: TripPlannerMapUpdate,
        telemetry: TripPlannerMapTelemetry = SpyTripPlannerMapTelemetry()
    ) -> (TripPlannerMapModel, InMemoryTripPlannerMapSource) {
        let source = InMemoryTripPlannerMapSource(initial: update)
        let model = TripPlannerMapModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func fullPlan(connection: TripPlannerMapConnection = .live) -> TripPlannerMapUpdate {
        TripPlannerMapUpdate(
            status: .loaded,
            origin: origin,
            destination: destination,
            legs: [TripPlannerLeg(from: origin, to: destination)],
            chargeStops: chargeStops,
            connection: connection
        )
    }

    func testPhaseResolution() {
        typealias Model = TripPlannerMapModel
        XCTAssertEqual(Model.resolvePhase(.loading, hasData: false), .loading)
        XCTAssertEqual(Model.resolvePhase(.loading, hasData: true), .loading)
        XCTAssertEqual(Model.resolvePhase(.loaded, hasData: true), .content)
        XCTAssertEqual(Model.resolvePhase(.loaded, hasData: false), .empty)
        XCTAssertEqual(Model.resolvePhase(.failed("boom"), hasData: true), .error("boom"))
        XCTAssertEqual(Model.resolvePhase(.failed("boom"), hasData: false), .error("boom"))
    }

    func testLoadedContentProjectsMarkersPolylineAndHasData() {
        let (model, source) = makeModel(fullPlan())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasData)
        XCTAssertEqual(model.projection.markerCount, 3)
        XCTAssertEqual(model.projection.markers.map(\.id), ["origin", "destination", "stop-0"])
        XCTAssertEqual(model.projection.polyline.count, 2)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedWithNoEndpointsIsEmpty() {
        let (model, _) = makeModel(TripPlannerMapUpdate(status: .loaded))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertFalse(model.projection.hasData)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(TripPlannerMapUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(TripPlannerMapUpdate(status: .failed("timeout")))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyTripPlannerMapTelemetry()
        let (model, source) = makeModel(TripPlannerMapUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [TripPlannerMapSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(TripPlannerMapUpdate(status: .loading))
        model.start()
        source.push(fullPlan(connection: .stale))
        source.push(fullPlan(connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(TripPlannerMapUpdate(status: .loading))
        model.start()
        source.push(fullPlan(connection: .stale))
        source.push(fullPlan(connection: .live))
        source.push(fullPlan(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedRouteWithoutRefresh() {
        let (model, source) = makeModel(TripPlannerMapUpdate(status: .loading))
        model.start()
        source.push(fullPlan(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasData)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testConnectionTracksUpdates() {
        let (model, source) = makeModel(TripPlannerMapUpdate(status: .loading))
        model.start()
        source.push(fullPlan(connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(model.phase, .content)
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(TripPlannerMapUpdate(status: .failed("x")))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopStopsSource() {
        let (model, source) = makeModel(TripPlannerMapUpdate(status: .loading))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }

    func testUpdatedAtIsTracked() {
        let when = Date(timeIntervalSince1970: 1_700_000_000)
        let (model, _) = makeModel(
            TripPlannerMapUpdate(status: .loaded, origin: origin, destination: destination, updatedAt: when)
        )
        model.start()
        XCTAssertEqual(model.updatedAt, when)
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
private final class SpyTripPlannerMapTelemetry: TripPlannerMapTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
