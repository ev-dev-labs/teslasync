//
//  LiveTelemetryPanels.Tests.swift
//  TeslaSync — P4 feature view · 0281 · LiveTelemetryPanels (Apple)
//
//  Unit coverage for the Live Telemetry adapter + the seven panel projections: web-parity
//  number formatting (`fmtNumber` / `fmtInt` / `fmtWithUnit`), SI conversion + the
//  `format*` unit formatters, `cleanNil`, the tire-pressure bands, the freshness age label,
//  and every panel projector (rows, chips, tiles, tones, empty branches). Pure Foundation
//  logic — runs on a plain host.
//

import XCTest
@testable import TeslaSync

// MARK: - Number formatting (web parity)

@MainActor final class LTPFormatTests: XCTestCase {
    private let units = LTPUnitPrefs()

    func testNumberGroupsAndFixesFractionDigits() {
        XCTAssertEqual(LTPFormat.number(688, decimals: 0, localeIdentifier: "en-US"), "688")
        XCTAssertEqual(LTPFormat.number(1000, decimals: 0, localeIdentifier: "en-US"), "1,000")
        XCTAssertEqual(LTPFormat.number(1234.5, decimals: 1, localeIdentifier: "en-US"), "1,234.5")
    }

    func testFmtNumberUsesGlobalPrecisionTwo() {
        XCTAssertEqual(LTPFormat.fmtNumber(184.2, units), "184.20")
        XCTAssertEqual(LTPFormat.fmtNumber(11000, units), "11,000.00")
    }

    func testFmtIntAndWithUnit() {
        XCTAssertEqual(LTPFormat.fmtInt(4210, units), "4,210")
        XCTAssertEqual(LTPFormat.fmtWithUnit(11000, "kW", units), "11,000.00 kW")
        XCTAssertEqual(LTPFormat.fmtWithUnit(24500, "kWh", units), "24,500.00 kWh")
    }

    func testRoundsHalfUpAndSafeNumber() {
        XCTAssertEqual(LTPFormat.number(70.5, decimals: 0, localeIdentifier: "en-US"), "71")
        XCTAssertEqual(LTPFormat.safeNumber(.nan), 0)
        XCTAssertEqual(LTPFormat.safeNumber(.infinity), 0)
        XCTAssertEqual(LTPFormat.fmtNumber(.nan, units), "0.00")
    }

    func testLocaleAffectsSeparators() {
        XCTAssertEqual(LTPFormat.number(1234.5, decimals: 1, localeIdentifier: "de_DE"), "1.234,5")
    }
}

// MARK: - SI conversion + unit formatters (web parity)

@MainActor final class LTPUnitsTests: XCTestCase {
    private let metric = LTPUnitPrefs()
    private let imperial = LTPUnitPrefs.imperial

    func testConvertersMatchWebConstants() {
        XCTAssertEqual(LTPUnits.distanceFromSI(1609.344, to: "mi"), 1, accuracy: 1e-9)
        XCTAssertEqual(LTPUnits.distanceFromSI(1000, to: "km"), 1, accuracy: 1e-9)
        XCTAssertEqual(LTPUnits.speedFromSI(29, to: "km/h"), 104.4, accuracy: 1e-6)
        XCTAssertEqual(LTPUnits.temperatureFromSI(21.5, to: "°F"), 70.7, accuracy: 1e-9)
        XCTAssertEqual(LTPUnits.pressureFromSI(290, to: "psi"), 290 / 6.894757, accuracy: 1e-6)
        XCTAssertEqual(LTPUnits.pressureFromSI(290, to: "bar"), 2.9, accuracy: 1e-9)
    }

    func testFormatTemperatureNoSpaceAndEmptyFallback() {
        XCTAssertEqual(LTPUnits.formatTemperature(21.5, metric), "21.5°C")
        XCTAssertEqual(LTPUnits.formatTemperature(21.5, imperial), "70.7°F")
        XCTAssertEqual(LTPUnits.formatTemperature(nil, metric), "—")
        XCTAssertEqual(LTPUnits.formatTemperature(.nan, metric), "—")
    }

    func testFormatSpeedPressureDistanceDefaults() {
        XCTAssertEqual(LTPUnits.formatSpeed(29, metric), "104 km/h")
        XCTAssertEqual(LTPUnits.formatSpeed(29, imperial), "65 mph")
        XCTAssertEqual(LTPUnits.formatPressure(290, metric), "2.9 bar")
        XCTAssertEqual(LTPUnits.formatPressure(290, imperial), "42.1 psi")
        XCTAssertEqual(LTPUnits.formatDistance(1609.344, imperial), "1.0 mi")
        XCTAssertEqual(LTPUnits.formatSpeed(nil, metric), "—")
    }
}

// MARK: - cleanNil + tire bands + freshness (web parity)

