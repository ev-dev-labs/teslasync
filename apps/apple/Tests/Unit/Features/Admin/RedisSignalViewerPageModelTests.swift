import XCTest
@testable import TeslaSync

/// State-machine tests for `RedisSignalViewerPageModel` — every data state the page renders
/// (vehicles loading / empty / error / success; signals idle / loading / empty / error / success),
/// the web select → load re-key, and the search + category filter + type/category tallies. The
/// destructive purge flow lives in `RedisSignalViewerPurgeTests`; the pure projections in
/// `RedisSignalViewerProjectionTests`.
@MainActor
final class RedisSignalViewerPageModelTests: XCTestCase {
    // MARK: - Vehicles source states (web `useVehicles`)

    func testInitialStateIsLoadingAndIdle() {
        let model = RedisFixtures.model()
        XCTAssertEqual(model.vehiclesState, .loading)
        XCTAssertEqual(model.signalsState, .idle)
        XCTAssertEqual(model.tablePhase, .selectPrompt)
        XCTAssertFalse(model.hasSelection)
        XCTAssertFalse(model.showsStats)
    }

    func testLoadVehiclesSuccess() async {
        let model = RedisFixtures.model()
        await model.load()
        XCTAssertEqual(model.vehiclesState, .loaded(RedisFixtures.vehicles()))
        XCTAssertEqual(model.vehicles.count, 2)
    }

    func testLoadVehiclesEmpty() async {
        let model = RedisFixtures.model(vehicles: [])
        await model.load()
        XCTAssertEqual(model.vehiclesState, .empty)
    }

    func testLoadVehiclesError() async {
        let model = RedisFixtures.model(vehiclesFail: true)
        await model.load()
        guard case .error = model.vehiclesState else {
            return XCTFail("expected vehicles error, got \(model.vehiclesState)")
        }
    }

    // MARK: - Signals source states (web `['redis-signals', id]`)

    func testSelectingVehicleSetsLoadingSynchronously() async {
        let model = RedisFixtures.model(snapshot: RedisFixtures.snapshot())
        await model.load()
        model.selectVehicle(1)
        XCTAssertTrue(model.hasSelection)
        XCTAssertTrue(model.isLoading)
        XCTAssertEqual(model.tablePhase, .loading)
    }

    func testLoadSignalsSuccessPopulatesTable() async {
        let model = RedisFixtures.model(snapshot: RedisFixtures.snapshot())
        await model.load()
        model.selectVehicle(1)
        await model.loadSignals()
        XCTAssertFalse(model.isLoading)
        XCTAssertEqual(model.totalSignals, 5)
        XCTAssertEqual(model.rows.count, 5)
        guard case .table = model.tablePhase else {
            return XCTFail("expected table phase, got \(model.tablePhase)")
        }
    }

    func testLoadSignalsEmptyYieldsDiagnostic() async {
        let empty = RedisSignalsSnapshot(
            vehicleID: 1,
            signalCount: 0,
            rows: [],
            meta: RedisSignalsMeta(liveSignalStoreMode: "local")
        )
        let model = RedisFixtures.model(snapshot: empty)
        await model.load()
        model.selectVehicle(1)
        await model.loadSignals()
        guard case let .diagnostic(meta, errorMessage) = model.tablePhase else {
            return XCTFail("expected diagnostic, got \(model.tablePhase)")
        }
        XCTAssertNil(errorMessage)
        XCTAssertEqual(meta?.liveSignalStoreMode, "local")
    }

    func testLoadSignalsErrorYieldsDiagnosticWithMessage() async {
        let model = RedisFixtures.model(loadFails: true)
        await model.load()
        model.selectVehicle(1)
        await model.loadSignals()
        XCTAssertTrue(model.isError)
        XCTAssertTrue(model.showsStatDash)
        guard case let .diagnostic(_, errorMessage) = model.tablePhase else {
            return XCTFail("expected diagnostic, got \(model.tablePhase)")
        }
        XCTAssertNotNil(errorMessage)
    }

    func testClearingSelectionReturnsToSelectPrompt() async {
        let model = RedisFixtures.model(snapshot: RedisFixtures.snapshot())
        await model.load()
        model.selectVehicle(1)
        await model.loadSignals()
        model.selectVehicle(nil)
        XCTAssertEqual(model.signalsState, .idle)
        XCTAssertEqual(model.tablePhase, .selectPrompt)
    }

    // MARK: - Filters + tallies (web `filteredRows` / `categoryCounts` / type counts)

    func testSearchFiltersByName() async {
        let model = RedisFixtures.model(snapshot: RedisFixtures.snapshot())
        await model.load()
        model.selectVehicle(1)
        await model.loadSignals()
        model.search = "batt"
        XCTAssertEqual(model.filteredRows.map(\.name), ["battery_level"])
        guard case let .table(rows) = model.tablePhase else {
            return XCTFail("expected table phase")
        }
        XCTAssertEqual(rows.count, 1)
    }

    func testCategoryFilterNarrowsRows() async {
        let model = RedisFixtures.model(snapshot: RedisFixtures.snapshot())
        await model.load()
        model.selectVehicle(1)
        await model.loadSignals()
        model.setCategoryFilter(.climate)
        XCTAssertEqual(model.filteredRows.map(\.name), ["inside_temp"])
    }

    func testNoMatchPhaseWhenFilterExcludesEverything() async {
        let model = RedisFixtures.model(snapshot: RedisFixtures.snapshot())
        await model.load()
        model.selectVehicle(1)
        await model.loadSignals()
        model.search = "zzzz-nope"
        XCTAssertEqual(model.tablePhase, .noMatch)
    }

    func testTypeTalliesAndCategoryCounts() async {
        let model = RedisFixtures.model(snapshot: RedisFixtures.snapshot())
        await model.load()
        model.selectVehicle(1)
        await model.loadSignals()
        // snapshot: battery_level(number), charge_state(string), locked(boolean),
        // latitude(number), inside_temp(number) → 3 numbers, 1 string, 1 boolean.
        XCTAssertEqual(model.numbersCount, 3)
        XCTAssertEqual(model.stringsCount, 1)
        XCTAssertEqual(model.booleansCount, 1)
        XCTAssertEqual(model.count(for: .battery), 1)
        XCTAssertEqual(model.count(for: .charging), 1)
        XCTAssertEqual(model.count(for: .driving), 1) // latitude → driving; `locked` → other
        XCTAssertEqual(model.count(for: .climate), 1)
    }

    func testStatCardsShowDashWhileLoadingAndOnError() async {
        let model = RedisFixtures.model(snapshot: RedisFixtures.snapshot())
        await model.load()
        model.selectVehicle(1)
        XCTAssertTrue(model.showsStatDash) // loading
        await model.loadSignals()
        XCTAssertFalse(model.showsStatDash) // loaded
    }
}
