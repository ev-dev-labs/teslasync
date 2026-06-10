//
//  WidgetCatalogueDialog.Tests.swift
//  TeslaSync — P4 modal / dialog · 0026 · WidgetCatalogueDialog (Apple)
//
//  Adapter + projection + catalog + accessibility coverage for the WidgetCatalogueDialog surface:
//    • `WidgetCatalogueProjection.group` — category ordering, empty-section drop, entry-order preservation.
//    • `filter` — name / description / id / category-label (topic) search, blank passthrough, no-match.
//    • `visibleCount` / `isSearchEmpty` — the result tally + the no-matches cue.
//    • `activeSet` / `addedCount` / `isAdded` / `canAdd` — the added-set + the add guard.
//    • `phase` / `inlineFailure` — the loading / loaded-empty / failed envelopes + the cached-reload error.
//    • `WidgetCatalogue` — the 118-entry registry: total, per-category counts, lookup, no blank fields.
//    • `WidgetCatalogueCategory` — the canonical order + emoji / fallback / key.
//    • `WidgetCatalogueStrings.interpolate` + `WidgetCatalogueAccessibility` — `{{token}}` + VoiceOver copy.
//
//  The state-holder coverage lives in WidgetCatalogueDialog.ModelTests.swift. Pure, bundle-free: copy
//  resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

private enum CatalogueSample {
    static func entry(
        _ id: String,
        _ name: String,
        _ category: WidgetCatalogueCategory,
        _ description: String = "desc"
    ) -> WidgetCatalogueEntry {
        WidgetCatalogueEntry(id: id, name: name, category: category, iconSystemName: "circle", description: description)
    }

    /// A small ordered fixture spanning three categories (battery appears before vehicle to prove the
    /// projection re-orders into the canonical `CATEGORY_ORDER`).
    static let mixed: [WidgetCatalogueEntry] = [
        entry("range", "Range Estimate", .battery, "Rated and ideal range"),
        entry("cells", "Battery Cells", .battery, "Cell voltage heatmap"),
        entry("hero", "Vehicle Card", .vehicle, "Name, model, state"),
        entry("map", "Location Map", .maps, "Where the car is")
    ]

    static func label(_ category: WidgetCatalogueCategory) -> String {
        category.fallbackLabel
    }
}

final class WidgetCatalogueProjectionTests: XCTestCase {
    // MARK: group

    func testGroupOrdersByCanonicalCategoryOrder() {
        let groups = WidgetCatalogueProjection.group(CatalogueSample.mixed)
        XCTAssertEqual(groups.map(\.category), [.vehicle, .battery, .maps])
    }

    func testGroupPreservesEntryOrderWithinCategory() {
        let groups = WidgetCatalogueProjection.group(CatalogueSample.mixed)
        let battery = groups.first { $0.category == .battery }
        XCTAssertEqual(battery?.entries.map(\.id), ["range", "cells"])
    }

    func testGroupDropsEmptyCategories() {
        let groups = WidgetCatalogueProjection.group([CatalogueSample.entry("hero", "Vehicle Card", .vehicle)])
        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(groups.first?.category, .vehicle)
    }

    // MARK: filter

    private func filtered(_ query: String) -> [WidgetCatalogueGroup] {
        WidgetCatalogueProjection.filter(
            groups: WidgetCatalogueProjection.group(CatalogueSample.mixed),
            query: query,
            categoryLabel: CatalogueSample.label
        )
    }

    func testBlankQueryReturnsEverything() {
        XCTAssertEqual(WidgetCatalogueProjection.visibleCount(filtered("   ")), 4)
    }

    func testFilterByName() {
        let groups = filtered("estimate")
        XCTAssertEqual(groups.flatMap { $0.entries.map(\.id) }, ["range"])
    }

    func testFilterByDescription() {
        let groups = filtered("heatmap")
        XCTAssertEqual(groups.flatMap { $0.entries.map(\.id) }, ["cells"])
    }

    func testFilterByID() {
        let groups = filtered("hero")
        XCTAssertEqual(groups.flatMap { $0.entries.map(\.id) }, ["hero"])
    }

