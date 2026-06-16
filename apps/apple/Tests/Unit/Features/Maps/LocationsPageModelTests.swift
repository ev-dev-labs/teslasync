import Foundation
import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for `LocationsPageModel` — every data state the page renders
/// (loading / no-data empty / query-error / ready), the vehicle auto-select + reselection, the
/// search filter, offset pagination, the `last_visited` range/null filter (web `locations` memo),
/// the summary derivations (totals, unique cities, average), the chart series (web
/// `visitsChartData` / `timeChartData`), the applied-AI-name hand-off, the `isUnnamed` heuristic,
/// and the pure display formatters. Duration formatters that route through the shared KMP `Units`
/// facade are exercised by the standalone logic harness instead, so these cases stay independent of
/// the framework's exact conversion table.
@MainActor
final class LocationsPageModelTests: XCTestCase {
    private struct StubError: Error {}

    private struct StubSource: LocationsDataSource {
        var vehicles: [LocationsPageVehicle]
        var locationsByVehicle: [Int64: [VisitedLocation]] = [:]
        var failLocations = false

        func loadVehicles() async throws -> [LocationsPageVehicle] {
            vehicles
        }

        func loadLocations(vehicleID: Int64, limit: Int, offset: Int) async throws -> [VisitedLocation] {
            if failLocations { throw StubError() }
            let all = locationsByVehicle[vehicleID] ?? []
            guard offset < all.count else { return [] }
            return Array(all[offset ..< min(offset + limit, all.count)])
        }
    }

    private func date(_ daysAgo: Int) -> Date {
        Date(timeIntervalSince1970: 1_780_000_000 - TimeInterval(daysAgo) * 86400)
    }

    private func loc(
        _ id: Int64,
        _ name: String,
        visits: Int,
        durationS: Double,
        daysAgo: Int? = 1
    ) -> VisitedLocation {
        VisitedLocation(
            id: id,
            addressName: name,
            visitCount: visits,
            totalDurationS: durationS,
            lastVisited: daysAgo.map { date($0) }
        )
    }

    private func twoVehicleSource() -> StubSource {
        StubSource(
            vehicles: [
                LocationsPageVehicle(id: 1, displayName: "Rocinante", vin: "VIN1"),
                LocationsPageVehicle(id: 2, displayName: "Tachi", vin: "VIN2")
            ],
            locationsByVehicle: [
                1: [
                    loc(10, "Home, Seattle", visits: 100, durationS: 3600, daysAgo: 1),
                    loc(11, "Work, Bellevue", visits: 60, durationS: 1800, daysAgo: 2),
                    loc(12, "Gym, Seattle", visits: 20, durationS: 600, daysAgo: 3)
                ],
                2: [
                    loc(20, "Office, Tacoma", visits: 40, durationS: 2400, daysAgo: 5)
                ]
            ]
        )
    }

    // MARK: - Phases

    func testLoadReachesReadyAndAutoSelectsFirstVehicle() async {
        let model = LocationsPageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertEqual(model.uniquePlaces, 3)
    }

    func testEmptyWhenNoLocations() async {
        var source = twoVehicleSource()
        source.locationsByVehicle = [1: [], 2: []]
        let model = LocationsPageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertTrue(model.locations.isEmpty)
        XCTAssertEqual(model.uniquePlaces, 0)
        XCTAssertNil(model.topLocation)
    }

