import SwiftUI
import XCTest
@testable import TeslaSync

/// Binding + logic tests for `SqlPlaygroundPageModel` — the nine web i18n keys the page renders,
/// the two run-message keys, the name-sorted curated catalog (counts + SI-canonical columns), the
/// Run/Clear/run-message logic, the Helix-draft → editor hand-off (web `handleApplyAiDraft`), the
/// localStorage-parity draft persistence, and the `/power/sql` route registration + deep-link parse
/// (with no-regression checks for the sibling power-user + webhooks routes).
@MainActor final class SqlPlaygroundPageModelTests: XCTestCase {
    private func makeModel(seed: String = "") -> SqlPlaygroundPageModel {
        SqlPlaygroundPageModel(draftStore: InMemorySqlDraftStore(seed: seed))
    }

    // MARK: - Parity strings (web powerSql.* keys)

    func testParityStringKeysMatchWeb() {
        let model = makeModel()
        XCTAssertEqual(model.titleKey, LocalizedStringKey("powerSql.title"))
        XCTAssertEqual(model.introKey, LocalizedStringKey("powerSql.intro"))
        XCTAssertEqual(model.editorTitleKey, LocalizedStringKey("powerSql.editor.title"))
        XCTAssertEqual(model.editorLabelKey, LocalizedStringKey("powerSql.editor.label"))
        let promptKey = "powerSql.editor.placeholder" // parity:allow i18n key name
        XCTAssertEqual(model.editorPromptKey, LocalizedStringKey(promptKey))
        XCTAssertEqual(model.runKey, LocalizedStringKey("powerSql.editor.run"))
        XCTAssertEqual(model.clearKey, LocalizedStringKey("powerSql.editor.clear"))
        XCTAssertEqual(model.catalogTitleKey, LocalizedStringKey("powerSql.catalog.title"))
        XCTAssertEqual(model.catalogIntroKey, LocalizedStringKey("powerSql.catalog.intro"))
    }

    func testRunMessageKeysMatchWeb() {
        XCTAssertEqual(SqlRunMessage.empty.key, LocalizedStringKey("powerSql.editor.runEmpty"))
        XCTAssertEqual(SqlRunMessage.unavailable.key, LocalizedStringKey("powerSql.editor.runUnavailable"))
    }

    // MARK: - Curated schema catalog (web CURATED_CATALOG / sortedTables)

    func testCatalogIsNameSorted() {
        let names = makeModel().tables.map(\.name)
        XCTAssertEqual(names, ["alerts", "charging_sessions", "drives", "signal_log_view", "vehicles"])
    }

    func testCatalogColumnCounts() {
        let counts = Dictionary(
            uniqueKeysWithValues: SqlPlaygroundCatalog.tables.map { ($0.name, $0.columns.count) }
        )
        XCTAssertEqual(counts["drives"], 10)
        XCTAssertEqual(counts["charging_sessions"], 8)
        XCTAssertEqual(counts["vehicles"], 5)
        XCTAssertEqual(counts["alerts"], 5)
        XCTAssertEqual(counts["signal_log_view"], 5)
    }

    func testCatalogUsesSICanonicalColumns() {
        let drives = SqlPlaygroundCatalog.tables.first { $0.name == "drives" }
        let columns = Set(drives?.columns.map(\.name) ?? [])
        XCTAssertTrue(columns.isSuperset(of: [
            "distance_m", "duration_s", "energy_used_wh", "avg_speed_mps", "max_speed_mps"
        ]))
        // No legacy unit-suffixed columns leaked in (Phase-48 SI canon).
        let allColumns = SqlPlaygroundCatalog.tables.flatMap { $0.columns.map(\.name) }
        XCTAssertFalse(allColumns.contains { name in
            name.hasSuffix("_mi") || name.hasSuffix("_mph") || name.hasSuffix("_kwh") || name.hasSuffix("_kw")
        })
    }

    // MARK: - Run / Clear (web handleRun / handleClear)

    func testCanRunReflectsTrimmedSql() {
        let model = makeModel()
        XCTAssertFalse(model.canRun)
        model.sql = "   \n  "
        XCTAssertFalse(model.canRun)
        model.sql = "SELECT 1;"
        XCTAssertTrue(model.canRun)
    }

