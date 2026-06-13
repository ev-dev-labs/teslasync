//
//  NotionSidebar.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0175 · NotionSidebar (Apple)
//
//  Pure-core coverage for the sidebar (the model + view-composition half lives in NotionSidebar.Tests.swift;
//  the projection half in NotionSidebar.ProjectionTests.swift; split to keep each file within the SwiftLint
//  file-length budget). This is the "adapter (cached → projection)" unit test the acceptance calls for: it
//  drives the value-type peers, the active-path port, the filter port, the badge rule, and the input
//  derivations, asserting the verbatim port of the web component's per-render decisions:
//    • interpolation — {{page}} / {{count}} substitution.
//    • active path   — root, exact, descendant, sibling-prefix non-match (web isActiveNotionPath).
//    • filter        — tokenize (trim/lowercase/split), AND-match, case-insensitivity, empty matches all.
//    • badges        — negative clamp, 99+ cap, the per-path trailing rule + interpolated chip labels.
//    • input         — pinnedPaths, the derived active-section id.
//    • slug          — the diagnostics surface slug.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network, no model instance and no
//  SwiftUI, so each assertion reads the pure logic directly.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity + interpolation

final class NotionSidebarSurfaceTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(NotionSidebarSurface.slug, "NotionSidebar")
    }

    func testInterpolationSubstitutesSlots() {
        XCTAssertEqual(
            NotionSidebarInterpolation.format("Pin {{page}}", ["page": "Vehicles"]),
            "Pin Vehicles"
        )
        XCTAssertEqual(
            NotionSidebarInterpolation.format("{{count}} vehicles", ["count": "5"]),
            "5 vehicles"
        )
    }

    func testInterpolationLeavesUnreferencedSlots() {
        XCTAssertEqual(NotionSidebarInterpolation.format("{{a}} {{b}}", ["a": "x"]), "x {{b}}")
    }
}

// MARK: - Value types (item / badges)

final class NotionSidebarValueTypeTests: XCTestCase {
    private let fallbackOnly: NotionSidebarLocalize = { _, fallback in fallback }

    func testItemResolvesLabelThroughLocalizer() {
        let item = NotionSidebarItem(
            path: "/vehicles",
            titleKey: "k",
            titleFallback: "Vehicles",
            systemImage: "car"
        )
        XCTAssertEqual(item.title(localize: fallbackOnly), "Vehicles")
        XCTAssertEqual(item.id, "/vehicles")
    }

    func testItemUsesLocalizedValueWhenPresent() {
        let item = NotionSidebarItem(path: "/x", titleKey: "k", titleFallback: "X", systemImage: "s")
        let localize: NotionSidebarLocalize = { key, _ in key == "k" ? "Localized" : "?" }
        XCTAssertEqual(item.title(localize: localize), "Localized")
    }

    func testBadgesClampNegativeToZero() {
        let badges = NotionSidebarBadges(alertCount: -3, vehicleCount: -1, staleCount: -9)
        XCTAssertEqual(badges.alertCount, 0)
        XCTAssertEqual(badges.vehicleCount, 0)
        XCTAssertEqual(badges.staleCount, 0)
    }

    func testBadgesChipTextCapsAt99Plus() {
        XCTAssertEqual(NotionSidebarBadges.chipText(5), "5")
        XCTAssertEqual(NotionSidebarBadges.chipText(99), "99")
        XCTAssertEqual(NotionSidebarBadges.chipText(100), "99+")
        XCTAssertEqual(NotionSidebarBadges.chipText(9999), "99+")
    }
}

// MARK: - NotionSidebarActivePath (web isActiveNotionPath)

final class NotionSidebarActivePathTests: XCTestCase {
    func testRootMatchesOnlyItself() {
        XCTAssertTrue(NotionSidebarActivePath.isActive(pathname: "/", path: "/"))
        XCTAssertFalse(NotionSidebarActivePath.isActive(pathname: "/vehicles", path: "/"))
    }

    func testExactMatch() {
        XCTAssertTrue(NotionSidebarActivePath.isActive(pathname: "/vehicles", path: "/vehicles"))
    }

    func testDescendantMatches() {
        XCTAssertTrue(NotionSidebarActivePath.isActive(pathname: "/vehicles/42", path: "/vehicles"))
        XCTAssertTrue(NotionSidebarActivePath.isActive(pathname: "/vehicles/42/state", path: "/vehicles"))
    }

    func testSiblingPrefixIsNotActive() {
        // `/vehicles-archive` must NOT match `/vehicles` (web guards with the trailing slash).
        XCTAssertFalse(NotionSidebarActivePath.isActive(pathname: "/vehicles-archive", path: "/vehicles"))
    }

