//
//  BottomTabBar.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0165 · BottomTabBar (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the canonical catalog (the
//  verbatim port of the web `TABS` + `BOTTOM_TAB_PATHS`), the active-path match (the verbatim port of the web
//  `isActive` rule), the active index, the label resolution + whole projection, and the value-type equality.
//  Split from BottomTabBar.Tests.swift (the SwiftUI / state-holder half) to keep each file within the SwiftLint
//  file-length budget. These run in the TeslaSync(/-macOS) XCTest targets; the derivation is pure, with no
//  network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class BottomTabBarAdapterIdentityTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(BottomTabBarSurface.slug, "BottomTabBar")
    }
}

// MARK: - Catalog (web `TABS` + `BOTTOM_TAB_PATHS`)

final class BottomTabBarCatalogTests: XCTestCase {
    func testCatalogReproducesTheFiveWebTabsInOrder() {
        let paths = BottomTabBarCatalog.tabs.map(\.path)
        XCTAssertEqual(paths, ["/", "/drives", "/charging", "/battery", "/live"])
    }

    func testCatalogCarriesLabelKeysAndFallbacks() {
        let byPath = Dictionary(uniqueKeysWithValues: BottomTabBarCatalog.tabs.map { ($0.path, $0) })
        XCTAssertEqual(byPath["/"]?.labelKey, "nav.dashboard")
        XCTAssertEqual(byPath["/"]?.labelFallback, "Home")
        XCTAssertEqual(byPath["/drives"]?.labelKey, "nav.drives")
        XCTAssertEqual(byPath["/charging"]?.labelKey, "nav.charging")
        XCTAssertEqual(byPath["/battery"]?.labelKey, "nav.battery")
        XCTAssertEqual(byPath["/live"]?.labelKey, "nav.liveMap")
        XCTAssertEqual(byPath["/live"]?.labelFallback, "Map")
    }

    func testEveryTabHasASystemImage() {
        for item in BottomTabBarCatalog.tabs {
            XCTAssertFalse(item.symbol.isEmpty, "tab \(item.path) must carry an SF Symbol")
        }
    }

    func testPathsSetMatchesCatalog() {
        XCTAssertEqual(BottomTabBarCatalog.paths, ["/", "/drives", "/charging", "/battery", "/live"])
    }
}

// MARK: - Active path (web `isActive`)

final class BottomTabBarActivePathTests: XCTestCase {
    func testRootMatchesOnlyItself() {
        XCTAssertTrue(BottomTabBarProjector.isActivePath("/", "/"))
        XCTAssertFalse(BottomTabBarProjector.isActivePath("/drives", "/"))
        XCTAssertFalse(BottomTabBarProjector.isActivePath("/charging/abc", "/"))
    }

    func testExactMatchActivates() {
        XCTAssertTrue(BottomTabBarProjector.isActivePath("/drives", "/drives"))
        XCTAssertTrue(BottomTabBarProjector.isActivePath("/charging", "/charging"))
    }

    func testPrefixMatchActivates() {
        XCTAssertTrue(BottomTabBarProjector.isActivePath("/charging/123", "/charging"))
        XCTAssertTrue(BottomTabBarProjector.isActivePath("/drives/2024/05", "/drives"))
    }

    func testSiblingPrefixDoesNotFalseMatch() {
        // "/charging-history" must NOT activate "/charging" (the web guards with the trailing slash).
        XCTAssertFalse(BottomTabBarProjector.isActivePath("/charging-history", "/charging"))
        XCTAssertFalse(BottomTabBarProjector.isActivePath("/batterycells", "/battery"))
    }

    func testUnrelatedRouteMatchesNothing() {
        XCTAssertFalse(BottomTabBarProjector.isActivePath("/settings", "/drives"))
    }
}

// MARK: - Active index

final class BottomTabBarActiveIndexTests: XCTestCase {
    private let tabs = BottomTabBarCatalog.tabs

    func testEachTabResolvesToItsOwnIndex() {
        XCTAssertEqual(BottomTabBarProjector.activeIndex(pathname: "/", tabs: tabs), 0)
        XCTAssertEqual(BottomTabBarProjector.activeIndex(pathname: "/drives", tabs: tabs), 1)
        XCTAssertEqual(BottomTabBarProjector.activeIndex(pathname: "/charging", tabs: tabs), 2)
        XCTAssertEqual(BottomTabBarProjector.activeIndex(pathname: "/battery", tabs: tabs), 3)
        XCTAssertEqual(BottomTabBarProjector.activeIndex(pathname: "/live", tabs: tabs), 4)
    }

