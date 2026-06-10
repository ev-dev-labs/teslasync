//
//  VehicleCard.Tests.swift
//  TeslaSync — P4 feature view · 0302 · VehicleCard (Apple)
//
//  Unit coverage for the VehicleCard surface: the Adapter projections (status
//  derive + tone, battery tone thresholds, model-key parse, the units formatting
//  seam, the full data projection, the freshness chip, the VoiceOver summaries),
//  the model's phase resolution + S8 source binding (start/stop/refresh, stale
//  one-shot auto-refresh), the i18n key parity (referenced == the web keys), and
//  the P1/S11 `view.opened` telemetry. No network, no real store, no rendering
//  host — the pure projections and the in-memory source are exercised directly.
//
//  These run in the TeslaSync(/-macOS) XCTest targets.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum VehicleCardFixture {
    static func vehicle(
        displayName: String = "Lightning",
        vin: String = "5YJ3E1EA7KF000000",
        model: String = "Model 3",
        trim: String = "Performance"
    ) -> VehicleCardVehicle {
        VehicleCardVehicle(id: 7, displayName: displayName, vin: vin, model: model, trimBadging: trim)
    }

    static func state(
        stateString: String = "online",
        batteryLevel: Int = 73,
        isCharging: Bool = false,
        chargerPowerWatts: Double = 0,
        speed: Double = 0,
        isLocked: Bool = true,
        sentryMode: Bool = true
    ) -> VehicleCardLiveState {
        VehicleCardLiveState(
            state: stateString,
            batteryLevel: batteryLevel,
            ratedRangeMeters: 350_000,
            insideTempCelsius: 21.5,
            odometerMeters: 19_874_000,
            chargerPowerWatts: chargerPowerWatts,
            speedMetersPerSecond: speed,
            isCharging: isCharging,
            isLocked: isLocked,
            sentryMode: sentryMode
        )
    }
}

// MARK: - Vehicle status (web deriveVehicleStatus + FSM tokens)

final class VehicleStatusTests: XCTestCase {
    func testDeriveNilStateIsOffline() {
        XCTAssertEqual(VehicleStatus.derive(nil), .offline)
    }

    func testDeriveChargingWinsOverEverything() {
        let state = VehicleCardFixture.state(stateString: "asleep", isCharging: true, speed: 30)
        XCTAssertEqual(VehicleStatus.derive(state), .charging)
    }

    func testDerivePositiveSpeedIsDriving() {
        let state = VehicleCardFixture.state(stateString: "online", speed: 12)
        XCTAssertEqual(VehicleStatus.derive(state), .driving)
    }

    func testDeriveKnownStateString() {
        XCTAssertEqual(VehicleStatus.derive(VehicleCardFixture.state(stateString: "asleep")), .asleep)
        XCTAssertEqual(VehicleStatus.derive(VehicleCardFixture.state(stateString: "parked")), .parked)
    }

    func testDeriveUnknownStateFallsBackToOnline() {
        XCTAssertEqual(VehicleStatus.derive(VehicleCardFixture.state(stateString: "wat")), .online)
    }

    func testToneMapping() {
        XCTAssertEqual(VehicleStatus.online.tone, .success)
        XCTAssertEqual(VehicleStatus.driving.tone, .success)
        XCTAssertEqual(VehicleStatus.charging.tone, .warning)
        XCTAssertEqual(VehicleStatus.parked.tone, .info)
        XCTAssertEqual(VehicleStatus.updating.tone, .info)
        XCTAssertEqual(VehicleStatus.asleep.tone, .neutral)
        XCTAssertEqual(VehicleStatus.offline.tone, .danger)
    }

    func testLabelKeyMatchesWebPattern() {
        for status in VehicleStatus.allCases {
            XCTAssertEqual(status.labelKey, "vehicle.state.\(status.rawValue)")
        }
    }
}

// MARK: - Battery tone (web batteryColor thresholds)

final class BatteryToneTests: XCTestCase {
    func testThresholds() {
        XCTAssertEqual(BatteryTone.forLevel(100), .success)
        XCTAssertEqual(BatteryTone.forLevel(61), .success)
        XCTAssertEqual(BatteryTone.forLevel(60), .warning)
        XCTAssertEqual(BatteryTone.forLevel(26), .warning)
        XCTAssertEqual(BatteryTone.forLevel(25), .danger)
        XCTAssertEqual(BatteryTone.forLevel(0), .danger)
    }
}

// MARK: - Model key (web parseModelKey)

final class TeslaModelKeyTests: XCTestCase {
    func testDefaultsToModel3() {
        XCTAssertEqual(TeslaModelKey.parse(nil), .model3)
        XCTAssertEqual(TeslaModelKey.parse(""), .model3)
        XCTAssertEqual(TeslaModelKey.parse("Model 3 Performance"), .model3)
    }

    func testParsesEachBody() {
        XCTAssertEqual(TeslaModelKey.parse("Cybertruck"), .cybertruck)
        XCTAssertEqual(TeslaModelKey.parse("Model X"), .modelx)
        XCTAssertEqual(TeslaModelKey.parse("Model Y"), .modely)
        XCTAssertEqual(TeslaModelKey.parse("Model S"), .models)
    }

