import XCTest
@testable import TeslaSync

/// State-machine tests for `AuditLogPageModel` — every data state the page renders
/// (loading / empty / error / success, plus the 503 subsystem-unavailable variant), the
/// hash-chain verify states, pagination + filter query building (web `buildAuditLogQuery`
/// snake_case contract), and the display-boundary formatters (`formatDateTime` /
/// `formatRelative` / `formatJSON`) ported from the web.
@MainActor final class AuditLogPageModelTests: XCTestCase {
    private struct StubSource: AuditLogDataSource {
        var rows: [AuditLogRow] = []
        var categories: [String] = []
        var actions: [String] = []
        var verifyResult = AuditChainVerify(intact: true, firstBadID: 0, rowsChecked: 0, since: "", limit: 1000)
        var logUnavailable = false
        var logFails = false
        var categoriesFail = false
        var actionsFail = false
        var verifyFails = false

        func loadLog(_: AuditLogQuery) async throws -> [AuditLogRow] {
            if logUnavailable { throw AuditLogSubsystemUnavailable() }
            if logFails { throw StubError() }
            return rows
        }

        func loadCategories() async throws -> [String] {
            if categoriesFail { throw StubError() }
            return categories
        }

        func loadActions() async throws -> [String] {
            if actionsFail { throw StubError() }
            return actions
        }

        func verifyChain(limit: Int) async throws -> AuditChainVerify {
            if verifyFails { throw StubError() }
            return AuditChainVerify(
                intact: verifyResult.intact,
                firstBadID: verifyResult.firstBadID,
                rowsChecked: verifyResult.rowsChecked,
                since: verifyResult.since,
                limit: limit
            )
        }
    }

    private struct StubError: Error {}

    private func row(_ id: Int64, action: String = "login", success: Bool? = true) -> AuditLogRow {
        AuditLogRow(
            id: id,
            ts: "2026-06-13T17:42:09Z",
            actor: "admin@local",
            action: action,
            entityType: "session",
            success: success
        )
    }

    // MARK: - List states

    func testInitialStateIsLoading() {
        let model = AuditLogPageModel(dataSource: StubSource())
        XCTAssertEqual(model.state, .loading)
        XCTAssertFalse(model.isSubsystemUnavailable)
        XCTAssertTrue(model.rows.isEmpty)
        XCTAssertEqual(model.verifyState, .idle)
    }

    func testLoadSuccessPopulatesRowsAndDropdowns() async {
        let rows = [row(2), row(1)]
        let model = AuditLogPageModel(dataSource: StubSource(
            rows: rows,
            categories: ["auth", "config"],
            actions: ["login", "logout"]
        ))
        await model.load()
        XCTAssertEqual(model.state, .loaded(rows))
        XCTAssertEqual(model.rows.count, 2)
        XCTAssertEqual(model.categories, ["auth", "config"])
        XCTAssertEqual(model.actions, ["login", "logout"])
    }

    func testLoadEmptyYieldsEmptyState() async {
        let model = AuditLogPageModel(dataSource: StubSource())
        await model.load()
        XCTAssertEqual(model.state, .empty)
        XCTAssertTrue(model.rows.isEmpty)
    }

    func testLoad503YieldsUnavailableState() async {
        let model = AuditLogPageModel(dataSource: StubSource(logUnavailable: true))
        await model.load()
        XCTAssertEqual(model.state, .unavailable)
        XCTAssertTrue(model.isSubsystemUnavailable)
    }

    func testLoadFailureYieldsErrorState() async {
        let model = AuditLogPageModel(dataSource: StubSource(logFails: true))
        await model.load()
        guard case .error = model.state else {
            return XCTFail("expected error state, got \(model.state)")
        }
        XCTAssertFalse(model.isSubsystemUnavailable)
    }

    func testDropdownFailuresAreNonFatal() async {
        let model = AuditLogPageModel(dataSource: StubSource(
            rows: [row(1)],
            categoriesFail: true,
            actionsFail: true
        ))
        await model.load()
        XCTAssertEqual(model.state, .loaded([row(1)]))
        XCTAssertTrue(model.categories.isEmpty)
        XCTAssertTrue(model.actions.isEmpty)
    }

    // MARK: - Verify states

    func testVerifySuccessIntact() async {
        let model = AuditLogPageModel(dataSource: StubSource(
            verifyResult: AuditChainVerify(intact: true, firstBadID: 0, rowsChecked: 842, since: "", limit: 1000)
        ))
        await model.verify()
        guard case let .verified(result) = model.verifyState else {
            return XCTFail("expected verified state, got \(model.verifyState)")
        }
        XCTAssertTrue(result.intact)
        XCTAssertEqual(result.rowsChecked, 842)
        XCTAssertEqual(result.limit, AuditLogPageModel.verifyLimit)
    }

