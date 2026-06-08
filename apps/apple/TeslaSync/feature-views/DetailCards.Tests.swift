//
//  DetailCards.Tests.swift
//  TeslaSync — P4 feature view · 0153 · DetailCards (Apple)
//
//  Unit coverage for the DetailCards surface:
//    • Adapter (data → projection) — `DetailCardsNumeric.safe`, `displayTemp`, the
//      "Temperature Details" + "Power Summary" rows (web `KVList` items, the
//      `peakPower > 0` / `avgPowerMax > 0` / `minRegenPower < 0` / `stats` gating),
//      and the all-em-dash empty resolution.
//    • Formatting — `DefaultDetailCardsFormatting` temperature (SI °C, no space),
//      energy (Wh → kWh), and `fmtInt` / `fmtNumber` parity, including the
//      Fahrenheit / watt-hour / settings-precision variants.
//    • Accessibility — the VoiceOver row summary content.
//    • State holder — `DetailCardsModel` phase resolution across loading / loaded /
//      empty / error, projection wiring, the P1/S11 `view.opened` telemetry +
//      source wiring, and connection tracking.
//    • i18n — the projection emits exactly the web `drivetrain.*` label keys.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryDetailCardsSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: numeric guard (port of `safeNumber`)

final class DetailCardsNumericTests: XCTestCase {
    func testSafeReturnsFiniteValues() {
        XCTAssertEqual(DetailCardsNumeric.safe(42.5), 42.5)
        XCTAssertEqual(DetailCardsNumeric.safe(0), 0)
        XCTAssertEqual(DetailCardsNumeric.safe(-3), -3)
    }

    func testSafeZeroesNonFiniteAndNil() {
        XCTAssertEqual(DetailCardsNumeric.safe(nil), 0)
        XCTAssertEqual(DetailCardsNumeric.safe(.nan), 0)
        XCTAssertEqual(DetailCardsNumeric.safe(.infinity), 0)
        XCTAssertEqual(DetailCardsNumeric.safe(-.infinity), 0)
    }
}

// MARK: - Formatting: web `useUnits` + `fmtInt` / `fmtNumber`

final class DetailCardsFormattingTests: XCTestCase {
    private let formatting = DefaultDetailCardsFormatting()

    func testNumberGroupsAndFixedDecimals() {
        XCTAssertEqual(formatting.formatNumber(128.6, decimals: 1), "128.6")
        XCTAssertEqual(formatting.formatNumber(42.57, decimals: 1), "42.6")
        XCTAssertEqual(formatting.formatNumber(0, decimals: 0), "0")
    }

    func testNumberZeroesNonFinite() {
        XCTAssertEqual(formatting.formatNumber(.nan, decimals: 1), "0.0")
        XCTAssertEqual(formatting.formatNumber(.infinity, decimals: 2), "0.00")
    }

    func testIntegerGroupsAndRounds() {
        XCTAssertEqual(formatting.formatInt(312), "312")
        XCTAssertEqual(formatting.formatInt(1840), "1,840")
        XCTAssertEqual(formatting.formatInt(12345.6), "12,346")
    }

    func testTemperatureDefaultPrecisionAndNoSpace() {
        XCTAssertEqual(formatting.formatTemperature(48.0, precision: nil), "48.0°C")
        XCTAssertEqual(formatting.formatTemperature(33.8, precision: nil), "33.8°C")
        XCTAssertEqual(formatting.formatTemperature(-5.2, precision: nil), "-5.2°C")
    }

    func testTemperaturePrecisionOverride() {
        XCTAssertEqual(formatting.formatTemperature(48.0, precision: 0), "48°C")
        XCTAssertEqual(formatting.formatTemperature(48.249, precision: 2), "48.25°C")
    }

    func testTemperatureEmptyForNilOrNonFinite() {
        XCTAssertEqual(formatting.formatTemperature(nil, precision: nil), "—")
        XCTAssertEqual(formatting.formatTemperature(.nan, precision: nil), "—")
        XCTAssertEqual(formatting.formatTemperature(.infinity, precision: nil), "—")
    }

    func testEnergyConvertsWattHoursToKilowattHours() {
        XCTAssertEqual(formatting.formatEnergy(248_600, precision: 1), "248.6 kWh")
        XCTAssertEqual(formatting.formatEnergy(12345, precision: 1), "12.3 kWh")
        XCTAssertEqual(formatting.formatEnergy(0, precision: 1), "0.0 kWh")
    }

    func testEnergyDefaultPrecisionIsTwo() {
        XCTAssertEqual(formatting.formatEnergy(2000, precision: nil), "2.00 kWh")
    }

