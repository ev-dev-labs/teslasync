//
//  SearchInput.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0158 · SearchInput (Apple)
//
//  The pure-core coverage (the Foundation-only adapter + history engine): the surface identity, the
//  clear-button + dropdown visibility rules (the verbatim ports of the web `local ? <clear/>` and
//  `dropdownVisible`), the active-row arithmetic (Arrow Up/Down + the post-remove clamp), the debounce emit
//  decision (web `local !== value`), the record predicate (web `local.trim().length >= MIN_QUERY_LEN`), the
//  history engine (record dedup/cap/min-length, recent clamp, remove, sanitize), the entry value type, and
//  the projection. Split from SearchInput.Tests.swift (the SwiftUI / state-holder half) and
//  SearchInput.StoreTests.swift (the persistence half) to keep each file within the SwiftLint file-length
//  budget. These run in the TeslaSync(/-macOS) XCTest targets; the derivation is pure, no network, no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class SearchInputAdapterSurfaceTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(SearchInputSurface.slug, "SearchInput")
    }
}

// MARK: - Visibility rules (web `local ? <clear/>` + `dropdownVisible`)

final class SearchInputVisibilityTests: XCTestCase {
    func testHistoryEnabledTreatsNilAndEmptyScopeAsHistoryLess() {
        XCTAssertFalse(SearchInputProjector.historyEnabled(historyScope: nil))
        XCTAssertFalse(SearchInputProjector.historyEnabled(historyScope: ""))
        XCTAssertTrue(SearchInputProjector.historyEnabled(historyScope: "drives"))
    }

    func testShowsClearButtonOnlyWhenNonEmpty() {
        XCTAssertFalse(SearchInputProjector.showsClearButton(local: ""))
        XCTAssertTrue(SearchInputProjector.showsClearButton(local: "a"))
    }

    func testDropdownVisibleRequiresAllConditions() {
        // The happy path: scope + showOnFocus + focused + empty text + entries.
        XCTAssertTrue(SearchInputProjector.dropdownVisible(
            historyScope: "drives", showHistoryOnFocus: true, isFocused: true, local: "", entryCount: 3
        ))
        // Each condition individually suppresses the dropdown.
        XCTAssertFalse(SearchInputProjector.dropdownVisible(
            historyScope: nil, showHistoryOnFocus: true, isFocused: true, local: "", entryCount: 3
        ))
        XCTAssertFalse(SearchInputProjector.dropdownVisible(
            historyScope: "drives", showHistoryOnFocus: false, isFocused: true, local: "", entryCount: 3
        ))
        XCTAssertFalse(SearchInputProjector.dropdownVisible(
            historyScope: "drives", showHistoryOnFocus: true, isFocused: false, local: "", entryCount: 3
        ))
        XCTAssertFalse(SearchInputProjector.dropdownVisible(
            historyScope: "drives", showHistoryOnFocus: true, isFocused: true, local: "x", entryCount: 3
        ))
        XCTAssertFalse(SearchInputProjector.dropdownVisible(
            historyScope: "drives", showHistoryOnFocus: true, isFocused: true, local: "", entryCount: 0
        ))
    }
}

// MARK: - Active-row arithmetic (web Arrow Up/Down + post-remove clamp)

final class SearchInputActiveRowTests: XCTestCase {
    func testArrowDownClampsToLastRow() {
        XCTAssertEqual(SearchInputProjector.nextActiveDown(current: -1, count: 3), 0)
        XCTAssertEqual(SearchInputProjector.nextActiveDown(current: 1, count: 3), 2)
        XCTAssertEqual(SearchInputProjector.nextActiveDown(current: 2, count: 3), 2)
    }

    func testArrowUpClampsToMinusOne() {
        XCTAssertEqual(SearchInputProjector.nextActiveUp(current: 2), 1)
        XCTAssertEqual(SearchInputProjector.nextActiveUp(current: 0), -1)
        XCTAssertEqual(SearchInputProjector.nextActiveUp(current: -1), -1)
    }

    func testClampActiveIndexKeepsCursorInRange() {
        XCTAssertEqual(SearchInputProjector.clampActiveIndex(2, count: 2), 1)
        XCTAssertEqual(SearchInputProjector.clampActiveIndex(0, count: 3), 0)
        XCTAssertEqual(SearchInputProjector.clampActiveIndex(0, count: 0), -1)
    }