    func testVerifySuccessBroken() async {
        let model = AuditLogPageModel(dataSource: StubSource(
            verifyResult: AuditChainVerify(intact: false, firstBadID: 17, rowsChecked: 50, since: "", limit: 1000)
        ))
        await model.verify()
        guard case let .verified(result) = model.verifyState else {
            return XCTFail("expected verified state, got \(model.verifyState)")
        }
        XCTAssertFalse(result.intact)
        XCTAssertEqual(result.firstBadID, 17)
    }

    func testVerifyFailureYieldsFailedState() async {
        let model = AuditLogPageModel(dataSource: StubSource(verifyFails: true))
        await model.verify()
        guard case .failed = model.verifyState else {
            return XCTFail("expected failed state, got \(model.verifyState)")
        }
    }

    // MARK: - Pagination (web prev/next + page-info)

    func testPaginationAdvancesAndRetreatsOffset() async {
        let rows = [row(1), row(2)]
        let model = AuditLogPageModel(dataSource: StubSource(rows: rows))
        model.limit = 2
        await model.load()
        XCTAssertEqual(model.offset, 0)
        XCTAssertFalse(model.canGoPrev)
        XCTAssertTrue(model.canGoNext) // rows.count (2) >= limit (2)
        XCTAssertEqual(model.pageFrom, 1)
        XCTAssertEqual(model.pageTo, 2)

        await model.nextPage()
        XCTAssertEqual(model.offset, 2)
        XCTAssertTrue(model.canGoPrev)
        XCTAssertEqual(model.pageFrom, 3)
        XCTAssertEqual(model.pageTo, 4)

        await model.prevPage()
        XCTAssertEqual(model.offset, 0)
    }

    func testNextDisabledWhenFewerRowsThanLimit() async {
        let model = AuditLogPageModel(dataSource: StubSource(rows: [row(1)]))
        model.limit = 100
        await model.load()
        XCTAssertFalse(model.canGoNext) // 1 < 100
    }

    func testPageFromIsZeroWhenEmpty() async {
        let model = AuditLogPageModel(dataSource: StubSource())
        await model.load()
        XCTAssertEqual(model.pageFrom, 0)
        XCTAssertEqual(model.pageTo, 0)
    }

    func testApplyFiltersResetsOffset() async {
        let model = AuditLogPageModel(dataSource: StubSource(rows: [row(1), row(2)]))
        model.limit = 2
        await model.load()
        await model.nextPage()
        XCTAssertEqual(model.offset, 2)
        await model.applyFilters()
        XCTAssertEqual(model.offset, 0)
    }

    // MARK: - Filters + query building (web `queryParams` + `buildAuditLogQuery`)

    func testCurrentQueryReflectsFilters() {
        let model = AuditLogPageModel(dataSource: StubSource())
        model.category = "auth"
        model.action = "login"
        model.actor = "admin@local"
        model.entityType = "session"
        model.limit = 250
        let query = model.currentQuery
        XCTAssertEqual(query.categories, ["auth"])
        XCTAssertEqual(query.actions, ["login"])
        XCTAssertEqual(query.actors, ["admin@local"])
        XCTAssertEqual(query.entityType, "session")
        XCTAssertEqual(query.limit, 250)
        XCTAssertNil(query.since)
        XCTAssertNil(query.until)
    }

    func testCurrentQueryIncludesEnabledDates() {
        let model = AuditLogPageModel(dataSource: StubSource())
        model.sinceEnabled = true
        model.since = Date(timeIntervalSince1970: 1_700_000_000)
        XCTAssertNotNil(model.currentQuery.since)
        model.sinceEnabled = false
        XCTAssertNil(model.currentQuery.since)
    }

    func testResetFiltersClearsEverything() async {
        let model = AuditLogPageModel(dataSource: StubSource(rows: [row(1)]))
        model.category = "auth"
        model.actor = "x"
        model.entityType = "vehicle"
        model.sinceEnabled = true
        await model.resetFilters()
        XCTAssertEqual(model.category, "")
        XCTAssertEqual(model.actor, "")
        XCTAssertEqual(model.entityType, "")
        XCTAssertFalse(model.sinceEnabled)
        XCTAssertEqual(model.offset, 0)
    }

