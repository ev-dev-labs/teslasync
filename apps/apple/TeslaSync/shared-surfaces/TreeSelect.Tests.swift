//
//  TreeSelect.Tests.swift
//  TeslaSync — P4 shared surface · 0161 · TreeSelect (Apple)
//
//  Adapter + projection + seam coverage for the TreeSelect surface — the Swift port of the web behaviour
//  (components/forms/TreeSelect.tsx):
//    • filterGroups — empty-needle fast path, group-label match keeps all leaves, leaf-label match keeps
//      the matching leaves, empty groups drop, case-insensitive (web `filterGroups`).
//    • buildRows — group rows always, leaf rows only when expanded, disabled flag (web `buildRows`).
//    • toggleLeaf / toggleIDs / toggleGroup / toggleAllVisible — add / remove, clear-when-all, merge
//      preserving order + out-of-filter picks, disabled leaves untouched (web selection transforms).
//    • counts + tri-state — visible / enabled / total / per-group + aggregate none / partial / all.
//    • interpolate / announcementPadding — i18next + the sr-only re-read dedupe.
//    • Projection — error / loading / empty / no-results / tree (web branches + P4 leaf).
//    • Seams — Live (start / update / commit write-backs / refresh) + InMemory (records / push).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no real store — each assertion reads the
//  pure core or the in-memory seam directly.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum TreeFixture {
    static func leaf(_ id: String, _ label: String, disabled: Bool = false) -> TreeSelectLeaf {
        TreeSelectLeaf(id: id, label: label, isDisabled: disabled, disabledReason: disabled ? "n/a" : nil)
    }

    static func groups() -> [TreeSelectGroup] {
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
}

// MARK: - filterGroups (web filterGroups)

final class TreeSelectFilterTests: XCTestCase {
    func testEmptyNeedleReturnsInputUnchanged() {
        let groups = TreeFixture.groups()
        XCTAssertEqual(TreeSelectEngine.filterGroups(groups, needle: "   "), groups)
    }

    func testGroupLabelMatchKeepsAllLeaves() {
        let filtered = TreeSelectEngine.filterGroups(TreeFixture.groups(), needle: "battery")
        XCTAssertEqual(filtered.count, 1)
        XCTAssertEqual(filtered.first?.leaves.count, 3)
    }

    func testLeafLabelMatchKeepsOnlyMatchingLeaves() {
        let filtered = TreeSelectEngine.filterGroups(TreeFixture.groups(), needle: "speed")
        XCTAssertEqual(filtered.count, 1)
        XCTAssertEqual(filtered.first?.id, "g2")
        XCTAssertEqual(filtered.first?.leaves.map(\.id), ["d"])
    }

    func testCaseInsensitiveAcrossGroups() {
        let filtered = TreeSelectEngine.filterGroups(TreeFixture.groups(), needle: "TEMP")
        XCTAssertEqual(filtered.count, 1)
        XCTAssertEqual(filtered.first?.leaves.map(\.id), ["c"])
    }

    func testNoMatchDropsEveryGroup() {
        XCTAssertTrue(TreeSelectEngine.filterGroups(TreeFixture.groups(), needle: "zzz").isEmpty)
    }

    func testIsSearching() {
        XCTAssertFalse(TreeSelectEngine.isSearching("  "))
        XCTAssertTrue(TreeSelectEngine.isSearching(" a "))
    }
}

// MARK: - buildRows (web buildRows)

final class TreeSelectRowTests: XCTestCase {
    func testCollapsedGroupsEmitOnlyHeaders() {
        let rows = TreeSelectEngine.buildRows(TreeFixture.groups()) { _ in false }
        XCTAssertEqual(rows.map(\.kind), [.group, .group])
    }

    func testExpandedGroupEmitsLeavesWithDisabledFlag() {
        let rows = TreeSelectEngine.buildRows(TreeFixture.groups()) { $0 == "g2" }
        XCTAssertEqual(rows.count, 4)
        let leaves = rows.filter { $0.kind == .leaf }
        XCTAssertEqual(leaves.map(\.leafID), ["d", "e"])
        XCTAssertEqual(leaves.first { $0.leafID == "e" }?.isDisabled, true)
    }

