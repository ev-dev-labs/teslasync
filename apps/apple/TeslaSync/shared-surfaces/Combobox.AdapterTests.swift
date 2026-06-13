//
//  Combobox.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0148 · Combobox (Apple)
//
//  The pure-core coverage (the Foundation-only adapter + projection): the surface identity, the
//  static-array filter (web `defaultFilter` — trim + case-fold + substring), the `maxVisibleOptions`
//  cap with the hidden remainder, the active-descendant arithmetic (ArrowDown / ArrowUp wraparound +
//  clamp), the i18next `{{count}}` interpolation + the result-count message ternary, and the listbox
//  branch resolution (loading / error / empty / populated). Split from `Combobox.ModelTests.swift` +
//  `Combobox.Tests.swift` (the state-holder + SwiftUI halves) to keep each file within the SwiftLint
//  file-length budget. These run in the TeslaSync(/-macOS) XCTest targets; the derivation is pure, with
//  no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class ComboboxAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(ComboboxMeta.surfaceSlug, "Combobox")
        XCTAssertEqual(Combobox.surfaceSlug, "Combobox")
    }

    func testDefaultsMirrorWebProps() {
        XCTAssertEqual(ComboboxMeta.defaultMaxVisibleOptions, 50)
        XCTAssertEqual(ComboboxMeta.defaultAsyncDebounce, .milliseconds(200))
    }
}

// MARK: - Filter (web `defaultFilter`)

final class ComboboxFilterTests: XCTestCase {
    private func items(_ labels: [String]) -> [ComboboxItem] {
        labels.enumerated().map { ComboboxItem(id: "k\($0.offset)", label: $0.element) }
    }

    func testEmptyOrWhitespaceQueryReturnsEverything() {
        let options = items(["Model 3", "Model Y"])
        XCTAssertEqual(ComboboxProjector.filter(options, query: "").count, 2)
        XCTAssertEqual(ComboboxProjector.filter(options, query: "   ").count, 2)
    }

    func testCaseFoldedTrimmedSubstringMatch() {
        let options = items(["Model 3", "Model Y", "Cybertruck"])
        let result = ComboboxProjector.filter(options, query: "  MODEL ")
        XCTAssertEqual(result.map(\.label), ["Model 3", "Model Y"])
    }

    func testNoMatchYieldsEmpty() {
        let options = items(["Model 3", "Model Y"])
        XCTAssertTrue(ComboboxProjector.filter(options, query: "plaid").isEmpty)
    }
}

// MARK: - Cap (web `maxVisibleOptions`)

final class ComboboxCapTests: XCTestCase {
    private func items(_ count: Int) -> [ComboboxItem] {
        (0 ..< count).map { ComboboxItem(id: "k\($0)", label: "L\($0)") }
    }

    func testUnderOrAtCapKeepsEverything() {
        let split = ComboboxProjector.cap(items(4), maxVisible: 4)
        XCTAssertEqual(split.visible.count, 4)
        XCTAssertEqual(split.hiddenCount, 0)
    }

    func testOverCapTrimsAndReportsHidden() {
        let split = ComboboxProjector.cap(items(10), maxVisible: 3)
        XCTAssertEqual(split.visible.map(\.id), ["k0", "k1", "k2"])
        XCTAssertEqual(split.hiddenCount, 7)
    }

    func testNonPositiveCapHidesEverything() {
        let split = ComboboxProjector.cap(items(3), maxVisible: 0)
        XCTAssertTrue(split.visible.isEmpty)
        XCTAssertEqual(split.hiddenCount, 3)
    }
}

// MARK: - Active-descendant arithmetic (web keyboard contract)

final class ComboboxActiveIndexTests: XCTestCase {
    func testNextWrapsToFirst() {
        XCTAssertEqual(ComboboxProjector.nextIndex(current: 0, count: 3), 1)
        XCTAssertEqual(ComboboxProjector.nextIndex(current: 2, count: 3), 0)
        XCTAssertEqual(ComboboxProjector.nextIndex(current: -1, count: 3), 0)
        XCTAssertEqual(ComboboxProjector.nextIndex(current: 0, count: 0), -1)
    }

    func testPreviousWrapsToLast() {
        XCTAssertEqual(ComboboxProjector.previousIndex(current: 2, count: 3), 1)
        XCTAssertEqual(ComboboxProjector.previousIndex(current: 0, count: 3), 2)
        XCTAssertEqual(ComboboxProjector.previousIndex(current: -1, count: 3), 2)
        XCTAssertEqual(ComboboxProjector.previousIndex(current: 0, count: 0), -1)
    }

    func testClampResetsOutOfRange() {
        XCTAssertEqual(ComboboxProjector.clampActive(index: 5, count: 3), 0)
        XCTAssertEqual(ComboboxProjector.clampActive(index: 1, count: 3), 1)
        XCTAssertEqual(ComboboxProjector.clampActive(index: 0, count: 0), -1)
    }
}