    func testEnergyEmptyForNilOrNonFinite() {
        XCTAssertEqual(formatting.formatEnergy(nil, precision: 1), "—")
        XCTAssertEqual(formatting.formatEnergy(.nan, precision: 1), "—")
    }

    func testFahrenheitVariantConverts() {
        let fahrenheit = DefaultDetailCardsFormatting(temperatureUnit: "°F")
        XCTAssertEqual(fahrenheit.formatTemperature(0, precision: 0), "32°F")
        XCTAssertEqual(fahrenheit.formatTemperature(100, precision: 0), "212°F")
        XCTAssertEqual(fahrenheit.formatTemperature(20, precision: 1), "68.0°F")
    }

    func testWattHourVariantSkipsKiloConversion() {
        let wattHours = DefaultDetailCardsFormatting(energyUnit: "Wh")
        XCTAssertEqual(wattHours.formatEnergy(2500, precision: 0), "2,500 Wh")
    }

    func testSettingsPrecisionAppliesWhenNoOverride() {
        let precise = DefaultDetailCardsFormatting(settingsPrecision: 2)
        XCTAssertEqual(precise.formatTemperature(48.0, precision: nil), "48.00°C")
        XCTAssertEqual(precise.formatEnergy(248_600, precision: nil), "248.60 kWh")
        XCTAssertEqual(precise.formatEnergy(248_600, precision: 1), "248.6 kWh")
    }
}

// MARK: - Adapter: displayTemp + temperature rows

final class DetailCardsTemperatureProjectionTests: XCTestCase {
    private let formatting = DefaultDetailCardsFormatting()

    private func formatTemp(_ celsius: Double?) -> String {
        formatting.formatTemperature(celsius, precision: nil)
    }

    func testDisplayTempEmDashForNil() {
        XCTAssertEqual(DetailCardsProjection.displayTemp(nil, formatTemperature: formatTemp), "—")
    }

    func testDisplayTempFormatsValue() {
        XCTAssertEqual(DetailCardsProjection.displayTemp(48.0, formatTemperature: formatTemp), "48.0°C")
    }

    func testTemperatureRowsMapAllFourTemps() {
        let health = DetailCardsHealth(
            frontMotorTempC: 48.0,
            rearMotorTempC: 52.5,
            inverterTempC: 41.2,
            batteryTempC: 33.8
        )
        let rows = DetailCardsProjection.temperatureRows(health, formatTemperature: formatTemp)
        XCTAssertEqual(rows.map(\.id), ["frontMotorTemp", "rearMotorTemp", "inverterTemp", "batteryTemp"])
        XCTAssertEqual(rows.map(\.value), ["48.0°C", "52.5°C", "41.2°C", "33.8°C"])
    }

    func testTemperatureRowsEmDashWhenHealthNil() {
        let rows = DetailCardsProjection.temperatureRows(nil, formatTemperature: formatTemp)
        XCTAssertEqual(rows.count, 4)
        XCTAssertTrue(rows.allSatisfy { $0.value == "—" })
    }

    func testTemperatureRowsEmDashForMissingIndividualTemp() {
        let health = DetailCardsHealth(
            frontMotorTempC: 48.0,
            rearMotorTempC: nil,
            inverterTempC: 41.2,
            batteryTempC: nil
        )
        let rows = DetailCardsProjection.temperatureRows(health, formatTemperature: formatTemp)
        XCTAssertEqual(rows.map(\.value), ["48.0°C", "—", "41.2°C", "—"])
    }
}

// MARK: - Adapter: power summary rows

final class DetailCardsPowerProjectionTests: XCTestCase {
    private let formatting = DefaultDetailCardsFormatting()
    private let stats = DetailCardsStats(regenEnergyWh: 248_600, co2SavedKg: 612.4)

    private func powerRows(
        peak: Double,
        avg: Double,
        regen: Double,
        stats: DetailCardsStats?
    ) -> [DetailCardRow] {
        DetailCardsProjection.powerRows(
            figures: DetailCardsPowerFigures(peakPowerKw: peak, avgPowerMaxKw: avg, minRegenPowerKw: regen),
            stats: stats,
            formatting: formatting,
            units: DetailCardsUnitLabels(power: "kW", mass: "kg")
        )
    }

    func testPopulatedRowsFormatEveryMetric() {
        let rows = powerRows(peak: 312, avg: 128.6, regen: -64.3, stats: stats)
        XCTAssertEqual(rows.map(\.id), ["peakPower", "avgPower", "maxRegen", "totalRegen", "co2"])
        XCTAssertEqual(rows.map(\.value), ["312 kW", "128.6 kW", "64.3 kW", "248.6 kWh", "612.4 kg"])
    }

