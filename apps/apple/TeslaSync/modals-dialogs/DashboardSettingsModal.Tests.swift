//
//  DashboardSettingsModal.Tests.swift
//  TeslaSync — P4 modal / dialog · 0022 · DashboardSettingsModal (Apple)
//
//  Adapter + projection + accessibility coverage for the DashboardSettingsModal surface:
//    • `DashboardSettingsProjection.buildDraft` — the name / icon / settings seeding + icon fallback.
//    • `phase` / `inlineFailure` — the loading / loaded-empty / failed envelopes + the cached-reload
//      inline error.
//    • `commit` — the rename (trim + change guard) / icon (change guard) / always-on settings deltas.
//    • `isDirty` — the change detector.
//    • `DashboardRefreshCatalog` — the 6-entry cadence catalog + the per-widget fallback.
//    • `DashboardIconCatalog` — the 16-glyph grid + the default icon + the 8-column width.
//    • `DashboardSettingsValues.defaults` — the web `DEFAULT_DASHBOARD_SETTINGS`.
//    • `DashboardSettingsAccessibility` — the dialog / icon / scope VoiceOver content.
//
//  The state-holder coverage lives in DashboardSettingsModal.ModelTests.swift. Pure, bundle-free:
//  copy resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

private enum ProjectionSample {
    static func dashboard(
        name: String = "Garage",
        icon: String = "🔋",
        settings: DashboardSettingsValues = DashboardSettingsValues(
            refreshInterval: 30,
            vehicleID: 2,
            showWidgetBorders: true,
            compactMode: false
        )
    ) -> DashboardDescriptor {
        DashboardDescriptor(id: "dash-1", name: name, icon: icon, settings: settings)
    }

    static func draft(from dashboard: DashboardDescriptor) -> DashboardSettingsDraft {
        DashboardSettingsProjection.buildDraft(from: dashboard)
    }
}

final class DashboardSettingsProjectionTests: XCTestCase {
    // MARK: buildDraft

    func testBuildDraftSeedsEveryField() {
        let draft = ProjectionSample.draft(from: ProjectionSample.dashboard())
        XCTAssertEqual(draft.name, "Garage")
        XCTAssertEqual(draft.icon, "🔋")
        XCTAssertEqual(draft.refreshInterval, 30)
        XCTAssertEqual(draft.vehicleID, 2)
        XCTAssertTrue(draft.showWidgetBorders)
        XCTAssertFalse(draft.compactMode)
    }

    func testBuildDraftFallsBackToDefaultIconWhenEmpty() {
        let draft = ProjectionSample.draft(from: ProjectionSample.dashboard(icon: ""))
        XCTAssertEqual(draft.icon, DashboardIconCatalog.defaultIcon)
    }

    func testDraftSettingsProjectsValueObject() {
        let draft = ProjectionSample.draft(from: ProjectionSample.dashboard())
        XCTAssertEqual(draft.settings.refreshInterval, 30)
        XCTAssertEqual(draft.settings.vehicleID, 2)
        XCTAssertTrue(draft.settings.showWidgetBorders)
    }

    // MARK: phase

    func testPhaseLoading() {
        XCTAssertEqual(DashboardSettingsProjection.phase(status: .loading, hasDashboard: false), .loading)
        XCTAssertEqual(DashboardSettingsProjection.phase(status: .loading, hasDashboard: true), .populated)
    }

    func testPhaseLoaded() {
        XCTAssertEqual(DashboardSettingsProjection.phase(status: .loaded, hasDashboard: false), .empty)
        XCTAssertEqual(DashboardSettingsProjection.phase(status: .loaded, hasDashboard: true), .populated)
    }

    func testPhaseFailed() {
        XCTAssertEqual(
            DashboardSettingsProjection.phase(status: .failed("x"), hasDashboard: false),
            .error("x")
        )
        XCTAssertEqual(
            DashboardSettingsProjection.phase(status: .failed("x"), hasDashboard: true),
            .populated
        )
    }

    func testInlineFailureOnlyWithCachedDashboard() {
        XCTAssertEqual(
            DashboardSettingsProjection.inlineFailure(status: .failed("x"), hasDashboard: true), "x"
        )
        XCTAssertNil(DashboardSettingsProjection.inlineFailure(status: .failed("x"), hasDashboard: false))
        XCTAssertNil(DashboardSettingsProjection.inlineFailure(status: .loaded, hasDashboard: true))
    }

    // MARK: commit deltas (web handleSave)

    func testCommitRenamesWhenChanged() {
        let original = ProjectionSample.dashboard(name: "Garage")
        var draft = ProjectionSample.draft(from: original)
        draft.name = "Studio"
        let change = DashboardSettingsProjection.commit(draft: draft, original: original)
        XCTAssertEqual(change.renamedName, "Studio")
    }

