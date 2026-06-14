//
//  Tabs.Tests.swift
//  TeslaSync — P4 shared surface · 0227 · Tabs (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure navigation rule + value
//  types live in Tabs.AdapterTests.swift; split to keep each file within the SwiftLint file-length budget):
//    • TabsController — the once-only `view.opened` (+ stop / start idempotence), the `select` activation
//      gated by the disabled predicate (web `onChange` only fires for an enabled tab), the `moveFocus`
//      roving navigation (fires `onChange` with the resolved key + returns it, skips disabled, wraps,
//      Home / End, and no-ops from a non-enabled key or with no enabled tabs), the props-update guard, the
//      id helpers, and the empty-label resolution through the injected facade.
//    • Views — the public surface + the subviews compose in every branch.
//    • Strings — the empty-state message resolves through the P1/S10 facade with the English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure and the
//  callbacks are recorded by a `@MainActor` spy, the same actor as the controller (no cross-actor sync).
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - TabsController (state-holder + actions + lifecycle)

@MainActor
final class TabsControllerTests: XCTestCase {
    /// A resolver that echoes the fallback — the deterministic native shape of `t` in tests.
    private let echo: TabsResolve = { _, fallback in fallback }

    private func makeController(
        tabs: [TabItem],
        active: String,
        onChange: @escaping (String) -> Void = { _ in },
        telemetry: any TabsTelemetry = OSLogTabsTelemetry(),
        resolve: @escaping TabsResolve = { _, fallback in fallback }
    ) -> TabsController {
        TabsController(
            input: TabsInput(tabs: tabs, activeTab: active),
            onChange: onChange,
            tablistID: "t1",
            resolve: resolve,
            telemetry: telemetry
        )
    }

