//
//  ClimateControlPanelWidget.AdapterTests.swift
//  TeslaSync — P4 dashboard widget · 0026 · ClimateControlPanelWidget (Apple)
//
//  Pure-core coverage for the surface adapter, split from the state-holder /
//  registry / accessibility coverage in ClimateControlPanelWidget.Tests.swift:
//    • Conversion — `ClimatePanelTempConvert.fromSI` parity with web `convertTempFromSI`.
//    • Formatting — `ClimatePanelNumberFormat` parity with web `fmtInt` / `fmtNumber`.
//    • Derivations — `ClimatePanelDerive` parity with the web `hvacOn` / `seatHeaters` /
//      `steeringHeat` / defrost / battery-heater conditions.
//    • Adapter (cached → projection) — `ClimatePanelProjectionBuilder` parity with the
//      web `FullView` / `CompactView` composition.
//
//  No network, no real store, no rendered view — every assertion is on a pure value.
//

import XCTest
@testable import TeslaSync

/// A bundle-free localizer: returns the English fallback verbatim so the adapter
/// tests are deterministic regardless of the host bundle's compiled catalog.
private let passthrough: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - Conversion: SI Celsius → display unit (port of convertTempFromSI)

@MainActor final class ClimatePanelTempConvertTests: XCTestCase {
    func testCelsiusIdentity() throws {
        XCTAssertEqual(try XCTUnwrap(ClimatePanelTempConvert.fromSI(21, .celsius)), 21, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(ClimatePanelTempConvert.fromSI(-12.5, .celsius)), -12.5, accuracy: 0.0001)
    }

    func testFahrenheitUsesNineFifthsPlusThirtyTwo() throws {
        XCTAssertEqual(try XCTUnwrap(ClimatePanelTempConvert.fromSI(0, .fahrenheit)), 32, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(ClimatePanelTempConvert.fromSI(100, .fahrenheit)), 212, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(ClimatePanelTempConvert.fromSI(37, .fahrenheit)), 98.6, accuracy: 0.0001)
    }

    func testFahrenheitNegativeCrossover() throws {
        XCTAssertEqual(try XCTUnwrap(ClimatePanelTempConvert.fromSI(-40, .fahrenheit)), -40, accuracy: 0.0001)
    }

    func testNilAndNonFiniteBecomeNil() {
        XCTAssertNil(ClimatePanelTempConvert.fromSI(nil, .celsius))
        XCTAssertNil(ClimatePanelTempConvert.fromSI(.nan, .celsius))
        XCTAssertNil(ClimatePanelTempConvert.fromSI(.infinity, .fahrenheit))
    }

    func testUnitFromLabelDefaultsToCelsius() {
        XCTAssertEqual(ClimatePanelTemperatureUnit.fromLabel("°F"), .fahrenheit)
        XCTAssertEqual(ClimatePanelTemperatureUnit.fromLabel("°C"), .celsius)
        XCTAssertEqual(ClimatePanelTemperatureUnit.fromLabel(nil), .celsius)
        XCTAssertEqual(ClimatePanelTemperatureUnit.fromLabel("garbage"), .celsius)
    }
}

// MARK: - Formatting (port of fmtInt / fmtNumber / `${value}`)

@MainActor final class ClimatePanelNumberFormatTests: XCTestCase {
    func testIntegerRoundsHalfUpWholeNumbers() {
        XCTAssertEqual(ClimatePanelNumberFormat.integer(21.6), "22")
        XCTAssertEqual(ClimatePanelNumberFormat.integer(21.4), "21")
        XCTAssertEqual(ClimatePanelNumberFormat.integer(-4.5), "-5")
    }

    func testIntegerNonFiniteIsDash() {
        XCTAssertEqual(ClimatePanelNumberFormat.integer(.nan), "—")
        XCTAssertEqual(ClimatePanelNumberFormat.integer(.infinity), "—")
    }

    func testDecimal1KeepsExactlyOneFraction() {
        let value = ClimatePanelNumberFormat.decimal1(2.3)
        XCTAssertTrue(value.hasPrefix("2"), "leading digit present in \(value)")
        XCTAssertTrue(value.contains("3"), "fraction digit present in \(value)")
        // A whole number still carries the single fraction digit (web fmtNumber(_, 1)).
        let whole = ClimatePanelNumberFormat.decimal1(4)
        XCTAssertTrue(whole.hasPrefix("4") && whole.contains("0"), "got \(whole)")
    }

    func testPlainIntegerHasNoFraction() {
        XCTAssertEqual(ClimatePanelNumberFormat.plain(4), "4")
        XCTAssertEqual(ClimatePanelNumberFormat.plain(0), "0")
    }

