import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for `DriveDetailPageModel` — every data state the page
/// renders (loading / error / ready), the best-effort vehicle load, the lazy why-ended panel
/// (idle → loading → ready, window reselection, failure), the pure derivations the web computes
/// inline in `useDriveDetailData` (chart/route sample precedence, the aggregate `DriveStats`,
/// the meaningful-telemetry gate, the speed histogram + bands), the display formatters, and the
/// navigation registration.
@MainActor
final class DriveDetailPageModelTests: XCTestCase {
    private struct StubError: Error {}

    private static let base = Date(timeIntervalSince1970: 1_700_000_000)

    private actor StubSource: DriveDetailDataSource {
        let record: DriveDetailRecord?
        let vehicle: DriveDetailVehicle?
        let why: DriveWhyEnded?
        let failVehicle: Bool
        let failWhy: Bool

        init(
            record: DriveDetailRecord?,
            vehicle: DriveDetailVehicle? = nil,
            why: DriveWhyEnded? = DriveWhyEnded(transitions: [], signals: []),
            failVehicle: Bool = false,
            failWhy: Bool = false
        ) {
            self.record = record
            self.vehicle = vehicle
            self.why = why
            self.failVehicle = failVehicle
            self.failWhy = failWhy
        }

        func loadDrive(driveID _: Int64) async throws -> DriveDetailRecord {
            guard let record else { throw StubError() }
            return record
        }

        func loadVehicle(vehicleID _: Int64) async throws -> DriveDetailVehicle? {
            if failVehicle { throw StubError() }
            return vehicle
        }

        func loadWhyEnded(driveID _: Int64, window _: DriveDetailDiagnosticWindow) async throws -> DriveWhyEnded {
            if failWhy { throw StubError() }
            guard let why else { throw StubError() }
            return why
        }
    }

    private func sample(
        offsetMin: Double,
        speedMps: Double?,
        battery: Double?,
        elevationM: Double?,
        powerW: Double?,
        lat: Double? = 37.4,
        lon: Double? = -122.0
    ) -> DriveTelemetrySample {
        DriveTelemetrySample(
            id: "s\(offsetMin)",
            createdAt: Self.base.addingTimeInterval(offsetMin * 60),
            latitude: lat,
            longitude: lon,
            speedMps: speedMps,
            batteryPct: battery,
            elevationM: elevationM,
            powerW: powerW,
            outsideTempC: 18,
            insideTempC: 21,
            idealRangeM: 300_000,
            ratedRangeM: 290_000,
            odometerM: 41_000_000 + offsetMin * 1000,
            socPct: battery,
            tireFlKpa: 290
        )
    }

    private func makeRecord(
        distanceM: Double = 18000,
        energyUsedWh: Double? = 3000,
        regenEnergyWh: Double? = 400,
        telemetry: [DriveTelemetrySample]? = nil,
        positions: [DriveTelemetrySample] = []
    ) -> DriveDetailRecord {
        let rows = telemetry ?? [
            sample(offsetMin: 0, speedMps: 0, battery: 80, elevationM: 20, powerW: 5000),
            sample(offsetMin: 5, speedMps: 25, battery: 76, elevationM: 40, powerW: 38000),
            sample(offsetMin: 10, speedMps: 18, battery: 72, elevationM: 30, powerW: -8000),
            sample(offsetMin: 15, speedMps: 12, battery: 70, elevationM: 35, powerW: 12000)
        ]
        return DriveDetailRecord(
            id: 7,
            vehicleID: 1,
            startedAt: Self.base,
            endedAt: Self.base.addingTimeInterval(15 * 60),
            durationS: 15 * 60,
            distanceM: distanceM,
            startAddress: "Mountain View",
            endAddress: "Palo Alto",
            startLat: 37.42,
            startLon: -122.08,
            endLat: 37.46,
            endLon: -122.13,
            startBatteryPct: 80,
            endBatteryPct: 70,
            energyUsedWh: energyUsedWh,
            regenEnergyWh: regenEnergyWh,
            avgSpeedMps: 14,
            maxSpeedMps: 25,
            avgPowerW: 18000,
            telemetry: rows,
            positions: positions
        )
    }

    // MARK: Phases

