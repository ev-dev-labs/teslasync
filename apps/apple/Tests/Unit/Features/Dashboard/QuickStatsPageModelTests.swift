import SwiftUI
import XCTest
@testable import TeslaSync

/// State-machine + derivation + formatter tests for `QuickStatsPageModel` — every data state the
/// page renders (loading / error / ready-with-vehicle / ready-no-vehicle empty), the first-vehicle
/// resolution, the soft-failing state read, the `vehiclesError || analyticsError` gate, the metric
/// `?? 0` fallbacks, the pure derivations (`resolvedName`, `displayState`), the display formatters
/// (web `fmtInt` + `formatCurrency` + the SI `convertDistanceFromSI` render), and the route
/// registration. Mirrors the sibling `GlancePageModelTests` / `GlanceDerivationsTests`.
@MainActor
final class QuickStatsPageModelTests: XCTestCase {
    private struct StubError: Error {}

    private actor StubSource: QuickStatsPageDataSource {
        let vehicles: [QuickStatsPageVehicle]
        let summary: QuickStatsPageSummary
        let states: [Int64: QuickStatsPageVehicleState]
        let failVehicles: Bool
        let failSummary: Bool
        let failState: Bool
        private(set) var stateLoads = 0

        init(
            vehicles: [QuickStatsPageVehicle],
            summary: QuickStatsPageSummary = .zero,
            states: [Int64: QuickStatsPageVehicleState] = [:],
            failVehicles: Bool = false,
            failSummary: Bool = false,
            failState: Bool = false
        ) {
            self.vehicles = vehicles
            self.summary = summary
            self.states = states
            self.failVehicles = failVehicles
            self.failSummary = failSummary
            self.failState = failState
        }

        func loadVehicles() async throws -> [QuickStatsPageVehicle] {
            if failVehicles { throw StubError() }
            return vehicles
        }

        func loadSummary(days _: Int) async throws -> QuickStatsPageSummary {
            if failSummary { throw StubError() }
            return summary
        }

        func loadState(vehicleID: Int64) async throws -> QuickStatsPageVehicleState? {
            stateLoads += 1
            if failState { throw StubError() }
            return states[vehicleID]
        }

        func recordedStateLoads() -> Int {
            stateLoads
        }
    }

    private func vehicle(_ id: Int64, _ name: String, model: String = "Model 3") -> QuickStatsPageVehicle {
        QuickStatsPageVehicle(id: id, displayName: name, model: model)
    }

    private func summary() -> QuickStatsPageSummary {
        QuickStatsPageSummary(totalDistanceM: 384_000, totalDrives: 342, totalEnergyWh: 2_450_000, totalCost: 511)
    }

    // MARK: Phases

    func testInitialPhaseIsLoading() {
        let model = QuickStatsPageModel(dataSource: StubSource(vehicles: [vehicle(1, "Alpha")]))
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadResolvesToReadyWithFirstVehicle() async {
        let source = StubSource(
            vehicles: [vehicle(1, "Alpha"), vehicle(2, "Bravo")],
            summary: summary(),
            states: [1: QuickStatsPageVehicleState(state: "online")]
        )
        let model = QuickStatsPageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.vehicle?.id, 1)
        XCTAssertEqual(model.state?.state, "online")
        XCTAssertEqual(model.summary?.totalDrives, 342)
    }

    func testNoVehiclesResolvesToReadyWithNilVehicleButKeepsMetrics() async {
        let model = QuickStatsPageModel(dataSource: StubSource(vehicles: [], summary: summary()))
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertNil(model.vehicle)
        XCTAssertFalse(model.hasVehicle)
        XCTAssertEqual(model.metrics.totalDrives, 342)
    }

