//
//  Layout.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0169 · Layout (Apple)
//
//  The pure-core coverage (the Foundation-only adapter + projector + catalog): the surface identity, the web
//  visibility filter (`isVisibleNavItem` — minVehicles / requiresAuth), the active-path match
//  (`isActiveNavPath` — `/` exact vs prefix), the lookups, the visible-section derivation (filter + drop
//  empty), the pinned/recent resolution (resolve / filter / exclude-active), the pin/unpin/recordVisit
//  mutators (cap / de-dup / skip), the section-toggle rule (active never collapses), the badge math (capped
//  alerts/stale, uncapped vehicles, zero → nil), the full projection, the catalog integrity, and value-type
//  equality. Split from Layout.Tests.swift (the SwiftUI / state-holder half) to keep each file within the
//  SwiftLint file-length budget. These run in the TeslaSync(/-macOS) XCTest targets; the derivation is pure.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class LayoutAdapterSurfaceTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(LayoutSurface.slug, "Layout")
    }
}

// MARK: - Visibility (web `isVisibleNavItem`)

final class LayoutVisibilityTests: XCTestCase {
    func testHiddenBelowMinVehicles() {
        let item = LayoutNavItem(to: "/x", label: "X", symbol: "x", minVehicles: 2)
        XCTAssertFalse(LayoutProjector.isVisible(item, vehicleCount: 1, isForwardAuth: true))
        XCTAssertTrue(LayoutProjector.isVisible(item, vehicleCount: 2, isForwardAuth: true))
    }

    func testHiddenWhenRequiresAuthAndOpenMode() {
        let item = LayoutNavItem(to: "/x", label: "X", symbol: "x", requiresAuth: true)
        XCTAssertFalse(LayoutProjector.isVisible(item, vehicleCount: 9, isForwardAuth: false))
        XCTAssertTrue(LayoutProjector.isVisible(item, vehicleCount: 9, isForwardAuth: true))
    }

    func testVisibleByDefault() {
        let item = LayoutNavItem(to: "/x", label: "X", symbol: "x")
        XCTAssertTrue(LayoutProjector.isVisible(item, vehicleCount: 0, isForwardAuth: false))
    }
}

// MARK: - Active path (web `isActiveNavPath`)

final class LayoutActivePathTests: XCTestCase {
    func testRootMatchesOnlyItself() {
        XCTAssertTrue(LayoutProjector.isActivePath("/", "/"))
        XCTAssertFalse(LayoutProjector.isActivePath("/charging", "/"))
    }

    func testExactAndPrefixMatch() {
        XCTAssertTrue(LayoutProjector.isActivePath("/notifications/inbox", "/notifications/inbox"))
        XCTAssertTrue(LayoutProjector.isActivePath("/charging/123", "/charging"))
        XCTAssertFalse(LayoutProjector.isActivePath("/charging-curve", "/charging"))
    }
}

// MARK: - Lookups + visible sections

final class LayoutLookupTests: XCTestCase {
    private let sections = [
        LayoutNavSection(title: "A", items: [
            LayoutNavItem(to: "/a", label: "A1", symbol: "a"),
            LayoutNavItem(to: "/a2", label: "A2", symbol: "a", minVehicles: 2)
        ]),
        LayoutNavSection(title: "B", items: [
            LayoutNavItem(to: "/b", label: "B1", symbol: "b", requiresAuth: true)
        ])
    ]

    func testFindByPathPrefersActiveMatch() {
        let entry = LayoutProjector.findByPath("/a/77", in: sections)
        XCTAssertEqual(entry?.item.to, "/a")
        XCTAssertEqual(entry?.sectionTitle, "A")
    }

    func testFindByExactPath() {
        XCTAssertEqual(LayoutProjector.findByExactPath("/b", in: sections)?.item.label, "B1")
        XCTAssertNil(LayoutProjector.findByExactPath("/missing", in: sections))
    }

    func testVisibleSectionsFilterAndDropEmpty() {
        // Open mode + no fleet: /a2 (minVehicles 2) and /b (requiresAuth) drop; B becomes empty and vanishes.
        let visible = LayoutProjector.visibleSections(sections, vehicleCount: 0, isForwardAuth: false)
        XCTAssertEqual(visible.map(\.title), ["A"])
        XCTAssertEqual(visible.first?.items.map(\.to), ["/a"])
    }

    func testVisibleSectionsKeepAllWhenAuthedWithFleet() {
        let visible = LayoutProjector.visibleSections(sections, vehicleCount: 5, isForwardAuth: true)
        XCTAssertEqual(visible.map(\.title), ["A", "B"])
        XCTAssertEqual(visible.first?.items.count, 2)
    }
}

// MARK: - Pinned / recent

final class LayoutPinnedRecentTests: XCTestCase {
    private let sections = LayoutNavCatalog.sections

