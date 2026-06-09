//
//  TeslaChargingSessionsMap.ModelTests.swift
//  TeslaSync — P4 feature view · 0120 · TeslaChargingSessionsMap (Apple)
//
//  State-holder coverage for the TeslaChargingSessionsMap surface:
//  `TeslaChargingSessionsMapModel` phase resolution across loading / loaded /
//  empty / error (with the cached fall-back), projection wiring, refresh + stop
//  delegation, the P1/S11 `view.opened` telemetry, connection tracking, and the
//  camera-fit branches. Driven by the in-memory source — no network, no real store.
//

import XCTest
@testable import TeslaSync

@MainActor final class TeslaChargingSessionsMapModelTests: XCTestCase {
    private func plottable(_ id: Int) -> TeslaChargingSessionRecord {
        TeslaChargingSessionRecord(
            id: id,
            siteLocationName: "Site \(id)",
            startedAt: Date(timeIntervalSince1970: 0),
            totalEnergyAddedWh: 42500,
            totalCost: 13.6,
            chargerType: "Supercharger",
            latitude: 37.4 + Double(id) * 0.01,
            longitude: -122.0
        )
    }

    private var noCoords: TeslaChargingSessionRecord {
        TeslaChargingSessionRecord(id: 99, siteLocationName: "No GPS", latitude: nil, longitude: nil)
    }

    private func makeModel(
        _ update: TeslaChargingSessionsMapUpdate,
        telemetry: TeslaChargingSessionsMapTelemetry = OSLogTeslaChargingSessionsMapTelemetry()
    ) -> (TeslaChargingSessionsMapModel, InMemoryTeslaChargingSessionsMapSource) {
        let source = InMemoryTeslaChargingSessionsMapSource(initial: update)
        let model = TeslaChargingSessionsMapModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testPhaseResolution() {
        typealias Model = TeslaChargingSessionsMapModel
        XCTAssertEqual(Model.resolvePhase(status: .loading, hasMarkers: false), .loading)
        XCTAssertEqual(Model.resolvePhase(status: .loading, hasMarkers: true), .loaded)
        XCTAssertEqual(Model.resolvePhase(status: .loaded, hasMarkers: true), .loaded)
        XCTAssertEqual(Model.resolvePhase(status: .loaded, hasMarkers: false), .empty)
        XCTAssertEqual(Model.resolvePhase(status: .empty, hasMarkers: false), .empty)
        XCTAssertEqual(Model.resolvePhase(status: .failed("boom"), hasMarkers: false), .error("boom"))
        XCTAssertEqual(Model.resolvePhase(status: .failed("x"), hasMarkers: true), .loaded)
    }

    func testLoadedExposesProjectionMarkers() {
        let (model, _) = makeModel(
            TeslaChargingSessionsMapUpdate(status: .loaded, sessions: [plottable(1), plottable(2)])
        )
        model.start()
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertEqual(model.projection.plottedCount, 2)
        XCTAssertEqual(model.projection.markers.map(\.id), [1, 2])
    }

    func testLoadedWithNoPlottableSessionsIsEmpty() {
        let (model, _) = makeModel(TeslaChargingSessionsMapUpdate(status: .loaded, sessions: [noCoords]))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertFalse(model.projection.hasPlottableMarkers)
    }

    func testEmptyStatusIsEmpty() {
        let (model, _) = makeModel(TeslaChargingSessionsMapUpdate(status: .empty))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.projection.plottedCount, 0)
    }

    func testErrorWithoutCache() {
        let (model, _) = makeModel(TeslaChargingSessionsMapUpdate(status: .failed("net")))
        model.start()
        XCTAssertEqual(model.phase, .error("net"))
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyTeslaChargingSessionsMapTelemetry()
        let (model, source) = makeModel(TeslaChargingSessionsMapUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [TeslaChargingSessionsMapSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshAndStopDelegate() {
        let (model, source) = makeModel(TeslaChargingSessionsMapUpdate(status: .loaded, sessions: [plottable(1)]))
        model.start()
        model.refresh()
        model.refresh()
        model.stop()
        XCTAssertEqual(source.refreshCount, 2)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testCachedMarkersStayVisibleBehindFailure() {
        let (model, source) = makeModel(TeslaChargingSessionsMapUpdate(status: .loaded, sessions: [plottable(1)]))
        model.start()
        XCTAssertEqual(model.phase, .loaded)
        source.push(TeslaChargingSessionsMapUpdate(status: .failed("dropped"), connection: .offline))
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.projection.plottedCount, 1)
    }

    func testLoadedEmptySliceClearsCachedMarkers() {
        let (model, source) = makeModel(TeslaChargingSessionsMapUpdate(status: .loaded, sessions: [plottable(1)]))
        model.start()
        source.push(TeslaChargingSessionsMapUpdate(status: .loaded, sessions: []))
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.projection.plottedCount, 0)
    }

    func testConnectionTracksUpdates() {
        let (model, source) = makeModel(TeslaChargingSessionsMapUpdate(status: .loading))
        model.start()
        source.push(
            TeslaChargingSessionsMapUpdate(status: .loaded, connection: .stale, sessions: [plottable(3)])
        )
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(model.phase, .loaded)
    }

    func testProjectionDrivesTheCameraFitBranch() {
        // The canvas frames the camera from `markerCoordinates` when any session is
        // plottable (fit-to-markers), else falls back to the web `center`. Assert the
        // pure inputs that drive that branch (the camera glue is typechecked in the
        // SDK pass; `TSGeo.boundingRegion` is covered by GeoTests).
        // Truly empty slice → web San Francisco default center, no markers.
        let emptySlice = TeslaChargingSessionsMapProjection.make(sessions: [])
        XCTAssertTrue(emptySlice.markerCoordinates.isEmpty)
        XCTAssertFalse(emptySlice.hasPlottableMarkers)
        XCTAssertEqual(emptySlice.centerLatitude, 37.77, accuracy: 0.0001)
        // A located-but-unplottable session → still no markers (fallback branch).
        let noGps = TeslaChargingSessionsMapProjection.make(sessions: [noCoords])
        XCTAssertFalse(noGps.hasPlottableMarkers)
        // Plottable sessions → fit-to-markers branch.
        let fit = TeslaChargingSessionsMapProjection.make(sessions: [plottable(1), plottable(2)])
        XCTAssertEqual(fit.markerCoordinates.count, 2)
        XCTAssertTrue(fit.hasPlottableMarkers)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the P1/S11 contract can be asserted.
private final class SpyTeslaChargingSessionsMapTelemetry: TeslaChargingSessionsMapTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
