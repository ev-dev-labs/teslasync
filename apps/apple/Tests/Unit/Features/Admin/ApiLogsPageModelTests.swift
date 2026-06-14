import XCTest
@testable import TeslaSync

/// State-machine tests for `ApiLogsPageModel` — every data state the page renders
/// (loading / empty / error / success), the independent stats feed, pagination + the
/// showing-range math (web `from`/`to`), filter query building (web `getAPICallLogs`
/// snake_case contract), and the display-boundary formatters / catalog interpolations
/// ported from the web `ApiLogsPage`.
@MainActor final class ApiLogsPageModelTests: XCTestCase {
    private struct StubSource: ApiLogsDataSource {
        var stats = ApiCallLogStats(totalCalls: 0, errorRate: 0, errorCount: 0, avgDurationMs: 0, last24h: 0)
        var page = ApiCallLogPage(logs: [], total: 0)
        var statsFails = false
        var logsFails = false

        func loadStats() async throws -> ApiCallLogStats {
            if statsFails { throw ApiLogsLoadFailure(detail: "stats down") }
            return stats
        }

        func loadLogs(_: ApiLogsQuery) async throws -> ApiCallLogPage {
            if logsFails { throw ApiLogsLoadFailure(detail: "logs down") }
            return page
        }
    }

    private func log(
        _ id: Int64,
        method: String = "GET",
        status: Int? = 200,
        service: String = "tesla-api"
    ) -> ApiCallLog {
        ApiCallLog(
            id: id,
            ts: "2026-06-13T17:42:09Z",
            service: service,
            httpMethod: method,
            endpoint: "/api/1/vehicles/\(id)",
            statusCode: status,
            durationMs: 120
        )
    }

    // MARK: - List + stats states

    func testInitialStateIsLoading() {
        let model = ApiLogsPageModel(dataSource: StubSource())
        XCTAssertEqual(model.listState, .loading)
        XCTAssertNil(model.stats)
        XCTAssertTrue(model.logs.isEmpty)
        XCTAssertNil(model.loadFailureDetail)
    }

    func testLoadSuccessPopulatesRowsAndStats() async {
        let rows = [log(2), log(1)]
        let stats = ApiCallLogStats(
            totalCalls: 1234,
            byService: ["tesla-api": 800, "teslasync-api": 434],
            errorRate: 4.2,
            errorCount: 52,
            avgDurationMs: 188,
            last24h: 96
        )
        let model = ApiLogsPageModel(dataSource: StubSource(stats: stats, page: ApiCallLogPage(logs: rows, total: 2)))
        await model.load()
        XCTAssertEqual(model.listState, .loaded(rows))
        XCTAssertEqual(model.logs.count, 2)
        XCTAssertEqual(model.total, 2)
        XCTAssertEqual(model.stats?.totalCalls, 1234)
        XCTAssertEqual(model.trackedServiceCount, 2)
        XCTAssertTrue(model.hasServiceBreakdown)
        XCTAssertNil(model.loadFailureDetail)
    }

    func testLoadEmptyYieldsEmptyState() async {
        let model = ApiLogsPageModel(dataSource: StubSource())
        await model.load()
        XCTAssertEqual(model.listState, .empty)
        XCTAssertTrue(model.logs.isEmpty)
    }

    func testLogsFailureYieldsErrorStateAndBannerDetail() async {
        let model = ApiLogsPageModel(dataSource: StubSource(logsFails: true))
        await model.load()
        guard case .error = model.listState else {
            return XCTFail("expected error state, got \(model.listState)")
        }
        XCTAssertEqual(model.loadFailureDetail, "logs down")
    }

    func testStatsFailureIsNonFatalToList() async {
        let model = ApiLogsPageModel(dataSource: StubSource(
            page: ApiCallLogPage(logs: [log(1)], total: 1),
            statsFails: true
        ))
        await model.load()
        XCTAssertEqual(model.listState, .loaded([log(1)]))
        XCTAssertNil(model.stats)
        XCTAssertEqual(model.loadFailureDetail, "stats down")
    }

