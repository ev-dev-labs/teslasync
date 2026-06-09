//
//  TemperatureGauges.Tests.swift
//  TeslaSync — P4 feature view · 0160 · TemperatureGauges (Apple)
//
//  Adapter + accessibility coverage for the temperature-gauges surface (the state-holder tests
//  live in TemperatureGauges.ModelTests.swift; the per-state view-render smoke tests live in
//  TemperatureGauges.ViewTests.swift):
//    • Adapter (cached → projection) — `TemperatureGaugesFormat` number/integer parity with the
//      web `fmtNumber`/`fmtInt`, the `convertTemperatureGaugeFromSI` converter ported from
//      `lib/unitConversion.ts`, the `TempSeverity` thresholds ported from `helpers.ts`
//      `tempSeverityColor`, and the `TemperatureGaugesProjector` (gauge clamp + decimals + fill
//      fraction + severity + ceiling line, including the `value === null` zeroed branch).
//    • Accessibility — the VoiceOver gauge + surface summaries.
//
//  The pure-logic tests run with no network and no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: formatting (web parity)

@MainActor final class TemperatureGaugesFormatTests: XCTestCase {
    func testNumberGroupsAndFixesFractionDigits() {
        XCTAssertEqual(TemperatureGaugesFormat.number(1234.0, decimals: 1), "1,234.0")
        XCTAssertEqual(TemperatureGaugesFormat.number(72, decimals: 0), "72")
        XCTAssertEqual(TemperatureGaugesFormat.number(113.9, decimals: 2), "113.90")
    }

    func testNumberRoundsHalfAwayFromZero() {
        XCTAssertEqual(TemperatureGaugesFormat.number(0.5, decimals: 0), "1")
        XCTAssertEqual(TemperatureGaugesFormat.number(2.5, decimals: 0), "3")
    }

    func testIntegerGroupsWholeNumbers() {
        XCTAssertEqual(TemperatureGaugesFormat.integer(150), "150")
        XCTAssertEqual(TemperatureGaugesFormat.integer(302), "302")
        XCTAssertEqual(TemperatureGaugesFormat.integer(0), "0")
    }

    func testSafeNumberCollapsesNonFinite() {
        XCTAssertEqual(TemperatureGaugesFormat.safeNumber(.nan), 0)
        XCTAssertEqual(TemperatureGaugesFormat.safeNumber(.infinity), 0)
        XCTAssertEqual(TemperatureGaugesFormat.safeNumber(42.5), 42.5)
    }
}

// MARK: - Adapter: SI converter (web parity)

@MainActor final class TemperatureGaugesConverterTests: XCTestCase {
    func testCelsiusPassesThrough() {
        XCTAssertEqual(convertTemperatureGaugeFromSI(95, to: .celsius), 95, accuracy: 1e-9)
        XCTAssertEqual(convertTemperatureGaugeFromSI(-40, to: .celsius), -40, accuracy: 1e-9)
    }

    func testFahrenheitMatchesWebFormula() {
        XCTAssertEqual(convertTemperatureGaugeFromSI(0, to: .fahrenheit), 32, accuracy: 1e-9)
        XCTAssertEqual(convertTemperatureGaugeFromSI(100, to: .fahrenheit), 212, accuracy: 1e-9)
        XCTAssertEqual(convertTemperatureGaugeFromSI(95, to: .fahrenheit), 203, accuracy: 1e-9)
        XCTAssertEqual(convertTemperatureGaugeFromSI(150, to: .fahrenheit), 302, accuracy: 1e-9)
        XCTAssertEqual(convertTemperatureGaugeFromSI(-40, to: .fahrenheit), -40, accuracy: 1e-9)
    }
}

// MARK: - Adapter: severity (web tempSeverityColor parity)

@MainActor final class TempSeverityTests: XCTestCase {
    func testThresholdsMatchWeb() {
        XCTAssertEqual(TempSeverity.from(valueCelsius: 90, maxCelsius: 150), .normal) // 0.60
        XCTAssertEqual(TempSeverity.from(valueCelsius: 105, maxCelsius: 150), .warning) // 0.70
        XCTAssertEqual(TempSeverity.from(valueCelsius: 140, maxCelsius: 150), .critical) // 0.93
    }

