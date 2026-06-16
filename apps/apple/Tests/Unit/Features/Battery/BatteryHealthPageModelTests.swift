import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for `BatteryHealthPageModel` — every data state the page
/// renders (loading / no-data empty / error / ready), the multi-source load (the primary
/// analytics source drives the phase; prediction / sessions / live are independent), the
/// vehicle auto-select + reselection, the pure derivations the web computes with `useMemo`
/// (insights bands, recommendations, the actual→projected trend bridge, range gating, the
/// charge-level distribution, charging habits, the AC/DC breakdown, new-vs-now), the live
/// staleness gate (ADR-013), and the display formatters (web `fmtNumber` / `fmtPercent`).
@MainActor
final class BatteryHealthPageModelTests: XCTestCase {
    private struct StubError: Error {}

    private struct StubSource: BatteryHealthDataSource {
        var vehicles: [BatteryVehicle]
        var analytics: [Int64: BatteryHealthAnalytics] = [:]
        var prediction: [Int64: BatteryHealthPrediction] = [:]
        var sessions: [Int64: [BatteryHealthChargingSession]] = [:]
        var live: [Int64: BatteryHealthLive] = [:]
        var failAnalytics = false
        var failPrediction = false

        func loadVehicles() async throws -> [BatteryVehicle] { vehicles }

        func loadAnalytics(vehicleID: Int64) async throws -> BatteryHealthAnalytics? {
            if failAnalytics { throw StubError() }
            return analytics[vehicleID]
        }

        func loadPrediction(vehicleID: Int64) async throws -> BatteryHealthPrediction? {
            if failPrediction { throw StubError() }
            return prediction[vehicleID]
        }

        func loadSessions(vehicleID: Int64) async throws -> [BatteryHealthChargingSession] {
            sessions[vehicleID] ?? []
        }

        func loadLive(vehicleID: Int64) async throws -> BatteryHealthLive? { live[vehicleID] }
    }

    private let prefs = UnitPreferences(
        distance: "km", speed: "km/h", temperature: "°C", pressure: "kPa",
        energy: "Wh", duration: "h", power: "W", precision: 0
    )

    private func vehicle(_ id: Int64, _ name: String) -> BatteryVehicle {
        BatteryVehicle(id: id, displayName: name, vin: "VIN\(id)")
    }

    private func point(_ date: String, soh: Double, range: Double) -> BatteryHealthHistoryPoint {
        BatteryHealthHistoryPoint(date: date, sohPct: soh, rangeKm: range)
    }

    private func analytics(
        soh: Double = 93,
        original: Double = 75,
        estimated: Double = 71,
        rate: Double = 2,
        dod: Double = 60,
        fast: Double = 38,
        full: Double = 22,
        history: [BatteryHealthHistoryPoint] = []
    ) -> BatteryHealthAnalytics {
        BatteryHealthAnalytics(
            currentSoh: soh, estimatedCapacityKwh: estimated, originalCapacityKwh: original,
            degradationRateYr: rate, batteryAgeMonths: 30, totalCycles: 412,
            avgDepthOfDischarge: dod, fastChargePct: fast, fullChargePct: full, history: history
        )
    }

    private func session(
        _ id: Int64, start: Double, end: Double? = nil, charger: String? = nil, peak: Double? = nil, wh: Double? = nil
    ) -> BatteryHealthChargingSession {
        BatteryHealthChargingSession(
            id: id, startSocPct: start, endSocPct: end, chargerType: charger, peakPowerW: peak, totalEnergyAddedWh: wh
        )
    }

    // MARK: - Phases

    func testLoadReadyState() async {
        var source = StubSource(vehicles: [vehicle(1, "Roci")])
        source.analytics[1] = analytics(history: [point("2025-01-15", soh: 99, range: 500)])
        let model = BatteryHealthPageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertNotNil(model.analytics)
    }

