import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for `PowersharePageModel` — every data state the page
/// renders (loading / error / ready with populated or empty snapshot), the vehicle
/// auto-select + reselection + refresh, the pure derivations the web computes inline (the
/// `hasData` guard, the stop-reason presence, and the `statusVariant` / `stopReasonVariant`
/// badge-tone maps), and the display formatters (web `fmtNumber` + the `?? '—'` fallbacks).
@MainActor
final class PowersharePageModelTests: XCTestCase {
    private struct StubError: Error {}

    private actor StubSource: PowershareDataSource {
        let vehicles: [PowershareVehicle]
        let snapshots: [Int64: PowershareSnapshot]
        let failSnapshot: Bool
        private(set) var lastVehicleID: Int64?

        init(
            vehicles: [PowershareVehicle],
            snapshots: [Int64: PowershareSnapshot] = [:],
            failSnapshot: Bool = false
        ) {
            self.vehicles = vehicles
            self.snapshots = snapshots
            self.failSnapshot = failSnapshot
        }

        func loadVehicles() async throws -> [PowershareVehicle] {
            vehicles
        }

        func loadSnapshot(vehicleID: Int64) async throws -> PowershareSnapshot {
            lastVehicleID = vehicleID
            if failSnapshot { throw StubError() }
            return snapshots[vehicleID] ?? .empty
        }
    }

    private func vehicle(_ id: Int64, _ name: String) -> PowershareVehicle {
        PowershareVehicle(id: id, displayName: name, vin: "VIN\(id)")
    }

    private func active(_ power: Double, hours: Double) -> PowershareSnapshot {
        PowershareSnapshot(
            status: "Active",
            shareType: "Home",
            stopReason: "None",
            hoursLeft: hours,
            powerKw: power
        )
    }

    private func twoVehicleSource() -> StubSource {
        StubSource(
            vehicles: [vehicle(1, "Alpha"), vehicle(2, "Bravo")],
            snapshots: [1: active(7.4, hours: 8.5), 2: active(3.2, hours: 4.0)]
        )
    }

    // MARK: Phases

    func testInitialPhaseIsLoading() {
        let model = PowersharePageModel(dataSource: twoVehicleSource())
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadResolvesToReady() async {
        let model = PowersharePageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.vehicles.count, 2)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertEqual(model.snapshot.powerKw, 7.4)
        XCTAssertTrue(model.snapshot.hasData)
    }

    func testNoVehiclesResolvesToReadyWithEmptySnapshot() async {
        let model = PowersharePageModel(dataSource: StubSource(vehicles: []))
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertNil(model.selectedVehicleID)
        XCTAssertFalse(model.snapshot.hasData)
        XCTAssertFalse(model.snapshot.hasStopReason)
    }

