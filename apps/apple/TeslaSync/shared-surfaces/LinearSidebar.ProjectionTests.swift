//
//  LinearSidebar.ProjectionTests.swift
//  TeslaSync — P4 shared surface · 0174 · LinearSidebar (Apple)
//
//  Pure-projection coverage (split from LinearSidebar.AdapterTests.swift for the SwiftLint file-length
//  budget). Drives ``LinearSidebarProjection/resolve(input:tree:localize:)`` across every branch the web
//  component renders: the Favorites group present/absent + filtered, the rendered sections + their filtered
//  counts, the expansion rule (collapse set vs. filter force-expand), the active-row flag, the
//  pin/unpin/none affordances, the empty-filter branch, the no-data empty branch, and the resolved labels.
//

import XCTest
@testable import TeslaSync

final class LinearSidebarProjectionTests: XCTestCase {
    private let fallbackOnly: LinearSidebarLocalize = { _, fallback in fallback }

    // MARK: Fixtures

    private func sections() -> [LinearSidebarSection] {
        [
            LinearSidebarSection(
                id: "overview",
                titleKey: "g.o",
                titleFallback: "Overview",
                items: [item("/dashboard", "Dashboard"), item("/explore", "Explore")]
            ),
            LinearSidebarSection(
                id: "vehicle",
                titleKey: "g.v",
                titleFallback: "Vehicle",
                items: [item("/vehicles", "Vehicles"), item("/charging", "Charging")]
            )
        ]
    }

    private func item(_ path: String, _ label: String) -> LinearSidebarItem {
        LinearSidebarItem(path: path, titleKey: path, titleFallback: label, systemImage: "circle")
    }

    private func input(
        pinned: [LinearSidebarItem] = [],
        badges: LinearSidebarBadges = .none,
        activePath: String = "/vehicles"
    ) -> LinearSidebarInput {
        LinearSidebarInput(sections: sections(), pinnedItems: pinned, badges: badges, activePath: activePath)
    }

    private func resolve(
        _ input: LinearSidebarInput,
        collapsed: Set<String> = [],
        filter: String = ""
    ) -> LinearSidebarPresentation {
        LinearSidebarProjection.resolve(
            input: input,
            tree: LinearSidebarTreeState(collapsedSectionIDs: collapsed, filterText: filter),
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
        XCTAssertEqual(favorites?.rows.first?.id, "pinned-/dashboard")
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

    // MARK: Sections + expansion

    func testAllSectionsRenderedWithFilteredCounts() {
        let presentation = resolve(input())
        XCTAssertEqual(presentation.sections.map(\.id), ["overview", "vehicle"])
        XCTAssertEqual(presentation.sections.map(\.count), [2, 2])
    }

    func testCollapsedSectionReportsNotExpanded() {
        let presentation = resolve(input(), collapsed: ["overview"])
        XCTAssertEqual(presentation.sections.first { $0.id == "overview" }?.isExpanded, false)
        XCTAssertEqual(presentation.sections.first { $0.id == "vehicle" }?.isExpanded, true)
    }

    func testFilterForceExpandsMatchingSections() {
        // "charg" matches only Charging in the Vehicle section; that section renders + is force-expanded
        // even though it is in the collapsed set.
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

    // MARK: Pin affordances

    func testSectionRowGetsPinAffordanceWhenNotPinned() {
        let row = resolve(input()).sections.first?.rows.first
        if case .pin = row?.pinAffordance {} else { XCTFail("un-pinned section rows get a pin affordance") }
    }

    func testSectionRowGetsNoAffordanceWhenAlreadyPinned() {
        let pinned = [item("/dashboard", "Dashboard")]
        let presentation = resolve(input(pinned: pinned))
        let dashboardRow = presentation.sections
            .first { $0.id == "overview" }?
            .rows.first { $0.path == "/dashboard" }
        XCTAssertEqual(dashboardRow?.pinAffordance, LinearSidebarPinAffordance.none)
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
        let empty = LinearSidebarInput(sections: [], pinnedItems: [], activePath: "/")
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
