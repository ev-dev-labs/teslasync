import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for `EnergyPageModel` — every data state the page renders
/// (loading / no-data empty / error banner / ready), the multi-source load (the stats source
/// drives the error banner, the sessions + telemetry sources are independent), the vehicle
/// auto-select + reselection, the pure derivations the web computes with `useMemo` (totals,
/// cost ratios, projections, time-of-day buckets, charger breakdown, the no-data gate), and the
/// display formatters (web `fmtNumber` / `fmtPercent` / `formatCurrency`).
@MainActor
final class EnergyPageModelTests: XCTestCase {
    private struct StubError: Error {}

    private struct StubSource: EnergyDataSource {
        var vehicles: [BatteryVehicle]
        var stats: [Int64: EnergyStats] = [:]
        var sessions: [Int64: [EnergyChargingSession]] = [:]
        var telemetry: [Int64: EnergyLiveCharging] = [:]
        var failStats = false

        func loadVehicles() async throws -> [BatteryVehicle] { vehicles }

        func loadStats(vehicleID: Int64) async throws -> EnergyStats? {
            if failStats { throw StubError() }
            return stats[vehicleID]
        }

        func loadSessions(vehicleID: Int64) async throws -> [EnergyChargingSession] {
            sessions[vehicleID] ?? []
        }

        func loadTelemetry(vehicleID: Int64) async throws -> EnergyLiveCharging? {
            telemetry[vehicleID]
        }
    }

    private let prefs = UnitPreferences(
        distance: "km",
        speed: "km/h",
        temperature: "°C",
        pressure: "kPa",
        energy: "kWh",
        duration: "h",
        power: "W",
        precision: 0
    )

