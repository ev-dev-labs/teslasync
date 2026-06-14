import SwiftUI
import XCTest
@testable import TeslaSync

/// State-machine tests for `SlowQueriesPageModel` — every data state the page renders
/// (loading / empty / unavailable / error / loaded), the order-by + limit re-query
/// (web `useSlowQueries(orderBy, limit)`), the keep-rows-while-reloading behaviour, and
/// the pure display logic ported from the web (`fmtNumber` / `cacheHitRatio` / the
/// fingerprint em-dash fallback / the sample-source sort+truncate). Mirrors the sibling
/// `DiskForecastPageModelTests` / `RbacMatrixPageModelTests`.
@MainActor final class SlowQueriesPageModelTests: XCTestCase {
    private struct StubError: Error {}

    private enum StubMode { case success, unavailable, failure }

    private actor StubSource: SlowQueriesDataSource {
        private let rows: [SlowQueryRow]
        private let mode: StubMode
        private(set) var calls: [(orderBy: SlowQueryOrderBy, limit: Int)] = []

        init(rows: [SlowQueryRow] = [], mode: StubMode = .success) {
            self.rows = rows
            self.mode = mode
        }

        func load(orderBy: SlowQueryOrderBy, limit: Int) async throws -> SlowQueriesResult {
            calls.append((orderBy, limit))
            switch mode {
            case .unavailable: throw SlowQueriesSubsystemUnavailable()
            case .failure: throw StubError()
            case .success: return SlowQueriesResult(orderBy: orderBy, rows: rows)
            }
        }
    }

    private static func row(
        id: Int64 = 1,
        fingerprint: String = "SELECT 1",
        calls: Int64 = 100,
        total: Double = 1000,
        mean: Double = 10,
        max: Double = 50,
        rows: Int64 = 100,
        hit: Int64? = 900,
        read: Int64? = 100
    ) -> SlowQueryRow {
        SlowQueryRow(
            queryID: id,
            fingerprint: fingerprint,
            calls: calls,
            totalTimeMs: total,
            meanTimeMs: mean,
            maxTimeMs: max,
            rowsReturned: rows,
            sharedBlksHit: hit,
            sharedBlksRead: read
        )
    }

    // MARK: - Data states

    func testInitialStateIsLoading() {
        let model = SlowQueriesPageModel(dataSource: StubSource())
        XCTAssertEqual(model.state, .loading)
        XCTAssertEqual(model.orderBy, .meanTime)
        XCTAssertEqual(model.limit, 25)
        XCTAssertTrue(model.rows.isEmpty)
    }

    func testLoadSuccessYieldsLoaded() async {
        let model = SlowQueriesPageModel(dataSource: StubSource(rows: [Self.row()]))
        await model.load()
        guard case let .loaded(rows) = model.state else { return XCTFail("expected loaded") }
        XCTAssertEqual(rows.count, 1)
        XCTAssertFalse(model.isSubsystemUnavailable)
    }

    func testLoadEmptyYieldsEmpty() async {
        let model = SlowQueriesPageModel(dataSource: StubSource(rows: []))
        await model.load()
        XCTAssertEqual(model.state, .empty)
        XCTAssertTrue(model.rows.isEmpty)
    }

    func testLoadSubsystemUnavailableYieldsUnavailable() async {
        let model = SlowQueriesPageModel(dataSource: StubSource(mode: .unavailable))
        await model.load()
        XCTAssertEqual(model.state, .unavailable)
        XCTAssertTrue(model.isSubsystemUnavailable)
    }

    func testLoadFailureYieldsError() async {
        let model = SlowQueriesPageModel(dataSource: StubSource(mode: .failure))
        await model.load()
        guard case .error = model.state else { return XCTFail("expected error") }
    }

    // MARK: - Re-query on control change

    func testReloadPassesUpdatedOrderByAndLimit() async {
        let source = StubSource(rows: [Self.row()])
        let model = SlowQueriesPageModel(dataSource: source)
        await model.load()
        model.orderBy = .totalTime
        model.limit = 50
        await model.reload()
        let calls = await source.calls
        XCTAssertEqual(calls.count, 2)
        XCTAssertEqual(calls.first?.orderBy, .meanTime)
        XCTAssertEqual(calls.first?.limit, 25)
        XCTAssertEqual(calls.last?.orderBy, .totalTime)
        XCTAssertEqual(calls.last?.limit, 50)
    }

