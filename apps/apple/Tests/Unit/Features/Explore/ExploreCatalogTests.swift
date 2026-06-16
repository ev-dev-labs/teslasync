import XCTest
@testable import TeslaSync

/// Pure-logic tests for the Explore catalog operations — completeness, humanization, AND-token
/// filtering, canonical grouping, gating predicates, and the Levenshtein suggestion ranking.
final class ExploreCatalogTests: XCTestCase {
    private let catalog = ExploreCatalog.build()

    func testBuildCoversEveryRoute() {
        XCTAssertEqual(catalog.count, AppRoute.allCases.count)
        XCTAssertEqual(Set(catalog.map(\.route)), Set(AppRoute.allCases))
    }

    func testHumanizeSplitsCamelCase() {
        XCTAssertEqual(ExploreCatalog.humanize("batteryHealth"), "battery Health")
        XCTAssertEqual(ExploreCatalog.humanize("apiKeys"), "api Keys")
        XCTAssertEqual(ExploreCatalog.humanize("efficiency"), "efficiency")
    }

    func testSearchCorpusIsLowercasedAndIncludesPath() {
        let corpus = ExploreCatalog.searchCorpus(for: .chargingHeatmap)
        XCTAssertEqual(corpus, corpus.lowercased())
        XCTAssertTrue(corpus.contains("charging"))
        XCTAssertTrue(corpus.contains("charging-heatmap"))
    }

    func testFilterEmptyQueryReturnsAll() {
        XCTAssertEqual(ExploreCatalog.filter(catalog, query: "").count, catalog.count)
        XCTAssertEqual(ExploreCatalog.filter(catalog, query: "   ").count, catalog.count)
    }

    func testFilterSingleTokenSubstring() {
        let result = ExploreCatalog.filter(catalog, query: "battery")
        XCTAssertFalse(result.isEmpty)
        XCTAssertTrue(result.allSatisfy { $0.searchText.contains("battery") })
    }

    func testFilterRequiresAllTokens() {
        let result = ExploreCatalog.filter(catalog, query: "battery health")
        XCTAssertTrue(result.allSatisfy { entry in
            entry.searchText.contains("battery") && entry.searchText.contains("health")
        })
        XCTAssertTrue(result.contains { $0.route == .batteryHealth })
    }

    func testGroupPreservesCanonicalOrderAndSkipsEmpty() {
        let sections = ExploreCatalog.group(catalog)
        let order = sections.map(\.group)
        XCTAssertEqual(order, AppRouteGroup.allCases)
        let single = ExploreCatalog.group(catalog.filter { $0.group == .account })
        XCTAssertEqual(single.map(\.group), [.account])
    }

    func testGroupCoversEveryEntryExactlyOnce() {
        let sections = ExploreCatalog.group(catalog)
        let regrouped = sections.flatMap(\.entries).map(\.route)
        XCTAssertEqual(Set(regrouped), Set(catalog.map(\.route)))
        XCTAssertEqual(regrouped.count, catalog.count)
    }

    func testGatingPredicates() {
        let compare = ExploreCatalog.gating(for: .fleetCompare)
        XCTAssertEqual(compare.minVehicles, 2)
        XCTAssertFalse(compare.requiresAuth)

        let admin = ExploreCatalog.gating(for: .auditLog)
        XCTAssertEqual(admin.minVehicles, 0)
        XCTAssertTrue(admin.requiresAuth)

        let charging = ExploreCatalog.gating(for: .charging)
        XCTAssertEqual(charging.minVehicles, 1)
        XCTAssertFalse(charging.requiresAuth)

        let overview = ExploreCatalog.gating(for: .dashboard)
        XCTAssertEqual(overview.minVehicles, 0)
        XCTAssertFalse(overview.requiresAuth)
    }

    func testVisibleAppliesGating() {
        let gated = ExploreCatalog.visible(catalog, vehicleCount: 0, isForwardAuth: false)
        XCTAssertFalse(gated.contains { $0.route == .fleetCompare })
        XCTAssertFalse(gated.contains { $0.route == .auditLog })
        XCTAssertFalse(gated.contains { $0.route == .charging })
        XCTAssertTrue(gated.contains { $0.route == .dashboard })

        let full = ExploreCatalog.visible(catalog, vehicleCount: 5, isForwardAuth: true)
        XCTAssertTrue(full.contains { $0.route == .fleetCompare })
        XCTAssertTrue(full.contains { $0.route == .auditLog })
        XCTAssertTrue(full.contains { $0.route == .charging })
    }

    func testLevenshteinDistances() {
        XCTAssertEqual(ExploreCatalog.levenshtein("kitten", "sitting"), 3)
        XCTAssertEqual(ExploreCatalog.levenshtein("", "abc"), 3)
        XCTAssertEqual(ExploreCatalog.levenshtein("abc", ""), 3)
        XCTAssertEqual(ExploreCatalog.levenshtein("charging", "charging"), 0)
    }

    func testClosestRoutesEmptyForBlankQuery() {
        XCTAssertTrue(ExploreCatalog.closestRoutes(query: "  ", in: catalog).isEmpty)
    }

    func testClosestRoutesRanksNearestTypo() {
        let suggestions = ExploreCatalog.closestRoutes(query: "chargng", in: catalog, limit: 5)
        XCTAssertFalse(suggestions.isEmpty)
        XCTAssertLessThanOrEqual(suggestions.count, 5)
        XCTAssertTrue(suggestions.contains { $0.route == .charging })
        let distances = suggestions.map(\.distance)
        XCTAssertEqual(distances, distances.sorted())
    }
}