    func testRunWithEmptyEditorShowsEmptyMessage() {
        let model = makeModel()
        model.run()
        XCTAssertEqual(model.runMessage, .empty)
    }

    func testRunWithQueryShowsUnavailableMessage() {
        let model = makeModel()
        model.sql = "SELECT 1;"
        model.run()
        XCTAssertEqual(model.runMessage, .unavailable)
    }

    func testClearResetsEditorAndMessage() {
        let model = makeModel(seed: "SELECT 1;")
        model.run()
        XCTAssertEqual(model.runMessage, .unavailable)
        model.clear()
        XCTAssertEqual(model.sql, "")
        XCTAssertNil(model.runMessage)
    }

    // MARK: - Helix draft hand-off (web handleApplyAiDraft / <AINLSqlPlayground onApply>)

    func testApplyDraftCopiesSqlAndClearsMessage() {
        let model = makeModel()
        model.run() // seed an empty-run message
        XCTAssertEqual(model.runMessage, .empty)
        model.applyDraft(ReadonlySQLDraft(
            prompt: "how many drives last week",
            sql: "SELECT count(*) FROM drives;",
            rationale: "count rows",
            referencedTables: ["drives"]
        ))
        XCTAssertEqual(model.sql, "SELECT count(*) FROM drives;")
        XCTAssertNil(model.runMessage)
    }

    func testDrafterApplyRoutesProposedSqlIntoEditor() {
        let source = InMemoryNLSqlPlaygroundSource(initial: NLSqlPlaygroundInputSnapshot(gate: .on))
        let model = SqlPlaygroundPageModel(draftStore: InMemorySqlDraftStore(), drafterSource: source)
        let drafter = model.drafter
        drafter.start()
        let draft = ReadonlySQLDraft(
            prompt: "trips last week",
            sql: "SELECT * FROM drives LIMIT 10;",
            rationale: "recent drives",
            referencedTables: ["drives"]
        )
        source.pushDraft(draft)
        XCTAssertEqual(drafter.draft?.sql, "SELECT * FROM drives LIMIT 10;")
        drafter.apply()
        XCTAssertEqual(model.sql, "SELECT * FROM drives LIMIT 10;")
        XCTAssertNil(model.runMessage)
    }

    func testDrafterIsCachedAcrossAccess() {
        let model = makeModel()
        XCTAssertTrue(model.drafter === model.drafter)
    }

    // MARK: - Draft persistence (web localStorage 'ai.sqlPlayground.draft')

    func testDraftLoadsFromStoreOnInit() {
        let model = makeModel(seed: "SELECT * FROM vehicles;")
        XCTAssertEqual(model.sql, "SELECT * FROM vehicles;")
    }

    func testDraftPersistsOnChangeAndClears() {
        let store = InMemorySqlDraftStore(seed: "")
        let model = SqlPlaygroundPageModel(draftStore: store)
        model.sql = "SELECT 1;"
        XCTAssertEqual(store.load(), "SELECT 1;")
        model.clear()
        XCTAssertEqual(store.load(), "")
    }

    // MARK: - Route registration + deep-link parsing

    func testRouteRegistrationHostsPowerSql() {
        let registry = SqlPlaygroundRouteRegistration.registry()
        XCTAssertTrue(registry.registeredRoutes.contains(.powerSql))
        XCTAssertNotNil(registry.view(for: .powerSql))
    }

    func testDeepLinkResolvesToPowerSql() {
        XCTAssertEqual(AppRouteParser.parse(path: "/power/sql"), .powerSql)
        XCTAssertEqual(AppRoute.powerSql.path, "/power/sql")
        XCTAssertEqual(AppRoute.powerSql.pathSegment, "power/sql")
        XCTAssertEqual(AppRoute.powerSql.group, .system)
    }

    func testSiblingRoutesStillResolve() {
        // No regression: the power-user landing + webhooks routes keep their resolution.
        XCTAssertEqual(AppRouteParser.parse(path: "/power-user"), .powerUser)
        XCTAssertEqual(AppRouteParser.parse(path: "/notifications/webhooks"), .notificationsWebhooks)
    }

    func testRoutePathSegmentsRemainUnique() {
        let segments = AppRoute.allCases.map(\.pathSegment)
        XCTAssertEqual(Set(segments).count, segments.count, "every route path segment is unique")
    }
}
