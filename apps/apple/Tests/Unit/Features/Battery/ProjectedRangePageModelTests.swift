import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for `ProjectedRangePageModel` — every data state the page
/// renders (loading / no-data empty / error / ready), the vehicle auto-select + reselection, the
/// pure derivations the web computes with `useMemo` (the what-if interpolation, the efficiency
/// buckets/tone, the gauge color, the scenario + factor icon maps), the display formatters (web
/// `fmtNumber` + the signed impact + the Wh/km intensity), the live what-if result, and the route
/// metadata + registration.
@MainActor
final class ProjectedRangePageModelTests: XCTestCase {
    private struct StubError: Error {}

    private actor StubSource: ProjectedRangeDataSource {
        let vehicles: [BatteryVehicle]
        let projections: [Int64: ProjectedRangeSnapshot]
        let failProjection: Bool

        init(
            vehicles: [BatteryVehicle],
            projections: [Int64: ProjectedRangeSnapshot] = [:],
            failProjection: Bool = false
        ) {
            self.vehicles = vehicles
            self.projections = projections
            self.failProjection = failProjection
        }

        func loadVehicles() async throws -> [BatteryVehicle] { vehicles }

        func loadProjection(vehicleID: Int64) async throws -> ProjectedRangeSnapshot? {
            if failProjection { throw StubError() }
            return projections[vehicleID]
        }
    }

    private func vehicle(_ id: Int64, _ name: String) -> BatteryVehicle {
        BatteryVehicle(id: id, displayName: name, vin: "VIN\(id)")
    }

    private func projection(
        efficiencyFactor: Double = 0.86,
        battery: Double = 72,
        matrix: [EfficiencyBucket] = [],
        scenarios: [RangeScenario] = [],
        factors: [RangeFactor] = [],
        curve: [RangeCurvePoint] = []
    ) -> ProjectedRangeSnapshot {
        ProjectedRangeSnapshot(
            currentRangeM: 372_000, projectedRangeM: 341_000, batteryLevel: battery,
            efficiencyFactor: efficiencyFactor, factors: factors, projectionCurve: curve,
            currentBatteryPct: battery, usableCapacityWh: 75_000, healthFactor: 0.94,
            scenarios: scenarios, efficiencyMatrix: matrix, teslaEstimateM: 388_000,
            yourEstimateM: 372_000, accuracyNote: "note"
        )
    }

    private func twoVehicleSource() -> StubSource {
        StubSource(
            vehicles: [vehicle(1, "Alpha"), vehicle(2, "Bravo")],
            projections: [1: projection(efficiencyFactor: 0.86), 2: projection(efficiencyFactor: 0.64)]
        )
    }

    // MARK: Phases

    func testInitialPhaseIsLoading() {
        let model = ProjectedRangePageModel(dataSource: twoVehicleSource())
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadResolvesToReady() async {
        let model = ProjectedRangePageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertNotNil(model.projection)
        XCTAssertEqual(model.vehicles.count, 2)
        XCTAssertEqual(model.selectedVehicleID, 1)
    }

    func testNilProjectionResolvesToEmpty() async {
        let source = StubSource(vehicles: [vehicle(1, "Alpha")], projections: [:])
        let model = ProjectedRangePageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.projection)
    }

