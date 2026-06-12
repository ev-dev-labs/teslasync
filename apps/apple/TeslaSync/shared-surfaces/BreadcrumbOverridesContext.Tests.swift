//
//  BreadcrumbOverridesContext.Tests.swift
//  TeslaSync — P4 shared surface · 0166 · BreadcrumbOverridesContext (Apple)
//
//  The projection + state-holder + store + view-composition half of the coverage (the pure reducer +
//  matcher + builder live in BreadcrumbOverridesContext.AdapterTests.swift; split to keep each file
//  within the SwiftLint file-length budget):
//    • Projection — the resolved trail reads (items / isEmpty / isSuppressed / isRendered / current /
//      ancestors / count / appliedOverrideCount) over a route + overrides.
//    • BreadcrumbOverridesStore — register / unregister / merged, no-op-on-unchanged + no-op-on-unknown
//      (web stable-identity + `if (!prev.has(id))`), monotonic ids, later-wins merge, reset, singleton.
//    • BreadcrumbOverridesState — the overrides / register / unregister reads, the once-only
//      `view.opened`, stop-does-not-clear, cross-state sharing over one store.
//    • Views — the provider (store / state inits), the reader, the modifier spellings, the trail view
//      (suppressed + rendered), the inspector + sample compose; the copy resolves through P1/S10.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the store is in-process.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Projection (web useBreadcrumbs return + Breadcrumbs suppression)

final class BreadcrumbOverridesProjectionTests: XCTestCase {
    private let fallbackOnly: BreadcrumbOverridesLocalize = { _, fallback in fallback }

    private func table() -> BreadcrumbOverridesRouteTable {
        BreadcrumbOverridesRouteTable([
            BreadcrumbOverridesRouteMeta(pattern: "/drives", i18nKey: "k.drives", defaultLabel: "Drives"),
            BreadcrumbOverridesRouteMeta(
                pattern: "/drives/:id",
                i18nKey: "k.drive",
                defaultLabel: "Drive #{{id}}",
                parent: "/drives"
            )
        ])
    }

    func testUnknownRouteIsEmptyAndSuppressed() {
        let resolved = BreadcrumbOverridesProjection.resolve(
            table: table(), path: "/nope", overrides: [:], localize: fallbackOnly
        )
        XCTAssertTrue(resolved.isEmpty)
        XCTAssertTrue(resolved.isSuppressed)
        XCTAssertFalse(resolved.isRendered)
        XCTAssertNil(resolved.current)
        XCTAssertEqual(resolved.count, 0)
    }

    func testTopLevelIsSuppressed() {
        let resolved = BreadcrumbOverridesProjection.resolve(
            table: table(), path: "/drives", overrides: [:], localize: fallbackOnly
        )
        XCTAssertFalse(resolved.isEmpty)
        XCTAssertTrue(resolved.isSuppressed, "a single-item trail self-suppresses (web items.length <= 1)")
    }

    func testRenderedTrailExposesCurrentAndAncestors() {
        let resolved = BreadcrumbOverridesProjection.resolve(
            table: table(), path: "/drives/4421", overrides: [:], localize: fallbackOnly
        )
        XCTAssertTrue(resolved.isRendered)
        XCTAssertEqual(resolved.count, 2)
        XCTAssertEqual(resolved.current?.label, "Drive #4421")
        XCTAssertEqual(resolved.ancestors.map(\.label), ["Drives"])
    }

    func testAppliedOverrideCount() {
        let resolved = BreadcrumbOverridesProjection.resolve(
            table: table(),
            path: "/drives/4421",
            overrides: ["/drives/:id": "Trip", "/unrelated": "Nope"],
            localize: fallbackOnly
        )
        XCTAssertEqual(resolved.appliedOverrideCount, 1, "only overrides landing on a trail route count")
        XCTAssertEqual(resolved.current?.label, "Trip")
    }

    func testEmptyConstant() {
        XCTAssertTrue(BreadcrumbOverridesTrailResolved.empty.isEmpty)
    }
}

// MARK: - BreadcrumbOverridesStore (web provider registrations state)

@MainActor
final class BreadcrumbOverridesStoreTests: XCTestCase {
    func testNewStoreIsEmpty() {
        let store = BreadcrumbOverridesStore()
        XCTAssertTrue(store.registrations.isEmpty)
        XCTAssertTrue(store.merged.isEmpty)
    }

