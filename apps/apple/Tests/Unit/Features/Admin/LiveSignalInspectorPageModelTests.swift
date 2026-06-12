import XCTest
@testable import TeslaSync

/// State-machine + selection tests for `LiveSignalInspectorPageModel` — every vehicles
/// data state the page renders (loading / empty / error / success), the selection flow
/// that vends a per-vehicle `LiveSignalsTableModel` (web `useVehicleLiveSignals` re-key),
/// and the `InspectorVehicle.label` fallback chain (web `display_name || vin || Vehicle N`).
@MainActor final class LiveSignalInspectorPageModelTests: XCTestCase {
    private struct StubVehicleSource: LiveSignalInspectorVehicleSource {
        let vehicles: [InspectorVehicle]
        let fails: Bool

        init(_ vehicles: [InspectorVehicle], fails: Bool = false) {
            self.vehicles = vehicles
            self.fails = fails
        }

        func load() async throws -> [InspectorVehicle] {
            if fails { throw VehicleError() }
            return vehicles
        }
    }

    private struct VehicleError: Error {}

    /// Counts `make(_:)` calls so the rebuild-on-reselect behaviour can be asserted.
    private final class CountingFactory: LiveSignalInspectorLiveSignalsFactory {
        private(set) var madeIDs: [Int64] = []

        func make(vehicleID: Int64) -> LiveSignalsTableModel {
            madeIDs.append(vehicleID)
            return LiveSignalsTableModel(source: InMemoryLiveSignalsTableSource())
        }
    }

    private func sample(_ count: Int) -> [InspectorVehicle] {
        (0 ..< count).map { InspectorVehicle(id: Int64($0 + 1), displayName: "Car \($0 + 1)", vin: "VIN\($0 + 1)") }
    }

    // MARK: - Vehicles data states

    func testInitialStateIsLoading() {
        let model = LiveSignalInspectorPageModel(vehicleSource: StubVehicleSource([]))
        XCTAssertEqual(model.vehiclesState, .loading)
        XCTAssertNil(model.selectedVehicleID)
        XCTAssertNil(model.liveSignals)
        XCTAssertFalse(model.hasSelection)
    }

    func testLoadSuccessPopulatesVehicles() async {
        let vehicles = sample(3)
        let model = LiveSignalInspectorPageModel(vehicleSource: StubVehicleSource(vehicles))
        await model.load()
        XCTAssertEqual(model.vehiclesState, .loaded(vehicles))
        XCTAssertEqual(model.vehicles.count, 3)
        XCTAssertFalse(model.hasSelection)
    }

    func testLoadEmptyYieldsEmptyState() async {
        let model = LiveSignalInspectorPageModel(vehicleSource: StubVehicleSource([]))
        await model.load()
        XCTAssertEqual(model.vehiclesState, .empty)
        XCTAssertTrue(model.vehicles.isEmpty)
    }

    func testLoadFailureYieldsErrorState() async {
        let model = LiveSignalInspectorPageModel(vehicleSource: StubVehicleSource([], fails: true))
        await model.load()
        guard case .error = model.vehiclesState else {
            return XCTFail("expected error state, got \(model.vehiclesState)")
        }
    }

    func testRefreshReloadsVehicles() async {
        let model = LiveSignalInspectorPageModel(vehicleSource: StubVehicleSource(sample(2)))
        await model.refresh()
        XCTAssertEqual(model.vehicles.count, 2)
    }

    // MARK: - Selection → live-signals model (web useVehicleLiveSignals re-key)

    func testSelectVehicleBuildsLiveSignalsModel() async {
        let factory = CountingFactory()
        let model = LiveSignalInspectorPageModel(
            vehicleSource: StubVehicleSource(sample(2)),
            liveSignalsFactory: factory
        )
        await model.load()
        XCTAssertNil(model.liveSignals)

        model.selectVehicle(2)
        XCTAssertEqual(model.selectedVehicleID, 2)
        XCTAssertTrue(model.hasSelection)
        XCTAssertNotNil(model.liveSignals)
        XCTAssertEqual(factory.madeIDs, [2])
    }

    func testReselectingDifferentVehicleRebuildsModel() async {
        let factory = CountingFactory()
        let model = LiveSignalInspectorPageModel(
            vehicleSource: StubVehicleSource(sample(3)),
            liveSignalsFactory: factory
        )
        await model.load()
        model.selectVehicle(1)
        let first = model.liveSignals
        model.selectVehicle(3)
        XCTAssertEqual(factory.madeIDs, [1, 3])
        XCTAssertFalse(first === model.liveSignals)
    }

    func testReselectingSameVehicleIsNoOp() async {
        let factory = CountingFactory()
        let model = LiveSignalInspectorPageModel(
            vehicleSource: StubVehicleSource(sample(2)),
            liveSignalsFactory: factory
        )
        await model.load()
        model.selectVehicle(1)
        let first = model.liveSignals
        model.selectVehicle(1)
        XCTAssertEqual(factory.madeIDs, [1])
        XCTAssertTrue(first === model.liveSignals)
    }

    func testClearingSelectionTearsDownModel() async {
        let factory = CountingFactory()
        let model = LiveSignalInspectorPageModel(
            vehicleSource: StubVehicleSource(sample(2)),
            liveSignalsFactory: factory
        )
        await model.load()
        model.selectVehicle(1)
        XCTAssertNotNil(model.liveSignals)
        model.selectVehicle(nil)
        XCTAssertNil(model.selectedVehicleID)
        XCTAssertNil(model.liveSignals)
        XCTAssertFalse(model.hasSelection)
    }

    // MARK: - InspectorVehicle.label (web display_name || vin || `Vehicle ${id}`)

    func testLabelPrefersDisplayName() {
        XCTAssertEqual(InspectorVehicle(id: 9, displayName: "Roadster", vin: "VIN9").label, "Roadster")
    }

    func testLabelFallsBackToVIN() {
        XCTAssertEqual(InspectorVehicle(id: 9, displayName: nil, vin: "5YJ000").label, "5YJ000")
        XCTAssertEqual(InspectorVehicle(id: 9, displayName: "", vin: "5YJ000").label, "5YJ000")
    }

    func testLabelFallsBackToVehicleID() {
        XCTAssertEqual(InspectorVehicle(id: 42, displayName: nil, vin: nil).label, "Vehicle 42")
        XCTAssertEqual(InspectorVehicle(id: 42, displayName: "", vin: "").label, "Vehicle 42")
    }

    // MARK: - Sample sources (page / preview defaults)

    func testSampleVehicleSourceIsNonEmptyAndWellFormed() async throws {
        let vehicles = try await SampleLiveSignalInspectorVehicleSource().load()
        XCTAssertFalse(vehicles.isEmpty)
        XCTAssertEqual(Set(vehicles.map(\.id)).count, vehicles.count, "vehicle ids are unique")
        XCTAssertTrue(vehicles.allSatisfy { !$0.label.isEmpty })
    }

    func testSampleLiveSignalsFactoryProducesEntries() {
        let entries = SampleLiveSignalInspectorLiveSignalsFactory.entries(for: 1)
        XCTAssertFalse(entries.isEmpty)
        XCTAssertEqual(Set(entries.map(\.name)).count, entries.count, "signal names are unique")
    }
}
