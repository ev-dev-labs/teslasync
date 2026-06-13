import XCTest
@testable import TeslaSync

/// Recording double for the data-source seam, at file scope so the test class body stays within
/// the project's `type_body_length` budget.
private actor AutomationsListStub: AutomationsListDataSource {
    var automations: [AutomationListItem]
    var vehicles: [AutomationVehicleRef]
    var pins: [AutomationPin]
    var feed: AutomationLiveFeed?
    var automationsError: Error?
    var importFailure: Error?

    private(set) var toggleCalls: [(id: Int64, enabled: Bool)] = []
    private(set) var reEnabledIDs: [Int64] = []
    private(set) var deletedIDs: [Int64] = []
    private(set) var testRunIDs: [Int64] = []
    private(set) var importedCount = 0

    init(
        automations: [AutomationListItem] = [],
        vehicles: [AutomationVehicleRef] = [],
        pins: [AutomationPin] = [],
        feed: AutomationLiveFeed? = nil,
        automationsError: Error? = nil,
        importFailure: Error? = nil
    ) {
        self.automations = automations
        self.vehicles = vehicles
        self.pins = pins
        self.feed = feed
        self.automationsError = automationsError
        self.importFailure = importFailure
    }

    func useAutomations() async throws -> [AutomationListItem] {
        if let automationsError { throw automationsError }
        return automations
    }

    func useVehicles() async throws -> [AutomationVehicleRef] {
        vehicles
    }

    func usePinned(_: String) async throws -> [AutomationPin] {
        pins
    }

    func useAutomationHistory(limit _: Int) async throws -> AutomationLiveFeed? {
        feed
    }

    func useToggleAutomation(id: Int64, enabled: Bool) async throws {
        toggleCalls.append((id, enabled))
    }

    func useReEnableAutomation(id: Int64) async throws {
        reEnabledIDs.append(id)
    }

    func useDeleteAutomation(id: Int64) async throws {
        deletedIDs.append(id)
    }

    func useTestRunAutomation(id: Int64) async throws {
        testRunIDs.append(id)
    }

    func importAutomations(_: AutomationImportEnvelope) async throws {
        if let importFailure { throw importFailure }
        importedCount += 1
    }
}

private struct AutomationsListTestError: Error {}

private func makeItem(
    _ id: Int64,
    name: String = "Auto",
    enabled: Bool = true,
    autoDisabled: Bool = false,
    description: String? = nil,
    vehicleID: Int64? = nil
) -> AutomationListItem {
    AutomationListItem(
        id: id,
        name: name,
        description: description,
        vehicleID: vehicleID,
        enabled: enabled,
        autoDisabled: autoDisabled
    )
}

/// State-machine + projection tests for `AutomationsListPageModel`: the page phase, the
/// cards-region state, the status/search filters, the pin sort, the row mutations, the typed
/// import, and the embedded activity-feed projection.
@MainActor
final class AutomationsListPageModelTests: XCTestCase {
    // MARK: - Phase

