//
//  SavedViewMenu.Tests.swift
//  TeslaSync — P4 shared surface · 0102 · SavedViewMenu (Apple)
//
//  Adapter + projection coverage for the SavedViewMenu surface:
//    • Format — the i18next `{{name}}` interpolation, the trigger label (active name vs the generic
//      title), the applied / cleared announcements, the delete-confirm message, the query description.
//    • Accessibility — the row affordance labels that flip with the default / pinned state, and the
//      composed apply label.
//    • Projection — the phase gate (loading / empty / error / loaded), the active-view + default-row
//      derivations, the source-order row mapping, and the localized chrome.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure core directly.
//

import XCTest
@testable import TeslaSync

/// Identity resolver — returns each key's English fallback so the assertions read the web copy.
private let resolve: SavedViewMenuResolve = { _, fallback in fallback }

private func makeView(
    _ id: Int,
    _ name: String,
    query: String = "",
    isDefault: Bool = false,
    isPinned: Bool = false
) -> SavedView {
    SavedView(
        id: id, name: name, route: "/drives", query: query,
        isDefault: isDefault, isPinned: isPinned, sortOrder: id
    )
}

private func input(
    _ views: [SavedView],
    currentQuery: String = "",
    isLoading: Bool = false,
    error: String? = nil
) -> SavedViewMenuInput {
    SavedViewMenuInput(
        views: views, route: "/drives", currentQuery: currentQuery,
        isLoading: isLoading, errorMessage: error
    )
}

// MARK: - Format (web `t()` label builders)

final class SavedViewMenuFormatTests: XCTestCase {
    func testInterpolateSubstitutesToken() {
        XCTAssertEqual(
            SavedViewMenuFormat.interpolate("View {{name}} applied", ["name": "Trips"]),
            "View Trips applied"
        )
    }

    func testInterpolateLeavesTemplateWhenTokenAbsent() {
        XCTAssertEqual(SavedViewMenuFormat.interpolate("nothing", ["name": "x"]), "nothing")
    }

    func testTriggerLabelUsesActiveName() {
        XCTAssertEqual(SavedViewMenuFormat.triggerLabel(activeName: "This month", strings: resolve), "This month")
    }

    func testTriggerLabelFallsBackToTitle() {
        XCTAssertEqual(SavedViewMenuFormat.triggerLabel(activeName: nil, strings: resolve), "Saved views")
        XCTAssertEqual(SavedViewMenuFormat.triggerLabel(activeName: "", strings: resolve), "Saved views")
    }

    func testAppliedAnnouncement() {
        XCTAssertEqual(
            SavedViewMenuFormat.appliedAnnouncement(name: "Trips", strings: resolve),
            "View Trips applied"
        )
    }

    func testClearedAnnouncement() {
        XCTAssertEqual(SavedViewMenuFormat.clearedAnnouncement(strings: resolve), "Saved view cleared")
    }

    func testDeleteConfirmMessage() {
        XCTAssertEqual(
            SavedViewMenuFormat.deleteConfirmMessage(name: "Trips", strings: resolve),
            "Delete saved view \"Trips\"?"
        )
    }

    func testQueryDescriptionEmptyShowsNoFilters() {
        XCTAssertEqual(SavedViewMenuFormat.queryDescription(query: "", strings: resolve), "No filters")
    }

    func testQueryDescriptionShowsQuery() {
        XCTAssertEqual(
            SavedViewMenuFormat.queryDescription(query: "range=month", strings: resolve),
            "range=month"
        )
    }
}

// MARK: - Accessibility (web row `aria-label`s)

final class SavedViewMenuAccessibilityTests: XCTestCase {
    func testDefaultToggleLabelFlips() {
        let label = SavedViewMenuAccessibility.defaultToggleLabel
        XCTAssertEqual(label(true, resolve), "Clear default")
        XCTAssertEqual(label(false, resolve), "Set as default")
    }

    func testPinToggleLabelFlips() {
        XCTAssertEqual(SavedViewMenuAccessibility.pinToggleLabel(isPinned: true, strings: resolve), "Unpin")
        XCTAssertEqual(SavedViewMenuAccessibility.pinToggleLabel(isPinned: false, strings: resolve), "Pin")
    }

    func testRenameAndDeleteLabels() {
        XCTAssertEqual(SavedViewMenuAccessibility.renameLabel(strings: resolve), "Rename view")
        XCTAssertEqual(SavedViewMenuAccessibility.deleteLabel(strings: resolve), "Delete")
    }

