import XCTest
@testable import TeslaSync

/// State-machine tests for `DiskForecastPageModel` — every data state the page renders
/// (loading / empty / error / success, plus the 503 subsystem-unavailable variant),
/// the fleet roll-ups, the severity fold, and the display-boundary formatters
/// (`formatBytes` / `fmtNumber` / days-to-quota / percent) ported from the web.
@MainActor final class DiskForecastPageModelTests: XCTestCase {
    private struct StubSource: DiskForecastDataSource {
        var rows: [DiskForecastHypertable] = []
        var unavailable = false
        var fails = false

        func load() async throws -> DiskForecastReport {
            if unavailable { throw DiskForecastSubsystemUnavailable() }
            if fails { throw StubError() }
            return DiskForecastReport(hypertables: rows)
        }
    }

    private struct StubError: Error {}

    private func table(
        _ name: String,
        total: Int64,
        unc: Int64,
        comp: Int64,
        chunks: Int64 = 4,
        growth: Double = 100,
        days: Double? = 30,
        severity: DiskForecastSeverity = .ok
    ) -> DiskForecastHypertable {
        DiskForecastHypertable(
            hypertableName: name,
            totalBytes: total,
            uncompressedBytes: unc,
            compressedBytes: comp,
            chunkCount: chunks,
            growthBytesPerDay: growth,
            estDaysToQuota: days,
            severity: severity
        )
    }

    // MARK: - States

    func testInitialStateIsLoading() {
        let model = DiskForecastPageModel(dataSource: StubSource())
        XCTAssertEqual(model.state, .loading)
        XCTAssertFalse(model.showsFleetStats)
        XCTAssertFalse(model.isSubsystemUnavailable)
        XCTAssertTrue(model.rows.isEmpty)
    }

    func testLoadSuccessPopulatesRows() async {
        let rows = [table("signal_log", total: 2048, unc: 1024, comp: 1024)]
        let model = DiskForecastPageModel(dataSource: StubSource(rows: rows))
        await model.load()
        XCTAssertEqual(model.state, .loaded(rows))
        XCTAssertTrue(model.showsFleetStats)
        XCTAssertEqual(model.rows.count, 1)
    }

    func testLoadEmptyYieldsEmptyState() async {
        let model = DiskForecastPageModel(dataSource: StubSource())
        await model.load()
        XCTAssertEqual(model.state, .empty)
        XCTAssertFalse(model.showsFleetStats)
    }

    func testLoad503YieldsUnavailableState() async {
        let model = DiskForecastPageModel(dataSource: StubSource(unavailable: true))
        await model.load()
        XCTAssertEqual(model.state, .unavailable)
        XCTAssertTrue(model.isSubsystemUnavailable)
        XCTAssertFalse(model.showsFleetStats)
    }

    func testLoadFailureYieldsErrorState() async {
        let model = DiskForecastPageModel(dataSource: StubSource(fails: true))
        await model.load()
        guard case .error = model.state else {
            return XCTFail("expected error state, got \(model.state)")
        }
        XCTAssertFalse(model.isSubsystemUnavailable)
    }

    func testRefreshReloads() async {
        let model = DiskForecastPageModel(dataSource: StubSource(rows: [table("t", total: 1, unc: 1, comp: 0)]))
        await model.load()
        await model.refresh()
        XCTAssertTrue(model.showsFleetStats)
    }

    // MARK: - Fleet roll-ups (web `fleetTotals`)

    func testFleetTotalsSumAcrossHypertables() async {
        let rows = [
            table("a", total: 1000, unc: 600, comp: 400, growth: 10),
            table("b", total: 2000, unc: 1500, comp: 500, growth: 25)
        ]
        let model = DiskForecastPageModel(dataSource: StubSource(rows: rows))
        await model.load()
        let totals = model.fleetTotals
        XCTAssertEqual(totals.totalBytes, 3000)
        XCTAssertEqual(totals.uncompressedBytes, 2100)
        XCTAssertEqual(totals.compressedBytes, 900)
        XCTAssertEqual(totals.growthBytesPerDay, 35, accuracy: 0.001)
    }

    func testFleetTotalsAreZeroWhenNotLoaded() {
        let model = DiskForecastPageModel(dataSource: StubSource())
        XCTAssertEqual(model.fleetTotals.totalBytes, 0)
    }

    // MARK: - Severity fold (web `normalize`/`unknown`)

    func testSeverityFoldsUnknownToken() {
        XCTAssertEqual(DiskForecastSeverity(wire: "warn"), .warn)
        XCTAssertEqual(DiskForecastSeverity(wire: "critical"), .critical)
        XCTAssertEqual(DiskForecastSeverity(wire: "ok"), .ok)
        XCTAssertEqual(DiskForecastSeverity(wire: "bogus"), .unknown)
    }

    // MARK: - Formatters (web `formatBytes` / `fmtNumber`)

    func testFormatBytesBinaryUnits() {
        XCTAssertEqual(DiskForecastFormat.bytes(Int64(0)), "0 B")
        XCTAssertEqual(DiskForecastFormat.bytes(Int64(512)), "512 B")
        XCTAssertEqual(DiskForecastFormat.bytes(Int64(1024)), "1.0 KB")
        XCTAssertEqual(DiskForecastFormat.bytes(Int64(1536)), "1.5 KB")
        XCTAssertEqual(DiskForecastFormat.bytes(Int64(1_048_576)), "1.0 MB")
        XCTAssertEqual(DiskForecastFormat.bytes(Int64(1_073_741_824)), "1.0 GB")
    }

    func testFormatBytesEmptyForNilAndNonFinite() {
        XCTAssertEqual(DiskForecastFormat.bytes(nil), "—")
        XCTAssertEqual(DiskForecastFormat.bytes(Double.infinity), "—")
        XCTAssertEqual(DiskForecastFormat.bytes(Double.nan), "—")
    }

    func testNumberUsesGroupingAndPrecision() {
        XCTAssertEqual(DiskForecastFormat.number(1234.5), "1,234.50")
        XCTAssertEqual(DiskForecastFormat.number(1000, decimals: 0), "1,000")
    }

    func testDaysToQuota() {
        XCTAssertEqual(DiskForecastFormat.daysToQuota(nil), "—")
        XCTAssertEqual(DiskForecastFormat.daysToQuota(45), "45.00")
    }

    func testPercent() {
        XCTAssertEqual(DiskForecastFormat.percent(512, of: 1024), "50.0")
        XCTAssertEqual(DiskForecastFormat.percent(1, of: 0), "—")
    }

    // MARK: - Default seed

    func testSampleDataSourceIsNonEmptyAndWellFormed() async throws {
        let report = try await SampleDiskForecastDataSource().load()
        XCTAssertFalse(report.hypertables.isEmpty)
        XCTAssertTrue(report.hypertables.allSatisfy { !$0.hypertableName.isEmpty })
        XCTAssertEqual(
            Set(report.hypertables.map(\.id)).count,
            report.hypertables.count,
            "hypertable ids are unique"
        )
    }
}
