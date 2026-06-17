import SwiftUI
import XCTest
@testable import TeslaSync

/// Binding + logic tests for `DashboardsPageModel` — the nine web i18n keys the page renders, the
/// four copy-status keys, the name-sorted curated panel catalog, the canCopy/Copy/Clear logic over
/// an injected clipboard (success / unavailable / failed branches), the Helix-draft → editor JSON
/// hand-off (web `handleApplyAiDraft` → `JSON.stringify(draft.dashboard, null, 2)`), the
/// localStorage-parity draft persistence, and the `/power/dashboards` route registration +
/// deep-link parse (with no-regression checks for the sibling power-user routes).
@MainActor final class DashboardsPageModelTests: XCTestCase {
    private func makeModel(
        seed: String = "",
        clipboard: any DashboardClipboard = InMemoryDashboardClipboard()
    ) -> DashboardsPageModel {
        DashboardsPageModel(draftStore: InMemoryDashboardDraftStore(seed: seed), clipboard: clipboard)
    }

    private func sampleDraft(title: String = "Fleet overview") -> DashboardLayoutDraft {
        DashboardLayoutDraft(
            prompt: "fleet overview",
            dashboard: DashboardEnvelope(
                title: title,
                slots: [
                    DashboardSlot(
                        panelName: "drives_per_day_timeseries",
                        gridPos: DashboardSlotGrid(x: 0, y: 0, width: 24, height: 8)
                    )
                ]
            ),
            rationale: "overview",
            referencedPanels: ["drives_per_day_timeseries"]
        )
    }

    // MARK: - Parity strings (web powerDashboards.* keys)

    func testParityStringKeysMatchWeb() {
        let model = makeModel()
        XCTAssertEqual(model.titleKey, LocalizedStringKey("powerDashboards.title"))
        XCTAssertEqual(model.introKey, LocalizedStringKey("powerDashboards.intro"))
        XCTAssertEqual(model.editorTitleKey, LocalizedStringKey("powerDashboards.editor.title"))
        XCTAssertEqual(model.editorLabelKey, LocalizedStringKey("powerDashboards.editor.label"))
        let promptKey = "powerDashboards.editor.placeholder" // parity:allow i18n key name
        XCTAssertEqual(model.editorPromptKey, LocalizedStringKey(promptKey))
        XCTAssertEqual(model.copyKey, LocalizedStringKey("powerDashboards.editor.copy"))
        XCTAssertEqual(model.clearKey, LocalizedStringKey("powerDashboards.editor.clear"))
        XCTAssertEqual(model.panelsTitleKey, LocalizedStringKey("powerDashboards.panels.title"))
        XCTAssertEqual(model.panelsIntroKey, LocalizedStringKey("powerDashboards.panels.intro"))
    }

    func testCopyMessageKeysMatchWeb() {
        XCTAssertEqual(DashboardCopyMessage.empty.key, LocalizedStringKey("powerDashboards.editor.copyEmpty"))
        XCTAssertEqual(
            DashboardCopyMessage.unavailable.key,
            LocalizedStringKey("powerDashboards.editor.copyUnavailable")
        )
        XCTAssertEqual(DashboardCopyMessage.success.key, LocalizedStringKey("powerDashboards.editor.copySuccess"))
        XCTAssertEqual(DashboardCopyMessage.failure.key, LocalizedStringKey("powerDashboards.editor.copyFailed"))
    }

    // MARK: - Curated panel catalog (web CURATED_DASHBOARD_PANELS / sortedPanels)

    func testCatalogIsNameSorted() {
        let names = makeModel().panels.map(\.name)
        XCTAssertEqual(names, [
            "alerts_count_stat",
            "battery_soc_stat",
            "charging_sessions_table",
            "drives_per_day_timeseries",
            "energy_used_per_day_barchart",
            "vehicles_table"
        ])
    }

    func testCatalogHasSixPanels() {
        XCTAssertEqual(DashboardsPanelCatalog.panels.count, 6)
        XCTAssertEqual(Set(DashboardsPanelCatalog.panels.map(\.name)).count, 6)
    }

    // MARK: - canCopy / Copy / Clear (web canCopy / handleCopy / handleClear)

    func testCanCopyReflectsTrimmedJSON() {
        let model = makeModel()
        XCTAssertFalse(model.canCopy)
        model.dashboardJSON = "   \n  "
        XCTAssertFalse(model.canCopy)
        model.dashboardJSON = "{}"
        XCTAssertTrue(model.canCopy)
    }

    func testCopyEmptyEditorShowsEmptyMessage() {
        let model = makeModel()
        model.copy()
        XCTAssertEqual(model.copyMessage, .empty)
    }

    func testCopyWritesTrimmedJSONAndShowsSuccess() {
        let clipboard = InMemoryDashboardClipboard(result: .written)
        let model = makeModel(seed: "  { \"title\": \"x\" }\n", clipboard: clipboard)
        model.copy()
        XCTAssertEqual(model.copyMessage, .success)
        XCTAssertEqual(clipboard.lastWrittenText, "{ \"title\": \"x\" }")
        XCTAssertEqual(clipboard.writeCount, 1)
    }

