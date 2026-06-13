import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for `BatteryCellsPageModel` — every data state
/// the page renders (loading / no-data empty / error / ready), the vehicle
/// auto-select + reselection, the pure derivations the web computes with `useMemo`
/// (histogram, min/max cell, spread trend, health insights), and the display
/// formatters (web `fmtNumber` + the voltage / millivolt / temperature-spread helpers).
@MainActor
final class BatteryCellsPageModelTests: XCTestCase {
    private struct StubError: Error {}

    private struct StubSource: BatteryCellsDataSource {
        var vehicles: [BatteryVehicle]
        var snapshots: [Int64: BatteryCellData] = [:]
        var failData = false

        func loadVehicles() async throws -> [BatteryVehicle] {
            vehicles
        }

        func loadCellData(vehicleID: Int64) async throws -> BatteryCellData? {
            if failData { throw StubError() }
            return snapshots[vehicleID]
        }
    }

    private func vehicle(_ id: Int64, _ name: String) -> BatteryVehicle {
        BatteryVehicle(id: id, displayName: name, vin: "VIN\(id)")
    }

    private func reading(_ id: Int, _ voltage: Double, _ status: BatteryCellStatus = .normal) -> BatteryCellReading {
        BatteryCellReading(cellID: id, voltage: voltage, deltaFromAvgV: voltage - 3.700, status: status)
    }

    private func sampleData(
        imbalanceMv: Double = 28,
        tempSpread: Double = 6.3,
        critical: Bool = true
    ) -> BatteryCellData {
        let cells = [
            reading(1, 3.700),
            reading(2, 3.702),
            reading(3, 3.698),
            reading(4, 3.710, .high),
            reading(5, critical ? 3.681 : 3.699, critical ? .critical : .normal),
            reading(6, 3.701)
        ]
        let voltages = cells.map(\.voltage)
        return BatteryCellData(
            totalCells: cells.count,
            avgVoltage: 3.700,
            minVoltage: voltages.min() ?? 0,
            maxVoltage: voltages.max() ?? 0,
            voltageSpread: (voltages.max() ?? 0) - (voltages.min() ?? 0),
            imbalanceMv: imbalanceMv,
            packVoltage: 355.2,
            avgTemperatureC: 24.5,
            minTemperatureC: 22.0,
            maxTemperatureC: 28.0,
            tempSpreadC: tempSpread,
            cells: cells,
            history: sampleHistory()
        )
    }

    private func sampleHistory() -> [BatteryCellHistoryPoint] {
        let base = Date(timeIntervalSince1970: 1_717_200_000)
        return (0 ..< 5).map { index in
            BatteryCellHistoryPoint(
                timestamp: base.addingTimeInterval(Double(index) * 86400),
                minVoltage: 3.695 - Double(index) * 0.001,
                maxVoltage: 3.705 + Double(index) * 0.001,
                avgVoltage: 3.700,
                imbalanceMv: 6 + Double(index) * 3
            )
        }
    }

    private func twoVehicleSource() -> StubSource {
        StubSource(
            vehicles: [vehicle(1, "Alpha"), vehicle(2, "Bravo")],
            snapshots: [1: sampleData(), 2: sampleData(imbalanceMv: 4, tempSpread: 1, critical: false)]
        )
    }

    // MARK: Phases

    func testInitialPhaseIsLoading() {
        let model = BatteryCellsPageModel(dataSource: twoVehicleSource())
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadResolvesToReady() async {
        let model = BatteryCellsPageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertNotNil(model.data)
        XCTAssertEqual(model.vehicles.count, 2)
        XCTAssertEqual(model.selectedVehicleID, 1)
    }

    func testNilSnapshotResolvesToEmpty() async {
        let source = StubSource(vehicles: [vehicle(1, "Alpha")], snapshots: [:])
        let model = BatteryCellsPageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.data)
    }

