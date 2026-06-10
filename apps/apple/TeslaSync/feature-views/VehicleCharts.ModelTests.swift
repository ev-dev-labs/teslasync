//
//  VehicleCharts.ModelTests.swift
//  TeslaSync — P4 feature view · 0303 · VehicleCharts (Apple)
//
//  State-holder coverage for the VehicleCharts surface: `VehicleChartsModel` phase
//  resolution across loading / loaded / empty / error (with the cached fall-back),
//  projection wiring, refresh + stop delegation, the P1/S11 `view.opened`
//  telemetry, connection tracking, and the injected units seam. Driven by the
//  in-memory source — no network, no real store.
//

import XCTest
@testable import TeslaSync

@MainActor final class VehicleChartsModelTests: XCTestCase {
    private func located(_ lat: Double = 37.4) -> VehicleChartsData {
        VehicleChartsData(
            state: VehicleChartsStateRecord(latitude: lat, longitude: -122.0),
            positions: [
                VehicleChartsPositionRecord(
                    id: 1,
                    timestamp: Date(timeIntervalSince1970: 100),
                    latitude: lat,
                    longitude: -122.0,
                    speedMps: 12
                )
            ],
            config: VehicleChartsConfig(carType: "Model Y"),
            preferences: VehicleChartsPreferences(settingDistanceUnit: "DistanceUnitMiles")
        )
    }

    private func makeModel(
        _ update: VehicleChartsUpdate,
        telemetry: VehicleChartsTelemetry = OSLogVehicleChartsTelemetry(),
        units: VehicleChartsUnits = DefaultVehicleChartsUnits()
    ) -> (VehicleChartsModel, InMemoryVehicleChartsSource) {
        let source = InMemoryVehicleChartsSource(initial: update)
        let model = VehicleChartsModel(source: source, telemetry: telemetry, units: units)
        return (model, source)
    }

    func testPhaseResolution() {
        typealias Model = VehicleChartsModel
        XCTAssertEqual(Model.resolvePhase(status: .loading, hasContent: false), .loading)
        XCTAssertEqual(Model.resolvePhase(status: .loading, hasContent: true), .loaded)
        XCTAssertEqual(Model.resolvePhase(status: .loaded, hasContent: true), .loaded)
        XCTAssertEqual(Model.resolvePhase(status: .loaded, hasContent: false), .empty)
        XCTAssertEqual(Model.resolvePhase(status: .empty, hasContent: false), .empty)
        XCTAssertEqual(Model.resolvePhase(status: .failed("boom"), hasContent: false), .error("boom"))
        XCTAssertEqual(Model.resolvePhase(status: .failed("x"), hasContent: true), .loaded)
    }

    func testLoadedExposesProjection() {
        let (model, _) = makeModel(VehicleChartsUpdate(status: .loaded, data: located()))
        model.start()
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertTrue(model.projection.hasMap)
        XCTAssertTrue(model.projection.hasConfig)
        XCTAssertTrue(model.projection.hasPreferences)
        XCTAssertTrue(model.projection.hasSpeedData)
    }

    func testLoadedWithNoContentIsEmpty() {
        let (model, _) = makeModel(VehicleChartsUpdate(status: .loaded, data: .empty))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertFalse(model.projection.hasAnyContent)
    }

    func testEmptyStatusIsEmpty() {
        let (model, _) = makeModel(VehicleChartsUpdate(status: .empty))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testErrorWithoutCache() {
        let (model, _) = makeModel(VehicleChartsUpdate(status: .failed("net")))
        model.start()
        XCTAssertEqual(model.phase, .error("net"))
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyVehicleChartsTelemetry()
        let (model, source) = makeModel(VehicleChartsUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [VehicleChartsSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshAndStopDelegate() {
        let (model, source) = makeModel(VehicleChartsUpdate(status: .loaded, data: located()))
        model.start()
        model.refresh()
        model.refresh()
        model.stop()
        XCTAssertEqual(source.refreshCount, 2)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testCachedContentStaysVisibleBehindFailure() {
        let (model, source) = makeModel(VehicleChartsUpdate(status: .loaded, data: located()))
        model.start()
        XCTAssertEqual(model.phase, .loaded)
        source.push(VehicleChartsUpdate(status: .failed("dropped"), connection: .offline))
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.projection.hasMap)
    }

    func testLoadedEmptySliceClearsCachedContent() {
        let (model, source) = makeModel(VehicleChartsUpdate(status: .loaded, data: located()))
        model.start()
        source.push(VehicleChartsUpdate(status: .loaded, data: .empty))
        XCTAssertEqual(model.phase, .empty)
        XCTAssertFalse(model.projection.hasAnyContent)
    }

    func testConnectionTracksUpdates() {
        let (model, source) = makeModel(VehicleChartsUpdate(status: .loading))
        model.start()
        source.push(VehicleChartsUpdate(status: .loaded, connection: .stale, data: located()))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(model.phase, .loaded)
    }

    func testInjectedUnitsAreHonored() {
        let (model, _) = makeModel(
            VehicleChartsUpdate(status: .loaded, data: located()),
            units: DefaultVehicleChartsUnits(speed: .kmh)
        )
        model.start()
        XCTAssertEqual(model.units.speedUnitLabel, "km/h")
        XCTAssertEqual(model.units.convertSpeedFromSI(10), 36.0, accuracy: 0.0001)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the P1/S11 contract can be asserted.
private final class SpyVehicleChartsTelemetry: VehicleChartsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
