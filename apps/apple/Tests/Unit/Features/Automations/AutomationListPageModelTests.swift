import XCTest
@testable import TeslaSync

/// Recording double for the `AutomationListPage` data-source seam, at file scope so the test class
/// body stays within the project's `type_body_length` budget.
private actor AutomationListStub: AutomationListDataSource {
    var automations: [AutomationListItem]
    var automationsError: Error?
    var outcome: AutomationBulkOutcome
    var bulkError: Error?

    private(set) var bulkCalls: [(ids: [Int64], op: AutomationBulkOperation)] = []

    init(
        automations: [AutomationListItem] = [],
        automationsError: Error? = nil,
        outcome: AutomationBulkOutcome = AutomationBulkOutcome(),
        bulkError: Error? = nil
    ) {
        self.automations = automations
        self.automationsError = automationsError
        self.outcome = outcome
        self.bulkError = bulkError
    }

    func setAutomations(_ items: [AutomationListItem]) {
        automations = items
    }

    func useAutomations() async throws -> [AutomationListItem] {
        if let automationsError { throw automationsError }
        return automations
    }

    func useBulkAutomationsUpdate(ids: [Int64], op: AutomationBulkOperation) async throws -> AutomationBulkOutcome {
        bulkCalls.append((ids, op))
        if let bulkError { throw bulkError }
        return outcome
    }
}

private struct AutomationListTestError: Error {}

private func makeItem(_ id: Int64, name: String = "Auto", enabled: Bool = true) -> AutomationListItem {
    AutomationListItem(id: id, name: name, enabled: enabled)
}

/// State-machine + projection tests for `AutomationListPageModel`: the page phase, the table-region
/// state, the bulk selection (toggle / select-all state / prune), and the bulk mutation.
@MainActor
final class AutomationListPageModelTests: XCTestCase {
    // MARK: - Phase + table state

    func testInitialPhaseIsLoading() {
        let model = AutomationListPageModel(dataSource: AutomationListStub())
        XCTAssertEqual(model.phase, .loading)
        XCTAssertEqual(model.tableState, .loading)
        XCTAssertTrue(model.items.isEmpty)
    }

