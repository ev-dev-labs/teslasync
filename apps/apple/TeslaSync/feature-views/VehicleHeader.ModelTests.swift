//
//  VehicleHeader.ModelTests.swift
//  TeslaSync — P4 feature view · 0301 · VehicleHeader (Apple)
//
//  Lifecycle + binding coverage for `VehicleHeaderModel`: the `view.opened` telemetry
//  (once + idempotent), the start/stop/refresh plumbing to the source, the stale → one
//  -shot auto-refresh transition, the wake + back-navigation intents forwarding to their
//  seams, and the snapshot → resolved/connection application. Driven by the in-memory
//  source + recording action double, with no network.
//

import XCTest
@testable import TeslaSync

private final class CountingVehicleHeaderTelemetry: VehicleHeaderTelemetry, @unchecked Sendable {
    private(set) var opened: [String] = []
    func viewOpened(surface: String) {
        opened.append(surface)
    }
}

@MainActor
final class VehicleHeaderModelTests: XCTestCase {
    func testStartEmitsViewOpenedOnceAndStartsSource() {
        let source = InMemoryVehicleHeaderSource()
        let telemetry = CountingVehicleHeaderTelemetry()
        let model = VehicleHeaderModel(source: source, telemetry: telemetry)

        model.start()
        model.start()

        XCTAssertEqual(telemetry.opened, [VehicleHeaderSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testStopStopsSourceAndAllowsRestart() {
        let source = InMemoryVehicleHeaderSource()
        let telemetry = CountingVehicleHeaderTelemetry()
        let model = VehicleHeaderModel(source: source, telemetry: telemetry)

        model.start()
        model.stop()
        model.start()

        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(source.startCount, 2)
        XCTAssertEqual(telemetry.opened.count, 2)
    }

    func testInitialResolvedIsLoading() {
        let model = VehicleHeaderModel(source: InMemoryVehicleHeaderSource())
        XCTAssertEqual(model.phase, .loading)
    }

    func testApplyUpdatesResolvedAndConnection() {
        let source = InMemoryVehicleHeaderSource()
        let model = VehicleHeaderModel(source: source)
        model.start()

        source.push(VehicleHeaderInput(
            vehicle: VehicleHeaderVehicle(model: "Model 3", trimBadging: "RWD", vin: "VIN1"),
            status: .online,
            connection: .offline
        ))

        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.modelLine, "Model 3 RWD")
        XCTAssertEqual(model.connection, .offline)
    }

    func testStaleTransitionTriggersOneShotRefresh() {
        let source = InMemoryVehicleHeaderSource()
        let model = VehicleHeaderModel(source: source)
        model.start()

        source.push(VehicleHeaderInput(status: .online, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale does not re-trigger the auto-refresh.
        source.push(VehicleHeaderInput(status: .online, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testWakeForwardsToCommandSeam() {
        let source = InMemoryVehicleHeaderSource()
        let actions = RecordingVehicleHeaderActions()
        let model = VehicleHeaderModel(source: source, navigator: actions, wakeCommand: actions)

        model.wake()

        XCTAssertEqual(actions.wakeCount, 1)
    }

    func testGoBackForwardsToNavigatorSeam() {
        let source = InMemoryVehicleHeaderSource()
        let actions = RecordingVehicleHeaderActions()
        let model = VehicleHeaderModel(source: source, navigator: actions, wakeCommand: actions)

        model.goBack()

        XCTAssertEqual(actions.openListCount, 1)
    }

    func testRefreshForwardsToSource() {
        let source = InMemoryVehicleHeaderSource()
        let model = VehicleHeaderModel(source: source)

        model.refresh()

        XCTAssertEqual(source.refreshCount, 1)
    }
}