    func testEmptySnapshotIsReadyButHasNoData() async {
        let source = StubSource(vehicles: [vehicle(1, "Alpha")], snapshots: [1: .empty])
        let model = PowersharePageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.snapshot.hasData)
    }

    func testSnapshotFailureResolvesToError() async {
        let source = StubSource(vehicles: [vehicle(1, "Alpha")], failSnapshot: true)
        let model = PowersharePageModel(dataSource: source)
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected error phase, got \(model.phase)")
        }
        XCTAssertFalse(model.snapshot.hasData)
    }

    // MARK: Selection + refresh

    func testSelectVehicleReloadsSnapshot() async {
        let model = PowersharePageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.snapshot.powerKw, 7.4)
        await model.selectVehicle(2)
        XCTAssertEqual(model.selectedVehicleID, 2)
        XCTAssertEqual(model.snapshot.powerKw, 3.2)
        XCTAssertEqual(model.phase, .ready)
    }

    func testSelectingSameVehicleIsNoOp() async {
        let model = PowersharePageModel(dataSource: twoVehicleSource())
        await model.load()
        await model.selectVehicle(1)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertEqual(model.phase, .ready)
    }

    func testRefreshKeepsReady() async {
        let model = PowersharePageModel(dataSource: twoVehicleSource())
        await model.load()
        await model.refresh()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.isRefreshing)
    }

    // MARK: Derivations — hasData / hasStopReason

    func testHasDataGuard() {
        XCTAssertFalse(PowershareSnapshot.empty.hasData)
        let onlyPower = PowershareSnapshot(
            status: nil, shareType: nil, stopReason: nil, hoursLeft: nil, powerKw: 1.2
        )
        XCTAssertTrue(onlyPower.hasData)
        let onlyStatus = PowershareSnapshot(
            status: "Active", shareType: nil, stopReason: nil, hoursLeft: nil, powerKw: nil
        )
        XCTAssertTrue(onlyStatus.hasData)
    }

    func testHasStopReason() {
        XCTAssertFalse(PowershareSnapshot.empty.hasStopReason)
        let reason = PowershareSnapshot(
            status: nil, shareType: nil, stopReason: "None", hoursLeft: nil, powerKw: nil
        )
        XCTAssertTrue(reason.hasStopReason)
    }

    // MARK: Derivations — badge tones (web statusVariant / stopReasonVariant)

    func testStatusToneMap() {
        XCTAssertEqual(PowershareTone.status(nil), .neutral)
        XCTAssertEqual(PowershareTone.status("Active"), .success)
        XCTAssertEqual(PowershareTone.status("Error"), .danger)
        XCTAssertEqual(PowershareTone.status("Failed"), .danger)
        XCTAssertEqual(PowershareTone.status("Off"), .neutral)
        XCTAssertEqual(PowershareTone.status("Standby"), .warning)
    }

    func testStopReasonToneMap() {
        XCTAssertEqual(PowershareTone.stopReason(nil), .neutral)
        XCTAssertEqual(PowershareTone.stopReason("None"), .neutral)
        XCTAssertEqual(PowershareTone.stopReason(""), .neutral)
        XCTAssertEqual(PowershareTone.stopReason("User Stopped"), .warning)
        XCTAssertEqual(PowershareTone.stopReason("Fault"), .danger)
        XCTAssertEqual(PowershareTone.stopReason("Low Battery"), .danger)
        XCTAssertEqual(PowershareTone.stopReason("Scheduled"), .warning)
    }

    // MARK: Formatters

    func testPowerFormatting() {
        XCTAssertEqual(PowershareFormat.power(7.4), "7.40")
        XCTAssertEqual(PowershareFormat.power(1234.5), "1,234.50")
        XCTAssertEqual(PowershareFormat.power(nil), "—")
        XCTAssertEqual(PowershareFormat.power(.nan), "—")
    }

    func testHoursFormatting() {
        XCTAssertEqual(PowershareFormat.hours(8.5), "8.5")
        XCTAssertEqual(PowershareFormat.hours(nil), "—")
        XCTAssertEqual(PowershareFormat.hours(.infinity), "—")
    }

    func testTextFallback() {
        XCTAssertEqual(PowershareFormat.text("Home"), "Home")
        XCTAssertEqual(PowershareFormat.text(nil), "—")
        XCTAssertEqual(PowershareFormat.text(""), "—")
    }

    func testNumberGrouping() {
        XCTAssertEqual(PowershareFormat.number(1234.5, decimals: 0), "1,234")
        XCTAssertEqual(PowershareFormat.number(.nan, decimals: 1), "—")
    }

    // MARK: Route + registration

    func testRouteMetadata() {
        XCTAssertEqual(AppRoute.powershare.pathSegment, "powershare")
        XCTAssertEqual(AppRoute.powershare.path, "/powershare")
        XCTAssertEqual(AppRoute.powershare.group, .vehicle)
        XCTAssertEqual(AppRouteParser.parse(path: "/powershare"), .powershare)
    }

    func testRouteRegistrationRegistersPage() {
        let registry = PowershareRouteRegistration.registry()
        XCTAssertTrue(registry.registeredRoutes.contains(.powershare))
    }
}
