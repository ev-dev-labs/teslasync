//
//  Combobox.ModelTests.swift
//  TeslaSync — P4 shared surface · 0148 · Combobox (Apple)
//
//  State-holder coverage for `ComboboxModel` + its seams: the P1/S11 `view.opened` telemetry (once +
//  idempotent), the snapshot application (controlled selection → visible text while closed; the static
//  rows), the input / open / close + active-descendant intents (web `handleInputChange` /
//  `handleKeyDown` / `closeWithoutCommit`), the selection / free-text / clear commits routed through the
//  seam (web `onChange` / `onFreeTextCommit`), the polite result-count announcement with the
//  changed-only dedupe, the debounced + cancel-on-keystroke async loader (web `AbortController`) and its
//  failure → error phase, and the P4 connection axis (stale auto-refresh once + re-arm, offline keeps
//  the rows). Driven through the in-memory seam — no network.
//

import XCTest
@testable import TeslaSync

@MainActor
final class ComboboxModelTests: XCTestCase {
    private func vehicles(_ count: Int = 3) -> [ComboboxItem] {
        (0 ..< count).map { ComboboxItem(id: "k\($0)", label: "Vehicle \($0)") }
    }

    private func staticModel(
        snapshot: ComboboxSnapshot,
        config: ComboboxConfig = ComboboxConfig(label: "Vehicle"),
        telemetry: ComboboxTelemetry = OSLogComboboxTelemetry(),
        announcer: ComboboxAnnouncer = OSLogComboboxAnnouncer()
    ) -> (ComboboxModel, InMemoryComboboxSource) {
        let source = InMemoryComboboxSource(initial: snapshot)
        let model = ComboboxModel(
            config: config, provider: .staticItems, source: source,
            telemetry: telemetry, announcer: announcer
        )
        return (model, source)
    }

    private func waitUntil(_ condition: @MainActor () -> Bool, timeout: TimeInterval = 2) async {
        let start = Date()
        while !condition() {
            if Date().timeIntervalSince(start) > timeout { return }
            try? await Task.sleep(for: .milliseconds(5))
        }
    }

    // MARK: Lifecycle + telemetry

