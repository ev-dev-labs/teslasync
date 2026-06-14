//
//  ComboboxMulti.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0149 · ComboboxMulti (Apple)
//
//  The pure-core coverage (the Foundation-only adapter + projection): the surface identity, the
//  static-array text filter (web `defaultFilter` — trim + case-fold + substring), the selected-removed
//  filter (web `!selectedKeys.has(...)`), the `maxVisibleOptions` cap with the hidden remainder, the
//  `atMax` cap predicate, the active-descendant arithmetic (ArrowDown / ArrowUp wraparound + clamp), the
//  i18next `{{count}}` / `{{label}}` interpolation + the result-count message ternary, and the listbox
//  branch resolution (loading / error / empty / populated, carrying `atMax`). Split from
//  `ComboboxMulti.ModelTests.swift` + `ComboboxMulti.Tests.swift` (the state-holder + SwiftUI halves) to
//  keep each file within the SwiftLint file-length budget. These run in the TeslaSync(/-macOS) XCTest
//  targets; the derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class ComboboxMultiAdapterTests: XCTestCase {
    @MainActor
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(ComboboxMultiMeta.surfaceSlug, "ComboboxMulti")
        XCTAssertEqual(ComboboxMulti.surfaceSlug, "ComboboxMulti")
    }

    func testDefaultsMirrorWebProps() {
        XCTAssertEqual(ComboboxMultiMeta.defaultMaxVisibleOptions, 50)
        XCTAssertEqual(ComboboxMultiMeta.defaultAsyncDebounce, .milliseconds(200))
    }
}

// MARK: - Text filter (web `defaultFilter`)

final class ComboboxMultiFilterTests: XCTestCase {
    private func items(_ labels: [String]) -> [ComboboxMultiItem] {
        labels.enumerated().map { ComboboxMultiItem(id: "k\($0.offset)", label: $0.element) }
    }

    func testEmptyOrWhitespaceQueryReturnsEverything() {
        let options = items(["Apple", "Banana"])
        XCTAssertEqual(ComboboxMultiProjector.filter(options, query: "").count, 2)
        XCTAssertEqual(ComboboxMultiProjector.filter(options, query: "   ").count, 2)
    }

    func testCaseFoldedTrimmedSubstringMatch() {
        let options = items(["Apple", "Banana", "Cherry"])
        let result = ComboboxMultiProjector.filter(options, query: "  AN ")
        XCTAssertEqual(result.map(\.label), ["Banana"])
    }

    func testNoMatchYieldsEmpty() {
        let options = items(["Apple", "Banana"])
        XCTAssertTrue(ComboboxMultiProjector.filter(options, query: "zzz").isEmpty)
    }
}

// MARK: - Selected-removed filter (web `!selectedKeys.has(...)`)

final class ComboboxMultiRemoveSelectedTests: XCTestCase {
    private func items(_ ids: [String]) -> [ComboboxMultiItem] {
        ids.map { ComboboxMultiItem(id: $0, label: "L\($0)") }
    }

    func testHidesSelectedOptions() {
        let options = items(["1", "2", "3", "4"])
        let result = ComboboxMultiProjector.removeSelected(options, selectedIDs: ["2", "4"])
        XCTAssertEqual(result.map(\.id), ["1", "3"])
    }

    func testEmptySelectionKeepsEverything() {
        let options = items(["1", "2"])
        XCTAssertEqual(ComboboxMultiProjector.removeSelected(options, selectedIDs: []).count, 2)
    }

    func testAllSelectedYieldsEmpty() {
        let options = items(["1", "2"])
        XCTAssertTrue(ComboboxMultiProjector.removeSelected(options, selectedIDs: ["1", "2"]).isEmpty)
    }
}

// MARK: - Cap (web `maxVisibleOptions`)

final class ComboboxMultiCapTests: XCTestCase {
    private func items(_ count: Int) -> [ComboboxMultiItem] {
        (0 ..< count).map { ComboboxMultiItem(id: "k\($0)", label: "L\($0)") }
    }

    func testUnderOrAtCapKeepsEverything() {
        let split = ComboboxMultiProjector.cap(items(4), maxVisible: 4)
        XCTAssertEqual(split.visible.count, 4)
        XCTAssertEqual(split.hiddenCount, 0)
    }