    func testReloadKeepsLoadedStateWithNewRows() async {
        let source = StubSource(rows: [Self.row(id: 1), Self.row(id: 2)])
        let model = SlowQueriesPageModel(dataSource: source)
        await model.load()
        await model.reload()
        guard case let .loaded(rows) = model.state else { return XCTFail("expected loaded") }
        XCTAssertEqual(rows.count, 2)
    }

    func testLimitOptionsMatchWeb() {
        XCTAssertEqual(SlowQueriesPageModel.limitOptions, [10, 25, 50, 100])
    }

    func testOrderByCasesMatchWebOptionsAndOrder() {
        XCTAssertEqual(SlowQueryOrderBy.allCases, [.meanTime, .totalTime, .calls, .maxTime])
        XCTAssertEqual(SlowQueryOrderBy.meanTime.rawValue, "mean_time")
        XCTAssertEqual(SlowQueryOrderBy.totalTime.rawValue, "total_time")
        XCTAssertEqual(SlowQueryOrderBy.calls.rawValue, "calls")
        XCTAssertEqual(SlowQueryOrderBy.maxTime.rawValue, "max_time")
        XCTAssertEqual(SlowQueryOrderBy(wire: "nonsense"), .meanTime)
    }
}

/// Pure display-logic tests (split into an extension so the primary `XCTestCase` body
/// stays within the lint budget).
extension SlowQueriesPageModelTests {
    func testCacheHitRatioComputesPercentToOneDecimal() {
        let row = Self.row(hit: 900, read: 100)
        XCTAssertEqual(row.cacheHitRatioText, "90.0%")
    }

    func testCacheHitRatioIsEmDashWhenNoBufferAccess() {
        let row = Self.row(hit: nil, read: nil)
        XCTAssertEqual(row.cacheHitRatioText, "—")
    }

    func testCacheHitRatioTreatsNilHitAsZero() {
        let row = Self.row(hit: nil, read: 50)
        XCTAssertEqual(row.cacheHitRatioText, "0.0%")
    }

    func testFingerprintTextFallsBackToEmDashWhenEmpty() {
        XCTAssertEqual(Self.row(fingerprint: "").fingerprintText, "—")
        XCTAssertEqual(Self.row(fingerprint: "SELECT 1").fingerprintText, "SELECT 1")
    }

    func testNumberFormatterGroupsAndFixesPrecision() {
        XCTAssertEqual(SlowQueriesFormat.number(Int64(184_233)), "184,233.00")
        XCTAssertEqual(SlowQueriesFormat.number(6.97, decimals: 2), "6.97")
        XCTAssertEqual(SlowQueriesFormat.number(1_284_551.4, decimals: 0), "1,284,551")
        XCTAssertEqual(SlowQueriesFormat.percent(0), "0.0%")
    }

    func testRowCellTextsMatchWebFmtNumber() {
        let row = Self.row(calls: 184_233, total: 1_284_551.4, mean: 6.97, max: 412.55, rows: 9_211_650)
        XCTAssertEqual(row.callsText, "184,233.00")
        XCTAssertEqual(row.meanText, "6.97")
        XCTAssertEqual(row.maxText, "412.55")
        XCTAssertEqual(row.totalText, "1,284,551")
        XCTAssertEqual(row.rowsText, "9,211,650.00")
    }

    func testSampleSourceSortsByKeyAndTruncatesToLimit() async throws {
        let source = SampleSlowQueriesDataSource()
        let byTotal = try await source.load(orderBy: .totalTime, limit: 3)
        XCTAssertEqual(byTotal.rows.count, 3)
        XCTAssertEqual(byTotal.orderBy, .totalTime)
        XCTAssertGreaterThanOrEqual(byTotal.rows[0].totalTimeMs, byTotal.rows[1].totalTimeMs)
        XCTAssertGreaterThanOrEqual(byTotal.rows[1].totalTimeMs, byTotal.rows[2].totalTimeMs)

        let byCalls = try await source.load(orderBy: .calls, limit: 2)
        XCTAssertEqual(byCalls.rows.count, 2)
        XCTAssertGreaterThanOrEqual(byCalls.rows[0].calls, byCalls.rows[1].calls)
    }
}
