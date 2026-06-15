import XCTest
@testable import TeslaSync

/// State-machine tests for `VehicleCostPageModel` — every data state the page renders
/// (loading / empty / error / success, plus the 503 subsystem-unavailable variant), the
/// window plumbing, the totals accessor, and the display-boundary formatters
/// (`fmtNumber` / `formatBytes` / `formatRelative`) ported from the web.
@MainActor final class VehicleCostPageModelTests: XCTestCase {
    private struct StubSource: VehicleCostDataSource {
        var report = VehicleCostReport(vehicles: [], totals: zeroTotals)
        var unavailable = false
        var fails = false
        /// When set, returns `report` only for this window, and an empty report otherwise
        /// — lets a test prove the selected window reaches the source.
        var onlyForWindow: VehicleCostWindow?

        func load(window: VehicleCostWindow) async throws -> VehicleCostReport {
            if unavailable { throw VehicleCostSubsystemUnavailable() }
            if fails { throw StubError() }
            if let onlyForWindow, window != onlyForWindow {
                return VehicleCostReport(vehicles: [], totals: VehicleCostPageModelTests.zeroTotals)
            }
            return report
        }
    }

    private struct StubError: Error {}

    private static let zeroTotals = VehicleCostTotals(
        totalRows: 0,
        totalBytesEst: 0,
        totalRatePerMinute24h: 0,
        totalFailures24h: 0
    )

    private func row(_ id: Int64, name: String? = "Car", rows: Int64 = 100, failures: Int64 = 0) -> VehicleCostRow {
        VehicleCostRow(
            vehicleID: id,
            displayName: name,
            signalRowCount: rows,
            signalBytesEst: rows * 96,
            ingestRatePerMinute24h: 12.5,
            dlqFailures24h: failures,
            lastSeenAt: "2026-04-04T12:00:00Z"
        )
    }

    private func report(_ rows: [VehicleCostRow]) -> VehicleCostReport {
        VehicleCostReport(
            vehicles: rows,
            totals: VehicleCostTotals(
                totalRows: rows.reduce(0) { $0 + $1.signalRowCount },
                totalBytesEst: rows.reduce(0) { $0 + $1.signalBytesEst },
                totalRatePerMinute24h: rows.reduce(0) { $0 + $1.ingestRatePerMinute24h },
                totalFailures24h: rows.reduce(0) { $0 + $1.dlqFailures24h }
            )
        )
    }

    // MARK: - States

    func testInitialStateIsLoading() {
        let model = VehicleCostPageModel(dataSource: StubSource())
        XCTAssertEqual(model.state, .loading)
        XCTAssertFalse(model.showsFleetTotals)
        XCTAssertFalse(model.isSubsystemUnavailable)
        XCTAssertTrue(model.vehicles.isEmpty)
        XCTAssertNil(model.totals)
        XCTAssertEqual(model.window, .days30)
    }

    func testLoadSuccessPopulatesRowsAndTotals() async {
        let rows = [row(1), row(2)]
        let model = VehicleCostPageModel(dataSource: StubSource(report: report(rows)))
        await model.load()
        XCTAssertEqual(model.state, .loaded(report(rows)))
        XCTAssertEqual(model.vehicles.count, 2)
        XCTAssertTrue(model.showsFleetTotals)
        XCTAssertEqual(model.totals?.totalRows, 200)
    }

    func testLoadEmptyYieldsEmptyStateButKeepsTotals() async {
        // Web shows the fleet stat cards whenever totals exist, even with zero vehicles.
        let totals = VehicleCostTotals(totalRows: 0, totalBytesEst: 0, totalRatePerMinute24h: 0, totalFailures24h: 0)
        let model = VehicleCostPageModel(dataSource: StubSource(report: VehicleCostReport(
            vehicles: [],
            totals: totals
        )))
        await model.load()
        XCTAssertEqual(model.state, .empty(totals))
        XCTAssertTrue(model.vehicles.isEmpty)
        XCTAssertTrue(model.showsFleetTotals)
        XCTAssertEqual(model.totals, totals)
    }

    func testLoad503YieldsUnavailableState() async {
        let model = VehicleCostPageModel(dataSource: StubSource(unavailable: true))
        await model.load()
        XCTAssertEqual(model.state, .unavailable)
        XCTAssertTrue(model.isSubsystemUnavailable)
        XCTAssertFalse(model.showsFleetTotals)
        XCTAssertNil(model.totals)
    }

    func testLoadFailureYieldsErrorState() async {
        let model = VehicleCostPageModel(dataSource: StubSource(fails: true))
        await model.load()
        guard case .error = model.state else {
            return XCTFail("expected error state, got \(model.state)")
        }
        XCTAssertFalse(model.isSubsystemUnavailable)
        XCTAssertNil(model.totals)
    }

    func testRefreshReloads() async {
        let model = VehicleCostPageModel(dataSource: StubSource(report: report([row(1)])))
        await model.load()
        await model.refresh()
        XCTAssertTrue(model.showsFleetTotals)
        XCTAssertEqual(model.vehicles.count, 1)
    }

    // MARK: - Window plumbing (web `windowDays` → `since` query parameter)

    func testSelectedWindowReachesTheSource() async {
        let rows = [row(1)]
        let source = StubSource(report: report(rows), onlyForWindow: .days7)
        let model = VehicleCostPageModel(dataSource: source)

        await model.load() // default window .days30 → source returns empty
        XCTAssertTrue(model.vehicles.isEmpty)
        XCTAssertEqual(model.state, .empty(Self.zeroTotals))

        model.window = .days7
        await model.reload() // now the source yields the populated report
        XCTAssertEqual(model.vehicles.count, 1)
        XCTAssertTrue(model.showsFleetTotals)
    }

