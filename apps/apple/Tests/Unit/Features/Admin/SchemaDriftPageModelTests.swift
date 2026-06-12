import XCTest
@testable import TeslaSync

/// State-machine tests for `SchemaDriftPageModel` — every data state the page renders
/// (loading / empty / error / success, plus the 503 subsystem-unavailable variant), the
/// drift-status resolution (web `is_different ?? has_drift`), and the display-boundary
/// formatters (`fmtNumber` / `formatDelta` / `formatDateTime`) ported from the web.
@MainActor final class SchemaDriftPageModelTests: XCTestCase {
    private struct StubSource: SchemaDriftDataSource {
        var report: SchemaDriftReport?
        var unavailable = false
        var fails = false

        func load() async throws -> SchemaDriftReport? {
            if unavailable { throw SchemaDriftSubsystemUnavailable() }
            if fails { throw StubError() }
            return report
        }
    }

    private struct StubError: Error {}

    private func fingerprint(
        sha: String = "abc123",
        tables: Int = 100,
        columns: Int = 1000,
        indexes: Int = 200
    ) -> SchemaFingerprint {
        SchemaFingerprint(sha256: sha, tableCount: tables, columnCount: columns, indexCount: indexes)
    }

    private func report(
        hasDrift: Bool = true,
        isDifferent: Bool = true,
        tableDelta: Int = 1,
        columnDelta: Int = 2,
        indexDelta: Int = 0,
        generatedAt: String? = "2026-05-28T09:14:22Z"
    ) -> SchemaDriftReport {
        SchemaDriftReport(
            drift: SchemaDrift(
                hasDrift: hasDrift,
                current: fingerprint(tables: 101, columns: 1002, indexes: 200),
                expected: fingerprint(tables: 100, columns: 1000, indexes: 200),
                tableCountDelta: tableDelta,
                columnCountDelta: columnDelta,
                indexCountDelta: indexDelta,
                expectedGeneratedAt: generatedAt
            ),
            isDifferent: isDifferent
        )
    }

    // MARK: - States

    func testInitialStateIsLoading() {
        let model = SchemaDriftPageModel(dataSource: StubSource())
        XCTAssertEqual(model.state, .loading)
        XCTAssertFalse(model.isSubsystemUnavailable)
        XCTAssertNil(model.report)
        XCTAssertFalse(model.isDrifted)
    }

    func testLoadSuccessPopulatesReport() async {
        let drift = report()
        let model = SchemaDriftPageModel(dataSource: StubSource(report: drift))
        await model.load()
        XCTAssertEqual(model.state, .loaded(drift))
        XCTAssertEqual(model.report, drift)
        XCTAssertTrue(model.isDrifted)
    }

    func testLoadNilYieldsEmptyState() async {
        let model = SchemaDriftPageModel(dataSource: StubSource(report: nil))
        await model.load()
        XCTAssertEqual(model.state, .empty)
        XCTAssertNil(model.report)
        XCTAssertFalse(model.isDrifted)
    }

    func testLoad503YieldsUnavailableState() async {
        let model = SchemaDriftPageModel(dataSource: StubSource(unavailable: true))
        await model.load()
        XCTAssertEqual(model.state, .unavailable)
        XCTAssertTrue(model.isSubsystemUnavailable)
        XCTAssertNil(model.report)
    }

    func testLoadFailureYieldsErrorState() async {
        let model = SchemaDriftPageModel(dataSource: StubSource(fails: true))
        await model.load()
        guard case .error = model.state else {
            return XCTFail("expected error state, got \(model.state)")
        }
        XCTAssertFalse(model.isSubsystemUnavailable)
    }

    func testRefreshReloads() async {
        let model = SchemaDriftPageModel(dataSource: StubSource(report: report()))
        await model.load()
        await model.refresh()
        XCTAssertNotNil(model.report)
    }

    // MARK: - Drift-status resolution (web `is_different ?? has_drift`)

    func testIsDriftedTrueWhenIsDifferent() async {
        let model = SchemaDriftPageModel(dataSource: StubSource(report: report(hasDrift: false, isDifferent: true)))
        await model.load()
        XCTAssertTrue(model.isDrifted)
    }

    func testIsDriftedFallsBackToHasDrift() async {
        let model = SchemaDriftPageModel(dataSource: StubSource(report: report(hasDrift: true, isDifferent: false)))
        await model.load()
        XCTAssertTrue(model.isDrifted)
    }

    func testIsDriftedFalseWhenClean() async {
        let model = SchemaDriftPageModel(dataSource: StubSource(report: report(hasDrift: false, isDifferent: false)))
        await model.load()
        XCTAssertFalse(model.isDrifted)
    }

    // MARK: - Formatters (web `fmtNumber` / `formatDelta`)

    func testNumberUsesGroupingAndDefaultPrecision() {
        XCTAssertEqual(SchemaDriftFormat.number(142), "142.00")
        XCTAssertEqual(SchemaDriftFormat.number(1893), "1,893.00")
        XCTAssertEqual(SchemaDriftFormat.number(1000, decimals: 0), "1,000")
    }

    func testFormatDelta() {
        XCTAssertEqual(SchemaDriftFormat.delta(0), "0")
        XCTAssertEqual(SchemaDriftFormat.delta(1), "+1.00")
        XCTAssertEqual(SchemaDriftFormat.delta(12), "+12.00")
        XCTAssertEqual(SchemaDriftFormat.delta(-3), "-3.00")
    }

    func testCountSubInterpolatesBothCounts() {
        let template = "%1$@ current · %2$@ expected"
        XCTAssertEqual(
            SchemaDriftFormat.countSub(template, current: 142, expected: 141),
            "142.00 current · 141.00 expected"
        )
    }

    // MARK: - Date formatting (web `formatDateTime`)

    func testDateTimeEmptyForNilAndUnparseable() {
        XCTAssertEqual(SchemaDriftFormat.dateTime(nil), "—")
        XCTAssertEqual(SchemaDriftFormat.dateTime("not-a-date"), "—")
    }

    func testDateTimeParsesISO8601() {
        let formatted = SchemaDriftFormat.dateTime("2026-05-28T09:14:22Z")
        XCTAssertNotEqual(formatted, "—")
        XCTAssertTrue(formatted.contains("2026"), "expected the year in \(formatted)")
        XCTAssertTrue(formatted.contains("May"), "expected the month in \(formatted)")
    }

    func testDateTimeParsesFractionalSeconds() {
        XCTAssertNotEqual(SchemaDriftFormat.dateTime("2026-05-28T09:14:22.512Z"), "—")
    }

    // MARK: - Default seed

    func testSampleDataSourceIsNonNilAndWellFormed() async throws {
        let report = try await SampleSchemaDriftDataSource().load()
        let unwrapped = try XCTUnwrap(report)
        XCTAssertFalse(unwrapped.drift.current.sha256.isEmpty)
        XCTAssertFalse(unwrapped.drift.expected.sha256.isEmpty)
        XCTAssertTrue(unwrapped.drift.current.tableCount > 0)
        XCTAssertEqual(
            unwrapped.drift.tableCountDelta,
            unwrapped.drift.current.tableCount - unwrapped.drift.expected.tableCount
        )
        XCTAssertTrue(unwrapped.isDrifted)
    }
}
