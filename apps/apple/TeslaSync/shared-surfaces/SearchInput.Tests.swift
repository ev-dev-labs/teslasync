//
//  SearchInput.Tests.swift
//  TeslaSync — P4 shared surface · 0158 · SearchInput (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + history engine
//  live in SearchInput.AdapterTests.swift, the persistence in SearchInput.StoreTests.swift; split to keep
//  each file within the SwiftLint file-length budget):
//    • SearchInputModel — the once-only `view.opened`, the buffered typing + debounce flush (web `local` +
//      `onChange`), the immediate select-entry emit, the focus refresh / blur-commit, the clear, the
//      history mutations (record / remove / clear-all) + the active-row clamp, the keyboard rules, and the
//      controlled `value` re-sync.
//    • SearchInputStrings — the web `t()` parity copy + native a11y additions resolve with the fallbacks.
//    • SearchInputMotion — the reveal animation honors Reduce Motion.
//    • Views — the public surface + the subviews compose in every real branch.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the only data source is the
//  injected in-memory history store.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - SearchInputModel (interaction state + routing)

@MainActor
final class SearchInputModelTests: XCTestCase {
    private func model(
        _ input: SearchInputInput,
        onChange: (@MainActor (String) -> Void)? = nil,
        store: any SearchInputHistoryStore = InMemorySearchInputHistoryStore(),
        telemetry: any SearchInputTelemetry = OSLogSearchInputTelemetry()
    ) -> SearchInputModel {
        SearchInputModel(input: input, onChange: onChange, store: store, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(SearchInputInput(value: ""), telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [SearchInputSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(SearchInputInput(value: ""), telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [SearchInputSurface.slug], "view.opened fires once per instance")
    }

    func testSetLocalBuffersAndFlushEmitsChangedValue() {
        let recorder = ChangeRecorder()
        let holder = model(SearchInputInput(value: ""), onChange: { recorder.record($0) })
        holder.setLocal("ab")
        XCTAssertEqual(holder.local, "ab")
        holder.flushPendingChange()
        XCTAssertEqual(recorder.values, ["ab"])
    }

    func testFlushDoesNotEmitWhenUnchanged() {
        let recorder = ChangeRecorder()
        let holder = model(SearchInputInput(value: "same"), onChange: { recorder.record($0) })
        holder.setLocal("same")
        holder.flushPendingChange()
        XCTAssertEqual(recorder.values, [], "web `if (local === value) return` guard")
    }

    func testSelectEntryEmitsImmediatelyRecordsAndRequestsFocus() {
        let recorder = ChangeRecorder()
        let store = InMemorySearchInputHistoryStore(scope: "drives", queries: ["alpha"])
        let holder = model(
            SearchInputInput(value: "", historyScope: "drives"),
            onChange: { recorder.record($0) },
            store: store
        )
        holder.selectEntry("alpha")
        XCTAssertEqual(recorder.values, ["alpha"], "explicit selection skips the debounce")
        XCTAssertEqual(holder.local, "alpha")
        XCTAssertEqual(holder.activeIndex, -1)
        XCTAssertEqual(holder.focusRequestCount, 1)
        XCTAssertGreaterThanOrEqual(store.recordCount, 1, "selection re-records to the top of history")
    }

    func testFocusGainRefreshesEntriesAndBlurCommits() {
        let store = InMemorySearchInputHistoryStore(scope: "drives", queries: ["alpha", "bravo"])
        let holder = model(SearchInputInput(value: "", historyScope: "drives"), store: store)
        holder.setFocused(true)
        XCTAssertTrue(holder.isFocused)
        XCTAssertEqual(holder.entries, ["alpha", "bravo"])

        holder.setLocal("coastal road")
        holder.setFocused(false)
        XCTAssertFalse(holder.isFocused)
        XCTAssertEqual(store.recent(scope: "drives", max: 8).first, "coastal road", "blur commits the query")
    }

    func testClearResetsAndEmitsEmpty() {
        let recorder = ChangeRecorder()
        let holder = model(SearchInputInput(value: "Supercharger"), onChange: { recorder.record($0) })
        holder.clear()
        XCTAssertEqual(holder.local, "")
        holder.flushPendingChange()
        XCTAssertEqual(recorder.values, [""])
    }

    func testRefreshEntriesIsEmptyWhenHistoryLess() {
        let store = InMemorySearchInputHistoryStore(scope: "drives", queries: ["alpha"])
        let holder = model(SearchInputInput(value: ""), store: store)
        holder.refreshEntries()
        XCTAssertEqual(holder.entries, [], "no scope → no history")
    }

    func testRemoveEntryReloadsClampsActiveAndRequestsFocus() {
        let store = InMemorySearchInputHistoryStore(scope: "drives", queries: ["alpha", "bravo"])
        let holder = model(SearchInputInput(value: "", historyScope: "drives"), store: store)
        holder.setFocused(true)
        holder.moveActiveDown()
        holder.moveActiveDown()
        XCTAssertEqual(holder.activeIndex, 1)
        holder.removeEntry("bravo")
        XCTAssertEqual(holder.entries, ["alpha"])
        XCTAssertEqual(holder.activeIndex, 0, "active row clamps into the shrunken list")
        XCTAssertGreaterThanOrEqual(holder.focusRequestCount, 1)
    }

    func testClearAllWipesAndRequestsFocus() {
        let store = InMemorySearchInputHistoryStore(scope: "drives", queries: ["alpha", "bravo"])
        let holder = model(SearchInputInput(value: "", historyScope: "drives"), store: store)
        holder.setFocused(true)
        holder.clearAll()
        XCTAssertEqual(holder.entries, [])
        XCTAssertEqual(store.clearCount, 1)
        XCTAssertGreaterThanOrEqual(holder.focusRequestCount, 1)
    }

    func testArrowKeysAreBoundedWhenDropdownVisible() {
        let store = InMemorySearchInputHistoryStore(scope: "drives", queries: ["alpha", "bravo"])
        let holder = model(SearchInputInput(value: "", historyScope: "drives"), store: store)
        holder.setFocused(true)
        holder.moveActiveUp()
        XCTAssertEqual(holder.activeIndex, -1)
        holder.moveActiveDown()
        holder.moveActiveDown()
        holder.moveActiveDown()
        XCTAssertEqual(holder.activeIndex, 1, "clamps to the last row")
    }

    func testSubmitSelectsActiveRowElseRecords() {
        let recorder = ChangeRecorder()
        let store = InMemorySearchInputHistoryStore(scope: "drives", queries: ["alpha", "bravo"])
        let holder = model(
            SearchInputInput(value: "", historyScope: "drives"),
            onChange: { recorder.record($0) },
            store: store
        )
        holder.setFocused(true)
        holder.moveActiveDown()
        holder.submit()
        XCTAssertEqual(recorder.values, ["alpha"], "Enter on a highlighted row selects it")

        recorder.reset()
        holder.setLocal("new query")
        holder.submit()
        XCTAssertEqual(recorder.values, [], "Enter without a highlight does not emit")
        XCTAssertEqual(store.recent(scope: "drives", max: 8).first, "new query", "Enter records the query")
    }

    func testEscapeCollapsesDropdown() {
        let store = InMemorySearchInputHistoryStore(scope: "drives", queries: ["alpha"])
        let holder = model(SearchInputInput(value: "", historyScope: "drives"), store: store)
        holder.setFocused(true)
        XCTAssertTrue(holder.projection.dropdownVisible)
        holder.escape()
        XCTAssertFalse(holder.isFocused)
        XCTAssertFalse(holder.projection.dropdownVisible)
    }

    func testHighlightSetsAndClearsActive() {
        let store = InMemorySearchInputHistoryStore(scope: "drives", queries: ["alpha", "bravo"])
        let holder = model(SearchInputInput(value: "", historyScope: "drives"), store: store)
        holder.setFocused(true)
        holder.highlight(1)
        XCTAssertEqual(holder.activeIndex, 1)
        holder.highlight(nil)
        XCTAssertEqual(holder.activeIndex, -1)
    }

    func testUpdateReSyncsLocalOnlyWhenValueChanges() {
        let holder = model(SearchInputInput(value: "a"))
        holder.setLocal("ab")
        holder.update(SearchInputInput(value: "zzz"), onChange: nil)
        XCTAssertEqual(holder.local, "zzz", "a new controlled value re-syncs the buffered text")

        holder.setLocal("typed")
        holder.update(SearchInputInput(value: "zzz"), onChange: nil)
        XCTAssertEqual(holder.local, "typed", "an unrelated re-render does not clobber the buffered text")
    }
}

// MARK: - Strings facade (P1/S10)

final class SearchInputStringsTests: XCTestCase {
    func testWebParityFallbacks() {
        XCTAssertEqual(SearchInputStrings.clearLabel, "Clear")
        XCTAssertEqual(SearchInputStrings.historyTitle, "Recent searches")
        XCTAssertEqual(SearchInputStrings.clearHistory, "Clear history")
    }

    func testRemoveAriaInterpolatesQuery() {
        XCTAssertEqual(SearchInputStrings.removeAria("Home"), "Remove \"Home\" from search history")
    }

    func testNativeA11yAdditions() {
        XCTAssertEqual(SearchInputStrings.fieldLabel, "Search")
        XCTAssertEqual(SearchInputStrings.emptyTitle, "No recent searches")
        XCTAssertFalse(SearchInputStrings.selectHint.isEmpty)
        XCTAssertFalse(SearchInputStrings.fieldHint.isEmpty)
        XCTAssertFalse(SearchInputStrings.emptyMessage.isEmpty)
    }
}

// MARK: - SearchInputMotion (reveal honors Reduce Motion)

final class SearchInputMotionTests: XCTestCase {
    func testRevealNilUnderReducedMotion() {
        XCTAssertNil(SearchInputMotion.reveal(reduce: true))
    }

    func testRevealPresentWhenMotionAllowed() {
        XCTAssertNotNil(SearchInputMotion.reveal(reduce: false))
    }
}

// MARK: - Views (every real branch composes)

@MainActor
final class SearchInputViewTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = SearchInput(value: "", onChange: { _ in }, store: InMemorySearchInputHistoryStore())
        _ = SearchInput(value: "x", onChange: { _ in }, prompt: "Search", store: InMemorySearchInputHistoryStore())
        _ = SearchInput(
            value: "",
            onChange: { _ in },
            historyScope: "drives",
            store: InMemorySearchInputHistoryStore(scope: "drives", queries: ["alpha"])
        )
        XCTAssertEqual(SearchInput.surfaceSlug, "SearchInput")
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = SearchInputModel(
            input: SearchInputInput(value: "", historyScope: "drives"),
            store: InMemorySearchInputHistoryStore(scope: "drives", queries: ["alpha", "bravo"]),
            telemetry: SpyTelemetry()
        )
        injected.setFocused(true)
        _ = SearchInput(model: injected)
        _ = FieldHarness(model: injected)
    }

    func testSubviewsCompose() {
        let holder = SearchInputModel(
            input: SearchInputInput(value: "", historyScope: "drives"),
            store: InMemorySearchInputHistoryStore(scope: "drives", queries: ["alpha"])
        )
        holder.setFocused(true)
        _ = SearchInputHistoryDropdown(model: holder)
        _ = SearchInputHistoryRow(
            text: "alpha",
            isActive: true,
            selectHint: "hint",
            removeLabel: "Remove",
            onSelect: {},
            onRemove: {}
        )
        _ = SearchInputHistoryEmpty(title: "None", message: "Empty")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: SearchInputTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.withLock { storage }
    }

    func viewOpened(surface: String) {
        lock.withLock { storage.append(surface) }
    }
}

/// Records the values routed out through `onChange` (the `@MainActor` page-closure seam).
@MainActor
private final class ChangeRecorder {
    private(set) var values: [String] = []

    func record(_ value: String) {
        values.append(value)
    }

    func reset() {
        values.removeAll()
    }
}

/// Hosts ``SearchInputField`` with a real `@FocusState` so the field composes in isolation in tests.
@MainActor
private struct FieldHarness: View {
    let model: SearchInputModel
    @FocusState private var focused: Bool

    var body: some View {
        SearchInputField(
            model: model,
            focus: $focused,
            prompt: "Search",
            clearLabel: "Clear",
            fieldLabel: "Search",
            fieldHint: "hint"
        )
    }
}