    func testInitialPhaseIsLoading() {
        let model = AutomationsListPageModel(dataSource: AutomationsListStub())
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.items.isEmpty)
    }

    func testLoadSuccessYieldsReady() async {
        let stub = AutomationsListStub(automations: [makeItem(1), makeItem(2)])
        let model = AutomationsListPageModel(dataSource: stub)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.items.count, 2)
        XCTAssertEqual(model.cardsState, .success)
    }

    func testLoadEmptyYieldsReadyWithEmptyCards() async {
        let model = AutomationsListPageModel(dataSource: AutomationsListStub(automations: []))
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.cardsState, .empty)
    }

    func testLoadFailureYieldsError() async {
        let stub = AutomationsListStub(automationsError: AutomationsListTestError())
        let model = AutomationsListPageModel(dataSource: stub)
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected error phase")
        }
    }

    // MARK: - Stats + filters

    func testStatsReducerMatchesWebPrecedence() async {
        let items = [
            makeItem(1, enabled: true),
            makeItem(2, enabled: false),
            makeItem(3, enabled: true, autoDisabled: true),
            makeItem(4, enabled: false, autoDisabled: true)
        ]
        let model = AutomationsListPageModel(dataSource: AutomationsListStub(automations: items))
        await model.load()
        XCTAssertEqual(model.stats.total, 4)
        XCTAssertEqual(model.stats.active, 1)
        XCTAssertEqual(model.stats.disabled, 1)
        XCTAssertEqual(model.stats.autoDisabled, 2)
        XCTAssertTrue(model.stats.hasAutoDisabled)
    }

    func testStatusFilterActive() async {
        let stub = AutomationsListStub(automations: [
            makeItem(1, enabled: true),
            makeItem(2, enabled: false),
            makeItem(3, enabled: true, autoDisabled: true)
        ])
        let model = AutomationsListPageModel(dataSource: stub)
        await model.load()
        model.setStatusFilter(.active)
        XCTAssertEqual(model.filteredItems.map(\.id), [1])
        XCTAssertTrue(model.showsFilterCount)
        XCTAssertEqual(model.filterCountText, "1 / 3")
    }

    func testStatusFilterAutoDisabled() async {
        let stub = AutomationsListStub(automations: [
            makeItem(1, enabled: true),
            makeItem(2, enabled: false, autoDisabled: true)
        ])
        let model = AutomationsListPageModel(dataSource: stub)
        await model.load()
        model.setStatusFilter(.autoDisabled)
        XCTAssertEqual(model.filteredItems.map(\.id), [2])
    }

    func testSearchFiltersNameAndDescription() async {
        let stub = AutomationsListStub(automations: [
            makeItem(1, name: "Precondition cabin"),
            makeItem(2, name: "Charge limit", description: "overnight"),
            makeItem(3, name: "Lock doors")
        ])
        let model = AutomationsListPageModel(dataSource: stub)
        await model.load()
        model.setSearch("over")
        XCTAssertEqual(model.filteredItems.map(\.id), [2])
        model.setSearch("LOCK")
        XCTAssertEqual(model.filteredItems.map(\.id), [3])
    }

    func testNoMatchState() async {
        let stub = AutomationsListStub(automations: [makeItem(1, name: "A")])
        let model = AutomationsListPageModel(dataSource: stub)
        await model.load()
        model.setSearch("zzz")
        XCTAssertEqual(model.cardsState, .noMatch)
    }

    func testResetFilters() async {
        let model = AutomationsListPageModel(dataSource: AutomationsListStub(automations: [makeItem(1)]))
        await model.load()
        model.setSearch("zzz")
        model.setStatusFilter(.disabled)
        model.resetFilters()
        XCTAssertEqual(model.search, "")
        XCTAssertEqual(model.statusFilter, .all)
        XCTAssertFalse(model.showsFilterCount)
    }

    // MARK: - Pin sort

    func testPinnedItemsSortFirst() async {
        let stub = AutomationsListStub(
            automations: [makeItem(1, name: "A"), makeItem(2, name: "B"), makeItem(3, name: "C")],
            pins: [AutomationPin(itemID: "3", position: 0)]
        )
        let model = AutomationsListPageModel(dataSource: stub)
        await model.load()
        XCTAssertEqual(model.sortedItems.map(\.id), [3, 1, 2])
    }

    func testTogglePinReorders() async {
        let model = AutomationsListPageModel(dataSource: AutomationsListStub(automations: [makeItem(1), makeItem(2)]))
        await model.load()
        XCTAssertFalse(model.isPinned(makeItem(2)))
        model.togglePin(makeItem(2))
        XCTAssertTrue(model.isPinned(makeItem(2)))
        XCTAssertEqual(model.sortedItems.first?.id, 2)
        model.togglePin(makeItem(2))
        XCTAssertFalse(model.isPinned(makeItem(2)))
    }

    // MARK: - Mutations

    func testToggleEnablesNormally() async {
        let stub = AutomationsListStub(automations: [makeItem(1, enabled: true)])
        let model = AutomationsListPageModel(dataSource: stub)
        await model.load()
        await model.toggle(makeItem(1, enabled: true), to: false)
        let calls = await stub.toggleCalls
        XCTAssertEqual(calls.count, 1)
        XCTAssertEqual(calls.first?.id, 1)
        XCTAssertEqual(calls.first?.enabled, false)
        XCTAssertEqual(model.items.first?.enabled, false)
    }

    func testToggleAutoDisabledOnReEnables() async {
        let auto = makeItem(1, enabled: false, autoDisabled: true)
        let stub = AutomationsListStub(automations: [auto])
        let model = AutomationsListPageModel(dataSource: stub)
        await model.load()
        await model.toggle(auto, to: true)
        let reEnabled = await stub.reEnabledIDs
        let toggles = await stub.toggleCalls
        XCTAssertEqual(reEnabled, [1])
        XCTAssertTrue(toggles.isEmpty)
        XCTAssertFalse(model.items.first?.autoDisabled ?? true)
        XCTAssertTrue(model.items.first?.enabled ?? false)
    }

    func testDeleteRemovesItem() async {
        let stub = AutomationsListStub(automations: [makeItem(1), makeItem(2)])
        let model = AutomationsListPageModel(dataSource: stub)
        await model.load()
        await model.delete(makeItem(1))
        let deleted = await stub.deletedIDs
        XCTAssertEqual(deleted, [1])
        XCTAssertEqual(model.items.map(\.id), [2])
    }

    func testTestRunForwards() async {
        let stub = AutomationsListStub(automations: [makeItem(1)])
        let model = AutomationsListPageModel(dataSource: stub)
        await model.load()
        await model.testRun(makeItem(1))
        let ran = await stub.testRunIDs
        XCTAssertEqual(ran, [1])
    }

    // MARK: - Import

    func testImportValidEnvelopeReloads() async {
        let stub = AutomationsListStub(automations: [makeItem(1)])
        let model = AutomationsListPageModel(dataSource: stub)
        await model.load()
        let data = Data(#"{"version":1,"automations":[{"name":"x"}]}"#.utf8)
        await model.importAutomations(from: data)
        let imported = await stub.importedCount
        XCTAssertEqual(imported, 1)
        XCTAssertNil(model.importError)
    }

    func testImportRejectsUntypedEnvelope() async {
        let model = AutomationsListPageModel(dataSource: AutomationsListStub())
        await model.load()
        await model.importAutomations(from: Data(#"{"foo":1}"#.utf8))
        XCTAssertEqual(model.importError, .typedEnvelopeRequired)
    }

    func testImportRejectsUnreadable() async {
        let model = AutomationsListPageModel(dataSource: AutomationsListStub())
        await model.load()
        await model.importAutomations(from: Data("not json".utf8))
        XCTAssertEqual(model.importError, .unreadable)
    }

    func testClearImportError() async {
        let model = AutomationsListPageModel(dataSource: AutomationsListStub())
        await model.importAutomations(from: Data("x".utf8))
        XCTAssertNotNil(model.importError)
        model.clearImportError()
        XCTAssertNil(model.importError)
    }

    // MARK: - Activity feed + vehicle lookup

    func testActivityStateLoadingByDefault() {
        let model = AutomationsListPageModel(dataSource: AutomationsListStub())
        XCTAssertEqual(model.activityState, .loading)
    }

    func testActivitySuccessAndStatsGate() async {
        let feed = AutomationLiveFeed(
            snapshot: AutomationActivityFeedSnapshot(
                runs: [AutomationActivityRun(id: "r1", name: "x", status: .success)],
                stats: AutomationActivityStats(totalRuns: 10, successRate: 90, avgDurationMs: 1000)
            ),
            firingIDs: [1]
        )
        let stub = AutomationsListStub(automations: [makeItem(1)], feed: feed)
        let model = AutomationsListPageModel(dataSource: stub)
        await model.load()
        XCTAssertEqual(model.activityState, .success)
        XCTAssertEqual(model.activityStats?.totalRuns, 10)
        XCTAssertTrue(model.isFiring(makeItem(1)))
    }

    func testActivityEmptyAndStatsGateHidesZero() async {
        let feed = AutomationLiveFeed(
            snapshot: AutomationActivityFeedSnapshot(
                runs: [],
                stats: AutomationActivityStats(totalRuns: 0, successRate: 0, avgDurationMs: 0)
            )
        )
        let model = AutomationsListPageModel(dataSource: AutomationsListStub(feed: feed))
        await model.load()
        XCTAssertEqual(model.activityState, .empty)
        XCTAssertNil(model.activityStats)
    }

    func testVehicleNameLookup() async {
        let stub = AutomationsListStub(
            automations: [makeItem(1, vehicleID: 7), makeItem(2, vehicleID: nil)],
            vehicles: [AutomationVehicleRef(id: 7, displayName: "Rocinante")]
        )
        let model = AutomationsListPageModel(dataSource: stub)
        await model.load()
        XCTAssertEqual(model.vehicleName(for: makeItem(1, vehicleID: 7)), "Rocinante")
        XCTAssertNil(model.vehicleName(for: makeItem(2, vehicleID: nil)))
    }
}
