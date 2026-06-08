//
//  WidgetPicker.Tests.swift
//  TeslaSync — P4 feature view · 0134 · WidgetPicker (Apple)
//
//  Unit coverage for the WidgetPicker projection core:
//    • Catalog — the 118-widget registry + 10 presets shape, id lookups, and the
//      registry-ordered available categories.
//    • Adapter — query normalization, category/search filtering, registry-ordered
//      grouping, the addable/recently-added/de-dup rules, the recents update, the
//      highlightMatch split, and the t(key, default, vars) copy builders.
//    • Accessibility — the VoiceOver card + preset labels.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no bundle: the adapter is pure, driven directly with an echo localizer.
//

import XCTest
@testable import TeslaSync

// MARK: - Catalog

final class WidgetCatalogTests: XCTestCase {
    func testRegistryShape() {
        XCTAssertEqual(WidgetCatalog.all.count, 118)
        XCTAssertEqual(WidgetCatalog.presets.count, 10)
        XCTAssertEqual(WidgetCatalog.all.first?.id, "vehicle-hero")
        XCTAssertEqual(WidgetCatalog.all.first?.category, .vehicle)
    }

    func testByIDLookup() {
        let gauge = WidgetCatalog.entry("battery-gauge")
        XCTAssertEqual(gauge?.name, "Battery Level")
        XCTAssertEqual(gauge?.category, .battery)
        XCTAssertEqual(gauge?.defaultSize.cols, 1)
        XCTAssertEqual(gauge?.defaultSize.rows, 2)
        XCTAssertFalse(gauge?.iconSystemName.isEmpty ?? true)
        XCTAssertNil(WidgetCatalog.entry("does-not-exist"))
    }

    func testEveryEntryHasIcon() {
        XCTAssertTrue(WidgetCatalog.all.allSatisfy { !$0.iconSystemName.isEmpty })
        XCTAssertTrue(WidgetCatalog.all.allSatisfy { !$0.name.isEmpty && !$0.summary.isEmpty })
    }

    func testAvailableCategoriesAreRegistryOrdered() {
        XCTAssertEqual(WidgetCatalog.availableCategories, WidgetCatalogCategory.allCases)
        XCTAssertEqual(WidgetCatalogCategory.allCases.count, 16)
        XCTAssertEqual(WidgetCatalogCategory.vehicle.label, "Vehicle")
        XCTAssertEqual(WidgetCatalogCategory.battery.label, "Battery & Range")
    }

    func testPresetShape() {
        let first = WidgetCatalog.presets.first
        XCTAssertEqual(first?.id, "default")
        XCTAssertEqual(first?.name, "Default")
        XCTAssertEqual(first?.widgetCount, 8)
        XCTAssertEqual(WidgetCatalog.presets.last?.id, "minimal")
        XCTAssertEqual(WidgetCatalog.presets.last?.widgetCount, 4)
    }

    func testPerCategoryCounts() {
        func count(_ category: WidgetCatalogCategory) -> Int {
            WidgetCatalog.all.count(where: { $0.category == category })
        }
        XCTAssertEqual(count(.vehicle), 16)
        XCTAssertEqual(count(.analytics), 14)
        XCTAssertEqual(count(.tires), 2)
        XCTAssertEqual(count(.commands), 2)
    }
}

// MARK: - Adapter (filtering / grouping / mutation / highlight)

final class WidgetPickerAdapterTests: XCTestCase {
    func testNormalizedQueryTrimsAndLowercases() {
        XCTAssertEqual(WidgetPickerAdapter.normalizedQuery("  Battery  "), "battery")
        XCTAssertEqual(WidgetPickerAdapter.normalizedQuery(""), "")
    }

    func testFilteredWidgetsByCategoryAndQuery() {
        XCTAssertEqual(WidgetPickerAdapter.filteredWidgets(category: nil, query: "").count, 118)
        XCTAssertEqual(WidgetPickerAdapter.filteredWidgets(category: .tires, query: "").count, 2)
        let charge = WidgetPickerAdapter.filteredWidgets(category: nil, query: "charge")
        XCTAssertFalse(charge.isEmpty)
        XCTAssertTrue(charge.allSatisfy {
            $0.name.lowercased().contains("charge")
                || $0.summary.lowercased().contains("charge")
                || $0.category.rawValue.contains("charge")
        })
    }

