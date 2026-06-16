import CoreLocation
import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for the Map Overview page: every data state the page renders
/// (loading / empty / error / ready), the vehicle selection + reload, the live-staleness gate
/// (ADR-013), the null-island filtering and time-ordering of the trail / playback geometry, the
/// SI→display formatters, and the `.maps` route registration.
@MainActor
final class MapOverviewPageModelTests: XCTestCase {
    private struct StubSource: MapOverviewDataSource {
        var vehicles: [MapOverviewVehicle]
        var latest: MapOverviewPosition?
        var history: [MapOverviewPosition]
        var snapshot: MapOverviewLocationSnapshot?
        var failVehicles = false

        func loadVehicles() async throws -> [MapOverviewVehicle] {
            if failVehicles { throw StubError() }
            return vehicles
        }

        func loadLatestPosition(vehicleID _: Int64) async throws -> MapOverviewPosition? { latest }
        func loadHistory(vehicleID _: Int64) async throws -> [MapOverviewPosition] { history }
        func loadLocationSnapshot(vehicleID _: Int64) async throws -> MapOverviewLocationSnapshot? { snapshot }
    }

    private struct StubError: Error {}

    private let epoch = Date(timeIntervalSince1970: 1_700_000_000)

    // MARK: Fixtures

    private func vehicle(_ id: Int64, _ name: String) -> MapOverviewVehicle {
        MapOverviewVehicle(id: id, displayName: name)
    }

    private func position(
        id: Int64,
        lat: Double = 37.7749,
        lon: Double = -122.4194,
        speedMps: Double? = 12,
        heading: Double? = 90,
        odometerM: Double = 48_280_000,
        secondsAgo: Double = 0
    ) -> MapOverviewPosition {
        MapOverviewPosition(
            id: id,
            latitude: lat,
            longitude: lon,
            speedMps: speedMps,
            powerW: 11_000,
            heading: heading,
            elevationM: 30,
            odometerM: odometerM,
            batteryLevel: 80,
            createdAt: epoch.addingTimeInterval(-secondsAgo)
        )
    }

    private func loaded(
        vehicles: [MapOverviewVehicle],
        latest: MapOverviewPosition? = nil,
        history: [MapOverviewPosition] = [],
        failVehicles: Bool = false
    ) -> MapOverviewPageModel {
        MapOverviewPageModel(
            dataSource: StubSource(
                vehicles: vehicles,
                latest: latest,
                history: history,
                snapshot: nil,
                failVehicles: failVehicles
            )
        )
    }

    // MARK: - Phase machine

    func testInitialPhaseLoading() {
        let model = loaded(vehicles: [])
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadReadyWithData() async {
        let model = loaded(vehicles: [vehicle(1, "A")], latest: position(id: 10))
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertNotNil(model.latest)
        XCTAssertTrue(model.hasValidLatest)
    }

    func testEmptyWhenNoVehicles() async {
        let model = loaded(vehicles: [])
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.selectedVehicleID)
    }

    func testErrorWhenVehiclesFail() async {
        let model = loaded(vehicles: [vehicle(1, "A")], failVehicles: true)
        await model.load()
        guard case .error = model.phase else { return XCTFail("expected error phase") }
        XCTAssertNotNil(model.loadErrorMessage)
    }