    func testOverCapTrimsAndReportsHidden() {
        let split = ComboboxMultiProjector.cap(items(10), maxVisible: 3)
        XCTAssertEqual(split.visible.map(\.id), ["k0", "k1", "k2"])
        XCTAssertEqual(split.hiddenCount, 7)
    }

    func testNonPositiveCapHidesEverything() {
        let split = ComboboxMultiProjector.cap(items(3), maxVisible: 0)
        XCTAssertTrue(split.visible.isEmpty)
        XCTAssertEqual(split.hiddenCount, 3)
    }
}

// MARK: - atMax predicate (web `value.length >= maxItems`)

final class ComboboxMultiAtMaxTests: XCTestCase {
    func testUnboundedIsNeverAtMax() {
        XCTAssertFalse(ComboboxMultiProjector.atMax(selectedCount: 99, maxItems: nil))
    }

    func testReachesAndExceedsCap() {
        XCTAssertFalse(ComboboxMultiProjector.atMax(selectedCount: 1, maxItems: 2))
        XCTAssertTrue(ComboboxMultiProjector.atMax(selectedCount: 2, maxItems: 2))
        XCTAssertTrue(ComboboxMultiProjector.atMax(selectedCount: 3, maxItems: 2))
    }
}

// MARK: - Active-descendant arithmetic (web keyboard contract)

final class ComboboxMultiActiveIndexTests: XCTestCase {
    func testNextWrapsToFirst() {
        XCTAssertEqual(ComboboxMultiProjector.nextIndex(current: 0, count: 3), 1)
        XCTAssertEqual(ComboboxMultiProjector.nextIndex(current: 2, count: 3), 0)
        XCTAssertEqual(ComboboxMultiProjector.nextIndex(current: -1, count: 3), 0)
        XCTAssertEqual(ComboboxMultiProjector.nextIndex(current: 0, count: 0), -1)
    }

    func testPreviousWrapsToLast() {
        XCTAssertEqual(ComboboxMultiProjector.previousIndex(current: 2, count: 3), 1)
        XCTAssertEqual(ComboboxMultiProjector.previousIndex(current: 0, count: 3), 2)
        XCTAssertEqual(ComboboxMultiProjector.previousIndex(current: -1, count: 3), 2)
        XCTAssertEqual(ComboboxMultiProjector.previousIndex(current: 0, count: 0), -1)
    }

    func testClampResetsOutOfRange() {
        XCTAssertEqual(ComboboxMultiProjector.clampActive(index: 5, count: 3), 0)
        XCTAssertEqual(ComboboxMultiProjector.clampActive(index: 1, count: 3), 1)
        XCTAssertEqual(ComboboxMultiProjector.clampActive(index: 0, count: 0), -1)
    }
}

// MARK: - Interpolation + result-count + chip copy (web i18next)

final class ComboboxMultiCopyTests: XCTestCase {
    func testInterpolateReplacesKnownTokensOnly() {
        XCTAssertEqual(ComboboxMultiProjector.interpolate("{{count}} results", ["count": "5"]), "5 results")
        XCTAssertEqual(ComboboxMultiProjector.interpolate("a {{x}} b {{y}}", ["x": "1"]), "a 1 b {{y}}")
    }

    func testResultCountMessageTernary() {
        let zero = ComboboxMultiProjector.resultCountMessage(
            count: 0, noResults: "No results", one: "1 result", manyTemplate: "{{count}} results"
        )
        let one = ComboboxMultiProjector.resultCountMessage(
            count: 1, noResults: "No results", one: "1 result", manyTemplate: "{{count}} results"
        )
        let many = ComboboxMultiProjector.resultCountMessage(
            count: 7, noResults: "No results", one: "1 result", manyTemplate: "{{count}} results"
        )
        XCTAssertEqual(zero, "No results")
        XCTAssertEqual(one, "1 result")
        XCTAssertEqual(many, "7 results")
    }