    func testInitialPhaseIsLoading() {
        let model = DriveDetailPageModel(driveID: 7, dataSource: StubSource(record: makeRecord()))
        XCTAssertEqual(model.phase, .loading)
        XCTAssertEqual(model.driveID, 7)
    }

    func testLoadResolvesToReady() async {
        let source = StubSource(record: makeRecord(), vehicle: DriveDetailVehicle(id: 1, displayName: "Rocinante"))
        let model = DriveDetailPageModel(driveID: 7, dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.record?.id, 7)
        XCTAssertEqual(model.vehicle?.displayName, "Rocinante")
        XCTAssertNotNil(model.stats)
        XCTAssertTrue(model.hasMeaningfulDriveStats)
    }

    func testDriveFailureResolvesToError() async {
        let model = DriveDetailPageModel(driveID: 7, dataSource: StubSource(record: nil))
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected error phase, got \(model.phase)")
        }
        XCTAssertNil(model.record)
        XCTAssertNil(model.stats)
    }

    func testVehicleFailureStillReady() async {
        let model = DriveDetailPageModel(driveID: 7, dataSource: StubSource(record: makeRecord(), failVehicle: true))
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertNil(model.vehicle)
    }

    func testRefreshKeepsReady() async {
        let model = DriveDetailPageModel(driveID: 7, dataSource: StubSource(record: makeRecord()))
        await model.load()
        await model.refresh()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.isRefreshing)
    }

    // MARK: Sample precedence + route

    func testChartSamplesPreferTelemetryThenPositions() async {
        let positions = [sample(offsetMin: 0, speedMps: 5, battery: nil, elevationM: nil, powerW: nil)]
        let recordWithTelemetry = makeRecord(positions: positions)
        let model = DriveDetailPageModel(driveID: 7, dataSource: StubSource(record: recordWithTelemetry))
        await model.load()
        XCTAssertEqual(model.chartSamples.count, 4)

        let recordPositionsOnly = makeRecord(telemetry: [], positions: positions)
        let model2 = DriveDetailPageModel(driveID: 7, dataSource: StubSource(record: recordPositionsOnly))
        await model2.load()
        XCTAssertEqual(model2.chartSamples.count, 1)
    }

    func testRouteCoordinatesDropNullIsland() {
        let record = makeRecord(telemetry: [
            sample(offsetMin: 0, speedMps: 10, battery: 80, elevationM: 10, powerW: 0, lat: 0, lon: 0),
            sample(offsetMin: 1, speedMps: 10, battery: 80, elevationM: 10, powerW: 0, lat: 37.4, lon: -122.0),
            sample(offsetMin: 2, speedMps: 10, battery: 80, elevationM: 10, powerW: 0, lat: nil, lon: nil)
        ])
        let coords = DriveDetailDerivations.routeCoordinates(record)
        XCTAssertEqual(coords.count, 1)
        XCTAssertEqual(coords.first?.latitude ?? 0, 37.4, accuracy: 0.0001)
    }

    // MARK: Stats

    func testStatsAggregates() {
        let record = makeRecord()
        let stats = DriveDetailDerivations.stats(record, samples: DriveDetailDerivations.chartSamples(record))
        XCTAssertEqual(stats.maxSpeedMps, 25, accuracy: 0.001)
        XCTAssertEqual(stats.energyWh, 3000, accuracy: 0.001)
        XCTAssertEqual(stats.regenWh, 400, accuracy: 0.001)
        XCTAssertEqual(stats.minSpeedMps, 12, accuracy: 0.001)
        XCTAssertEqual(stats.powerMaxW, 38000, accuracy: 0.001)
        XCTAssertEqual(stats.powerMinW, -8000, accuracy: 0.001)
        XCTAssertEqual(stats.elevGainM, 25, accuracy: 0.001) // 20→40 (+20), 30→35 (+5)
        XCTAssertEqual(stats.elevLossM, 10, accuracy: 0.001) // 40→30 (-10)
        XCTAssertEqual(stats.batteryUsedPct ?? 0, 10, accuracy: 0.001)
        XCTAssertEqual(stats.consumptionWhPerKm, 3000 / 18, accuracy: 0.01)
        XCTAssertTrue(stats.hasTirePressure)
        XCTAssertTrue(stats.hasAnyTemp)
    }

    func testStatsDerivesEnergyWhenAbsent() {
        let record = makeRecord(energyUsedWh: nil, regenEnergyWh: nil)
        let stats = DriveDetailDerivations.stats(record, samples: DriveDetailDerivations.chartSamples(record))
        // avgPowerW 18_000 W * 0.25 h = 4_500 Wh
        XCTAssertEqual(stats.energyWh, 4500, accuracy: 1)
        XCTAssertGreaterThanOrEqual(stats.regenWh, 0)
    }

    func testHasMeaningfulDriveStats() {
        let good = makeRecord()
        let goodStats = DriveDetailDerivations.stats(good, samples: DriveDetailDerivations.chartSamples(good))
        XCTAssertTrue(DriveDetailDerivations.hasMeaningfulDriveStats(good, goodStats))

        // A drive persisted with only timestamps + battery (no distance/speed/energy/rows).
        let empty = DriveDetailRecord(
            id: 9, vehicleID: 1, startedAt: Self.base, endedAt: Self.base.addingTimeInterval(360),
            durationS: 360, distanceM: 0, startAddress: nil, endAddress: nil,
            startLat: nil, startLon: nil, endLat: nil, endLon: nil,
            startBatteryPct: 55, endBatteryPct: 55, energyUsedWh: nil, regenEnergyWh: nil,
            avgSpeedMps: nil, maxSpeedMps: nil, avgPowerW: nil, telemetry: [], positions: []
        )
        let emptyStats = DriveDetailDerivations.stats(empty, samples: [])
        XCTAssertFalse(DriveDetailDerivations.hasMeaningfulDriveStats(empty, emptyStats))
    }

    func testSpeedHistogram() {
        let buckets = DriveDetailDerivations.speedHistogram(displaySpeeds: [5, 15, 25, 35, 200])
        XCTAssertFalse(buckets.isEmpty)
        let total = buckets.reduce(0.0) { $0 + $1.pct }
        XCTAssertEqual(total, 100, accuracy: 1)
        XCTAssertTrue(buckets.contains { $0.range == "120+" })
        XCTAssertTrue(DriveDetailDerivations.speedHistogram(displaySpeeds: []).isEmpty)
    }

    // MARK: Why-ended (lazy)

    func testWhyEndedLazyLoad() async {
        let why = DriveWhyEnded(
            transitions: [DriveFsmTransition(
                id: "t",
                fsmName: "drive",
                fromState: "driving",
                toState: "parked",
                trigger: "park",
                timestamp: Self.base
            )],
            signals: [DriveSignalRow(id: "s", timestamp: Self.base, field: "Gear", value: "P")]
        )
        let model = DriveDetailPageModel(driveID: 7, dataSource: StubSource(record: makeRecord(), why: why))
        await model.load()
        XCTAssertEqual(model.whyEndedPhase, .idle)
        XCTAssertFalse(model.whyEndedExpanded)

        await model.toggleWhyEnded()
        XCTAssertTrue(model.whyEndedExpanded)
        XCTAssertEqual(model.whyEndedPhase, .ready)
        XCTAssertEqual(model.whyEnded?.transitions.count, 1)
    }

    func testWhyEndedWindowReselectReloads() async {
        let model = DriveDetailPageModel(driveID: 7, dataSource: StubSource(record: makeRecord()))
        await model.load()
        await model.toggleWhyEnded()
        await model.selectWhyEndedWindow(.m15)
        XCTAssertEqual(model.whyEndedWindow, .m15)
        XCTAssertEqual(model.whyEndedPhase, .ready)
    }

    func testWhyEndedFailure() async {
        let model = DriveDetailPageModel(driveID: 7, dataSource: StubSource(record: makeRecord(), failWhy: true))
        await model.load()
        await model.toggleWhyEnded()
        guard case .error = model.whyEndedPhase else {
            return XCTFail("expected why-ended error, got \(model.whyEndedPhase)")
        }
    }

    // MARK: Section boundary

    func testFailedSections() async {
        let model = DriveDetailPageModel(driveID: 7, dataSource: StubSource(record: makeRecord()))
        await model.load()
        XCTAssertFalse(model.isFailed(.header))
        model.failedSections = [.routeMap]
        XCTAssertTrue(model.isFailed(.routeMap))
        XCTAssertFalse(model.isFailed(.header))
    }
}