    func testIsSelectableIndex() {
        XCTAssertTrue(SearchInputProjector.isSelectableIndex(0, count: 3))
        XCTAssertTrue(SearchInputProjector.isSelectableIndex(2, count: 3))
        XCTAssertFalse(SearchInputProjector.isSelectableIndex(-1, count: 3))
        XCTAssertFalse(SearchInputProjector.isSelectableIndex(3, count: 3))
    }
}

// MARK: - Debounce + record predicates (web `local !== value` / min-length)

final class SearchInputEmitTests: XCTestCase {
    func testShouldEmitOnlyWhenChanged() {
        XCTAssertFalse(SearchInputProjector.shouldEmitDebounced(local: "ab", value: "ab"))
        XCTAssertTrue(SearchInputProjector.shouldEmitDebounced(local: "ab", value: "a"))
    }

    func testShouldRecordHonorsScopeAndMinLength() {
        XCTAssertFalse(SearchInputProjector.shouldRecord(historyScope: nil, query: "abc"))
        XCTAssertFalse(SearchInputProjector.shouldRecord(historyScope: "drives", query: " a "))
        XCTAssertTrue(SearchInputProjector.shouldRecord(historyScope: "drives", query: "ab"))
        XCTAssertTrue(SearchInputProjector.shouldRecord(historyScope: "drives", query: "  hi  "))
    }

    func testClearAccessibilityLabelPrefersExplicit() {
        XCTAssertEqual(
            SearchInputProjector.clearAccessibilityLabel(explicit: "Reset", fallback: "Clear"), "Reset"
        )
        XCTAssertEqual(
            SearchInputProjector.clearAccessibilityLabel(explicit: nil, fallback: "Clear"), "Clear"
        )
    }
}

// MARK: - Projection (resolve)

final class SearchInputProjectionTests: XCTestCase {
    func testResolveEmptyHistoryLess() {
        let projection = SearchInputProjector.resolve(
            input: SearchInputInput(value: ""), local: "", isFocused: false, entries: [], activeIndex: -1
        )
        XCTAssertFalse(projection.showsClearButton)
        XCTAssertFalse(projection.historyEnabled)
        XCTAssertFalse(projection.dropdownVisible)
        XCTAssertEqual(projection.value, "")
    }

    func testResolveFilledShowsClear() {
        let projection = SearchInputProjector.resolve(
            input: SearchInputInput(value: "x"), local: "x", isFocused: true, entries: [], activeIndex: -1
        )
        XCTAssertTrue(projection.showsClearButton)
    }

    func testResolveFocusedEmptyWithEntriesShowsDropdown() {
        let projection = SearchInputProjector.resolve(
            input: SearchInputInput(value: "", historyScope: "drives"),
            local: "", isFocused: true, entries: ["a", "b"], activeIndex: 1
        )
        XCTAssertTrue(projection.historyEnabled)
        XCTAssertTrue(projection.dropdownVisible)
        XCTAssertEqual(projection.entries, ["a", "b"])
        XCTAssertEqual(projection.activeIndex, 1)
    }
}

// MARK: - History engine (web `searchHistory.ts` transforms)

final class SearchInputHistoryEngineTests: XCTestCase {
    func testRecordTrimsAndEnforcesMinLength() {
        XCTAssertEqual(SearchInputHistory.record(into: [], query: "a", now: 1), [])
        let recorded = SearchInputHistory.record(into: [], query: "  hi  ", now: 5)
        XCTAssertEqual(recorded.map(\.query), ["hi"])
        XCTAssertEqual(recorded.first?.timestamp, 5)
    }

    func testRecordPrependsNewestFirst() {
        var entries = SearchInputHistory.record(into: [], query: "alpha", now: 1)
        entries = SearchInputHistory.record(into: entries, query: "bravo", now: 2)
        XCTAssertEqual(entries.map(\.query), ["bravo", "alpha"])
    }