    func testPinnedItemsResolveInOrderAndFilter() {
        let items = LayoutProjector.pinnedItems(
            paths: ["/charging", "/vehicle-comparison", "/"],
            sections: sections,
            vehicleCount: 1,
            isForwardAuth: false
        )
        // /vehicle-comparison needs 2 vehicles → filtered out; order otherwise preserved.
        XCTAssertEqual(items.map(\.to), ["/charging", "/"])
    }

    func testRecentItemsExcludeActivePage() {
        let items = LayoutProjector.recentItems(
            paths: ["/drives", "/battery"],
            sections: sections,
            vehicleCount: 3,
            isForwardAuth: true,
            activePathname: "/drives"
        )
        XCTAssertEqual(items.map(\.to), ["/battery"])
    }
}

// MARK: - Pin mutators

final class LayoutPinMutatorTests: XCTestCase {
    func testPinPrependsAndCaps() {
        XCTAssertEqual(LayoutProjector.pin(["/b"], "/a"), ["/a", "/b"])
        XCTAssertEqual(LayoutProjector.pin(["/a"], "/a"), ["/a"], "already pinned is a no-op")
        let capped = LayoutProjector.pin(["1", "2", "3", "4", "5", "6", "7", "8"], "/new")
        XCTAssertEqual(capped.count, LayoutNavLimits.maxPinned)
        XCTAssertEqual(capped.first, "/new")
    }

    func testUnpinRemoves() {
        XCTAssertEqual(LayoutProjector.unpin(["/a", "/b"], "/a"), ["/b"])
    }

    func testRecordVisitSkipsRootPinnedAndDedups() {
        XCTAssertEqual(LayoutProjector.recordVisit([], visiting: "/", pinned: []), [])
        XCTAssertEqual(LayoutProjector.recordVisit([], visiting: "/x", pinned: ["/x"]), [])
        XCTAssertEqual(LayoutProjector.recordVisit(["/y"], visiting: "/x", pinned: []), ["/x", "/y"])
        XCTAssertEqual(
            LayoutProjector.recordVisit(["/x", "/y"], visiting: "/x", pinned: []),
            ["/x", "/y"],
            "re-visiting moves to front without duplicating"
        )
    }

    func testRecordVisitCapsAtMaxRecent() {
        let result = LayoutProjector.recordVisit(["/a", "/b", "/c"], visiting: "/d", pinned: [])
        XCTAssertEqual(result, ["/d", "/a", "/b"])
        XCTAssertEqual(result.count, LayoutNavLimits.maxRecent)
    }
}

// MARK: - Section expansion

final class LayoutExpansionTests: XCTestCase {
    func testToggleAddsAndRemoves() {
        XCTAssertTrue(LayoutProjector.toggledExpansion([], "Home", activeTitle: nil).contains("Home"))
        XCTAssertFalse(LayoutProjector.toggledExpansion(["Home"], "Home", activeTitle: nil).contains("Home"))
    }

    func testActiveSectionNeverCollapses() {
        let next = LayoutProjector.toggledExpansion(["Charging"], "Charging", activeTitle: "Charging")
        XCTAssertTrue(next.contains("Charging"), "the active section cannot be collapsed (web rule)")
    }

    func testExpandedSectionCount() {
        let sections = [
            LayoutNavSection(title: "A", items: [LayoutNavItem(to: "/a", label: "A", symbol: "a")]),
            LayoutNavSection(title: "B", items: [LayoutNavItem(to: "/b", label: "B", symbol: "b")])
        ]
        XCTAssertEqual(LayoutProjector.expandedSectionCount(sections, expanded: ["A"]), 1)
        XCTAssertEqual(LayoutProjector.expandedSectionCount(sections, expanded: ["A", "B"]), 2)
    }
}

// MARK: - Badge (web per-item count chips)

final class LayoutBadgeTests: XCTestCase {
    func testAlertsBadgeCappedAndDanger() {
        let badge = LayoutProjector.badge(
            for: "/notifications/alerts",
            unreadAlerts: 12,
            vehicleCount: 0,
            staleCount: 0
        )
        XCTAssertEqual(badge?.text, "9+")
        XCTAssertEqual(badge?.tone, .danger)
    }

    func testVehiclesBadgeUncappedAndInfo() {
        let badge = LayoutProjector.badge(for: "/vehicles", unreadAlerts: 0, vehicleCount: 23, staleCount: 0)
        XCTAssertEqual(badge?.text, "23", "the fleet badge is not capped (web `vehicles.length`)")
        XCTAssertEqual(badge?.tone, .info)
    }

    func testStaleBadgeCappedAndWarning() {
        let badge = LayoutProjector.badge(for: "/data-repair", unreadAlerts: 0, vehicleCount: 0, staleCount: 4)
        XCTAssertEqual(badge?.text, "4")
        XCTAssertEqual(badge?.tone, .warning)
    }

