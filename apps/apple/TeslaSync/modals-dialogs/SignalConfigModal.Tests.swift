//
//  SignalConfigModal.Tests.swift
//  TeslaSync — P4 modal / dialog · 0016 · SignalConfigModal (Apple)
//
//  Adapter + projection + accessibility coverage for the SignalConfigModal surface:
//    • `SignalConfigProjection.buildRows` — the catalog flatten + initial selection + default cadence.
//    • `filter` / `group` — the case-insensitive name filter + category-ordered grouping.
//    • selection — `selectedCount` / `allSelected` / `canSubmit` / `categoryState` / `categoryTally`.
//    • `phase` / `inlineFailure` — the loading / loaded-empty / failed envelopes + the cached-reload
//      inline error.
//    • `summary` / `submitPayload` — the footer 500 ms / 10 s counts + the `{ name, interval }` payload.
//    • the mutators — `updating` / `togglingAll` / `settingAllInterval` / `togglingCategory` /
//      `settingCategoryInterval`.
//    • `SignalConfigPreset.apply` — all 8 presets' selection + cadence arms (web `PRESETS`).
//    • `SignalConfigCatalog` — the 10-entry interval catalog + the 10 s fallback.
//    • `iconSystemName` — the category-icon map + the default arm.
//    • `SignalConfigAccessibility` — the summary / toggle / row / category / preset VoiceOver content.
//
//  The state-holder coverage lives in SignalConfigModal.ModelTests.swift. Pure, bundle-free: copy
//  resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

private enum SignalConfigSample {
    /// A catalog with one field per category, spanning every preset-referenced category plus an
    /// unmatched one, so the preset arms can be asserted per category.
    static let presetCatalog: [SignalConfigCategoryCatalog] = [
        cat("Driving"), cat("Powertrain"), cat("Location"), cat("Charging"), cat("Climate"),
        cat("Tires & Service"), cat("Vehicle State"), cat("Safety"), cat("Media"),
        cat("User Preference"), cat("Vehicle Config"), cat("Mystery")
    ]

    static func cat(_ name: String) -> SignalConfigCategoryCatalog {
        SignalConfigCategoryCatalog(category: name, fields: ["\(name)Field"])
    }

    /// One row per category, all unselected at the 10 s default — the canvas for preset assertions.
    static func presetRows() -> [SignalConfigRow] {
        SignalConfigProjection.buildRows(catalog: presetCatalog, initialSelected: [], initialInterval: 10)
    }

    static func interval(forCategory category: String, in rows: [SignalConfigRow]) -> Int {
        rows.first { $0.category == category }?.interval ?? -1
    }

    static func selected(forCategory category: String, in rows: [SignalConfigRow]) -> Bool {
        rows.first { $0.category == category }?.selected ?? false
    }
}

final class SignalConfigProjectionTests: XCTestCase {
    // MARK: buildRows

    func testBuildRowsFlattensWithSelectionAndInterval() {
        let catalog = [
            SignalConfigCategoryCatalog(category: "Driving", fields: ["Speed", "Gear"]),
            SignalConfigCategoryCatalog(category: "Charging", fields: ["Soc"])
        ]
        let rows = SignalConfigProjection.buildRows(catalog: catalog, initialSelected: ["Gear"], initialInterval: 30)
        XCTAssertEqual(rows.map(\.name), ["Speed", "Gear", "Soc"])
        XCTAssertEqual(rows.map(\.category), ["Driving", "Driving", "Charging"])
        XCTAssertEqual(rows.filter(\.selected).map(\.name), ["Gear"])
        XCTAssertTrue(rows.allSatisfy { $0.interval == 30 })
    }

    // MARK: filter + group

    func testFilterIsCaseInsensitiveAndBlankReturnsAll() {
        let rows = SignalConfigSample.presetRows()
        XCTAssertEqual(SignalConfigProjection.filter(rows: rows, search: "   ").count, rows.count)
        let hit = SignalConfigProjection.filter(rows: rows, search: "driv")
        XCTAssertEqual(hit.map(\.name), ["DrivingField"])
        XCTAssertTrue(SignalConfigProjection.filter(rows: rows, search: "no-such-signal").isEmpty)
    }

