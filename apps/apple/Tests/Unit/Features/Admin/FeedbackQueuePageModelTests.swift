import XCTest
@testable import TeslaSync

/// State-machine tests for `FeedbackQueuePageModel` — every data state the page renders
/// (loading / empty / error / success), pagination + the filter query (web `buildQuery`
/// snake_case contract), the inline update body (`PATCH /admin/feedback/{id}`), the
/// GitHub-bridge flag, row expansion, and the display-boundary formatters ported from
/// the web (`formatDateTime` / `JSON.stringify`).
@MainActor final class FeedbackQueuePageModelTests: XCTestCase {
    private final class StubSource: FeedbackQueueDataSource, @unchecked Sendable {
        var result: FeedbackListResult
        var loadFails = false
        var updateFails = false
        private(set) var lastQuery: FeedbackQuery?
        private(set) var lastUpdate: (id: Int64, update: FeedbackUpdate)?

        init(result: FeedbackListResult) {
            self.result = result
        }

        func loadFeedback(_ query: FeedbackQuery) async throws -> FeedbackListResult {
            lastQuery = query
            if loadFails { throw StubError() }
            return result
        }

        func updateFeedback(id: Int64, update: FeedbackUpdate) async throws -> FeedbackEntry {
            lastUpdate = (id, update)
            if updateFails { throw StubError() }
            return SampleFeedbackQueueDataSource.seed[0]
        }
    }

    private struct StubError: Error {}

    private func entry(_ id: Int64, status: FeedbackStatus = .new, category: FeedbackCategory = .bug) -> FeedbackEntry {
        FeedbackEntry(id: id, createdAt: "2026-06-13T17:42:09Z", category: category, title: "t\(id)", status: status)
    }

    private func result(
        _ items: [FeedbackEntry],
        total: Int,
        bridge: Bool = true,
        repo: String? = "ev-dev-labs/teslasync"
    ) -> FeedbackListResult {
        FeedbackListResult(
            items: items,
            total: total,
            limit: FeedbackQueuePageModel.pageSize,
            offset: 0,
            githubBridgeEnabled: bridge,
            githubRepo: repo
        )
    }

    // MARK: - List states

    func testInitialStateIsLoading() {
        let model = FeedbackQueuePageModel(dataSource: StubSource(result: result([], total: 0)))
        XCTAssertEqual(model.state, .loading)
        XCTAssertTrue(model.items.isEmpty)
        XCTAssertFalse(model.isUpdating)
        XCTAssertFalse(model.isRefreshing)
    }

    func testLoadSuccessPopulatesRowsTotalAndBridge() async {
        let rows = [entry(2), entry(1)]
        let model = FeedbackQueuePageModel(dataSource: StubSource(result: result(rows, total: 2, bridge: true)))
        await model.load()
        XCTAssertEqual(model.state, .loaded(rows))
        XCTAssertEqual(model.items.count, 2)
        XCTAssertEqual(model.total, 2)
        XCTAssertTrue(model.bridgeEnabled)
        XCTAssertEqual(model.githubRepo, "ev-dev-labs/teslasync")
    }

    func testLoadEmptyYieldsEmptyState() async {
        let model = FeedbackQueuePageModel(dataSource: StubSource(result: result([], total: 0)))
        await model.load()
        XCTAssertEqual(model.state, .empty)
        XCTAssertTrue(model.items.isEmpty)
    }

    func testLoadFailureYieldsErrorState() async {
        let stub = StubSource(result: result([], total: 0))
        stub.loadFails = true
        let model = FeedbackQueuePageModel(dataSource: stub)
        await model.load()
        guard case .error = model.state else {
            return XCTFail("expected error state, got \(model.state)")
        }
    }

    func testBridgeDisabledFlagPropagates() async {
        let model = FeedbackQueuePageModel(
            dataSource: StubSource(result: result([entry(1)], total: 1, bridge: false, repo: nil))
        )
        await model.load()
        XCTAssertFalse(model.bridgeEnabled)
        XCTAssertNil(model.githubRepo)
    }

    // MARK: - Pagination (web PAGE_SIZE + prev/next + page-of)

    func testPaginationAdvancesAndRetreats() async {
        // total 60 over a 25-row page = 3 pages.
        let model = FeedbackQueuePageModel(dataSource: StubSource(result: result([entry(1)], total: 60)))
        await model.load()
        XCTAssertEqual(model.page, 0)
        XCTAssertEqual(model.totalPages, 3)
        XCTAssertFalse(model.canGoPrev)
        XCTAssertTrue(model.canGoNext)

        await model.nextPage()
        XCTAssertEqual(model.page, 1)
        XCTAssertTrue(model.canGoPrev)
        XCTAssertTrue(model.canGoNext)

        await model.nextPage()
        XCTAssertEqual(model.page, 2)
        XCTAssertFalse(model.canGoNext) // page+1 (3) is not < totalPages (3)

        await model.prevPage()
        XCTAssertEqual(model.page, 1)
    }

