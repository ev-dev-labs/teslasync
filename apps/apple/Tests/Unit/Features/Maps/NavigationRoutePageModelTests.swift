import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for the Navigation & Route surface — every data state the page
/// renders (loading / empty / error / ready), the vehicle reselection, and the panel/chart derivations
/// (web `hasActiveRoute` / `hasValidLocation` / `buildWaypoints` / `avgSpeed` / `recentDestinations` /
/// `presenceChartData`).
@MainActor
final class NavigationRoutePageModelTests: XCTestCase {
    private struct StubError: Error {}

    private struct StubSource: NavigationRouteDataSource {
        var vehicles: [NavVehicle]
        var latestByVehicle: [Int64: NavSnapshot] = [:]
        var historyByVehicle: [Int64: [NavSnapshot]] = [:]
        var telemetryByVehicle: [Int64: NavChargingTelemetry] = [:]
        var failVehicles = false
        var failLatest = false
        var failHistory = false

        func loadVehicles() async throws -> [NavVehicle] {
            if failVehicles { throw StubError() }
            return vehicles
        }

        func loadLatest(vehicleID: Int64) async throws -> NavSnapshot? {
            if failLatest { throw StubError() }
            return latestByVehicle[vehicleID]
        }

        func loadHistory(vehicleID: Int64) async throws -> [NavSnapshot] {
            if failHistory { throw StubError() }
            return historyByVehicle[vehicleID] ?? []
        }

        func useChargingTelemetryLatest(vehicleID: Int64) async throws -> NavChargingTelemetry? {
            telemetryByVehicle[vehicleID]
        }
    }

    private let reference = Date(timeIntervalSince1970: 1_700_000_000)

    private func vehicle(_ id: Int64, _ name: String) -> NavVehicle {
        NavVehicle(id: id, vin: "VIN\(id)", displayName: name)
    }

    private func snapshot(
        id: Int64,
        lat: Double? = nil,
        lon: Double? = nil,
        heading: Double? = nil,
        speedMps: Double? = nil,
        destination: String? = nil,
        distanceM: Double? = nil,
        minutes: Double? = nil,
        delayS: Double? = nil,
        home: Bool? = nil,
        work: Bool? = nil,
        homelink: Bool? = nil,
        ageSeconds: Double = 0
    ) -> NavSnapshot {
        NavSnapshot(
            id: id,
            latitude: lat,
            longitude: lon,
            heading: heading,
            gpsState: "gpsValid",
            speedMps: speedMps,
            destinationName: destination,
            distanceToArrivalM: distanceM,
            minutesToArrival: minutes,
            routeTrafficDelayS: delayS,
            routeLastUpdated: reference,
            locatedAtHome: home,
            locatedAtWork: work,
            homelinkNearby: homelink,
            createdAt: reference.addingTimeInterval(-ageSeconds)
        )
    }

    private func makeModel(_ source: StubSource) -> NavigationRoutePageModel {
        NavigationRoutePageModel(dataSource: source, referenceDate: reference)
    }

    // MARK: - Phases

    func testInitialPhaseIsLoading() {
        let model = makeModel(StubSource(vehicles: []))
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadWithVehiclesReachesReady() async {
        var source = StubSource(vehicles: [vehicle(1, "Rocinante")])
        source.latestByVehicle[1] = snapshot(id: 1, lat: 37.7, lon: -122.4, destination: "Office")
        let model = makeModel(source)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.selectedVehicleID, 1)
    }

