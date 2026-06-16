import XCTest
@testable import TeslaSync

/// State-machine + wiring tests for the Trip Planner surface — every data state the page renders
/// (idle / planning / loaded success / failed error), the plan-gating (`canPlan`), the vehicle
/// selection + first-vehicle default, the `Send to Car` resolved-destination wiring, the unit mirror,
/// and the route registration.
@MainActor
final class TripPlannerPageModelTests: XCTestCase {
    private struct StubError: Error {}

    private final class StubSource: TripPlannerDataSource, @unchecked Sendable {
        var vehicles: [TripPlannerVehicle]
        var failPlan = false
        private(set) var planRequests: [TripPlanRequest] = []
        private(set) var sentVehicleID: Int64?
        private(set) var sentDestination: TripLocation?

        init(vehicles: [TripPlannerVehicle]) {
            self.vehicles = vehicles
        }

        func loadVehicles() async throws -> [TripPlannerVehicle] {
            vehicles
        }

        func planTrip(_ request: TripPlanRequest) async throws -> TripPlan {
            planRequests.append(request)
            if failPlan { throw StubError() }
            return SampleTripPlannerDataSource.plan(for: request)
        }

        func sendToCar(vehicleID: Int64, destination: TripLocation) async throws {
            sentVehicleID = vehicleID
            sentDestination = destination
        }
    }

    private func vehicles() -> [TripPlannerVehicle] {
        [
            TripPlannerVehicle(id: 1, displayName: "Rocinante", vin: "VIN1", batteryLevel: 74),
            TripPlannerVehicle(id: 2, displayName: "Tachi", vin: "VIN2", batteryLevel: nil)
        ]
    }

    // MARK: Loading + selection

    func testInitialPhaseIsIdle() {
        let model = TripPlannerPageModel(dataSource: StubSource(vehicles: []))
        XCTAssertEqual(model.planPhase, .idle)
        XCTAssertNil(model.plan)
        XCTAssertFalse(model.isPlanning)
    }

    func testLoadSelectsFirstVehicle() async {
        let model = TripPlannerPageModel(dataSource: StubSource(vehicles: vehicles()))
        await model.load()
        XCTAssertEqual(model.vehicles.count, 2)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertEqual(model.selectedVehicle?.batteryLevel, 74)
    }

    func testSelectVehicle() async {
        let model = TripPlannerPageModel(dataSource: StubSource(vehicles: vehicles()))
        await model.load()
        model.selectVehicle(2)
        XCTAssertEqual(model.selectedVehicleID, 2)
        // Unknown ids are ignored.
        model.selectVehicle(99)
        XCTAssertEqual(model.selectedVehicleID, 2)
    }

    // MARK: Plan gating (web `canPlan`)

    func testCanPlanRequiresOriginDestinationAndVehicle() async {
        let model = TripPlannerPageModel(dataSource: StubSource(vehicles: vehicles()))
        XCTAssertFalse(model.canPlan)
        model.originText = "San Francisco"
        XCTAssertFalse(model.canPlan)
        model.destText = "  "
        XCTAssertFalse(model.canPlan, "whitespace-only destination must not enable planning")
        model.destText = "Los Angeles"
        XCTAssertFalse(model.canPlan, "no vehicle selected yet")
        await model.load()
        XCTAssertTrue(model.canPlan)
    }

    // MARK: Plan mutation states

    func testPlanTripSuccess() async {
        let source = StubSource(vehicles: vehicles())
        let model = TripPlannerPageModel(dataSource: source)
        await model.load()
        model.originText = "San Francisco"
        model.destText = "Los Angeles"
        model.speedOption = .brisk
        await model.planTrip()

        guard case let .loaded(plan) = model.planPhase else {
            return XCTFail("expected loaded phase, got \(model.planPhase)")
        }
        XCTAssertEqual(model.plan?.route.totalDistanceM, plan.route.totalDistanceM)
        XCTAssertEqual(source.planRequests.count, 1)
        // Form state flows into the request (vehicle, SOC, speed factor).
        let request = source.planRequests[0]
        XCTAssertEqual(request.vehicleID, 1)
        XCTAssertEqual(request.speedFactor, 1.1, accuracy: 0.0001)
        XCTAssertEqual(request.chargeLimitSoc, 90, accuracy: 0.0001)
        XCTAssertEqual(request.destination.name, "Los Angeles")
    }

    func testPlanTripFailureSurfacesError() async {
        let source = StubSource(vehicles: vehicles())
        source.failPlan = true
        let model = TripPlannerPageModel(dataSource: source)
        await model.load()
        model.originText = "A"
        model.destText = "B"
        await model.planTrip()
        guard case .failed = model.planPhase else {
            return XCTFail("expected failed phase, got \(model.planPhase)")
        }
        XCTAssertNil(model.plan)
    }

    func testPlanTripIgnoredWhenCannotPlan() async {
        let source = StubSource(vehicles: vehicles())
        let model = TripPlannerPageModel(dataSource: source)
        await model.load()
        // Missing destination → no mutation runs.
        model.originText = "Only origin"
        await model.planTrip()
        XCTAssertEqual(model.planPhase, .idle)
        XCTAssertTrue(source.planRequests.isEmpty)
    }

    func testRetryReplaysPlan() async {
        let source = StubSource(vehicles: vehicles())
        source.failPlan = true
        let model = TripPlannerPageModel(dataSource: source)
        await model.load()
        model.originText = "A"
        model.destText = "B"
        await model.planTrip()
        guard case .failed = model.planPhase else { return XCTFail("expected failed") }

        source.failPlan = false
        await model.retry()
        guard case .loaded = model.planPhase else { return XCTFail("expected loaded after retry") }
        XCTAssertEqual(source.planRequests.count, 2)
    }

    // MARK: Send to car (web `handleSendToCar`)

    func testSendToCarUsesResolvedDestination() async {
        let source = StubSource(vehicles: vehicles())
        let model = TripPlannerPageModel(dataSource: source)
        await model.load()
        model.originText = "San Francisco"
        model.destText = "Reno"
        await model.planTrip()
        await model.sendToCar()
        XCTAssertEqual(source.sentVehicleID, 1)
        XCTAssertEqual(source.sentDestination?.name, "Reno")
    }

    func testSendToCarNoOpWithoutPlan() async {
        let source = StubSource(vehicles: vehicles())
        let model = TripPlannerPageModel(dataSource: source)
        await model.load()
        await model.sendToCar()
        XCTAssertNil(source.sentDestination)
    }

    // MARK: Units

    func testSetUnitsMirrorsPreference() {
        let model = TripPlannerPageModel(dataSource: StubSource(vehicles: []))
        model.setUnits(.imperial)
        XCTAssertEqual(model.units.distance, "mi")
    }

    // MARK: Route registration

    func testRouteRegistrationBuildsPage() {
        let registry = TripPlannerRouteRegistration.registry(dataSource: StubSource(vehicles: vehicles()))
        XCTAssertNotNil(registry.view(for: .tripPlanner))
    }
}