    func testGroupPreservesCategoryOrder() {
        let rows = SignalConfigProjection.buildRows(
            catalog: [
                SignalConfigCategoryCatalog(category: "B", fields: ["b1", "b2"]),
                SignalConfigCategoryCatalog(category: "A", fields: ["a1"])
            ],
            initialSelected: [], initialInterval: 10
        )
        let groups = SignalConfigProjection.group(rows: rows)
        XCTAssertEqual(groups.map(\.category), ["B", "A"])
        XCTAssertEqual(groups.first?.rows.count, 2)
    }

    // MARK: selection

    func testSelectionCountsAndPredicates() {
        var rows = SignalConfigSample.presetRows()
        XCTAssertEqual(SignalConfigProjection.selectedCount(rows), 0)
        XCTAssertFalse(SignalConfigProjection.allSelected(rows))
        XCTAssertFalse(SignalConfigProjection.canSubmit(rows))
        rows = SignalConfigProjection.togglingAll(rows: rows, selected: true)
        XCTAssertEqual(SignalConfigProjection.selectedCount(rows), rows.count)
        XCTAssertTrue(SignalConfigProjection.allSelected(rows))
        XCTAssertTrue(SignalConfigProjection.canSubmit(rows))
    }

    func testAllSelectedIsFalseForEmptyDraft() {
        XCTAssertFalse(SignalConfigProjection.allSelected([]))
    }

    func testCategoryStateTriState() {
        let catalog = [SignalConfigCategoryCatalog(category: "Driving", fields: ["a", "b"])]
        var rows = SignalConfigProjection.buildRows(catalog: catalog, initialSelected: [], initialInterval: 10)
        XCTAssertEqual(SignalConfigProjection.categoryState(rows: rows, category: "Driving"), .none)
        rows = SignalConfigProjection.updating(rows: rows, name: "a", selected: true)
        XCTAssertEqual(SignalConfigProjection.categoryState(rows: rows, category: "Driving"), .some)
        rows = SignalConfigProjection.updating(rows: rows, name: "b", selected: true)
        XCTAssertEqual(SignalConfigProjection.categoryState(rows: rows, category: "Driving"), .all)
    }

    func testCategoryTally() {
        let catalog = [SignalConfigCategoryCatalog(category: "Driving", fields: ["a", "b", "c"])]
        let rows = SignalConfigProjection.buildRows(catalog: catalog, initialSelected: ["a", "c"], initialInterval: 10)
        let tally = SignalConfigProjection.categoryTally(rows: rows)
        XCTAssertEqual(tally.selected, 2)
        XCTAssertEqual(tally.total, 3)
    }

    // MARK: phase + inline failure

    func testPhaseResolution() {
        XCTAssertEqual(SignalConfigProjection.phase(status: .loading, hasRows: false), .loading)
        XCTAssertEqual(SignalConfigProjection.phase(status: .loading, hasRows: true), .populated)
        XCTAssertEqual(SignalConfigProjection.phase(status: .loaded, hasRows: false), .empty)
        XCTAssertEqual(SignalConfigProjection.phase(status: .loaded, hasRows: true), .populated)
        XCTAssertEqual(SignalConfigProjection.phase(status: .failed("x"), hasRows: false), .error("x"))
        XCTAssertEqual(SignalConfigProjection.phase(status: .failed("x"), hasRows: true), .populated)
    }

    func testInlineFailureOnlyWhenCachedRowsSurviveFailure() {
        XCTAssertEqual(SignalConfigProjection.inlineFailure(status: .failed("stale"), hasRows: true), "stale")
        XCTAssertNil(SignalConfigProjection.inlineFailure(status: .failed("x"), hasRows: false))
        XCTAssertNil(SignalConfigProjection.inlineFailure(status: .loaded, hasRows: true))
    }

    // MARK: summary + payload

    func testSummaryCountsRealtimeAndDefault() {
        var rows = SignalConfigProjection.buildRows(
            catalog: [SignalConfigCategoryCatalog(category: "Driving", fields: ["a", "b", "c"])],
            initialSelected: ["a", "b", "c"], initialInterval: 10
        )
        rows = SignalConfigProjection.updating(rows: rows, name: "a", interval: 0)
        let summary = SignalConfigProjection.summary(rows)
        XCTAssertEqual(summary.selected, 3)
        XCTAssertEqual(summary.realtime, 1)
        XCTAssertEqual(summary.standard, 2)
    }