    func testUnrelatedPathIsNotActive() {
        XCTAssertFalse(NotionSidebarActivePath.isActive(pathname: "/charging", path: "/vehicles"))
    }
}

// MARK: - NotionSidebarFilter (web matchesFilter)

final class NotionSidebarFilterTests: XCTestCase {
    func testEmptyFilterMatchesEverything() {
        XCTAssertEqual(NotionSidebarFilter.tokens("   "), [])
        XCTAssertTrue(NotionSidebarFilter.matches("Anything", tokens: []))
    }

    func testTokenizeTrimsLowercasesAndSplits() {
        XCTAssertEqual(NotionSidebarFilter.tokens("  Charge   Map "), ["charge", "map"])
    }

    func testSingleTokenIsCaseInsensitiveSubstring() {
        XCTAssertTrue(NotionSidebarFilter.matches("Charging", tokens: ["char"]))
        XCTAssertTrue(NotionSidebarFilter.matches("CHARGING", tokens: ["char"]))
        XCTAssertFalse(NotionSidebarFilter.matches("Vehicles", tokens: ["char"]))
    }

    func testMultipleTokensRequireAll() {
        XCTAssertTrue(NotionSidebarFilter.matches("Charging Map", tokens: ["char", "map"]))
        XCTAssertFalse(NotionSidebarFilter.matches("Charging", tokens: ["char", "map"]))
    }
}

// MARK: - NotionSidebarInput (pinnedPaths / activeSection / trailing)

final class NotionSidebarInputTests: XCTestCase {
    private let fallbackOnly: NotionSidebarLocalize = { _, fallback in fallback }

    private func sampleSections() -> [NotionSidebarSection] {
        [
            NotionSidebarSection(
                id: "vehicle",
                titleKey: "g.vehicle",
                titleFallback: "Vehicle",
                items: [
                    NotionSidebarItem(
                        path: "/vehicles",
                        titleKey: "i.v",
                        titleFallback: "Vehicles",
                        systemImage: "car"
                    ),
                    NotionSidebarItem(
                        path: "/charging",
                        titleKey: "i.c",
                        titleFallback: "Charging",
                        systemImage: "bolt"
                    )
                ]
            )
        ]
    }

    func testPinnedPaths() {
        let input = NotionSidebarInput(
            sections: [],
            pinnedItems: [
                NotionSidebarItem(path: "/a", titleKey: "a", titleFallback: "A", systemImage: "s"),
                NotionSidebarItem(path: "/b", titleKey: "b", titleFallback: "B", systemImage: "s")
            ],
            activePath: "/a"
        )
        XCTAssertEqual(input.pinnedPaths, ["/a", "/b"])
    }

    func testActiveSectionIDDerivedFromActivePath() {
        let input = NotionSidebarInput(sections: sampleSections(), activePath: "/charging")
        XCTAssertEqual(input.activeSectionID, "vehicle")
    }

    func testActiveSectionIDNilWhenNoMatch() {
        let input = NotionSidebarInput(sections: sampleSections(), activePath: "/settings")
        XCTAssertNil(input.activeSectionID)
    }

    func testTrailingNotificationDotForAlerts() {
        let input = NotionSidebarInput(
            sections: [],
            badges: NotionSidebarBadges(alertCount: 2),
            activePath: "/"
        )
        XCTAssertEqual(
            input.trailing(for: NotionSidebarBadgePath.alerts, localize: fallbackOnly),
            .notificationDot
        )
    }

    func testTrailingNoneWhenCountZero() {
        let input = NotionSidebarInput(sections: [], badges: .none, activePath: "/")
        XCTAssertEqual(input.trailing(for: NotionSidebarBadgePath.alerts, localize: fallbackOnly), .none)
        XCTAssertEqual(input.trailing(for: NotionSidebarBadgePath.vehicles, localize: fallbackOnly), .none)
    }

    func testTrailingVehicleChipInterpolatesLabel() {
        let input = NotionSidebarInput(
            sections: [],
            badges: NotionSidebarBadges(vehicleCount: 5),
            activePath: "/"
        )
        XCTAssertEqual(
            input.trailing(for: NotionSidebarBadgePath.vehicles, localize: fallbackOnly),
            .count(text: "5", accessibilityLabel: "5 vehicles")
        )
    }

    func testTrailingStaleChipCapsAndInterpolates() {
        let input = NotionSidebarInput(
            sections: [],
            badges: NotionSidebarBadges(staleCount: 120),
            activePath: "/"
        )
        XCTAssertEqual(
            input.trailing(for: NotionSidebarBadgePath.dataRepair, localize: fallbackOnly),
            .count(text: "99+", accessibilityLabel: "120 stale rows")
        )
    }
}