    // MARK: - Pagination (web from/to + prev/next guards)

    func testPaginationRangeAndGuards() async {
        let rows = (1 ... 25).map { log(Int64($0)) }
        let model = ApiLogsPageModel(dataSource: StubSource(page: ApiCallLogPage(logs: rows, total: 60)))
        await model.load()
        XCTAssertEqual(model.page, 0)
        XCTAssertEqual(model.totalPages, 3) // ceil(60/25)
        XCTAssertEqual(model.pageFrom, 1)
        XCTAssertEqual(model.pageTo, 25)
        XCTAssertFalse(model.canGoPrev)
        XCTAssertTrue(model.canGoNext)
        XCTAssertTrue(model.showsPagination)

        await model.nextPage()
        XCTAssertEqual(model.page, 1)
        XCTAssertEqual(model.pageFrom, 26)
        XCTAssertEqual(model.pageTo, 50)
        XCTAssertTrue(model.canGoPrev)

        await model.prevPage()
        XCTAssertEqual(model.page, 0)
    }

    func testPageToClampsToTotal() async {
        let rows = (1 ... 10).map { log(Int64($0)) }
        let model = ApiLogsPageModel(dataSource: StubSource(page: ApiCallLogPage(logs: rows, total: 10)))
        await model.load()
        XCTAssertEqual(model.totalPages, 1)
        XCTAssertFalse(model.showsPagination)
        XCTAssertEqual(model.pageTo, 10)
        XCTAssertFalse(model.canGoNext)
    }

    // MARK: - Filters + query (web setFilter + getAPICallLogs)

    func testApplyFiltersResetsPageAndReloads() async {
        let rows = (1 ... 25).map { log(Int64($0)) }
        let model = ApiLogsPageModel(dataSource: StubSource(page: ApiCallLogPage(logs: rows, total: 60)))
        await model.load()
        await model.nextPage()
        XCTAssertEqual(model.page, 1)
        model.method = "POST"
        await model.applyFilters()
        XCTAssertEqual(model.page, 0)
    }

    func testHasFiltersIgnoresDateRange() {
        let model = ApiLogsPageModel(dataSource: StubSource())
        XCTAssertFalse(model.hasFilters)
        model.startEnabled = true
        XCTAssertFalse(model.hasFilters) // range is excluded from hasFilters
        model.service = "tesla-api"
        XCTAssertTrue(model.hasFilters)
    }

    func testClearFiltersResetsEverything() async {
        let model = ApiLogsPageModel(dataSource: StubSource(page: ApiCallLogPage(logs: [log(1)], total: 1)))
        model.service = "tesla-api"
        model.method = "POST"
        model.status = "4xx"
        model.endpoint = "/vehicles"
        await model.clearFilters()
        XCTAssertTrue(model.service.isEmpty)
        XCTAssertTrue(model.method.isEmpty)
        XCTAssertTrue(model.status.isEmpty)
        XCTAssertTrue(model.endpoint.isEmpty)
        XCTAssertEqual(model.page, 0)
        XCTAssertFalse(model.hasFilters)
    }

    func testSelectServiceSetsFilterAndPageZero() async {
        let rows = (1 ... 25).map { log(Int64($0)) }
        let model = ApiLogsPageModel(dataSource: StubSource(page: ApiCallLogPage(logs: rows, total: 60)))
        await model.load()
        await model.nextPage()
        await model.selectService("geocoder-google")
        XCTAssertEqual(model.service, "geocoder-google")
        XCTAssertEqual(model.page, 0)
    }