    func testCommitTrimsNameAndSkipsWhenUnchanged() {
        let original = ProjectionSample.dashboard(name: "Garage")
        var draft = ProjectionSample.draft(from: original)
        draft.name = "  Garage  "
        let change = DashboardSettingsProjection.commit(draft: draft, original: original)
        XCTAssertNil(change.renamedName)
    }

    func testCommitSkipsRenameWhenBlank() {
        let original = ProjectionSample.dashboard(name: "Garage")
        var draft = ProjectionSample.draft(from: original)
        draft.name = "   "
        let change = DashboardSettingsProjection.commit(draft: draft, original: original)
        XCTAssertNil(change.renamedName)
    }

    func testCommitChangesIconOnlyWhenDifferent() {
        let original = ProjectionSample.dashboard(icon: "🔋")
        var draft = ProjectionSample.draft(from: original)
        XCTAssertNil(DashboardSettingsProjection.commit(draft: draft, original: original).changedIcon)
        draft.icon = "🚗"
        XCTAssertEqual(
            DashboardSettingsProjection.commit(draft: draft, original: original).changedIcon, "🚗"
        )
    }

    func testCommitAlwaysCarriesSettings() {
        let original = ProjectionSample.dashboard()
        var draft = ProjectionSample.draft(from: original)
        draft.refreshInterval = 300
        draft.compactMode = true
        let change = DashboardSettingsProjection.commit(draft: draft, original: original)
        XCTAssertEqual(change.settings.refreshInterval, 300)
        XCTAssertTrue(change.settings.compactMode)
    }

    func testIsDirty() {
        let original = ProjectionSample.dashboard()
        var draft = ProjectionSample.draft(from: original)
        XCTAssertFalse(DashboardSettingsProjection.isDirty(draft: draft, original: original))
        draft.showWidgetBorders.toggle()
        XCTAssertTrue(DashboardSettingsProjection.isDirty(draft: draft, original: original))
    }

    // MARK: Catalogs

    func testRefreshCatalogHasSixOptions() {
        XCTAssertEqual(DashboardRefreshCatalog.options.map(\.value), [0, 5, 10, 30, 60, 300])
    }

    func testRefreshCatalogResolvesAndFallsBack() {
        XCTAssertEqual(DashboardRefreshCatalog.option(for: 60).value, 60)
        XCTAssertEqual(DashboardRefreshCatalog.option(for: 999).value, DashboardRefreshCatalog.defaultValue)
    }

    func testRefreshOptionLabelKeysMatchWebPattern() {
        XCTAssertEqual(DashboardRefreshCatalog.option(for: 5).labelKey, "dashSettings.refresh5")
    }

    func testIconCatalog() {
        XCTAssertEqual(DashboardIconCatalog.icons.count, 16)
        XCTAssertEqual(DashboardIconCatalog.icons.first, "📊")
        XCTAssertEqual(DashboardIconCatalog.defaultIcon, "📊")
        XCTAssertEqual(DashboardIconCatalog.columns, 8)
    }

    func testSettingsDefaultsMatchWeb() {
        let defaults = DashboardSettingsValues.defaults
        XCTAssertEqual(defaults.refreshInterval, 0)
        XCTAssertNil(defaults.vehicleID)
        XCTAssertFalse(defaults.showWidgetBorders)
        XCTAssertFalse(defaults.compactMode)
    }
}

final class DashboardSettingsAccessibilityTests: XCTestCase {
    func testDialogLabel() {
        XCTAssertEqual(
            DashboardSettingsAccessibility.dialogLabel(localize: passthroughLocalize),
            "Dashboard Settings"
        )
    }

    func testIconLabelUnselectedIsGlyphOnly() {
        XCTAssertEqual(
            DashboardSettingsAccessibility.iconLabel(icon: "🚗", selected: false, localize: passthroughLocalize),
            "🚗"
        )
    }

    func testIconLabelSelectedAppendsState() {
        XCTAssertEqual(
            DashboardSettingsAccessibility.iconLabel(icon: "🚗", selected: true, localize: passthroughLocalize),
            "🚗, Selected"
        )
    }

    func testScopeValueLabel() {
        XCTAssertEqual(
            DashboardSettingsAccessibility.scopeValueLabel(vehicleName: "Model Y", localize: passthroughLocalize),
            "Model Y"
        )
        XCTAssertEqual(
            DashboardSettingsAccessibility.scopeValueLabel(vehicleName: nil, localize: passthroughLocalize),
            "All Vehicles"
        )
    }
}