    func testNextRegistrationIDIsMonotonic() {
        let store = BreadcrumbOverridesStore()
        XCTAssertEqual(store.nextRegistrationID(), 1)
        XCTAssertEqual(store.nextRegistrationID(), 2)
        XCTAssertEqual(store.nextRegistrationID(), 3)
    }

    func testRegisterAndMerged() {
        let store = BreadcrumbOverridesStore()
        store.register(id: 1, map: ["/drives/:id": "Trip"])
        XCTAssertEqual(store.merged, ["/drives/:id": "Trip"])
        XCTAssertEqual(store.override(for: "/drives/:id"), "Trip")
    }

    func testRegisterDropsEmptyLabels() {
        let store = BreadcrumbOverridesStore()
        store.register(id: 1, map: ["/a": "Alpha", "/b": ""])
        XCTAssertEqual(store.registrations[1], ["/a": "Alpha"])
    }

    func testRegisterUnchangedIsNoOp() {
        let store = BreadcrumbOverridesStore()
        store.register(id: 1, map: ["/a": "Alpha"])
        let before = store.registrations
        store.register(id: 1, map: ["/a": "Alpha"])
        XCTAssertEqual(store.registrations, before, "an unchanged registration is skipped (web serialised guard)")
    }

    func testUnregister() {
        let store = BreadcrumbOverridesStore()
        store.register(id: 1, map: ["/a": "Alpha"])
        store.unregister(id: 1)
        XCTAssertTrue(store.registrations.isEmpty)
        XCTAssertTrue(store.merged.isEmpty)
    }

    func testUnregisterUnknownIsNoOp() {
        let store = BreadcrumbOverridesStore()
        store.unregister(id: 99)
        XCTAssertTrue(store.registrations.isEmpty)
    }

    func testMergedLaterWins() {
        let store = BreadcrumbOverridesStore()
        store.register(id: 1, map: ["/a": "First"])
        store.register(id: 2, map: ["/a": "Second"])
        XCTAssertEqual(store.merged["/a"], "Second")
    }

    func testResolvedTrailUsesMergedOverrides() {
        let store = BreadcrumbOverridesStore()
        store.register(id: 1, map: ["/drives/:id": "Trip to office"])
        let table = BreadcrumbOverridesRouteTable([
            BreadcrumbOverridesRouteMeta(pattern: "/drives", i18nKey: "k.d", defaultLabel: "Drives"),
            BreadcrumbOverridesRouteMeta(
                pattern: "/drives/:id", i18nKey: "k.x", defaultLabel: "Drive", parent: "/drives"
            )
        ])
        let resolved = store.resolvedTrail(table: table, path: "/drives/9") { _, fallback in fallback }
        XCTAssertEqual(resolved.current?.label, "Trip to office")
    }

    func testReset() {
        let store = BreadcrumbOverridesStore()
        store.register(id: 1, map: ["/a": "Alpha"])
        store.reset()
        XCTAssertTrue(store.registrations.isEmpty)
    }

    func testSharedIsASingleton() {
        XCTAssertTrue(BreadcrumbOverridesStore.shared === BreadcrumbOverridesStore.shared)
    }
}

// MARK: - BreadcrumbOverridesState (web context value)

@MainActor
final class BreadcrumbOverridesStateTests: XCTestCase {
    private func makeState(
        store: BreadcrumbOverridesStore = BreadcrumbOverridesStore(),
        spy: SpyBreadcrumbOverridesTelemetry
    ) -> BreadcrumbOverridesState {
        BreadcrumbOverridesState(store: store, telemetry: spy)
    }

    func testOverridesReadStore() {
        let store = BreadcrumbOverridesStore()
        let state = makeState(store: store, spy: SpyBreadcrumbOverridesTelemetry())
        XCTAssertTrue(state.overrides.isEmpty)
        store.register(id: 1, map: ["/a": "Alpha"])
        XCTAssertEqual(state.overrides, ["/a": "Alpha"])
    }

    func testRegisterOverridesAllocatesIDAndRegisters() {
        let store = BreadcrumbOverridesStore()
        let state = makeState(store: store, spy: SpyBreadcrumbOverridesTelemetry())
        let id = state.registerOverrides(["/a": "Alpha"])
        XCTAssertNotNil(id)
        XCTAssertEqual(store.merged, ["/a": "Alpha"])
    }

    func testRegisterOverridesBlankInputReturnsNil() {
        let state = makeState(spy: SpyBreadcrumbOverridesTelemetry())
        XCTAssertNil(state.registerOverrides(nil))
        XCTAssertNil(state.registerOverrides([:]))
        XCTAssertNil(state.registerOverrides(["/a": ""]))
    }