    func testNoDataEmptyState() async {
        let model = BatteryHealthPageModel(dataSource: StubSource(vehicles: [vehicle(1, "Roci")]))
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.analytics)
    }

    func testErrorState() async {
        var source = StubSource(vehicles: [vehicle(1, "Roci")])
        source.failAnalytics = true
        let model = BatteryHealthPageModel(dataSource: source)
        await model.load()
        guard case .error = model.phase else { return XCTFail("expected .error, got \(model.phase)") }
        XCTAssertNil(model.analytics)
    }

    func testNoVehiclesIsEmpty() async {
        let model = BatteryHealthPageModel(dataSource: StubSource(vehicles: []))
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.selectedVehicleID)
    }

    func testPredictionFailureKeepsReady() async {
        var source = StubSource(vehicles: [vehicle(1, "Roci")])
        source.analytics[1] = analytics()
        source.failPrediction = true
        let model = BatteryHealthPageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertNil(model.prediction)
    }

    func testVehicleReselection() async {
        var source = StubSource(vehicles: [vehicle(1, "Roci"), vehicle(2, "Tachi")])
        source.analytics[1] = analytics(soh: 95)
        source.analytics[2] = analytics(soh: 80)
        let model = BatteryHealthPageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.selectedVehicleID, 1)
        await model.selectVehicle(2)
        XCTAssertEqual(model.selectedVehicleID, 2)
        XCTAssertEqual(model.analytics?.currentSoh, 80)
    }

    // MARK: - Trend / range derivations

    func testTrendRowsBridgeActualIntoProjection() {
        let health = analytics(
            history: [point("2025-01-15", soh: 99, range: 500), point("2025-02-15", soh: 95, range: 480)]
        )
        let prediction = BatteryHealthPrediction(
            hasEnoughData: true, slopePerYear: -2, yearsTo80Pct: 6,
            projectionPoints: [BatteryHealthProjectionPoint(month: "2025-09", healthPct: 92)]
        )
        let rows = BatteryHealthDerivations.trendRows(analytics: health, prediction: prediction)
        XCTAssertEqual(rows.count, 3)
        XCTAssertEqual(rows[2].predicted, 92)
        XCTAssertEqual(rows[2].actual, 95, "first projected row bridges the last actual for continuity")
    }

    func testTrendRowsUntrustworthyProjectionOmitted() {
        let health = analytics(history: [point("2025-01-15", soh: 99, range: 500)])
        let prediction = BatteryHealthPrediction(
            hasEnoughData: true, slopePerYear: -80, yearsTo80Pct: 6,
            projectionPoints: [BatteryHealthProjectionPoint(month: "2025-09", healthPct: 92)]
        )
        let rows = BatteryHealthDerivations.trendRows(analytics: health, prediction: prediction)
        XCTAssertEqual(rows.count, 1)
        XCTAssertNil(rows[0].predicted)
    }

    func testRangeRowsGatedWhenAllZero() {
        let zeroed = analytics(
            history: [point("2025-01-15", soh: 99, range: 0), point("2025-02-15", soh: 95, range: 0)]
        )
        XCTAssertTrue(BatteryHealthDerivations.rangeRows(analytics: zeroed).isEmpty)
        let real = analytics(history: [point("2025-01-15", soh: 99, range: 500)])
        XCTAssertEqual(BatteryHealthDerivations.rangeRows(analytics: real).count, 1)
    }

    // MARK: - Session derivations

    private func mixedSessions() -> [BatteryHealthChargingSession] {
        [
            session(1, start: 8, end: 80, charger: "Tesla Supercharger", peak: 120_000, wh: 40_000),
            session(2, start: 45, end: 90, charger: nil, peak: 7_000, wh: 11_000),
            session(3, start: 30, end: 80, charger: "EVgo", peak: 50_000, wh: 33_000),
            session(4, start: 60, end: 95, charger: "", peak: 6_600, wh: 9_000)
        ]
    }

    func testChargeBuckets() {
        let buckets = BatteryHealthDerivations.chargeBuckets(sessions: mixedSessions())
        XCTAssertEqual(buckets.count, 10)
        XCTAssertEqual(buckets[0].startCount, 1, "start 8% lands in the 0–10% bucket")
        XCTAssertEqual(buckets[8].endCount, 2, "two sessions end at 80%, landing in the 80–90% bucket")
        XCTAssertTrue(BatteryHealthDerivations.chargeBuckets(sessions: []).isEmpty)
    }

    func testHabits() {
        let habits = BatteryHealthDerivations.habits(sessions: mixedSessions())
        XCTAssertEqual(habits?.superchargerCount, 1)
        XCTAssertEqual(habits?.dcFastCount, 1, "EVgo is non-Tesla DC fast")
        XCTAssertEqual(habits?.total, 4)
        XCTAssertEqual(habits?.homeCharges, 2)
        XCTAssertNil(BatteryHealthDerivations.habits(sessions: []))
    }

    func testEnergyBreakdown() {
        let breakdown = BatteryHealthDerivations.energyBreakdown(sessions: mixedSessions())
        // DC: #1 (super) + #3 (EVgo) = 2; AC: #2 + #4 = 2.
        XCTAssertEqual(breakdown?.dcCount, 2)
        XCTAssertEqual(breakdown?.acCount, 2)
        XCTAssertEqual(breakdown?.dcEnergyKwh ?? 0, 73, accuracy: 0.001, "40+33 kWh DC")
        XCTAssertEqual(breakdown?.acEnergyKwh ?? 0, 20, accuracy: 0.001, "11+9 kWh AC")
        XCTAssertEqual(breakdown?.totalSessions, 4)
        XCTAssertNil(BatteryHealthDerivations.energyBreakdown(sessions: []))
    }

    func testNewVsNow() {
        let health = analytics(
            original: 75, estimated: 70,
            history: [point("2025-01-15", soh: 99, range: 500), point("2025-08-15", soh: 93, range: 470)]
        )
        let data = BatteryHealthDerivations.newVsNow(analytics: health)
        XCTAssertEqual(data.lostCapacityKwh, 5, accuracy: 0.001)
        XCTAssertEqual(data.rangeNewKm, 500)
        XCTAssertEqual(data.rangeNowKm, 470)
        XCTAssertEqual(data.lostRangeKm, 30)
    }

    // MARK: - Insights + recommendations

    func testInsightBands() {
        let excellent = BatteryHealthDerivations.insights(analytics: analytics(soh: 95), sessions: nil, prefs: prefs)
        XCTAssertEqual(excellent.first?.titleKey, "battery.insight.excellentTitle")
        let good = BatteryHealthDerivations.insights(analytics: analytics(soh: 80), sessions: nil, prefs: prefs)
        XCTAssertEqual(good.first?.titleKey, "battery.insight.goodTitle")
        let concern = BatteryHealthDerivations.insights(analytics: analytics(soh: 60), sessions: nil, prefs: prefs)
        XCTAssertEqual(concern.first?.titleKey, "battery.insight.concernTitle")
    }

    func testInsightDeepDischargeAndLowDegradation() {
        let deepSessions = (0 ..< 4).map { session(Int64($0), start: 5, end: 80, charger: nil, peak: 7_000, wh: 9_000) }
        let items = BatteryHealthDerivations.insights(
            analytics: analytics(rate: 2), sessions: deepSessions, prefs: prefs
        )
        XCTAssertTrue(items.contains { $0.titleKey == "battery.insight.deepDischargeTitle" })
        XCTAssertTrue(items.contains { $0.titleKey == "battery.insight.lowDegTitle" })
    }

    func testRecommendations() {
        let risky = BatteryHealthDerivations.recommendationKeys(
            analytics: analytics(rate: 4, dod: 80, fast: 40, full: 50)
        )
        XCTAssertTrue(risky.contains("battery.tip.reduceFast"))
        XCTAssertTrue(risky.contains("battery.tip.avoid100"))
        XCTAssertTrue(risky.contains("battery.tip.avoidDeep"))
        XCTAssertTrue(risky.contains("battery.tip.aboveAvg"))
        let healthy = BatteryHealthDerivations.recommendationKeys(
            analytics: analytics(rate: 1, dod: 50, fast: 10, full: 10)
        )
        XCTAssertEqual(healthy, ["battery.tip.great"])
    }

    // MARK: - Live staleness (ADR-013)

    func testLiveFreshnessGate() async {
        var source = StubSource(vehicles: [vehicle(1, "Roci")])
        source.analytics[1] = analytics()
        source.live[1] = BatteryHealthLive(
            moduleTempMaxC: 30, moduleTempMinC: 25, numModuleTempMax: 7, numModuleTempMin: 2,
            batteryHeaterOn: false, bmsFullchargeComplete: true, updatedAt: Date()
        )
        let model = BatteryHealthPageModel(dataSource: source)
        await model.load()
        XCTAssertTrue(model.isLiveCharging)

        var stale = source
        stale.live[1] = BatteryHealthLive(
            moduleTempMaxC: 30, moduleTempMinC: 25, numModuleTempMax: 7, numModuleTempMin: 2,
            batteryHeaterOn: false, bmsFullchargeComplete: true, updatedAt: Date(timeIntervalSinceNow: -300)
        )
        let staleModel = BatteryHealthPageModel(dataSource: stale)
        await staleModel.load()
        XCTAssertFalse(staleModel.isLiveCharging, "live values older than 2 minutes are stale")
    }

    // MARK: - Formatters

    func testFormatters() {
        XCTAssertEqual(BatteryHealthFormat.kilowattHours(71.2), "71.2 kWh")
        XCTAssertEqual(BatteryHealthFormat.kilowattHours(fromWh: 42_000), 42, accuracy: 0.001)
        XCTAssertEqual(BatteryHealthFormat.temperature(32.4, prefs), "32.4 °C")
        XCTAssertEqual(BatteryHealthFormat.temperatureSpread(maxC: 32, minC: 28, prefs), "4.0 °C")
        XCTAssertEqual(BatteryHealthFormat.percent(38, decimals: 0), "38%")
        XCTAssertEqual(BatteryHealthFormat.yearsTo80(6.3, trustworthy: true), "6.3")
        XCTAssertEqual(BatteryHealthFormat.yearsTo80(6.3, trustworthy: false), "—")
    }
}