    func testCurrentQueryMapsFiltersAndPage() {
        let model = ApiLogsPageModel(dataSource: StubSource())
        model.method = "POST"
        model.status = "5xx"
        model.endpoint = "/hooks"
        model.service = "notify-generic"
        let query = model.currentQuery
        XCTAssertEqual(query.limit, ApiLogsPageModel.limit)
        XCTAssertEqual(query.offset, 0)
        XCTAssertEqual(query.method, "POST")
        XCTAssertEqual(query.status, "5xx")
        XCTAssertEqual(query.endpoint, "/hooks")
        XCTAssertEqual(query.service, "notify-generic")
        XCTAssertNil(query.start)
        XCTAssertNil(query.end)
    }

    func testCurrentQueryIncludesEnabledDates() {
        let model = ApiLogsPageModel(dataSource: StubSource())
        XCTAssertNil(model.currentQuery.start)
        model.startEnabled = true
        model.start = Date(timeIntervalSince1970: 1_700_000_000)
        XCTAssertNotNil(model.currentQuery.start)
    }

    func testQueryStringIsSnakeCaseAndOmitsEmpties() {
        let query = ApiLogsQuery(
            limit: 25,
            offset: 50,
            method: "GET",
            status: "2xx",
            endpoint: "/v",
            service: "tesla-api"
        )
        let qs = query.queryString
        XCTAssertTrue(qs.contains("limit=25"))
        XCTAssertTrue(qs.contains("offset=50"))
        XCTAssertTrue(qs.contains("method=GET"))
        XCTAssertTrue(qs.contains("status=2xx"))
        XCTAssertTrue(qs.contains("endpoint=/v"))
        XCTAssertTrue(qs.contains("service=tesla-api"))
        XCTAssertFalse(qs.contains("start="))
        XCTAssertFalse(qs.contains("end="))
    }

    // MARK: - Expansion (web expandedId toggle)

    func testToggleExpanded() {
        let model = ApiLogsPageModel(dataSource: StubSource())
        XCTAssertFalse(model.isExpanded(7))
        model.toggleExpanded(7)
        XCTAssertTrue(model.isExpanded(7))
        model.toggleExpanded(7)
        XCTAssertFalse(model.isExpanded(7))
    }
}

/// Pure formatter / catalog-interpolation / badge / sample tests (split into an extension so
/// the primary `XCTestCase` body stays within the lint budget).
extension ApiLogsPageModelTests {
    // MARK: - Formatters (web numberFormat / DateTime / JsonViewer)

    func testIntGroupsThousands() {
        XCTAssertEqual(ApiLogsFormat.int(1234), "1,234")
        XCTAssertEqual(ApiLogsFormat.int(0), "0")
    }

    func testPercentAndDuration() {
        XCTAssertEqual(ApiLogsFormat.percent(4.2), "4.2%")
        XCTAssertEqual(ApiLogsFormat.durationMs(1234), "1,234ms")
        XCTAssertEqual(ApiLogsFormat.rowDurationMs(188), "188ms")
    }

    func testDateTimeFormatsUTCAndFallsBack() {
        XCTAssertEqual(ApiLogsFormat.dateTime(nil), "—")
        XCTAssertEqual(ApiLogsFormat.dateTime("not-a-date"), "—")
        // 17:42 UTC renders as 5:42 PM (UTC), not shifted to a local zone.
        XCTAssertEqual(ApiLogsFormat.dateTime("2026-06-13T17:42:09Z"), "Jun 13, 2026, 5:42 PM")
    }

    func testPrettyJSONParsesAndFallsBack() {
        let pretty = ApiLogsFormat.prettyJSON("{\"b\":1,\"a\":2}")
        XCTAssertTrue(pretty.contains("\"a\""))
        XCTAssertTrue(pretty.contains("\n"))
        XCTAssertEqual(ApiLogsFormat.prettyJSON("not json"), "not json")
        XCTAssertEqual(ApiLogsFormat.prettyJSON(nil), "—")
    }

