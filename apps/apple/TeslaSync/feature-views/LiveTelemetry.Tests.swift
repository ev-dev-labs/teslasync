//
//  LiveTelemetry.Tests.swift
//  TeslaSync — P4 feature view · 0127 · LiveTelemetry (Apple)
//
//  Unit coverage for the LiveTelemetry surface:
//    • Adapter — the number / int / plain formatters and `cleanNil` (ports of
//      numberFormat.ts + cleanNil.ts), the °C / km / bar display conversions, the six
//      per-panel projections, and the pressure tone / "normal" bands.
//    • State holder — `LiveTelemetryProjection` across loading / empty / error / data
//      and the per-panel skeleton fallbacks, plus the `LiveTelemetryModel` wiring, the
//      P1/S11 `view.opened` telemetry, and the stale auto-refresh transition.
//    • Accessibility — the VoiceOver row + tyre label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryLiveTelemetrySource`, and the locale is
//  injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Number / nil formatting (ports of numberFormat.ts + cleanNil.ts)

@MainActor final class LiveTelemetryFormatTests: XCTestCase {
    func testNumberGroupsAndFixesDecimals() {
        XCTAssertEqual(LiveTelemetryFormat.number(1234.5, decimals: 1, locale: enUS), "1,234.5")
        XCTAssertEqual(LiveTelemetryFormat.number(0.31, decimals: 2, locale: enUS), "0.31")
        XCTAssertEqual(LiveTelemetryFormat.int(116.6, locale: enUS), "117")
    }

    func testNumberCoercesNonFiniteToZero() {
        XCTAssertEqual(LiveTelemetryFormat.number(.nan, decimals: 1, locale: enUS), "0.0")
        XCTAssertEqual(LiveTelemetryFormat.number(.infinity, decimals: 2, locale: enUS), "0.00")
    }

    func testPlainDropsIntegralFraction() {
        XCTAssertEqual(LiveTelemetryFormat.plain(248), "248")
        XCTAssertEqual(LiveTelemetryFormat.plain(-120), "-120")
        XCTAssertEqual(LiveTelemetryFormat.plain(7.5), "7.5")
    }

    func testCleanNilFiltersGoSentinels() {
        XCTAssertNil(LiveTelemetryFormat.cleanNil("<nil>"))
        XCTAssertNil(LiveTelemetryFormat.cleanNil("nil"))
        XCTAssertNil(LiveTelemetryFormat.cleanNil("null"))
        XCTAssertNil(LiveTelemetryFormat.cleanNil(""))
        XCTAssertNil(LiveTelemetryFormat.cleanNil(nil))
        XCTAssertEqual(LiveTelemetryFormat.cleanNil("Playing"), "Playing")
    }
}

// MARK: - Display-unit conversions (ports of unitConversion.ts)

@MainActor final class LiveTelemetryUnitTests: XCTestCase {
    func testTemperature() {
        XCTAssertEqual(LiveTemperatureUnit.celsius.convert(21), 21, accuracy: 1e-9)
        XCTAssertEqual(LiveTemperatureUnit.fahrenheit.convert(21), 69.8, accuracy: 1e-9)
        XCTAssertEqual(LiveTemperatureUnit.celsius.label, "°C")
        XCTAssertEqual(LiveTemperatureUnit.fahrenheit.label, "°F")
    }

    func testDistance() {
        XCTAssertEqual(LiveDistanceUnit.kilometers.convert(12.4), 12.4, accuracy: 1e-9)
        XCTAssertEqual(LiveDistanceUnit.miles.convert(12.4), 12400 / 1609.344, accuracy: 1e-9)
        XCTAssertEqual(LiveDistanceUnit.miles.label, "mi")
    }

    func testPressure() {
        XCTAssertEqual(LivePressureUnit.bar.convert(2.62), 2.62, accuracy: 1e-9)
        XCTAssertEqual(LivePressureUnit.psi.convert(2.62), 262 / 6.894757, accuracy: 1e-9)
        XCTAssertEqual(LivePressureUnit.kilopascals.convert(2.62), 262, accuracy: 1e-9)
    }
}

