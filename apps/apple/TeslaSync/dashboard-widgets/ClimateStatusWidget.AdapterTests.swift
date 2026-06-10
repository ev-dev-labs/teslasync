//
//  ClimateStatusWidget.AdapterTests.swift
//  TeslaSync — P4 dashboard widget · 0028 · ClimateStatusWidget (Apple)
//
//  Pure-core coverage for the surface adapter, split from the state-holder /
//  registry / accessibility coverage in ClimateStatusWidget.Tests.swift:
//    • Conversion — `ClimateStatusTempConvert.fromSI` parity with web `convertTempFromSI`.
//    • Formatting — `ClimateStatusNumberFormat` parity with web `fmtInt` / `fmtNumber`.
//    • Derivations — `ClimateStatusDerive` parity with the web cabin/outside/HVAC value
//      rules + the Defrost / Heater chip conditions.
//    • Adapter (cached → projection) — `ClimateStatusProjectionBuilder` parity with the
//      web content composition (three rows + the two status chips).
//
//  No network, no real store, no rendered view — every assertion is on a pure value.
//

import XCTest
@testable import TeslaSync

/// A bundle-free localizer: returns the English fallback verbatim so the adapter
/// tests are deterministic regardless of the host bundle's compiled catalog.
private let passthrough: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - Conversion: SI Celsius → display unit (port of convertTempFromSI)

@MainActor final class ClimateStatusTempConvertTests: XCTestCase {
    func testCelsiusIdentity() throws {
        XCTAssertEqual(try XCTUnwrap(ClimateStatusTempConvert.fromSI(21, .celsius)), 21, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(ClimateStatusTempConvert.fromSI(-12.5, .celsius)), -12.5, accuracy: 0.0001)
    }

    func testFahrenheitUsesNineFifthsPlusThirtyTwo() throws {
        XCTAssertEqual(try XCTUnwrap(ClimateStatusTempConvert.fromSI(0, .fahrenheit)), 32, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(ClimateStatusTempConvert.fromSI(100, .fahrenheit)), 212, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(ClimateStatusTempConvert.fromSI(37, .fahrenheit)), 98.6, accuracy: 0.0001)
    }

    func testFahrenheitNegativeCrossover() throws {
        XCTAssertEqual(try XCTUnwrap(ClimateStatusTempConvert.fromSI(-40, .fahrenheit)), -40, accuracy: 0.0001)
    }

    func testNilAndNonFiniteBecomeNil() {
        XCTAssertNil(ClimateStatusTempConvert.fromSI(nil, .celsius))
        XCTAssertNil(ClimateStatusTempConvert.fromSI(.nan, .celsius))
        XCTAssertNil(ClimateStatusTempConvert.fromSI(.infinity, .fahrenheit))
    }

    func testUnitFromLabelDefaultsToCelsius() {
        XCTAssertEqual(ClimateStatusTemperatureUnit.fromLabel("°F"), .fahrenheit)
        XCTAssertEqual(ClimateStatusTemperatureUnit.fromLabel("°C"), .celsius)
        XCTAssertEqual(ClimateStatusTemperatureUnit.fromLabel(nil), .celsius)
        XCTAssertEqual(ClimateStatusTemperatureUnit.fromLabel("garbage"), .celsius)
    }
}

// MARK: - Formatting (port of fmtInt / fmtNumber)

@MainActor final class ClimateStatusNumberFormatTests: XCTestCase {
    func testIntegerRoundsHalfUpWholeNumbers() {
        XCTAssertEqual(ClimateStatusNumberFormat.integer(21.6), "22")
        XCTAssertEqual(ClimateStatusNumberFormat.integer(21.4), "21")
        XCTAssertEqual(ClimateStatusNumberFormat.integer(-4.5), "-5")
    }

    func testIntegerNonFiniteIsDash() {
        XCTAssertEqual(ClimateStatusNumberFormat.integer(.nan), "—")
        XCTAssertEqual(ClimateStatusNumberFormat.integer(.infinity), "—")
    }

    func testDecimal1KeepsExactlyOneFraction() {
        let value = ClimateStatusNumberFormat.decimal1(2.3)
        XCTAssertTrue(value.hasPrefix("2"), "leading digit present in \(value)")
        XCTAssertTrue(value.contains("3"), "fraction digit present in \(value)")
        // A whole number still carries the single fraction digit (web fmtNumber(_, 1)).
        let whole = ClimateStatusNumberFormat.decimal1(4)
        XCTAssertTrue(whole.hasPrefix("4") && whole.contains("0"), "got \(whole)")
    }

    func testDecimal1NonFiniteIsDash() {
        XCTAssertEqual(ClimateStatusNumberFormat.decimal1(.nan), "—")
    }
}

// MARK: - Derivations (port of the web computed values)

@MainActor final class ClimateStatusDeriveTests: XCTestCase {
    func testInsideDisplayConvertsAndFormatsWithUnit() {
        let input = ClimateStatusInput(insideTemp: 0, outsideTemp: 100)
        XCTAssertEqual(ClimateStatusDerive.insideDisplay(input, unit: .fahrenheit), "32°F")
        XCTAssertEqual(ClimateStatusDerive.outsideDisplay(input, unit: .fahrenheit), "212°F")
        XCTAssertEqual(ClimateStatusDerive.insideDisplay(input, unit: .celsius), "0°C")
    }

