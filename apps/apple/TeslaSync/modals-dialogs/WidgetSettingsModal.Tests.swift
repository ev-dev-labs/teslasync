//
//  WidgetSettingsModal.Tests.swift
//  TeslaSync — P4 modal / dialog · 0027 · WidgetSettingsModal (Apple)
//
//  Adapter + projection + accessibility coverage for the WidgetSettingsModal surface:
//    • `WidgetSettingsProjection.buildDraft` — the config seeding.
//    • `phase` / `inlineFailure` — the loading / loaded-empty / failed envelopes + the cached-reload
//      inline error.
//    • `commit` — the saved config (web `onSave(config)`).
//    • `isDirty` — the change detector.
//    • `vehicleLabel` — the display-name verbatim + the blank-name `Vehicle {id}` fallback.
//    • `refreshOption` / `timeRangeValue` — the select-value resolution + defaults.
//    • `WidgetRefreshCatalog` / `WidgetTimeRangeCatalog` — the option catalogs + the `'7d'` default.
//    • `WidgetSettingsCategory` — the `isVehicleWidget` / `isChartWidget` flags.
//    • `WidgetConfigValues` — the show-title default-on + the empty config.
//    • `WidgetSettingsAccessibility` — the dialog title + the scope VoiceOver content.
//
//  The state-holder coverage lives in WidgetSettingsModal.ModelTests.swift. Pure, bundle-free: copy
//  resolves through identity localizers.
//

import XCTest
@testable import TeslaSync

private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

private let tokenLocalize: @Sendable (String, String, String, String) -> String = { _, fallback, token, value in
    fallback.replacingOccurrences(of: token, with: value)
}

private enum ProjectionSample {
    static func widget(
        name: String = "Battery Health",
        category: WidgetSettingsCategory = .battery,
        config: WidgetConfigValues = WidgetConfigValues(
            vehicleID: 2,
            refreshRate: 30,
            timeRange: "30d",
            showTitle: true
        )
    ) -> WidgetDescriptor {
        WidgetDescriptor(id: "widget-1", definitionID: "battery-health", name: name, category: category, config: config)
    }
}

final class WidgetSettingsProjectionTests: XCTestCase {
    // MARK: buildDraft

    func testBuildDraftSeedsEveryField() {
        let draft = WidgetSettingsProjection.buildDraft(from: ProjectionSample.widget())
        XCTAssertEqual(draft.vehicleID, 2)
        XCTAssertEqual(draft.refreshRate, 30)
        XCTAssertEqual(draft.timeRange, "30d")
        XCTAssertEqual(draft.showTitle, true)
    }

    func testBuildDraftCarriesChartTypeUntouched() {
        let widget = ProjectionSample.widget(config: WidgetConfigValues(chartType: "line"))
        let draft = WidgetSettingsProjection.buildDraft(from: widget)
        XCTAssertEqual(draft.chartType, "line")
    }

    // MARK: phase

    func testPhaseLoading() {
        XCTAssertEqual(WidgetSettingsProjection.phase(status: .loading, hasWidget: false), .loading)
        XCTAssertEqual(WidgetSettingsProjection.phase(status: .loading, hasWidget: true), .populated)
    }

    func testPhaseLoaded() {
        XCTAssertEqual(WidgetSettingsProjection.phase(status: .loaded, hasWidget: false), .empty)
        XCTAssertEqual(WidgetSettingsProjection.phase(status: .loaded, hasWidget: true), .populated)
    }

    func testPhaseFailed() {
        XCTAssertEqual(WidgetSettingsProjection.phase(status: .failed("x"), hasWidget: false), .error("x"))
        XCTAssertEqual(WidgetSettingsProjection.phase(status: .failed("x"), hasWidget: true), .populated)
    }

    func testInlineFailureOnlyWithCachedWidget() {
        XCTAssertEqual(WidgetSettingsProjection.inlineFailure(status: .failed("x"), hasWidget: true), "x")
        XCTAssertNil(WidgetSettingsProjection.inlineFailure(status: .failed("x"), hasWidget: false))
        XCTAssertNil(WidgetSettingsProjection.inlineFailure(status: .loaded, hasWidget: true))
    }

    // MARK: commit (web onSave) + isDirty

    func testCommitCarriesEditedConfig() {
        var draft = WidgetSettingsProjection.buildDraft(from: ProjectionSample.widget())
        draft.refreshRate = 60
        draft.timeRange = "90d"
        let change = WidgetSettingsProjection.commit(draft: draft)
        XCTAssertEqual(change.config.refreshRate, 60)
        XCTAssertEqual(change.config.timeRange, "90d")
        XCTAssertEqual(change.config.vehicleID, 2)
    }

    func testIsDirty() {
        let widget = ProjectionSample.widget()
        var draft = WidgetSettingsProjection.buildDraft(from: widget)
        XCTAssertFalse(WidgetSettingsProjection.isDirty(draft: draft, original: widget.config))
        draft.showTitle = false
        XCTAssertTrue(WidgetSettingsProjection.isDirty(draft: draft, original: widget.config))
    }

    // MARK: vehicleLabel (web v.display_name || `Vehicle ${id}`)

    func testVehicleLabelUsesDisplayName() {
        let vehicle = WidgetVehicleOption(id: 4, displayName: "Cybertruck")
        XCTAssertEqual(WidgetSettingsProjection.vehicleLabel(for: vehicle, localize: tokenLocalize), "Cybertruck")
    }