@MainActor final class LTPAdapterHelperTests: XCTestCase {
    func testCleanNilScrubsGoNilStrings() {
        XCTAssertNil(LTPClean.cleanNil("<nil>"))
        XCTAssertNil(LTPClean.cleanNil("nil"))
        XCTAssertNil(LTPClean.cleanNil("null"))
        XCTAssertNil(LTPClean.cleanNil(""))
        XCTAssertNil(LTPClean.cleanNil(nil))
        XCTAssertEqual(LTPClean.cleanNil("Spotify"), "Spotify")
    }

    func testTireCornerToneBands() {
        XCTAssertEqual(LTPTirePressure.cornerTone(nil), .neutral)
        XCTAssertEqual(LTPTirePressure.cornerTone(200_000), .danger) // < lowCritical
        XCTAssertEqual(LTPTirePressure.cornerTone(230_000), .warning) // < lowWarning
        XCTAssertEqual(LTPTirePressure.cornerTone(290_000), .success) // in band
        XCTAssertEqual(LTPTirePressure.cornerTone(360_000), .danger) // > highCritical
        XCTAssertEqual(LTPTirePressure.paToKpa(290_000), 290)
        XCTAssertNil(LTPTirePressure.paToKpa(nil))
    }

    func testFormatAgeBuckets() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        XCTAssertEqual(LTPRelativeTime.formatAge(nil, now: now), "—")
        XCTAssertEqual(LTPRelativeTime.formatAge(now.addingTimeInterval(-5), now: now), "just now")
        XCTAssertEqual(LTPRelativeTime.formatAge(now.addingTimeInterval(-30), now: now), "30s ago")
        XCTAssertEqual(LTPRelativeTime.formatAge(now.addingTimeInterval(-120), now: now), "2m ago")
        XCTAssertEqual(LTPRelativeTime.formatAge(now.addingTimeInterval(-7200), now: now), "2h ago")
    }
}

// MARK: - Powertrain projection (web `PowertrainPanel`)

@MainActor final class LTPPowertrainProjectionTests: XCTestCase {
    private let units = LTPUnitPrefs()

    func testEmptyWhenNoMotor() {
        let projection = LTPPowertrainProjection.project(nil, units)
        XCTAssertFalse(projection.hasData)
        XCTAssertEqual(projection.emptyMessage, "No motor data available")
    }

    func testShiftToneAndPowerBar() {
        let drive = LTPPowertrainProjection.project(LTPMotor(shiftState: "D", powerKw: 184.2), units)
        XCTAssertEqual(drive.shiftChip.text, "D")
        XCTAssertEqual(drive.shiftChip.tone, .success)
        XCTAssertEqual(drive.powerValue, "184.20 kW")
        XCTAssertTrue(drive.powerKnown)
        XCTAssertTrue(drive.powerPositive)
        XCTAssertEqual(drive.powerFillFraction, min(184.2 / 300, 1), accuracy: 1e-9)

        let reverse = LTPPowertrainProjection.project(LTPMotor(shiftState: "R", powerKw: -60), units)
        XCTAssertEqual(reverse.shiftChip.tone, .danger)
        XCTAssertFalse(reverse.powerPositive)
        XCTAssertEqual(reverse.powerValue, "-60.00 kW")

        let unknown = LTPPowertrainProjection.project(LTPMotor(shiftState: nil, powerKw: nil), units)
        XCTAssertEqual(unknown.shiftChip.text, "Unknown")
        XCTAssertEqual(unknown.shiftChip.tone, .neutral)
        XCTAssertFalse(unknown.powerKnown)
        XCTAssertEqual(unknown.powerValue, "— kW")
    }

    func testTilesTempsAndRegen() {
        let projection = LTPPowertrainProjection.project(
            LTPMotor(
                regenKw: 18,
                motorRpmFront: 4210,
                torqueNmFront: 312,
                motorTempCFront: 62,
                motorTempCRear: 58,
                inverterTempC: 44
            ),
            units
        )
        XCTAssertEqual(projection.rpmFront.value, "4,210")
        XCTAssertEqual(projection.rpmFront.unit, "RPM")
        XCTAssertEqual(projection.torqueFront.value, "312.00")
        XCTAssertEqual(projection.torqueFront.unit, "Nm")
        XCTAssertEqual(projection.motorTempRow.value, "62.0°C") // peak of 62 / 58
        XCTAssertEqual(projection.motorTempRow.valueTone, .neutral)
        XCTAssertEqual(projection.inverterTempRow.value, "44.0°C")
        XCTAssertEqual(projection.regenRow.value, "18.00 kW")
        XCTAssertEqual(projection.regenRow.valueTone, .success)
    }

    func testMotorTempDangerAboveEightyAndMissingBothTemps() {
        let hot = LTPPowertrainProjection.project(LTPMotor(motorTempCFront: 92, motorTempCRear: 70), units)
        XCTAssertEqual(hot.motorTempRow.valueTone, .danger)

        let missing = LTPPowertrainProjection.project(LTPMotor(motorTempCFront: nil, motorTempCRear: nil), units)
        XCTAssertEqual(missing.motorTempRow.value, "—")
        XCTAssertEqual(missing.motorTempRow.valueTone, .neutral)
    }
}