    func testPlainFractionTrimsTrailingZeros() {
        let value = ClimatePanelNumberFormat.plain(3.5)
        XCTAssertTrue(value.contains("3") && value.contains("5"), "got \(value)")
        XCTAssertFalse(value.hasSuffix("0"), "no trailing zero in \(value)")
    }
}

// MARK: - Derivations (port of the web computed values)

@MainActor final class ClimatePanelDeriveTests: XCTestCase {
    func testHVACOnWhenPowerPositive() {
        XCTAssertTrue(ClimatePanelDerive.hvacOn(ClimatePanelInput(hvacPower: 1.2)))
    }

    func testHVACOnWhenACEnabledEvenWithoutPower() {
        XCTAssertTrue(ClimatePanelDerive.hvacOn(ClimatePanelInput(hvacACEnabled: true)))
    }

    func testHVACOffWhenPowerZeroAndACFalse() {
        XCTAssertFalse(ClimatePanelDerive.hvacOn(ClimatePanelInput(hvacPower: 0, hvacACEnabled: false)))
        XCTAssertFalse(ClimatePanelDerive.hvacOn(ClimatePanelInput()))
    }

    func testHVACPowerKWNilWhenNotPositive() {
        XCTAssertNil(ClimatePanelDerive.hvacPowerKW(ClimatePanelInput(hvacPower: 0)))
        XCTAssertNil(ClimatePanelDerive.hvacPowerKW(ClimatePanelInput(hvacPower: nil)))
        XCTAssertEqual(ClimatePanelDerive.hvacPowerKW(ClimatePanelInput(hvacPower: 3.4)), 3.4)
    }

    func testActiveSeatsKeepOrderAndSkipZeroOrNil() {
        let input = ClimatePanelInput(
            seatHeaterLeft: 3,
            seatHeaterRight: 0,
            seatHeaterRearLeft: nil,
            seatHeaterRearCenter: 1,
            seatHeaterRearRight: 2
        )
        let seats = ClimatePanelDerive.activeSeats(input)
        XCTAssertEqual(seats.map(\.position), [.frontLeft, .rearCenter, .rearRight])
        XCTAssertEqual(seats.map(\.level), [3, 1, 2])
    }

    func testSteeringLevelDefaultsToZero() {
        XCTAssertEqual(ClimatePanelDerive.steeringLevel(ClimatePanelInput()), 0)
        XCTAssertEqual(ClimatePanelDerive.steeringLevel(ClimatePanelInput(steeringWheelHeatLevel: 2)), 2)
    }

    func testDefrostActiveOnlyWhenSetAndNotOff() {
        XCTAssertFalse(ClimatePanelDerive.defrostActive(ClimatePanelInput(defrostMode: nil)))
        XCTAssertFalse(ClimatePanelDerive.defrostActive(ClimatePanelInput(defrostMode: "Off")))
        XCTAssertFalse(ClimatePanelDerive.defrostActive(ClimatePanelInput(defrostMode: "   ")))
        XCTAssertTrue(ClimatePanelDerive.defrostActive(ClimatePanelInput(defrostMode: "Front")))
    }

    func testBatteryHeaterTruthiness() {
        XCTAssertTrue(ClimatePanelDerive.batteryHeaterOn(ClimatePanelInput(batteryHeaterOn: true)))
        XCTAssertFalse(ClimatePanelDerive.batteryHeaterOn(ClimatePanelInput(batteryHeaterOn: false)))
        XCTAssertFalse(ClimatePanelDerive.batteryHeaterOn(ClimatePanelInput(batteryHeaterOn: nil)))
    }

    func testTemperatureDisplayConvertsAndFormats() {
        let input = ClimatePanelInput(insideTemp: 0, outsideTemp: 100)
        XCTAssertEqual(ClimatePanelDerive.insideDisplay(input, unit: .fahrenheit), "32")
        XCTAssertEqual(ClimatePanelDerive.outsideDisplay(input, unit: .fahrenheit), "212")
        XCTAssertNil(ClimatePanelDerive.insideDisplay(ClimatePanelInput(insideTemp: nil), unit: .celsius))
    }
}

// MARK: - Adapter: cached row → projection (port of FullView / CompactView)

@MainActor final class ClimatePanelProjectionBuilderTests: XCTestCase {
    private func build(
        _ input: ClimatePanelInput,
        _ unit: ClimatePanelTemperatureUnit = .celsius
    ) -> ClimatePanelProjection {
        ClimatePanelProjectionBuilder.build(input: input, unit: unit, localize: passthrough)
    }