    func testDeepRouteResolvesToOwningTab() {
        XCTAssertEqual(BottomTabBarProjector.activeIndex(pathname: "/charging/session/9", tabs: tabs), 2)
    }

    func testNoMatchReturnsNil() {
        XCTAssertNil(BottomTabBarProjector.activeIndex(pathname: "/settings", tabs: tabs))
        XCTAssertNil(BottomTabBarProjector.activeIndex(pathname: "/", tabs: []))
    }
}

// MARK: - Projection (label resolution + active flags + nav label)

final class BottomTabBarProjectionTests: XCTestCase {
    /// An identity localizer that returns each key's fallback — keeps the projection deterministic.
    private let identity: BottomTabBarLocalize = { _, fallback in fallback }

    func testResolveFlagsExactlyTheActiveTab() {
        let projection = BottomTabBarProjector.resolve(
            pathname: "/charging",
            tabs: BottomTabBarCatalog.tabs,
            localize: identity
        )
        XCTAssertEqual(projection.activeIndex, 2)
        XCTAssertEqual(projection.tabs.filter(\.isActive).map(\.path), ["/charging"])
        XCTAssertFalse(projection.isEmpty)
    }

    func testResolveLocalizesEveryLabelAndTheNavLabel() {
        let projection = BottomTabBarProjector.resolve(input: BottomTabBarInput(pathname: "/"), localize: identity)
        XCTAssertEqual(projection.tabs.map(\.label), ["Home", "Drives", "Charging", "Battery", "Map"])
        XCTAssertEqual(projection.navigationLabel, "Quick navigation")
    }

    func testResolveUsesTheInjectedLocalizer() {
        let shouting: BottomTabBarLocalize = { key, _ in key.uppercased() }
        let projection = BottomTabBarProjector.resolve(input: BottomTabBarInput(pathname: "/"), localize: shouting)
        XCTAssertEqual(projection.tabs.first?.label, "NAV.DASHBOARD")
        XCTAssertEqual(projection.navigationLabel, "NAV.QUICKNAV")
    }

    func testNoActiveRouteLeavesEveryTabInactive() {
        let projection = BottomTabBarProjector.resolve(
            pathname: "/settings",
            tabs: BottomTabBarCatalog.tabs,
            localize: identity
        )
        XCTAssertNil(projection.activeIndex)
        XCTAssertTrue(projection.tabs.allSatisfy { !$0.isActive })
    }

    func testEmptyCatalogProjectsEmpty() {
        let projection = BottomTabBarProjector.resolve(
            pathname: "/",
            tabs: [],
            localize: identity
        )
        XCTAssertTrue(projection.isEmpty)
        XCTAssertNil(projection.activeIndex)
        XCTAssertEqual(projection.navigationLabel, "Quick navigation")
    }
}

// MARK: - Value-type equality

final class BottomTabBarValueTypeTests: XCTestCase {
    private let identity: BottomTabBarLocalize = { _, fallback in fallback }

    func testInputEqualityTracksPathnameAndTabs() {
        XCTAssertEqual(BottomTabBarInput(pathname: "/"), BottomTabBarInput(pathname: "/"))
        XCTAssertNotEqual(BottomTabBarInput(pathname: "/"), BottomTabBarInput(pathname: "/drives"))
        XCTAssertNotEqual(BottomTabBarInput(pathname: "/"), BottomTabBarInput(pathname: "/", tabs: []))
    }

    func testProjectionEqualityTracksTheActiveRoute() {
        let atRoot = BottomTabBarProjector.resolve(input: BottomTabBarInput(pathname: "/"), localize: identity)
        let atRootAgain = BottomTabBarProjector.resolve(input: BottomTabBarInput(pathname: "/"), localize: identity)
        let atDrives = BottomTabBarProjector.resolve(input: BottomTabBarInput(pathname: "/drives"), localize: identity)
        XCTAssertEqual(atRoot, atRootAgain)
        XCTAssertNotEqual(atRoot, atDrives)
    }
}
