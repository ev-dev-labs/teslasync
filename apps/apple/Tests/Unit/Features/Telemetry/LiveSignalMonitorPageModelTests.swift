//
//  LiveSignalMonitorPageModelTests.swift
//  TeslaSync — P4-APPLE · P7 · page:telemetry/LiveSignalMonitor (Apple)
//
//  Pure-logic tests for `LiveSignalMonitorPageModel`: the fleet-load lifecycle
//  (web `useVehicles` → loading / empty / error / success), the live-stream
//  open states (web `useLiveSignalStream` connected / error), and the tail
//  reducer (newest-first insert, 500-row cap, rate + freshness accounting,
//  filter, clear, pause, >2 min staleness). No view is rendered; the model is
//  driven against injected source/stream doubles.
//

import XCTest
@testable import TeslaSync

@MainActor
final class LiveSignalMonitorPageModelTests: XCTestCase {
    // MARK: Doubles

    private final class StubVehicleSource: LiveSignalMonitorVehicleSource, @unchecked Sendable {
        var result: Result<[WorkspaceVehicle], Error>
        private(set) var loadCount = 0

        init(_ result: Result<[WorkspaceVehicle], Error>) { self.result = result }

        func load() async throws -> [WorkspaceVehicle] {
            loadCount += 1
            return try result.get()
        }
    }

    private struct StubStream: LiveSignalStreamProviding {
        var failOpen = false
        var frameEntries: [LiveTailEntry] = []

        func open(vehicleID _: Int64) async throws {
            if failOpen { throw StubError() }
        }

        func frame(tick _: Int, at _: Date) -> [LiveTailEntry] { frameEntries }
    }

    private struct StubError: Error {}

    private func fleet() -> [WorkspaceVehicle] {
        [
            WorkspaceVehicle(id: 1, displayName: "Model 3", vin: "VIN1"),
            WorkspaceVehicle(id: 2, displayName: "Model Y", vin: "VIN2")
        ]
    }

    private func entry(_ name: String, _ value: WorkspaceSignalValue = .number(1)) -> LiveTailEntry {
        LiveTailEntry(id: "\(name)-\(UUID().uuidString)", signal: name, timestamp: Date(), value: value)
    }

    private func makeModel(
        vehicleSource: any LiveSignalMonitorVehicleSource = StubVehicleSource(.success([])),
        stream: any LiveSignalStreamProviding = StubStream(),
        initialVehicleID: Int64 = 0
    ) -> LiveSignalMonitorPageModel {
        LiveSignalMonitorPageModel(
            vehicleSource: vehicleSource,
            stream: stream,
            initialVehicleID: initialVehicleID
        )
    }

    // MARK: Initial state

    func testInitialState() {
        let model = makeModel()
        XCTAssertEqual(model.selectedVehicleID, 0)
        XCTAssertFalse(model.hasVehicle)
        XCTAssertFalse(model.connected)
        XCTAssertEqual(model.vehiclesPhase, .loading)
        XCTAssertEqual(model.livePhase, .empty)
        XCTAssertEqual(model.connectionLabel, LMText.disconnected)
    }

    func testNonPositiveInitialVehicleClamped() {
        XCTAssertEqual(makeModel(initialVehicleID: -5).selectedVehicleID, 0)
    }

    // MARK: Fleet load (web useVehicles)

    func testLoadPopulatesFleetAndDefaultsSelection() async {
        let model = makeModel(vehicleSource: StubVehicleSource(.success(fleet())))
        await model.load()
        model.stopLive()
        XCTAssertEqual(model.vehiclesPhase, .success)
        XCTAssertEqual(model.vehicles.map(\.id), [1, 2])
        XCTAssertEqual(model.selectedVehicleID, 1)
    }

    func testLoadEmptyFleetReportsEmpty() async {
        let model = makeModel(vehicleSource: StubVehicleSource(.success([])))
        await model.load()
        XCTAssertEqual(model.vehiclesPhase, .empty)
        XCTAssertTrue(model.vehicles.isEmpty)
        XCTAssertEqual(model.selectedVehicleID, 0)
    }

    func testLoadFailureReportsError() async {
        let model = makeModel(vehicleSource: StubVehicleSource(.failure(StubError())))
        await model.load()
        guard case .error = model.vehiclesPhase else {
            return XCTFail("expected error phase, got \(model.vehiclesPhase)")
        }
    }

    func testLoadIsIdempotentOnceLoaded() async {
        let source = StubVehicleSource(.success(fleet()))
        let model = makeModel(vehicleSource: source)
        await model.load(); model.stopLive()
        await model.load(); model.stopLive()
        XCTAssertEqual(source.loadCount, 1)
    }

    func testRetryVehiclesReloads() async {
        let source = StubVehicleSource(.success(fleet()))
        let model = makeModel(vehicleSource: source)
        await model.load(); model.stopLive()
        await model.retryVehicles(); model.stopLive()
        XCTAssertEqual(source.loadCount, 2)
    }

    // MARK: Live stream open states (web useLiveSignalStream)

    func testOpenStreamSuccessConnects() async {
        let model = makeModel(stream: StubStream(failOpen: false), initialVehicleID: 1)
        let ok = await model.openStream()
        XCTAssertTrue(ok)
        XCTAssertTrue(model.connected)
        XCTAssertEqual(model.livePhase, .success)
        XCTAssertEqual(model.connectionLabel, LMText.connected)
    }