    func testMetricsCarryConvertedTemperaturesWithUnit() {
        let projection = build(ClimatePanelInput(insideTemp: 22, outsideTemp: 8))
        XCTAssertEqual(projection.metrics.map(\.id), ["cabin", "outside", "fan", "wheel"])
        XCTAssertEqual(projection.metrics[0].value, "22°C")
        XCTAssertEqual(projection.metrics[1].value, "8°C")
        XCTAssertEqual(projection.temperatureUnitLabel, "°C")
    }

    func testFahrenheitMetricsUseFahrenheitSuffix() {
        let projection = build(ClimatePanelInput(insideTemp: 0, outsideTemp: 100), .fahrenheit)
        XCTAssertEqual(projection.metrics[0].value, "32°F")
        XCTAssertEqual(projection.metrics[1].value, "212°F")
        XCTAssertEqual(projection.compactValue, "32°F")
    }

    func testMissingTemperaturesRenderEmDash() {
        let projection = build(ClimatePanelInput(insideTemp: nil, outsideTemp: nil))
        XCTAssertEqual(projection.metrics[0].value, "—")
        XCTAssertEqual(projection.metrics[1].value, "—")
        XCTAssertEqual(projection.compactValue, "—")
    }

    func testFanValueAndDash() {
        XCTAssertEqual(build(ClimatePanelInput(hvacFanSpeed: 4)).metrics[2].value, "4")
        XCTAssertEqual(build(ClimatePanelInput(hvacFanSpeed: nil)).metrics[2].value, "—")
    }

    func testWheelHeatLevelOrOff() {
        XCTAssertEqual(build(ClimatePanelInput(steeringWheelHeatLevel: 2)).metrics[3].value, "2/3")
        XCTAssertEqual(build(ClimatePanelInput(steeringWheelHeatLevel: 0)).metrics[3].value, "Off")
        XCTAssertEqual(build(ClimatePanelInput(steeringWheelHeatLevel: nil)).metrics[3].value, "Off")
    }

    func testHVACStatusTextTracksState() {
        XCTAssertEqual(build(ClimatePanelInput(hvacACEnabled: true)).hvacStatusText, "HVAC On")
        XCTAssertEqual(build(ClimatePanelInput()).hvacStatusText, "HVAC Off")
    }

    func testHVACPowerTextOnlyWhenPositive() throws {
        let on = build(ClimatePanelInput(hvacPower: 2.3))
        let text = try XCTUnwrap(on.hvacPowerText)
        XCTAssertTrue(text.hasSuffix("kW"))
        XCTAssertTrue(text.contains("2"))
        XCTAssertNil(build(ClimatePanelInput(hvacPower: 0)).hvacPowerText)
    }

    func testSeatChipsComposeLabelAndLevelInOrder() {
        let projection = build(ClimatePanelInput(
            seatHeaterLeft: 3,
            seatHeaterRight: 0,
            seatHeaterRearCenter: 1
        ))
        XCTAssertEqual(projection.seatChips.map(\.text), ["FL 3/3", "RC 1/3"])
        XCTAssertEqual(projection.seatChips.map(\.id), ["seat-frontLeft", "seat-rearCenter"])
        XCTAssertTrue(projection.seatChips.allSatisfy { $0.tone == .seat })
    }

    func testNoSeatHeatTextWhenNoneActive() {
        let projection = build(ClimatePanelInput())
        XCTAssertTrue(projection.seatChips.isEmpty)
        XCTAssertEqual(projection.noSeatHeatText, "No seat heaters active")
    }

    func testStatusChipsForDefrostAndBatteryHeater() {
        let projection = build(ClimatePanelInput(defrostMode: "Front", batteryHeaterOn: true))
        XCTAssertEqual(projection.statusChips.map(\.id), ["defrost", "battery-heater"])
        XCTAssertEqual(projection.statusChips.map(\.text), ["Defrost", "Bat Heater"])
        XCTAssertEqual(projection.statusChips[0].tone, .defrost)
        XCTAssertEqual(projection.statusChips[1].tone, .batteryHeater)
    }

    func testStatusChipsOmittedWhenInactive() {
        let projection = build(ClimatePanelInput(defrostMode: "Off", batteryHeaterOn: false))
        XCTAssertTrue(projection.statusChips.isEmpty)
    }

    func testMetricTonesAndSymbols() {
        let projection = build(ClimatePanelInput())
        XCTAssertEqual(projection.metrics[0].tone, .cabin)
        XCTAssertEqual(projection.metrics[1].tone, .outside)
        XCTAssertEqual(projection.metrics[2].tone, .muted)
        XCTAssertEqual(projection.metrics[3].tone, .muted)
        XCTAssertFalse(projection.metrics[0].systemImage.isEmpty)
    }
}
