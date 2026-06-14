//
//  ComboboxMulti.ModelTests.swift
//  TeslaSync — P4 shared surface · 0149 · ComboboxMulti (Apple)
//
//  State-holder coverage for `ComboboxMultiModel` + its seams — the native peer of the web
//  `ComboboxMulti.test.tsx` contract: the P1/S11 `view.opened` telemetry (once + idempotent), the
//  snapshot application (controlled chips; the local input text stays independent), the input / open /
//  close + active-descendant intents, the add-chip (and hide-from-dropdown) / remove-chip /
//  Backspace-removes-last / `maxItems` cap commits routed through the seam (web `onChange`), the polite
//  result-count + "Removed {label}" announcements, the debounced + cancel-on-keystroke async loader (web
//  `AbortController`) with selected rows removed, and the P4 connection axis (stale auto-refresh once +
//  re-arm, offline keeps the rows). Driven through the in-memory seam — no network. The cases are split
//  in two (interaction + announce/connection/async) so each class body stays within the SwiftLint
//  type-body budget.
//

import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures

/// Shared fixtures for the `ComboboxMultiModel` coverage. Holds no `test*` methods, so it contributes no
/// cases of its own; the two concrete subclasses below carry the assertions.
@MainActor
class ComboboxMultiModelTestCase: XCTestCase {
    func fruits(_ count: Int = 4) -> [ComboboxMultiItem] {
        let labels = ["Apple", "Banana", "Cherry", "Date", "Elderberry"]
        return (0 ..< count).map { ComboboxMultiItem(id: "\($0 + 1)", label: labels[$0]) }
    }

    func makeModel(
        snapshot: ComboboxMultiSnapshot,
        config: ComboboxMultiConfig = ComboboxMultiConfig(label: "Fruits"),
        telemetry: ComboboxMultiTelemetry = OSLogComboboxMultiTelemetry(),
        announcer: ComboboxMultiAnnouncer = OSLogComboboxMultiAnnouncer()
    ) -> (ComboboxMultiModel, InMemoryComboboxMultiSource) {
        let source = InMemoryComboboxMultiSource(initial: snapshot)
        let model = ComboboxMultiModel(
            config: config, provider: .staticItems, source: source,
            telemetry: telemetry, announcer: announcer
        )
        return (model, source)
    }

    func waitUntil(_ condition: @escaping @MainActor () -> Bool, timeout: TimeInterval = 2) async {
        let start = Date()
        while !condition() {
            if Date().timeIntervalSince(start) > timeout { return }
            try? await Task.sleep(for: .milliseconds(5))
        }
    }
}

// MARK: - Interaction (lifecycle, filter, add / remove, cap, open / close, keyboard)

@MainActor
final class ComboboxMultiModelTests: ComboboxMultiModelTestCase {
    // MARK: Lifecycle + telemetry