    private var utcCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }

    private func vehicle(_ id: Int64) -> BatteryVehicle {
        BatteryVehicle(id: id, displayName: "V\(id)", vin: "VIN\(id)")
    }

    private func session(
        _ id: Int64,
        at startedAt: String,
        wh: Double,
        cost: Double?,
        type: String?,
        power: Double? = 50_000
    ) -> EnergyChargingSession {
        EnergyChargingSession(
            id: id,
            startedAt: startedAt,
            startSocPct: 20,
            endSocPct: 80,
            totalEnergyAddedWh: wh,
            peakPowerW: power,
            costDecimal: cost,
            chargerType: type
        )
    }

    private func stats(distanceM: Double, eff: Double, totalWh: Double, co2: Double?) -> EnergyStats {
        EnergyStats(
            totalEnergyUsedWh: totalWh,
            totalWh: totalWh,
            avgEfficiencyWhPerM: eff,
            totalDistanceM: distanceM,
            totalCost: 0,
            co2SavedKg: co2,
            dailyBreakdown: []
        )
    }

    // MARK: - State machine

    func testLoadPopulatesAndReadies() async {
        let stub = StubSource(
            vehicles: [vehicle(1)],
            stats: [1: stats(distanceM: 100_000, eff: 0.18, totalWh: 50_000, co2: 12)],
            sessions: [1: [session(1, at: "2026-05-20T08:00:00Z", wh: 30_000, cost: 9, type: nil)]],
            telemetry: [1: EnergyLiveCharging(lifetimeEnergyUsed: 1_234)]
        )
        let model = EnergyPageModel(dataSource: stub)
        await model.load()

        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertNotNil(model.stats)
        XCTAssertEqual(model.sessions.count, 1)
        XCTAssertEqual(model.telemetry?.lifetimeEnergyUsed, 1_234)
        XCTAssertNil(model.statsErrorMessage)
        XCTAssertFalse(model.hasNoEnergyData)
    }

    func testStatsErrorSetsBannerButStillReadies() async {
        var stub = StubSource(vehicles: [vehicle(1)])
        stub.failStats = true
        stub.sessions = [1: [session(1, at: "2026-05-20T08:00:00Z", wh: 10_000, cost: 3, type: nil)]]
        let model = EnergyPageModel(dataSource: stub)
        await model.load()

        XCTAssertEqual(model.phase, .ready)
        XCTAssertNotNil(model.statsErrorMessage)
        XCTAssertNil(model.stats)
        XCTAssertEqual(model.sessions.count, 1, "sessions load independently of the stats failure")
    }

    func testNoDataGate() async {
        let model = EnergyPageModel(dataSource: StubSource(vehicles: [vehicle(1)]))
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertTrue(model.hasNoEnergyData)
    }

    func testVehicleReselectionReloads() async {
        let stub = StubSource(
            vehicles: [vehicle(1), vehicle(2)],
            stats: [
                1: stats(distanceM: 100_000, eff: 0.18, totalWh: 50_000, co2: 12),
                2: stats(distanceM: 200_000, eff: 0.20, totalWh: 80_000, co2: 20)
            ],
            sessions: [2: [session(9, at: "2026-05-20T08:00:00Z", wh: 40_000, cost: 12, type: "ccs")]]
        )
        let model = EnergyPageModel(dataSource: stub)
        await model.load()
        XCTAssertEqual(model.selectedVehicleID, 1)

        await model.selectVehicle(2)
        XCTAssertEqual(model.selectedVehicleID, 2)
        XCTAssertEqual(model.stats?.totalDistanceM, 200_000)
        XCTAssertEqual(model.sessions.count, 1)
    }

    // MARK: - Totals + projections

    func testTotalsAndProjections() async {
        let stub = StubSource(
            vehicles: [vehicle(1)],
            stats: [1: stats(distanceM: 100_000, eff: 0.18, totalWh: 50_000, co2: nil)],
            sessions: [1: [
                session(1, at: "2026-05-20T08:00:00Z", wh: 30_000, cost: 9, type: nil),
                session(2, at: "2026-05-20T20:00:00Z", wh: 20_000, cost: 6, type: "ccs")
            ]]
        )
        let model = EnergyPageModel(dataSource: stub)
        await model.load()

        XCTAssertEqual(model.totalEnergyWh, 50_000, accuracy: 0.001)
        XCTAssertEqual(model.totalCost, 15, accuracy: 0.001)
        // costPerKwh = 15 / (50000/1000) = 0.30
        XCTAssertEqual(model.costPerKwh, 0.30, accuracy: 0.0001)
        // co2 fallback = totalEnergy * 0.42 = 21000
        XCTAssertEqual(model.co2SavedKg, 21_000, accuracy: 0.001)
        // costPerMeter = 15 / 100000 = 0.00015
        XCTAssertEqual(model.costPerMeter, 0.00015, accuracy: 1e-9)
        // monthly = costPerMeter * (distance/30) * 30 = costPerMeter * distance = 15
        XCTAssertEqual(model.monthlyProjectedCost, 15, accuracy: 1e-6)
        XCTAssertEqual(model.yearlyProjectedCost, 180, accuracy: 1e-6)
    }

    // MARK: - Pure derivations

    func testTimeOfDayBucketing() {
        let labels = ["Night", "Morning", "Afternoon", "Evening"]
        let sessions = [
            session(1, at: "2026-05-20T02:00:00Z", wh: 1_000, cost: 1, type: nil), // night
            session(2, at: "2026-05-20T09:00:00Z", wh: 2_000, cost: 2, type: nil), // morning
            session(3, at: "2026-05-20T09:30:00Z", wh: 3_000, cost: 3, type: nil), // morning
            session(4, at: "2026-05-20T14:00:00Z", wh: 4_000, cost: 4, type: nil), // afternoon
            session(5, at: "2026-05-20T21:00:00Z", wh: 5_000, cost: 5, type: nil)  // evening
        ]
        let buckets = EnergyDerivations.timeOfDay(sessions, labels: labels, calendar: utcCalendar)
        XCTAssertEqual(buckets.map(\.count), [1, 2, 1, 1])
        XCTAssertEqual(buckets[1].energyWh, 5_000, accuracy: 0.001)
        XCTAssertEqual(buckets.map(\.name), labels)
    }

    func testChargerBreakdown() {
        let sessions = [
            session(1, at: "2026-05-20T02:00:00Z", wh: 10_000, cost: 5, type: "tesla_supercharger"),
            session(2, at: "2026-05-20T03:00:00Z", wh: 20_000, cost: 8, type: "ccs"),
            session(3, at: "2026-05-20T04:00:00Z", wh: 30_000, cost: 4, type: nil)
        ]
        let rows = EnergyDerivations.chargerBreakdown(sessions)
        XCTAssertEqual(rows.map(\.name), ["Supercharger", "DC Fast", "Home/AC"])
        XCTAssertEqual(rows[0].colorIndex, 5)
        XCTAssertEqual(rows[1].colorIndex, 1)
        XCTAssertEqual(rows[2].colorIndex, 2)
        XCTAssertEqual(rows[2].energyWh, 30_000, accuracy: 0.001)
    }

    func testEmptyDerivations() {
        XCTAssertTrue(EnergyDerivations.timeOfDay([], labels: ["a", "b", "c", "d"]).isEmpty)
        XCTAssertTrue(EnergyDerivations.chargerBreakdown([]).isEmpty)
        XCTAssertEqual(EnergyDerivations.bucketIndex(for: nil), 0)
        XCTAssertEqual(EnergyDerivations.bucketIndex(for: 23), 3)
    }

    func testEfficiencyFallback() {
        // avg present → used directly.
        XCTAssertEqual(
            EnergyDerivations.efficiencyWhPerM(
                stats: stats(distanceM: 100_000, eff: 0.18, totalWh: 50_000, co2: nil),
                totalEnergyWh: 50_000,
                totalDistanceM: 100_000
            ),
            0.18,
            accuracy: 1e-9
        )
        // avg zero → fallback (totalEnergy * 1000) / distance.
        XCTAssertEqual(
            EnergyDerivations.efficiencyWhPerM(
                stats: stats(distanceM: 100_000, eff: 0, totalWh: 50_000, co2: nil),
                totalEnergyWh: 50_000,
                totalDistanceM: 100_000
            ),
            500,
            accuracy: 1e-6
        )
    }

    // MARK: - Formatters

    func testFormatters() {
        XCTAssertEqual(EnergyFormat.integer(12_345.6), "12,346")
        XCTAssertEqual(EnergyFormat.percent(25, decimals: 0), "25%")
        XCTAssertEqual(EnergyFormat.efficiencyUnit(prefs), "Wh/km")
        XCTAssertEqual(EnergyFormat.efficiencyDisplay(0.18, prefs), 180, accuracy: 1e-6)
        XCTAssertEqual(EnergyFormat.number(Double.nan, decimals: 2), "—")
        XCTAssertEqual(EnergyFormat.currency(nil), "—")
        XCTAssertTrue(EnergyFormat.currency(42.5).contains("42"))
    }

    func testEfficiencyUnitImperial() {
        var imperial = prefs
        imperial.distance = "mi"
        XCTAssertEqual(EnergyFormat.efficiencyUnit(imperial), "Wh/mi")
        XCTAssertEqual(EnergyFormat.efficiencyDisplay(0.18, imperial), 0.18 * 1609.344, accuracy: 1e-6)
    }

    // MARK: - Charger badge + power text (table cells)

    func testTableCellHelpers() {
        XCTAssertEqual(EnergySessionsSection.powerText(nil), "—")
        XCTAssertEqual(EnergySessionsSection.powerText(150_000), "150 kW")
        let withCost = session(1, at: "2026-05-20T08:00:00Z", wh: 20_000, cost: 6, type: nil)
        XCTAssertTrue(EnergySessionsSection.perKwhText(withCost).contains("0"))
        let noCost = session(2, at: "2026-05-20T08:00:00Z", wh: 20_000, cost: nil, type: nil)
        XCTAssertEqual(EnergySessionsSection.perKwhText(noCost), "—")
    }
}
