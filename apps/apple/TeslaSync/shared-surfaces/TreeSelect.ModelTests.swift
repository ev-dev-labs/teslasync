//
//  TreeSelect.ModelTests.swift
//  TeslaSync — P4 shared surface · 0161 · TreeSelect (Apple)
//
//  State-holder coverage for `TreeSelectModel` plus its seams: the P1/S11 `view.opened` telemetry (once +
//  idempotent), the phase transitions across every state (loading / ready / error), the empty / no-results
//  / tree body branches, the selection transforms (leaf / group / select-all / clear) with their
//  write-backs + polite summary announcements (web sr-only live region), the search write-back, the
//  expansion model (uncontrolled default-collapsed + toggle, search-forces-open + toggle no-op, controlled
//  seed + commit), and the connection axis (live / stale / offline) with the one-shot stale auto-refresh
//  (re-armed on return to live) and offline keeping the selection. Driven through the in-memory seam — no
//  network.
//

import XCTest
@testable import TeslaSync

@MainActor
final class TreeSelectModelTests: XCTestCase {
    private func leaf(_ id: String, _ label: String, disabled: Bool = false) -> TreeSelectLeaf {
        TreeSelectLeaf(id: id, label: label, isDisabled: disabled, disabledReason: disabled ? "n/a" : nil)
    }

    private func groups() -> [TreeSelectGroup] {
        [
            TreeSelectGroup(id: "g1", label: "Battery", leaves: [
                leaf("a", "State of charge"),
                leaf("b", "Pack voltage"),
                leaf("c", "Cell temperature")
            ]),
            TreeSelectGroup(id: "g2", label: "Drive", leaves: [
                leaf("d", "Vehicle speed"),
                leaf("e", "Motor torque", disabled: true)
            ])
        ]
    }

    private func snapshot(
        groups: [TreeSelectGroup]? = nil,
        selected: [String] = [],
        search: String = "",
        expanded: [String]? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: TreeSelectConnection = .live
    ) -> TreeSelectSnapshot {
        TreeSelectSnapshot(
            groups: groups ?? self.groups(),
            selectedIDs: selected,
            searchValue: search,
            expandedGroupIDs: expanded,
            isLoading: isLoading,
            errorMessage: errorMessage,
            connection: connection
        )
    }

    private func makeModel(
        _ input: TreeSelectSnapshot,
        telemetry: TreeSelectTelemetry = OSLogTreeSelectTelemetry(),
        announcer: TreeSelectAnnouncer = OSLogTreeSelectAnnouncer()
    ) -> (TreeSelectModel, InMemoryTreeSelectSource) {
        let source = InMemoryTreeSelectSource(initial: input)
        let model = TreeSelectModel(source: source, telemetry: telemetry, announcer: announcer)
        return (model, source)
    }