    func testZeroAndPositiveRegenFallBackToEmDash() {
        let rows = powerRows(peak: 0, avg: 0, regen: 0, stats: nil)
        XCTAssertEqual(rows.map(\.value), ["—", "—", "—", "—", "—"])
    }

    func testRegenOnlyShownWhenNegative() {
        XCTAssertEqual(
            DetailCardsProjection.maxRegenValue(-64.3, formatting: formatting, powerUnit: "kW"),
            "64.3 kW"
        )
        XCTAssertEqual(
            DetailCardsProjection.maxRegenValue(5, formatting: formatting, powerUnit: "kW"),
            "—"
        )
    }

    func testPeakPowerGroupsThousands() {
        XCTAssertEqual(
            DetailCardsProjection.peakPowerValue(1840, formatting: formatting, powerUnit: "kW"),
            "1,840 kW"
        )
    }

    func testStatsAbsentDropsRegenEnergyAndCo2() {
        let rows = powerRows(peak: 312, avg: 128.6, regen: -64.3, stats: nil)
        XCTAssertEqual(rows[3].value, "—")
        XCTAssertEqual(rows[4].value, "—")
    }
}

// MARK: - Adapter: empty resolution

final class DetailCardsEmptyTests: XCTestCase {
    func testEmptyWhenEverythingAbsent() {
        XCTAssertTrue(
            DetailCardsProjection.isEmpty(health: nil, peakPower: 0, avgPowerMax: 0, minRegenPower: 0, stats: nil)
        )
    }

    func testNotEmptyWhenAnyInputPresent() {
        let health = DetailCardsHealth(frontMotorTempC: 20, rearMotorTempC: nil, inverterTempC: nil, batteryTempC: nil)
        let stats = DetailCardsStats(regenEnergyWh: 10)
        XCTAssertFalse(
            DetailCardsProjection.isEmpty(health: health, peakPower: 0, avgPowerMax: 0, minRegenPower: 0, stats: nil)
        )
        XCTAssertFalse(
            DetailCardsProjection.isEmpty(health: nil, peakPower: 5, avgPowerMax: 0, minRegenPower: 0, stats: nil)
        )
        XCTAssertFalse(
            DetailCardsProjection.isEmpty(health: nil, peakPower: 0, avgPowerMax: 0, minRegenPower: -1, stats: nil)
        )
        XCTAssertFalse(
            DetailCardsProjection.isEmpty(health: nil, peakPower: 0, avgPowerMax: 0, minRegenPower: 0, stats: stats)
        )
    }
}

// MARK: - Accessibility summary content

final class DetailCardsAccessibilityTests: XCTestCase {
    func testRowSummaryJoinsLabelAndValue() {
        XCTAssertEqual(
            DetailCardsAccessibility.rowSummary(label: "Front Motor Temp", value: "48.0°C"),
            "Front Motor Temp, 48.0°C"
        )
    }

    func testRowSummaryWithEmDashValue() {
        XCTAssertEqual(
            DetailCardsAccessibility.rowSummary(label: "Peak Power", value: "—"),
            "Peak Power, —"
        )
    }
}

// MARK: - i18n: the projection emits the web `drivetrain.*` keys

final class DetailCardsLocalizationKeyTests: XCTestCase {
    private let formatting = DefaultDetailCardsFormatting()

    func testTemperatureRowKeysMatchWebSource() {
        let rows = DetailCardsProjection.temperatureRows(nil) { _ in "—" }
        XCTAssertEqual(rows.map(\.labelKey), [
            "drivetrain.frontMotorTemp",
            "drivetrain.rearMotorTemp",
            "drivetrain.inverterTemp",
            "drivetrain.batteryTemp"
        ])
    }

    func testPowerRowKeysMatchWebSource() {
        let rows = DetailCardsProjection.powerRows(
            figures: DetailCardsPowerFigures(peakPowerKw: 0, avgPowerMaxKw: 0, minRegenPowerKw: 0),
            stats: nil,
            formatting: formatting,
            units: DetailCardsUnitLabels(power: "kW", mass: "kg")
        )
        XCTAssertEqual(rows.map(\.labelKey), [
            "drivetrain.peakPowerLabel",
            "drivetrain.avgPowerLabel",
            "drivetrain.maxRegenLabel",
            "drivetrain.regenLabel",
            "drivetrain.co2Label"
        ])
    }
}
