import XCTest
@testable import TeslaSync

/// State-machine + wiring tests for the Explore feature hub — every data state the page renders
/// (loading / success / total-failure error / no-match empty), the vehicle + ForwardAuth gating, the
/// query filter, the recent-strip resolution, and the suggestion engine.
@MainActor
final class ExplorePageModelTests: XCTestCase {
    private struct StubError: Error {}

    private struct StubSource: ExploreDataSource {
        var vehicles: [ExploreVehicle] = []
        var forwardAuth = false
        var recents: [String] = []
        var failVehicles = false

        func useVehicles() async throws -> [ExploreVehicle] {
            if failVehicles { throw StubError() }
            return vehicles
        }

        func useIsForwardAuth() async -> Bool { forwardAuth }
        func recentRoutePaths() async -> [String] { recents }
    }

    private func vehicles(_ count: Int) -> [ExploreVehicle] {
        (1 ... count).map { ExploreVehicle(id: Int64($0), displayName: "V\($0)") }
    }

    // MARK: Phase

    func testInitialPhaseIsLoading() {
        let model = ExplorePageModel(dataSource: StubSource())
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadSuccessReachesReady() async {
        let model = ExplorePageModel(dataSource: StubSource(vehicles: vehicles(3), forwardAuth: true))
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.vehicleCount, 3)
        XCTAssertTrue(model.isForwardAuth)
    }

    func testVehicleLoadFailureSurfacesErrorPhase() async {
        let model = ExplorePageModel(dataSource: StubSource(failVehicles: true))
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected error phase on vehicle load failure")
        }
        XCTAssertEqual(model.vehicleCount, 0)
    }

    // MARK: Gating

    func testVehicleGatingHidesComparisonWithoutTwoVehicles() async {
        let model = ExplorePageModel(dataSource: StubSource(vehicles: vehicles(1), forwardAuth: true))
        await model.load()
        XCTAssertFalse(model.visibleCatalog.contains { $0.route == .fleetCompare })
    }

    func testVehicleGatingShowsComparisonWithTwoVehicles() async {
        let model = ExplorePageModel(dataSource: StubSource(vehicles: vehicles(2), forwardAuth: true))
        await model.load()
        XCTAssertTrue(model.visibleCatalog.contains { $0.route == .fleetCompare })
    }

    func testAuthGatingHidesAdminWithoutForwardAuth() async {
        let model = ExplorePageModel(dataSource: StubSource(vehicles: vehicles(3), forwardAuth: false))
        await model.load()
        XCTAssertFalse(model.visibleCatalog.contains { $0.route == .auditLog })
    }

    func testAuthGatingShowsAdminWithForwardAuth() async {
        let model = ExplorePageModel(dataSource: StubSource(vehicles: vehicles(3), forwardAuth: true))
        await model.load()
        XCTAssertTrue(model.visibleCatalog.contains { $0.route == .auditLog })
    }

    func testGatingNeverHidesOverviewFeatures() async {
        let model = ExplorePageModel(dataSource: StubSource())
        await model.load()
        XCTAssertTrue(model.visibleCatalog.contains { $0.route == .explore })
        XCTAssertTrue(model.visibleCatalog.contains { $0.route == .settings })
    }

    // MARK: Filter

    func testEmptyQueryShowsFullVisibleCatalog() async {
        let model = ExplorePageModel(dataSource: StubSource(vehicles: vehicles(3), forwardAuth: true))
        await model.load()
        XCTAssertEqual(model.matchCount, model.totalFeatures)
        XCTAssertFalse(model.isEmptyResult)
    }

    func testQueryNarrowsCatalog() async {
        let model = ExplorePageModel(dataSource: StubSource(vehicles: vehicles(3), forwardAuth: true))
        await model.load()
        model.setQuery("charging")
        XCTAssertGreaterThan(model.matchCount, 0)
        XCTAssertLessThan(model.matchCount, model.totalFeatures)
        XCTAssertTrue(model.filtered.allSatisfy { $0.searchText.contains("charging") })
    }

    func testNoMatchProducesEmptyResultWithSuggestions() async {
        let model = ExplorePageModel(dataSource: StubSource(vehicles: vehicles(3), forwardAuth: true))
        await model.load()
        model.setQuery("zzznomatchxyz")
        XCTAssertTrue(model.isEmptyResult)
        XCTAssertTrue(model.grouped.isEmpty)
        XCTAssertFalse(model.suggestions.isEmpty)
    }

    func testClearQueryRestoresFullCatalog() async {
        let model = ExplorePageModel(dataSource: StubSource(vehicles: vehicles(3), forwardAuth: true))
        await model.load()
        model.setQuery("zzznomatchxyz")
        XCTAssertTrue(model.isEmptyResult)
        model.clearQuery()
        XCTAssertFalse(model.hasQuery)
        XCTAssertFalse(model.isEmptyResult)
    }

    // MARK: Grouping

    func testGroupedPreservesCanonicalOrder() async {
        let model = ExplorePageModel(dataSource: StubSource(vehicles: vehicles(3), forwardAuth: true))
        await model.load()
        let order = model.grouped.map(\.group)
        let expected = AppRouteGroup.allCases.filter { group in order.contains(group) }
        XCTAssertEqual(order, expected)
    }

    // MARK: Recents

    func testRecentEntriesResolveDedupeAndCap() async {
        let recents = [
            AppRoute.charging.path, AppRoute.charging.path, AppRoute.driving.path,
            AppRoute.analytics.path, AppRoute.batteryHealth.path, AppRoute.energy.path,
            AppRoute.trips.path, AppRoute.maps.path
        ]
        let source = StubSource(vehicles: vehicles(3), forwardAuth: true, recents: recents)
        let model = ExplorePageModel(dataSource: source, recentLimit: 6)
        await model.load()
        let routes = model.recentEntries.map(\.route)
        XCTAssertEqual(routes.count, Set(routes).count, "recents must be de-duped")
        XCTAssertLessThanOrEqual(model.recentEntries.count, 6)
        XCTAssertTrue(model.showsRecent)
    }

    func testRecentStripHiddenWhileFiltering() async {
        let source = StubSource(vehicles: vehicles(3), forwardAuth: true, recents: [AppRoute.charging.path])
        let model = ExplorePageModel(dataSource: source)
        await model.load()
        XCTAssertTrue(model.showsRecent)
        model.setQuery("battery")
        XCTAssertFalse(model.showsRecent)
    }

    func testRecentEntriesHonorGating() async {
        // A recent admin path must not resolve when ForwardAuth is off (gated out of the catalog).
        let source = StubSource(vehicles: vehicles(1), forwardAuth: false, recents: [AppRoute.auditLog.path])
        let model = ExplorePageModel(dataSource: source)
        await model.load()
        XCTAssertFalse(model.recentEntries.contains { $0.route == .auditLog })
    }
}