    func testStartEmitsViewOpenedOnceAndAppliesInitial() {
        let spy = SpyComboboxTelemetry()
        let (model, source) = staticModel(
            snapshot: ComboboxSnapshot(selection: vehicles()[1], staticItems: vehicles()),
            telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [Combobox.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
        // Controlled selection syncs the visible text while closed (web sync effect).
        XCTAssertEqual(model.query, "Vehicle 1")
    }

    func testStopReArmsStartButViewOpenedFiresOnce() {
        let spy = SpyComboboxTelemetry()
        let (model, source) = staticModel(snapshot: ComboboxSnapshot(staticItems: vehicles()), telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(source.startCount, 2)
        XCTAssertEqual(spy.surfaces, [Combobox.surfaceSlug], "view.opened fires once per instance")
    }

    // MARK: Input + open/close + active descendant

    func testSetQueryOpensFiltersAndRoutesInput() {
        let (model, source) = staticModel(snapshot: ComboboxSnapshot(staticItems: vehicles(5)))
        model.start()
        model.setQuery("Vehicle 1")
        XCTAssertTrue(model.isOpen)
        XCTAssertEqual(model.listState.kind, .populated)
        XCTAssertEqual(model.listState.visible.map(\.label), ["Vehicle 1"])
        XCTAssertEqual(source.inputs.last, "Vehicle 1")
    }

    func testCloseRevertsTextToSelectionLabel() {
        let (model, _) = staticModel(
            snapshot: ComboboxSnapshot(selection: vehicles()[2], staticItems: vehicles())
        )
        model.start()
        model.setQuery("xyz")
        XCTAssertEqual(model.query, "xyz")
        model.close()
        XCTAssertFalse(model.isOpen)
        XCTAssertEqual(model.query, "Vehicle 2")
        XCTAssertEqual(model.activeIndex, -1)
    }

    func testArrowNavigationWrapsAndOpensWhenClosed() {
        let (model, _) = staticModel(snapshot: ComboboxSnapshot(staticItems: vehicles(3)))
        model.start()
        XCTAssertFalse(model.isOpen)
        model.moveDown() // closed → opens
        XCTAssertTrue(model.isOpen)
        XCTAssertEqual(model.activeIndex, 0)
        model.moveUp() // wraps to last
        XCTAssertEqual(model.activeIndex, 2)
        model.moveDown() // wraps to first
        XCTAssertEqual(model.activeIndex, 0)
        model.moveEnd()
        XCTAssertEqual(model.activeIndex, 2)
        model.moveHome()
        XCTAssertEqual(model.activeIndex, 0)
    }

    func testToggleOpenClosesAndOpens() {
        let (model, _) = staticModel(snapshot: ComboboxSnapshot(staticItems: vehicles()))
        model.start()
        model.toggleOpen()
        XCTAssertTrue(model.isOpen)
        model.toggleOpen()
        XCTAssertFalse(model.isOpen)
    }

    // MARK: Commits

    func testCommitActiveSelectsHighlightedOption() {
        let (model, source) = staticModel(snapshot: ComboboxSnapshot(staticItems: vehicles(3)))
        model.start()
        model.open() // web defaults the highlight to the first row (index 0)
        XCTAssertEqual(model.activeIndex, 0)
        model.moveDown() // active 1
        model.commitActive()
        XCTAssertEqual(source.selections.last, vehicles()[1])
        XCTAssertEqual(model.selection, vehicles()[1])
        XCTAssertEqual(model.query, "Vehicle 1")
        XCTAssertFalse(model.isOpen)
    }

    func testCommitActiveFallsBackToFreeText() {
        let (model, source) = staticModel(
            snapshot: ComboboxSnapshot(staticItems: vehicles()),
            config: ComboboxConfig(label: "Vehicle", allowFreeText: true)
        )
        model.start()
        // A non-matching query leaves no highlighted row, so Enter commits the raw (trimmed) text.
        model.setQuery("  custom value  ")
        XCTAssertEqual(model.listState.kind, .empty)
        model.commitActive()
        XCTAssertEqual(source.freeTexts.last, "custom value")
        XCTAssertNil(model.selection)
        XCTAssertFalse(model.isOpen)
    }

    func testClearResetsAndReopens() {
        let (model, source) = staticModel(
            snapshot: ComboboxSnapshot(selection: vehicles()[0], staticItems: vehicles())
        )
        model.start()
        model.clear()
        XCTAssertEqual(source.selections.count, 1)
        XCTAssertNil(source.selections[0])
        XCTAssertNil(model.selection)
        XCTAssertEqual(model.query, "")
        XCTAssertTrue(model.isOpen)
    }

    func testShowsClearReflectsSelectionOrText() {
        let (model, _) = staticModel(snapshot: ComboboxSnapshot(staticItems: vehicles()))
        model.start()
        XCTAssertFalse(model.showsClear)
        model.setQuery("v")
        XCTAssertTrue(model.showsClear)
    }

    // MARK: Announcements

    func testAnnouncesResultCountOnlyOnChange() {
        let announcer = SpyComboboxAnnouncer()
        let (model, _) = staticModel(snapshot: ComboboxSnapshot(staticItems: vehicles(3)), announcer: announcer)
        model.start()
        model.setQuery("Vehicle") // 3 results
        model.setQuery("Vehicle ") // still 3 results → no re-announce (trailing space trimmed)
        let three = ComboboxStrings.resultsCount(3)
        XCTAssertEqual(announcer.messages.last, three)
        XCTAssertEqual(announcer.messages.count(where: { $0 == three }), 1)
        model.setQuery("Vehicle 1") // 1 result → new announcement
        XCTAssertEqual(announcer.messages.last, ComboboxStrings.resultsCount(1))
    }

    // MARK: Connection axis (P4 leaf)

    func testStaleTransitionAutoRefreshesOnceAndReArms() {
        let (model, source) = staticModel(
            snapshot: ComboboxSnapshot(staticItems: vehicles(), connection: .live)
        )
        model.start()
        XCTAssertEqual(model.connection, .live)
        source.push(ComboboxSnapshot(staticItems: vehicles(), connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)
        source.push(ComboboxSnapshot(staticItems: vehicles(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "no re-fire while still stale")
        source.push(ComboboxSnapshot(staticItems: vehicles(), connection: .live))
        source.push(ComboboxSnapshot(staticItems: vehicles(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2, "re-armed after returning to live")
    }

    func testOfflineKeepsRowsAndDoesNotAutoRefresh() {
        let (model, source) = staticModel(
            snapshot: ComboboxSnapshot(staticItems: vehicles(), connection: .live)
        )
        model.start()
        source.push(ComboboxSnapshot(staticItems: vehicles(), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
        model.open()
        XCTAssertEqual(model.listState.kind, .populated)
    }

    func testHostErrorSnapshotSurfacesErrorState() {
        let (model, _) = staticModel(snapshot: ComboboxSnapshot(errorMessage: "down"))
        model.start()
        model.open()
        XCTAssertEqual(model.listState.kind, .error("down"))
    }

    // MARK: Async loader (web AbortController)

    func testAsyncLoaderResolvesAndPopulates() async {
        let source = InMemoryComboboxSource(initial: ComboboxSnapshot())
        let loader: ComboboxAsyncLoader = { query in
            [ComboboxItem(id: query, label: "result:\(query)")]
        }
        let model = ComboboxModel(
            config: ComboboxConfig(label: "Vehicle"), provider: .async(loader),
            source: source, debounce: .milliseconds(1)
        )
        model.start()
        model.setQuery("abc")
        await waitUntil { !model.loadedItems.isEmpty }
        XCTAssertEqual(model.loadedItems, [ComboboxItem(id: "abc", label: "result:abc")])
        XCTAssertEqual(model.listState.kind, .populated)
    }

    func testAsyncLoaderCancelsSupersededKeystroke() async {
        let source = InMemoryComboboxSource(initial: ComboboxSnapshot())
        let loader: ComboboxAsyncLoader = { query in
            try await Task.sleep(for: .milliseconds(20))
            return [ComboboxItem(id: query, label: query)]
        }
        let model = ComboboxModel(
            config: ComboboxConfig(label: "Vehicle"), provider: .async(loader),
            source: source, debounce: .milliseconds(1)
        )
        model.start()
        model.setQuery("a")
        model.setQuery("ab") // cancels the "a" fetch
        await waitUntil { !model.loadedItems.isEmpty }
        XCTAssertEqual(model.loadedItems.map(\.id), ["ab"], "newest keystroke wins")
    }

    func testAsyncLoaderFailureSurfacesErrorPhase() async {
        struct LoadError: Error {}
        let source = InMemoryComboboxSource(initial: ComboboxSnapshot())
        let loader: ComboboxAsyncLoader = { _ in throw LoadError() }
        let model = ComboboxModel(
            config: ComboboxConfig(label: "Vehicle"), provider: .async(loader),
            source: source, debounce: .milliseconds(1)
        )
        model.start()
        model.setQuery("x")
        await waitUntil {
            if case .failed = model.loadPhase { return true }
            return false
        }
        XCTAssertTrue(model.loadedItems.isEmpty)
        model.open()
        if case .error = model.listState.kind {} else {
            XCTFail("expected error listbox state")
        }
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under
/// Swift 6 strict concurrency.
private final class SpyComboboxTelemetry: ComboboxTelemetry, @unchecked Sendable {
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

/// Records the polite announcements the model posts (the `@MainActor` announcement seam).
@MainActor
private final class SpyComboboxAnnouncer: ComboboxAnnouncer {
    private(set) var messages: [String] = []

    func announce(_ message: String) {
        messages.append(message)
    }
}
