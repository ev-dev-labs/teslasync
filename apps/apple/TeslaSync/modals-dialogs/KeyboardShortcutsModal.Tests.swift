//
//  KeyboardShortcutsModal.Tests.swift
//  TeslaSync — P4 modal/dialog · 0006 · KeyboardShortcutsModal (Apple)
//
//  Adapter + projection + accessibility coverage for the KeyboardShortcutsModal surface:
//    • `KBShortcutsProjection.groupRank` — the web `GROUP_PRIORITY` + first-token rule.
//    • `KBShortcutsProjection.matchesRoute` — the web `startsWith` (string) / `.test()` (regex) gate.
//    • `KBShortcutsProjection.isVisible` — the web `filteredGroups` scope/route/search predicate.
//    • `KBShortcutsProjection.groups` — grouping, per-entry id sort, rank-desc/title-asc group sort.
//    • `KBShortcutsProjection.resolvePhase` — the loading / empty / error / content envelope rules.
//    • `KBShortcutsProjection.parseFilter` / `encode` — the web sessionStorage round trip + default.
//    • copy (title / filter labels / search prompt / empty line).
//    • `KBShortcutsAccessibility` — the dialog summary, close, filter, and row/keys VoiceOver content.
//
//  Pure, bundle-free: copy resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the real copy without a
/// bundle.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

private func entry(
    id: String,
    keys: [String] = ["?"],
    description: String = "Do thing",
    group: String = "Global",
    scope: KBShortcutScope = .global,
    routeMatch: KBShortcutRouteMatch? = nil
) -> KBShortcutEntry {
    KBShortcutEntry(id: id, keys: keys, description: description, group: group, scope: scope, routeMatch: routeMatch)
}

// MARK: - Group rank

final class KBShortcutGroupRankTests: XCTestCase {
    func testKnownGroupsRankByPriority() {
        XCTAssertEqual(KBShortcutsProjection.groupRank("Navigation"), 100)
        XCTAssertEqual(KBShortcutsProjection.groupRank("Actions"), 90)
        XCTAssertEqual(KBShortcutsProjection.groupRank("Global"), 90)
        XCTAssertEqual(KBShortcutsProjection.groupRank("Commands"), 80)
        XCTAssertEqual(KBShortcutsProjection.groupRank("Table"), 70)
        XCTAssertEqual(KBShortcutsProjection.groupRank("Replay"), 20)
    }

    func testRankIsCaseInsensitive() {
        XCTAssertEqual(KBShortcutsProjection.groupRank("navigation"), 100)
    }

    func testRankUsesFirstWhitespaceOrParenToken() {
        // "table" is the first token before the "(" / space (web `split(/\s|[(]/)[0]`).
        XCTAssertEqual(KBShortcutsProjection.groupRank("Table (bulk)"), 70)
        XCTAssertEqual(KBShortcutsProjection.groupRank("Bulk actions"), 60)
        // "Trip replay" → first token "trip", which is unlisted → 0 (only "replay" alone ranks 20).
        XCTAssertEqual(KBShortcutsProjection.groupRank("Trip replay"), 0)
    }

    func testUnknownGroupRanksZero() {
        XCTAssertEqual(KBShortcutsProjection.groupRank("Whatever"), 0)
    }
}

// MARK: - Route matching

final class KBShortcutRouteMatchTests: XCTestCase {
    func testPrefixMatch() {
        XCTAssertTrue(KBShortcutsProjection.matchesRoute(.prefix("/replay"), pathname: "/replay/42"))
        XCTAssertFalse(KBShortcutsProjection.matchesRoute(.prefix("/replay"), pathname: "/drives"))
    }

    func testRegexMatch() {
        let match = KBShortcutRouteMatch.regex("^/vehicles/[0-9]+$")
        XCTAssertTrue(KBShortcutsProjection.matchesRoute(match, pathname: "/vehicles/42"))
        XCTAssertFalse(KBShortcutsProjection.matchesRoute(match, pathname: "/vehicles/abc"))
    }

    func testInvalidRegexNeverMatches() {
        XCTAssertFalse(KBShortcutsProjection.matchesRoute(.regex("["), pathname: "/anything"))
    }
}

// MARK: - Visibility predicate (web filteredGroups filter)

final class KBShortcutVisibilityTests: XCTestCase {
    private let global = entry(id: "g", description: "Open palette", group: "Global", scope: .global)
    private let route = entry(
        id: "r",
        description: "Play replay",
        group: "Trip replay",
        scope: .route,
        routeMatch: .prefix("/replay")
    )

