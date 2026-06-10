//
//  VehicleGauges.ModelTests.swift
//  TeslaSync — P4 feature view · 0304 · VehicleGauges (Apple)
//
//  Lifecycle + binding coverage for `VehicleGaugesModel`: the `view.opened` telemetry (once +
//  idempotent), the start/stop/refresh plumbing to the source, the stale → one-shot auto-refresh
//  transition (and its reset once live), and the snapshot → resolved/connection application.
//  Driven by the in-memory source + a counting telemetry double, with no network.
//

import XCTest
@testable import TeslaSync

private final class CountingVehicleGaugesTelemetry: VehicleGaugesTelemetry, @unchecked Sendable {
    private(set) var opened: [String] = []
    func viewOpened(surface: String) {
        opened.append(surface)
    }
}

private func sampleState() -> VehicleGaugesState {
    VehicleGaugesState(batteryLevel: 64, ratedRange: 360_000, speed: 30, isLocked: true)
}

@MainActor
final class VehicleGaugesModelTests: XCTestCase {
    func testStartEmitsViewOpenedOnceAndStartsSource() {
        let source = InMemoryVehicleGaugesSource()
        let telemetry = CountingVehicleGaugesTelemetry()
        let model = VehicleGaugesModel(source: source, telemetry: telemetry)

        model.start()
        model.start()

        XCTAssertEqual(telemetry.opened, [VehicleGaugesSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testStopStopsSourceAndAllowsRestart() {
        let source = InMemoryVehicleGaugesSource()
        let telemetry = CountingVehicleGaugesTelemetry()
        let model = VehicleGaugesModel(source: source, telemetry: telemetry)

        model.start()
        model.stop()
        model.start()

        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(source.startCount, 2)
        XCTAssertEqual(telemetry.opened.count, 2)
    }

    func testInitialResolvedIsLoading() {
        let model = VehicleGaugesModel(source: InMemoryVehicleGaugesSource())
        XCTAssertEqual(model.phase, .loading)
        XCTAssertNil(model.content)
    }

    func testApplyUpdatesResolvedAndConnection() {
        let source = InMemoryVehicleGaugesSource()
        let model = VehicleGaugesModel(source: source)
        model.start()

        source.push(VehicleGaugesInput(state: sampleState(), connection: .offline))

        XCTAssertEqual(model.phase, .data)
        XCTAssertNotNil(model.content)
        XCTAssertEqual(model.content?.gauges.count, 4)
        XCTAssertEqual(model.connection, .offline)
    }

    func testStaleTransitionTriggersOneShotRefresh() {
        let source = InMemoryVehicleGaugesSource()
        let model = VehicleGaugesModel(source: source)
        model.start()

        source.push(VehicleGaugesInput(state: sampleState(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale does not re-trigger the auto-refresh.
        source.push(VehicleGaugesInput(state: sampleState(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshResetsAfterLive() {
        let source = InMemoryVehicleGaugesSource()
        let model = VehicleGaugesModel(source: source)
        model.start()

        source.push(VehicleGaugesInput(state: sampleState(), connection: .stale))
        source.push(VehicleGaugesInput(state: sampleState(), connection: .live))
        source.push(VehicleGaugesInput(state: sampleState(), connection: .stale))

        XCTAssertEqual(source.refreshCount, 2)
    }

    func testRefreshForwardsToSource() {
        let source = InMemoryVehicleGaugesSource()
        let model = VehicleGaugesModel(source: source)

        model.refresh()

        XCTAssertEqual(source.refreshCount, 1)
    }
}
