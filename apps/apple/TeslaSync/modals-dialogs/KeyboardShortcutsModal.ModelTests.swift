//
//  KeyboardShortcutsModal.ModelTests.swift
//  TeslaSync — P4 modal/dialog · 0006 · KeyboardShortcutsModal (Apple)
//
//  State-holder coverage for `KBShortcutsModel`: the P1/S11 `view.opened` telemetry (once + idempotent),
//  the phase transitions across loading / loaded-empty / failed (incl. keeping content when a cached
//  snapshot survives a failed reload), the live search filtering (web `SearchInput`) + the search reset
//  on close (web `useEffect` on `open`), the persisted filter (web sessionStorage — restored on start,
//  saved on change), the route-gated grouping, the stale auto-refresh (once, re-armed on return to live),
//  offline keeping the cached list, and the dismiss seam. Driven through the in-memory source — no store
//  reads, no navigation.
//

import XCTest
@testable import TeslaSync

/// Identity localizer for deterministic copy in assertions.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

/// Records the `view.opened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam.
private final class SpyKBShortcutsTelemetry: KBShortcutsTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func viewOpened(surface: String) {
        lock.withLock { storage.append(surface) }
    }

    var surfaces: [String] {
        lock.withLock { storage }
    }
}

/// Records dismiss calls.
private final class SpyKBShortcutsController: KBShortcutsController, @unchecked Sendable {
    private let lock = NSLock()
    private var dismisses = 0

    func dismiss() {
        lock.withLock { dismisses += 1 }
    }

    var dismissCount: Int {
        lock.withLock { dismisses }
    }
}

private func sampleEntry(
    id: String,
    description: String = "Do thing",
    group: String = "Global",
    scope: KBShortcutScope = .global,
    routeMatch: KBShortcutRouteMatch? = nil
) -> KBShortcutEntry {
    KBShortcutEntry(id: id, keys: ["?"], description: description, group: group, scope: scope, routeMatch: routeMatch)
}

private let sampleEntries: [KBShortcutEntry] = [
    sampleEntry(id: "a", description: "Go to dashboard", group: "Navigation", scope: .global),
    sampleEntry(id: "b", description: "Open palette", group: "Actions", scope: .global),
    sampleEntry(
        id: "c",
        description: "Play replay",
        group: "Trip replay",
        scope: .route,
        routeMatch: .prefix("/replay")
    )
]