    func testInterpolateReplacesTokens() {
        let result = ApiLogsFormat.interpolate("Showing {{from}}–{{to}} of {{total}}", [
            "from": "1", "to": "25", "total": "1,234"
        ])
        XCTAssertEqual(result, "Showing 1–25 of 1,234")
    }

    func testExportJSONEmitsSnakeCaseArray() {
        let json = ApiLogsFormat.exportJSON([log(1, method: "POST", status: 500, service: "notify-generic")])
        XCTAssertTrue(json.contains("\"http_method\""))
        XCTAssertTrue(json.contains("\"status_code\""))
        XCTAssertTrue(json.contains("\"endpoint\""))
        XCTAssertTrue(json.hasPrefix("["))
    }

    func testExportJSONEmptyIsEmptyArray() {
        XCTAssertEqual(ApiLogsFormat.exportJSON([]), "[]")
    }

    // MARK: - Service / method / status presentation (web SERVICE_CONFIG + variant maps)

    func testServiceConfigFallsBackToRawId() {
        XCTAssertEqual(ApiLogsServiceCatalog.service("tesla-api").label, "Tesla API")
        XCTAssertEqual(ApiLogsServiceCatalog.service("unknown-svc").label, "unknown-svc")
        XCTAssertEqual(ApiLogsServiceCatalog.service("unknown-svc").tone, .neutral)
        XCTAssertEqual(ApiLogsServiceCatalog.knownServices.count, 11)
    }

    func testMethodAndStatusTones() {
        XCTAssertEqual(ApiLogsServiceCatalog.methodTone("GET"), .success)
        XCTAssertEqual(ApiLogsServiceCatalog.methodTone("DELETE"), .danger)
        XCTAssertEqual(ApiLogsServiceCatalog.methodTone("WEIRD"), .neutral)
        XCTAssertEqual(ApiLogsServiceCatalog.statusTone(204), .success)
        XCTAssertEqual(ApiLogsServiceCatalog.statusTone(301), .info)
        XCTAssertEqual(ApiLogsServiceCatalog.statusTone(404), .warning)
        XCTAssertEqual(ApiLogsServiceCatalog.statusTone(500), .danger)
        XCTAssertEqual(ApiLogsServiceCatalog.statusTone(nil), .neutral)
    }

    func testStatusBadgeLabel() {
        XCTAssertEqual(ApiLogsStatusBadge.label(200), "200")
        XCTAssertEqual(ApiLogsStatusBadge.label(nil), "N/A")
    }

    func testServiceOptionsUnionAndHead() {
        let options = ApiLogsServiceCatalog.serviceOptions(
            byService: ["brand-new-svc": 3],
            activeService: "",
            allLabel: "All Services"
        )
        XCTAssertEqual(options.first?.value, "")
        XCTAssertEqual(options.first?.label, "All Services")
        XCTAssertTrue(options.contains { $0.value == "brand-new-svc" }) // live key appears
        XCTAssertTrue(options.contains { $0.value == "tesla-api" }) // known catalog key appears
    }

    // MARK: - Default seed

    func testSampleDataSourceFiltersAndPaginates() async throws {
        let source = SampleApiLogsDataSource()
        let stats = try await source.loadStats()
        XCTAssertGreaterThan(stats.totalCalls, 0)
        XCTAssertFalse(stats.byService.isEmpty)

        let all = try await source.loadLogs(ApiLogsQuery())
        XCTAssertFalse(all.logs.isEmpty)
        XCTAssertEqual(all.total, all.logs.count)

        let posts = try await source.loadLogs(ApiLogsQuery(method: "POST"))
        XCTAssertTrue(posts.logs.allSatisfy { $0.httpMethod == "POST" })

        let serverErrors = try await source.loadLogs(ApiLogsQuery(status: "5xx"))
        XCTAssertTrue(serverErrors.logs.allSatisfy { ($0.statusCode ?? 0) / 100 == 5 })
    }
}