    func testNoVehiclesResolvesToEmpty() async {
        let model = ProjectedRangePageModel(dataSource: StubSource(vehicles: []))
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.selectedVehicleID)
    }

    func testProjectionFailureResolvesToError() async {
        let source = StubSource(
            vehicles: [vehicle(1, "Alpha")],
            projections: [1: projection()],
            failProjection: true
        )
        let model = ProjectedRangePageModel(dataSource: source)
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected error phase, got \(model.phase)")
        }
        XCTAssertNil(model.projection)
    }

    // MARK: Selection

    func testSelectVehicleReloadsProjection() async {
        let model = ProjectedRangePageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.projection?.efficiencyFactor, 0.86)
        await model.selectVehicle(2)
        XCTAssertEqual(model.selectedVehicleID, 2)
        XCTAssertEqual(model.projection?.efficiencyFactor, 0.64)
        XCTAssertEqual(model.phase, .ready)
    }

    func testSelectingSameVehicleIsNoOp() async {
        let model = ProjectedRangePageModel(dataSource: twoVehicleSource())
        await model.load()
        await model.selectVehicle(1)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertEqual(model.phase, .ready)
    }

    func testRefreshKeepsReady() async {
        let model = ProjectedRangePageModel(dataSource: twoVehicleSource())
        await model.load()
        await model.refresh()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.isRefreshing)
    }

    // MARK: What-if result (web `whatIfResult` memo)

    func testWhatIfResultIsNilWithoutProjection() {
        let model = ProjectedRangePageModel(dataSource: StubSource(vehicles: []))
        XCTAssertNil(model.whatIfResult)
    }

    func testWhatIfResultUsesMatchedBucket() async {
        let bucket = EfficiencyBucket(
            tempBucket: "mild", speedBucket: "suburban", efficiencyWhPerM: 0.165, samples: 20
        )
        let source = StubSource(vehicles: [vehicle(1, "Alpha")], projections: [1: projection(matrix: [bucket])])
        let model = ProjectedRangePageModel(dataSource: source)
        await model.load()
        // Defaults: 80 km/h (22.22 m/s → suburban), 20 °C (mild). 75000 * 0.72 / 165 = 327.3 km.
        let result = try? XCTUnwrap(model.whatIfResult)
        XCTAssertEqual(result?.efficiencyWhPerM ?? 0, 0.165, accuracy: 0.0001)
        XCTAssertEqual(result?.rangeM ?? 0, 327_300, accuracy: 1)
    }

    func testGaugeColorIndexFromFactor() async {
        let model = ProjectedRangePageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.gaugeColorIndex, 3) // 0.86 → amber band
    }

    func testTipsAreTheFourStaticTips() {
        let model = ProjectedRangePageModel(dataSource: StubSource(vehicles: []))
        XCTAssertEqual(model.tips.count, 4)
        XCTAssertEqual(model.tips.map(\.textKey), [
            "range.tip.speed", "range.tip.precondition", "range.tip.seatHeaters", "range.tip.elevation"
        ])
    }

    // MARK: Derivations — buckets + interpolation (web `interpolateRange`)

    func testTempBuckets() {
        XCTAssertEqual(ProjectedRangeDerivations.tempBucket(forCelsius: -5), "freezing")
        XCTAssertEqual(ProjectedRangeDerivations.tempBucket(forCelsius: 5), "cold")
        XCTAssertEqual(ProjectedRangeDerivations.tempBucket(forCelsius: 20), "mild")
        XCTAssertEqual(ProjectedRangeDerivations.tempBucket(forCelsius: 30), "hot")
    }

    func testSpeedBuckets() {
        XCTAssertEqual(ProjectedRangeDerivations.speedBucket(forMetersPerSecond: 10), "city")    // 36 km/h
        XCTAssertEqual(ProjectedRangeDerivations.speedBucket(forMetersPerSecond: 20), "suburban") // 72 km/h
        XCTAssertEqual(ProjectedRangeDerivations.speedBucket(forMetersPerSecond: 30), "highway")  // 108 km/h
    }

    func testInterpolateFallbackHeuristic() {
        let result = ProjectedRangeDerivations.interpolate(
            matrix: [], speedMps: 80.0 / 3.6, tempC: 20, batteryPct: 72, capacityWh: 75_000
        )
        // Fallback: 155 + (80-35)*0.5 + 0 = 177.5 Wh/km; 75000*0.72/177.5 = 304.2 km.
        XCTAssertEqual(result.efficiencyWhPerM, 0.1775, accuracy: 0.0001)
        XCTAssertEqual(result.rangeM, 304_200, accuracy: 1)
    }

    func testInterpolateClampsNonPositiveEfficiency() {
        let matrix = [EfficiencyBucket(tempBucket: "mild", speedBucket: "highway", efficiencyWhPerM: 0, samples: 1)]
        let result = ProjectedRangeDerivations.interpolate(
            matrix: matrix, speedMps: 30, tempC: 20, batteryPct: 100, capacityWh: 75_000
        )
        // Zero bucket → clamped to 170 Wh/km; 75000/170 = 441.2 km.
        XCTAssertEqual(result.efficiencyWhPerM, 0.170, accuracy: 0.0001)
        XCTAssertEqual(result.rangeM, 441_200, accuracy: 1)
    }

    func testEfficiencyToneBands() {
        XCTAssertEqual(ProjectedRangeDerivations.efficiencyTone(whPerM: 0.150), .success)
        XCTAssertEqual(ProjectedRangeDerivations.efficiencyTone(whPerM: 0.195), .warning)
        XCTAssertEqual(ProjectedRangeDerivations.efficiencyTone(whPerM: 0.255), .danger)
    }

    func testGaugeColorIndexBands() {
        XCTAssertEqual(ProjectedRangeDerivations.gaugeColorIndex(efficiencyFactor: 0.95), 1)
        XCTAssertEqual(ProjectedRangeDerivations.gaugeColorIndex(efficiencyFactor: 0.80), 3)
        XCTAssertEqual(ProjectedRangeDerivations.gaugeColorIndex(efficiencyFactor: 0.50), 5)
    }

    // MARK: Derivations — icons (web `scenarioIcon` + `FACTOR_ICONS`)

    func testScenarioSymbol() {
        let sentry = RangeScenario(
            name: "Sentry", speedMps: 0, tempC: 16, efficiencyWhPerM: 0.17,
            rangeM: 1, sampleCount: 1, extras: ["sentry"], isCurrent: false
        )
        let cold = RangeScenario(
            name: "Cold", speedMps: 10, tempC: -4, efficiencyWhPerM: 0.24,
            rangeM: 1, sampleCount: 1, extras: [], isCurrent: false
        )
        let fast = RangeScenario(
            name: "Fast", speedMps: 30, tempC: 20, efficiencyWhPerM: 0.20,
            rangeM: 1, sampleCount: 1, extras: [], isCurrent: false
        )
        let normal = RangeScenario(
            name: "Normal", speedMps: 10, tempC: 20, efficiencyWhPerM: 0.16,
            rangeM: 1, sampleCount: 1, extras: [], isCurrent: false
        )
        XCTAssertEqual(ProjectedRangeDerivations.scenarioSymbol(for: sentry), "shield.fill")
        XCTAssertEqual(ProjectedRangeDerivations.scenarioSymbol(for: cold), "snowflake")
        XCTAssertEqual(ProjectedRangeDerivations.scenarioSymbol(for: fast), "car.fill")
        XCTAssertEqual(ProjectedRangeDerivations.scenarioSymbol(for: normal), "bolt.fill")
    }

    func testFactorSymbol() {
        XCTAssertEqual(ProjectedRangeDerivations.factorSymbol(name: "temperature"), "thermometer.medium")
        XCTAssertEqual(ProjectedRangeDerivations.factorSymbol(name: "speed"), "car.fill")
        XCTAssertEqual(ProjectedRangeDerivations.factorSymbol(name: "hvac"), "wind")
        XCTAssertEqual(ProjectedRangeDerivations.factorSymbol(name: "elevation"), "mountain.2.fill")
        XCTAssertEqual(
            ProjectedRangeDerivations.factorSymbol(name: "mystery"),
            "gauge.with.dots.needle.bottom.50percent"
        )
    }

    // MARK: Model derived guards + matrix lookup

    func testProjectionDerivedGuards() {
        let full = projection(
            matrix: [EfficiencyBucket(tempBucket: "mild", speedBucket: "city", efficiencyWhPerM: 0.15, samples: 4)],
            scenarios: [RangeScenario(
                name: "S", speedMps: 10, tempC: 20, efficiencyWhPerM: 0.16,
                rangeM: 1, sampleCount: 4, extras: [], isCurrent: true
            )],
            curve: [RangeCurvePoint(batteryPct: 50, ratedRangeM: 1, projectedRangeM: 1)]
        )
        XCTAssertTrue(full.hasMatrix)
        XCTAssertTrue(full.hasScenarios)
        XCTAssertTrue(full.hasCurve)
        XCTAssertNotNil(full.matrixBucket(temp: "mild", speed: "city"))
        XCTAssertNil(full.matrixBucket(temp: "hot", speed: "highway"))

        let bare = projection()
        XCTAssertFalse(bare.hasMatrix)
        XCTAssertFalse(bare.hasScenarios)
        XCTAssertFalse(bare.hasCurve)
    }

    func testBatteryCardPercentFallsBackToLevel() {
        let withPct = ProjectedRangeSnapshot(
            currentRangeM: 0, projectedRangeM: 0, batteryLevel: 40, efficiencyFactor: 0.8,
            factors: [], projectionCurve: [], currentBatteryPct: 0, usableCapacityWh: 75_000,
            healthFactor: 1, scenarios: [], efficiencyMatrix: [], teslaEstimateM: 0,
            yourEstimateM: 0, accuracyNote: ""
        )
        XCTAssertEqual(withPct.batteryCardPercent, 40)
    }

    // MARK: Formatters (web `fmtNumber` + signed impact + Wh/km)

    func testNumberAndPercent() {
        XCTAssertEqual(ProjectedRangePageFormat.number(1234.5, decimals: 0), "1,234")
        XCTAssertEqual(ProjectedRangePageFormat.number(.nan, decimals: 1), "—")
        XCTAssertEqual(ProjectedRangePageFormat.batteryPercent(72), "72%")
        XCTAssertEqual(ProjectedRangePageFormat.healthFactorPercent(0.94), "94.0%")
    }
}