    func testFilterByCategoryLabelKeepsWholeCategory() {
        // "battery" matches the battery category label → every battery entry is retained.
        let groups = filtered("battery")
        let battery = groups.first { $0.category == .battery }
        XCTAssertEqual(battery?.entries.count, 2)
    }

    func testFilterNoMatchYieldsEmpty() {
        let groups = filtered("zzzzznope")
        XCTAssertTrue(groups.isEmpty)
        XCTAssertEqual(WidgetCatalogueProjection.visibleCount(groups), 0)
    }

    func testIsSearchEmpty() {
        XCTAssertTrue(WidgetCatalogueProjection.isSearchEmpty(query: "zzz", visibleCount: 0))
        XCTAssertFalse(WidgetCatalogueProjection.isSearchEmpty(query: "", visibleCount: 0))
        XCTAssertFalse(WidgetCatalogueProjection.isSearchEmpty(query: "range", visibleCount: 1))
    }

    func testIsFilteringTrimsWhitespace() {
        XCTAssertFalse(WidgetCatalogueProjection.isFiltering("   "))
        XCTAssertTrue(WidgetCatalogueProjection.isFiltering("  x "))
    }

    // MARK: added set + counts

    func testAddedSetAndCountDeduplicate() {
        let set = WidgetCatalogueProjection.activeSet(["a", "b", "a"])
        XCTAssertEqual(set, ["a", "b"])
        XCTAssertEqual(WidgetCatalogueProjection.addedCount(["a", "b", "a"]), 2)
    }

    func testIsAddedAndCanAdd() {
        let set = WidgetCatalogueProjection.activeSet(["a"])
        XCTAssertTrue(WidgetCatalogueProjection.isAdded("a", in: set))
        XCTAssertFalse(WidgetCatalogueProjection.canAdd("a", in: set))
        XCTAssertTrue(WidgetCatalogueProjection.canAdd("b", in: set))
    }

    // MARK: phase + inline failure

    func testPhaseLoading() {
        XCTAssertEqual(WidgetCatalogueProjection.phase(status: .loading, hasEntries: false), .loading)
        XCTAssertEqual(WidgetCatalogueProjection.phase(status: .loading, hasEntries: true), .populated)
    }

    func testPhaseLoaded() {
        XCTAssertEqual(WidgetCatalogueProjection.phase(status: .loaded, hasEntries: false), .empty)
        XCTAssertEqual(WidgetCatalogueProjection.phase(status: .loaded, hasEntries: true), .populated)
    }

    func testPhaseFailed() {
        XCTAssertEqual(WidgetCatalogueProjection.phase(status: .failed("x"), hasEntries: false), .error("x"))
        XCTAssertEqual(WidgetCatalogueProjection.phase(status: .failed("x"), hasEntries: true), .populated)
    }

    func testInlineFailureOnlyWithCachedEntries() {
        XCTAssertEqual(WidgetCatalogueProjection.inlineFailure(status: .failed("x"), hasEntries: true), "x")
        XCTAssertNil(WidgetCatalogueProjection.inlineFailure(status: .failed("x"), hasEntries: false))
        XCTAssertNil(WidgetCatalogueProjection.inlineFailure(status: .loaded, hasEntries: true))
    }
}

final class WidgetCatalogueCatalogTests: XCTestCase {
    func testRegistryHasAllOneHundredEighteenWidgets() {
        XCTAssertEqual(WidgetCatalogue.all.count, 118)
        XCTAssertEqual(WidgetCatalogue.total, 118)
        XCTAssertGreaterThan(WidgetCatalogue.total, 50)
    }

    func testPerCategoryCountsMatchWebRegistry() {
        let expected: [WidgetCatalogueCategory: Int] = [
            .vehicle: 16, .battery: 10, .energy: 9, .driving: 13, .charging: 13, .climate: 4,
            .tires: 2, .security: 7, .commands: 2, .media: 2, .telemetry: 5, .analytics: 14,
            .alerts: 2, .automations: 2, .system: 12, .maps: 5
        ]
        var counts: [WidgetCatalogueCategory: Int] = [:]
        for entry in WidgetCatalogue.all {
            counts[entry.category, default: 0] += 1
        }
        XCTAssertEqual(counts, expected)
    }