    func testRegisterAndUnregisterByID() {
        let store = BreadcrumbOverridesStore()
        let state = makeState(store: store, spy: SpyBreadcrumbOverridesTelemetry())
        state.register(id: 7, map: ["/a": "Alpha"])
        XCTAssertEqual(store.merged, ["/a": "Alpha"])
        state.unregister(id: 7)
        XCTAssertTrue(store.merged.isEmpty)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyBreadcrumbOverridesTelemetry()
        let state = makeState(spy: spy)
        state.start()
        state.start()
        XCTAssertEqual(spy.surfaces, [BreadcrumbOverridesSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyBreadcrumbOverridesTelemetry()
        let state = makeState(spy: spy)
        state.start()
        state.stop()
        state.start()
        XCTAssertEqual(spy.surfaces, [BreadcrumbOverridesSurface.slug], "view.opened fires once per instance")
    }

    func testStopDoesNotClearStore() {
        let store = BreadcrumbOverridesStore()
        let state = makeState(store: store, spy: SpyBreadcrumbOverridesTelemetry())
        state.register(id: 1, map: ["/a": "Alpha"])
        state.start()
        state.stop()
        XCTAssertEqual(store.merged, ["/a": "Alpha"], "tearing down a provider must not drop another page's labels")
    }

    func testStatesSharingStoreSeeEachOther() {
        let store = BreadcrumbOverridesStore()
        let pageA = makeState(store: store, spy: SpyBreadcrumbOverridesTelemetry())
        let pageB = makeState(store: store, spy: SpyBreadcrumbOverridesTelemetry())
        pageA.register(id: 1, map: ["/a": "Alpha"])
        XCTAssertEqual(pageB.overrides, ["/a": "Alpha"])
    }
}

// MARK: - Views (every branch composes + label presence)

@MainActor
final class BreadcrumbOverridesViewTests: XCTestCase {
    func testProviderComposesForBothInits() {
        _ = BreadcrumbOverridesProvider(store: BreadcrumbOverridesStore()) { EmptyView() }
        let state = BreadcrumbOverridesState(store: BreadcrumbOverridesStore())
        _ = BreadcrumbOverridesProvider(state: state) { EmptyView() }
    }

    func testReaderComposes() {
        _ = BreadcrumbOverridesReader { overrides in
            Text(verbatim: overrides.isEmpty ? "none" : "active")
        }
    }

    func testModifierSpellingsCompose() {
        _ = EmptyView().breadcrumbOverridesProvider(store: BreadcrumbOverridesStore())
        _ = EmptyView().setBreadcrumbOverrides(["/a": "Alpha"])
        _ = EmptyView().setBreadcrumbOverrides(nil)
    }

    func testTrailViewComposesSuppressedAndRendered() {
        _ = BreadcrumbOverridesTrailView(items: [])
        let items = BreadcrumbOverridesProjection.resolve(
            table: BreadcrumbOverridesSampleData.table,
            path: "/drives/4421",
            overrides: [:],
            localize: BreadcrumbOverridesStrings.localize
        ).items
        _ = BreadcrumbOverridesTrailView(items: items, onSelect: { _ in }, onHome: {})
    }

    func testInspectorAndSampleCompose() {
        _ = BreadcrumbOverridesContextSample()
        for scenario in BreadcrumbOverridesScenario.allCases {
            _ = BreadcrumbOverridesScenarioRow(scenario: scenario)
        }
        XCTAssertFalse(BreadcrumbOverridesSampleData.table.entries.isEmpty)
    }

    func testSurfaceSlugExposedOnProvider() {
        XCTAssertEqual(BreadcrumbOverridesProvider<EmptyView>.surfaceSlug, "BreadcrumbOverridesContext")
    }

    func testCopyResolvesFromCatalog() {
        XCTAssertEqual(BreadcrumbOverridesStrings.string("breadcrumbOverrides.a11y.nav", "Breadcrumb"), "Breadcrumb")
        XCTAssertEqual(BreadcrumbOverridesStrings.string("breadcrumbOverrides.a11y.home", "Dashboard"), "Dashboard")
        XCTAssertEqual(BreadcrumbOverridesStrings.localize("any.key", "Fallback"), "Fallback")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyBreadcrumbOverridesTelemetry: BreadcrumbOverridesTelemetry, @unchecked Sendable {
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
