//
//  NotionSidebar.ProjectionTests.swift
//  TeslaSync — P4 shared surface · 0175 · NotionSidebar (Apple)
//
//  Pure-projection coverage (split from NotionSidebar.AdapterTests.swift for the SwiftLint file-length
//  budget). Drives ``NotionSidebarProjection/resolve(input:tree:localize:)`` across every branch the web
//  component renders: the Favorites group present/absent + filtered, the permanent "Pages" label, the
//  rendered sections + their filtered counts + their glyph, the expansion rule (collapse set vs. filter
//  force-expand), the active-row flag, the pin/unpin affordances (Notion shows one on EVERY row — an
//  already-pinned section row resolves to UNPIN, not "none"), the empty-filter branch, the no-data empty
//  branch, and the resolved labels.
//

import XCTest
@testable import TeslaSync

final class NotionSidebarProjectionTests: XCTestCase {
    private let fallbackOnly: NotionSidebarLocalize = { _, fallback in fallback }

    // MARK: Fixtures

    private func sections() -> [NotionSidebarSection] {
        [
            NotionSidebarSection(
                id: "overview",
                titleKey: "g.o",
                titleFallback: "Overview",
                items: [item("/dashboard", "Dashboard", "square.grid.2x2"), item("/explore", "Explore", "safari")]
            ),
            NotionSidebarSection(
                id: "vehicle",
                titleKey: "g.v",
                titleFallback: "Vehicle",
                items: [item("/vehicles", "Vehicles", "car.2"), item("/charging", "Charging", "bolt")]
            )
        ]
    }

    private func item(_ path: String, _ label: String, _ symbol: String = "circle") -> NotionSidebarItem {
        NotionSidebarItem(path: path, titleKey: path, titleFallback: label, systemImage: symbol)
    }

    private func input(
        pinned: [NotionSidebarItem] = [],
        badges: NotionSidebarBadges = .none,
        activePath: String = "/vehicles"
    ) -> NotionSidebarInput {
        NotionSidebarInput(sections: sections(), pinnedItems: pinned, badges: badges, activePath: activePath)
    }

    private func resolve(
        _ input: NotionSidebarInput,
        collapsed: Set<String> = [],
        filter: String = ""
    ) -> NotionSidebarPresentation {
        NotionSidebarProjection.resolve(
            input: input,
            tree: NotionSidebarTreeState(collapsedSectionIDs: collapsed, filterText: filter),
            localize: fallbackOnly
        )
    }

    // MARK: Favorites

    func testFavoritesAbsentWhenNothingPinned() {
        XCTAssertNil(resolve(input()).favorites)
    }

    func testFavoritesPresentWithUnpinAffordance() {
        let pinned = [item("/dashboard", "Dashboard")]
        let favorites = resolve(input(pinned: pinned)).favorites
        XCTAssertEqual(favorites?.label, "Favorites")
        XCTAssertEqual(favorites?.rows.count, 1)
        XCTAssertEqual(favorites?.rows.first?.id, "fav-/dashboard")
        if case .unpin = favorites?.rows.first?.pinAffordance {} else {
            XCTFail("favorites rows carry an unpin affordance")
        }
    }

    func testFavoritesRowsFilteredButHeaderStays() {
        let pinned = [item("/dashboard", "Dashboard"), item("/charging", "Charging")]
        let favorites = resolve(input(pinned: pinned), filter: "charg").favorites
        XCTAssertNotNil(favorites, "the group header stays even when the filter hides rows")
        XCTAssertEqual(favorites?.rows.map(\.path), ["/charging"])
    }

    // MARK: Pages label (always present)

    func testPagesLabelAlwaysResolves() {
        XCTAssertEqual(resolve(input()).pagesLabel, "Pages")
        let empty = NotionSidebarInput(sections: [], pinnedItems: [], activePath: "/")
        XCTAssertEqual(resolve(empty).pagesLabel, "Pages", "Pages label shows even with no sections")
    }

    // MARK: Sections + expansion + glyph

    func testAllSectionsRenderedWithFilteredCounts() {
        let presentation = resolve(input())
        XCTAssertEqual(presentation.sections.map(\.id), ["overview", "vehicle"])
        XCTAssertEqual(presentation.sections.map(\.count), [2, 2])
    }