    func testParsesShortAliases() {
        XCTAssertEqual(TeslaModelKey.parse("CT"), .cybertruck)
        XCTAssertEqual(TeslaModelKey.parse("MX"), .modelx)
        XCTAssertEqual(TeslaModelKey.parse("MY"), .modely)
        XCTAssertEqual(TeslaModelKey.parse("MS"), .models)
    }
}

// MARK: - Units formatting seam (metricPreview)

final class VehicleCardUnitsFormattingTests: XCTestCase {
    private let formatting = VehicleCardUnitsFormatting.metricPreview

    func testDistance() {
        XCTAssertEqual(formatting.distance(350_000), "350 km")
        XCTAssertEqual(formatting.distance(nil), "—")
    }

    func testTemperatureRounds() {
        XCTAssertEqual(formatting.temperature(21.5), "22°C")
        XCTAssertEqual(formatting.temperature(nil), "—")
    }

    func testMileageGroupsDigits() {
        let odometer = formatting.odometer(19_874_000)
        XCTAssertEqual(odometer.unit, "km")
        XCTAssertEqual(odometer.value.filter(\.isNumber), "19874")
    }

    func testPower() {
        XCTAssertEqual(formatting.power(11000), "11 kW")
    }
}

// MARK: - Projection (web composition)

final class VehicleCardProjectionTests: XCTestCase {
    private let formatting = VehicleCardUnitsFormatting.metricPreview

    func testTitlePrefersDisplayName() {
        let data = project(vehicle: VehicleCardFixture.vehicle(displayName: "Bolt"))
        XCTAssertEqual(data.title, "Bolt")
    }

    func testTitleFallsBackToVin() {
        let data = project(vehicle: VehicleCardFixture.vehicle(displayName: "", vin: "VIN123"))
        XCTAssertEqual(data.title, "VIN123")
    }

    func testDescriptorJoinsModelAndTrim() {
        let data = project(vehicle: VehicleCardFixture.vehicle(model: "Model Y", trim: "Long Range"))
        XCTAssertEqual(data.descriptor, "Model Y Long Range")
    }

    func testDescriptorOmitsEmptyTrim() {
        let data = project(vehicle: VehicleCardFixture.vehicle(model: "Model 3", trim: ""))
        XCTAssertEqual(data.descriptor, "Model 3")
    }

    func testNoLiveStateLeavesLiveNilAndVizDefault() {
        let data = project(vehicle: VehicleCardFixture.vehicle(), state: nil)
        XCTAssertNil(data.live)
        XCTAssertEqual(data.vizBatteryLevel, 50)
        XCTAssertEqual(data.status, .offline)
    }

    func testLiveProjectionValues() {
        let data = project(vehicle: VehicleCardFixture.vehicle(), state: VehicleCardFixture.state(batteryLevel: 73))
        let live = try? XCTUnwrap(data.live)
        XCTAssertEqual(live?.batteryLevel, 73)
        XCTAssertEqual(live?.batteryPercentText, "73%")
        XCTAssertEqual(live?.batteryTone, .success)
        XCTAssertEqual(live?.rangeText, "350 km")
        XCTAssertEqual(live?.interiorText, "22°C")
        XCTAssertEqual(live?.odometerUnit, "km")
        XCTAssertEqual(live?.isLocked, true)
        XCTAssertEqual(live?.sentryMode, true)
        XCTAssertEqual(data.vizBatteryLevel, 73)
    }

    func testChargingProjection() {
        let state = VehicleCardFixture.state(
            stateString: "charging",
            batteryLevel: 41,
            isCharging: true,
            chargerPowerWatts: 11000
        )
        let data = project(vehicle: VehicleCardFixture.vehicle(), state: state)
        XCTAssertEqual(data.status, .charging)
        XCTAssertEqual(data.live?.isCharging, true)
        XCTAssertEqual(data.live?.chargerPowerText, "11 kW")
        XCTAssertEqual(data.live?.batteryTone, .warning)
    }

    private func project(
        vehicle: VehicleCardVehicle,
        state: VehicleCardLiveState? = VehicleCardFixture.state()
    ) -> VehicleCardData {
        VehicleCardProjection.project(vehicle: vehicle, state: state, formatting: formatting, localize: .echo)
    }
}

// MARK: - Freshness chip

final class VehicleCardFreshnessChipTests: XCTestCase {
    func testProject() {
        XCTAssertNil(VehicleCardFreshnessChip.project(.live))
        XCTAssertEqual(VehicleCardFreshnessChip.project(.stale), .stale)
        XCTAssertEqual(VehicleCardFreshnessChip.project(.offline), .offline)
    }

    func testLabelsAndTone() {
        XCTAssertEqual(VehicleCardFreshnessChip.stale.labelKey, "card.freshness.stale")
        XCTAssertEqual(VehicleCardFreshnessChip.offline.labelKey, "card.freshness.offline")
        XCTAssertEqual(VehicleCardFreshnessChip.stale.tone, .warning)
        XCTAssertEqual(VehicleCardFreshnessChip.offline.tone, .neutral)
    }
}