// MARK: - Interpolation + result-count copy (web i18next)

final class ComboboxCopyTests: XCTestCase {
    func testInterpolateReplacesKnownTokensOnly() {
        XCTAssertEqual(ComboboxProjector.interpolate("{{count}} results", ["count": "5"]), "5 results")
        XCTAssertEqual(ComboboxProjector.interpolate("a {{x}} b {{y}}", ["x": "1"]), "a 1 b {{y}}")
    }

    func testResultCountMessageTernary() {
        let zero = ComboboxProjector.resultCountMessage(
            count: 0, noResults: "No results", one: "1 result", manyTemplate: "{{count}} results"
        )
        let one = ComboboxProjector.resultCountMessage(
            count: 1, noResults: "No results", one: "1 result", manyTemplate: "{{count}} results"
        )
        let many = ComboboxProjector.resultCountMessage(
            count: 7, noResults: "No results", one: "1 result", manyTemplate: "{{count}} results"
        )
        XCTAssertEqual(zero, "No results")
        XCTAssertEqual(one, "1 result")
        XCTAssertEqual(many, "7 results")
    }

    func testMoreHiddenLabel() {
        XCTAssertEqual(
            ComboboxProjector.moreHiddenLabel(template: "{{count}} more — refine search", count: 4),
            "4 more — refine search"
        )
    }
}

// MARK: - Resolve (listbox branch)

final class ComboboxResolveListTests: XCTestCase {
    private func items(_ count: Int) -> [ComboboxItem] {
        (0 ..< count).map { ComboboxItem(id: "k\($0)", label: "L\($0)") }
    }

    func testLoadingWhenInFlightAndEmpty() {
        let state = ComboboxProjector.resolveList(
            phase: .loading, candidates: [], maxVisible: 50, activeIndex: -1, selection: nil
        )
        XCTAssertEqual(state.kind, .loading)
    }

    func testLoadingWithCachedRowsKeepsShowingThem() {
        // A fetch in flight WITH cached rows keeps the options visible (web `loading` + options).
        let state = ComboboxProjector.resolveList(
            phase: .loading, candidates: items(2), maxVisible: 50, activeIndex: 0, selection: nil
        )
        XCTAssertEqual(state.kind, .populated)
        XCTAssertEqual(state.visible.count, 2)
    }

    func testFailedResolvesToError() {
        let state = ComboboxProjector.resolveList(
            phase: .failed("boom"), candidates: [], maxVisible: 50, activeIndex: -1, selection: nil
        )
        XCTAssertEqual(state.kind, .error("boom"))
    }

    func testEmptyWhenResolvedWithNoRows() {
        let state = ComboboxProjector.resolveList(
            phase: .loaded, candidates: [], maxVisible: 50, activeIndex: -1, selection: nil
        )
        XCTAssertEqual(state.kind, .empty)
    }

    func testPopulatedCapsHighlightsAndMarksSelection() {
        let options = items(8)
        let state = ComboboxProjector.resolveList(
            phase: .loaded, candidates: options, maxVisible: 3, activeIndex: 9, selection: options[1]
        )
        XCTAssertEqual(state.kind, .populated)
        XCTAssertEqual(state.visible.count, 3)
        XCTAssertEqual(state.hiddenCount, 5)
        XCTAssertTrue(state.hasHidden)
        // activeIndex 9 is out of range → clamped to 0; selection k1 is in the visible window.
        XCTAssertEqual(state.activeIndex, 0)
        XCTAssertEqual(state.activeID, "k0")
        XCTAssertEqual(state.selectedID, "k1")
    }
}

// MARK: - Value-type equality

final class ComboboxValueTypeTests: XCTestCase {
    func testItemEquality() {
        XCTAssertEqual(
            ComboboxItem(id: "1", label: "Model 3"),
            ComboboxItem(id: "1", label: "Model 3")
        )
        XCTAssertNotEqual(
            ComboboxItem(id: "1", label: "Model 3"),
            ComboboxItem(id: "1", label: "Model Y")
        )
    }

    func testConfigAndSnapshotEquality() {
        let lhs = ComboboxConfig(label: "V", maxVisibleOptions: 10, noChevron: true)
        let rhs = ComboboxConfig(label: "V", maxVisibleOptions: 10, noChevron: true)
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, ComboboxConfig(label: "V", maxVisibleOptions: 10))

        let snapshot = ComboboxSnapshot(staticItems: [ComboboxItem(id: "1", label: "A")], connection: .stale)
        XCTAssertEqual(snapshot, snapshot)
        XCTAssertNotEqual(snapshot, ComboboxSnapshot(connection: .offline))
    }
}
