import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for `ChargingDetailPageModel` — every data state the
/// page renders (loading / error / ready, with populated or empty telemetry), the
/// best-effort secondary loads, the pure derivations the web computes inline (`isDC`,
/// `durationMinutes`, `addedDistanceM`, `kwhPerHour`, `costPerKwh`, the synthesized /
/// measured charge curve, and the charging-state badge tone), the display formatters, and
/// the navigation registration.
@MainActor
final class ChargingDetailPageModelTests: XCTestCase {
    private struct StubError: Error {}

    private static let base = Date(timeIntervalSince1970: 1_700_000_000)

    private actor StubSource: ChargingDetailDataSource {
        let session: ChargingSessionDetail?
        let telemetry: [ChargeTelemetryReading]
        let vehicle: ChargingDetailVehicle?
        let live: ChargingTelemetryLatest?
        let failSecondary: Bool

        init(
            session: ChargingSessionDetail?,
            telemetry: [ChargeTelemetryReading] = [],
            vehicle: ChargingDetailVehicle? = nil,
            live: ChargingTelemetryLatest? = nil,
            failSecondary: Bool = false
        ) {
            self.session = session
            self.telemetry = telemetry
            self.vehicle = vehicle
            self.live = live
            self.failSecondary = failSecondary
        }

        func loadSession(sessionID: Int64) async throws -> ChargingSessionDetail {
            guard let session else { throw StubError() }
            return session
        }

        func loadTelemetry(sessionID: Int64) async throws -> [ChargeTelemetryReading] {
            if failSecondary { throw StubError() }
            return telemetry
        }

        func loadVehicle(vehicleID: Int64) async throws -> ChargingDetailVehicle? {
            if failSecondary { throw StubError() }
            return vehicle
        }

        func loadLatestTelemetry(vehicleID: Int64) async throws -> ChargingTelemetryLatest? {
            if failSecondary { throw StubError() }
            return live
        }
    }

    private func makeSession(
        charger: String? = "Tesla",
        cost: Double? = 12.42,
        odoStart: Double? = 12_400_000,
        odoEnd: Double? = 12_610_000,
        ended: Date? = base.addingTimeInterval(32 * 60)
    ) -> ChargingSessionDetail {
        ChargingSessionDetail(
            id: 42,
            vehicleID: 1,
            startedAt: Self.base,
            endedAt: ended,
            startSocPct: 18,
            endSocPct: 82,
            totalEnergyAddedWh: 38_400,
            peakPowerW: 152_000,
            avgPowerW: 72_000,
            chargerType: charger,
            startPlace: "Supercharger",
            costDecimal: cost,
            costCurrency: "USD",
            endedStatus: "Complete",
            odometerStartM: odoStart,
            odometerEndM: odoEnd
        )
    }

    private func reading(soc: Double, powerW: Double?) -> ChargeTelemetryReading {
        ChargeTelemetryReading(
            id: "r\(soc)",
            createdAt: Self.base,
            batteryLevelPct: soc,
            powerW: powerW,
            energyAddedWh: 1_000,
            ratedRangeM: 200_000,
            batteryTempC: 25,
            insideTempC: 21,
            outsideTempC: 18,
            voltageV: 400,
            currentA: 100
        )
    }

    // MARK: Phases

    func testInitialPhaseIsLoading() {
        let model = ChargingDetailPageModel(sessionID: 42, dataSource: StubSource(session: makeSession()))
        XCTAssertEqual(model.phase, .loading)
        XCTAssertEqual(model.sessionID, 42)
    }

    func testLoadResolvesToReady() async {
        let source = StubSource(
            session: makeSession(),
            telemetry: [reading(soc: 20, powerW: 50_000)],
            vehicle: ChargingDetailVehicle(id: 1, displayName: "Rocinante"),
            live: nil
        )
        let model = ChargingDetailPageModel(sessionID: 42, dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.session?.id, 42)
        XCTAssertTrue(model.hasTelemetry)
        XCTAssertEqual(model.vehicle?.displayName, "Rocinante")
    }