    func testSinglePageHasNoNavigation() async {
        let model = FeedbackQueuePageModel(dataSource: StubSource(result: result([entry(1)], total: 10)))
        await model.load()
        XCTAssertEqual(model.totalPages, 1)
        XCTAssertFalse(model.canGoPrev)
        XCTAssertFalse(model.canGoNext)
    }

    func testFilterChangeResetsPageAndQuery() async {
        let stub = StubSource(result: result([entry(1)], total: 60))
        let model = FeedbackQueuePageModel(dataSource: stub)
        await model.load()
        await model.nextPage()
        XCTAssertEqual(model.page, 1)

        model.statusFilter = .triaged
        model.categoryFilter = .feature
        await model.onFilterChanged()
        XCTAssertEqual(model.page, 0)
        XCTAssertEqual(stub.lastQuery?.status, .triaged)
        XCTAssertEqual(stub.lastQuery?.category, .feature)
        XCTAssertEqual(stub.lastQuery?.offset, 0)
    }

    func testCurrentQueryReflectsPageOffset() async {
        let model = FeedbackQueuePageModel(dataSource: StubSource(result: result([entry(1)], total: 60)))
        await model.load()
        await model.nextPage()
        XCTAssertEqual(model.currentQuery.offset, FeedbackQueuePageModel.pageSize)
        XCTAssertEqual(model.currentQuery.limit, FeedbackQueuePageModel.pageSize)
    }

    // MARK: - Inline update (web update.mutate → PATCH)

    func testApplyUpdatePostsAndReloads() async {
        let stub = StubSource(result: result([entry(1, status: .new)], total: 1))
        let model = FeedbackQueuePageModel(dataSource: stub)
        await model.load()
        await model.applyUpdate(id: 1, update: FeedbackUpdate(status: .triaged))
        XCTAssertEqual(stub.lastUpdate?.id, 1)
        XCTAssertEqual(stub.lastUpdate?.update.status, .triaged)
        XCTAssertFalse(model.isUpdating) // cleared after the await
    }

    func testApplyUpdateFailureKeepsListAndSetsError() async {
        let stub = StubSource(result: result([entry(1)], total: 1))
        stub.updateFails = true
        let model = FeedbackQueuePageModel(dataSource: stub)
        await model.load()
        await model.applyUpdate(id: 1, update: FeedbackUpdate(forwardToGitHub: true))
        // Web mutation error is a toast — the list stays rendered, not replaced.
        XCTAssertEqual(model.state, .loaded([entry(1)]))
        XCTAssertNotNil(model.updateError)
        model.dismissUpdateError()
        XCTAssertNil(model.updateError)
    }

    // MARK: - Expansion

    func testToggleExpanded() {
        let model = FeedbackQueuePageModel(dataSource: StubSource(result: result([], total: 0)))
        XCTAssertFalse(model.isExpanded(7))
        model.toggleExpanded(7)
        XCTAssertTrue(model.isExpanded(7))
        model.toggleExpanded(7)
        XCTAssertFalse(model.isExpanded(7))
    }
}

/// Pure query / body / formatter / badge / seed tests (split into an extension so the
/// primary `XCTestCase` body stays within the lint budget).
extension FeedbackQueuePageModelTests {
    // MARK: - Query + update body (web `buildQuery` + PATCH body — snake_case)

    func testQueryStringIsSnakeCaseAndAlwaysCarriesWindow() {
        let query = FeedbackQuery(status: .new, category: .bug, limit: 25, offset: 50)
        let qs = query.queryString
        XCTAssertTrue(qs.contains("status=new"))
        XCTAssertTrue(qs.contains("category=bug"))
        XCTAssertTrue(qs.contains("limit=25"))
        XCTAssertTrue(qs.contains("offset=50"))
    }

    func testQueryStringOmitsEmptyFilters() {
        let qs = FeedbackQuery(limit: 25, offset: 0).queryString
        XCTAssertFalse(qs.contains("status="))
        XCTAssertFalse(qs.contains("category="))
        XCTAssertTrue(qs.contains("limit=25"))
    }

    private func encodedBody(_ update: FeedbackUpdate) throws -> String {
        try String(bytes: JSONEncoder().encode(update), encoding: .utf8) ?? ""
    }

    func testUpdateBodyIsSnakeCaseSparseAndBooleanTyped() throws {
        XCTAssertTrue(try encodedBody(FeedbackUpdate(status: .closed)).contains("\"status\":\"closed\""))
        XCTAssertTrue(try encodedBody(FeedbackUpdate(githubIssueURL: "x")).contains("\"github_issue_url\":\"x\""))
        // forward_to_github must be a JSON boolean, not the string "true" (backend bool).
        let forward = try encodedBody(FeedbackUpdate(forwardToGitHub: true))
        XCTAssertTrue(forward.contains("\"forward_to_github\":true"))
        XCTAssertFalse(forward.contains("\"true\""))
        XCTAssertEqual(try encodedBody(FeedbackUpdate()), "{}")
    }