    func testOpenStreamFailureReportsError() async {
        let model = makeModel(stream: StubStream(failOpen: true), initialVehicleID: 1)
        let ok = await model.openStream()
        XCTAssertFalse(ok)
        XCTAssertFalse(model.connected)
        guard case .error = model.livePhase else {
            return XCTFail("expected error phase, got \(model.livePhase)")
        }
    }

    func testStartLiveWithoutVehicleIsEmpty() {
        let model = makeModel(initialVehicleID: 0)
        model.startLive()
        XCTAssertEqual(model.livePhase, .empty)
        XCTAssertFalse(model.connected)
        XCTAssertNil(model.liveTask)
    }

    // MARK: Tail reducer (web useLiveSignalStream buffer)

    func testIngestNewestFirstWithRateAndBuffer() {
        let model = makeModel()
        let now = Date()
        model.ingest([entry("A", .number(10)), entry("B", .number(20)), entry("C", .number(30))], at: now)
        XCTAssertEqual(model.tailEntries.count, 3)
        XCTAssertEqual(model.tailEntries.first?.signal, "C")
        XCTAssertEqual(model.tailRate, 6)
        XCTAssertEqual(model.lastLiveUpdate, now)
        XCTAssertEqual(model.buffer["A"], [10])
    }

    func testIngestEmptyFrameIsNoOp() {
        let model = makeModel()
        model.ingest([], at: Date())
        XCTAssertTrue(model.tailEntries.isEmpty)
        XCTAssertNil(model.lastLiveUpdate)
    }

    func testIngestCapsAtTailMax() {
        let model = makeModel()
        for index in 0..<(model.tailMax + 120) {
            model.ingest([entry("S\(index)")], at: Date())
        }
        XCTAssertEqual(model.tailEntries.count, model.tailMax)
    }

    func testFilteredEntriesBySignalName() {
        let model = makeModel()
        model.tailEntries = [entry("BatteryLevel"), entry("VehicleSpeed"), entry("BatteryRange")]
        XCTAssertFalse(model.isFiltering)
        model.filter = "battery"
        XCTAssertTrue(model.isFiltering)
        XCTAssertEqual(model.filteredEntries.count, 2)
    }

    func testUniqueSignalCountAndBufferSize() {
        let model = makeModel()
        model.tailEntries = [entry("A"), entry("A"), entry("B")]
        XCTAssertEqual(model.uniqueSignalCount, 2)
        XCTAssertEqual(model.bufferSize, 3)
    }

    func testClearTailResets() {
        let model = makeModel()
        model.tailEntries = [entry("A")]
        model.tailRate = 5
        model.buffer = ["A": [1]]
        model.clearTail()
        XCTAssertTrue(model.tailEntries.isEmpty)
        XCTAssertEqual(model.tailRate, 0)
        XCTAssertTrue(model.buffer.isEmpty)
    }

    func testTogglePauseAndAutoScroll() {
        let model = makeModel()
        XCTAssertFalse(model.tailPaused)
        model.togglePause()
        XCTAssertTrue(model.tailPaused)
        model.setTailPaused(false)
        XCTAssertFalse(model.tailPaused)
        XCTAssertTrue(model.autoScroll)
        model.toggleAutoScroll()
        XCTAssertFalse(model.autoScroll)
    }

    func testEmptyMessageReflectsFilter() {
        let model = makeModel()
        XCTAssertEqual(model.tailEmptyMessage, LMText.waiting)
        model.filter = "x"
        XCTAssertEqual(model.tailEmptyMessage, LMText.noMatch)
    }

    // MARK: Staleness (ADR-013)

    func testStalenessThreshold() {
        let model = makeModel()
        model.connected = true
        model.lastLiveUpdate = Date(timeIntervalSinceNow: -121)
        XCTAssertTrue(model.isLiveStale)
        model.lastLiveUpdate = Date()
        XCTAssertFalse(model.isLiveStale)
        model.connected = false
        model.lastLiveUpdate = Date(timeIntervalSinceNow: -300)
        XCTAssertFalse(model.isLiveStale)
    }

    // MARK: Selection (web VehicleSelect onChange)

    func testSelectVehicleClampsAndClearsScope() {
        let model = makeModel(initialVehicleID: 1)
        model.selectVehicle(0)
        XCTAssertEqual(model.selectedVehicleID, 0)
        XCTAssertEqual(model.livePhase, .empty)
    }

    func testSelectSameVehicleIsNoOp() {
        let model = makeModel(initialVehicleID: 2)
        model.tailEntries = [entry("A")]
        model.selectVehicle(2)
        XCTAssertEqual(model.tailEntries.count, 1)
    }

    // MARK: Value-kind presentation (web SignalEntry.type)

    func testValueTypeLabels() {
        XCTAssertEqual(WorkspaceSignalValue.number(1).typeLabel, "number")
        XCTAssertEqual(WorkspaceSignalValue.text("x").typeLabel, "string")
        XCTAssertEqual(WorkspaceSignalValue.bool(true).typeLabel, "boolean")
        XCTAssertEqual(WorkspaceSignalValue.missing.typeLabel, "—")
    }
}
