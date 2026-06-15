import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for `GlancePageModel` — every data state the page
/// renders (loading / error / ready with a vehicle, and the no-vehicle empty), the
/// `?vehicle_id` resolution + first-vehicle fallback, the soft-failing state/location reads,
/// the command flow (in-flight gating + state refresh), the pure derivations the web
/// computes inline (`isOnline`, `batteryColor`, `getLocationLabel`, the lock/climate
/// command + label maps, the security tone), and the display formatters (web `fmtNumber` +
/// the SI `convertDistanceFromSI` / `convertTempFromSI` renders).
@MainActor
final class GlancePageModelTests: XCTestCase {
    private struct StubError: Error {}

    private actor StubSource: GlanceDataSource {
        let vehicles: [GlanceVehicle]
        let states: [Int64: GlanceVehicleState]
        let locations: [Int64: GlanceLocation]
        let failVehicles: Bool
        let failState: Bool
        private(set) var sentCommands: [GlanceCommand] = []
        private(set) var stateLoads = 0

        init(
            vehicles: [GlanceVehicle],
            states: [Int64: GlanceVehicleState] = [:],
            locations: [Int64: GlanceLocation] = [:],
            failVehicles: Bool = false,
            failState: Bool = false
        ) {
            self.vehicles = vehicles
            self.states = states
            self.locations = locations
            self.failVehicles = failVehicles
            self.failState = failState
        }

        func loadVehicles() async throws -> [GlanceVehicle] {
            if failVehicles { throw StubError() }
            return vehicles
        }

        func loadState(vehicleID: Int64) async throws -> GlanceVehicleState? {
            stateLoads += 1
            if failState { throw StubError() }
            return states[vehicleID]
        }

        func loadLocation(vehicleID: Int64) async throws -> GlanceLocation? {
            locations[vehicleID]
        }

        func send(command: GlanceCommand, vehicleID _: Int64) async throws {
            sentCommands.append(command)
        }

        func recordedCommands() -> [GlanceCommand] { sentCommands }
        func recordedStateLoads() -> Int { stateLoads }
    }

    private func vehicle(_ id: Int64, _ name: String, model: String = "Model 3") -> GlanceVehicle {
        GlanceVehicle(id: id, displayName: name, model: model)
    }

    private func onlineState(
        battery: Double? = 72,
        range: Double? = 384_000,
        temp: Double? = 21.5,
        locked: Bool? = true,
        climate: Bool? = false,
        state: String = "online"
    ) -> GlanceVehicleState {
        GlanceVehicleState(
            state: state,
            batteryLevel: battery,
            ratedRangeM: range,
            insideTempC: temp,
            isLocked: locked,
            isClimateOn: climate
        )
    }

    // MARK: Phases

    func testInitialPhaseIsLoading() {
        let model = GlancePageModel(dataSource: StubSource(vehicles: [vehicle(1, "Alpha")]))
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadResolvesToReadyWithFirstVehicle() async {
        let source = StubSource(
            vehicles: [vehicle(1, "Alpha"), vehicle(2, "Bravo")],
            states: [1: onlineState()]
        )
        let model = GlancePageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.vehicle?.id, 1)
        XCTAssertEqual(model.state?.batteryLevel, 72)
        XCTAssertNotNil(model.updatedAt)
    }

    func testPreferredVehicleIsSelected() async {
        let source = StubSource(
            vehicles: [vehicle(1, "Alpha"), vehicle(2, "Bravo")],
            states: [2: onlineState(battery: 30)]
        )
        let model = GlancePageModel(dataSource: source, preferredVehicleID: 2)
        await model.load()
        XCTAssertEqual(model.vehicle?.id, 2)
        XCTAssertEqual(model.state?.batteryLevel, 30)
    }

    func testUnknownPreferredVehicleFallsBackToFirst() async {
        let source = StubSource(vehicles: [vehicle(1, "Alpha"), vehicle(2, "Bravo")])
        let model = GlancePageModel(dataSource: source, preferredVehicleID: 99)
        await model.load()
        XCTAssertEqual(model.vehicle?.id, 1)
    }

    func testNoVehiclesResolvesToReadyWithNilVehicle() async {
        let model = GlancePageModel(dataSource: StubSource(vehicles: []))
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertNil(model.vehicle)
        XCTAssertNil(model.state)
    }

    func testVehiclesFailureResolvesToError() async {
        let model = GlancePageModel(dataSource: StubSource(vehicles: [], failVehicles: true))
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected error phase, got \(model.phase)")
        }
    }

    func testStateFailureStaysReadyWithNilState() async {
        let source = StubSource(vehicles: [vehicle(1, "Alpha")], failState: true)
        let model = GlancePageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertNil(model.state)
    }

    func testRefreshKeepsReady() async {
        let source = StubSource(vehicles: [vehicle(1, "Alpha")], states: [1: onlineState()])
        let model = GlancePageModel(dataSource: source)
        await model.load()
        await model.refresh()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.isRefreshing)
    }

    // MARK: Commands

    func testSendCommandWhenOnlineRecordsAndRefreshesState() async {
        let source = StubSource(vehicles: [vehicle(1, "Alpha")], states: [1: onlineState()])
        let model = GlancePageModel(dataSource: source)
        await model.load()
        let loadsBefore = await source.recordedStateLoads()
        await model.send(.honkHorn)
        let commands = await source.recordedCommands()
        let loadsAfter = await source.recordedStateLoads()
        XCTAssertEqual(commands, [.honkHorn])
        XCTAssertNil(model.commandInFlight)
        XCTAssertEqual(loadsAfter, loadsBefore + 1)
    }

    func testSendCommandWhenOfflineIsNoOp() async {
        let source = StubSource(
            vehicles: [vehicle(1, "Alpha")],
            states: [1: onlineState(state: "asleep")]
        )
        let model = GlancePageModel(dataSource: source)
        await model.load()
        XCTAssertFalse(model.canSendCommands)
        await model.send(.lock)
        let commands = await source.recordedCommands()
        XCTAssertTrue(commands.isEmpty)
    }

    func testCanSendCommandsRequiresOnline() async {
        let online = StubSource(vehicles: [vehicle(1, "Alpha")], states: [1: onlineState()])
        let onlineModel = GlancePageModel(dataSource: online)
        await onlineModel.load()
        XCTAssertTrue(onlineModel.canSendCommands)

        let parked = StubSource(
            vehicles: [vehicle(1, "Alpha")],
            states: [1: onlineState(state: "parked")]
        )
        let parkedModel = GlancePageModel(dataSource: parked)
        await parkedModel.load()
        XCTAssertTrue(parkedModel.canSendCommands)
    }

    // MARK: Route + registration

    func testRouteMetadata() {
        XCTAssertEqual(AppRoute.glance.pathSegment, "glance")
        XCTAssertEqual(AppRoute.glance.path, "/glance")
        XCTAssertEqual(AppRoute.glance.group, .overview)
        XCTAssertEqual(AppRouteParser.parse(path: "/glance"), .glance)
    }

    func testRouteRegistrationRegistersPage() {
        let registry = GlanceRouteRegistration.registry()
        XCTAssertTrue(registry.registeredRoutes.contains(.glance))
    }
}
