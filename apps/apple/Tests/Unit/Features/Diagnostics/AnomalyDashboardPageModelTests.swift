import XCTest
@testable import TeslaSync

// Model + derivation + formatter tests for the Anomaly Detection surface (web parity unit
// `page:diagnostics/AnomalyDashboard`). Covers the four data states (loading / empty / error /
// success), the `signalFrequency` derivation, and the display-boundary formatters.

@MainActor
final class AnomalyDashboardPageModelTests: XCTestCase {
    func testInitialPhaseIsLoading() {
        let model = AnomalyDashboardPageModel(dataSource: SampleAnomalyDashboardDataSource())
        XCTAssertEqual(model.phase, .loading)
        XCTAssertNil(model.data)
    }

    func testLoadSuccessYieldsReady() async {
        let model = AnomalyDashboardPageModel(dataSource: SampleAnomalyDashboardDataSource())
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertNotNil(model.data)
        XCTAssertFalse(model.vehicles.isEmpty)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertEqual(model.days, 7)
    }

    func testEmptyDataSourceYieldsEmptyPhase() async {
        let model = AnomalyDashboardPageModel(dataSource: EmptyAnomalyDashboardDataSource())
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.data)
    }

    func testFailingDataSourceYieldsErrorPhase() async {
        let model = AnomalyDashboardPageModel(dataSource: FailingAnomalyDashboardDataSource())
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected error phase, got \(model.phase)")
        }
        XCTAssertNil(model.data)
    }

    func testQuietDataSourceIsReadyWithEmptySections() async {
        let model = AnomalyDashboardPageModel(dataSource: QuietAnomalyDashboardDataSource())
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.data?.anomalies.count, 0)
        XCTAssertEqual(model.data?.healthCategories.count, 0)
        XCTAssertEqual(model.data?.signalFrequency.count, 0)
    }

    func testSelectVehicleReloadsData() async {
        let model = AnomalyDashboardPageModel(dataSource: SampleAnomalyDashboardDataSource())
        await model.load()
        XCTAssertEqual(model.data?.anomalies.count, 4, "vehicle 1 sample anomalies")
        await model.selectVehicle(3)
        XCTAssertEqual(model.selectedVehicleID, 3)
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.data?.anomalies.count, 3, "vehicle 3 sample anomalies")
    }

    func testSelectSameVehicleIsNoOp() async {
        let model = AnomalyDashboardPageModel(dataSource: SampleAnomalyDashboardDataSource())
        await model.load()
        await model.selectVehicle(1)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertEqual(model.phase, .ready)
    }

    func testSignalFrequencyIsSortedDescendingTopTen() {
        let anomalies = (0 ..< 12).flatMap { index -> [AnomalyEntry] in
            // Signal "s\(index)" appears (index + 1) times, so counts are strictly increasing.
            (0 ... index).map { _ in
                AnomalyEntry(
                    signal: "s\(index)",
                    type: "z_score",
                    severity: AnomalySeverity(raw: "info"),
                    value: 1,
                    baseline: 1,
                    zScore: 0,
                    detectedAt: "2026-01-01T00:00:00Z",
                    message: "m"
                )
            }
        }
        let data = AnomalyData(
            anomalies: anomalies,
            healthCategories: [],
            signalsMonitored: 10,
            anomaliesLast7d: anomalies.count,
            anomaliesLast24h: 0
        )
        let freq = data.signalFrequency
        XCTAssertEqual(freq.count, 10, "top-10 cap")
        XCTAssertEqual(freq.first?.signal, "s11", "highest count first")
        XCTAssertEqual(freq.first?.count, 12)
        let counts = freq.map(\.count)
        XCTAssertEqual(counts, counts.sorted(by: >), "descending order")
    }

    func testHealthCategoryCount() {
        let data = AnomalyData(
            anomalies: [],
            healthCategories: [
                AnomalyHealthCategory(category: "battery", status: "critical"),
                AnomalyHealthCategory(category: "tires", status: "normal")
            ],
            signalsMonitored: 4,
            anomaliesLast7d: 0,
            anomaliesLast24h: 0
        )
        XCTAssertEqual(data.healthCategoryCount, 2)
    }

    func testSeverityToneMapping() {
        XCTAssertEqual(AnomalyDashboardFormat.tone(for: .critical), .danger)
        XCTAssertEqual(AnomalyDashboardFormat.tone(for: .warning), .warning)
        XCTAssertEqual(AnomalyDashboardFormat.tone(for: .info), .success)
        XCTAssertEqual(AnomalyDashboardFormat.tone(for: .other("unknown")), .success)
    }

    func testTypeLabelFallsBackToRawForUnknown() {
        XCTAssertEqual(AnomalyDashboardFormat.typeLabel("z_score"), "Statistical")
        XCTAssertEqual(AnomalyDashboardFormat.typeLabel("range"), "Range")
        XCTAssertEqual(AnomalyDashboardFormat.typeLabel("trend"), "Trend")
        XCTAssertEqual(AnomalyDashboardFormat.typeLabel("custom_kind"), "custom_kind")
    }

    func testNumberAndZScoreFormatting() {
        XCTAssertEqual(AnomalyDashboardFormat.signalValue(402.6), "402.60")
        XCTAssertEqual(AnomalyDashboardFormat.zScore(3.4), "3.4σ")
        XCTAssertEqual(AnomalyDashboardFormat.integer(1240), "1,240")
        XCTAssertEqual(AnomalyDashboardFormat.signalValue(.nan), "—")
    }

    func testTimestampParsingHandlesBadInput() {
        XCTAssertEqual(AnomalyDashboardFormat.relativeTimestamp("not-a-date"), "—")
        XCTAssertEqual(AnomalyDashboardFormat.absoluteTimestamp("not-a-date"), "—")
        XCTAssertNotEqual(AnomalyDashboardFormat.relativeTimestamp("2026-01-01T00:00:00Z"), "—")
    }

    func testZScoreVisibilityGate() {
        let shown = AnomalyEntry(
            signal: "s", type: "z_score", severity: AnomalySeverity(raw: "info"),
            value: 1, baseline: 1, zScore: 2.5, detectedAt: "2026-01-01T00:00:00Z", message: "m"
        )
        let hidden = AnomalyEntry(
            signal: "s", type: "range", severity: AnomalySeverity(raw: "info"),
            value: 1, baseline: 1, zScore: 0, detectedAt: "2026-01-01T00:00:00Z", message: "m"
        )
        XCTAssertTrue(shown.showsZScore)
        XCTAssertFalse(hidden.showsZScore)
    }
}