    func testQueryStringIsSnakeCaseAndOmitsEmpties() {
        let query = AuditLogQuery(
            since: "2026-06-01T00:00:00Z",
            categories: ["auth", "config"],
            actors: ["admin@local"],
            entityType: "alert_rule",
            limit: 100,
            offset: 200
        )
        let qs = query.queryString
        XCTAssertTrue(qs.contains("since=2026-06-01T00:00:00Z"))
        XCTAssertTrue(qs.contains("categories=auth,config"))
        XCTAssertTrue(qs.contains("actors=admin@local"))
        XCTAssertTrue(qs.contains("entity_type=alert_rule"))
        XCTAssertTrue(qs.contains("limit=100"))
        XCTAssertTrue(qs.contains("offset=200"))
        XCTAssertFalse(qs.contains("until="))
        XCTAssertFalse(qs.contains("actions="))
    }

    // MARK: - Expansion

    func testToggleExpanded() {
        let model = AuditLogPageModel(dataSource: StubSource())
        XCTAssertFalse(model.isExpanded(7))
        model.toggleExpanded(7)
        XCTAssertTrue(model.isExpanded(7))
        model.toggleExpanded(7)
        XCTAssertFalse(model.isExpanded(7))
    }
}

/// Pure display-formatter + badge + seed tests (split into an extension so the primary
/// `XCTestCase` body stays within the lint budget).
extension AuditLogPageModelTests {
    // MARK: - Formatters (web `formatDateTime` / `formatRelative` / `formatJSON`)

    func testDateTimeFormatsValidAndFallsBack() {
        XCTAssertEqual(AuditLogFormat.dateTime(nil), "—")
        XCTAssertEqual(AuditLogFormat.dateTime("not-a-date"), "—")
        XCTAssertNotEqual(AuditLogFormat.dateTime("2026-06-13T17:42:09Z"), "—")
    }

    func testRelativeBuckets() {
        let base = "2026-06-01T00:00:00Z"
        guard let date = AuditLogFormat.parseISO(base) else { return XCTFail("parse") }
        XCTAssertEqual(AuditLogFormat.relative(base, now: date.addingTimeInterval(30)), "just now")
        XCTAssertEqual(AuditLogFormat.relative(base, now: date.addingTimeInterval(5 * 60)), "5m ago")
        XCTAssertEqual(AuditLogFormat.relative(base, now: date.addingTimeInterval(2 * 3600)), "2h ago")
        XCTAssertEqual(AuditLogFormat.relative(base, now: date.addingTimeInterval(3 * 86400)), "3d ago")
        // Beyond a week falls back to an absolute date (not a relative phrase).
        let absolute = AuditLogFormat.relative(base, now: date.addingTimeInterval(10 * 86400))
        XCTAssertFalse(absolute.hasSuffix("ago"))
        XCTAssertNotEqual(absolute, "—")
    }

    func testRelativeFallbackForNil() {
        XCTAssertEqual(AuditLogFormat.relative(nil), "—")
    }

    func testPrettyJSONParsesAndFallsBack() {
        let pretty = AuditLogFormat.prettyJSON("{\"b\":1,\"a\":2}")
        XCTAssertTrue(pretty.contains("\"a\""))
        XCTAssertTrue(pretty.contains("\"b\""))
        XCTAssertTrue(pretty.contains("\n"))
        XCTAssertEqual(AuditLogFormat.prettyJSON("not json"), "not json")
        XCTAssertEqual(AuditLogFormat.prettyJSON(nil), "—")
    }

    // MARK: - Success badge (web `Fail` / `OK` / `—`)

    func testSuccessBadgeToneAndLabel() {
        XCTAssertEqual(AuditSuccessBadge.label(true), "OK")
        XCTAssertEqual(AuditSuccessBadge.label(false), "Fail")
        XCTAssertEqual(AuditSuccessBadge.label(nil), "—")
        XCTAssertEqual(AuditSuccessBadge.tone(true), .success)
        XCTAssertEqual(AuditSuccessBadge.tone(false), .danger)
        XCTAssertEqual(AuditSuccessBadge.tone(nil), .neutral)
    }

    func testShortTrace() {
        XCTAssertEqual(AuditLogEntriesTable.shortTrace("9f2c1ab47e3d5081bc66aa1290ffee31"), "9f2c1ab4…")
    }

    // MARK: - Default seed

    func testSampleDataSourceIsNonEmptyAndFilters() async throws {
        let source = SampleAuditLogDataSource()
        let all = try await source.loadLog(AuditLogQuery())
        XCTAssertFalse(all.isEmpty)
        XCTAssertEqual(Set(all.map(\.id)).count, all.count, "row ids are unique")
        let filtered = try await source.loadLog(AuditLogQuery(actions: ["login"]))
        XCTAssertTrue(filtered.allSatisfy { $0.action == "login" })
        await XCTAssertFalse(try source.loadCategories().isEmpty)
        await XCTAssertFalse(try source.loadActions().isEmpty)
    }
}