    func testRowIdentityIsStable() {
        let rows = TreeSelectEngine.buildRows(TreeFixture.groups()) { _ in true }
        XCTAssertEqual(rows.first?.id, "group:g1")
        XCTAssertEqual(rows.first { $0.leafID == "a" }?.id, "leaf:g1:a")
    }
}

// MARK: - Selection transforms (web toggleLeaf / toggleGroup / toggleAllVisible)

final class TreeSelectSelectionTests: XCTestCase {
    func testToggleLeafAddsThenRemovesPreservingOrder() {
        var sel = TreeSelectEngine.toggleLeaf("b", in: ["a"])
        XCTAssertEqual(sel, ["a", "b"])
        sel = TreeSelectEngine.toggleLeaf("a", in: sel)
        XCTAssertEqual(sel, ["b"])
    }

    func testToggleIDsMergesPreservingExistingOrderAndOutsidePicks() {
        let result = TreeSelectEngine.toggleIDs(["b", "c"], in: ["z", "b"])
        XCTAssertEqual(result, ["z", "b", "c"])
    }

    func testToggleIDsClearsWhenAllAlreadySelected() {
        let result = TreeSelectEngine.toggleIDs(["b", "c"], in: ["z", "b", "c"])
        XCTAssertEqual(result, ["z"])
    }

    func testToggleGroupSelectsVisibleEnabledOnly() {
        let groups = TreeFixture.groups()
        let result = TreeSelectEngine.toggleGroup("g2", filtered: groups, selected: [])
        XCTAssertEqual(result, ["d"]) // "e" is disabled, excluded
    }

    func testToggleGroupClearsWhenAllEnabledSelected() {
        let groups = TreeFixture.groups()
        let result = TreeSelectEngine.toggleGroup("g1", filtered: groups, selected: ["a", "b", "c"])
        XCTAssertEqual(result, [])
    }

    func testToggleGroupUnknownIsNoOp() {
        let groups = TreeFixture.groups()
        XCTAssertEqual(TreeSelectEngine.toggleGroup("nope", filtered: groups, selected: ["a"]), ["a"])
    }

    func testToggleAllVisibleSpansGroupsAndSkipsDisabled() {
        let groups = TreeFixture.groups()
        let result = TreeSelectEngine.toggleAllVisible(filtered: groups, selected: [])
        XCTAssertEqual(Set(result), Set(["a", "b", "c", "d"]))
        XCTAssertFalse(result.contains("e"))
    }

    func testToggleAllVisibleEmptyIsNoOp() {
        XCTAssertEqual(TreeSelectEngine.toggleAllVisible(filtered: [], selected: ["x"]), ["x"])
    }
}

// MARK: - Counts + tri-state

final class TreeSelectCountTests: XCTestCase {
    func testVisibleLeafIDsIncludeDisabled() {
        let ids = TreeSelectEngine.visibleLeafIDs(TreeFixture.groups())
        XCTAssertEqual(ids, ["a", "b", "c", "d", "e"])
    }

    func testEnabledLeafIDsExcludeDisabled() {
        XCTAssertEqual(TreeSelectEngine.enabledLeafIDs(in: TreeFixture.groups()), ["a", "b", "c", "d"])
    }

    func testTotalLeafCount() {
        XCTAssertEqual(TreeSelectEngine.totalLeafCount(TreeFixture.groups()), 5)
    }

    func testGroupCheckStateAllPartialNone() {
        let groups = TreeFixture.groups()
        let battery = groups[0]
        XCTAssertEqual(TreeSelectEngine.groupCheckState(battery, selected: ["a", "b", "c"]), .all)
        XCTAssertEqual(TreeSelectEngine.groupCheckState(battery, selected: ["a"]), .partial)
        XCTAssertEqual(TreeSelectEngine.groupCheckState(battery, selected: []), .none)
    }

    func testGroupCheckStateAllWhenEnabledSelectedDespiteDisabled() {
        let drive = TreeFixture.groups()[1] // d (enabled), e (disabled)
        XCTAssertEqual(TreeSelectEngine.groupCheckState(drive, selected: ["d"]), .all)
    }