// MARK: - Formatters + route (split out to keep the main test-case body within limits)

@MainActor
extension ProjectedRangePageModelTests {
    func testSignedImpactAndEfficiency() {
        XCTAssertEqual(ProjectedRangePageFormat.signedImpact(1.2), "+1.2%")
        XCTAssertEqual(ProjectedRangePageFormat.signedImpact(-2.0), "-2.0%")
        XCTAssertEqual(ProjectedRangePageFormat.efficiencyWhPerKm(0.195), "195 Wh/km")
        XCTAssertEqual(ProjectedRangePageFormat.matrixCellWhPerKm(0.165), "165")
    }

    // MARK: Route + registration

    func testRouteMetadata() {
        XCTAssertEqual(AppRoute.projectedRange.pathSegment, "projected-range")
        XCTAssertEqual(AppRoute.projectedRange.path, "/projected-range")
        XCTAssertEqual(AppRoute.projectedRange.group, .energy)
        XCTAssertEqual(AppRouteParser.parse(path: "/projected-range"), .projectedRange)
    }

    func testWebAliasResolves() {
        XCTAssertEqual(AppRouteParser.parse(path: "/analytics/range"), .projectedRange)
    }

    func testRouteRegistrationRegistersPage() {
        let registry = ProjectedRangeRouteRegistration.registry()
        XCTAssertTrue(registry.registeredRoutes.contains(.projectedRange))
    }
}
