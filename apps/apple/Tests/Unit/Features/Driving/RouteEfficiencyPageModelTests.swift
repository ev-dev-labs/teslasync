import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for the Route Efficiency surface — every data state the page
/// renders (loading / empty / error / ready), the vehicle reselection, the date-range reload, and the
/// summary/chart derivations (web `totalTrips` / `bestEff` / `worstEff` / `avgEff` / `chartData`).
@MainActor
final class RouteEfficiencyPageModelTests: XCTestCase {
    private struct StubError: Error {}

    private struct StubSource: RouteEfficiencyDataSource {
        var vehicles: [RouteEfficiencyVehicle]
        var routesByVehicle: [Int64: [RouteEfficiencyRoute]] = [:]
        var failLoad = false

        func loadVehicles() async throws -> [RouteEfficiencyVehicle] {
            vehicles
        }

        func useRouteEfficiency(
            vehicleID: Int64,
            start _: Date,
            end _: Date
        ) async throws -> [RouteEfficiencyRoute] {
            if failLoad { throw StubError() }
            return routesByVehicle[vehicleID] ?? []
        }
    }

    private let reference = Date(timeIntervalSince1970: 1_700_000_000)

    private func vehicle(_ id: Int64, _ name: String) -> RouteEfficiencyVehicle {
        RouteEfficiencyVehicle(id: id, displayName: name, vin: "VIN\(id)")
    }

    private func route(
        _ tag: String,
        trips: Int,
        avg: Double,
        best: Double,
        worst: Double
    ) -> RouteEfficiencyRoute {
        RouteEfficiencyRoute(
            startLocation: "\(tag)-start",
            endLocation: "\(tag)-end",
            tripCount: trips,
            avgDistanceKm: 40,
            avgEfficiency: avg,
            bestEfficiency: best,
            worstEfficiency: worst
        )
    }

    private func makeModel(_ source: StubSource) -> RouteEfficiencyPageModel {
        RouteEfficiencyPageModel(dataSource: source, referenceDate: reference)
    }

    // MARK: - Phases

    func testInitialPhaseIsLoading() {
        let model = makeModel(StubSource(vehicles: [vehicle(1, "Roci")]))
        XCTAssertEqual(model.phase, .loading)
    }

    func testReadyPhaseAfterLoadingRoutes() async {
        let source = StubSource(
            vehicles: [vehicle(1, "Roci")],
            routesByVehicle: [1: [route("AB", trips: 5, avg: 160, best: 130, worst: 190)]]
        )
        let model = makeModel(source)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.routes.count, 1)
        XCTAssertEqual(model.selectedVehicleID, 1)
    }

    func testEmptyPhaseWhenNoRoutes() async {
        let model = makeModel(StubSource(vehicles: [vehicle(1, "Roci")], routesByVehicle: [1: []]))
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.routes.isEmpty)
    }

    func testErrorPhaseWhenLoadFails() async {
        let model = makeModel(StubSource(vehicles: [vehicle(1, "Roci")], failLoad: true))
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected error phase, got \(model.phase)")
        }
        XCTAssertTrue(model.routes.isEmpty)
    }

    // MARK: - Selection + date range

    func testSelectVehicleReloadsRoutes() async {
        let source = StubSource(
            vehicles: [vehicle(1, "Roci"), vehicle(2, "Tachi")],
            routesByVehicle: [
                1: [route("AB", trips: 5, avg: 160, best: 130, worst: 190)],
                2: [
                    route("CD", trips: 3, avg: 150, best: 120, worst: 180),
                    route("EF", trips: 7, avg: 170, best: 140, worst: 200)
                ]
            ]
        )
        let model = makeModel(source)
        await model.load()
        XCTAssertEqual(model.routes.count, 1)
        await model.selectVehicle(2)
        XCTAssertEqual(model.selectedVehicleID, 2)
        XCTAssertEqual(model.routes.count, 2)
        XCTAssertEqual(model.totalTrips, 10)
    }

    func testSetDateRangeUpdatesWindowAndReloads() async {
        let source = StubSource(
            vehicles: [vehicle(1, "Roci")],
            routesByVehicle: [1: [route("AB", trips: 5, avg: 160, best: 130, worst: 190)]]
        )
        let model = makeModel(source)
        await model.load()
        let newStart = Date(timeIntervalSince1970: 1_690_000_000)
        let newEnd = Date(timeIntervalSince1970: 1_695_000_000)
        await model.setDateRange(start: newStart, end: newEnd)
        XCTAssertEqual(model.startDate, newStart)
        XCTAssertEqual(model.endDate, newEnd)
        XCTAssertEqual(model.phase, .ready)
    }

    // MARK: - Derivations (web summary + chart)

    func testSummaryDerivations() async {
        let source = StubSource(
            vehicles: [vehicle(1, "Roci")],
            routesByVehicle: [1: [
                route("AB", trips: 10, avg: 150, best: 120, worst: 200),
                route("CD", trips: 4, avg: 180, best: 140, worst: 240),
                route("EF", trips: 6, avg: 160, best: 110, worst: 210)
            ]]
        )
        let model = makeModel(source)
        await model.load()
        XCTAssertEqual(model.totalTrips, 20)
        XCTAssertEqual(model.bestEfficiency, 110) // min of best
        XCTAssertEqual(model.worstEfficiency, 240) // max of worst
        XCTAssertEqual(model.averageEfficiency, (150 + 180 + 160) / 3.0, accuracy: 0.0001)
        XCTAssertEqual(model.mostDrivenTripCount, 10) // routes[0].tripCount
    }

    func testComparisonRoutesSortedAscendingAndCappedAtTen() async {
        let many = (0 ..< 12).map { index in
            route("R\(index)", trips: 1, avg: Double(220 - index), best: 100, worst: 250)
        }
        let model = makeModel(StubSource(vehicles: [vehicle(1, "Roci")], routesByVehicle: [1: many]))
        await model.load()
        let comparison = model.comparisonRoutes
        XCTAssertEqual(comparison.count, 10)
        let averages = comparison.map(\.avgEfficiency)
        XCTAssertEqual(averages, averages.sorted())
        XCTAssertEqual(comparison.first?.avgEfficiency, 209) // 220 - 11 (lowest avg)
    }

    func testZeroDerivationsWhenEmpty() async {
        let model = makeModel(StubSource(vehicles: [vehicle(1, "Roci")], routesByVehicle: [1: []]))
        await model.load()
        XCTAssertEqual(model.totalTrips, 0)
        XCTAssertEqual(model.bestEfficiency, 0)
        XCTAssertEqual(model.worstEfficiency, 0)
        XCTAssertEqual(model.averageEfficiency, 0)
        XCTAssertEqual(model.mostDrivenTripCount, 0)
        XCTAssertTrue(model.comparisonRoutes.isEmpty)
    }
}