    func testTemperatureDisplayDashWhenNil() {
        let input = ClimateStatusInput(insideTemp: nil, outsideTemp: nil)
        XCTAssertEqual(ClimateStatusDerive.insideDisplay(input, unit: .celsius), "—")
        XCTAssertEqual(ClimateStatusDerive.outsideDisplay(input, unit: .fahrenheit), "—")
    }

    func testHVACDisplayShowsKilowattsForAnyNonNilValue() {
        XCTAssertEqual(
            ClimateStatusDerive.hvacDisplay(ClimateStatusInput(hvacPower: 2.3), kilowattUnit: "kW"),
            "2.3 kW"
        )
        // The web guards only `hvac_power != null`, so zero still shows (unlike the panel).
        XCTAssertEqual(ClimateStatusDerive.hvacDisplay(ClimateStatusInput(hvacPower: 0), kilowattUnit: "kW"), "0.0 kW")
    }

    func testHVACDisplayDashWhenNilOrNonFinite() {
        XCTAssertEqual(ClimateStatusDerive.hvacDisplay(ClimateStatusInput(hvacPower: nil), kilowattUnit: "kW"), "—")
        XCTAssertEqual(ClimateStatusDerive.hvacDisplay(ClimateStatusInput(hvacPower: .nan), kilowattUnit: "kW"), "—")
    }

    func testDefrostActiveOnlyWhenSetAndNotOff() {
        XCTAssertFalse(ClimateStatusDerive.defrostActive(ClimateStatusInput(defrostMode: nil)))
        XCTAssertFalse(ClimateStatusDerive.defrostActive(ClimateStatusInput(defrostMode: "Off")))
        XCTAssertFalse(ClimateStatusDerive.defrostActive(ClimateStatusInput(defrostMode: "   ")))
        XCTAssertTrue(ClimateStatusDerive.defrostActive(ClimateStatusInput(defrostMode: "Front")))
    }

    func testBatteryHeaterTruthiness() {
        XCTAssertTrue(ClimateStatusDerive.batteryHeaterOn(ClimateStatusInput(batteryHeaterOn: true)))
        XCTAssertFalse(ClimateStatusDerive.batteryHeaterOn(ClimateStatusInput(batteryHeaterOn: false)))
        XCTAssertFalse(ClimateStatusDerive.batteryHeaterOn(ClimateStatusInput(batteryHeaterOn: nil)))
    }
}

// MARK: - Adapter: cached row → projection (port of the web content composition)

@MainActor final class ClimateStatusProjectionBuilderTests: XCTestCase {
    private func build(
        _ input: ClimateStatusInput,
        _ unit: ClimateStatusTemperatureUnit = .celsius
    ) -> ClimateStatusProjection {
        ClimateStatusProjectionBuilder.build(input: input, unit: unit, localize: passthrough)
    }

    func testRowsCarryConvertedTemperaturesAndHVAC() {
        let projection = build(ClimateStatusInput(insideTemp: 22, outsideTemp: 8, hvacPower: 2.3))
        XCTAssertEqual(projection.rows.map(\.id), ["cabin", "outside", "hvac"])
        XCTAssertEqual(projection.rows.map(\.label), ["Cabin", "Outside", "HVAC"])
        XCTAssertEqual(projection.rows[0].value, "22°C")
        XCTAssertEqual(projection.rows[1].value, "8°C")
        XCTAssertEqual(projection.rows[2].value, "2.3 kW")
    }

    func testFahrenheitRowsUseFahrenheitSuffix() {
        let projection = build(ClimateStatusInput(insideTemp: 0, outsideTemp: 100), .fahrenheit)
        XCTAssertEqual(projection.rows[0].value, "32°F")
        XCTAssertEqual(projection.rows[1].value, "212°F")
    }

    func testMissingValuesRenderEmDash() {
        let projection = build(ClimateStatusInput(insideTemp: nil, outsideTemp: nil, hvacPower: nil))
        XCTAssertEqual(projection.rows[0].value, "—")
        XCTAssertEqual(projection.rows[1].value, "—")
        XCTAssertEqual(projection.rows[2].value, "—")
    }

    func testChipsForDefrostAndHeaterInOrder() {
        let projection = build(ClimateStatusInput(defrostMode: "Front", batteryHeaterOn: true))
        XCTAssertEqual(projection.chips.map(\.id), ["defrost", "heater"])
        XCTAssertEqual(projection.chips.map(\.text), ["Defrost", "Heater"])
        XCTAssertEqual(projection.chips[0].tone, .defrost)
        XCTAssertEqual(projection.chips[1].tone, .heater)
        XCTAssertFalse(projection.chips[0].systemImage.isEmpty)
    }

    func testChipsOmittedWhenInactive() {
        let projection = build(ClimateStatusInput(defrostMode: "Off", batteryHeaterOn: false))
        XCTAssertTrue(projection.chips.isEmpty)
    }

    func testOnlyDefrostChipWhenHeaterOff() {
        let projection = build(ClimateStatusInput(defrostMode: "Rear", batteryHeaterOn: false))
        XCTAssertEqual(projection.chips.map(\.id), ["defrost"])
    }
}