    func testSubmitPayloadOnlySelected() {
        let rows = SignalConfigProjection.buildRows(
            catalog: [SignalConfigCategoryCatalog(category: "Driving", fields: ["a", "b"])],
            initialSelected: ["b"], initialInterval: 5
        )
        let payload = SignalConfigProjection.submitPayload(rows)
        XCTAssertEqual(payload.map(\.name), ["b"])
        XCTAssertEqual(payload.first?.interval, 5)
    }

    // MARK: mutators

    func testMutators() {
        var rows = SignalConfigSample.presetRows()
        rows = SignalConfigProjection.settingAllInterval(rows: rows, interval: 60)
        XCTAssertTrue(rows.allSatisfy { $0.interval == 60 })
        rows = SignalConfigProjection.togglingCategory(rows: rows, category: "Driving")
        XCTAssertTrue(SignalConfigSample.selected(forCategory: "Driving", in: rows))
        rows = SignalConfigProjection.togglingCategory(rows: rows, category: "Driving")
        XCTAssertFalse(SignalConfigSample.selected(forCategory: "Driving", in: rows))
        rows = SignalConfigProjection.settingCategoryInterval(rows: rows, category: "Charging", interval: 1)
        XCTAssertEqual(SignalConfigSample.interval(forCategory: "Charging", in: rows), 1)
        XCTAssertEqual(SignalConfigSample.interval(forCategory: "Driving", in: rows), 60)
    }

    // MARK: interval catalog + icons

    func testIntervalCatalogAndFallback() {
        XCTAssertEqual(SignalConfigCatalog.intervals.count, 10)
        XCTAssertEqual(SignalConfigCatalog.interval(for: 999).value, 10) // unknown → 10 s default
        XCTAssertEqual(SignalConfigCatalog.interval(for: 0).label, "500ms")
        XCTAssertEqual(SignalConfigCatalog.interval(for: 0).tone, .realtime)
    }

    func testCategoryIconMapAndDefault() {
        XCTAssertEqual(SignalConfigProjection.iconSystemName(for: "Charging"), "battery.100percent.bolt")
        XCTAssertEqual(SignalConfigProjection.iconSystemName(for: "Location"), "location.fill")
        XCTAssertEqual(SignalConfigProjection.iconSystemName(for: "Nope"), "dot.radiowaves.left.and.right")
    }
}

final class SignalConfigPresetTests: XCTestCase {
    func testRealtimeDriving() {
        let rows = SignalConfigPreset.realtimeDriving.apply(to: SignalConfigSample.presetRows())
        XCTAssertTrue(rows.allSatisfy(\.selected))
        XCTAssertEqual(SignalConfigSample.interval(forCategory: "Driving", in: rows), 1)
        XCTAssertEqual(SignalConfigSample.interval(forCategory: "Charging", in: rows), 10)
        XCTAssertEqual(SignalConfigSample.interval(forCategory: "Vehicle Config", in: rows), 86400)
        XCTAssertEqual(SignalConfigSample.interval(forCategory: "Mystery", in: rows), 10)
    }

    func testBalancedAndLowPower() {
        let balanced = SignalConfigPreset.balanced.apply(to: SignalConfigSample.presetRows())
        XCTAssertTrue(balanced.allSatisfy { $0.selected && $0.interval == 10 })
        let low = SignalConfigPreset.lowPower.apply(to: SignalConfigSample.presetRows())
        XCTAssertTrue(low.allSatisfy { $0.selected && $0.interval == 60 })
    }

    func testTrackMode() {
        let rows = SignalConfigPreset.trackMode.apply(to: SignalConfigSample.presetRows())
        XCTAssertTrue(rows.allSatisfy(\.selected))
        XCTAssertEqual(SignalConfigSample.interval(forCategory: "Powertrain", in: rows), 1)
        XCTAssertEqual(SignalConfigSample.interval(forCategory: "User Preference", in: rows), 3600)
        XCTAssertEqual(SignalConfigSample.interval(forCategory: "Climate", in: rows), 30)
    }

    func testCostSaver() {
        let rows = SignalConfigPreset.costSaver.apply(to: SignalConfigSample.presetRows())
        XCTAssertTrue(SignalConfigSample.selected(forCategory: "Charging", in: rows))
        XCTAssertFalse(SignalConfigSample.selected(forCategory: "Driving", in: rows))
        XCTAssertEqual(SignalConfigSample.interval(forCategory: "Vehicle State", in: rows), 900)
        XCTAssertEqual(SignalConfigSample.interval(forCategory: "Location", in: rows), 300)
    }

