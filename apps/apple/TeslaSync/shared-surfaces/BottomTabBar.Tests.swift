//
//  BottomTabBar.Tests.swift
//  TeslaSync — P4 shared surface · 0165 · BottomTabBar (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types live
//  in BottomTabBar.AdapterTests.swift; split to keep each file within the SwiftLint file-length budget):
//    • BottomTabBarModel — the once-only `view.opened`, the projection derived from the bound route, the
//      navigation routing (a tap forwards the tab's path to `onNavigate`), the active-path read, and the props
//      update (re-derive on a new route, no-op on an unchanged one).
//    • Views — the public surface + the subviews compose in every real branch.
//    • Strings — the labels resolve through the P1/S10 facade with the English fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - BottomTabBarModel (state + routing + lifecycle)

@MainActor
final class BottomTabBarModelTests: XCTestCase {
    private func model(
        pathname: String,
        telemetry: BottomTabBarTelemetry = OSLogBottomTabBarTelemetry(),
        onNavigate: @escaping @MainActor (String) -> Void = { _ in }
    ) -> BottomTabBarModel {
        BottomTabBarModel(
            input: BottomTabBarInput(pathname: pathname),
            telemetry: telemetry,
            localize: { _, fallback in fallback },
            onNavigate: onNavigate
        )
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(pathname: "/", telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [BottomTabBarSurface.slug])
    }

    func testInitialProjectionReflectsTheBoundRoute() {
        let holder = model(pathname: "/charging")
        XCTAssertEqual(holder.projection.activeIndex, 2)
        XCTAssertEqual(holder.activePath, "/charging")
    }

    func testSelectForwardsTheTabPathToOnNavigate() {
        let recorder = NavigationRecorder()
        let holder = model(pathname: "/", onNavigate: { recorder.record($0) })
        holder.select("/drives")
        holder.select("/live")
        XCTAssertEqual(recorder.paths, ["/drives", "/live"])
    }

    func testUpdateReDerivesProjectionOnNewRoute() {
        let holder = model(pathname: "/")
        XCTAssertEqual(holder.activePath, "/")
        holder.update(BottomTabBarInput(pathname: "/battery"))
        XCTAssertEqual(holder.projection.activeIndex, 3)
        XCTAssertEqual(holder.activePath, "/battery")
    }

    func testUpdateToDeepRouteActivatesOwningTab() {
        let holder = model(pathname: "/")
        holder.update(BottomTabBarInput(pathname: "/charging/session/42"))
        XCTAssertEqual(holder.activePath, "/charging")
    }

    func testUpdateIsANoOpWhenRouteUnchanged() {
        let holder = model(pathname: "/drives")
        let before = holder.projection
        holder.update(BottomTabBarInput(pathname: "/drives"))
        XCTAssertEqual(holder.projection, before)
    }

    func testNoActiveRouteLeavesActivePathNil() {
        let holder = model(pathname: "/settings")
        XCTAssertNil(holder.activePath)
        XCTAssertNil(holder.projection.activeIndex)
    }

    func testLocalizedEmptyMessageRoutesThroughTheFacade() {
        let holder = model(pathname: "/")
        XCTAssertEqual(holder.localizedEmptyMessage, "No destinations available")
    }
}

// MARK: - Views (every real branch composes)

@MainActor
final class BottomTabBarViewTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = BottomTabBar(pathname: "/", localize: { _, fallback in fallback })
        _ = BottomTabBar(pathname: "/charging/abc", localize: { _, fallback in fallback })
        _ = BottomTabBar(pathname: "/settings", localize: { _, fallback in fallback })
        _ = BottomTabBar(pathname: "/", tabs: [], localize: { _, fallback in fallback })
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = BottomTabBarModel(
            input: BottomTabBarInput(pathname: "/live"),
            telemetry: SpyTelemetry(),
            localize: { _, fallback in fallback }
        )
        _ = BottomTabBar(model: injected)
        XCTAssertEqual(BottomTabBar.surfaceSlug, "BottomTabBar")
    }

    func testSubviewsCompose() {
        _ = BottomTabBarItem(
            tab: BottomTabBarTabState(path: "/", symbol: "house.fill", label: "Home", isActive: true),
            onSelect: {}
        )
        _ = BottomTabBarItem(
            tab: BottomTabBarTabState(path: "/drives", symbol: "car.fill", label: "Drives", isActive: false),
            onSelect: {}
        )
        _ = BottomTabBarEmptyState(message: "No destinations available")
    }
}

// MARK: - Strings facade (P1/S10)

final class BottomTabBarStringsTests: XCTestCase {
    func testTableName() {
        XCTAssertEqual(BottomTabBarStrings.table, "BottomTabBar")
    }

    func testWebKeyFallbacks() {
        XCTAssertEqual(BottomTabBarStrings.quickNavigation, "Quick navigation")
        XCTAssertEqual(BottomTabBarStrings.dashboard, "Home")
        XCTAssertEqual(BottomTabBarStrings.drives, "Drives")
        XCTAssertEqual(BottomTabBarStrings.charging, "Charging")
        XCTAssertEqual(BottomTabBarStrings.battery, "Battery")
        XCTAssertEqual(BottomTabBarStrings.liveMap, "Map")
    }

    func testNativeEmptyFallback() {
        XCTAssertEqual(BottomTabBarStrings.emptyMessage, "No destinations available")
    }

    func testLocalizeClosureResolvesFallbacks() {
        XCTAssertEqual(BottomTabBarStrings.localize("nav.dashboard", "Home"), "Home")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: BottomTabBarTelemetry, @unchecked Sendable {
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

/// Records the routes forwarded through `onNavigate` (the `@MainActor` router seam).
@MainActor
private final class NavigationRecorder {
    private(set) var paths: [String] = []

    func record(_ path: String) {
        paths.append(path)
    }
}