    func testGlobalModeKeepsOnlyGlobals() {
        XCTAssertTrue(KBShortcutsProjection.isVisible(global, mode: .global, pathname: "/replay/1", needle: ""))
        XCTAssertFalse(KBShortcutsProjection.isVisible(route, mode: .global, pathname: "/replay/1", needle: ""))
    }

    func testPageModeDropsGlobals() {
        XCTAssertFalse(KBShortcutsProjection.isVisible(global, mode: .page, pathname: "/replay/1", needle: ""))
        XCTAssertTrue(KBShortcutsProjection.isVisible(route, mode: .page, pathname: "/replay/1", needle: ""))
    }

    func testNonGlobalRequiresMatchingRoute() {
        // In `all` mode a route-scoped entry only shows when its route matches the current pathname.
        XCTAssertTrue(KBShortcutsProjection.isVisible(route, mode: .all, pathname: "/replay/1", needle: ""))
        XCTAssertFalse(KBShortcutsProjection.isVisible(route, mode: .all, pathname: "/drives", needle: ""))
    }

    func testNonGlobalWithoutRouteMatchIsHidden() {
        let orphan = entry(id: "o", group: "Page", scope: .page, routeMatch: nil)
        XCTAssertFalse(KBShortcutsProjection.isVisible(orphan, mode: .all, pathname: "/x", needle: ""))
    }

    func testSearchNeedleFiltersByDescriptionCaseInsensitively() {
        XCTAssertTrue(KBShortcutsProjection.isVisible(global, mode: .all, pathname: "/x", needle: "palette"))
        XCTAssertTrue(KBShortcutsProjection.isVisible(global, mode: .all, pathname: "/x", needle: "open"))
        XCTAssertFalse(KBShortcutsProjection.isVisible(global, mode: .all, pathname: "/x", needle: "missing"))
    }

    func testNeedleNormalization() {
        XCTAssertEqual(KBShortcutsProjection.needle(from: "  Go TO  "), "go to")
    }
}

// MARK: - Grouping + sorting (web filteredGroups pipeline)

final class KBShortcutGroupingTests: XCTestCase {
    func testGroupsSortByRankThenEntriesById() {
        let entries = [
            entry(id: "b", description: "Go back", group: "Navigation", scope: .global),
            entry(id: "a", description: "Go to dashboard", group: "Navigation", scope: .global),
            entry(id: "x", description: "Open palette", group: "Actions", scope: .global),
            entry(
                id: "z",
                description: "Play",
                group: "Trip replay",
                scope: .route,
                routeMatch: .prefix("/replay")
            )
        ]
        let groups = KBShortcutsProjection.groups(from: entries, mode: .all, pathname: "/replay/1", search: "")
        XCTAssertEqual(groups.map(\.title), ["Navigation", "Actions", "Trip replay"])
        XCTAssertEqual(groups[0].shortcuts.map(\.id), ["a", "b"])
    }

    func testEqualRankGroupsSortByTitleAscending() {
        let entries = [
            entry(id: "1", group: "Zebra", scope: .global),
            entry(id: "2", group: "Alpha", scope: .global)
        ]
        let groups = KBShortcutsProjection.groups(from: entries, mode: .all, pathname: "/x", search: "")
        XCTAssertEqual(groups.map(\.title), ["Alpha", "Zebra"])
    }

    func testRouteScopedGroupsDroppedWhenRouteDoesNotMatch() {
        let entries = [
            entry(id: "g", group: "Global", scope: .global),
            entry(id: "r", group: "Trip replay", scope: .route, routeMatch: .prefix("/replay"))
        ]
        let groups = KBShortcutsProjection.groups(from: entries, mode: .all, pathname: "/drives", search: "")
        XCTAssertEqual(groups.map(\.title), ["Global"])
    }

    func testSearchAcrossGroupsKeepsOnlyMatches() {
        let entries = [
            entry(id: "a", description: "Go to dashboard", group: "Navigation", scope: .global),
            entry(id: "b", description: "Open palette", group: "Actions", scope: .global)
        ]
        let groups = KBShortcutsProjection.groups(from: entries, mode: .all, pathname: "/x", search: "palette")
        XCTAssertEqual(groups.map(\.title), ["Actions"])
        XCTAssertEqual(groups.first?.shortcuts.map(\.id), ["b"])
    }
}

// MARK: - Phase resolution