    func testAggregateCheckState() {
        let ids = ["a", "b", "c"]
        XCTAssertEqual(TreeSelectEngine.aggregateCheckState(visibleLeafIDs: ids, selected: ["a", "b", "c"]), .all)
        XCTAssertEqual(TreeSelectEngine.aggregateCheckState(visibleLeafIDs: ids, selected: ["a"]), .partial)
        XCTAssertEqual(TreeSelectEngine.aggregateCheckState(visibleLeafIDs: ids, selected: []), .none)
        XCTAssertEqual(TreeSelectEngine.aggregateCheckState(visibleLeafIDs: [], selected: ["a"]), .none)
    }
}

// MARK: - Interpolation + padding

final class TreeSelectInterpolationTests: XCTestCase {
    func testInterpolateReplacesTokens() {
        let out = TreeSelectEngine.interpolate("{{count}} of {{total}}", ["count": "2", "total": "9"])
        XCTAssertEqual(out, "2 of 9")
    }

    func testAnnouncementPaddingRotatesModFour() {
        XCTAssertEqual(TreeSelectEngine.announcementPadding(sequence: 0).count, 0)
        XCTAssertEqual(TreeSelectEngine.announcementPadding(sequence: 1).count, 1)
        XCTAssertEqual(TreeSelectEngine.announcementPadding(sequence: 4).count, 0)
        XCTAssertEqual(TreeSelectEngine.announcementPadding(sequence: 5).count, 1)
    }
}

// MARK: - Projection (web branches + P4 leaf)

final class TreeSelectProjectionTests: XCTestCase {
    private func snapshot(
        groups: [TreeSelectGroup] = TreeFixture.groups(),
        selected: [String] = [],
        search: String = "",
        isLoading: Bool = false,
        errorMessage: String? = nil
    ) -> TreeSelectSnapshot {
        TreeSelectSnapshot(
            groups: groups,
            selectedIDs: selected,
            searchValue: search,
            isLoading: isLoading,
            errorMessage: errorMessage
        )
    }

    func testErrorMessageProjectsErrorPhase() {
        XCTAssertEqual(TreeSelectProjection.resolve(snapshot(errorMessage: "boom")).phase, .error("boom"))
    }

    func testEmptyErrorMessageDoesNotForceError() {
        XCTAssertEqual(TreeSelectProjection.resolve(snapshot(errorMessage: "")).phase, .ready)
    }

    func testLoadingProjectsLoadingPhase() {
        XCTAssertEqual(TreeSelectProjection.resolve(snapshot(isLoading: true)).phase, .loading)
    }

    func testEmptyCatalogProjectsEmptyBody() {
        let resolved = TreeSelectProjection.resolve(snapshot(groups: []))
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertEqual(resolved.body, .empty)
    }

    func testNoResultsBodyCarriesTrimmedQuery() {
        let resolved = TreeSelectProjection.resolve(snapshot(search: "  zzz  "))
        XCTAssertEqual(resolved.body, .noResults(query: "zzz"))
    }

    func testTreeBodyWhenPopulated() {
        let resolved = TreeSelectProjection.resolve(snapshot())
        XCTAssertEqual(resolved.body, .tree)
        XCTAssertEqual(resolved.filteredGroups.count, 2)
        XCTAssertFalse(resolved.isSearching)
    }

    func testCountsAndAggregate() {
        let resolved = TreeSelectProjection.resolve(snapshot(selected: ["a", "b"]))
        XCTAssertEqual(resolved.totalLeafCount, 5)
        XCTAssertEqual(resolved.selectedTotal, 2)
        XCTAssertEqual(resolved.visibleLeafCount, 5)
        XCTAssertEqual(resolved.aggregateState, .partial)
        XCTAssertFalse(resolved.selectAllDisabled)
        XCTAssertTrue(resolved.hasSelection)
    }

    func testSearchingNarrowsVisibleCountAndFlagsSearching() {
        let resolved = TreeSelectProjection.resolve(snapshot(search: "speed"))
        XCTAssertTrue(resolved.isSearching)
        XCTAssertEqual(resolved.visibleLeafCount, 1)
        XCTAssertEqual(resolved.totalLeafCount, 5)
    }

    func testSelectAllDisabledWhenNothingVisible() {
        let resolved = TreeSelectProjection.resolve(snapshot(search: "zzz"))
        XCTAssertTrue(resolved.selectAllDisabled)
    }

