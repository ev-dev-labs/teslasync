import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for `BatteryDegradationPageModel` — every data
/// state the page renders (loading / no-data empty / error / ready), the dual-source
/// load (primary health drives the phase, the secondary degradation source is
/// independent), the vehicle auto-select + reselection, the pure derivations the web
/// computes with `useMemo` (projection rows with the actual→projected bridge, range
/// rows, cycle-depth score, score/risk/SOH bands, charge-habit ratios), and the
/// display formatters (web `fmtNumber` + the `ageLabel` helper).
@MainActor
final class BatteryDegradationPageModelTests: XCTestCase {
    private struct StubError: Error {}

    private struct StubSource: BatteryDegradationDataSource {
        var vehicles: [BatteryVehicle]
        var health: [Int64: BatteryHealthData] = [:]
        var detail: [Int64: BatteryDegradationDetail] = [:]
        var failHealth = false
        var failDetail = false

        func loadVehicles() async throws -> [BatteryVehicle] {
            vehicles
        }

        func loadHealth(vehicleID: Int64) async throws -> BatteryHealthData? {
            if failHealth { throw StubError() }
            return health[vehicleID]
        }

        func loadDegradation(vehicleID: Int64) async throws -> BatteryDegradationDetail? {
            if failDetail { throw StubError() }
            return detail[vehicleID]
        }
    }

    private let prefs = UnitPreferences(
        distance: "km",
        speed: "km/h",
        temperature: "°C",
        pressure: "kPa",
        energy: "Wh",
        duration: "h",
        power: "W",
        precision: 0
    )

    private func vehicle(_ id: Int64, _ name: String) -> BatteryVehicle {
        BatteryVehicle(id: id, displayName: name, vin: "VIN\(id)")
    }

    private func snapshot(_ date: String, soh: Double, range: Double) -> BatteryHealthSnapshot {
        BatteryHealthSnapshot(date: date, odometerKm: 10000, sohPct: soh, capacityWh: 70000, rangeKm: range)
    }

    private func health(soh: Double, dod: Double = 60) -> BatteryHealthData {
        BatteryHealthData(
            currentSoh: soh,
            estimatedCapacityKwh: 71,
            degradationRateYr: 2,
            batteryAgeMonths: 30,
            totalCycles: 412,
            avgDepthOfDischarge: dod,
            fastChargePct: 38,
            fullChargePct: 22,
            chargeHabitsScore: 78,
            tempExposureScore: 84,
            history: [
                snapshot("2025-01-15", soh: 99, range: 505),
                snapshot("2025-02-15", soh: 97, range: 495),
                snapshot("2025-03-15", soh: soh, range: 480)
            ]
        )
    }

    private func detail() -> BatteryDegradationDetail {
        BatteryDegradationDetail(
            projections: [
                BatteryProjectionPoint(date: "Sep 2025", healthPct: 92, confidenceLow: 90, confidenceHigh: 94),
                BatteryProjectionPoint(date: "Mar 2026", healthPct: 88, confidenceLow: 85, confidenceHigh: 91)
            ],
            prediction: BatteryDegradationPrediction(
                hasEnoughData: true,
                slopePerYear: -2.1,
                yearsTo80Pct: 6,
                predictedDate: "Jan 2032"
            ),
            chargingHabits: BatteryChargingHabits(fastChargeCount: 120, slowChargeCount: 280, deepDischargeCount: 8),
            stressLevel: .medium,
            currentCycles: 400,
            riskFactors: [BatteryRiskFactor(name: "fast_charge_ratio", score: 58, label: "Elevated", detail: "x")],
            recommendations: ["Charge to 80%"]
        )
    }

    private func twoVehicleSource() -> StubSource {
        StubSource(
            vehicles: [vehicle(1, "Alpha"), vehicle(2, "Bravo")],
            health: [1: health(soh: 93.4), 2: health(soh: 82.0)],
            detail: [1: detail()]
        )
    }

    // MARK: Phases