    func testMoreHiddenAndLabelMessages() {
        XCTAssertEqual(
            ComboboxMultiProjector.moreHiddenLabel(template: "{{count}} more — refine search", count: 4),
            "4 more — refine search"
        )
        XCTAssertEqual(
            ComboboxMultiProjector.labelMessage(template: "Remove {{label}}", label: "Banana"),
            "Remove Banana"
        )
        XCTAssertEqual(
            ComboboxMultiProjector.labelMessage(template: "Removed {{label}}", label: "Apple"),
            "Removed Apple"
        )
    }
}

// MARK: - Resolve (listbox branch)

final class ComboboxMultiResolveListTests: XCTestCase {
    private func items(_ count: Int) -> [ComboboxMultiItem] {
        (0 ..< count).map { ComboboxMultiItem(id: "k\($0)", label: "L\($0)") }
    }

    func testLoadingWhenInFlightAndEmpty() {
        let state = ComboboxMultiProjector.resolveList(
            phase: .loading, candidates: [], maxVisible: 50, activeIndex: -1, atMax: false
        )
        XCTAssertEqual(state.kind, .loading)
    }

    func testLoadingWithCachedRowsKeepsShowingThem() {
        let state = ComboboxMultiProjector.resolveList(
            phase: .loading, candidates: items(2), maxVisible: 50, activeIndex: 0, atMax: false
        )
        XCTAssertEqual(state.kind, .populated)
        XCTAssertEqual(state.visible.count, 2)
    }

    func testFailedResolvesToError() {
        let state = ComboboxMultiProjector.resolveList(
            phase: .failed("boom"), candidates: [], maxVisible: 50, activeIndex: -1, atMax: false
        )
        XCTAssertEqual(state.kind, .error("boom"))
    }

    func testEmptyCarriesAtMaxFlag() {
        let notMax = ComboboxMultiProjector.resolveList(
            phase: .loaded, candidates: [], maxVisible: 50, activeIndex: -1, atMax: false
        )
        let atMax = ComboboxMultiProjector.resolveList(
            phase: .loaded, candidates: [], maxVisible: 50, activeIndex: -1, atMax: true
        )
        XCTAssertEqual(notMax.kind, .empty)
        XCTAssertFalse(notMax.atMax)
        XCTAssertEqual(atMax.kind, .empty)
        XCTAssertTrue(atMax.atMax)
    }

    func testPopulatedCapsHighlightsAndCarriesAtMax() {
        let options = items(8)
        let state = ComboboxMultiProjector.resolveList(
            phase: .loaded, candidates: options, maxVisible: 3, activeIndex: 9, atMax: true
        )
        XCTAssertEqual(state.kind, .populated)
        XCTAssertEqual(state.visible.count, 3)
        XCTAssertEqual(state.hiddenCount, 5)
        XCTAssertTrue(state.hasHidden)
        XCTAssertTrue(state.atMax)
        // activeIndex 9 is out of range → clamped to 0.
        XCTAssertEqual(state.activeIndex, 0)
        XCTAssertEqual(state.activeID, "k0")
    }
}

// MARK: - Value-type equality

final class ComboboxMultiValueTypeTests: XCTestCase {
    func testItemEquality() {
        XCTAssertEqual(
            ComboboxMultiItem(id: "1", label: "Apple"),
            ComboboxMultiItem(id: "1", label: "Apple")
        )
        XCTAssertNotEqual(
            ComboboxMultiItem(id: "1", label: "Apple"),
            ComboboxMultiItem(id: "1", label: "Banana")
        )
    }

    func testConfigAndSnapshotEquality() {
        let lhs = ComboboxMultiConfig(label: "F", maxVisibleOptions: 10, maxItems: 3, noChevron: true)
        let rhs = ComboboxMultiConfig(label: "F", maxVisibleOptions: 10, maxItems: 3, noChevron: true)
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, ComboboxMultiConfig(label: "F", maxVisibleOptions: 10, maxItems: 2))

        let snapshot = ComboboxMultiSnapshot(
            staticItems: [ComboboxMultiItem(id: "1", label: "A")], connection: .stale
        )
        XCTAssertEqual(snapshot, snapshot)
        XCTAssertNotEqual(snapshot, ComboboxMultiSnapshot(connection: .offline))
    }
}