// MARK: - Climate projection (web `ClimatePanel`)

@MainActor final class LTPClimateProjectionTests: XCTestCase {
    private let units = LTPUnitPrefs()

    func testEmptyWhenNoClimate() {
        XCTAssertFalse(LTPClimateProjection.project(nil, units).hasData)
    }

    func testTilesFanClampAndChips() {
        let projection = LTPClimateProjection.project(
            LTPClimate(
                insideTempC: 21.5,
                outsideTempC: 12,
                hvacState: "On",
                defrostMode: "Front",
                isClimateOn: true,
                isPreconditioning: false,
                fanStatus: 9
            ),
            units
        )
        XCTAssertEqual(projection.cabinTile.value, "21.5°C")
        XCTAssertEqual(projection.outsideTile.value, "12.0°C")
        XCTAssertEqual(projection.hvacRow.value, "On")
        XCTAssertEqual(projection.fanLevel, 6) // clamped from 9
        XCTAssertEqual(projection.fanValue, "9")
        XCTAssertEqual(projection.chips.map(\.id), ["defrost", "climateOn", "precondition"])
        XCTAssertEqual(projection.chips[0].text, "Defrost Front")
        XCTAssertEqual(projection.chips[0].tone, .info)
        XCTAssertEqual(projection.chips[1].text, "Climate On")
        XCTAssertEqual(projection.chips[1].tone, .success)
        XCTAssertEqual(projection.chips[2].text, "Precondition Off")
        XCTAssertEqual(projection.chips[2].tone, .neutral)
    }

    func testDefrostOffIsNeutralAndFanDefaultsZero() {
        let projection = LTPClimateProjection.project(LTPClimate(defrostMode: "Off"), units)
        XCTAssertEqual(projection.chips[0].text, "Defrost Off")
        XCTAssertEqual(projection.chips[0].tone, .neutral)
        XCTAssertEqual(projection.fanLevel, 0)
        XCTAssertEqual(projection.fanValue, "0")
        XCTAssertEqual(projection.hvacRow.value, "—")
    }
}

// MARK: - Security projection (web `SecurityPanel`)

@MainActor final class LTPSecurityProjectionTests: XCTestCase {
    private let units = LTPUnitPrefs()

    func testEmptyOnlyWhenBothNil() {
        XCTAssertFalse(LTPSecurityProjection.project(nil, remoteStartEnabled: nil, units).hasData)
        XCTAssertTrue(LTPSecurityProjection.project(nil, remoteStartEnabled: true, units).hasData)
        XCTAssertTrue(LTPSecurityProjection.project(LTPSecurity(locked: true), remoteStartEnabled: nil, units).hasData)
    }

    func testLockSentryRowsAndRemoteStart() {
        let projection = LTPSecurityProjection.project(
            LTPSecurity(
                locked: true,
                sentryMode: true,
                doorsOpen: nil,
                windowsOpen: "FrontLeft",
                userPresent: true,
                detail: "<nil>"
            ),
            remoteStartEnabled: true,
            units
        )
        XCTAssertEqual(projection.lockText, "Locked")
        XCTAssertEqual(projection.lockTone, .success)
        XCTAssertEqual(projection.lockIcon, "lock.fill")
        XCTAssertEqual(projection.sentryChip.text, "Active")
        XCTAssertEqual(projection.sentryChip.tone, .danger)
        XCTAssertEqual(projection.doorsRow.value, "Closed") // web `?? Closed`
        XCTAssertEqual(projection.windowsRow.value, "FrontLeft")
        XCTAssertEqual(projection.userPresentRow.value, "Yes")
        XCTAssertEqual(projection.userPresentRow.valueTone, .success)
        XCTAssertNil(projection.detail) // "<nil>" scrubbed by cleanNil
        XCTAssertEqual(projection.remoteStartRow.value, "Enabled")
        XCTAssertEqual(projection.remoteStartRow.valueTone, .success)
    }

    func testUnlockedSentryOffAndRemoteUnknown() {
        let projection = LTPSecurityProjection.project(
            LTPSecurity(locked: false, sentryMode: false, userPresent: false),
            remoteStartEnabled: nil,
            units
        )
        XCTAssertEqual(projection.lockText, "Unlocked")
        XCTAssertEqual(projection.lockTone, .warning)
        XCTAssertEqual(projection.lockIcon, "lock.open.fill")
        XCTAssertEqual(projection.sentryChip.text, "Inactive")
        XCTAssertEqual(projection.userPresentRow.value, "No")
        XCTAssertEqual(projection.remoteStartRow.value, "—")
        XCTAssertEqual(projection.remoteStartRow.valueTone, .neutral)
    }
}