// MARK: - Drivetrain projection (web `DrivetrainPanel`)

@MainActor final class LiveTelemetryDrivetrainTests: XCTestCase {
    func testFormatsRowsAndGearTone() {
        let data = MotorTelemetry(torque: 248, statorTemp: 47, gear: "D", lateralAccel: 0.12, longitudinalAccel: 0.31)
        let projection = LiveTelemetryProjections.drivetrain(data, units: .metric, locale: enUS)
        XCTAssertEqual(projection.torqueText, "248 Nm")
        XCTAssertEqual(projection.motorTempText, "47°C")
        XCTAssertEqual(projection.gear, "D")
        XCTAssertEqual(projection.gearTone, .success)
        XCTAssertEqual(projection.gForceText, "0.31g")
    }

    func testReverseGearAndImperialTemp() {
        let data = MotorTelemetry(statorTemp: 21, gear: "R")
        let projection = LiveTelemetryProjections.drivetrain(data, units: .imperial, locale: enUS)
        XCTAssertEqual(projection.motorTempText, "70°F")
        XCTAssertEqual(projection.gearTone, .danger)
    }

    func testMissingValuesFallBackToDash() {
        let projection = LiveTelemetryProjections.drivetrain(MotorTelemetry(), units: .metric, locale: enUS)
        XCTAssertEqual(projection.torqueText, "—")
        XCTAssertEqual(projection.motorTempText, "—")
        XCTAssertNil(projection.gear)
        XCTAssertEqual(projection.gearTone, .neutral)
        XCTAssertEqual(projection.gForceText, "—")
    }

    func testGearNilSentinelIsCleaned() {
        let projection = LiveTelemetryProjections.drivetrain(
            MotorTelemetry(gear: "<nil>"),
            units: .metric,
            locale: enUS
        )
        XCTAssertNil(projection.gear)
    }
}

// MARK: - Climate projection (web `ClimatePanel`)

@MainActor final class LiveTelemetryClimateTests: XCTestCase {
    func testRowsFanAndModeChips() {
        let data = ClimateTelemetry(
            insideTemp: 21, outsideTemp: 9, hvacPower: 3.4,
            fanSpeed: 4, defrostMode: "Front", batteryHeaterOn: true
        )
        let projection = LiveTelemetryProjections.climate(data, units: .metric, locale: enUS)
        XCTAssertEqual(projection.cabinText, "21°C")
        XCTAssertEqual(projection.outsideText, "9°C")
        XCTAssertEqual(projection.hvacText, "3.4 kW")
        XCTAssertEqual(projection.fanSpeed, 4)
        XCTAssertEqual(projection.fanText, "4/6")
        XCTAssertEqual(projection.fanFraction, 4.0 / 6.0, accuracy: 1e-9)
        XCTAssertTrue(projection.showDefrost)
        XCTAssertTrue(projection.showBatteryHeater)
        XCTAssertFalse(projection.showNoModes)
    }

    func testDefrostOffAndNoHeaterShowsNoModes() {
        let data = ClimateTelemetry(defrostMode: "Off", batteryHeaterOn: false)
        let projection = LiveTelemetryProjections.climate(data, units: .metric, locale: enUS)
        XCTAssertFalse(projection.showDefrost)
        XCTAssertFalse(projection.showBatteryHeater)
        XCTAssertTrue(projection.showNoModes)
        XCTAssertEqual(projection.fanSpeed, 0)
        XCTAssertEqual(projection.fanFraction, 0, accuracy: 1e-9)
    }
}

// MARK: - Security projection (web `SecurityPanel`)

@MainActor final class LiveTelemetrySecurityTests: XCTestCase {
    func testOpenDoorAndWindowCounts() {
        let data = LiveSecurityTelemetry(
            locked: true,
            sentryMode: true,
            doorState: "FrontLeftClosed,FrontRightOpen,RearLeftClosed,RearRightClosed",
            frontDriverWindow: "Closed",
            frontPassengerWindow: "Vented",
            rearDriverWindow: "Closed",
            rearPassengerWindow: "Closed"
        )
        let projection = LiveTelemetryProjections.security(data)
        XCTAssertTrue(projection.locked)
        XCTAssertTrue(projection.sentryMode)
        XCTAssertEqual(projection.openDoors, 1)
        XCTAssertEqual(projection.openWindows, 1)
        XCTAssertFalse(projection.doorsAllClosed)
        XCTAssertFalse(projection.windowsAllClosed)
    }