    func testVehiclesFailureResolvesToError() async {
        let model = QuickStatsPageModel(dataSource: StubSource(vehicles: [], failVehicles: true))
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected error phase, got \(model.phase)")
        }
    }

    func testSummaryFailureResolvesToError() async {
        let source = StubSource(vehicles: [vehicle(1, "Alpha")], failSummary: true)
        let model = QuickStatsPageModel(dataSource: source)
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected error phase, got \(model.phase)")
        }
    }

    func testStateFailureStaysReadyWithNilState() async {
        let source = StubSource(vehicles: [vehicle(1, "Alpha")], summary: summary(), failState: true)
        let model = QuickStatsPageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertNil(model.state)
    }

    func testRefreshKeepsReady() async {
        let source = StubSource(vehicles: [vehicle(1, "Alpha")], summary: summary())
        let model = QuickStatsPageModel(dataSource: source)
        await model.load()
        await model.refresh()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.isRefreshing)
    }

    // MARK: Metrics fallback (web `analytics?.x ?? 0`)

    func testMetricsFallBackToZeroBeforeLoad() {
        let model = QuickStatsPageModel(dataSource: StubSource(vehicles: []))
        XCTAssertEqual(model.metrics, .zero)
    }

    func testSummaryZeroConstantIsAllZero() {
        XCTAssertEqual(QuickStatsPageSummary.zero.totalDistanceM, 0)
        XCTAssertEqual(QuickStatsPageSummary.zero.totalDrives, 0)
        XCTAssertEqual(QuickStatsPageSummary.zero.totalEnergyWh, 0)
        XCTAssertEqual(QuickStatsPageSummary.zero.totalCost, 0)
    }

    // MARK: Derivations

    func testResolvedVehicleName() {
        XCTAssertEqual(vehicle(1, "Rocinante").resolvedName, "Rocinante")
        XCTAssertNil(QuickStatsPageVehicle(id: 1, displayName: "", model: "Model Y").resolvedName)
    }

    func testDisplayStateOfflineFallback() {
        XCTAssertEqual(QuickStatsPageVehicleState(state: "online").displayState, "online")
        XCTAssertEqual(QuickStatsPageVehicleState(state: nil).displayState, "offline")
        XCTAssertEqual(QuickStatsPageVehicleState(state: "").displayState, "offline")
        XCTAssertEqual(QuickStatsPageVehicleState.offlineSentinel, "offline")
    }

    // MARK: Formatters (web fmtInt + formatCurrency + SI converters)

    func testNumberAndIntegerFormatting() {
        XCTAssertEqual(QuickStatsPageFormat.number(1234.56, decimals: 2), "1,234.56")
        XCTAssertEqual(QuickStatsPageFormat.integer(2450), "2,450")
        XCTAssertEqual(QuickStatsPageFormat.integer(.nan), "—")
    }

    func testDistanceDrivenMetricAndImperial() {
        XCTAssertEqual(QuickStatsPageFormat.distanceDriven(384_000, .metric), "384")
        XCTAssertEqual(QuickStatsPageFormat.distanceDriven(384_000, .imperial), "239")
    }

    func testDrivesFormatting() {
        XCTAssertEqual(QuickStatsPageFormat.drives(342), "342")
        XCTAssertEqual(QuickStatsPageFormat.drives(0), "0")
    }

    func testEnergyKWhFormatting() {
        XCTAssertEqual(QuickStatsPageFormat.energyKWh(2_450_000), "2,450")
        XCTAssertEqual(QuickStatsPageFormat.energyKWh(0), "0")
    }

    func testCurrencyFormatting() {
        XCTAssertTrue(QuickStatsPageFormat.currency(511).contains("511"))
        XCTAssertEqual(QuickStatsPageFormat.currency(.infinity), "—")
    }

    // MARK: Route + registration

    func testRouteMetadata() {
        XCTAssertEqual(AppRoute.quickStats.pathSegment, "quick-stats")
        XCTAssertEqual(AppRoute.quickStats.path, "/quick-stats")
        XCTAssertEqual(AppRoute.quickStats.group, .overview)
        XCTAssertEqual(AppRouteParser.parse(path: "/quick-stats"), .quickStats)
    }

    func testRouteRegistrationRegistersPage() {
        let registry = QuickStatsRouteRegistration.registry()
        XCTAssertTrue(registry.registeredRoutes.contains(.quickStats))
    }
}