    func testCopyUnavailableShowsUnavailableMessage() {
        let model = makeModel(seed: "{}", clipboard: InMemoryDashboardClipboard(result: .unavailable))
        model.copy()
        XCTAssertEqual(model.copyMessage, .unavailable)
    }

    func testCopyFailedShowsFailureMessage() {
        let model = makeModel(seed: "{}", clipboard: InMemoryDashboardClipboard(result: .failed))
        model.copy()
        XCTAssertEqual(model.copyMessage, .failure)
    }

    func testClearResetsEditorAndMessage() {
        let model = makeModel(seed: "{}")
        model.copy()
        XCTAssertNotNil(model.copyMessage)
        model.clear()
        XCTAssertEqual(model.dashboardJSON, "")
        XCTAssertNil(model.copyMessage)
    }

    // MARK: - Apply draft → pretty JSON (web handleApplyAiDraft)

    func testApplyDraftPopulatesPrettyJSONAndClearsMessage() throws {
        let model = makeModel()
        model.copy() // seed an empty-copy message
        XCTAssertEqual(model.copyMessage, .empty)
        model.applyDraft(sampleDraft())
        XCTAssertNil(model.copyMessage)

        // The editor now holds valid, parseable JSON matching the web envelope wire shape.
        let parsed = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(model.dashboardJSON.utf8)) as? [String: Any]
        )
        XCTAssertEqual(parsed["title"] as? String, "Fleet overview")
        let slots = try XCTUnwrap(parsed["slots"] as? [[String: Any]])
        XCTAssertEqual(slots.count, 1)
        XCTAssertEqual(slots[0]["panel_name"] as? String, "drives_per_day_timeseries")
        let grid = try XCTUnwrap(slots[0]["grid_pos"] as? [String: Any])
        XCTAssertEqual(grid["x"] as? Int, 0)
        XCTAssertEqual(grid["y"] as? Int, 0)
        XCTAssertEqual(grid["w"] as? Int, 24)
        XCTAssertEqual(grid["h"] as? Int, 8)
    }

    func testEnvelopeJSONIsPrettyPrinted() {
        let json = DashboardEnvelopeJSON.pretty(sampleDraft().dashboard)
        XCTAssertTrue(json.contains("\n"), "pretty JSON spans multiple lines")
        XCTAssertTrue(json.contains("drives_per_day_timeseries"))
    }

    func testDrafterApplyRoutesProposedJSONIntoEditor() {
        let source = InMemoryNLDashboardComposerSource(initial: NLDashboardComposerInputSnapshot(gate: .on))
        let model = DashboardsPageModel(
            draftStore: InMemoryDashboardDraftStore(),
            drafterSource: source
        )
        let drafter = model.drafter
        drafter.start()
        source.pushDraft(sampleDraft())
        XCTAssertEqual(drafter.draft?.dashboard.title, "Fleet overview")
        drafter.apply()
        XCTAssertTrue(model.dashboardJSON.contains("Fleet overview"))
        XCTAssertTrue(model.dashboardJSON.contains("drives_per_day_timeseries"))
        XCTAssertNil(model.copyMessage)
    }

    func testDrafterIsCachedAcrossAccess() {
        let model = makeModel()
        XCTAssertTrue(model.drafter === model.drafter)
    }

    // MARK: - Draft persistence (web localStorage 'ai.dashboardComposer.draft')

    func testDraftLoadsFromStoreOnInit() {
        let model = makeModel(seed: "{ \"title\": \"x\" }")
        XCTAssertEqual(model.dashboardJSON, "{ \"title\": \"x\" }")
    }

    func testDraftPersistsOnChangeAndClears() {
        let store = InMemoryDashboardDraftStore(seed: "")
        let model = DashboardsPageModel(draftStore: store)
        model.dashboardJSON = "{ \"a\": 1 }"
        XCTAssertEqual(store.load(), "{ \"a\": 1 }")
        model.clear()
        XCTAssertEqual(store.load(), "")
    }

    // MARK: - Route registration + deep-link parsing

    func testRouteRegistrationHostsPowerDashboards() {
        let registry = DashboardsRouteRegistration.registry()
        XCTAssertTrue(registry.registeredRoutes.contains(.powerDashboards))
        XCTAssertNotNil(registry.view(for: .powerDashboards))
    }

    func testDeepLinkResolvesToPowerDashboards() {
        XCTAssertEqual(AppRouteParser.parse(path: "/power/dashboards"), .powerDashboards)
        XCTAssertEqual(AppRoute.powerDashboards.path, "/power/dashboards")
        XCTAssertEqual(AppRoute.powerDashboards.pathSegment, "power/dashboards")
        XCTAssertEqual(AppRoute.powerDashboards.group, .system)
    }

    func testSiblingRoutesStillResolve() {
        // No regression: the sibling power-user routes keep their resolution.
        XCTAssertEqual(AppRouteParser.parse(path: "/power/sql"), .powerSql)
        XCTAssertEqual(AppRouteParser.parse(path: "/power-user"), .powerUser)
    }

    func testRoutePathSegmentsRemainUnique() {
        let segments = AppRoute.allCases.map(\.pathSegment)
        XCTAssertEqual(Set(segments).count, segments.count, "every route path segment is unique")
    }
}