    func testReadyWithoutPositionStillReady() async {
        let model = loaded(vehicles: [vehicle(1, "A")], latest: nil)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.hasValidLatest)
        XCTAssertFalse(model.hasHistory)
    }

    func testSelectVehicleReloads() async {
        let model = loaded(vehicles: [vehicle(1, "A"), vehicle(2, "B")], latest: position(id: 10))
        await model.load()
        await model.selectVehicle(2)
        XCTAssertEqual(model.selectedVehicleID, 2)
        XCTAssertEqual(model.phase, .ready)
    }

    func testSelectUnknownVehicleIgnored() async {
        let model = loaded(vehicles: [vehicle(1, "A")], latest: position(id: 10))
        await model.load()
        await model.selectVehicle(99)
        XCTAssertEqual(model.selectedVehicleID, 1)
    }

    // MARK: - Live staleness (ADR-013)

    func testStaleDetection() async {
        let model = loaded(vehicles: [vehicle(1, "A")], latest: position(id: 10))
        await model.load()
        XCTAssertFalse(model.isStale(asOf: epoch.addingTimeInterval(30)))
        XCTAssertTrue(model.isStale(asOf: epoch.addingTimeInterval(300)))
    }

    func testStaleFalseWithoutFix() async {
        let model = loaded(vehicles: [vehicle(1, "A")], latest: nil)
        await model.load()
        XCTAssertFalse(model.isStale(asOf: epoch.addingTimeInterval(10_000)))
    }

    // MARK: - Geometry derivations

    func testTrailFiltersNullIsland() async {
        let history = [
            position(id: 1, lat: 37.78, lon: -122.41),
            position(id: 2, lat: 0, lon: 0),
            position(id: 3, lat: 37.79, lon: -122.40)
        ]
        let model = loaded(vehicles: [vehicle(1, "A")], latest: position(id: 10), history: history)
        await model.load()
        XCTAssertEqual(model.trailCoordinates.count, 2)
    }

    func testPlaybackOrderedAscending() async {
        let history = [
            position(id: 1, lat: 37.78, lon: -122.41, secondsAgo: 0),
            position(id: 2, lat: 37.79, lon: -122.40, secondsAgo: 120),
            position(id: 3, lat: 37.80, lon: -122.39, secondsAgo: 60)
        ]
        let model = loaded(vehicles: [vehicle(1, "A")], latest: position(id: 10), history: history)
        await model.load()
        let lats = model.playbackCoordinates.map(\.latitude)
        // Ascending by time → oldest (120 s ago) first, newest (0 s) last.
        XCTAssertEqual(lats, [37.79, 37.80, 37.78])
    }

    func testHasValidLatestRejectsNullIsland() async {
        let model = loaded(vehicles: [vehicle(1, "A")], latest: position(id: 10, lat: 0, lon: 0))
        await model.load()
        XCTAssertFalse(model.hasValidLatest)
    }

    func testMapStyleMutation() {
        let model = loaded(vehicles: [])
        model.setMapStyle(.imagery)
        XCTAssertEqual(model.mapStyle, .imagery)
    }

    func testVehicleNameFallback() async {
        let model = loaded(vehicles: [vehicle(1, "")], latest: position(id: 10))
        await model.load()
        XCTAssertEqual(model.vehicleName, String(localized: "mapOverview.vehicle"))
    }

    // MARK: - Formatters (pure Swift render-boundary helpers)

    func testNumberFormatter() {
        XCTAssertEqual(MapOverviewFormat.number(1234.5, decimals: 1), "1,234.5")
        XCTAssertEqual(MapOverviewFormat.number(42, decimals: 0), "42")
    }

    func testCoordinatePair() {
        let valid = position(id: 1, lat: 37.123456, lon: -122.65432)
        XCTAssertEqual(MapOverviewFormat.coordinatePair(valid, decimals: 4), "37.1235, -122.6543")
        let nullIsland = position(id: 2, lat: 0, lon: 0)
        XCTAssertEqual(MapOverviewFormat.coordinatePair(nullIsland, decimals: 4), "—")
        XCTAssertEqual(MapOverviewFormat.coordinatePair(nil, decimals: 4), "—")
    }

    func testHeadingFormat() {
        XCTAssertEqual(MapOverviewFormat.heading(123), "123°")
        XCTAssertEqual(MapOverviewFormat.heading(nil), "—")
    }

    func testMissingOdometerEmDash() {
        XCTAssertEqual(MapOverviewFormat.odometer(nil, units: .metric), "—")
    }

    func testSpeedConvertsSIAndAppendsUnit() {
        // 10 m/s == 36 km/h in metric display.
        let text = MapOverviewFormat.speed(10, units: .metric)
        XCTAssertTrue(text.contains("36"), text)
        XCTAssertTrue(text.contains(UnitPreferences.metric.speed), text)
    }

    // MARK: - Route registration

    func testRouteRegistration() {
        let registry = MapsRouteRegistration.registry()
        XCTAssertNotNil(registry.view(for: .maps))
    }
}