    // MARK: - Formatters (web formatDateTime / JSON.stringify)

    func testDateTimeFormatsValidAndFallsBack() {
        XCTAssertEqual(FeedbackQueueFormat.dateTime(nil), "—")
        XCTAssertEqual(FeedbackQueueFormat.dateTime(""), "—")
        XCTAssertEqual(FeedbackQueueFormat.dateTime("not-a-date"), "—")
        XCTAssertNotEqual(FeedbackQueueFormat.dateTime("2026-06-13T17:42:09Z"), "—")
    }

    func testPrettyJSONParsesArraysAndFallsBack() {
        let pretty = FeedbackQueueFormat.prettyJSON("[{\"b\":1,\"a\":2}]")
        XCTAssertTrue(pretty.contains("\"a\""))
        XCTAssertTrue(pretty.contains("\n"))
        XCTAssertEqual(FeedbackQueueFormat.prettyJSON("not json"), "not json")
        XCTAssertEqual(FeedbackQueueFormat.prettyJSON(nil), "—")
        XCTAssertEqual(FeedbackQueueFormat.prettyJSON(""), "—")
    }

    func testDashFallback() {
        XCTAssertEqual(FeedbackQueueFormat.dash(""), "—")
        XCTAssertEqual(FeedbackQueueFormat.dash("x"), "x")
    }

    func testPageOfFormatsAllTokens() {
        let text = FeedbackQueuePage.pageOfText(page: 2, totalPages: 5, count: 117)
        XCTAssertTrue(text.contains("2"))
        XCTAssertTrue(text.contains("5"))
        XCTAssertTrue(text.contains("117"))
    }

    // MARK: - Badge tone maps (web CategoryBadge / StatusBadge variants)

    func testBadgeTones() {
        XCTAssertEqual(FeedbackCategoryBadge.tone(.bug), .danger)
        XCTAssertEqual(FeedbackCategoryBadge.tone(.feature), .info)
        XCTAssertEqual(FeedbackCategoryBadge.tone(.other), .neutral)
        XCTAssertEqual(FeedbackStatusBadge.tone(.new), .warning)
        XCTAssertEqual(FeedbackStatusBadge.tone(.triaged), .success)
        XCTAssertEqual(FeedbackStatusBadge.tone(.closed), .neutral)
    }

    func testLabelKeysMatchWebNames() {
        XCTAssertEqual(FeedbackCategory.bug.labelKey, "feedback.category.bug")
        XCTAssertEqual(FeedbackStatus.triaged.labelKey, "feedback.queue.status.triaged")
    }

    // MARK: - Reporter identity (web UserCell mapping — email local-part, no IP)

    func testReporterDisplayMirrorsUserCell() {
        // Email present → local-part wins (web UserCell priority), never the full email.
        let withEmail = FeedbackEntry(
            id: 1, createdAt: "", category: .bug, userEmail: "casey.driver@example.com", status: .new,
            submitterSubject: "auth0|abc", submitterIP: "10.0.0.1"
        )
        XCTAssertEqual(FeedbackQueueTable.reporterDisplay(withEmail), "casey.driver")

        // No email → opaque subject is the fallback; IP is never surfaced.
        let subjectOnly = FeedbackEntry(
            id: 2, createdAt: "", category: .bug, status: .new,
            submitterSubject: "auth0|abc", submitterIP: "10.0.0.1"
        )
        XCTAssertEqual(FeedbackQueueTable.reporterDisplay(subjectOnly), "auth0|abc")

        // Neither → nil (rendered as the localized "Unknown user").
        let anon = FeedbackEntry(id: 3, createdAt: "", category: .bug, status: .new)
        XCTAssertNil(FeedbackQueueTable.reporterDisplay(anon))
    }

    // MARK: - Default seed

    func testSampleDataSourceFiltersAndPages() async throws {
        let source = SampleFeedbackQueueDataSource()
        let all = try await source.loadFeedback(FeedbackQuery())
        XCTAssertFalse(all.items.isEmpty)
        XCTAssertEqual(all.total, all.items.count)
        XCTAssertTrue(all.githubBridgeEnabled)

        let bugs = try await source.loadFeedback(FeedbackQuery(category: .bug))
        XCTAssertTrue(bugs.items.allSatisfy { $0.category == .bug })

        let firstPage = try await source.loadFeedback(FeedbackQuery(limit: 1, offset: 0))
        XCTAssertEqual(firstPage.items.count, 1)
        XCTAssertEqual(firstPage.total, all.total)

        let updated = try await source.updateFeedback(id: all.items[0].id, update: FeedbackUpdate(status: .closed))
        XCTAssertEqual(updated.status, .closed)
    }

    func testSampleBridgeDisabledVariant() async throws {
        let source = SampleFeedbackQueueDataSource(bridgeEnabled: false)
        let result = try await source.loadFeedback(FeedbackQuery())
        XCTAssertFalse(result.githubBridgeEnabled)
        XCTAssertNil(result.githubRepo)
    }
}