    func testCustomOverridesCarried() {
        var input = snapshot()
        input.searchPrompt = "Find a signal"
        input.emptyText = "Nothing here"
        input.noResultsText = "No hits"
        input.ariaLabel = "Signal picker"
        let resolved = TreeSelectProjection.resolve(input)
        XCTAssertEqual(resolved.customSearchPrompt, "Find a signal")
        XCTAssertEqual(resolved.customEmptyText, "Nothing here")
        XCTAssertEqual(resolved.customNoResultsText, "No hits")
        XCTAssertEqual(resolved.customAriaLabel, "Signal picker")
    }
}

// MARK: - Live source (production controlled bridge + write-backs)

@MainActor
final class LiveTreeSelectSourceTests: XCTestCase {
    func testStartEmitsInitialValue() {
        let source = LiveTreeSelectSource(value: TreeSelectSnapshot(selectedIDs: ["a"]))
        var latest: TreeSelectSnapshot?
        source.onUpdate = { latest = $0 }
        source.start()
        XCTAssertEqual(latest?.selectedIDs, ["a"])
    }

    func testCommitSelectionForwardsAndReEmits() {
        var committed: [[String]] = []
        let source = LiveTreeSelectSource(onChangeSelection: { committed.append($0) })
        var emissions: [[String]] = []
        source.onUpdate = { emissions.append($0.selectedIDs) }
        source.start()
        source.commitSelection(["a", "b"])
        XCTAssertEqual(committed, [["a", "b"]])
        XCTAssertEqual(emissions.last, ["a", "b"])
    }

    func testCommitSearchForwardsAndReEmits() {
        var searches: [String] = []
        let source = LiveTreeSelectSource(onChangeSearch: { searches.append($0) })
        var latest: TreeSelectSnapshot?
        source.onUpdate = { latest = $0 }
        source.start()
        source.commitSearch("temp")
        XCTAssertEqual(searches, ["temp"])
        XCTAssertEqual(latest?.searchValue, "temp")
    }

    func testCommitExpandedForwardsAndReEmits() {
        var expansions: [[String]] = []
        let source = LiveTreeSelectSource(onChangeExpanded: { expansions.append($0) })
        var latest: TreeSelectSnapshot?
        source.onUpdate = { latest = $0 }
        source.start()
        source.commitExpanded(["g1"])
        XCTAssertEqual(expansions, [["g1"]])
        XCTAssertEqual(latest?.expandedGroupIDs, ["g1"])
    }

    func testUpdateReEmitsNewSnapshot() {
        let source = LiveTreeSelectSource()
        var latest: TreeSelectSnapshot?
        source.onUpdate = { latest = $0 }
        source.start()
        source.update(TreeSelectSnapshot(groups: TreeFixture.groups(), searchValue: "x"))
        XCTAssertEqual(latest?.searchValue, "x")
        XCTAssertEqual(latest?.groups.count, 2)
    }

    func testRefreshReEmits() {
        let source = LiveTreeSelectSource(value: TreeSelectSnapshot(selectedIDs: ["a"]))
        var count = 0
        source.onUpdate = { _ in count += 1 }
        source.start()
        source.refresh()
        XCTAssertEqual(count, 2)
    }
}

// MARK: - In-memory source (records / push)

@MainActor
final class InMemoryTreeSelectSourceTests: XCTestCase {
    func testStartEmitsInitialAndCountsLifecycle() {
        let source = InMemoryTreeSelectSource(initial: TreeSelectSnapshot(selectedIDs: ["a"]))
        var latest: TreeSelectSnapshot?
        source.onUpdate = { latest = $0 }
        source.start()
        source.refresh()
        source.stop()
        XCTAssertEqual(latest?.selectedIDs, ["a"])
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testCommitsRecordedAndPushEmits() {
        let source = InMemoryTreeSelectSource()
        var latest: TreeSelectSnapshot?
        source.onUpdate = { latest = $0 }
        source.commitSelection(["a"])
        source.commitSearch("q")
        source.commitExpanded(["g1"])
        source.push(TreeSelectSnapshot(searchValue: "z"))
        XCTAssertEqual(source.committedSelections, [["a"]])
        XCTAssertEqual(source.committedSearches, ["q"])
        XCTAssertEqual(source.committedExpansions, [["g1"]])
        XCTAssertEqual(latest?.searchValue, "z")
    }
}
