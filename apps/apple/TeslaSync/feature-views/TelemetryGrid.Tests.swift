//
//  TelemetryGrid.Tests.swift
//  TeslaSync — P4 feature view · 0285 · TelemetryGrid (Apple)
//
//  Unit coverage for the TelemetryGrid adapter + the six-tile projection: web-parity number
//  formatting (`fmtNumber` / `fmtInt`), SI conversion + the `format*` unit formatters, the
//  per-tile values / tones / sub-captions (battery thresholds, charger / sentry states,
//  parked vs driving), the surface-empty branch, and the freshness age label. Pure
//  Foundation logic — runs on a plain host.
//

import XCTest
@testable import TeslaSync

// MARK: - Number formatting (web parity)

@MainActor final class TelemetryGridFormatTests: XCTestCase {
    private let units = TGUnitPrefs()

    func testNumberGroupsAndFixesFractionDigits() {
        XCTAssertEqual(TGFormat.number(688, decimals: 0, localeIdentifier: "en-US"), "688")
        XCTAssertEqual(TGFormat.number(53201, decimals: 0, localeIdentifier: "en-US"), "53,201")
        XCTAssertEqual(TGFormat.number(1234.5, decimals: 1, localeIdentifier: "en-US"), "1,234.5")
    }

    func testFmtNumberUsesGlobalPrecisionTwo() {
        XCTAssertEqual(TGFormat.fmtNumber(1.5, units), "1.50")
        XCTAssertEqual(TGFormat.fmtNumber(11, units), "11.00")
    }

    func testFmtIntRoundsHalfUpAndScrubsNonFinite() {
        XCTAssertEqual(TGFormat.fmtInt(64, units), "64")
        XCTAssertEqual(TGFormat.fmtInt(70.5, units), "71")
        XCTAssertEqual(TGFormat.safeNumber(.nan), 0)
        XCTAssertEqual(TGFormat.safeNumber(.infinity), 0)
        XCTAssertEqual(TGFormat.fmtNumber(.nan, units), "0.00")
    }

    func testLocaleAffectsSeparators() {
        XCTAssertEqual(TGFormat.number(1234.5, decimals: 1, localeIdentifier: "de_DE"), "1.234,5")
    }
}

// MARK: - SI conversion + unit formatters (web parity)

@MainActor final class TelemetryGridUnitsTests: XCTestCase {
    private let metric = TGUnitPrefs()
    private let imperial = TGUnitPrefs.imperial

    func testConvertersMatchWebConstants() {
        XCTAssertEqual(TGUnits.distanceFromSI(1609.344, to: "mi"), 1, accuracy: 1e-9)
        XCTAssertEqual(TGUnits.distanceFromSI(1000, to: "km"), 1, accuracy: 1e-9)
        XCTAssertEqual(TGUnits.speedFromSI(29, to: "km/h"), 104.4, accuracy: 1e-6)
        XCTAssertEqual(TGUnits.temperatureFromSI(21.5, to: "°F"), 70.7, accuracy: 1e-9)
    }

    func testFormatDistanceDefaultAndPrecisionOverride() {
        XCTAssertEqual(TGUnits.formatDistance(412_000, metric), "412.0 km")
        XCTAssertEqual(TGUnits.formatDistance(53_201_000, metric, precision: 0), "53,201 km")
        XCTAssertEqual(TGUnits.formatDistance(nil, metric), "—")
        XCTAssertEqual(TGUnits.formatDistance(.nan, metric), "—")
    }

    func testFormatSpeedZeroPrecision() {
        XCTAssertEqual(TGUnits.formatSpeed(29, metric), "104 km/h")
        XCTAssertEqual(TGUnits.formatSpeed(29, imperial), "65 mph")
        XCTAssertEqual(TGUnits.formatSpeed(0, metric), "0 km/h")
        XCTAssertEqual(TGUnits.formatSpeed(nil, metric), "—")
    }

    func testFormatTemperatureNoSpaceAndEmptyFallback() {
        XCTAssertEqual(TGUnits.formatTemperature(21.5, metric), "21.5°C")
        XCTAssertEqual(TGUnits.formatTemperature(21.5, imperial), "70.7°F")
        XCTAssertEqual(TGUnits.formatTemperature(nil, metric), "—")
        XCTAssertEqual(TGUnits.formatTemperature(.nan, metric), "—")
    }
}

// MARK: - Six-tile projection (web `TelemetryGrid` parity)

@MainActor final class TelemetryGridProjectorTests: XCTestCase {
    private func tile(_ projection: TelemetryGridProjection, _ id: String) -> TelemetryGridTile? {
        projection.tiles.first { $0.id == id }
    }

    private func project(_ vehicle: TGVehicleSnapshot, units: TGUnitPrefs = TGUnitPrefs()) -> TelemetryGridProjection {
        TelemetryGridProjector.project(update: TelemetryGridUpdate(vehicle: vehicle, units: units))
    }

    private func full() -> TGVehicleSnapshot {
        TGVehicleSnapshot(
            batteryLevel: 64,
            ratedRangeMeters: 412_000,
            speedMetersPerSecond: 29,
            insideTempC: 21.5,
            outsideTempC: 12,
            odometerMeters: 53_201_000,
            isCharging: true,
            chargerPowerKw: 11,
            timeToFullChargeHours: 1.5,
            sentryMode: true
        )
    }