    func testSessionFailureResolvesToError() async {
        let model = ChargingDetailPageModel(sessionID: 42, dataSource: StubSource(session: nil))
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected error phase, got \(model.phase)")
        }
        XCTAssertNil(model.session)
    }

    func testSecondaryFailureStillReady() async {
        let source = StubSource(session: makeSession(), failSecondary: true)
        let model = ChargingDetailPageModel(sessionID: 42, dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.hasTelemetry)
        XCTAssertNil(model.vehicle)
        XCTAssertNil(model.live)
    }

    func testRefreshKeepsReady() async {
        let model = ChargingDetailPageModel(sessionID: 42, dataSource: StubSource(session: makeSession()))
        await model.load()
        await model.refresh()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.isRefreshing)
    }

    // MARK: Derivations

    func testIsDC() {
        XCTAssertTrue(ChargingDetailDerivations.isDC(makeSession(charger: "Tesla")))
        XCTAssertFalse(ChargingDetailDerivations.isDC(makeSession(charger: nil)))
        XCTAssertFalse(ChargingDetailDerivations.isDC(makeSession(charger: "unknown")))
        XCTAssertFalse(ChargingDetailDerivations.isDC(makeSession(charger: "")))
    }

    func testDurationMinutes() {
        let session = makeSession()
        XCTAssertEqual(ChargingDetailDerivations.durationMinutes(session.startedAt, session.endedAt), 32)
        XCTAssertEqual(ChargingDetailDerivations.durationMinutes(Self.base, nil), 0)
        XCTAssertEqual(
            ChargingDetailDerivations.durationMinutes(Self.base, Self.base.addingTimeInterval(-60)),
            0
        )
    }

    func testAddedDistanceM() {
        XCTAssertEqual(ChargingDetailDerivations.addedDistanceM(makeSession()), 210_000)
        XCTAssertNil(ChargingDetailDerivations.addedDistanceM(makeSession(odoStart: nil)))
        XCTAssertNil(ChargingDetailDerivations.addedDistanceM(makeSession(odoStart: 100, odoEnd: 50)))
    }

    func testKwhPerHour() {
        let rate = ChargingDetailDerivations.kwhPerHour(makeSession())
        XCTAssertEqual(rate ?? 0, 72, accuracy: 0.01)
        XCTAssertNil(ChargingDetailDerivations.kwhPerHour(makeSession(ended: nil)))
    }

    func testCostPerKwh() {
        let cost = ChargingDetailDerivations.costPerKwh(makeSession())
        XCTAssertEqual(cost ?? 0, 0.3234, accuracy: 0.001)
        XCTAssertNil(ChargingDetailDerivations.costPerKwh(makeSession(cost: nil)))
    }

    func testSynthesizeCurve() {
        let curve = ChargingDetailDerivations.synthesizeCurve(makeSession())
        XCTAssertEqual(curve.count, 21)
        XCTAssertEqual(curve.first?.soc ?? -1, 18, accuracy: 1)
        XCTAssertEqual(curve.last?.soc ?? -1, 82, accuracy: 1)
        XCTAssertTrue(curve.allSatisfy { $0.powerKw >= 0 })
    }

    func testChargeCurveUsesMeasuredThenSynthesized() {
        let measured = ChargingDetailDerivations.chargeCurve(
            session: makeSession(),
            telemetry: [reading(soc: 20, powerW: 50_000), reading(soc: 30, powerW: 40_000)]
        )
        XCTAssertEqual(measured.count, 2)
        XCTAssertEqual(measured.first?.powerKw ?? 0, 50, accuracy: 0.01)

        let synthesized = ChargingDetailDerivations.chargeCurve(session: makeSession(), telemetry: [])
        XCTAssertEqual(synthesized.count, 21)
    }

    func testChargingStateTone() {
        XCTAssertEqual(ChargingStateTone.tone("Charging"), .success)
        XCTAssertEqual(ChargingStateTone.tone("Starting"), .success)
        XCTAssertEqual(ChargingStateTone.tone("Complete"), .info)
        XCTAssertEqual(ChargingStateTone.tone("Stopped"), .warning)
        XCTAssertEqual(ChargingStateTone.tone("Error"), .danger)
        XCTAssertEqual(ChargingStateTone.tone(nil), .neutral)
        XCTAssertEqual(ChargingStateTone.tone("Disconnected"), .neutral)
    }

    // MARK: Formatters

    func testNumberFormatting() {
        XCTAssertEqual(ChargingDetailFormat.number(1234.5, decimals: 1), "1,234.5")
        XCTAssertEqual(ChargingDetailFormat.number(.nan, decimals: 1), "—")
        XCTAssertEqual(ChargingDetailFormat.numberOrDash(nil), "—")
    }

    func testPercentAndRange() {
        XCTAssertEqual(ChargingDetailFormat.percent(84), "84%")
        XCTAssertEqual(ChargingDetailFormat.percent(nil), "—")
        XCTAssertEqual(ChargingDetailFormat.socRange(start: 18, end: 82), "18–82")
        XCTAssertEqual(ChargingDetailFormat.socRange(start: nil, end: nil), "0–0")
        XCTAssertEqual(ChargingDetailFormat.socGained(start: 18, end: 82), "64%")
    }

    // MARK: Registration

    func testRouteRegistrationBuildsPage() {
        _ = ChargingDetailRouteRegistration.make(sessionID: 7)
        XCTAssertEqual(ChargingDetailLink(sessionID: 7).sessionID, 7)
    }
}