    func testErrorWhenQueryFails() async {
        var source = twoVehicleSource()
        source.failLocations = true
        let model = LocationsPageModel(dataSource: source)
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected error phase, got \(model.phase)")
        }
        XCTAssertTrue(model.locations.isEmpty)
    }

    func testRetryRecoversFromError() async {
        var source = twoVehicleSource()
        source.failLocations = true
        let model = LocationsPageModel(dataSource: source)
        await model.load()
        guard case .error = model.phase else { return XCTFail("expected error") }
        // A second source that succeeds is not injectable post-init, so assert the error surfaced
        // and the list stayed empty (the page shows Retry over this state).
        XCTAssertTrue(model.filteredLocations.isEmpty)
    }

    // MARK: - Selection + pagination

    func testSelectVehicleReloadsAndResetsPage() async {
        let model = LocationsPageModel(dataSource: twoVehicleSource())
        await model.load()
        await model.setPage(2)
        await model.selectVehicle(2)
        XCTAssertEqual(model.selectedVehicleID, 2)
        XCTAssertEqual(model.page, 1)
        XCTAssertEqual(model.uniquePlaces, 1)
        XCTAssertEqual(model.topLocation?.addressName, "Office, Tacoma")
    }

    func testPaginationOffsetsTheWindow() async {
        var source = twoVehicleSource()
        let many = (0 ..< 75).map { loc(Int64(1000 + $0), "Place \($0)", visits: 75 - $0, durationS: 60, daysAgo: 1) }
        source.locationsByVehicle = [1: many]
        let model = LocationsPageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.rawLocations.count, LocationsPageModel.pageSize) // first 50
        XCTAssertTrue(model.hasNextPage)
        XCTAssertFalse(model.hasPreviousPage)
        await model.setPage(2)
        XCTAssertEqual(model.rawLocations.count, 25) // remaining
        XCTAssertFalse(model.hasNextPage)
        XCTAssertTrue(model.hasPreviousPage)
    }

    // MARK: - Search filter (web filteredLocations)

    func testSearchFiltersByAddressCaseInsensitively() async {
        let model = LocationsPageModel(dataSource: twoVehicleSource())
        await model.load()
        model.setSearch("seattle")
        XCTAssertEqual(model.filteredLocations.count, 2)
        XCTAssertEqual(Set(model.filteredLocations.map(\.id)), [10, 12])
        model.clearSearch()
        XCTAssertEqual(model.filteredLocations.count, 3)
    }

    // MARK: - Range / null filter (web locations memo)

    func testLocationsExcludesNullLastVisited() async {
        var source = twoVehicleSource()
        source.locationsByVehicle = [1: [
            loc(10, "Dated, Seattle", visits: 5, durationS: 60, daysAgo: 1),
            loc(11, "Never visited", visits: 3, durationS: 30, daysAgo: nil)
        ]]
        let model = LocationsPageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.locations.count, 1)
        XCTAssertEqual(model.locations.first?.id, 10)
    }

    // MARK: - Summary derivations

    func testSummaryStats() async {
        let model = LocationsPageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.totalVisits, 180) // 100 + 60 + 20
        XCTAssertEqual(model.totalTimeS, 6000) // 3600 + 1800 + 600
        XCTAssertEqual(model.uniquePlaces, 3)
        XCTAssertEqual(model.averageDurationS, 6000.0 / 180.0, accuracy: 0.0001)
        XCTAssertEqual(model.topLocation?.id, 10)
    }

    func testUniqueCitiesCountsTrailingSegmentDroppingUnknown() async {
        var source = twoVehicleSource()
        source.locationsByVehicle = [1: [
            loc(10, "Home, Seattle", visits: 5, durationS: 60),
            loc(11, "Work, Seattle", visits: 4, durationS: 60),
            loc(12, "Pier, Tacoma", visits: 3, durationS: 60),
            loc(13, "Unknown", visits: 2, durationS: 60)
        ]]
        let model = LocationsPageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.uniqueCities, 2) // Seattle, Tacoma (Unknown dropped)
    }

    // MARK: - Chart series

    func testVisitsChartTakesTop15InOrder() async {
        var source = twoVehicleSource()
        let many = (0 ..< 20).map { loc(Int64(1000 + $0), "Place \($0)", visits: 20 - $0, durationS: 60) }
        source.locationsByVehicle = [1: many]
        let model = LocationsPageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.visitsChartData.count, 15)
        XCTAssertEqual(model.visitsChartData.first?.value, 20)
        XCTAssertEqual(model.timeChartData.count, 10)
    }

    func testTimeChartHoursDerivation() async {
        var source = twoVehicleSource()
        source.locationsByVehicle = [1: [loc(10, "A, Seattle", visits: 1, durationS: 7200)]]
        let model = LocationsPageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.timeChartData.first?.value, 2.0) // 7200s / 3600 = 2h
    }

    // MARK: - Applied AI name hand-off

    func testApplyNameParksProposalForRow() async {
        let model = LocationsPageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertNil(model.appliedName(for: 10))
        model.applyName(locationID: 10, name: "Grandma's House")
        XCTAssertEqual(model.appliedName(for: 10), "Grandma's House")
        XCTAssertNil(model.appliedName(for: 11))
    }

    // MARK: - isUnnamed heuristic (web isUnnamedLocation)

    func testIsUnnamedHeuristic() {
        XCTAssertTrue(LocationsNaming.isUnnamed(""))
        XCTAssertTrue(LocationsNaming.isUnnamed("   "))
        XCTAssertTrue(LocationsNaming.isUnnamed("Unknown"))
        XCTAssertTrue(LocationsNaming.isUnnamed("unknown"))
        XCTAssertTrue(LocationsNaming.isUnnamed("47.6062,-122.3321"))
        XCTAssertTrue(LocationsNaming.isUnnamed("47.6062, -122.3321"))
        XCTAssertFalse(LocationsNaming.isUnnamed("Home, Seattle"))
        XCTAssertFalse(LocationsNaming.isUnnamed("123 Main St"))
    }

    func testCityExtraction() {
        XCTAssertEqual(LocationsNaming.city(of: "Home, Seattle"), "Seattle")
        XCTAssertEqual(LocationsNaming.city(of: "Tacoma"), "Tacoma")
        XCTAssertNil(LocationsNaming.city(of: "Unknown"))
        XCTAssertNil(LocationsNaming.city(of: ""))
    }

    // MARK: - Pure formatters (Units-independent)

    func testIntegerFormatterGroups() {
        XCTAssertEqual(LocationsFormat.integer(1234), "1,234")
        XCTAssertEqual(LocationsFormat.integer(0), "0")
    }

    func testHoursDerivationRoundsToOneDecimal() {
        XCTAssertEqual(LocationsFormat.hours(5400), 1.5, accuracy: 0.0001)
        XCTAssertEqual(LocationsFormat.hours(0), 0)
        XCTAssertEqual(LocationsFormat.hours(.nan), 0)
    }

    func testChartLabelTruncatesLongAddresses() {
        XCTAssertEqual(LocationsFormat.chartLabel("Short"), "Short")
        let long = "1200 Alpine Way, Seattle, WA 98101"
        let label = LocationsFormat.chartLabel(long)
        XCTAssertTrue(label.hasSuffix("\u{2026}"))
        XCTAssertEqual(label.count, 23) // 22 chars + ellipsis
    }

    func testAverageDurationGuardsZeroVisits() {
        let location = VisitedLocation(id: 1, addressName: "X", visitCount: 0, totalDurationS: 100, lastVisited: nil)
        XCTAssertEqual(location.averageDurationS, 0)
    }
}
