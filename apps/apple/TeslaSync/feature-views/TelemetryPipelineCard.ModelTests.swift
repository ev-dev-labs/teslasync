//
//  TelemetryPipelineCard.ModelTests.swift
//  TeslaSync — P4 feature view · 0256 · TelemetryPipelineCard (Apple)
//
//  State-holder coverage for the TelemetryPipelineCard surface: `TelemetryPipelineModel`
//  phase resolution, the cached → row projection (VIN tail / liveness / battery / state),
//  the connectivity + totals tracking, the refresh + navigation delegation, the guarded
//  stale auto-refresh, and the P1/S11 `view.opened` telemetry. Split from `…Tests.swift`
//  (which holds the pure-adapter + accessibility coverage) to keep each file within the
//  lint length budget. The model is driven by `InMemoryTelemetryPipelineSource` — no
//  network, no real store.
//

import XCTest
@testable import TeslaSync

@MainActor
final class TelemetryPipelineModelTests: XCTestCase {
    private func makeModel(
        _ update: TelemetryPipelineUpdate,
        telemetry: TelemetryPipelineTelemetry = OSLogTelemetryPipelineTelemetry(),
        navigator: TelemetryPipelineNavigator = OSLogTelemetryPipelineNavigator()
    ) -> (TelemetryPipelineModel, InMemoryTelemetryPipelineSource) {
        let source = InMemoryTelemetryPipelineSource(initial: update)
        let model = TelemetryPipelineModel(source: source, telemetry: telemetry, navigator: navigator)
        return (model, source)
    }

    private func vehicle(id: Int64 = 1, battery: Double? = 73, agoSeconds: TimeInterval = 60) -> TelemetryVehicleInput {
        TelemetryVehicleInput(
            id: id, displayName: "Daily Driver", vin: "5YJSA1E60JF000ABC", state: "online",
            lastPoll: Date().addingTimeInterval(-agoSeconds), nextPoll: Date().addingTimeInterval(30),
            lastStream: nil, batteryLevel: battery
        )
    }

    func testContentPhaseAndProjection() {
        let (model, _) = makeModel(loaded(vehicles: [vehicle()]))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.vehicleCount, 1)
        XCTAssertEqual(model.rows.count, 1)
        let row = try? XCTUnwrap(model.rows.first)
        XCTAssertEqual(row?.vinTail, "0ABC")
        XCTAssertEqual(row?.level, .sending)
        XCTAssertEqual(row?.batteryPercent, 73)
        XCTAssertEqual(row?.state.fallback, "online")
    }

    func testEmptyPhase() {
        let (model, _) = makeModel(loaded(vehicles: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.vehicleCount, 0)
        XCTAssertTrue(model.rows.isEmpty)
    }

    func testLoadingAndErrorPhases() {
        let (loading, _) = makeModel(TelemetryPipelineUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (failed, _) = makeModel(TelemetryPipelineUpdate(status: .failed("boom")))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
    }

    func testCachedVehiclesStayContentWhileFailing() {
        let (model, source) = makeModel(loaded(vehicles: [vehicle()]))
        model.start()
        source.push(TelemetryPipelineUpdate(status: .failed("net"), vehicles: [vehicle()], totals: model.totals))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.rows.count, 1)
    }

    func testConnectivityAndTotalsTrackUpdates() {
        let (model, source) = makeModel(TelemetryPipelineUpdate(status: .loading))
        model.start()
        source.push(TelemetryPipelineUpdate(
            status: .loaded,
            vehicles: [vehicle()],
            totals: TelemetryFleetTotals(positions: 100, drives: 4, chargingSessions: 2, signalLog: 9000),
            mqttConnected: true,
            pollingEnabled: false,
            connection: .offline,
            updatedAt: Date()
        ))
        XCTAssertTrue(model.mqttConnected)
        XCTAssertFalse(model.pollingEnabled)
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.totals.positions, 100)
        XCTAssertEqual(model.totals.signalLog, 9000)
        XCTAssertNotNil(model.updatedAt)
    }

    func testSummaryReflectsMixedLiveness() {
        let vehicles = [
            vehicle(id: 1, agoSeconds: 60), // sending
            vehicle(id: 2, agoSeconds: 10 * 60), // slow
            vehicle(id: 3, agoSeconds: 60 * 60), // stale
            TelemetryVehicleInput(id: 4, displayName: "Off", vin: "V4") // offline
        ]
        let (model, _) = makeModel(loaded(vehicles: vehicles))
        model.start()
        XCTAssertEqual(model.summary.sending, 1)
        XCTAssertEqual(model.summary.slow, 1)
        XCTAssertEqual(model.summary.stale, 1)
        XCTAssertEqual(model.summary.offline, 1)
    }

    func testRefreshDelegates() {
        let (model, source) = makeModel(loaded(vehicles: [vehicle()]))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testNavigateDelegatesToNavigator() {
        let spy = SpyTelemetryPipelineNavigator()
        let (model, _) = makeModel(loaded(vehicles: [vehicle()]), navigator: spy)
        model.start()
        model.navigate(to: .vehicle(id: 42))
        model.navigate(to: .telemetryCoverage)
        model.navigate(to: .mqttInspector)
        model.navigate(to: .allVehicles)
        model.navigate(to: .teslaAccount)
        XCTAssertEqual(spy.paths, [
            "/vehicles/42", "/admin/telemetry/coverage", "/mqtt-inspector", "/vehicles", "/tesla-account"
        ])
    }

    func testStaleAutoRefreshFiresOncePerEpisode() {
        let (model, source) = makeModel(loaded(vehicles: [vehicle()]))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(loaded(vehicles: [vehicle()], connection: .stale))
        source.push(loaded(vehicles: [vehicle()], connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(loaded(vehicles: [vehicle()], connection: .live))
        source.push(loaded(vehicles: [vehicle()], connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyTelemetryPipelineTelemetry()
        let (model, source) = makeModel(TelemetryPipelineUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [TelemetryPipelineCard.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    private func loaded(
        vehicles: [TelemetryVehicleInput],
        connection: TelemetryPipelineConnection = .live
    ) -> TelemetryPipelineUpdate {
        TelemetryPipelineUpdate(
            status: .loaded,
            vehicles: vehicles,
            totals: TelemetryFleetTotals(positions: 1, drives: 1),
            mqttConnected: true,
            pollingEnabled: true,
            connection: connection,
            updatedAt: Date()
        )
    }
}

// MARK: - Test doubles

private final class SpyTelemetryPipelineTelemetry: TelemetryPipelineTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

private final class SpyTelemetryPipelineNavigator: TelemetryPipelineNavigator, @unchecked Sendable {
    private(set) var paths: [String] = []
    func navigate(to destination: TelemetryPipelineDestination) {
        paths.append(destination.path)
    }
}