    func testSectionGlyphIsFirstFilteredRowIcon() {
        // Unfiltered: the Vehicle section's glyph is its first item's icon (car.2).
        let vehicle = resolve(input()).sections.first { $0.id == "vehicle" }
        XCTAssertEqual(vehicle?.glyphSystemImage, "car.2")
        // Filtered to "charg": the only surviving row is Charging, so the glyph becomes bolt.
        let filtered = resolve(input(), filter: "charg").sections.first { $0.id == "vehicle" }
        XCTAssertEqual(filtered?.glyphSystemImage, "bolt")
    }

    func testCollapsedSectionReportsNotExpanded() {
        let presentation = resolve(input(), collapsed: ["overview"])
        XCTAssertEqual(presentation.sections.first { $0.id == "overview" }?.isExpanded, false)
        XCTAssertEqual(presentation.sections.first { $0.id == "vehicle" }?.isExpanded, true)
    }

    func testFilterForceExpandsMatchingSections() {
        // "charg" matches only Charging in the Vehicle section; that section renders + is force-expanded even
        // though it is in the collapsed set.
        let presentation = resolve(input(), collapsed: ["vehicle"], filter: "charg")
        XCTAssertEqual(presentation.sections.map(\.id), ["vehicle"])
        XCTAssertEqual(presentation.sections.first?.isExpanded, true)
        XCTAssertEqual(presentation.sections.first?.count, 1)
        XCTAssertTrue(presentation.isFilterActive)
    }

    func testActiveRowFlag() {
        let presentation = resolve(input(activePath: "/vehicles"))
        let vehicleRows = presentation.sections.first { $0.id == "vehicle" }?.rows ?? []
        XCTAssertEqual(vehicleRows.first { $0.path == "/vehicles" }?.isActive, true)
        XCTAssertEqual(vehicleRows.first { $0.path == "/charging" }?.isActive, false)
    }

    // MARK: Pin affordances (Notion: every row carries one)

    func testSectionRowGetsPinAffordanceWhenNotPinned() {
        let row = resolve(input()).sections.first?.rows.first
        guard case let .pin(label)? = row?.pinAffordance else {
            return XCTFail("un-pinned section rows get a pin affordance")
        }
        XCTAssertEqual(label, "Pin Dashboard", "Notion's pin label is 'Pin {{page}}' (no 'to favorites')")
    }

    func testAlreadyPinnedSectionRowResolvesToUnpinNotNone() {
        // This is the key Notion-vs-Linear parity difference: an already-pinned section row shows an UNPIN
        // (close) action, never "no affordance".
        let pinned = [item("/dashboard", "Dashboard")]
        let presentation = resolve(input(pinned: pinned))
        let dashboardRow = presentation.sections
            .first { $0.id == "overview" }?
            .rows.first { $0.path == "/dashboard" }
        guard case let .unpin(label)? = dashboardRow?.pinAffordance else {
            return XCTFail("an already-pinned section row resolves to unpin (web pinAction close button)")
        }
        XCTAssertEqual(label, "Unpin Dashboard")
    }

    // MARK: Empty branches + labels

    func testEmptyFilterResultWhenNoSectionMatches() {
        let presentation = resolve(input(), filter: "zzz")
        XCTAssertTrue(presentation.isFilterActive)
        XCTAssertTrue(presentation.sections.isEmpty)
        XCTAssertTrue(presentation.isEmptyFilterResult)
        XCTAssertFalse(presentation.isEmpty, "an active filter is not the no-data empty state")
    }

    func testIsEmptyWhenNoDataAndNoFilter() {
        let empty = NotionSidebarInput(sections: [], pinnedItems: [], activePath: "/")
        let presentation = resolve(empty)
        XCTAssertTrue(presentation.isEmpty)
        XCTAssertFalse(presentation.isEmptyFilterResult)
        XCTAssertNil(presentation.favorites)
    }

    func testLabelsResolveThroughLocalizer() {
        let presentation = resolve(input())
        XCTAssertEqual(presentation.sidebarLabel, "Sidebar navigation")
        XCTAssertEqual(presentation.emptyFilterMessage, "No matches.")
        XCTAssertEqual(presentation.clearFilterLabel, "Clear filter")
    }
}