final class KBShortcutPhaseTests: XCTestCase {
    func testLoadingShowsSkeletonOnlyBeforeFirstEntries() {
        XCTAssertEqual(
            KBShortcutsProjection.resolvePhase(status: .loading, hasEntries: false, hasVisibleGroups: false),
            .loading
        )
        XCTAssertEqual(
            KBShortcutsProjection.resolvePhase(status: .loading, hasEntries: true, hasVisibleGroups: true),
            .content
        )
        XCTAssertEqual(
            KBShortcutsProjection.resolvePhase(status: .loading, hasEntries: true, hasVisibleGroups: false),
            .empty
        )
    }

    func testLoadedResolvesByVisibleGroups() {
        XCTAssertEqual(
            KBShortcutsProjection.resolvePhase(status: .loaded, hasEntries: true, hasVisibleGroups: true),
            .content
        )
        XCTAssertEqual(
            KBShortcutsProjection.resolvePhase(status: .loaded, hasEntries: false, hasVisibleGroups: false),
            .empty
        )
    }

    func testFailedResolvesErrorOrKeepsContent() {
        XCTAssertEqual(
            KBShortcutsProjection.resolvePhase(status: .failed("boom"), hasEntries: false, hasVisibleGroups: false),
            .error("boom")
        )
        XCTAssertEqual(
            KBShortcutsProjection.resolvePhase(status: .failed("boom"), hasEntries: true, hasVisibleGroups: true),
            .content
        )
        XCTAssertEqual(
            KBShortcutsProjection.resolvePhase(status: .failed("boom"), hasEntries: true, hasVisibleGroups: false),
            .empty
        )
    }
}

// MARK: - Filter persistence (web readStoredFilter / writeStoredFilter)

final class KBShortcutFilterPersistenceTests: XCTestCase {
    func testParseDefaultsToAll() {
        XCTAssertEqual(KBShortcutsProjection.parseFilter(nil), .all)
        XCTAssertEqual(KBShortcutsProjection.parseFilter("bogus"), .all)
    }

    func testParseKnownValues() {
        XCTAssertEqual(KBShortcutsProjection.parseFilter("all"), .all)
        XCTAssertEqual(KBShortcutsProjection.parseFilter("global"), .global)
        XCTAssertEqual(KBShortcutsProjection.parseFilter("page"), .page)
    }

    func testEncodeRoundTrips() {
        for mode in KBShortcutsFilter.allCases {
            XCTAssertEqual(KBShortcutsProjection.parseFilter(KBShortcutsProjection.encode(mode)), mode)
        }
    }
}

// MARK: - Copy

final class KBShortcutCopyTests: XCTestCase {
    func testStaticCopy() {
        XCTAssertEqual(KBShortcutsProjection.title(localize: passthroughLocalize), "Keyboard Shortcuts")
        XCTAssertEqual(KBShortcutsProjection.searchPrompt(localize: passthroughLocalize), "Search shortcuts…")
        XCTAssertEqual(
            KBShortcutsProjection.emptyMessage(localize: passthroughLocalize),
            "No shortcuts match your search."
        )
    }

    func testFilterLabels() {
        XCTAssertEqual(KBShortcutsProjection.filterLabel(.all, localize: passthroughLocalize), "All")
        XCTAssertEqual(KBShortcutsProjection.filterLabel(.global, localize: passthroughLocalize), "Global")
        XCTAssertEqual(KBShortcutsProjection.filterLabel(.page, localize: passthroughLocalize), "This page")
    }
}

// MARK: - Accessibility

final class KBShortcutAccessibilityTests: XCTestCase {
    func testSummaryIsTitle() {
        XCTAssertEqual(KBShortcutsAccessibility.summary(localize: passthroughLocalize), "Keyboard Shortcuts")
    }

    func testCloseAndFilterLabels() {
        XCTAssertEqual(KBShortcutsAccessibility.closeLabel(localize: passthroughLocalize), "Close")
        XCTAssertEqual(KBShortcutsAccessibility.filterLabel(localize: passthroughLocalize), "Filter shortcuts")
    }

    func testKeysValueJoinsWithConnector() {
        XCTAssertEqual(KBShortcutsAccessibility.keysValue(["Ctrl", "K"], localize: passthroughLocalize), "Ctrl plus K")
        XCTAssertEqual(KBShortcutsAccessibility.keysValue([], localize: passthroughLocalize), "")
    }

    func testRowLabelCombinesDescriptionAndKeys() {
        XCTAssertEqual(
            KBShortcutsAccessibility.rowLabel(description: "Open", keys: ["Ctrl", "K"], localize: passthroughLocalize),
            "Open, Ctrl plus K"
        )
        XCTAssertEqual(
            KBShortcutsAccessibility.rowLabel(description: "Escape", keys: [], localize: passthroughLocalize),
            "Escape"
        )
    }
}