    func testProducesSixTilesInWebOrder() {
        let projection = project(full())
        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.tiles.map(\.id), ["battery", "speed", "inside", "odometer", "charger", "sentry"])
    }

    func testBatteryTileValueSubAndThreshold() {
        let battery = tile(project(full()), "battery")
        XCTAssertEqual(battery?.label, "Battery")
        XCTAssertEqual(battery?.value, "64%")
        XCTAssertEqual(battery?.valueTone, .success)
        XCTAssertEqual(battery?.sub, "412.0 km range")
    }

    func testBatteryThresholdsMatchWeb() {
        XCTAssertEqual(tile(project(TGVehicleSnapshot(batteryLevel: 51)), "battery")?.valueTone, .success)
        XCTAssertEqual(tile(project(TGVehicleSnapshot(batteryLevel: 50)), "battery")?.valueTone, .warning)
        XCTAssertEqual(tile(project(TGVehicleSnapshot(batteryLevel: 21)), "battery")?.valueTone, .warning)
        XCTAssertEqual(tile(project(TGVehicleSnapshot(batteryLevel: 20)), "battery")?.valueTone, .danger)
        XCTAssertEqual(tile(project(TGVehicleSnapshot(batteryLevel: nil)), "battery")?.value, "—")
        XCTAssertEqual(tile(project(TGVehicleSnapshot(batteryLevel: nil)), "battery")?.valueTone, .muted)
    }

    func testSpeedTileDrivingVsParked() {
        XCTAssertEqual(tile(project(full()), "speed")?.value, "104 km/h")
        XCTAssertEqual(tile(project(full()), "speed")?.sub, "Driving")
        let parked = project(TGVehicleSnapshot(speedMetersPerSecond: 0))
        XCTAssertEqual(tile(parked, "speed")?.value, "0 km/h")
        XCTAssertEqual(tile(parked, "speed")?.sub, "Parked")
    }

    func testInsideTileShowsOutsideSub() {
        let inside = tile(project(full()), "inside")
        XCTAssertEqual(inside?.value, "21.5°C")
        XCTAssertEqual(inside?.sub, "Outside: 12.0°C")
    }

    func testOdometerTileUsesZeroPrecisionNoSub() {
        let odometer = tile(project(full()), "odometer")
        XCTAssertEqual(odometer?.value, "53,201 km")
        XCTAssertNil(odometer?.sub)
    }

    func testChargerTileChargingValueToneAndEta() {
        let charger = tile(project(full()), "charger")
        XCTAssertEqual(charger?.value, "11 kW")
        XCTAssertEqual(charger?.valueTone, .success)
        XCTAssertEqual(charger?.sub, "Full in 1.50h")
    }

    func testChargerTileNotCharging() {
        let charger = tile(project(TGVehicleSnapshot(isCharging: false, timeToFullChargeHours: 2)), "charger")
        XCTAssertEqual(charger?.value, "Not charging")
        XCTAssertEqual(charger?.valueTone, .muted)
        XCTAssertNil(charger?.sub)
    }

    func testChargerTileChargingWithoutEtaHasNoSub() {
        let charger = tile(project(TGVehicleSnapshot(isCharging: true, chargerPowerKw: 7)), "charger")
        XCTAssertEqual(charger?.value, "7 kW")
        XCTAssertNil(charger?.sub)
    }

    func testSentryTileActiveVsOff() {
        XCTAssertEqual(tile(project(TGVehicleSnapshot(sentryMode: true)), "sentry")?.value, "Active")
        XCTAssertEqual(tile(project(TGVehicleSnapshot(sentryMode: true)), "sentry")?.valueTone, .danger)
        XCTAssertEqual(tile(project(TGVehicleSnapshot(sentryMode: false)), "sentry")?.value, "Off")
        XCTAssertEqual(tile(project(TGVehicleSnapshot(sentryMode: false)), "sentry")?.valueTone, .muted)
    }

    func testImperialUnitsConvertEveryQuantity() {
        let projection = project(full(), units: .imperial)
        XCTAssertEqual(tile(projection, "battery")?.sub, "256.0 mi range")
        XCTAssertEqual(tile(projection, "speed")?.value, "65 mph")
        XCTAssertEqual(tile(projection, "inside")?.value, "70.7°F")
        XCTAssertEqual(tile(projection, "inside")?.sub, "Outside: 53.6°F")
    }

    func testEmptyUpdateProducesNoTiles() {
        let projection = TelemetryGridProjector.project(update: TelemetryGridUpdate(status: .loaded))
        XCTAssertFalse(projection.hasData)
        XCTAssertTrue(projection.tiles.isEmpty)
    }

    func testTileSpokenPhraseCombinesLabelValueSub() {
        let battery = tile(project(full()), "battery")
        XCTAssertEqual(battery?.spoken, "Battery, 64%, 412.0 km range")
        let odometer = tile(project(full()), "odometer")
        XCTAssertEqual(odometer?.spoken, "Odometer, 53,201 km")
    }
}

// MARK: - Freshness age label (web parity)

@MainActor final class TelemetryGridRelativeTimeTests: XCTestCase {
    func testFormatAgeBuckets() {
        let now = Date(timeIntervalSince1970: 10000)
        XCTAssertEqual(TGRelativeTime.formatAge(nil, now: now), "—")
        XCTAssertEqual(TGRelativeTime.formatAge(now.addingTimeInterval(-5), now: now), "just now")
        XCTAssertEqual(TGRelativeTime.formatAge(now.addingTimeInterval(-30), now: now), "30s ago")
        XCTAssertEqual(TGRelativeTime.formatAge(now.addingTimeInterval(-120), now: now), "2m ago")
        XCTAssertEqual(TGRelativeTime.formatAge(now.addingTimeInterval(-7200), now: now), "2h ago")
    }
}