    func testInitialPhaseIsLoading() {
        let model = BatteryDegradationPageModel(dataSource: twoVehicleSource())
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadResolvesToReady() async {
        let model = BatteryDegradationPageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertNotNil(model.health)
        XCTAssertNotNil(model.detail)
        XCTAssertEqual(model.vehicles.count, 2)
        XCTAssertEqual(model.selectedVehicleID, 1)
    }

    func testNilHealthResolvesToEmpty() async {
        let source = StubSource(vehicles: [vehicle(1, "Alpha")], health: [:])
        let model = BatteryDegradationPageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.health)
    }

    func testNoVehiclesResolvesToEmpty() async {
        let model = BatteryDegradationPageModel(dataSource: StubSource(vehicles: []))
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.selectedVehicleID)
    }

    func testHealthFailureResolvesToError() async {
        var source = twoVehicleSource()
        source.failHealth = true
        let model = BatteryDegradationPageModel(dataSource: source)
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected error phase, got \(model.phase)")
        }
        XCTAssertNil(model.health)
    }

    func testDegradationFailureKeepsReady() async {
        var source = twoVehicleSource()
        source.failDetail = true
        let model = BatteryDegradationPageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertNotNil(model.health)
        XCTAssertNil(model.detail)
    }

    // MARK: Selection

    func testSelectVehicleReloadsSnapshot() async {
        let model = BatteryDegradationPageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.health?.sohSeverity, .success)
        XCTAssertNotNil(model.detail)
        await model.selectVehicle(2)
        XCTAssertEqual(model.selectedVehicleID, 2)
        XCTAssertEqual(model.health?.sohSeverity, .warning)
        XCTAssertNil(model.detail)
    }

    func testSelectingSameVehicleIsNoOp() async {
        let model = BatteryDegradationPageModel(dataSource: twoVehicleSource())
        await model.load()
        await model.selectVehicle(1)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertEqual(model.phase, .ready)
    }

    func testRefreshKeepsReady() async {
        let model = BatteryDegradationPageModel(dataSource: twoVehicleSource())
        await model.load()
        await model.refresh()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.isRefreshing)
    }

    // MARK: Derivations

    func testProjectionRowsBridgeActualToProjected() async {
        let model = BatteryDegradationPageModel(dataSource: twoVehicleSource())
        await model.load()
        let rows = model.projectionRows
        XCTAssertEqual(rows.count, 5) // 3 history + 2 projections
        XCTAssertEqual(rows[0].health, 99)
        XCTAssertNil(rows[0].projected)
        // First projection row bridges to the last actual SOH so the lines connect.
        XCTAssertEqual(rows[3].health, 93.4)
        XCTAssertEqual(rows[3].projected, 92)
        XCTAssertEqual(rows[3].confidenceLow, 90)
        XCTAssertNil(rows[4].health)
        XCTAssertEqual(rows[4].projected, 88)
    }

    func testProjectionRowsEmptyWithoutData() {
        let rows = BatteryDegradationDerivations.projectionRows(health: nil, detail: nil)
        XCTAssertTrue(rows.isEmpty)
    }

    func testRangeRowsUseFirstAsOriginal() {
        let rows = health(soh: 93).rangeRows
        XCTAssertEqual(rows.count, 3)
        XCTAssertEqual(rows[0].originalKm, 505)
        XCTAssertEqual(rows[2].originalKm, 505)
        XCTAssertEqual(rows[2].currentKm, 480)
    }

    func testRangeRowsEmptyWithoutHistory() {
        let data = BatteryHealthData(
            currentSoh: 0, estimatedCapacityKwh: 0, degradationRateYr: 0, batteryAgeMonths: 0,
            totalCycles: 0, avgDepthOfDischarge: 0, fastChargePct: 0, fullChargePct: 0,
            chargeHabitsScore: 0, tempExposureScore: 0, history: []
        )
        XCTAssertTrue(data.rangeRows.isEmpty)
        XCTAssertFalse(data.hasHistory)
    }

    func testCycleDepthScore() {
        XCTAssertEqual(health(soh: 90, dod: 62.5).cycleDepthScore, 38)
        XCTAssertEqual(health(soh: 90, dod: 120).cycleDepthScore, 0)
    }

    func testScoreVariantBands() {
        XCTAssertEqual(BatteryDegradationScore.variant(85), .success)
        XCTAssertEqual(BatteryDegradationScore.variant(60), .warning)
        XCTAssertEqual(BatteryDegradationScore.variant(20), .danger)
    }

    func testRiskBands() {
        XCTAssertEqual(BatteryDegradationScore.risk(20), .success)
        XCTAssertEqual(BatteryDegradationScore.risk(45), .warning)
        XCTAssertEqual(BatteryDegradationScore.risk(80), .danger)
    }

    func testSohBandsAndLabels() {
        XCTAssertEqual(BatteryDegradationScore.soh(95), .success)
        XCTAssertEqual(BatteryDegradationScore.soh(85), .warning)
        XCTAssertEqual(BatteryDegradationScore.soh(70), .danger)
        XCTAssertEqual(BatteryDegradationScore.sohBandKey(95), "Excellent")
        XCTAssertEqual(BatteryDegradationScore.sohBandKey(85), "Good")
        XCTAssertEqual(BatteryDegradationScore.sohBandKey(70), "Degraded")
    }

    func testStressLevelMapping() {
        XCTAssertEqual(BatteryStressLevel.from("Low"), .low)
        XCTAssertEqual(BatteryStressLevel.from("MYSTERY"), .unknown)
        XCTAssertEqual(BatteryStressLevel.from(nil), .unknown)
        XCTAssertEqual(BatteryStressLevel.low.severity, .success)
        XCTAssertEqual(BatteryStressLevel.medium.severity, .warning)
        XCTAssertEqual(BatteryStressLevel.high.severity, .danger)
        XCTAssertEqual(BatteryStressLevel.medium.guidanceKey, "battery.degradation.stressMedium")
    }

    func testChargingHabitsFastChargePercent() {
        let habits = BatteryChargingHabits(fastChargeCount: 120, slowChargeCount: 280, deepDischargeCount: 8)
        XCTAssertEqual(habits.totalCharges, 400)
        XCTAssertEqual(habits.fastChargePercent, 30)
        let none = BatteryChargingHabits(fastChargeCount: 0, slowChargeCount: 0, deepDischargeCount: 0)
        XCTAssertEqual(none.fastChargePercent, 0)
    }

    func testRiskFactorIconAndSeverity() {
        let factor = BatteryRiskFactor(name: "temperature_exposure", score: 18, label: "Low", detail: "x")
        XCTAssertEqual(factor.systemImage, "thermometer.medium")
        XCTAssertEqual(factor.severity, .success)
        XCTAssertEqual(factor.humanizedName, "temperature exposure")
        let unknown = BatteryRiskFactor(name: "mystery_factor", score: 90, label: "High", detail: "x")
        XCTAssertEqual(unknown.systemImage, "shield.fill")
        XCTAssertEqual(unknown.severity, .danger)
    }

    // MARK: Formatters

    func testNumberIntegerPercent() {
        XCTAssertEqual(BatteryDegradationFormat.number(1234.5, decimals: 0), "1,234")
        XCTAssertEqual(BatteryDegradationFormat.integer(412), "412")
        XCTAssertEqual(BatteryDegradationFormat.percent(93.4, prefs), "93%")
        XCTAssertEqual(BatteryDegradationFormat.kilowattHours(71, prefs), "71 kWh")
        XCTAssertEqual(BatteryDegradationFormat.percentPerYear(2, prefs), "2%/yr")
        XCTAssertEqual(BatteryDegradationFormat.number(.nan, decimals: 1), "—")
    }

    func testAgeLabel() {
        XCTAssertEqual(BatteryDegradationFormat.ageLabel(months: 6), "6 months")
        XCTAssertEqual(BatteryDegradationFormat.ageLabel(months: 24), "2 years")
        XCTAssertEqual(BatteryDegradationFormat.ageLabel(months: 30), "2y 6m")
    }

    func testDistanceFromKmUsesUnitLabel() {
        let value = BatteryDegradationFormat.distanceFromKm(1000, prefs)
        XCTAssertTrue(value.hasSuffix(" km"), value)
        XCTAssertTrue(value.contains("1,000"), value)
    }
}