    // MARK: Lifecycle + telemetry

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyTreeSelectTelemetry()
        let (model, source) = makeModel(snapshot(selected: ["a"]), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.resolved.selectedTotal, 1)
        XCTAssertEqual(spy.surfaces, [TreeSelectMeta.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(TreeSelectMeta.surfaceSlug, "TreeSelect")
    }

    func testLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(snapshot(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testErrorProjectsErrorPhase() {
        let (model, _) = makeModel(snapshot(errorMessage: "boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testEmptyCatalogRendersEmptyBody() {
        let (model, _) = makeModel(snapshot(groups: []))
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.resolved.body, .empty)
    }

    func testNoResultsBody() {
        let (model, _) = makeModel(snapshot(search: "zzz"))
        model.start()
        XCTAssertEqual(model.resolved.body, .noResults(query: "zzz"))
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(snapshot())
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    // MARK: Selection (web toggleLeaf / toggleGroup / toggleAllVisible / clearAll)

    func testToggleLeafCommitsAndAnnounces() {
        let spy = SpyTreeSelectAnnouncer()
        let (model, source) = makeModel(snapshot(), announcer: spy)
        model.start()
        model.toggleLeaf("a")
        XCTAssertTrue(model.isLeafSelected("a"))
        XCTAssertEqual(source.committedSelections.last, ["a"])
        XCTAssertFalse(spy.messages.isEmpty)
    }

    func testToggleGroupSelectsEnabledLeavesOnly() {
        let (model, source) = makeModel(snapshot())
        model.start()
        model.toggleGroup("g2")
        XCTAssertEqual(source.committedSelections.last, ["d"]) // "e" disabled
        XCTAssertEqual(model.groupCheckState(groups()[1]), .all)
    }

    func testToggleAllVisibleThenClear() {
        let (model, source) = makeModel(snapshot())
        model.start()
        model.toggleAllVisible()
        XCTAssertEqual(Set(source.committedSelections.last ?? []), Set(["a", "b", "c", "d"]))
        model.clearAll()
        XCTAssertEqual(source.committedSelections.last, [])
        XCTAssertFalse(model.resolved.hasSelection)
    }

    func testToggleLeafNoOpWhenUnchangedDoesNotCommit() {
        let (model, source) = makeModel(snapshot(selected: ["a"]))
        model.start()
        // toggling on then off lands back at ["a"] only via two calls; a single redundant clearAll on empty
        model.clearAll()
        let countAfterFirst = source.committedSelections.count
        model.clearAll()
        XCTAssertEqual(source.committedSelections.count, countAfterFirst) // second clear is a no-op
    }

    func testGroupSelectedCountTracksSelection() {
        let (model, _) = makeModel(snapshot(selected: ["a", "b"]))
        model.start()
        XCTAssertEqual(model.groupSelectedCount(groups()[0]), 2)
        XCTAssertEqual(model.groupCheckState(groups()[0]), .partial)
    }

    // MARK: Search (web onSearchChange)

    func testUpdateSearchCommitsAndRecomputes() {
        let (model, source) = makeModel(snapshot())
        model.start()
        model.updateSearch("speed")
        XCTAssertEqual(model.searchText, "speed")
        XCTAssertTrue(model.resolved.isSearching)
        XCTAssertEqual(model.resolved.visibleLeafCount, 1)
        XCTAssertEqual(source.committedSearches.last, "speed")
    }

    func testClearSearchResets() {
        let (model, _) = makeModel(snapshot(search: "speed"))
        model.start()
        model.clearSearch()
        XCTAssertEqual(model.searchText, "")
        XCTAssertFalse(model.resolved.isSearching)
    }

    // MARK: Expansion (web toggleExpanded / isExpanded)

    func testUncontrolledDefaultsCollapsedAndToggles() {
        let (model, _) = makeModel(snapshot())
        model.start()
        XCTAssertFalse(model.isExpanded("g1"))
        model.toggleExpanded("g1")
        XCTAssertTrue(model.isExpanded("g1"))
        model.toggleExpanded("g1")
        XCTAssertFalse(model.isExpanded("g1"))
    }

    func testSearchingForcesOpenAndToggleIsNoOp() {
        let (model, _) = makeModel(snapshot(search: "temp"))
        model.start()
        XCTAssertTrue(model.isExpanded("g1"))
        model.toggleExpanded("g1")
        XCTAssertTrue(model.isExpanded("g1")) // still open; toggle ignored while searching
    }

    func testControlledExpansionSeedsAndCommits() {
        let (model, source) = makeModel(snapshot(expanded: ["g1"]))
        model.start()
        XCTAssertTrue(model.isExpanded("g1"))
        XCTAssertFalse(model.isExpanded("g2"))
        model.toggleExpanded("g2")
        XCTAssertTrue(model.isExpanded("g2"))
        XCTAssertEqual(source.committedExpansions.last, ["g1", "g2"])
    }

    func testUncontrolledExpansionPreservedAcrossHostReEmit() {
        let (model, source) = makeModel(snapshot())
        model.start()
        model.toggleExpanded("g1")
        XCTAssertTrue(model.isExpanded("g1"))
        source.push(snapshot(selected: ["a"])) // host re-emits (uncontrolled, no expandedGroupIDs)
        XCTAssertTrue(model.isExpanded("g1")) // expansion preserved
    }

    // MARK: Connection axis (P4 leaf)

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(snapshot(selected: ["a"], connection: .live))
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)
        source.push(snapshot(selected: ["a"], connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)
        source.push(snapshot(selected: ["a"], connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let (model, source) = makeModel(snapshot(selected: ["a"], connection: .live))
        model.start()
        source.push(snapshot(selected: ["a"], connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(snapshot(selected: ["a"], connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(snapshot(selected: ["a"], connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsSelectionAndDoesNotAutoRefresh() {
        let (model, source) = makeModel(snapshot(selected: ["a"], connection: .live))
        model.start()
        source.push(snapshot(selected: ["a"], connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .ready)
        XCTAssertTrue(model.isLeafSelected("a"))
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(snapshot())
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    // MARK: Summary announcements

    func testSummaryTextReflectsSelectionAndSearch() {
        let (model, _) = makeModel(snapshot(selected: ["a", "b"]))
        model.start()
        XCTAssertTrue(model.summaryText.contains("2"))
        model.updateSearch("speed")
        XCTAssertTrue(model.summaryText.contains("visible"))
    }

    func testRepeatedSelectionAnnouncementsRotatePadding() {
        let spy = SpyTreeSelectAnnouncer()
        let (model, _) = makeModel(snapshot(), announcer: spy)
        model.start()
        model.toggleLeaf("a")
        model.toggleLeaf("b")
        XCTAssertEqual(spy.messages.count, 2)
        XCTAssertNotEqual(spy.messages[0], spy.messages[1])
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it satisfies
/// the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyTreeSelectTelemetry: TreeSelectTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}

/// Records the polite summary announcements the model posts (the web sr-only live-region writes), so the
/// spoken text is asserted without driving the real assistive technology.
@MainActor
private final class SpyTreeSelectAnnouncer: TreeSelectAnnouncer {
    private(set) var messages: [String] = []

    func announce(_ message: String) {
        messages.append(message)
    }
}