    func testReloadKeepsRowsVisibleWhilePopulated() async {
        let model = VehicleCostPageModel(dataSource: StubSource(report: report([row(1)])))
        await model.load()
        XCTAssertEqual(model.vehicles.count, 1)
        // A populated reload never flips back to .loading (web `isFetching`, not `isLoading`).
        await model.reload()
        if case .loading = model.state { XCTFail("reload should not show the skeleton when rows exist") }
        XCTAssertEqual(model.vehicles.count, 1)
    }

    func testWindowDaysAndSince() {
        XCTAssertEqual(VehicleCostWindow.days1.days, 1)
        XCTAssertEqual(VehicleCostWindow.days7.days, 7)
        XCTAssertEqual(VehicleCostWindow.days30.days, 30)
        XCTAssertEqual(VehicleCostWindow.days90.days, 90)
        let now = Date(timeIntervalSince1970: 1_000_000)
        XCTAssertEqual(VehicleCostWindow.days1.since(from: now), now.addingTimeInterval(-86400), accuracy: 0.001)
        XCTAssertEqual(VehicleCostWindow.allCases.count, 4)
    }

    // MARK: - Formatters (web `fmtNumber` / `formatBytes`)

    func testNumberUsesGroupingAndDefaultPrecision() {
        XCTAssertEqual(VehicleCostFormat.number(Int64(12345)), "12,345.00")
        XCTAssertEqual(VehicleCostFormat.number(Int64(0)), "0.00")
        XCTAssertEqual(VehicleCostFormat.number(842.6, decimals: 1), "842.6")
        XCTAssertEqual(VehicleCostFormat.number(12345.0, decimals: 1), "12,345.0")
        XCTAssertEqual(VehicleCostFormat.number(Int64(1000), decimals: 0), "1,000")
    }

    func testFormatBytesBinaryUnits() {
        XCTAssertEqual(VehicleCostFormat.bytes(Int64(0)), "0 B")
        XCTAssertEqual(VehicleCostFormat.bytes(Int64(512)), "512 B")
        XCTAssertEqual(VehicleCostFormat.bytes(Int64(1024)), "1.0 KB")
        XCTAssertEqual(VehicleCostFormat.bytes(Int64(1536)), "1.5 KB")
        XCTAssertEqual(VehicleCostFormat.bytes(Int64(1_048_576)), "1.0 MB")
        XCTAssertEqual(VehicleCostFormat.bytes(Int64(1_073_741_824)), "1.0 GB")
    }

    func testFormatBytesEmptyForNilAndNonFinite() {
        XCTAssertEqual(VehicleCostFormat.bytes(nil), "—")
        XCTAssertEqual(VehicleCostFormat.bytes(Double.infinity), "—")
        XCTAssertEqual(VehicleCostFormat.bytes(Double.nan), "—")
    }

    // MARK: - Relative time (web `formatRelative` ladder)

    func testRelativeLadder() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let iso = ISO8601DateFormatter()
        XCTAssertEqual(VehicleCostFormat.relative(iso.string(from: now.addingTimeInterval(-30)), now: now), "just now")
        XCTAssertEqual(
            VehicleCostFormat.relative(iso.string(from: now.addingTimeInterval(-5 * 60)), now: now),
            "5m ago"
        )
        XCTAssertEqual(
            VehicleCostFormat.relative(iso.string(from: now.addingTimeInterval(-3 * 3600)), now: now),
            "3h ago"
        )
        XCTAssertEqual(
            VehicleCostFormat.relative(iso.string(from: now.addingTimeInterval(-2 * 86400)), now: now),
            "2d ago"
        )
    }

    func testRelativeFallsBackToAbsoluteAfterAWeek() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let old = now.addingTimeInterval(-10 * 86400)
        let result = VehicleCostFormat.relative(ISO8601DateFormatter().string(from: old), now: now)
        // Beyond a week the web returns the absolute date (tz-dependent text), so assert the
        // ladder fell through to exactly that formatter rather than an "Nd ago" phrase.
        XCTAssertFalse(result.hasSuffix("ago"))
        XCTAssertEqual(result, VehicleCostFormat.absoluteDate(old))
    }

    func testRelativeEmptyForUnparseableInput() {
        XCTAssertEqual(VehicleCostFormat.relative(""), "—")
        XCTAssertEqual(VehicleCostFormat.relative("not-a-date"), "—")
    }

    // MARK: - Name fallback (web `display_name ?? unnamed`)

    func testVehicleNameUsesDisplayNameWhenPresent() {
        XCTAssertEqual(VehicleCostTable.vehicleName(row(9, name: "Model 3")), "Model 3")
    }

    // MARK: - Default seed

    func testSampleDataSourceIsNonEmptyAndWellFormed() async throws {
        let report = try await SampleVehicleCostDataSource().load(window: .days30)
        XCTAssertFalse(report.vehicles.isEmpty)
        XCTAssertEqual(
            Set(report.vehicles.map(\.id)).count,
            report.vehicles.count,
            "vehicle ids are unique"
        )
        XCTAssertEqual(report.totals.totalRows, report.vehicles.reduce(0) { $0 + $1.signalRowCount })
        XCTAssertEqual(report.totals.totalFailures24h, report.vehicles.reduce(0) { $0 + $1.dlqFailures24h })
    }
}