    func testLoadWithNoVehiclesIsEmpty() async {
        let model = makeModel(StubSource(vehicles: []))
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.selectedVehicleID)
    }

    func testFailingVehiclesIsError() async {
        var source = StubSource(vehicles: [])
        source.failVehicles = true
        let model = makeModel(source)
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected error phase")
        }
    }

    // MARK: - Derivations

    func testHasActiveRouteFollowsDestination() async {
        var source = StubSource(vehicles: [vehicle(1, "A"), vehicle(2, "B")])
        source.latestByVehicle[1] = snapshot(id: 1, destination: "Sand Hill Rd")
        source.latestByVehicle[2] = snapshot(id: 2, destination: nil)
        let model = makeModel(source)
        await model.load()
        XCTAssertTrue(model.hasActiveRoute)
        await model.selectVehicle(2)
        XCTAssertFalse(model.hasActiveRoute)
    }

    func testHasValidLocationRejectsZeroCoordinates() async {
        var source = StubSource(vehicles: [vehicle(1, "A")])
        source.latestByVehicle[1] = snapshot(id: 1, lat: 0, lon: 0)
        let model = makeModel(source)
        await model.load()
        XCTAssertFalse(model.hasValidLocation)
    }

    func testWaypointsBuiltFromActiveRoute() async {
        var source = StubSource(vehicles: [vehicle(1, "A")])
        source.latestByVehicle[1] = snapshot(id: 1, destination: "Office", distanceM: 12000)
        let model = makeModel(source)
        await model.load()
        XCTAssertEqual(model.waypoints.count, 1)
        XCTAssertEqual(model.waypoints.first?.name, "Office")
        XCTAssertEqual(model.waypoints.first?.distanceM, 12000)
        XCTAssertEqual(model.waypoints.first?.kind, .destination)
    }

    func testWaypointsEmptyWithoutDestination() async {
        var source = StubSource(vehicles: [vehicle(1, "A")])
        source.latestByVehicle[1] = snapshot(id: 1, destination: nil)
        let model = makeModel(source)
        await model.load()
        XCTAssertTrue(model.waypoints.isEmpty)
    }

    func testAverageSpeedIgnoresZeroAndNil() async {
        var source = StubSource(vehicles: [vehicle(1, "A")])
        source.latestByVehicle[1] = snapshot(id: 1)
        source.historyByVehicle[1] = [
            snapshot(id: 10, speedMps: 10),
            snapshot(id: 11, speedMps: 0),
            snapshot(id: 12, speedMps: nil),
            snapshot(id: 13, speedMps: 30)
        ]
        let model = makeModel(source)
        await model.load()
        XCTAssertEqual(model.averageSpeedMps, 20, accuracy: 0.0001)
    }

    func testAverageSpeedZeroWhenNoPositiveSpeeds() async {
        var source = StubSource(vehicles: [vehicle(1, "A")])
        source.historyByVehicle[1] = [snapshot(id: 10, speedMps: 0)]
        let model = makeModel(source)
        await model.load()
        XCTAssertEqual(model.averageSpeedMps, 0)
    }

    func testRecentDestinationsAreUniqueAndCapped() async {
        var source = StubSource(vehicles: [vehicle(1, "A")])
        var snaps: [NavSnapshot] = []
        for index in 0 ..< 30 {
            snaps.append(snapshot(id: Int64(100 + index), destination: "Dest-\(index)"))
        }
        // Two duplicates that must collapse to one entry.
        snaps.append(snapshot(id: 999, destination: "Dest-0"))
        source.historyByVehicle[1] = snaps
        let model = makeModel(source)
        await model.load()
        XCTAssertEqual(model.recentDestinations.count, 20)
        XCTAssertEqual(Set(model.recentDestinations.map(\.destination)).count, 20)
    }

    func testRecentDestinationsSkipNilNames() async {
        var source = StubSource(vehicles: [vehicle(1, "A")])
        source.historyByVehicle[1] = [
            snapshot(id: 10, destination: nil),
            snapshot(id: 11, destination: "Office"),
            snapshot(id: 12, destination: nil)
        ]
        let model = makeModel(source)
        await model.load()
        XCTAssertEqual(model.recentDestinations.map(\.destination), ["Office"])
    }

    func testPresenceSamplesSortedAscending() async {
        var source = StubSource(vehicles: [vehicle(1, "A")])
        source.historyByVehicle[1] = [
            snapshot(id: 10, home: true, ageSeconds: 0),
            snapshot(id: 11, work: true, ageSeconds: 600),
            snapshot(id: 12, homelink: true, ageSeconds: 300)
        ]
        let model = makeModel(source)
        await model.load()
        let times = model.presenceSamples.map(\.time)
        XCTAssertEqual(times, times.sorted())
        XCTAssertEqual(model.presenceSamples.count, 3)
    }

    func testAnyErrorMessageSurfacesFeedFailure() async {
        var source = StubSource(vehicles: [vehicle(1, "A")])
        source.failHistory = true
        let model = makeModel(source)
        await model.load()
        XCTAssertNotNil(model.anyErrorMessage)
        // Page still reaches ready (vehicles loaded) — the banner shows inline.
        XCTAssertEqual(model.phase, .ready)
    }

    func testChargingTelemetryBound() async {
        var source = StubSource(vehicles: [vehicle(1, "A")])
        source.telemetryByVehicle[1] = NavChargingTelemetry(expectedEnergyPctAtArrival: 62)
        let model = makeModel(source)
        await model.load()
        XCTAssertEqual(model.chargingTelemetry?.expectedEnergyPctAtArrival, 62)
    }

    // MARK: - Selection + freshness

    func testSelectVehicleReloadsSnapshots() async {
        var source = StubSource(vehicles: [vehicle(1, "A"), vehicle(2, "B")])
        source.latestByVehicle[1] = snapshot(id: 1, destination: "One")
        source.latestByVehicle[2] = snapshot(id: 2, destination: "Two")
        let model = makeModel(source)
        await model.load()
        XCTAssertEqual(model.latest?.destinationName, "One")
        await model.selectVehicle(2)
        XCTAssertEqual(model.selectedVehicleID, 2)
        XCTAssertEqual(model.latest?.destinationName, "Two")
    }

    func testFreshnessLiveAfterLoad() async {
        var source = StubSource(vehicles: [vehicle(1, "A")])
        source.latestByVehicle[1] = snapshot(id: 1, destination: "Office")
        let model = makeModel(source)
        await model.load()
        XCTAssertNotNil(model.lastUpdated)
        XCTAssertTrue(model.isLive)
        XCTAssertFalse(model.isStale)
    }

    // MARK: - GPS normalization (web normalizeGpsState)

    func testGpsNormalize() {
        XCTAssertEqual(NavGpsFix.normalize("gpsValid"), .locked)
        XCTAssertEqual(NavGpsFix.normalize("FIX3D"), .locked)
        XCTAssertEqual(NavGpsFix.normalize("noFix"), .unlocked)
        XCTAssertEqual(NavGpsFix.normalize("invalid"), .unlocked)
        XCTAssertEqual(NavGpsFix.normalize("weird"), .unknown)
        XCTAssertEqual(NavGpsFix.normalize(nil), .unknown)
        XCTAssertEqual(NavGpsFix.normalize("  "), .unknown)
    }

    // MARK: - Sample seed renders populated

    func testSampleSourcePopulatesPrimaryVehicle() async {
        let model = NavigationRoutePageModel(dataSource: SampleNavigationRouteDataSource())
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertTrue(model.hasActiveRoute)
        XCTAssertFalse(model.history.isEmpty)
        XCTAssertFalse(model.recentDestinations.isEmpty)
    }
}