    func testVehicleLabelFallsBackWhenBlank() {
        let vehicle = WidgetVehicleOption(id: 4, displayName: "   ")
        XCTAssertEqual(WidgetSettingsProjection.vehicleLabel(for: vehicle, localize: tokenLocalize), "Vehicle 4")
    }

    // MARK: select-value resolution

    func testRefreshOptionResolvesAndFallsBack() {
        XCTAssertEqual(WidgetSettingsProjection.refreshOption(for: 30).value, 30)
        XCTAssertNil(WidgetSettingsProjection.refreshOption(for: 999).value)
        XCTAssertNil(WidgetSettingsProjection.refreshOption(for: nil).value)
    }

    func testTimeRangeValueDefaults() {
        XCTAssertEqual(WidgetSettingsProjection.timeRangeValue(for: "30d"), "30d")
        XCTAssertEqual(WidgetSettingsProjection.timeRangeValue(for: nil), "7d")
    }
}

final class WidgetSettingsAdapterTests: XCTestCase {
    // MARK: Catalogs

    func testRefreshCatalogOptions() {
        XCTAssertEqual(WidgetRefreshCatalog.options.map(\.value), [nil, 5, 15, 30, 60])
    }

    func testRefreshOptionLabelKeysMatchWeb() {
        XCTAssertEqual(WidgetRefreshCatalog.options[1].labelKey, "dashboard.settings.5s")
        XCTAssertEqual(WidgetRefreshCatalog.options[0].labelKey, "dashboard.settings.default")
    }

    func testRefreshOptionIdentity() {
        XCTAssertEqual(WidgetRefreshCatalog.options[0].id, "default")
        XCTAssertEqual(WidgetRefreshCatalog.options[3].id, "30")
    }

    func testTimeRangeCatalogOptions() {
        XCTAssertEqual(WidgetTimeRangeCatalog.options.map(\.value), ["24h", "7d", "30d", "90d"])
        XCTAssertEqual(WidgetTimeRangeCatalog.defaultValue, "7d")
    }

    func testTimeRangeOptionLabelKeysMatchWeb() {
        XCTAssertEqual(WidgetTimeRangeCatalog.options[0].labelKey, "dashboard.settings.24h")
        XCTAssertEqual(WidgetTimeRangeCatalog.options[3].labelKey, "dashboard.settings.90d")
    }

    // MARK: Category flags (web isVehicleWidget / isChartWidget)

    func testIsVehicleWidget() {
        XCTAssertFalse(WidgetSettingsCategory.system.isVehicleWidget)
        XCTAssertFalse(WidgetSettingsCategory.analytics.isVehicleWidget)
        XCTAssertTrue(WidgetSettingsCategory.vehicle.isVehicleWidget)
        XCTAssertTrue(WidgetSettingsCategory.battery.isVehicleWidget)
        XCTAssertTrue(WidgetSettingsCategory.climate.isVehicleWidget)
    }

    func testIsChartWidget() {
        for category in [WidgetSettingsCategory.driving, .charging, .analytics, .battery] {
            XCTAssertTrue(category.isChartWidget, "\(category) should be a chart widget")
        }
        for category in [WidgetSettingsCategory.vehicle, .system, .climate, .maps] {
            XCTAssertFalse(category.isChartWidget, "\(category) should not be a chart widget")
        }
    }

    // MARK: Config value semantics

    func testEmptyConfig() {
        let config = WidgetConfigValues.empty
        XCTAssertNil(config.vehicleID)
        XCTAssertNil(config.refreshRate)
        XCTAssertNil(config.timeRange)
        XCTAssertNil(config.showTitle)
    }

    func testShowTitleCheckedDefaultsOn() {
        XCTAssertTrue(WidgetConfigValues(showTitle: nil).showTitleChecked)
        XCTAssertTrue(WidgetConfigValues(showTitle: true).showTitleChecked)
        XCTAssertFalse(WidgetConfigValues(showTitle: false).showTitleChecked)
    }

    func testDraftBlankIsEmpty() {
        let draft = WidgetSettingsDraft.blank
        XCTAssertNil(draft.vehicleID)
        XCTAssertNil(draft.refreshRate)
        XCTAssertNil(draft.timeRange)
        XCTAssertNil(draft.showTitle)
        XCTAssertTrue(draft.showTitleChecked)
    }

    func testDescriptorSectionFlags() {
        let battery = ProjectionSample.widget(category: .battery)
        XCTAssertTrue(battery.showsVehicleSection)
        XCTAssertTrue(battery.showsTimeRangeSection)
        let system = ProjectionSample.widget(category: .system)
        XCTAssertFalse(system.showsVehicleSection)
        XCTAssertFalse(system.showsTimeRangeSection)
    }
}

final class WidgetSettingsAccessibilityTests: XCTestCase {
    func testDialogLabelInterpolatesName() {
        XCTAssertEqual(
            WidgetSettingsAccessibility.dialogLabel(widgetName: "Battery Health", localize: tokenLocalize),
            "Battery Health Settings"
        )
    }

    func testScopeValueLabel() {
        XCTAssertEqual(
            WidgetSettingsAccessibility.scopeValueLabel(vehicleName: "Model Y", localize: passthroughLocalize),
            "Model Y"
        )
        XCTAssertEqual(
            WidgetSettingsAccessibility.scopeValueLabel(vehicleName: nil, localize: passthroughLocalize),
            "All Vehicles (first)"
        )
    }
}
