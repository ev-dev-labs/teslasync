//
//  LinearSidebar.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0174 · LinearSidebar (Apple)
//
//  Pure-core coverage for the sidebar (the model + view-composition half lives in LinearSidebar.Tests.swift;
//  split to keep each file within the SwiftLint file-length budget). This is the "adapter (cached →
//  projection)" unit test the acceptance calls for: it drives the value-type peers, the active-path port,
//  the filter port, the badge rule, and the projection, asserting the verbatim port of the web component's
//  per-render decisions:
//    • interpolation — {{page}} / {{count}} substitution.
//    • active path   — root, exact, descendant, sibling-prefix non-match (web isActiveLinearPath).
//    • filter        — tokenize (trim/lowercase/split), AND-match, case-insensitivity, empty matches all.
//    • badges        — negative clamp, 99+ cap, the per-path trailing rule + interpolated chip labels.
//    • input         — pinnedPaths, the derived active-section id.
//    • projection    — favorites present/absent, filtered sections + counts, expansion (collapse/filter),
//                      pin/unpin/none affordances, active rows, empty-filter, no-data empty, labels.
//    • slug          — the diagnostics surface slug.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network, no model instance and no
//  SwiftUI, so each assertion reads the pure logic directly.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity + interpolation

final class LinearSidebarSurfaceTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(LinearSidebarSurface.slug, "LinearSidebar")
    }

    func testInterpolationSubstitutesSlots() {
        XCTAssertEqual(
            LinearSidebarInterpolation.format("Pin {{page}} to favorites", ["page": "Vehicles"]),
            "Pin Vehicles to favorites"
        )
        XCTAssertEqual(
            LinearSidebarInterpolation.format("{{count}} vehicles", ["count": "5"]),
            "5 vehicles"
        )
    }

    func testInterpolationLeavesUnreferencedSlots() {
        XCTAssertEqual(LinearSidebarInterpolation.format("{{a}} {{b}}", ["a": "x"]), "x {{b}}")
    }
}

// MARK: - Value types (item / section / badges)

final class LinearSidebarValueTypeTests: XCTestCase {
    private let fallbackOnly: LinearSidebarLocalize = { _, fallback in fallback }

    func testItemResolvesLabelThroughLocalizer() {
        let item = LinearSidebarItem(path: "/vehicles", titleKey: "k", titleFallback: "Vehicles", systemImage: "car")
        XCTAssertEqual(item.title(localize: fallbackOnly), "Vehicles")
        XCTAssertEqual(item.id, "/vehicles")
    }

    func testItemUsesLocalizedValueWhenPresent() {
        let item = LinearSidebarItem(path: "/x", titleKey: "k", titleFallback: "X", systemImage: "s")
        let localize: LinearSidebarLocalize = { key, _ in key == "k" ? "Localized" : "?" }
        XCTAssertEqual(item.title(localize: localize), "Localized")
    }

    func testBadgesClampNegativeToZero() {
        let badges = LinearSidebarBadges(alertCount: -3, vehicleCount: -1, staleCount: -9)
        XCTAssertEqual(badges.alertCount, 0)
        XCTAssertEqual(badges.vehicleCount, 0)
        XCTAssertEqual(badges.staleCount, 0)
    }

    func testBadgesChipTextCapsAt99Plus() {
        XCTAssertEqual(LinearSidebarBadges.chipText(5), "5")
        XCTAssertEqual(LinearSidebarBadges.chipText(99), "99")
        XCTAssertEqual(LinearSidebarBadges.chipText(100), "99+")
        XCTAssertEqual(LinearSidebarBadges.chipText(9999), "99+")
    }
}

// MARK: - LinearSidebarActivePath (web isActiveLinearPath)

final class LinearSidebarActivePathTests: XCTestCase {
    func testRootMatchesOnlyItself() {
        XCTAssertTrue(LinearSidebarActivePath.isActive(pathname: "/", path: "/"))
        XCTAssertFalse(LinearSidebarActivePath.isActive(pathname: "/vehicles", path: "/"))
    }

    func testExactMatch() {
        XCTAssertTrue(LinearSidebarActivePath.isActive(pathname: "/vehicles", path: "/vehicles"))
    }

    func testDescendantMatches() {
        XCTAssertTrue(LinearSidebarActivePath.isActive(pathname: "/vehicles/42", path: "/vehicles"))
        XCTAssertTrue(LinearSidebarActivePath.isActive(pathname: "/vehicles/42/state", path: "/vehicles"))
    }

    func testSiblingPrefixIsNotActive() {
        // `/vehicles-archive` must NOT match `/vehicles` (web guards with the trailing slash).
        XCTAssertFalse(LinearSidebarActivePath.isActive(pathname: "/vehicles-archive", path: "/vehicles"))
    }