@MainActor
final class KBShortcutsModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryKBShortcutsSource,
        telemetry: SpyKBShortcutsTelemetry = SpyKBShortcutsTelemetry(),
        controller: SpyKBShortcutsController = SpyKBShortcutsController(),
        filterStore: KBShortcutsFilterStore = InMemoryKBShortcutsFilterStore()
    ) -> KBShortcutsModel {
        KBShortcutsModel(
            source: source,
            telemetry: telemetry,
            controller: controller,
            filterStore: filterStore,
            localize: passthroughLocalize
        )
    }

    // MARK: Telemetry + phases

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyKBShortcutsTelemetry()
        let source = InMemoryKBShortcutsSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["KeyboardShortcutsModal"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadingThenContent() {
        let source = InMemoryKBShortcutsSource(initial: KBShortcutsUpdate(status: .loading))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(KBShortcutsUpdate(status: .loaded, entries: sampleEntries, pathname: "/replay/1"))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.groups.map(\.title), ["Navigation", "Actions", "Trip replay"])
    }

    func testLoadedNoEntriesResolvesEmpty() {
        let source = InMemoryKBShortcutsSource(initial: KBShortcutsUpdate(status: .loaded))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.groups.isEmpty)
    }

    func testFailedNoEntriesResolvesError() {
        let source = InMemoryKBShortcutsSource(initial: KBShortcutsUpdate(status: .failed("timeout")))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testFailedWithEntriesKeepsContent() {
        let loaded = KBShortcutsUpdate(status: .loaded, entries: sampleEntries, pathname: "/replay/1")
        let source = InMemoryKBShortcutsSource(initial: loaded)
        let model = makeModel(source: source)
        model.start()
        source.push(KBShortcutsUpdate(status: .failed("stale read"), entries: sampleEntries, pathname: "/replay/1"))
        XCTAssertEqual(model.phase, .content)
    }

    // MARK: Search

    func testSearchFiltersGroupsAndCanResolveEmpty() {
        let source = InMemoryKBShortcutsSource(
            initial: KBShortcutsUpdate(status: .loaded, entries: sampleEntries, pathname: "/replay/1")
        )
        let model = makeModel(source: source)
        model.start()
        model.updateSearch("palette")
        XCTAssertEqual(model.groups.map(\.title), ["Actions"])
        XCTAssertEqual(model.phase, .content)
        model.updateSearch("zzzz")
        XCTAssertTrue(model.groups.isEmpty)
        XCTAssertEqual(model.phase, .empty)
    }

    func testResetSearchClearsTheBox() {
        let source = InMemoryKBShortcutsSource(
            initial: KBShortcutsUpdate(status: .loaded, entries: sampleEntries, pathname: "/replay/1")
        )
        let model = makeModel(source: source)
        model.start()
        model.updateSearch("palette")
        XCTAssertEqual(model.search, "palette")
        model.resetSearch()
        XCTAssertEqual(model.search, "")
        XCTAssertEqual(model.groups.count, 3)
    }

    // MARK: Filter + persistence

    func testSetFilterPersistsAndChangesGroups() {
        let store = InMemoryKBShortcutsFilterStore()
        let source = InMemoryKBShortcutsSource(
            initial: KBShortcutsUpdate(status: .loaded, entries: sampleEntries, pathname: "/replay/1")
        )
        let model = makeModel(source: source, filterStore: store)
        model.start()
        model.setFilter(.global)
        XCTAssertEqual(model.groups.map(\.title), ["Navigation", "Actions"])
        XCTAssertEqual(store.load(), .global)
        model.setFilter(.page)
        XCTAssertEqual(model.groups.map(\.title), ["Trip replay"])
        XCTAssertEqual(store.load(), .page)
    }

    func testStartRestoresPersistedFilter() {
        let store = InMemoryKBShortcutsFilterStore(initial: .global)
        let source = InMemoryKBShortcutsSource(
            initial: KBShortcutsUpdate(status: .loaded, entries: sampleEntries, pathname: "/replay/1")
        )
        let model = makeModel(source: source, filterStore: store)
        model.start()
        XCTAssertEqual(model.filter, .global)
        XCTAssertEqual(model.groups.map(\.title), ["Navigation", "Actions"])
    }

    // MARK: Route gating

    func testRouteScopedShortcutsHiddenOffRoute() {
        let source = InMemoryKBShortcutsSource(
            initial: KBShortcutsUpdate(status: .loaded, entries: sampleEntries, pathname: "/drives")
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.groups.map(\.title), ["Navigation", "Actions"])
    }

    // MARK: Freshness

    func testStaleAutoRefreshesOnceThenReArms() {
        let loaded = KBShortcutsUpdate(status: .loaded, entries: sampleEntries, pathname: "/replay/1")
        let source = InMemoryKBShortcutsSource(initial: loaded)
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(KBShortcutsUpdate(status: .loaded, entries: sampleEntries, connection: .stale))
        source.push(KBShortcutsUpdate(status: .loaded, entries: sampleEntries, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(KBShortcutsUpdate(status: .loaded, entries: sampleEntries, connection: .live))
        source.push(KBShortcutsUpdate(status: .loaded, entries: sampleEntries, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsContentAndDoesNotRefresh() {
        let loaded = KBShortcutsUpdate(status: .loaded, entries: sampleEntries, pathname: "/replay/1")
        let source = InMemoryKBShortcutsSource(initial: loaded)
        let model = makeModel(source: source)
        model.start()
        source.push(KBShortcutsUpdate(status: .loaded, entries: sampleEntries, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }

    // MARK: Dismiss

    func testDismissDelegatesToController() {
        let controller = SpyKBShortcutsController()
        let source = InMemoryKBShortcutsSource(
            initial: KBShortcutsUpdate(status: .loaded, entries: sampleEntries, pathname: "/replay/1")
        )
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.dismiss()
        XCTAssertEqual(controller.dismissCount, 1)
    }
}