    func testGroupedEntriesOrderAndCounts() {
        let groups = WidgetPickerAdapter.groupedEntries(category: nil)
        XCTAssertEqual(groups.count, 16)
        XCTAssertEqual(groups.first?.category, .vehicle)
        XCTAssertEqual(groups.first?.entries.count, 16)
        XCTAssertEqual(groups.map(\.category), WidgetCatalogCategory.allCases)
        let battery = WidgetPickerAdapter.groupedEntries(category: .battery)
        XCTAssertEqual(battery.count, 1)
        XCTAssertEqual(battery.first?.entries.count, 10)
    }

    func testVisibleWidgetsBrowseVsSearch() {
        XCTAssertEqual(WidgetPickerAdapter.visibleWidgets(category: nil, query: "").count, 118)
        let search = WidgetPickerAdapter.visibleWidgets(category: nil, query: "battery")
        XCTAssertEqual(search, WidgetPickerAdapter.filteredWidgets(category: nil, query: "battery"))
    }

    func testAddableRemovesActive() {
        let entries = Array(WidgetCatalog.all.prefix(3))
        let addable = WidgetPickerAdapter.addable(entries, active: [entries[1].id])
        XCTAssertEqual(addable.map(\.id), [entries[0].id, entries[2].id])
    }

    func testRecentlyAddedVisibleRules() {
        let recents = ["battery-gauge", "unknown-x", "vehicle-hero"]
        XCTAssertTrue(WidgetPickerAdapter.recentlyAddedVisible(
            recentIDs: recents, active: [], category: .battery, query: ""
        ).isEmpty)
        XCTAssertTrue(WidgetPickerAdapter.recentlyAddedVisible(
            recentIDs: recents, active: [], category: nil, query: "x"
        ).isEmpty)
        let visible = WidgetPickerAdapter.recentlyAddedVisible(
            recentIDs: recents, active: ["vehicle-hero"], category: nil, query: ""
        )
        XCTAssertEqual(visible.map(\.id), ["battery-gauge"])
    }

    func testRecentlyAddedVisibleCapsAtMax() {
        let recents = Array(WidgetCatalog.all.prefix(12).map(\.id))
        let visible = WidgetPickerAdapter.recentlyAddedVisible(
            recentIDs: recents, active: [], category: nil, query: ""
        )
        XCTAssertEqual(visible.count, WidgetPickerAdapter.recentlyAddedMax)
    }

    func testAddableIDsDeDup() {
        let ids = ["unknown", "battery-gauge", "battery-gauge", "vehicle-hero"]
        let result = WidgetPickerAdapter.addableIDs(from: ids, active: ["vehicle-hero"])
        XCTAssertEqual(result, ["battery-gauge"])
    }

    func testUpdatedRecentsMostRecentFirstDeDupCapped() {
        let updated = WidgetPickerAdapter.updatedRecents(
            previous: ["x", "battery-gauge", "y"], adding: ["battery-gauge", "z"]
        )
        XCTAssertEqual(updated, ["battery-gauge", "z", "x", "y"])
        let many = WidgetPickerAdapter.updatedRecents(
            previous: (0 ..< 10).map { "p\($0)" }, adding: ["a", "b"]
        )
        XCTAssertEqual(many.count, WidgetPickerAdapter.recentlyAddedMax)
        XCTAssertEqual(many.first, "a")
    }

    func testSanitizeRecentsDropsUnknown() {
        XCTAssertEqual(
            WidgetPickerAdapter.sanitizeRecents(["battery-gauge", "nope", "vehicle-hero"]),
            ["battery-gauge", "vehicle-hero"]
        )
    }