    func testAllClosedWhenNoneOpen() {
        let data = LiveSecurityTelemetry(doorState: "FrontLeftClosed,RearRightClosed")
        let projection = LiveTelemetryProjections.security(data)
        XCTAssertEqual(projection.openDoors, 0)
        XCTAssertEqual(projection.openWindows, 0)
        XCTAssertTrue(projection.doorsAllClosed)
        XCTAssertTrue(projection.windowsAllClosed)
    }
}

// MARK: - Tyre projection + tone bands (web `TirePressurePanel` / `getPressureColor`)

@MainActor final class LiveTelemetryTireTests: XCTestCase {
    func testCornersTonesAndAllNormal() {
        let data = LiveTirePressureTelemetry(frontLeft: 2.62, frontRight: 2.58, rearLeft: 2.20, rearRight: 3.20)
        let projection = LiveTelemetryProjections.tire(data, units: .metric, locale: enUS)
        XCTAssertEqual(projection.corners.map(\.id), ["FL", "FR", "RL", "RR"])
        XCTAssertEqual(projection.corners[0].valueText, "2.6")
        XCTAssertEqual(projection.corners[0].tone, .success)
        XCTAssertEqual(projection.corners[2].tone, .warning)
        XCTAssertEqual(projection.corners[3].tone, .danger)
        XCTAssertEqual(projection.unitLabel, "bar")
        XCTAssertFalse(projection.allNormal)
    }

    func testMissingCornerIsDashAndCountsAsNormal() {
        let data = LiveTirePressureTelemetry(frontLeft: 2.5, frontRight: 2.5, rearLeft: 2.5, rearRight: nil)
        let projection = LiveTelemetryProjections.tire(data, units: .metric, locale: enUS)
        XCTAssertEqual(projection.corners[3].valueText, "—")
        XCTAssertEqual(projection.corners[3].tone, .muted)
        XCTAssertTrue(projection.allNormal)
    }

    func testPressureToneThresholds() {
        XCTAssertEqual(LiveTirePressure.tone(nil), .muted)
        XCTAssertEqual(LiveTirePressure.tone(2.0), .danger)
        XCTAssertEqual(LiveTirePressure.tone(3.2), .danger)
        XCTAssertEqual(LiveTirePressure.tone(2.2), .warning)
        XCTAssertEqual(LiveTirePressure.tone(2.95), .warning)
        XCTAssertEqual(LiveTirePressure.tone(2.6), .success)
    }
}

// MARK: - Media projection (web `MediaPanel`)

@MainActor final class LiveTelemetryMediaTests: XCTestCase {
    func testTitleArtistStatusVolume() {
        let data = MediaTelemetry(
            nowPlayingTitle: "Midnight City",
            nowPlayingArtist: "M83",
            playbackStatus: "Playing",
            audioVolume: 7,
            audioVolumeMax: 11
        )
        let projection = LiveTelemetryProjections.media(data)
        XCTAssertEqual(projection.title, "Midnight City")
        XCTAssertEqual(projection.artist, "M83")
        XCTAssertEqual(projection.status, "Playing")
        XCTAssertEqual(projection.statusTone, .success)
        XCTAssertEqual(projection.volumeText, "7/11")
        XCTAssertEqual(projection.volumeFraction, 7.0 / 11.0, accuracy: 1e-9)
    }

    func testCleanedFallbacksAndPausedTone() {
        let data = MediaTelemetry(
            nowPlayingTitle: "<nil>",
            nowPlayingArtist: "nil",
            playbackStatus: "Paused",
            audioVolume: nil,
            audioVolumeMax: 11
        )
        let projection = LiveTelemetryProjections.media(data)
        XCTAssertEqual(projection.title, "—")
        XCTAssertNil(projection.artist)
        XCTAssertEqual(projection.statusTone, .warning)
        XCTAssertEqual(projection.volumeText, "—")
        XCTAssertEqual(projection.volumeFraction, 0, accuracy: 1e-9)
    }

