//
//  VehicleHero.ModelTests.swift
//  TeslaSync — P4 feature view · 0133 · VehicleHero (Apple)
//
//  State-holder + builder coverage for the VehicleHero surface: the stat-grid branches
//  (web `buildStatCards`), the charging summary, `VehicleHeroPanelProjection` across
//  loading / data / asleep / error, and the `VehicleHeroPanelModel` wiring (the P1/S11
//  `view.opened` telemetry + the stale auto-refresh transition). The pure adapter
//  primitives are covered in `VehicleHero.Tests.swift`.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

private func sampleState(
    status: VehicleHeroPanelStatus = .parked,
    speedMps: Double = 0,
    powerKw: Double = 0,
    insideTempC: Double? = 21,
    isCharging: Bool = false,
    chargerPowerKw: Double? = nil,
    chargeRateMeters: Double? = nil,
    timeToFullHours: Double = 0,
    isLocked: Bool = true,
    sentryMode: Bool = false
) -> VehicleHeroPanelState {
    VehicleHeroPanelState(
        status: status,
        batteryLevel: 72,
        ratedRangeMeters: 354_000,
        idealRangeMeters: 402_000,
        odometerMeters: 41_842_000,
        speedMps: speedMps,
        powerKw: powerKw,
        insideTempC: insideTempC,
        outsideTempC: 12,
        isCharging: isCharging,
        chargerPowerKw: chargerPowerKw,
        chargeRateMeters: chargeRateMeters,
        timeToFullHours: timeToFullHours,
        isLocked: isLocked,
        sentryMode: sentryMode
    )
}

private func sampleVehicle(id: Int64 = 1, displayName: String = "Lightning") -> VehicleHeroPanelVehicle {
    VehicleHeroPanelVehicle(
        id: id,
        displayName: displayName,
        vin: "5YJ3E1EA7KF000000",
        model: "Model 3",
        trimBadging: "Performance",
        updatedAt: Date(timeIntervalSince1970: 1_000_000)
    )
}

// MARK: - Stat grid (web buildStatCards)

final class VehicleHeroPanelStatsTests: XCTestCase {
    func testDrivingBranchIDs() {
        let cards = VehicleHeroPanelStats.cards(
            for: sampleState(status: .driving, speedMps: 20), firmware: "2025.20", system: .metric, locale: enUS
        )
        XCTAssertEqual(
            cards.map(\.id),
            ["speed", "power-lead", "odometer", "idealRange", "status", "sentry", "firmware", "power-fixed"]
        )
    }

    func testChargingBranchIDs() {
        let cards = VehicleHeroPanelStats.cards(
            for: sampleState(status: .charging, isCharging: true, chargerPowerKw: 11, chargeRateMeters: 48280),
            firmware: "2025.20", system: .metric, locale: enUS
        )
        XCTAssertEqual(
            cards.map(\.id),
            ["chargeRate", "timeToFull", "idealRange", "odometer", "status", "sentry", "firmware", "power-fixed"]
        )
    }

    func testIdleBranchIDs() {
        let cards = VehicleHeroPanelStats.cards(for: sampleState(), firmware: "2025.20", system: .metric, locale: enUS)
        XCTAssertEqual(
            cards.map(\.id),
            ["inside", "outside", "odometer", "idealRange", "status", "sentry", "firmware", "power-fixed"]
        )
    }

    func testLockedAndSentryAreLocalizedValues() {
        let cards = VehicleHeroPanelStats.cards(
            for: sampleState(isLocked: true, sentryMode: true), firmware: "x", system: .metric, locale: enUS
        )
        let status = cards.first { $0.id == "status" }
        XCTAssertEqual(status?.value, .localized(key: "common.locked", fallback: "Locked"))
        XCTAssertEqual(status?.accent, .locked)
        let sentry = cards.first { $0.id == "sentry" }
        XCTAssertEqual(sentry?.value, .localized(key: "common.active", fallback: "Active"))
        XCTAssertEqual(sentry?.accent, .sentryOn)
    }

    func testUnlockedAndSentryOffVariants() {
        let cards = VehicleHeroPanelStats.cards(
            for: sampleState(isLocked: false, sentryMode: false), firmware: "x", system: .metric, locale: enUS
        )
        XCTAssertEqual(
            cards.first { $0.id == "status" }?.value,
            .localized(key: "common.unlocked", fallback: "Unlocked")
        )
        XCTAssertEqual(cards.first { $0.id == "sentry" }?.value, .localized(key: "common.off", fallback: "Off"))
    }

    func testFirmwareFallsBackToDashWhenEmpty() {
        let cards = VehicleHeroPanelStats.cards(for: sampleState(), firmware: "", system: .metric, locale: enUS)
        XCTAssertEqual(cards.first { $0.id == "firmware" }?.value, .text("—"))
    }

    func testTemperatureCardShowsDashWhenNil() {
        let cards = VehicleHeroPanelStats.cards(
            for: sampleState(insideTempC: nil), firmware: "x", system: .metric, locale: enUS
        )
        XCTAssertEqual(cards.first { $0.id == "inside" }?.value, .text("—"))
    }

    func testPowerAccentBySign() {
        XCTAssertEqual(VehicleHeroPanelStats.powerAccent(5), .power)
        XCTAssertEqual(VehicleHeroPanelStats.powerAccent(-5), .powerRegen)
        XCTAssertEqual(VehicleHeroPanelStats.powerAccent(0), .powerIdle)
    }

    func testPowerCardValueText() {
        let cards = VehicleHeroPanelStats.cards(
            for: sampleState(powerKw: 12.5),
            firmware: "x",
            system: .metric,
            locale: enUS
        )
        XCTAssertEqual(cards.first { $0.id == "power-fixed" }?.value, .text("12.50 kW"))
    }
}