// MARK: - Accessibility summaries

final class VehicleCardAccessibilityTests: XCTestCase {
    func testCardLabelWithLive() {
        let data = VehicleCardProjection.project(
            vehicle: VehicleCardFixture.vehicle(displayName: "Bolt"),
            state: VehicleCardFixture.state(batteryLevel: 73),
            formatting: .metricPreview,
            localize: .echo
        )
        let label = VehicleCardAccessibility.cardLabel(for: data, localize: .echo)
        XCTAssertTrue(label.contains("Bolt"))
        XCTAssertTrue(label.contains("73%"))
        XCTAssertTrue(label.contains("350 km"))
    }

    func testActionLabels() {
        XCTAssertEqual(VehicleCardAccessibility.viewDetailsLabel(.echo), "View details")
        XCTAssertEqual(VehicleCardAccessibility.removeLabel(.echo), "Remove vehicle")
    }
}

// MARK: - Phase resolution

final class VehicleCardPhaseTests: XCTestCase {
    func testHasVehicleStaysContent() {
        let vehicle = VehicleCardFixture.vehicle()
        XCTAssertEqual(VehicleCardModel.resolvePhase(.init(status: .loading, vehicle: vehicle)), .content)
        XCTAssertEqual(VehicleCardModel.resolvePhase(.init(status: .empty, vehicle: vehicle)), .content)
        XCTAssertEqual(VehicleCardModel.resolvePhase(.init(status: .loaded, vehicle: vehicle)), .content)
        XCTAssertEqual(VehicleCardModel.resolvePhase(.init(status: .failed("x"), vehicle: vehicle)), .content)
    }

    func testNoVehicleFallsBack() {
        XCTAssertEqual(VehicleCardModel.resolvePhase(.init(status: .loading)), .loading)
        XCTAssertEqual(VehicleCardModel.resolvePhase(.init(status: .empty)), .empty)
        XCTAssertEqual(VehicleCardModel.resolvePhase(.init(status: .loaded)), .empty)
        XCTAssertEqual(VehicleCardModel.resolvePhase(.init(status: .failed("boom"))), .error("boom"))
    }
}

// MARK: - Telemetry spy

private final class SpyVehicleCardTelemetry: VehicleCardTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock(); defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock(); storage.append(surface); lock.unlock()
    }
}

// MARK: - Model binding (S8 source + telemetry)

@MainActor
final class VehicleCardModelTests: XCTestCase {
    func testStartProjectsInitialAndEmitsTelemetry() {
        let spy = SpyVehicleCardTelemetry()
        let source = InMemoryVehicleCardSource(
            initial: .init(status: .loaded, vehicle: VehicleCardFixture.vehicle(), state: VehicleCardFixture.state())
        )
        let model = VehicleCardModel(source: source, formatting: .metricPreview, localize: .echo, telemetry: spy)

        model.start()

        XCTAssertEqual(spy.surfaces, [VehicleCardSurface.slug])
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.data?.title, "Lightning")
        XCTAssertNotNil(model.vehicle)
    }

    func testStartIsIdempotent() {
        let spy = SpyVehicleCardTelemetry()
        let model = VehicleCardModel(source: InMemoryVehicleCardSource(), localize: .echo, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [VehicleCardSurface.slug])
    }

    func testStaleTriggersOneShotAutoRefresh() {
        let source = InMemoryVehicleCardSource()
        let model = VehicleCardModel(source: source, localize: .echo, telemetry: SpyVehicleCardTelemetry())
        let vehicle = VehicleCardFixture.vehicle()

        model.start()
        source.push(.init(status: .loaded, connection: .stale, vehicle: vehicle))
        XCTAssertEqual(source.refreshCount, 1)

        source.push(.init(status: .loaded, connection: .stale, vehicle: vehicle))
        XCTAssertEqual(source.refreshCount, 1, "second stale snapshot must not re-trigger")

        source.push(.init(status: .loaded, connection: .live, vehicle: vehicle))
        source.push(.init(status: .loaded, connection: .stale, vehicle: vehicle))
        XCTAssertEqual(source.refreshCount, 2, "stale re-triggers exactly once after returning live")
    }

    func testRetryRefreshesSource() {
        let source = InMemoryVehicleCardSource()
        let model = VehicleCardModel(source: source, localize: .echo, telemetry: SpyVehicleCardTelemetry())
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineKeepsCachedCardVisible() {
        let source = InMemoryVehicleCardSource()
        let model = VehicleCardModel(
            source: source,
            formatting: .metricPreview,
            localize: .echo,
            telemetry: SpyVehicleCardTelemetry()
        )
        model.start()
        source.push(.init(
            status: .loaded,
            connection: .offline,
            vehicle: VehicleCardFixture.vehicle(),
            state: VehicleCardFixture.state()
        ))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0, "offline must not auto-refresh")
    }
}

// MARK: - Surface slug parity

final class VehicleCardSurfaceTests: XCTestCase {
    func testSlugIsStable() {
        XCTAssertEqual(VehicleCardSurface.slug, "VehicleCard")
    }
}
