import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for `FleetTelemetryCoveragePageModel` — every data
/// state the page renders (loading / empty / error / success), the refresh flag, the
/// summary roll-ups (web `summarise`), the destination sort, the orphan pass-through,
/// the category/field filtering (web `filteredCategories` / per-category `filtered`),
/// and the `fmtInt` display formatter.
@MainActor final class FleetTelemetryCoveragePageModelTests: XCTestCase {
    private struct StubSource: FleetTelemetryCoverageDataSource {
        var response = FleetTelemetryCoverageResponse(categories: [], destinationTotals: [:], orphanFields: [])
        var fails = false

        func load() async throws -> FleetTelemetryCoverageResponse {
            if fails { throw StubError() }
            return response
        }
    }

    private struct StubError: Error {}

    private func field(
        _ name: String,
        _ destination: String,
        column: String? = nil,
        dual: Bool = false,
        subscribed: Bool
    ) -> FleetTelemetryFieldCoverage {
        FleetTelemetryFieldCoverage(
            field: name,
            destination: destination,
            column: column,
            alsoSignalLog: dual,
            subscribed: subscribed
        )
    }

    /// Two-category fixture with deterministic counts (independent of the sample seed).
    private func fixture() -> FleetTelemetryCoverageResponse {
        FleetTelemetryCoverageResponse(
            categories: [
                FleetTelemetryCategoryCoverage(
                    category: "Drive",
                    totalFields: 3,
                    destinations: ["drives": 2, "signal_log": 2],
                    fields: [
                        field("VehicleSpeed", "drives", column: "speed_mps", dual: true, subscribed: true),
                        field("Odometer", "drives", column: "odometer_m", subscribed: true),
                        field("DriveRail", "signal_log", subscribed: false)
                    ]
                ),
                FleetTelemetryCategoryCoverage(
                    category: "Climate",
                    totalFields: 2,
                    destinations: ["signal_log": 2],
                    fields: [
                        field("InsideTemp", "signal_log", subscribed: true),
                        field("OutsideTemp", "signal_log", subscribed: false)
                    ]
                )
            ],
            destinationTotals: ["drives": 2, "signal_log": 4],
            orphanFields: ["LegacyField"]
        )
    }

    // MARK: - States

    func testInitialStateIsLoading() {
        let model = FleetTelemetryCoveragePageModel(dataSource: StubSource())
        XCTAssertEqual(model.state, .loading)
        XCTAssertFalse(model.isRefreshing)
        XCTAssertNil(model.response)
        XCTAssertTrue(model.categories.isEmpty)
    }

    func testLoadSuccessPopulates() async {
        let response = fixture()
        let model = FleetTelemetryCoveragePageModel(dataSource: StubSource(response: response))
        await model.load()
        XCTAssertEqual(model.state, .loaded(response))
        XCTAssertEqual(model.categories.count, 2)
        XCTAssertNotNil(model.response)
    }

    func testLoadEmptyYieldsEmptyState() async {
        let model = FleetTelemetryCoveragePageModel(dataSource: StubSource())
        await model.load()
        XCTAssertEqual(model.state, .empty)
        XCTAssertTrue(model.categories.isEmpty)
        XCTAssertEqual(model.stats, .zero)
    }

    func testLoadFailureYieldsErrorState() async {
        let model = FleetTelemetryCoveragePageModel(dataSource: StubSource(fails: true))
        await model.load()
        guard case .error = model.state else {
            return XCTFail("expected error state, got \(model.state)")
        }
    }

    func testRefreshReloadsAndClearsRefreshingFlag() async {
        let model = FleetTelemetryCoveragePageModel(dataSource: StubSource(response: fixture()))
        await model.refresh()
        XCTAssertFalse(model.isRefreshing)
        XCTAssertEqual(model.categories.count, 2)
    }

    // MARK: - Summary roll-ups (web `summarise`)

    func testStatsSummariseAcrossCategories() async {
        let model = FleetTelemetryCoveragePageModel(dataSource: StubSource(response: fixture()))
        await model.load()
        let stats = model.stats
        XCTAssertEqual(stats.totalCategories, 2)
        XCTAssertEqual(stats.totalRoutedFields, 5)
        XCTAssertEqual(stats.subscribedFields, 3)
        XCTAssertEqual(stats.unsubscribedRoutedFields, 2)
        XCTAssertEqual(stats.orphanFields, 1)
    }

    func testStatsAreZeroWhenNotLoaded() {
        let model = FleetTelemetryCoveragePageModel(dataSource: StubSource())
        XCTAssertEqual(model.stats, .zero)
    }

    // MARK: - Destination sort (web `sortedDestinations`)

    func testSortedDestinationTotalsDescThenKeyAsc() async {
        let response = FleetTelemetryCoverageResponse(
            categories: fixture().categories,
            destinationTotals: ["b": 2, "a": 2, "c": 5],
            orphanFields: []
        )
        let model = FleetTelemetryCoveragePageModel(dataSource: StubSource(response: response))
        await model.load()
        XCTAssertEqual(model.sortedDestinationTotals.map(\.destination), ["c", "a", "b"])
        XCTAssertEqual(model.sortedDestinationTotals.map(\.count), [5, 2, 2])
    }