// MARK: - Charging summary (web is_charging detail)

final class VehicleHeroPanelChargingDetailTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    func testWithETAComputesDoneAtAndText() {
        let detail = VehicleHeroPanelChargingDetail.make(
            from: sampleState(isCharging: true, chargerPowerKw: 11, chargeRateMeters: 48280, timeToFullHours: 1.5),
            system: .metric, now: now, locale: enUS
        )
        XCTAssertEqual(detail.powerText, "11.00 kW")
        XCTAssertEqual(detail.rateText, "48 km/h")
        XCTAssertEqual(detail.timeToFullText, "1.5h")
        XCTAssertEqual(detail.doneAt, now.addingTimeInterval(1.5 * 3600))
    }

    func testWithoutETAShowsDashAndNoDoneAt() {
        let detail = VehicleHeroPanelChargingDetail.make(
            from: sampleState(isCharging: true, chargerPowerKw: 7, chargeRateMeters: 0, timeToFullHours: 0),
            system: .metric, now: now, locale: enUS
        )
        XCTAssertEqual(detail.timeToFullText, "—")
        XCTAssertNil(detail.doneAt)
    }

    func testRateUsesImperialUnit() {
        let detail = VehicleHeroPanelChargingDetail.make(
            from: sampleState(isCharging: true, chargerPowerKw: 11, chargeRateMeters: 48280, timeToFullHours: 1),
            system: .imperial, now: now, locale: enUS
        )
        XCTAssertEqual(detail.rateText, "30 mi/h") // 48280 / 1609.344 = 30.0
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

final class VehicleHeroPanelProjectionTests: XCTestCase {
    private func input(
        state: VehicleHeroPanelState?,
        isLoading: Bool = false,
        errorMessage: String? = nil
    ) -> VehicleHeroPanelInput {
        VehicleHeroPanelInput(
            vehicle: sampleVehicle(),
            state: state,
            firmwareVersion: "2025.20",
            unitSystem: .metric,
            locale: enUS,
            isLoading: isLoading,
            errorMessage: errorMessage
        )
    }

    func testErrorTakesPrecedence() {
        let resolved = VehicleHeroPanelProjection.resolve(input(state: sampleState(), errorMessage: "boom"))
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertTrue(resolved.gauges.isEmpty)
    }

    func testDataWhenStatePresent() {
        let resolved = VehicleHeroPanelProjection.resolve(input(state: sampleState(status: .driving, speedMps: 10)))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertFalse(resolved.gauges.isEmpty)
        XCTAssertEqual(resolved.actions, VehicleHeroPanelAction.allCases)
        XCTAssertEqual(resolved.header.status, .driving)
        XCTAssertEqual(resolved.vehicleID, 1)
    }

    func testLoadingWhenFlaggedAndNoState() {
        XCTAssertEqual(VehicleHeroPanelProjection.resolve(input(state: nil, isLoading: true)).phase, .loading)
    }

    func testAsleepWhenNoStateAndNotLoading() {
        let resolved = VehicleHeroPanelProjection.resolve(input(state: nil))
        XCTAssertEqual(resolved.phase, .asleep)
        XCTAssertEqual(resolved.header.status, .offline)
    }

    func testChargingBodyHasChargingDetail() {
        let resolved = VehicleHeroPanelProjection.resolve(input(
            state: sampleState(status: .charging, isCharging: true, chargerPowerKw: 11, timeToFullHours: 1)
        ))
        XCTAssertNotNil(resolved.charging)
    }

    func testNonChargingBodyHasNoChargingDetail() {
        XCTAssertNil(VehicleHeroPanelProjection.resolve(input(state: sampleState())).charging)
    }

    func testHeaderTitleFallsBackToVIN() {
        var vehicle = sampleVehicle()
        vehicle.displayName = ""
        let resolved = VehicleHeroPanelProjection.resolve(VehicleHeroPanelInput(vehicle: vehicle, state: nil))
        XCTAssertEqual(resolved.header.title, vehicle.vin)
    }
}

// MARK: - State holder: wiring, telemetry, freshness

@MainActor
final class VehicleHeroPanelModelTests: XCTestCase {
    private func makeModel(
        _ input: VehicleHeroPanelInput,
        telemetry: VehicleHeroPanelTelemetry = OSLogVehicleHeroPanelTelemetry()
    ) -> (VehicleHeroPanelModel, InMemoryVehicleHeroPanelSource) {
        let source = InMemoryVehicleHeroPanelSource(initial: input)
        let model = VehicleHeroPanelModel(source: source, telemetry: telemetry, now: { Date(timeIntervalSince1970: 0) })
        return (model, source)
    }

    private var dataInput: VehicleHeroPanelInput {
        VehicleHeroPanelInput(vehicle: sampleVehicle(), state: sampleState(status: .online), locale: enUS)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyVehicleHeroPanelTelemetry()
        let (model, source) = makeModel(dataInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(spy.surfaces, [VehicleHero.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(VehicleHeroPanelInput(vehicle: sampleVehicle(), state: nil, isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(VehicleHeroPanelInput(vehicle: sampleVehicle(), state: nil, isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(dataInput)
        XCTAssertEqual(model.phase, .data)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(dataInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(VehicleHeroPanelInput(vehicle: sampleVehicle(), state: sampleState(), connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(VehicleHeroPanelInput(vehicle: sampleVehicle(), state: sampleState(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(VehicleHeroPanelInput(vehicle: sampleVehicle(), state: sampleState(), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(VehicleHero.surfaceSlug, "VehicleHero")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyVehicleHeroPanelTelemetry: VehicleHeroPanelTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
