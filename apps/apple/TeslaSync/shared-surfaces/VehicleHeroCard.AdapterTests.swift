//
//  VehicleHeroCard.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0233 · VehicleHeroCard (Apple)
//
//  The pure-core coverage (the Foundation-only adapter + projector): the surface identity, the SI converters
//  (web `convertDistanceFromSI` / `convertTempFromSI`), the JS-faithful rounders + number formatters
//  (`Math.round` half-toward-+∞, `fmtInt` / `fmtNumber` / the gauge formatter), the status catalog (web
//  `toStatus` + the FSM validity gate), and the full projection — the four gauges (values, unit-scaled maxima,
//  battery threshold, clamp), the eight stat cards (source order + values + grouping + lock/sentry/firmware/
//  power), the identity (status precedence), the photo alt, and the no-live-state guard. Split from
//  VehicleHeroCard.Tests.swift (the SwiftUI / state-holder half) for the SwiftLint file-length budget. These
//  run in the TeslaSync(/-macOS) XCTest targets; the derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum VHCFixture {
    static let vehicle = VehicleHeroCardVehicle(
        id: 7,
        displayName: "Lightning",
        model: "Model 3",
        vin: "5YJ3E1EA7KF000001",
        state: "online"
    )

    /// A live state with conversion-friendly SI inputs: 480 km / 298 mi range, 100 000 mi / 160 934 km
    /// odometer, 22.5 °C (→ 73 °F) inside, 14 °C (→ 57 °F) outside.
    static func state(
        battery: Double = 72,
        charging: Bool = false,
        locked: Bool = true,
        sentry: Bool = true,
        power: Double = 0
    ) -> VehicleHeroCardLiveState {
        VehicleHeroCardLiveState(
            batteryLevel: battery,
            ratedRangeMeters: 480_000,
            insideTempC: 22.5,
            outsideTempC: 14,
            odometerMeters: 160_934_400,
            isCharging: charging,
            isLocked: locked,
            sentryMode: sentry,
            softwareVersion: "2026.6.2",
            power: power,
            state: charging ? "charging" : "online"
        )
    }

    static func copy() -> VehicleHeroCardCopy {
        VehicleHeroCardStrings.makeCopy { _, fallback in fallback }
    }
}

// MARK: - Surface identity

final class VehicleHeroCardSurfaceTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(VehicleHeroCardSurface.slug, "VehicleHeroCard")
    }

    func testRangeMaxScalesWithUnit() {
        XCTAssertEqual(VehicleHeroCardSurface.rangeMax(distanceUnit: "km"), 644)
        XCTAssertEqual(VehicleHeroCardSurface.rangeMax(distanceUnit: "mi"), 400)
    }

    func testTempMaxScalesWithUnit() {
        XCTAssertEqual(VehicleHeroCardSurface.tempMax(temperatureUnit: "°C"), 50)
        XCTAssertEqual(VehicleHeroCardSurface.tempMax(temperatureUnit: "°F"), 122)
    }
}

// MARK: - Converters (web unitConversion.ts)

final class VehicleHeroCardConvertTests: XCTestCase {
    func testDistanceFromSI() {
        XCTAssertEqual(VehicleHeroCardConvert.distanceFromSI(1609.344, to: "mi"), 1, accuracy: 1e-9)
        XCTAssertEqual(VehicleHeroCardConvert.distanceFromSI(1000, to: "km"), 1, accuracy: 1e-9)
        XCTAssertEqual(VehicleHeroCardConvert.distanceFromSI(0.3048, to: "ft"), 1, accuracy: 1e-9)
    }

    func testDistanceUnknownUnitDefaultsToKilometers() {
        XCTAssertEqual(VehicleHeroCardConvert.distanceFromSI(2000, to: "parsec"), 2, accuracy: 1e-9)
    }

    func testTempFromSI() {
        XCTAssertEqual(VehicleHeroCardConvert.tempFromSI(0, to: "°F"), 32, accuracy: 1e-9)
        XCTAssertEqual(VehicleHeroCardConvert.tempFromSI(100, to: "°F"), 212, accuracy: 1e-9)
        XCTAssertEqual(VehicleHeroCardConvert.tempFromSI(25, to: "°C"), 25, accuracy: 1e-9)
    }
}

// MARK: - Formatting + JS rounding (web numberFormat.ts)