    func testHighlightSplitsFirstCaseInsensitiveMatch() {
        let segments = WidgetPickerAdapter.highlight("Battery Level", query: "batt")
        XCTAssertEqual(segments.count, 2)
        XCTAssertEqual(segments[0], WidgetTextSegment(text: "Batt", isMatch: true))
        XCTAssertEqual(segments[1], WidgetTextSegment(text: "ery Level", isMatch: false))

        let mid = WidgetPickerAdapter.highlight("Energy Stats", query: "stat")
        XCTAssertEqual(mid.map(\.text), ["Energy ", "Stat", "s"])
        XCTAssertEqual(mid.map(\.isMatch), [false, true, false])
    }

    func testHighlightNoMatchOrEmptyQuery() {
        XCTAssertEqual(
            WidgetPickerAdapter.highlight("Battery", query: "zzz"),
            [WidgetTextSegment(text: "Battery", isMatch: false)]
        )
        XCTAssertEqual(
            WidgetPickerAdapter.highlight("Battery", query: ""),
            [WidgetTextSegment(text: "Battery", isMatch: false)]
        )
    }
}

// MARK: - Adapter copy builders (web t(key, default, vars))

final class WidgetPickerCopyTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testInterpolateReplacesTokens() {
        XCTAssertEqual(
            WidgetPickerAdapter.interpolate("{{count}} of {{count}} — {{name}}", ["count": "3", "name": "x"]),
            "3 of 3 — x"
        )
    }

    func testAddedAnnouncement() {
        XCTAssertNil(WidgetPickerAdapter.addedAnnouncement(names: [], localize: echo))
        XCTAssertEqual(
            WidgetPickerAdapter.addedAnnouncement(names: ["Battery Level"], localize: echo),
            "Battery Level added to dashboard"
        )
        XCTAssertEqual(
            WidgetPickerAdapter.addedAnnouncement(names: ["A", "B"], localize: echo),
            "2 widgets added to dashboard"
        )
    }

    func testAddedCountTextPlural() {
        XCTAssertEqual(WidgetPickerAdapter.addedCountText(count: 1, localize: echo), "1 widget added")
        XCTAssertEqual(WidgetPickerAdapter.addedCountText(count: 3, localize: echo), "3 widgets added")
    }

    func testCountCopyBuilders() {
        XCTAssertEqual(WidgetPickerAdapter.availableText(count: 12, localize: echo), "12 widgets available")
        XCTAssertEqual(WidgetPickerAdapter.presetWidgetsText(count: 5, localize: echo), "5 widgets")
        XCTAssertEqual(WidgetPickerAdapter.addAllText(count: 7, localize: echo), "+ Add all 7")
        XCTAssertEqual(
            WidgetPickerAdapter.searchResultsText(count: 4, query: "ch", localize: echo),
            "4 results for \"ch\""
        )
        XCTAssertEqual(
            WidgetPickerAdapter.noResultsText(query: "zz", localize: echo),
            "No widgets match \"zz\""
        )
    }
}

// MARK: - Accessibility (VoiceOver labels) + surface slug

final class WidgetPickerAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testCardLabel() throws {
        let gauge = try XCTUnwrap(WidgetCatalog.entry("battery-gauge"))
        XCTAssertEqual(
            WidgetPickerAccessibility.cardLabel(for: gauge, isAdded: false, localize: echo),
            "Battery Level, Battery & Range, 1×2 grid"
        )
        XCTAssertEqual(
            WidgetPickerAccessibility.cardLabel(for: gauge, isAdded: true, localize: echo),
            "Battery Level, Battery & Range, 1×2 grid, Added"
        )
    }

    func testPresetLabel() throws {
        let preset = try XCTUnwrap(WidgetCatalog.presets.first)
        XCTAssertEqual(
            WidgetPickerAccessibility.presetLabel(for: preset, localize: echo),
            "Default, 8 widgets"
        )
    }

    func testSurfaceSlug() {
        XCTAssertEqual(WidgetPickerSurface.slug, "WidgetPicker")
        XCTAssertEqual(WidgetPicker.surfaceSlug, "WidgetPicker")
    }
}