    func testCanonicalSampleWidgetsExist() {
        for id in ["battery-gauge", "vehicle-hero", "climate-status", "recent-drives"] {
            XCTAssertNotNil(WidgetCatalogue.entry(for: id), "missing \(id)")
        }
    }

    func testEveryEntryHasNonEmptyCopyAndIcon() {
        for entry in WidgetCatalogue.all {
            XCTAssertFalse(entry.id.isEmpty)
            XCTAssertFalse(entry.name.isEmpty, "empty name for \(entry.id)")
            XCTAssertFalse(entry.description.isEmpty, "empty description for \(entry.id)")
            XCTAssertFalse(entry.iconSystemName.isEmpty, "empty icon for \(entry.id)")
        }
    }

    func testWidgetIDsAreUnique() {
        let ids = WidgetCatalogue.all.map(\.id)
        XCTAssertEqual(Set(ids).count, ids.count)
    }

    func testAllSixteenCategoriesPopulated() {
        let present = Set(WidgetCatalogue.all.map(\.category))
        XCTAssertEqual(present, Set(WidgetCatalogueCategory.allCases))
    }
}

final class WidgetCatalogueCategoryTests: XCTestCase {
    func testOrderMatchesDeclarationOrder() {
        XCTAssertEqual(WidgetCatalogueCategory.order, WidgetCatalogueCategory.allCases)
        XCTAssertEqual(WidgetCatalogueCategory.order.first, .vehicle)
        XCTAssertEqual(WidgetCatalogueCategory.order.last, .maps)
        XCTAssertEqual(WidgetCatalogueCategory.order.count, 16)
    }

    func testLabelKeyAndFallback() {
        XCTAssertEqual(WidgetCatalogueCategory.battery.labelKey, "dashboard.catalogue.category.battery")
        XCTAssertEqual(WidgetCatalogueCategory.battery.fallbackLabel, "Battery & Range")
        XCTAssertFalse(WidgetCatalogueCategory.maps.emoji.isEmpty)
    }
}

final class WidgetCatalogueStringsTests: XCTestCase {
    func testInterpolateReplacesTokens() {
        let out = WidgetCatalogueStrings.interpolate(
            "{{count}} of {{total}} widgets match", ["count": "3", "total": "118"]
        )
        XCTAssertEqual(out, "3 of 118 widgets match")
    }

    func testInterpolateLeavesUnknownTokens() {
        XCTAssertEqual(WidgetCatalogueStrings.interpolate("Add {{name}} widget", [:]), "Add {{name}} widget")
    }
}

final class WidgetCatalogueAccessibilityTests: XCTestCase {
    func testDialogLabel() {
        XCTAssertEqual(
            WidgetCatalogueAccessibility.dialogLabel(localize: passthroughLocalize),
            "Widget catalogue"
        )
    }

    func testAddLabelWhenAddable() {
        XCTAssertEqual(
            WidgetCatalogueAccessibility.addLabel(name: "Battery Level", isAdded: false, localize: passthroughLocalize),
            "Add Battery Level widget"
        )
    }

    func testAddLabelWhenAdded() {
        XCTAssertEqual(
            WidgetCatalogueAccessibility.addLabel(name: "Battery Level", isAdded: true, localize: passthroughLocalize),
            "Battery Level, Added"
        )
    }

    func testRowLabel() {
        XCTAssertEqual(
            WidgetCatalogueAccessibility.rowLabel(
                name: "Battery Level", categoryLabel: "Battery & Range", isAdded: false, localize: passthroughLocalize
            ),
            "Battery Level, Battery & Range"
        )
        XCTAssertEqual(
            WidgetCatalogueAccessibility.rowLabel(
                name: "Battery Level", categoryLabel: "Battery & Range", isAdded: true, localize: passthroughLocalize
            ),
            "Battery Level, Battery & Range, Added"
        )
    }
}
