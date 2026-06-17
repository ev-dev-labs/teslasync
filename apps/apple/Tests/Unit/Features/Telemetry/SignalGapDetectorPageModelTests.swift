//
//  SignalGapDetectorPageModelTests.swift
//  TeslaSync — P4-APPLE · P7 · page:telemetry/SignalGapDetector (Apple)
//
//  Pure-logic tests for `SignalGapDetectorPageModel`: the empty-vs-catalog scope guard
//  (web `!vehicleId || vehicleId <= 0`), the fleet-load lifecycle that feeds the header
//  `VehicleSelect`, the `selectVehicle` commit + clear, and the bound catalog model lifecycle.
//  No view is rendered; the model is driven against injected source/provider doubles.
//

import XCTest
@testable import TeslaSync

@MainActor
final class SignalGapDetectorPageModelTests: XCTestCase {
    // MARK: Doubles

    private final class StubVehicleSource: SignalGapDetectorVehicleSource {
        var result: Result<[VehicleSelectVehicle], Error>
        private(set) var loadCount = 0

        init(_ result: Result<[VehicleSelectVehicle], Error>) {
            self.result = result
        }

        func load() async throws -> [VehicleSelectVehicle] {
            loadCount += 1
            return try result.get()
        }
    }

    private final class CountingCatalogProvider: SignalGapDetectorCatalogProviding {
        private(set) var madeFor: [Int] = []

        func makeModel(vehicleID: Int) -> SignalCatalogPanelModel {
            madeFor.append(vehicleID)
            return SignalCatalogPanelModel(source: InMemorySignalCatalogPanelSource())
        }
    }

    private struct LoadFailure: Error {}

    private func fleet() -> [VehicleSelectVehicle] {
        [
            VehicleSelectVehicle(id: 1, displayName: "Model 3", vin: "VIN1"),
            VehicleSelectVehicle(id: 2, displayName: "Model Y", vin: "VIN2")
        ]
    }

    // MARK: Initial scope (web global `vehicleId`)

    func testInitiallyNoSelectionShowsEmpty() {
        let model = makeModel()
        XCTAssertNil(model.selectedVehicleID)
        XCTAssertFalse(model.hasSelection)
        XCTAssertNil(model.catalogModel)
        XCTAssertEqual(model.vehiclesPhase, .loading)
    }

    func testInitialPositiveScopeBindsCatalog() {
        let provider = CountingCatalogProvider()
        let model = makeModel(catalogProvider: provider, initialVehicleID: 1)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertTrue(model.hasSelection)
        XCTAssertNotNil(model.catalogModel)
        XCTAssertEqual(provider.madeFor, [1])
    }

    func testNonPositiveInitialScopeIsClamped() {
        XCTAssertNil(makeModel(initialVehicleID: 0).selectedVehicleID)
        XCTAssertNil(makeModel(initialVehicleID: -7).selectedVehicleID)
    }

    // MARK: Fleet load (web `useVehicles`) feeds the picker snapshot

    func testLoadPopulatesFleetAndPushesSnapshot() async {
        let model = makeModel(vehicleSource: StubVehicleSource(.success(fleet())))
        var pushed: VehicleSelectSnapshot?
        model.vehicleSelectSource.onUpdate = { pushed = $0 }
        await model.load()
        XCTAssertEqual(model.vehiclesPhase, .loaded)
        XCTAssertEqual(model.vehicles.map(\.id), [1, 2])
        XCTAssertEqual(pushed?.vehicles.map(\.id), [1, 2])
        XCTAssertFalse(pushed?.isLoading ?? true)
    }

    func testLoadEmptyFleetReportsEmptyPhase() async {
        let model = makeModel(vehicleSource: StubVehicleSource(.success([])))
        await model.load()
        XCTAssertEqual(model.vehiclesPhase, .empty)
        XCTAssertTrue(model.vehicles.isEmpty)
    }

    func testLoadFailureReportsErrorPhase() async {
        let model = makeModel(vehicleSource: StubVehicleSource(.failure(LoadFailure())))
        var pushed: VehicleSelectSnapshot?
        model.vehicleSelectSource.onUpdate = { pushed = $0 }
        await model.load()
        guard case .error = model.vehiclesPhase else {
            return XCTFail("expected error phase, got \(model.vehiclesPhase)")
        }
        XCTAssertNotNil(pushed?.errorMessage)
    }

    func testLoadIsIdempotentOnceLoaded() async {
        let source = StubVehicleSource(.success(fleet()))
        let model = makeModel(vehicleSource: source)
        await model.load()
        await model.load()
        XCTAssertEqual(source.loadCount, 1)
    }

    func testRefreshReloadsFleet() async {
        let source = StubVehicleSource(.success(fleet()))
        let model = makeModel(vehicleSource: source)
        await model.load()
        await model.refresh()
        XCTAssertEqual(source.loadCount, 2)
    }

    // MARK: selectVehicle (web `<VehicleSelect>` onChange → setVehicleId)

    func testSelectVehicleBindsCatalogAndEmitsSelection() {
        let provider = CountingCatalogProvider()
        let model = makeModel(catalogProvider: provider)
        var pushed: VehicleSelectSnapshot?
        model.vehicleSelectSource.onUpdate = { pushed = $0 }

        model.selectVehicle(2)

        XCTAssertEqual(model.selectedVehicleID, 2)
        XCTAssertTrue(model.hasSelection)
        XCTAssertNotNil(model.catalogModel)
        XCTAssertEqual(provider.madeFor, [2])
        XCTAssertEqual(pushed?.selectedId, 2)
    }

    func testSelectVehicleNilClearsScope() {
        let model = makeModel(initialVehicleID: 1)
        XCTAssertNotNil(model.catalogModel)
        model.selectVehicle(nil)
        XCTAssertNil(model.selectedVehicleID)
        XCTAssertFalse(model.hasSelection)
        XCTAssertNil(model.catalogModel)
    }

    func testSelectVehicleNonPositiveClearsScope() {
        let model = makeModel(initialVehicleID: 3)
        model.selectVehicle(0)
        XCTAssertNil(model.selectedVehicleID)
        XCTAssertNil(model.catalogModel)
    }

    func testReselectingSameScopeIsNoOp() {
        let provider = CountingCatalogProvider()
        let model = makeModel(catalogProvider: provider, initialVehicleID: 1)
        let first = model.catalogModel
        model.selectVehicle(1)
        XCTAssertTrue(model.catalogModel === first)
        XCTAssertEqual(provider.madeFor, [1])
    }

    func testSwitchingScopeRebindsCatalog() {
        let provider = CountingCatalogProvider()
        let model = makeModel(catalogProvider: provider, initialVehicleID: 1)
        let first = model.catalogModel
        model.selectVehicle(2)
        XCTAssertFalse(model.catalogModel === first)
        XCTAssertEqual(provider.madeFor, [1, 2])
    }

    // MARK: Factory

    private func makeModel(
        vehicleSource: any SignalGapDetectorVehicleSource = SampleSignalGapDetectorVehicleSource(),
        catalogProvider: any SignalGapDetectorCatalogProviding = SampleSignalGapDetectorCatalogProvider(),
        initialVehicleID: Int? = nil
    ) -> SignalGapDetectorPageModel {
        SignalGapDetectorPageModel(
            vehicleSource: vehicleSource,
            catalogProvider: catalogProvider,
            initialVehicleID: initialVehicleID
        )
    }
}