    func testInclusiveBoundaries() {
        XCTAssertEqual(TempSeverity.from(valueCelsius: 97.5, maxCelsius: 150), .warning) // exactly 0.65
        XCTAssertEqual(TempSeverity.from(valueCelsius: 127.5, maxCelsius: 150), .critical) // exactly 0.85
    }

    func testMissingReadingIsUnknown() {
        XCTAssertEqual(TempSeverity.from(valueCelsius: nil, maxCelsius: 150), .unknown)
    }

    func testDegenerateCeilingFollowsJSComparisonSemantics() {
        // celsius/0 → +∞ ≥ 0.85 → critical (matches JS); 0/0 → NaN comparisons false → normal.
        XCTAssertEqual(TempSeverity.from(valueCelsius: 50, maxCelsius: 0), .critical)
        XCTAssertEqual(TempSeverity.from(valueCelsius: 0, maxCelsius: 0), .normal)
    }
}

// MARK: - Adapter: projector (web parity)

@MainActor final class TemperatureGaugesProjectorTests: XCTestCase {
    private func gauge(_ id: String, in projection: TemperatureGaugesProjection) -> TempGaugeProjection? {
        projection.gauges.first { $0.id == id }
    }

    private func canonicalSensors() -> [TempSensorInput] {
        [
            TempSensorInput(
                id: "frontMotor",
                labelKey: "drivetrain.frontMotor",
                labelFallback: "Front Motor",
                valueCelsius: 95,
                maxTempCelsius: 150
            ),
            TempSensorInput(
                id: "rearMotor",
                labelKey: "drivetrain.rearMotor",
                labelFallback: "Rear Motor",
                valueCelsius: 110,
                maxTempCelsius: 150
            ),
            TempSensorInput(
                id: "inverter",
                labelKey: "drivetrain.inverter",
                labelFallback: "Inverter",
                valueCelsius: 105,
                maxTempCelsius: 120
            ),
            TempSensorInput(
                id: "battery",
                labelKey: "drivetrain.battery",
                labelFallback: "Battery",
                valueCelsius: 34,
                maxTempCelsius: 60
            )
        ]
    }

    func testCelsiusGaugeValuesFractionsSeveritiesAndOrder() {
        let projection = TemperatureGaugesProjector.project(
            sensors: canonicalSensors(),
            units: TemperatureGaugesUnitPrefs(temperature: .celsius)
        )
        XCTAssertEqual(projection.gauges.map(\.id), ["frontMotor", "rearMotor", "inverter", "battery"])

        let front = gauge("frontMotor", in: projection)
        XCTAssertEqual(front?.valueText, "95")
        XCTAssertEqual(front?.unit, "°C")
        XCTAssertEqual(front?.maxText, "150")
        XCTAssertEqual(front?.fraction ?? 0, 95.0 / 150.0, accuracy: 1e-9)
        XCTAssertEqual(front?.severity, .normal)
        XCTAssertEqual(front?.hasReading, true)

        XCTAssertEqual(gauge("rearMotor", in: projection)?.severity, .warning) // 110/150 = 0.733
        XCTAssertEqual(gauge("inverter", in: projection)?.severity, .critical) // 105/120 = 0.875
        XCTAssertEqual(gauge("inverter", in: projection)?.maxText, "120")
        XCTAssertEqual(gauge("battery", in: projection)?.valueText, "34")
        XCTAssertEqual(gauge("battery", in: projection)?.severity, .normal) // 34/60 = 0.567
    }

    func testFahrenheitConvertsDisplayButKeepsSISeverity() {
        let projection = TemperatureGaugesProjector.project(
            sensors: canonicalSensors(),
            units: TemperatureGaugesUnitPrefs(temperature: .fahrenheit)
        )
        let front = gauge("frontMotor", in: projection)
        XCTAssertEqual(front?.valueText, "203") // 95°C → 203°F (integer → 0 decimals)
        XCTAssertEqual(front?.unit, "°F")
        XCTAssertEqual(front?.maxText, "302") // 150°C → 302°F
        // Ring fill uses display °F (203/302), while severity stays on the SI ratio (95/150 → normal).
        XCTAssertEqual(front?.fraction ?? 0, 203.0 / 302.0, accuracy: 1e-9)
        XCTAssertEqual(front?.severity, .normal)
        // 34°C → 93.2°F is non-integer → global precision (2).
        XCTAssertEqual(gauge("battery", in: projection)?.valueText, "93.20")
        XCTAssertEqual(gauge("battery", in: projection)?.maxText, "140")
    }