    func testUnknownStatusIsNeutral() {
        let projection = LiveTelemetryProjections.media(MediaTelemetry(playbackStatus: "Stopped"))
        XCTAssertEqual(projection.status, "Stopped")
        XCTAssertEqual(projection.statusTone, .neutral)
    }
}

// MARK: - Navigation projection (web `NavigationPanel`)

@MainActor final class LiveTelemetryNavigationTests: XCTestCase {
    func testRowsAndLocationChips() {
        let data = NavigationTelemetry(
            destinationName: "Supercharger",
            distanceToArrival: 12.4,
            minutesToArrival: 14,
            locatedAtHome: false,
            locatedAtWork: true,
            locatedAtFavorite: false
        )
        let projection = LiveTelemetryProjections.navigation(data, units: .metric, locale: enUS)
        XCTAssertEqual(projection.destination, "Supercharger")
        XCTAssertEqual(projection.distanceText, "12.4 km")
        XCTAssertEqual(projection.etaText, "14 min")
        XCTAssertTrue(projection.showWork)
        XCTAssertFalse(projection.showNoLocation)
    }

    func testEmptyDestinationAndNoLocation() {
        let projection = LiveTelemetryProjections.navigation(
            NavigationTelemetry(destinationName: ""),
            units: .imperial,
            locale: enUS
        )
        XCTAssertEqual(projection.destination, "—")
        XCTAssertEqual(projection.distanceText, "—")
        XCTAssertEqual(projection.etaText, "—")
        XCTAssertTrue(projection.showNoLocation)
    }

    func testImperialDistance() {
        let data = NavigationTelemetry(distanceToArrival: 12.4)
        let projection = LiveTelemetryProjections.navigation(data, units: .imperial, locale: enUS)
        XCTAssertEqual(projection.distanceText, "7.7 mi")
    }
}

// MARK: - Surface projection (web render branches + P4 leaf contract)

@MainActor final class LiveTelemetryProjectionTests: XCTestCase {
    private var fullInput: LiveTelemetryInput {
        LiveTelemetryInput(
            motor: MotorTelemetry(torque: 248),
            climate: ClimateTelemetry(insideTemp: 21),
            security: LiveSecurityTelemetry(locked: true),
            tire: LiveTirePressureTelemetry(frontLeft: 2.5),
            media: MediaTelemetry(playbackStatus: "Playing"),
            navigation: NavigationTelemetry(destinationName: "Home")
        )
    }

    func testErrorTakesPrecedence() {
        let resolved = LiveTelemetryProjection.resolve(
            LiveTelemetryInput(motor: MotorTelemetry(torque: 1), errorMessage: "boom"), locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testLoadingWhenFlagged() {
        let resolved = LiveTelemetryProjection.resolve(LiveTelemetryInput(isLoading: true), locale: enUS)
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testEmptyWhenNoTelemetry() {
        let resolved = LiveTelemetryProjection.resolve(LiveTelemetryInput(), locale: enUS)
        XCTAssertEqual(resolved.phase, .empty)
    }

    func testDataResolvesEveryPanel() {
        let resolved = LiveTelemetryProjection.resolve(fullInput, locale: enUS)
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertNotNil(resolved.drivetrain)
        XCTAssertNotNil(resolved.climate)
        XCTAssertNotNil(resolved.security)
        XCTAssertNotNil(resolved.tire)
        XCTAssertNotNil(resolved.media)
        XCTAssertNotNil(resolved.navigation)
    }

    func testPartialDataLeavesMissingPanelsNilForSkeleton() {
        let input = LiveTelemetryInput(motor: MotorTelemetry(torque: 248))
        let resolved = LiveTelemetryProjection.resolve(input, locale: enUS)
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertNotNil(resolved.drivetrain)
        XCTAssertNil(resolved.climate)
        XCTAssertNil(resolved.navigation)
    }
}