final class VehicleHeroCardFormatTests: XCTestCase {
    func testJsRoundHalfTowardPositiveInfinity() {
        XCTAssertEqual(VehicleHeroCardFormat.jsRound(2.5), 3)
        XCTAssertEqual(VehicleHeroCardFormat.jsRound(-2.5), -2, "JS Math.round(-2.5) == -2, not -3")
        XCTAssertEqual(VehicleHeroCardFormat.jsRound(2.4), 2)
        XCTAssertEqual(VehicleHeroCardFormat.jsRound(-2.6), -3)
    }

    func testJsRoundNonFiniteIsZero() {
        XCTAssertEqual(VehicleHeroCardFormat.jsRound(.nan), 0)
        XCTAssertEqual(VehicleHeroCardFormat.jsRound(.infinity), 0)
    }

    func testFmtIntGroupsAndRoundsToZeroFraction() {
        XCTAssertEqual(VehicleHeroCardFormat.fmtInt(100_000), "100,000")
        XCTAssertEqual(VehicleHeroCardFormat.fmtInt(1234.6), "1,235")
        XCTAssertEqual(VehicleHeroCardFormat.fmtInt(.nan), "0", "web safeNumber → 0")
    }

    func testFmtNumberUsesGlobalPrecision() {
        XCTAssertEqual(VehicleHeroCardFormat.fmtNumber(0), "0.00")
        XCTAssertEqual(VehicleHeroCardFormat.fmtNumber(1234.5), "1,234.50")
        XCTAssertEqual(VehicleHeroCardFormat.fmtNumber(-11), "-11.00")
    }

    func testGaugeValueDropsFractionForIntegers() {
        XCTAssertEqual(VehicleHeroCardFormat.gaugeValue(72), "72")
        XCTAssertEqual(VehicleHeroCardFormat.gaugeValue(298), "298")
        XCTAssertEqual(VehicleHeroCardFormat.gaugeValue(72.5), "72.50", "fractional → global precision")
    }
}

// MARK: - Status catalog (web toStatus + FSM gate)

final class VehicleHeroCardStatusTests: XCTestCase {
    func testKnownStatesResolve() {
        XCTAssertEqual(VehicleHeroCardStatus.from("online"), .online)
        XCTAssertEqual(VehicleHeroCardStatus.from("charging"), .charging)
        XCTAssertEqual(VehicleHeroCardStatus.from("CHARGING"), .charging, "case-folded")
    }

    func testUnknownOrNilFallsBackToOffline() {
        XCTAssertEqual(VehicleHeroCardStatus.from("teleporting"), .offline)
        XCTAssertEqual(VehicleHeroCardStatus.from(""), .offline)
        XCTAssertEqual(VehicleHeroCardStatus.from(nil), .offline)
    }

    func testLabelIsCapitalized() {
        XCTAssertEqual(VehicleHeroCardStatus.online.label, "Online")
        XCTAssertEqual(VehicleHeroCardStatus.offline.label, "Offline")
    }
}

// MARK: - Gauges (web RadialGauge array)

final class VehicleHeroCardGaugeTests: XCTestCase {
    private func gauges(_ prefs: VehicleHeroCardUnitPrefs, battery: Double = 72) -> [VehicleHeroCardGauge] {
        VehicleHeroCardProjector.gauges(
            state: VHCFixture.state(battery: battery),
            prefs: prefs,
            copy: VHCFixture.copy()
        )
    }

    func testImperialGaugeValuesAndMaxima() {
        let result = gauges(.imperial)
        XCTAssertEqual(result.map(\.kind), [.battery, .range, .inside, .outside])
        XCTAssertEqual(result[0].valueText, "72")
        XCTAssertEqual(result[1].valueText, "298") // 480000 m / 1609.344 → 298 mi
        XCTAssertEqual(result[1].max, 400)
        XCTAssertEqual(result[2].valueText, "73") // 22.5 °C → 72.5 °F → 73
        XCTAssertEqual(result[3].valueText, "57") // 14 °C → 57.2 °F → 57
        XCTAssertEqual(result[2].max, 122)
    }

    func testMetricGaugeValuesAndMaxima() {
        let result = gauges(.metric)
        XCTAssertEqual(result[1].valueText, "480") // 480000 m → 480 km
        XCTAssertEqual(result[1].max, 644)
        XCTAssertEqual(result[2].valueText, "23") // 22.5 °C → 23
        XCTAssertEqual(result[2].unit, "°C")
        XCTAssertEqual(result[2].max, 50)
    }