    func testZeroCountsAndOtherRoutesHaveNoBadge() {
        XCTAssertNil(LayoutProjector.badge(
            for: "/notifications/alerts",
            unreadAlerts: 0,
            vehicleCount: 0,
            staleCount: 0
        ))
        XCTAssertNil(LayoutProjector.badge(for: "/vehicles", unreadAlerts: 0, vehicleCount: 0, staleCount: 0))
        XCTAssertNil(LayoutProjector.badge(for: "/charging", unreadAlerts: 9, vehicleCount: 9, staleCount: 9))
    }
}

// MARK: - Projection

final class LayoutProjectionTests: XCTestCase {
    func testProjectionBuildsFromCatalog() {
        let projection = LayoutProjector.projection(
            catalog: LayoutNavCatalog.sections,
            state: LayoutNavState(
                pathname: "/charging",
                vehicleCount: 3,
                isForwardAuth: true,
                pinnedPaths: ["/charging"],
                recentPaths: [],
                expanded: ["Charging"]
            )
        )
        XCTAssertFalse(projection.isEmpty)
        XCTAssertEqual(projection.activeEntry?.item.to, "/charging")
        XCTAssertEqual(projection.activeEntry?.sectionTitle, "Charging")
        XCTAssertTrue(projection.activeIsPinned)
        XCTAssertEqual(projection.expandedSectionCount, 1)
    }

    func testProjectionIsEmptyForEmptyCatalog() {
        let projection = LayoutProjector.projection(
            catalog: [],
            state: LayoutNavState(
                pathname: "/",
                vehicleCount: 0,
                isForwardAuth: false,
                pinnedPaths: [],
                recentPaths: [],
                expanded: []
            )
        )
        XCTAssertTrue(projection.isEmpty)
        XCTAssertNil(projection.activeEntry)
        XCTAssertFalse(projection.activeIsPinned)
    }
}

// MARK: - Catalog integrity

final class LayoutCatalogTests: XCTestCase {
    func testCatalogHasEverySectionFromTheWebSource() {
        let titles = LayoutNavCatalog.sections.map(\.title)
        XCTAssertEqual(titles, [
            "Home", "Vehicles", "Driving", "Charging", "Battery", "Energy", "Service", "Cabin", "Reports",
            "Commands", "Automation", "Notifications", "Security", "Account", "Settings", "Integrations",
            "Data", "Diagnostics", "About"
        ])
    }

    func testEverySectionHasItemsAndRoutesAreUnique() {
        var seen = Set<String>()
        for section in LayoutNavCatalog.sections {
            XCTAssertFalse(section.items.isEmpty, "section \(section.title) must have items")
            for item in section.items {
                XCTAssertTrue(seen.insert(item.to).inserted, "duplicate route \(item.to)")
                XCTAssertFalse(item.label.isEmpty)
                XCTAssertFalse(item.symbol.isEmpty)
            }
        }
    }

    func testVisibilityFlagsMatchWebSource() {
        let compare = LayoutProjector.findByExactPath("/vehicle-comparison", in: LayoutNavCatalog.sections)?.item
        XCTAssertEqual(compare?.minVehicles, 2)
        let twoFactor = LayoutProjector.findByExactPath("/account/2fa", in: LayoutNavCatalog.sections)?.item
        XCTAssertEqual(twoFactor?.requiresAuth, true)
        let dashboard = LayoutProjector.findByExactPath("/", in: LayoutNavCatalog.sections)?.item
        XCTAssertEqual(dashboard?.label, "Dashboard")
    }
}

// MARK: - Value-type equality

final class LayoutValueTypeTests: XCTestCase {
    func testNavItemEquality() {
        let lhs = LayoutNavItem(to: "/a", label: "A", symbol: "a")
        XCTAssertEqual(lhs, LayoutNavItem(to: "/a", label: "A", symbol: "a"))
        XCTAssertNotEqual(lhs, LayoutNavItem(to: "/a", label: "B", symbol: "a"))
    }

    func testAxesCases() {
        XCTAssertEqual(LayoutConnection.allCases, [.live, .stale, .offline])
        XCTAssertEqual(LayoutSidebarStyle.allCases, [.linear, .notion, .legacy])
    }

    func testLimitsMatchWebSource() {
        XCTAssertEqual(LayoutNavLimits.maxPinned, 8)
        XCTAssertEqual(LayoutNavLimits.maxRecent, 3)
        XCTAssertFalse(LayoutNavLimits.showRecentlyUsed)
        XCTAssertEqual(LayoutNavLimits.defaultPinnedPaths, ["/", "/digital-twin", "/vehicles", "/charging", "/live"])
    }
}