    func testSortedDestinationsWithinCategoryTieBreaksByKey() async {
        let model = FleetTelemetryCoveragePageModel(dataSource: StubSource(response: fixture()))
        await model.load()
        let drive = model.categories[0]
        XCTAssertEqual(model.sortedDestinations(in: drive).map(\.destination), ["drives", "signal_log"])
    }

    // MARK: - Orphans

    func testOrphansPassThrough() async {
        let model = FleetTelemetryCoveragePageModel(dataSource: StubSource(response: fixture()))
        await model.load()
        XCTAssertEqual(model.orphans, ["LegacyField"])
        XCTAssertTrue(model.hasOrphans)
    }

    func testNoOrphansHidesPanel() async {
        let response = FleetTelemetryCoverageResponse(
            categories: fixture().categories,
            destinationTotals: [:],
            orphanFields: []
        )
        let model = FleetTelemetryCoveragePageModel(dataSource: StubSource(response: response))
        await model.load()
        XCTAssertFalse(model.hasOrphans)
    }

    // MARK: - Filtering (web `filteredCategories` / per-category `filtered`)

    func testEmptyFilterReturnsAllCategories() async {
        let model = FleetTelemetryCoveragePageModel(dataSource: StubSource(response: fixture()))
        await model.load()
        model.filter = "   "
        XCTAssertEqual(model.filteredCategories.count, 2)
    }

    func testFilterByCategoryNameKeepsCategoryWithNoFieldMatch() async {
        let model = FleetTelemetryCoveragePageModel(dataSource: StubSource(response: fixture()))
        await model.load()
        model.filter = "climate"
        XCTAssertEqual(model.filteredCategories.map(\.category), ["Climate"])
        let climate = model.filteredCategories[0]
        XCTAssertTrue(model.filteredFields(in: climate).isEmpty)
    }

    func testFilterByFieldName() async {
        let model = FleetTelemetryCoveragePageModel(dataSource: StubSource(response: fixture()))
        await model.load()
        model.filter = "odometer"
        XCTAssertEqual(model.filteredCategories.map(\.category), ["Drive"])
        XCTAssertEqual(model.filteredFields(in: model.filteredCategories[0]).map(\.field), ["Odometer"])
    }

    func testFilterByDestination() async {
        let model = FleetTelemetryCoveragePageModel(dataSource: StubSource(response: fixture()))
        await model.load()
        model.filter = "drives"
        XCTAssertEqual(model.filteredCategories.map(\.category), ["Drive"])
        XCTAssertEqual(model.filteredFields(in: model.filteredCategories[0]).map(\.field), ["VehicleSpeed", "Odometer"])
    }

    func testFilterByColumn() async {
        let model = FleetTelemetryCoveragePageModel(dataSource: StubSource(response: fixture()))
        await model.load()
        model.filter = "odometer_m"
        XCTAssertEqual(model.filteredCategories.map(\.category), ["Drive"])
        XCTAssertEqual(model.filteredFields(in: model.filteredCategories[0]).map(\.field), ["Odometer"])
    }

    func testFilterWithNoMatchHidesAllCategories() async {
        let model = FleetTelemetryCoveragePageModel(dataSource: StubSource(response: fixture()))
        await model.load()
        model.filter = "no_such_token"
        XCTAssertTrue(model.filteredCategories.isEmpty)
    }

    // MARK: - Sample seed

    func testSampleDataSourceIsNonEmptyAndConsistent() async throws {
        let response = try await SampleFleetTelemetryCoverageDataSource().load()
        XCTAssertEqual(response.categories.count, 5)
        XCTAssertEqual(response.orphanFields.count, 2)
        XCTAssertTrue(response.categories.allSatisfy { !$0.category.isEmpty })
        XCTAssertTrue(response.categories.allSatisfy { $0.fields.allSatisfy { !$0.field.isEmpty } })

        let stats = FleetTelemetryCoverageStats(response: response)
        XCTAssertEqual(stats.totalRoutedFields, 16)
        XCTAssertEqual(stats.subscribedFields, 12)
        XCTAssertEqual(stats.unsubscribedRoutedFields, 4)
        XCTAssertEqual(response.destinationTotals["signal_log"], 11)
    }

    // MARK: - Formatter (web `fmtInt`)

    func testFormatIntGrouping() {
        XCTAssertEqual(FleetTelemetryCoverageFormat.int(0), "0")
        XCTAssertEqual(FleetTelemetryCoverageFormat.int(42), "42")
        XCTAssertEqual(FleetTelemetryCoverageFormat.int(1234), "1,234")
        XCTAssertEqual(FleetTelemetryCoverageFormat.int(1_000_000), "1,000,000")
    }
}