    func testSleepWatch() {
        let rows = SignalConfigPreset.sleepWatch.apply(to: SignalConfigSample.presetRows())
        XCTAssertTrue(SignalConfigSample.selected(forCategory: "Climate", in: rows))
        XCTAssertFalse(SignalConfigSample.selected(forCategory: "Media", in: rows))
        XCTAssertEqual(SignalConfigSample.interval(forCategory: "Safety", in: rows), 60)
        XCTAssertEqual(SignalConfigSample.interval(forCategory: "Location", in: rows), 300)
    }

    func testDiagnostics() {
        let rows = SignalConfigPreset.diagnostics.apply(to: SignalConfigSample.presetRows())
        XCTAssertTrue(rows.allSatisfy(\.selected))
        XCTAssertEqual(SignalConfigSample.interval(forCategory: "Powertrain", in: rows), 5)
        XCTAssertEqual(SignalConfigSample.interval(forCategory: "Driving", in: rows), 10)
        XCTAssertEqual(SignalConfigSample.interval(forCategory: "Media", in: rows), 60)
        XCTAssertEqual(SignalConfigSample.interval(forCategory: "Vehicle Config", in: rows), 3600)
    }

    func testTripLogger() {
        let rows = SignalConfigPreset.tripLogger.apply(to: SignalConfigSample.presetRows())
        XCTAssertFalse(SignalConfigSample.selected(forCategory: "Media", in: rows))
        XCTAssertTrue(SignalConfigSample.selected(forCategory: "Driving", in: rows))
        XCTAssertEqual(SignalConfigSample.interval(forCategory: "Location", in: rows), 1)
        XCTAssertEqual(SignalConfigSample.interval(forCategory: "Driving", in: rows), 5)
        XCTAssertEqual(SignalConfigSample.interval(forCategory: "Charging", in: rows), 30)
        XCTAssertEqual(SignalConfigSample.interval(forCategory: "Safety", in: rows), 60)
    }

    func testAllPresetsCarryNameDescAndIcon() {
        for preset in SignalConfigPreset.allCases {
            XCTAssertFalse(preset.nameFallback.isEmpty)
            XCTAssertFalse(preset.descFallback.isEmpty)
            XCTAssertFalse(preset.iconSystemName.isEmpty)
            XCTAssertEqual(preset.nameKey, "signals.config.preset.\(preset.rawValue).name")
        }
    }
}

final class SignalConfigAccessibilityTests: XCTestCase {
    func testSelectionSummary() {
        XCTAssertEqual(
            SignalConfigAccessibility.selectionSummary(selected: 3, total: 10, localize: passthroughLocalize),
            "3 of 10 signals selected"
        )
    }

    func testSelectAllToggleLabel() {
        XCTAssertEqual(
            SignalConfigAccessibility.selectAllToggleLabel(allSelected: true, localize: passthroughLocalize),
            "Deselect All"
        )
        XCTAssertEqual(
            SignalConfigAccessibility.selectAllToggleLabel(allSelected: false, localize: passthroughLocalize),
            "Select All"
        )
    }

    func testRowLabel() {
        XCTAssertEqual(
            SignalConfigAccessibility.rowLabel(
                name: "VehicleSpeed", selected: true, intervalLabel: "10s", localize: passthroughLocalize
            ),
            "VehicleSpeed, Selected, every 10s"
        )
        XCTAssertEqual(
            SignalConfigAccessibility.rowLabel(
                name: "Gear", selected: false, intervalLabel: "1s", localize: passthroughLocalize
            ),
            "Gear, Not selected, every 1s"
        )
    }

    func testCategoryLabel() {
        XCTAssertEqual(
            SignalConfigAccessibility.categoryLabel(
                category: "Driving", state: .some, selected: 2, total: 4, localize: passthroughLocalize
            ),
            "Driving, Some selected, 2 of 4"
        )
    }

    func testPresetLabel() {
        XCTAssertEqual(
            SignalConfigAccessibility.presetLabel(name: "Balanced", detail: "All signals at 10s"),
            "Balanced. All signals at 10s"
        )
    }
}