    func testStartEmitsViewOpenedOnceAndAppliesInitial() {
        let spy = SpyComboboxMultiTelemetry()
        let (model, source) = makeModel(
            snapshot: ComboboxMultiSnapshot(selected: [fruits()[0]], staticItems: fruits()),
            telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ComboboxMulti.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(model.selected, [fruits()[0]])
        // The local input text is independent of the controlled value.
        XCTAssertEqual(model.query, "")
    }

    func testStopReArmsStartButViewOpenedFiresOnce() {
        let spy = SpyComboboxMultiTelemetry()
        let (model, source) = makeModel(snapshot: ComboboxMultiSnapshot(staticItems: fruits()), telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(source.startCount, 2)
        XCTAssertEqual(spy.surfaces, [ComboboxMulti.surfaceSlug], "view.opened fires once per instance")
    }

    // MARK: Filter + add (web click adds chip and hides it from the dropdown)

    func testSetQueryOpensAndFiltersCaseInsensitive() {
        let (model, _) = makeModel(snapshot: ComboboxMultiSnapshot(staticItems: fruits()))
        model.start()
        model.setQuery("AN")
        XCTAssertTrue(model.isOpen)
        let labels = model.candidates.map(\.label)
        XCTAssertTrue(labels.contains("Banana"))
        XCTAssertFalse(labels.contains("Apple"))
    }

    func testAddOptionAddsChipHidesFromDropdownClearsInput() {
        let (model, source) = makeModel(snapshot: ComboboxMultiSnapshot(staticItems: fruits()))
        model.start()
        model.open()
        model.setQuery("ban")
        model.addOption(fruits()[1]) // Banana
        XCTAssertEqual(model.selected, [fruits()[1]])
        XCTAssertEqual(source.values.last, [fruits()[1]])
        XCTAssertEqual(model.query, "", "input clears after add")
        XCTAssertTrue(model.isOpen, "list stays open for rapid multi-select")
        XCTAssertFalse(model.candidates.contains(fruits()[1]), "added option leaves the dropdown")
    }

    func testAddOptionRejectsDuplicates() {
        let (model, source) = makeModel(
            snapshot: ComboboxMultiSnapshot(selected: [fruits()[0]], staticItems: fruits())
        )
        model.start()
        model.addOption(fruits()[0]) // already selected
        XCTAssertEqual(model.selected, [fruits()[0]])
        XCTAssertTrue(source.values.isEmpty, "no onChange for a duplicate")
    }

    func testAddActiveAddsHighlightedOption() {
        let (model, source) = makeModel(snapshot: ComboboxMultiSnapshot(staticItems: fruits()))
        model.start()
        model.open() // active defaults to 0 (Apple)
        XCTAssertEqual(model.activeIndex, 0)
        model.moveDown() // active 1 (Banana)
        model.addActive()
        XCTAssertEqual(source.values.last, [fruits()[1]])
        XCTAssertEqual(model.selected, [fruits()[1]])
    }

    // MARK: Remove (chip button + Backspace)

    func testRemoveAtRemovesChipAndAnnounces() {
        let announcer = SpyComboboxMultiAnnouncer()
        let (model, source) = makeModel(
            snapshot: ComboboxMultiSnapshot(selected: [fruits()[0], fruits()[1]], staticItems: fruits()),
            announcer: announcer
        )
        model.start()
        model.removeAt(0) // remove Apple
        XCTAssertEqual(model.selected, [fruits()[1]])
        XCTAssertEqual(source.values.last, [fruits()[1]])
        XCTAssertTrue(announcer.messages.contains(ComboboxMultiStrings.removedChip("Apple")))
    }

    func testRemoveByItemIdentity() {
        let (model, source) = makeModel(
            snapshot: ComboboxMultiSnapshot(selected: [fruits()[0], fruits()[1]], staticItems: fruits())
        )
        model.start()
        model.remove(fruits()[0])
        XCTAssertEqual(source.values.last, [fruits()[1]])
    }

    func testBackspaceAtEmptyRemovesTrailingChip() {
        let (model, source) = makeModel(
            snapshot: ComboboxMultiSnapshot(selected: [fruits()[0], fruits()[1]], staticItems: fruits())
        )
        model.start()
        model.removeLast()
        XCTAssertEqual(model.selected, [fruits()[0]])
        XCTAssertEqual(source.values.last, [fruits()[0]])
    }

    func testBackspaceWithTextDoesNotRemoveChip() {
        let (model, source) = makeModel(
            snapshot: ComboboxMultiSnapshot(selected: [fruits()[0]], staticItems: fruits())
        )
        model.start()
        model.setQuery("b")
        model.removeLast()
        XCTAssertEqual(model.selected, [fruits()[0]])
        XCTAssertTrue(source.values.isEmpty, "no onChange while typing")
    }

    // MARK: maxItems cap (web atMax)

    func testMaxItemsCapsAdds() {
        let (model, source) = makeModel(
            snapshot: ComboboxMultiSnapshot(selected: [fruits()[0], fruits()[1]], staticItems: fruits()),
            config: ComboboxMultiConfig(label: "Fruits", maxItems: 2)
        )
        model.start()
        XCTAssertTrue(model.atMax)
        model.open()
        model.addOption(fruits()[2]) // Cherry — should be rejected
        XCTAssertEqual(model.selected.count, 2)
        XCTAssertTrue(source.values.isEmpty, "no onChange at the cap")
        XCTAssertTrue(model.listState.atMax)
    }

    // MARK: Open / close / disabled (web Escape, click-outside, disabled focus)

    func testCloseKeepsChipsAndTypedText() {
        let (model, _) = makeModel(
            snapshot: ComboboxMultiSnapshot(selected: [fruits()[0]], staticItems: fruits())
        )
        model.start()
        model.setQuery("xyz")
        model.close()
        XCTAssertFalse(model.isOpen)
        XCTAssertEqual(model.query, "xyz", "typed text is not reverted")
        XCTAssertEqual(model.selected, [fruits()[0]], "chips survive close")
        XCTAssertEqual(model.activeIndex, -1)
    }

    func testDisabledPreventsOpen() {
        let (model, _) = makeModel(
            snapshot: ComboboxMultiSnapshot(staticItems: fruits()),
            config: ComboboxMultiConfig(label: "Fruits", disabled: true)
        )
        model.start()
        model.open()
        XCTAssertFalse(model.isOpen)
    }

    func testArrowNavigationWrapsAndOpensWhenClosed() {
        let (model, _) = makeModel(snapshot: ComboboxMultiSnapshot(staticItems: fruits(3)))
        model.start()
        XCTAssertFalse(model.isOpen)
        model.moveDown() // closed → opens, active 0
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
        let (model, _) = makeModel(snapshot: ComboboxMultiSnapshot(staticItems: fruits()))
        model.start()
        model.toggleOpen()
        XCTAssertTrue(model.isOpen)
        model.toggleOpen()
        XCTAssertFalse(model.isOpen)
    }
}

// MARK: - Announcements + P4 connection axis + async loader

@MainActor
final class ComboboxMultiModelConnectionTests: ComboboxMultiModelTestCase {
    // MARK: Announcements

    func testAnnouncesResultCountOnlyOnChange() {
        let announcer = SpyComboboxMultiAnnouncer()
        let (model, _) = makeModel(snapshot: ComboboxMultiSnapshot(staticItems: fruits(4)), announcer: announcer)
        model.start()
        model.setQuery("a") // Apple, Banana, Date → 3 (Cherry excluded)
        let three = ComboboxMultiStrings.resultsCount(3)
        XCTAssertEqual(announcer.messages.last, three)
        model.setQuery("a ") // trailing space trimmed → still 3 → no re-announce
        XCTAssertEqual(announcer.messages.count(where: { $0 == three }), 1)
    }

    // MARK: Connection axis (P4 leaf)

    func testStaleTransitionAutoRefreshesOnceAndReArms() {
        let (model, source) = makeModel(
            snapshot: ComboboxMultiSnapshot(staticItems: fruits(), connection: .live)
        )
        model.start()
        XCTAssertEqual(model.connection, .live)
        source.push(ComboboxMultiSnapshot(staticItems: fruits(), connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)
        source.push(ComboboxMultiSnapshot(staticItems: fruits(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "no re-fire while still stale")
        source.push(ComboboxMultiSnapshot(staticItems: fruits(), connection: .live))
        source.push(ComboboxMultiSnapshot(staticItems: fruits(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2, "re-armed after returning to live")
    }

    func testOfflineKeepsRowsAndDoesNotAutoRefresh() {
        let (model, source) = makeModel(
            snapshot: ComboboxMultiSnapshot(staticItems: fruits(), connection: .live)
        )
        model.start()
        source.push(ComboboxMultiSnapshot(staticItems: fruits(), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
        model.open()
        XCTAssertEqual(model.listState.kind, .populated)
    }

    func testHostErrorSnapshotSurfacesErrorState() {
        let (model, _) = makeModel(snapshot: ComboboxMultiSnapshot(errorMessage: "down"))
        model.start()
        model.open()
        XCTAssertEqual(model.listState.kind, .error("down"))
    }

    // MARK: Async loader (web AbortController)

    func testAsyncLoaderResolvesRemovesSelectedAndPopulates() async {
        let source = InMemoryComboboxMultiSource(
            initial: ComboboxMultiSnapshot(selected: [ComboboxMultiItem(id: "abc", label: "abc")])
        )
        let loader: ComboboxMultiAsyncLoader = { query in
            [ComboboxMultiItem(id: query, label: query), ComboboxMultiItem(id: "abc", label: "abc")]
        }
        let model = ComboboxMultiModel(
            config: ComboboxMultiConfig(label: "Fruits"), provider: .async(loader),
            source: source, debounce: .milliseconds(1)
        )
        model.start()
        model.setQuery("xyz")
        await waitUntil { !model.loadedItems.isEmpty }
        // The already-selected "abc" is removed; only "xyz" remains a candidate.
        XCTAssertEqual(model.candidates.map(\.id), ["xyz"])
        XCTAssertEqual(model.listState.kind, .populated)
    }

    func testAsyncLoaderCancelsSupersededKeystroke() async {
        let source = InMemoryComboboxMultiSource(initial: ComboboxMultiSnapshot())
        let loader: ComboboxMultiAsyncLoader = { query in
            try await Task.sleep(for: .milliseconds(20))
            return [ComboboxMultiItem(id: query, label: query)]
        }
        let model = ComboboxMultiModel(
            config: ComboboxMultiConfig(label: "Fruits"), provider: .async(loader),
            source: source, debounce: .milliseconds(1)
        )
        model.start()
        model.setQuery("a")
        model.setQuery("ab")
        await waitUntil { !model.loadedItems.isEmpty }
        XCTAssertEqual(model.loadedItems.map(\.id), ["ab"], "newest keystroke wins")
    }

    func testAsyncLoaderFailureSurfacesErrorPhase() async {
        struct LoadError: Error {}
        let source = InMemoryComboboxMultiSource(initial: ComboboxMultiSnapshot())
        let loader: ComboboxMultiAsyncLoader = { _ in throw LoadError() }
        let model = ComboboxMultiModel(
            config: ComboboxMultiConfig(label: "Fruits"), provider: .async(loader),
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
private final class SpyComboboxMultiTelemetry: ComboboxMultiTelemetry, @unchecked Sendable {
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
private final class SpyComboboxMultiAnnouncer: ComboboxMultiAnnouncer {
    private(set) var messages: [String] = []

    func announce(_ message: String) {
        messages.append(message)
    }
}