    func testRecordDeduplicatesCaseInsensitivelyKeepingNewCasing() {
        let seed = [SearchInputHistoryEntry(query: "Home", timestamp: 1)]
        let next = SearchInputHistory.record(into: seed, query: "home", now: 9)
        XCTAssertEqual(next.map(\.query), ["home"], "newest submission wins, including its casing")
        XCTAssertEqual(next.count, 1)
    }

    func testRecordCapsAtTwelve() {
        var entries: [SearchInputHistoryEntry] = []
        for index in 0 ..< 15 {
            entries = SearchInputHistory.record(into: entries, query: "q\(index)", now: Double(index))
        }
        XCTAssertEqual(entries.count, SearchInputHistory.cap)
        XCTAssertEqual(entries.first?.query, "q14")
        XCTAssertEqual(entries.last?.query, "q3")
    }

    func testRecentClampsToCapAndMax() {
        let entries = (0 ..< 5).map { SearchInputHistoryEntry(query: "q\($0)", timestamp: Double($0)) }
        XCTAssertEqual(SearchInputHistory.recent(entries, max: 3), ["q0", "q1", "q2"])
        XCTAssertEqual(SearchInputHistory.recent(entries, max: 0), [])
        XCTAssertEqual(SearchInputHistory.recent(entries, max: 100).count, 5)
    }

    func testRemoveIsCaseInsensitiveAndMissIsNoOp() {
        let seed = [
            SearchInputHistoryEntry(query: "Home", timestamp: 2),
            SearchInputHistoryEntry(query: "Work", timestamp: 1)
        ]
        XCTAssertEqual(SearchInputHistory.remove(seed, query: "home").map(\.query), ["Work"])
        XCTAssertEqual(SearchInputHistory.remove(seed, query: "nope").count, 2)
        XCTAssertEqual(SearchInputHistory.remove(seed, query: "  ").count, 2)
    }

    func testSanitizeDropsInvalidAndCaps() {
        let mixed = [
            SearchInputHistoryEntry(query: "ok", timestamp: 1),
            SearchInputHistoryEntry(query: "", timestamp: 2),
            SearchInputHistoryEntry(query: "nan", timestamp: .nan)
        ]
        XCTAssertEqual(SearchInputHistory.sanitize(mixed).map(\.query), ["ok"])
    }
}

// MARK: - History entry value type

final class SearchInputHistoryEntryTests: XCTestCase {
    func testValidity() {
        XCTAssertTrue(SearchInputHistoryEntry(query: "q", timestamp: 1).isValid)
        XCTAssertFalse(SearchInputHistoryEntry(query: "", timestamp: 1).isValid)
        XCTAssertFalse(SearchInputHistoryEntry(query: "q", timestamp: .infinity).isValid)
    }

    func testCodableUsesWebEnvelopeKeys() throws {
        let data = try JSONEncoder().encode(SearchInputHistoryEntry(query: "hi", timestamp: 7))
        let json = String(bytes: data, encoding: .utf8) ?? ""
        XCTAssertTrue(json.contains("\"q\""), "persisted key matches the web envelope `q`")
        XCTAssertTrue(json.contains("\"ts\""), "persisted key matches the web envelope `ts`")
        let decoded = try JSONDecoder().decode(SearchInputHistoryEntry.self, from: data)
        XCTAssertEqual(decoded, SearchInputHistoryEntry(query: "hi", timestamp: 7))
    }
}

// MARK: - Value-type equality

final class SearchInputValueTypeTests: XCTestCase {
    func testInputEquality() {
        let base = SearchInputInput(value: "a", historyScope: "drives", maxHistory: 8)
        XCTAssertEqual(base, SearchInputInput(value: "a", historyScope: "drives", maxHistory: 8))
        XCTAssertNotEqual(base, SearchInputInput(value: "b", historyScope: "drives", maxHistory: 8))
        XCTAssertNotEqual(base, SearchInputInput(value: "a", historyScope: "charging", maxHistory: 8))
    }

    func testProjectionEquality() {
        let lhs = SearchInputProjector.resolve(
            input: SearchInputInput(value: ""), local: "", isFocused: false, entries: [], activeIndex: -1
        )
        let rhs = SearchInputProjector.resolve(
            input: SearchInputInput(value: ""), local: "", isFocused: false, entries: [], activeIndex: -1
        )
        XCTAssertEqual(lhs, rhs)
    }
}