    func testNoVehiclesResolvesToEmpty() async {
        let model = BatteryCellsPageModel(dataSource: StubSource(vehicles: []))
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.selectedVehicleID)
    }

    func testLoadFailureResolvesToError() async {
        var source = twoVehicleSource()
        source.failData = true
        let model = BatteryCellsPageModel(dataSource: source)
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected error phase, got \(model.phase)")
        }
        XCTAssertNil(model.data)
    }

    func testBlankSnapshotIsReadyWithSectionEmpties() async {
        let source = StubSource(vehicles: [vehicle(1, "Alpha")], snapshots: [1: blankData()])
        let model = BatteryCellsPageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.data?.isBlank, true)
        XCTAssertEqual(model.data?.insightsForDisplay.isEmpty, true)
        XCTAssertEqual(model.data?.hasTemperatureReadings, false)
    }

    private func blankData() -> BatteryCellData {
        BatteryCellData(
            totalCells: 0, avgVoltage: 0, minVoltage: 0, maxVoltage: 0, voltageSpread: 0,
            imbalanceMv: 0, packVoltage: 0, avgTemperatureC: 0, minTemperatureC: 0,
            maxTemperatureC: 0, tempSpreadC: 0, cells: [], history: []
        )
    }

    // MARK: Selection

    func testSelectVehicleReloadsSnapshot() async {
        let model = BatteryCellsPageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.data?.criticalCellCount, 1)
        await model.selectVehicle(2)
        XCTAssertEqual(model.selectedVehicleID, 2)
        XCTAssertEqual(model.data?.criticalCellCount, 0)
    }

    func testSelectingSameVehicleIsNoOp() async {
        let model = BatteryCellsPageModel(dataSource: twoVehicleSource())
        await model.load()
        await model.selectVehicle(1)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertEqual(model.phase, .ready)
    }

    func testRefreshKeepsReady() async {
        let model = BatteryCellsPageModel(dataSource: twoVehicleSource())
        await model.load()
        await model.refresh()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.isRefreshing)
    }

    // MARK: Derivations

    func testMinMaxCell() async {
        let model = BatteryCellsPageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.data?.minCell?.cellID, 5)
        XCTAssertEqual(model.data?.maxCell?.cellID, 4)
    }

    func testNormalAndCriticalCounts() {
        let data = sampleData()
        XCTAssertEqual(data.criticalCellCount, 1)
        XCTAssertEqual(data.normalCellCount, 4)
    }

    func testSpreadTrendMatchesHistory() {
        let data = sampleData()
        XCTAssertEqual(data.spreadTrend.count, data.history.count)
        let expected = (data.history[1].maxVoltage - data.history[1].minVoltage) * 1000
        XCTAssertEqual(data.spreadTrend[1].spreadMv, expected, accuracy: 0.0001)
    }

    func testHistogramBucketsAndCounts() {
        let data = sampleData()
        let histogram = data.histogram
        XCTAssertEqual(histogram.count, 6)
        XCTAssertEqual(histogram.reduce(0) { $0 + $1.count }, data.cells.count)
    }

    func testHistogramEmptyForNoCells() {
        XCTAssertTrue(BatteryCellData.buildHistogram([]).isEmpty)
    }

    func testInsightBandsHighAndCritical() {
        let insights = BatteryCellData.buildInsights(imbalanceMv: 28, tempSpreadC: 6.3, criticalCells: 1)
        XCTAssertEqual(insights.map(\.titleKey), [
            "battery.cells.insight.highSpread",
            "battery.cells.insight.highTemp",
            "battery.cells.insight.criticalCells"
        ])
        XCTAssertEqual(insights.last?.descriptionCount, 1)
    }

    func testInsightBandsWatch() {
        let insights = BatteryCellData.buildInsights(imbalanceMv: 9, tempSpreadC: 4, criticalCells: 0)
        XCTAssertEqual(insights.map(\.titleKey), [
            "battery.cells.insight.watchSpread",
            "battery.cells.insight.watchTemp",
            "battery.cells.insight.healthy"
        ])
    }

    func testInsightBandsGood() {
        let insights = BatteryCellData.buildInsights(imbalanceMv: 2, tempSpreadC: 1, criticalCells: 0)
        XCTAssertEqual(insights.map(\.titleKey), [
            "battery.cells.insight.balanced",
            "battery.cells.insight.goodTemp",
            "battery.cells.insight.healthy"
        ])
    }

    func testDeviationLevelBands() {
        XCTAssertEqual(CellDeviationLevel.forDeviation(millivolts: 2), .nominal)
        XCTAssertEqual(CellDeviationLevel.forDeviation(millivolts: 10), .slight)
        XCTAssertEqual(CellDeviationLevel.forDeviation(millivolts: 20), .significant)
    }

    func testStatusSeverityAndDisplayKey() {
        XCTAssertEqual(BatteryCellStatus.normal.severity, .success)
        XCTAssertEqual(BatteryCellStatus.low.severity, .warning)
        XCTAssertEqual(BatteryCellStatus.critical.severity, .danger)
        XCTAssertEqual(BatteryCellStatus.critical.displayKey, "Critical")
        XCTAssertEqual(BatteryCellStatus.from("MYSTERY"), .normal)
    }

    // MARK: Formatters

    func testNumberAndVoltageAndMillivolts() {
        XCTAssertEqual(BatteryCellsFormat.number(1234, decimals: 0), "1,234")
        XCTAssertEqual(BatteryCellsFormat.voltage(3.7, decimals: 4), "3.7000 V")
        XCTAssertEqual(BatteryCellsFormat.millivolts(12), "12.0 mV")
        XCTAssertEqual(BatteryCellsFormat.number(.nan, decimals: 1), "—")
    }

    func testSignedMillivolts() {
        XCTAssertEqual(BatteryCellsFormat.signedMillivolts(5), "+5.0")
        XCTAssertEqual(BatteryCellsFormat.signedMillivolts(-5), "-5.0")
        XCTAssertEqual(BatteryCellsFormat.signedMillivolts(0), "+0.0")
    }

    func testTemperatureSpreadDelta() {
        XCTAssertEqual(BatteryCellsFormat.temperatureSpread(5, fahrenheit: false, unitLabel: "°C"), "5.0°C")
        XCTAssertEqual(BatteryCellsFormat.temperatureSpread(5, fahrenheit: true, unitLabel: "°F"), "9.0°F")
    }
}