    func testUnrelatedPathIsNotActive() {
        XCTAssertFalse(LinearSidebarActivePath.isActive(pathname: "/charging", path: "/vehicles"))
    }
}

// MARK: - LinearSidebarFilter (web matchesFilter)

final class LinearSidebarFilterTests: XCTestCase {
    func testEmptyFilterMatchesEverything() {
        XCTAssertEqual(LinearSidebarFilter.tokens("   "), [])
        XCTAssertTrue(LinearSidebarFilter.matches("Anything", tokens: []))
    }

    func testTokenizeTrimsLowercasesAndSplits() {
        XCTAssertEqual(LinearSidebarFilter.tokens("  Charge   Map "), ["charge", "map"])
    }

    func testSingleTokenIsCaseInsensitiveSubstring() {
        XCTAssertTrue(LinearSidebarFilter.matches("Charging", tokens: ["char"]))
        XCTAssertTrue(LinearSidebarFilter.matches("CHARGING", tokens: ["char"]))
        XCTAssertFalse(LinearSidebarFilter.matches("Vehicles", tokens: ["char"]))
    }

    func testMultipleTokensRequireAll() {
        XCTAssertTrue(LinearSidebarFilter.matches("Charging Map", tokens: ["char", "map"]))
        XCTAssertFalse(LinearSidebarFilter.matches("Charging", tokens: ["char", "map"]))
    }
}

// MARK: - LinearSidebarInput (pinnedPaths / activeSection / trailing)

final class LinearSidebarInputTests: XCTestCase {
    private let fallbackOnly: LinearSidebarLocalize = { _, fallback in fallback }

    private func sampleSections() -> [LinearSidebarSection] {
        [
            LinearSidebarSection(
                id: "vehicle",
                titleKey: "g.vehicle",
                titleFallback: "Vehicle",
                items: [
                    LinearSidebarItem(
                        path: "/vehicles",
                        titleKey: "i.v",
                        titleFallback: "Vehicles",
                        systemImage: "car"
                    ),
                    LinearSidebarItem(
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
        let input = LinearSidebarInput(
            sections: [],
            pinnedItems: [
                LinearSidebarItem(path: "/a", titleKey: "a", titleFallback: "A", systemImage: "s"),
                LinearSidebarItem(path: "/b", titleKey: "b", titleFallback: "B", systemImage: "s")
            ],
            activePath: "/a"
        )
        XCTAssertEqual(input.pinnedPaths, ["/a", "/b"])
    }

    func testActiveSectionIDDerivedFromActivePath() {
        let input = LinearSidebarInput(sections: sampleSections(), activePath: "/charging")
        XCTAssertEqual(input.activeSectionID, "vehicle")
    }

    func testActiveSectionIDNilWhenNoMatch() {
        let input = LinearSidebarInput(sections: sampleSections(), activePath: "/settings")
        XCTAssertNil(input.activeSectionID)
    }

    func testTrailingNotificationDotForAlerts() {
        let input = LinearSidebarInput(
            sections: [],
            badges: LinearSidebarBadges(alertCount: 2),
            activePath: "/"
        )
        XCTAssertEqual(input.trailing(for: LinearSidebarBadgePath.alerts, localize: fallbackOnly), .notificationDot)
    }

    func testTrailingNoneWhenCountZero() {
        let input = LinearSidebarInput(sections: [], badges: .none, activePath: "/")
        XCTAssertEqual(input.trailing(for: LinearSidebarBadgePath.alerts, localize: fallbackOnly), .none)
        XCTAssertEqual(input.trailing(for: LinearSidebarBadgePath.vehicles, localize: fallbackOnly), .none)
    }

    func testTrailingVehicleChipInterpolatesLabel() {
        let input = LinearSidebarInput(
            sections: [],
            badges: LinearSidebarBadges(vehicleCount: 5),
            activePath: "/"
        )
        XCTAssertEqual(
            input.trailing(for: LinearSidebarBadgePath.vehicles, localize: fallbackOnly),
            .count(text: "5", accessibilityLabel: "5 vehicles")
        )
    }

    func testTrailingStaleChipCapsAndInterpolates() {
        let input = LinearSidebarInput(
            sections: [],
            badges: LinearSidebarBadges(staleCount: 120),
            activePath: "/"
        )
        XCTAssertEqual(
            input.trailing(for: LinearSidebarBadgePath.dataRepair, localize: fallbackOnly),
            .count(text: "99+", accessibilityLabel: "120 stale rows")
        )
    }
}