    func testApplyLabelPrefixesDefault() {
        XCTAssertEqual(
            SavedViewMenuAccessibility.applyLabel(name: "Trips", isDefault: true, strings: resolve),
            "Default: Trips"
        )
        XCTAssertEqual(
            SavedViewMenuAccessibility.applyLabel(name: "Trips", isDefault: false, strings: resolve),
            "Trips"
        )
    }
}

// MARK: - Projection (phase gate + derivations + chrome)

final class SavedViewMenuProjectionTests: XCTestCase {
    func testErrorTakesPrecedence() {
        let resolved = SavedViewMenuProjection.resolve(
            input([makeView(1, "A", query: "x")], isLoading: true, error: "boom"),
            strings: resolve
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testEmptyErrorMessageDoesNotForceError() {
        let resolved = SavedViewMenuProjection.resolve(input([makeView(1, "A")], error: ""), strings: resolve)
        XCTAssertEqual(resolved.phase, .loaded)
    }

    func testLoadingWhenLoadingAndNoViews() {
        let resolved = SavedViewMenuProjection.resolve(input([], isLoading: true), strings: resolve)
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testEmptyWhenResolvedNoViews() {
        let resolved = SavedViewMenuProjection.resolve(input([]), strings: resolve)
        XCTAssertEqual(resolved.phase, .empty)
    }

    func testLoadedKeepsCachedRowsWhileLoading() {
        let resolved = SavedViewMenuProjection.resolve(input([makeView(1, "A")], isLoading: true), strings: resolve)
        XCTAssertEqual(resolved.phase, .loaded)
        XCTAssertEqual(resolved.rows.count, 1)
    }

    func testRowsPreserveSourceOrder() {
        let resolved = SavedViewMenuProjection.resolve(
            input([makeView(3, "C"), makeView(1, "A"), makeView(2, "B")]),
            strings: resolve
        )
        XCTAssertEqual(resolved.rows.map(\.name), ["C", "A", "B"])
    }

    func testActiveViewMatchesCurrentQuery() {
        let views = [makeView(1, "A", query: "range=week"), makeView(2, "B", query: "range=month")]
        let resolved = SavedViewMenuProjection.resolve(input(views, currentQuery: "range=month"), strings: resolve)
        XCTAssertEqual(resolved.activeView?.id, 2)
        XCTAssertTrue(resolved.hasActiveView)
        XCTAssertEqual(resolved.triggerLabel, "B")
    }

    func testNoActiveViewWhenNoMatch() {
        let resolved = SavedViewMenuProjection.resolve(
            input([makeView(1, "A", query: "range=week")], currentQuery: "range=year"),
            strings: resolve
        )
        XCTAssertNil(resolved.activeView)
        XCTAssertFalse(resolved.hasActiveView)
        XCTAssertEqual(resolved.triggerLabel, "Saved views")
    }

    func testDefaultViewIDDerivation() {
        let views = [makeView(1, "A"), makeView(2, "B", isDefault: true)]
        let resolved = SavedViewMenuProjection.resolve(input(views), strings: resolve)
        XCTAssertEqual(resolved.defaultViewID, 2)
    }

    func testRowFlagsAndLabels() {
        let view = makeView(1, "Trips", query: "q=1", isDefault: true, isPinned: true)
        let resolved = SavedViewMenuProjection.resolve(input([view], currentQuery: "q=1"), strings: resolve)
        let row = try? XCTUnwrap(resolved.rows.first)
        XCTAssertEqual(row?.isActive, true)
        XCTAssertEqual(row?.isDefault, true)
        XCTAssertEqual(row?.isPinned, true)
        XCTAssertEqual(row?.defaultToggleLabel, "Clear default")
        XCTAssertEqual(row?.pinToggleLabel, "Unpin")
        XCTAssertEqual(row?.applyAccessibilityLabel, "Default: Trips")
        XCTAssertEqual(row?.queryDescription, "q=1")
    }

    func testChromeLabels() {
        let resolved = SavedViewMenuProjection.resolve(input([makeView(1, "A")]), strings: resolve)
        XCTAssertEqual(resolved.menuTitle, "Saved views")
        XCTAssertEqual(resolved.manageLabel, "Manage views")
        XCTAssertEqual(resolved.saveCurrentLabel, "Save current view…")
        XCTAssertEqual(resolved.emptyMessage, "No saved views yet")
        XCTAssertEqual(resolved.appliedBadgeLabel, "View")
        XCTAssertEqual(resolved.clearAppliedLabel, "Clear applied view")
        XCTAssertTrue(resolved.hasViews)
    }
}