    func testMissingReadingRendersZeroedNeutralGaugeWithCeiling() {
        let sensors = [
            TempSensorInput(
                id: "inverter",
                labelKey: "drivetrain.inverter",
                labelFallback: "Inverter",
                valueCelsius: nil,
                maxTempCelsius: 120
            )
        ]
        let projection = TemperatureGaugesProjector.project(
            sensors: sensors,
            units: TemperatureGaugesUnitPrefs(temperature: .celsius)
        )
        let inverter = gauge("inverter", in: projection)
        XCTAssertEqual(inverter?.valueText, "0") // web passes literal 0 for a null reading
        XCTAssertEqual(inverter?.fraction, 0)
        XCTAssertEqual(inverter?.severity, .unknown)
        XCTAssertEqual(inverter?.maxText, "120") // ceiling still shown
        XCTAssertEqual(inverter?.hasReading, false)
    }

    func testReadingAboveCeilingClampsCentreAndFill() {
        let sensors = [
            TempSensorInput(
                id: "frontMotor",
                labelKey: "drivetrain.frontMotor",
                labelFallback: "Front Motor",
                valueCelsius: 160,
                maxTempCelsius: 150
            )
        ]
        let projection = TemperatureGaugesProjector.project(
            sensors: sensors,
            units: TemperatureGaugesUnitPrefs(temperature: .celsius)
        )
        let front = gauge("frontMotor", in: projection)
        XCTAssertEqual(front?.valueText, "150") // clamped to ceiling
        XCTAssertEqual(front?.fraction, 1)
        XCTAssertEqual(front?.severity, .critical) // 160/150 = 1.07
    }

    func testNonIntegerFahrenheitUsesGlobalPrecision() {
        let sensors = [
            TempSensorInput(
                id: "battery",
                labelKey: "drivetrain.battery",
                labelFallback: "Battery",
                valueCelsius: 37.5,
                maxTempCelsius: 60
            )
        ]
        let projection = TemperatureGaugesProjector.project(
            sensors: sensors,
            units: TemperatureGaugesUnitPrefs(temperature: .fahrenheit)
        )
        // 37.5°C → 99.5°F (non-integer → 2 decimals); ceiling 60°C → 140°F.
        XCTAssertEqual(gauge("battery", in: projection)?.valueText, "99.50")
        XCTAssertEqual(gauge("battery", in: projection)?.maxText, "140")
    }
}

// MARK: - Accessibility summary

@MainActor final class TemperatureGaugesAccessibilityTests: XCTestCase {
    private func sensors() -> [TempSensorInput] {
        [
            TempSensorInput(
                id: "frontMotor",
                labelKey: "drivetrain.frontMotor",
                labelFallback: "Front Motor",
                valueCelsius: 95,
                maxTempCelsius: 150
            ),
            TempSensorInput(
                id: "inverter",
                labelKey: "drivetrain.inverter",
                labelFallback: "Inverter",
                valueCelsius: 105,
                maxTempCelsius: 120
            )
        ]
    }

    func testGaugeSummaryFormat() {
        let projection = TemperatureGaugesProjector.project(
            sensors: sensors(),
            units: TemperatureGaugesUnitPrefs(temperature: .celsius)
        )
        let front = projection.gauges.first { $0.id == "frontMotor" }
        let summary = TemperatureGaugesAccessibility.gaugeSummary(for: front ?? projection.gauges[0], maxLabel: "Max")
        XCTAssertEqual(summary, "Front Motor 95°C, Max 150°C")
    }

    func testSurfaceSummaryJoinsEveryGauge() {
        let projection = TemperatureGaugesProjector.project(
            sensors: sensors(),
            units: TemperatureGaugesUnitPrefs(temperature: .celsius)
        )
        let summary = TemperatureGaugesAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Front Motor 95°C, Max 150°C"))
        XCTAssertTrue(summary.contains("Inverter 105°C, Max 120°C"))
        XCTAssertTrue(summary.contains(". ")) // phrases joined
    }
}