    private var threeTabs: [TabItem] {
        [
            TabItem(key: "a", label: "A"),
            TabItem(key: "b", label: "B", disabled: true),
            TabItem(key: "c", label: "C")
        ]
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTabsTelemetry()
        let controller = makeController(tabs: threeTabs, active: "a", telemetry: spy)
        controller.start()
        controller.start()
        XCTAssertEqual(spy.surfaces, [TabsSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTabsTelemetry()
        let controller = makeController(tabs: threeTabs, active: "a", telemetry: spy)
        controller.start()
        controller.stop()
        controller.start()
        XCTAssertEqual(spy.surfaces, [TabsSurface.slug], "view.opened fires once per instance")
    }

    func testSelectFiresForEnabledAndNoOpsForDisabledOrUnknown() {
        let spy = TabsActionSpy()
        let controller = makeController(tabs: threeTabs, active: "a", onChange: spy.recordKey)
        controller.select("b") // disabled → no-op (web button is `disabled`)
        XCTAssertEqual(spy.keys, [])
        controller.select("zzz") // unknown → no-op
        XCTAssertEqual(spy.keys, [])
        controller.select("a") // enabled (re-selecting the active tab still reports, web parity)
        controller.select("c")
        XCTAssertEqual(spy.keys, ["a", "c"])
    }

    func testMoveFocusSkipsDisabledActivatesAndReturnsKey() {
        let spy = TabsActionSpy()
        let controller = makeController(tabs: threeTabs, active: "a", onChange: spy.recordKey)
        let next = controller.moveFocus(.next, from: "a") // skip disabled "b" → "c"
        XCTAssertEqual(next, "c")
        XCTAssertEqual(spy.keys, ["c"])
    }

    func testMoveFocusWrapsAndHandlesHomeEnd() {
        let spy = TabsActionSpy()
        let controller = makeController(
            tabs: [TabItem(key: "a", label: "A"), TabItem(key: "c", label: "C")],
            active: "a",
            onChange: spy.recordKey
        )
        XCTAssertEqual(controller.moveFocus(.previous, from: "a"), "c") // wrap to last
        XCTAssertEqual(controller.moveFocus(.first, from: "c"), "a") // Home
        XCTAssertEqual(controller.moveFocus(.last, from: "a"), "c") // End
        XCTAssertEqual(spy.keys, ["c", "a", "c"])
    }

    func testMoveFocusNoOpsFromNonEnabledKeyAndWhenNoneEnabled() {
        let spy = TabsActionSpy()
        let controller = makeController(tabs: threeTabs, active: "a", onChange: spy.recordKey)
        XCTAssertNil(controller.moveFocus(.next, from: "b"), "arrow from a disabled/non-enabled key is a no-op")
        XCTAssertTrue(spy.keys.isEmpty)

        let allDisabled = makeController(
            tabs: [TabItem(key: "a", label: "A", disabled: true)],
            active: "a",
            onChange: spy.recordKey
        )
        XCTAssertNil(allDisabled.moveFocus(.first, from: "a"))
        XCTAssertTrue(spy.keys.isEmpty)
    }

    func testUpdateAppliesNewInputAndGuardsIdentical() {
        let controller = makeController(tabs: [TabItem(key: "a", label: "A")], active: "a")
        controller.update(TabsInput(tabs: [TabItem(key: "a", label: "A")], activeTab: "a")) // identical
        XCTAssertEqual(controller.input.activeTab, "a")
        XCTAssertEqual(controller.input.tabs.count, 1)
        controller.update(
            TabsInput(tabs: [TabItem(key: "a", label: "A"), TabItem(key: "b", label: "B")], activeTab: "b")
        )
        XCTAssertEqual(controller.input.activeTab, "b")
        XCTAssertEqual(controller.input.tabs.count, 2)
    }

    func testIDHelpersAndProjectionReflectInput() {
        let controller = makeController(tabs: [TabItem(key: "a", label: "A")], active: "a")
        XCTAssertEqual(controller.tabElementID(forKey: "a"), "t1-tab-a")
        XCTAssertEqual(controller.panelID(forKey: "a"), "t1-panel-a")
        XCTAssertEqual(controller.tablistID, "t1")
        XCTAssertEqual(controller.projection.selectedKey, "a")
        XCTAssertFalse(controller.projection.isEmpty)
    }

    func testEmptyLabelResolvesThroughInjectedResolver() {
        let controller = makeController(
            tabs: [],
            active: "",
            resolve: { key, fallback in key == TabsStrings.emptyKey ? "Keine Tabs" : fallback }
        )
        XCTAssertEqual(controller.emptyLabel, "Keine Tabs")
        XCTAssertTrue(controller.projection.isEmpty)
        XCTAssertEqual(controller.projection.emptyLabel, "Keine Tabs")
        _ = echo // silence the unused deterministic resolver in this suite
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class TabsViewTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = Tabs(
            tabs: [TabItem(key: "a", label: "A"), TabItem(key: "b", label: "B", disabled: true)],
            activeTab: "a",
            ariaLabel: "Sections"
        ) { _ in }
        _ = Tabs(tabs: [], activeTab: "") { _ in } // empty branch
        XCTAssertEqual(Tabs.surfaceSlug, "Tabs")
    }

    func testSurfaceComposesFromInjectedController() {
        let injected = TabsController(
            input: TabsInput(tabs: [TabItem(key: "a", label: "A")], activeTab: "a"),
            onChange: { _ in },
            telemetry: SpyTabsTelemetry()
        )
        _ = Tabs(controller: injected)
    }

    func testSubviewsCompose() {
        let item = TabsItemProjection(
            key: "a", label: "A", isSelected: true, isDisabled: false,
            tabElementID: "t1-tab-a", panelID: "t1-panel-a"
        )
        _ = TabButton(item: item, onSelect: {}, onMove: { _ in })
        _ = TabsEmptyView(message: "No tabs available")
        _ = TabsStrip(controller: TabsController(
            input: TabsInput(tabs: [TabItem(key: "a", label: "A")], activeTab: "a"),
            onChange: { _ in }
        ))
    }
}

// MARK: - Strings facade (P1/S10)

final class TabsStringsTests: XCTestCase {
    func testEmptyMessageFallback() {
        XCTAssertEqual(TabsStrings.emptyKey, "tabs.empty")
        XCTAssertEqual(TabsStrings.emptyDefault, "No tabs available")
        XCTAssertEqual(
            TabsStrings.resolve(TabsStrings.emptyKey, TabsStrings.emptyDefault),
            "No tabs available"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it satisfies the
/// `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyTabsTelemetry: TabsTelemetry, @unchecked Sendable {
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

/// Records the keys the controller fires through `onChange`. `@MainActor` like the controller it observes,
/// so no cross-actor synchronization is needed.
@MainActor
private final class TabsActionSpy {
    private(set) var keys: [String] = []

    func recordKey(_ key: String) {
        keys.append(key)
    }
}
