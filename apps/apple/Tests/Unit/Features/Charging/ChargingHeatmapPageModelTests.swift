import XCTest
@testable import TeslaSync

/// State-machine tests for `ChargingHeatmapPageModel` — every data state the page renders
/// (loading / error / ready with populated or empty sessions), plus the vehicle auto-select +
/// reselection, the range-preset selection, and refresh. The pure derivations + formatters live
/// in `ChargingHeatmapDerivationsTests`.
@MainActor
final class ChargingHeatmapPageModelTests: XCTestCase {
    private struct StubError: Error {}

    private actor StubSource: ChargingHeatmapDataSource {
        let vehicles: [ChargingHeatmapVehicle]
        let sessionsByVehicle: [Int64: [ChargingHeatmapSession]]
        let failSessions: Bool
        private(set) var lastVehicleID: Int64?
        private(set) var lastRange: ChargingHeatmapRange?

        init(
            vehicles: [ChargingHeatmapVehicle],
            sessionsByVehicle: [Int64: [ChargingHeatmapSession]] = [:],
            failSessions: Bool = false
        ) {
            self.vehicles = vehicles
            self.sessionsByVehicle = sessionsByVehicle
            self.failSessions = failSessions
        }

        func loadVehicles() async throws -> [ChargingHeatmapVehicle] {
            vehicles
        }

        func loadSessions(vehicleID: Int64, range: ChargingHeatmapRange) async throws -> [ChargingHeatmapSession] {
            lastVehicleID = vehicleID
            lastRange = range
            if failSessions { throw StubError() }
            return sessionsByVehicle[vehicleID] ?? []
        }
    }

    private func vehicle(_ id: Int64, _ name: String) -> ChargingHeatmapVehicle {
        ChargingHeatmapVehicle(id: id, displayName: name, vin: "VIN\(id)")
    }

    private func session(_ id: Int64, at startedAt: String, place: String) -> ChargingHeatmapSession {
        ChargingHeatmapSession(
            id: id,
            startedAt: startedAt,
            endedAt: nil,
            totalEnergyAddedWh: 10_000,
            costDecimal: 5,
            startPlace: place
        )
    }

    private func twoVehicleSource() -> StubSource {
        StubSource(
            vehicles: [vehicle(1, "Alpha"), vehicle(2, "Bravo")],
            sessionsByVehicle: [
                1: [session(1, at: "2026-06-01T14:00:00Z", place: "Home")],
                2: [session(2, at: "2026-06-02T09:00:00Z", place: "Work")]
            ]
        )
    }

    // MARK: Phases

    func testInitialPhaseIsLoading() {
        let model = ChargingHeatmapPageModel(dataSource: twoVehicleSource())
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadResolvesToReady() async {
        let model = ChargingHeatmapPageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.vehicles.count, 2)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertEqual(model.sessions.count, 1)
        XCTAssertTrue(model.hasSessions)
    }

    func testNoVehiclesResolvesToReadyWithNoSessions() async {
        let model = ChargingHeatmapPageModel(dataSource: StubSource(vehicles: []))
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertNil(model.selectedVehicleID)
        XCTAssertFalse(model.hasSessions)
        XCTAssertNil(model.stats)
    }

    func testEmptySessionsAreReadyButHaveNoData() async {
        let source = StubSource(vehicles: [vehicle(1, "Alpha")], sessionsByVehicle: [1: []])
        let model = ChargingHeatmapPageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.hasSessions)
        XCTAssertNil(model.stats)
        XCTAssertFalse(model.grid.hasData)
        XCTAssertTrue(model.locations.isEmpty)
    }

    func testSessionsFailureResolvesToError() async {
        let source = StubSource(vehicles: [vehicle(1, "Alpha")], failSessions: true)
        let model = ChargingHeatmapPageModel(dataSource: source)
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected error phase, got \(model.phase)")
        }
        XCTAssertFalse(model.hasSessions)
    }

    // MARK: Selection + range + refresh

    func testSelectVehicleReloadsSessions() async {
        let model = ChargingHeatmapPageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.sessions.first?.id, 1)
        await model.selectVehicle(2)
        XCTAssertEqual(model.selectedVehicleID, 2)
        XCTAssertEqual(model.sessions.first?.id, 2)
        XCTAssertEqual(model.phase, .ready)
    }

    func testSelectingSameVehicleIsNoOp() async {
        let model = ChargingHeatmapPageModel(dataSource: twoVehicleSource())
        await model.load()
        await model.selectVehicle(1)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertEqual(model.phase, .ready)
    }

    func testSelectRangeReloadsAndStaysReady() async {
        let source = twoVehicleSource()
        let model = ChargingHeatmapPageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.range, .all)
        await model.selectRange(.last30)
        XCTAssertEqual(model.range, .last30)
        XCTAssertEqual(model.phase, .ready)
        let lastRange = await source.lastRange
        XCTAssertEqual(lastRange, .last30)
    }

    func testSelectingSameRangeIsNoOp() async {
        let model = ChargingHeatmapPageModel(dataSource: twoVehicleSource())
        await model.load()
        await model.selectRange(.all)
        XCTAssertEqual(model.range, .all)
        XCTAssertEqual(model.phase, .ready)
    }

    func testRefreshKeepsReady() async {
        let model = ChargingHeatmapPageModel(dataSource: twoVehicleSource())
        await model.load()
        await model.refresh()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.isRefreshing)
    }
}