    func testLoadSuccessYieldsSuccessTable() async {
        let stub = AutomationListStub(automations: [makeItem(1), makeItem(2)])
        let model = AutomationListPageModel(dataSource: stub)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.items.count, 2)
        XCTAssertEqual(model.tableState, .success)
        XCTAssertEqual(model.visibleIDs, [1, 2])
    }

    func testLoadEmptyYieldsEmptyTable() async {
        let model = AutomationListPageModel(dataSource: AutomationListStub(automations: []))
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.tableState, .empty)
    }

    func testLoadFailureYieldsErrorTable() async {
        let stub = AutomationListStub(automationsError: AutomationListTestError())
        let model = AutomationListPageModel(dataSource: stub)
        await model.load()
        guard case .error = model.phase else { return XCTFail("expected error phase") }
        XCTAssertEqual(model.tableState, .error)
        XCTAssertNotNil(model.errorMessage)
    }

    // MARK: - Selection

    func testToggleSelectsAndDeselects() async {
        let model = AutomationListPageModel(dataSource: AutomationListStub(automations: [makeItem(1)]))
        await model.load()
        XCTAssertFalse(model.isSelected(1))
        model.toggle(1)
        XCTAssertTrue(model.isSelected(1))
        XCTAssertTrue(model.hasSelection)
        XCTAssertEqual(model.selectedCount, 1)
        model.toggle(1)
        XCTAssertFalse(model.isSelected(1))
        XCTAssertFalse(model.hasSelection)
    }

    func testSelectAllStateTransitions() async {
        let stub = AutomationListStub(automations: [makeItem(1), makeItem(2), makeItem(3)])
        let model = AutomationListPageModel(dataSource: stub)
        await model.load()
        XCTAssertEqual(model.selectAllState, .none)
        model.toggle(1)
        XCTAssertEqual(model.selectAllState, .some)
        model.toggle(2)
        model.toggle(3)
        XCTAssertEqual(model.selectAllState, .all)
    }

    func testToggleAllSelectsThenClears() async {
        let stub = AutomationListStub(automations: [makeItem(1), makeItem(2), makeItem(3)])
        let model = AutomationListPageModel(dataSource: stub)
        await model.load()
        model.toggleAll()
        XCTAssertEqual(model.selectedCount, 3)
        XCTAssertEqual(model.selectAllState, .all)
        model.toggleAll()
        XCTAssertEqual(model.selectedCount, 0)
        XCTAssertEqual(model.selectAllState, .none)
    }

    func testClearSelection() async {
        let model = AutomationListPageModel(dataSource: AutomationListStub(automations: [makeItem(1)]))
        await model.load()
        model.toggle(1)
        model.clearSelection()
        XCTAssertFalse(model.hasSelection)
    }

    func testReloadPrunesStaleSelection() async {
        let stub = AutomationListStub(automations: [makeItem(1), makeItem(2), makeItem(3)])
        let model = AutomationListPageModel(dataSource: stub)
        await model.load()
        model.toggle(1)
        model.toggle(2)
        await stub.setAutomations([makeItem(2), makeItem(3)])
        await model.refresh()
        XCTAssertTrue(model.isSelected(2))
        XCTAssertFalse(model.isSelected(1))
        XCTAssertEqual(model.selectedCount, 1)
    }

    // MARK: - Noun

    func testSelectionNounKeySingularThenPlural() async {
        let stub = AutomationListStub(automations: [makeItem(1), makeItem(2)])
        let model = AutomationListPageModel(dataSource: stub)
        await model.load()
        model.toggle(1)
        XCTAssertEqual(model.selectionNounKey, "automationList.noun.one")
        model.toggle(2)
        XCTAssertEqual(model.selectionNounKey, "automationList.noun.other")
    }

    // MARK: - Bulk mutation

    func testPerformBulkEnableForwardsClearsAndRefetches() async {
        let stub = AutomationListStub(
            automations: [makeItem(1), makeItem(2)],
            outcome: AutomationBulkOutcome(updated: 2)
        )
        let model = AutomationListPageModel(dataSource: stub)
        await model.load()
        model.toggle(1)
        model.toggle(2)
        await model.performBulk(.enable)
        let calls = await stub.bulkCalls
        XCTAssertEqual(calls.count, 1)
        XCTAssertEqual(calls.first?.ids, [1, 2])
        XCTAssertEqual(calls.first?.op, .enable)
        XCTAssertFalse(model.hasSelection)
        XCTAssertEqual(model.lastOutcome?.updated, 2)
        XCTAssertNil(model.runningOperation)
    }

    func testPerformBulkDeleteReportsDeletedCount() async {
        let stub = AutomationListStub(
            automations: [makeItem(1)],
            outcome: AutomationBulkOutcome(deleted: 1)
        )
        let model = AutomationListPageModel(dataSource: stub)
        await model.load()
        model.toggle(1)
        await model.performBulk(.delete)
        let calls = await stub.bulkCalls
        XCTAssertEqual(calls.first?.op, .delete)
        XCTAssertEqual(model.lastOutcome?.deleted, 1)
    }

    func testPerformBulkIgnoredWhenNoSelection() async {
        let stub = AutomationListStub(automations: [makeItem(1)])
        let model = AutomationListPageModel(dataSource: stub)
        await model.load()
        await model.performBulk(.enable)
        let calls = await stub.bulkCalls
        XCTAssertTrue(calls.isEmpty)
    }

    func testPerformBulkFailureKeepsSelection() async {
        let stub = AutomationListStub(
            automations: [makeItem(1)],
            bulkError: AutomationListTestError()
        )
        let model = AutomationListPageModel(dataSource: stub)
        await model.load()
        model.toggle(1)
        await model.performBulk(.disable)
        XCTAssertTrue(model.isSelected(1))
        XCTAssertNil(model.lastOutcome)
        XCTAssertNil(model.runningOperation)
    }
}