    func testBatteryFractionClampsAndIsFinite() {
        XCTAssertEqual(gauges(.imperial, battery: 72)[0].fraction, 0.72, accuracy: 1e-9)
        XCTAssertEqual(gauges(.imperial, battery: 140)[0].fraction, 1, accuracy: 1e-9)
        XCTAssertEqual(gauges(.imperial, battery: -10)[0].fraction, 0, accuracy: 1e-9)
    }
}

// MARK: - Stat cards (web StatCard grid)

final class VehicleHeroCardStatTests: XCTestCase {
    private func stats(_ prefs: VehicleHeroCardUnitPrefs, _ state: VehicleHeroCardLiveState) -> [VehicleHeroCardStat] {
        VehicleHeroCardProjector.stats(state: state, prefs: prefs, copy: VHCFixture.copy())
    }

    func testImperialStatOrderAndValues() {
        let result = stats(.imperial, VHCFixture.state())
        XCTAssertEqual(result.map(\.key), [
            "insideTemp", "outsideTemp", "odometer", "range", "status", "sentry", "firmware", "power"
        ])
        XCTAssertEqual(result.map(\.value), [
            "73", "57", "100,000", "298", "Locked", "On", "2026.6.2", "0.00"
        ])
        XCTAssertEqual(result[2].unit, "mi")
        XCTAssertEqual(result[7].unit, "kW")
    }

    func testMetricOdometerGroupingAndRange() {
        let result = stats(.metric, VHCFixture.state())
        XCTAssertEqual(result[2].value, "160,934") // 160934400 m → 160934 km, grouped
        XCTAssertEqual(result[3].value, "480")
    }

    func testUnlockedAndSentryOffAndPower() {
        let state = VHCFixture.state(locked: false, sentry: false, power: -11)
        let result = stats(.imperial, state)
        XCTAssertEqual(result[4].value, "Unlocked")
        XCTAssertEqual(result[5].value, "Off")
        XCTAssertEqual(result[7].value, "-11.00")
    }
}

// MARK: - Projection (identity, photo, no-live-state)

final class VehicleHeroCardProjectionTests: XCTestCase {
    private func project(
        liveState: VehicleHeroCardLiveState?,
        hasPhoto: Bool = false
    ) -> VehicleHeroCardProjection {
        VehicleHeroCardProjector.projection(
            vehicle: VHCFixture.vehicle,
            liveState: liveState,
            prefs: .imperial,
            hasPhoto: hasPhoto,
            copy: VHCFixture.copy()
        )
    }

    func testIdentityPrefersLiveStateForStatus() {
        let projection = project(liveState: VHCFixture.state(charging: true))
        XCTAssertEqual(projection.identity.status, .charging, "liveState.state over vehicle.state")
        XCTAssertEqual(projection.identity.vehicleID, 7)
        XCTAssertEqual(projection.identity.title, "Lightning")
        XCTAssertEqual(projection.identity.model, "Model 3")
    }

    func testIdentityFallsBackToVehicleStateWhenNoLiveState() {
        let projection = project(liveState: nil)
        XCTAssertEqual(projection.identity.status, .online)
        XCTAssertFalse(projection.hasLiveState)
        XCTAssertTrue(projection.gauges.isEmpty)
        XCTAssertTrue(projection.stats.isEmpty)
    }

    func testLiveStateProjectionHasFourGaugesAndEightStats() {
        let projection = project(liveState: VHCFixture.state())
        XCTAssertTrue(projection.hasLiveState)
        XCTAssertEqual(projection.gauges.count, 4)
        XCTAssertEqual(projection.stats.count, 8)
    }

    func testPhotoAltInterpolatesWhenPhotoPresent() {
        XCTAssertEqual(project(liveState: nil, hasPhoto: true).photoAlt, "Lightning photo")
        XCTAssertNil(project(liveState: nil, hasPhoto: false).photoAlt)
    }
}

// MARK: - Value-type equality

final class VehicleHeroCardValueTypeTests: XCTestCase {
    func testGaugeEqualityAndIdentity() {
        let gauge = VehicleHeroCardGauge(
            kind: .battery, value: 72, max: 100, unit: "%", valueText: "72", label: "Battery"
        )
        XCTAssertEqual(gauge.id, "battery")
        XCTAssertEqual(gauge, gauge)
    }

    func testStatIdentity() {
        let stat = VehicleHeroCardStat(key: "power", label: "Power", value: "0.00", unit: "kW")
        XCTAssertEqual(stat.id, "power")
    }

    func testConnectionCases() {
        XCTAssertEqual(VehicleHeroCardConnection.allCases, [.live, .stale, .offline])
    }
}
