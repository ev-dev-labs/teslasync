//
//  PowertrainPanel.Tests.swift
//  TeslaSync — P4 feature view · 0283 · PowertrainPanel (Apple)
//
//  Unit coverage for the PowertrainPanel surface:
//    • Adapter — the number / integer / temperature formatters (ports of
//      numberFormat.ts + unitConversion.ts), the SI °C → °C/°F conversion, the
//      shift-state colour branch, the bipolar power-bar geometry, and the per-field
//      projection (cached → projection).
//    • State holder — `PowertrainProjector` across loading / empty / error / data,
//      plus the `PowertrainModel` wiring, the P1/S11 `view.opened` telemetry, and the
//      stale auto-refresh transition.
//    • Accessibility — the VoiceOver summary + the shift-pill label.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryPowertrainSource`, and the locale is
//  injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

private func metricUnits(precision: Int? = nil) -> PowertrainUnits {
    PowertrainUnits(temperature: .celsius, precision: precision, locale: "en_US")
}

private func imperialUnits(precision: Int? = nil) -> PowertrainUnits {
    PowertrainUnits(temperature: .fahrenheit, precision: precision, locale: "en_US")
}

@MainActor
final class PowertrainPanelTests: XCTestCase {
    // MARK: - Number / integer formatting (ports of numberFormat.ts)

    func testNumberUsesGroupingFixedDigitsAndHalfUp() {
        XCTAssertEqual(PowertrainFormat.number(210, decimals: 2, locale: enUS), "210.00")
        XCTAssertEqual(PowertrainFormat.number(142, decimals: 2, locale: enUS), "142.00")
        // Half-away-from-zero rounding (the toLocaleString default).
        XCTAssertEqual(PowertrainFormat.number(1.005, decimals: 2, locale: enUS), "1.01")
    }

    func testNumberCoercesNonFiniteToZero() {
        XCTAssertEqual(PowertrainFormat.number(.infinity, decimals: 2, locale: enUS), "0.00")
        XCTAssertEqual(PowertrainFormat.number(.nan, decimals: 0, locale: enUS), "0")
    }

    func testIntegerIsGroupedZeroDecimal() {
        XCTAssertEqual(PowertrainFormat.integer(4200, locale: enUS), "4,200")
        XCTAssertEqual(PowertrainFormat.integer(-300, locale: enUS), "-300")
        XCTAssertEqual(PowertrainFormat.integer(0, locale: enUS), "0")
    }

    // MARK: - Temperature conversion (ports of convertTempFromSI + formatTemperature)

    func testTemperatureUnitConversionMatchesWeb() {
        XCTAssertEqual(PowertrainTemperatureUnit.celsius.fromCelsius(100), 100, accuracy: 0.0001)
        XCTAssertEqual(PowertrainTemperatureUnit.fahrenheit.fromCelsius(100), 212, accuracy: 0.0001)
        XCTAssertEqual(PowertrainTemperatureUnit.fahrenheit.fromCelsius(0), 32, accuracy: 0.0001)
    }

    func testTemperatureUnitSymbolAndInit() {
        XCTAssertEqual(PowertrainTemperatureUnit.celsius.symbol, "°C")
        XCTAssertEqual(PowertrainTemperatureUnit.fahrenheit.symbol, "°F")
        XCTAssertEqual(PowertrainTemperatureUnit(symbol: "°F"), .fahrenheit)
        XCTAssertEqual(PowertrainTemperatureUnit(symbol: "°C"), .celsius)
        XCTAssertEqual(PowertrainTemperatureUnit(symbol: "K"), .celsius) // default
    }

    func testFormatTemperatureDefaultsToOneDecimalWithSymbolNoSpace() {
        XCTAssertEqual(PowertrainFormat.temperature(celsius: 58, units: metricUnits()), "58.0°C")
        // 84 °C → 183.2 °F.
        XCTAssertEqual(PowertrainFormat.temperature(celsius: 84, units: imperialUnits()), "183.2°F")
    }

    func testFormatTemperatureHonoursPrecisionOverride() {
        XCTAssertEqual(PowertrainFormat.temperature(celsius: 58.4, units: metricUnits(precision: 0)), "58°C")
    }

    func testFormatTemperatureNilIsEmptySentinel() {
        XCTAssertEqual(PowertrainFormat.temperature(celsius: nil, units: metricUnits()), "—")
        XCTAssertEqual(PowertrainFormat.temperature(celsius: .infinity, units: metricUnits()), "—")
        let custom = PowertrainUnits(temperature: .celsius, locale: "en_US", emptyDisplay: "n/a")
        XCTAssertEqual(PowertrainFormat.temperature(celsius: nil, units: custom), "n/a")
    }

    // MARK: - Shift-state badge (web colour branch)

    func testShiftBadgeMapsWebTernary() {
        XCTAssertEqual(PowertrainShiftBadge.from("D"), .drive)
        XCTAssertEqual(PowertrainShiftBadge.from("R"), .reverse)
        XCTAssertEqual(PowertrainShiftBadge.from("N"), .neutral)
        XCTAssertEqual(PowertrainShiftBadge.from("P"), .other)
        XCTAssertEqual(PowertrainShiftBadge.from(nil), .other)
    }

    // MARK: - Power bar geometry (web bipolar ±300 meter)

    func testPowerBarDriveExtendsRight() {
        let bar = PowertrainPowerBar.make(powerKw: 142)
        XCTAssertTrue(bar.isPositive)
        XCTAssertEqual(bar.fillFraction, min(142.0 / 300.0, 1.0) * 0.5, accuracy: 0.0001)
    }

    func testPowerBarRegenExtendsLeft() {
        let bar = PowertrainPowerBar.make(powerKw: -38)
        XCTAssertFalse(bar.isPositive)
        XCTAssertEqual(bar.fillFraction, (38.0 / 300.0) * 0.5, accuracy: 0.0001)
    }

    func testPowerBarClampsAtHalfTrack() {
        // Beyond the ±300 full scale the fill never exceeds half the track width.
        XCTAssertEqual(PowertrainPowerBar.make(powerKw: 600).fillFraction, 0.5, accuracy: 0.0001)
        XCTAssertEqual(PowertrainPowerBar.make(powerKw: -1200).fillFraction, 0.5, accuracy: 0.0001)
        XCTAssertTrue(PowertrainPowerBar.make(powerKw: 0).isPositive) // 0 → drive side
    }

    // MARK: - Projection (cached → projection)

    func testProjectionFormatsEveryFieldMetric() {
        let reading = PowertrainReading(
            shiftState: "D",
            powerKw: 142,
            motorRpmFront: 4200,
            motorRpmRear: 4180,
            torqueNmFront: 210,
            torqueNmRear: 260,
            motorTempCFront: 58,
            motorTempCRear: 61,
            inverterTempC: 44,
            regenKw: 0
        )
        let projection = PowertrainProjection.make(reading: reading, units: metricUnits())
        XCTAssertEqual(projection.shiftStateRawLabel, "D")
        XCTAssertEqual(projection.shiftBadge, .drive)
        XCTAssertEqual(projection.powerText, "142.00 kW")
        XCTAssertEqual(projection.powerBar?.isPositive, true)
        XCTAssertEqual(projection.powerAxisMinText, "-300")
        XCTAssertEqual(projection.powerAxisMidText, "0")
        XCTAssertEqual(projection.powerAxisMaxText, "+300")
        XCTAssertEqual(projection.rpmFrontText, "4,200")
        XCTAssertEqual(projection.rpmRearText, "4,180")
        XCTAssertEqual(projection.torqueFrontText, "210.00")
        XCTAssertEqual(projection.torqueRearText, "260.00")
        XCTAssertEqual(projection.motorTempText, "61.0°C") // max(58, 61)
        XCTAssertFalse(projection.motorTempIsHot)
        XCTAssertEqual(projection.inverterTempText, "44.0°C")
        XCTAssertEqual(projection.regenText, "0.00 kW")
    }

    func testProjectionPeakMotorTempHotBranchAndImperial() {
        let reading = PowertrainReading(
            motorTempCFront: 79,
            motorTempCRear: 84, // peak, > 80 → hot
            inverterTempC: 52
        )
        let metric = PowertrainProjection.make(reading: reading, units: metricUnits())
        XCTAssertEqual(metric.motorTempText, "84.0°C")
        XCTAssertTrue(metric.motorTempIsHot)

        let imperial = PowertrainProjection.make(reading: reading, units: imperialUnits())
        XCTAssertEqual(imperial.motorTempText, "183.2°F") // 84 °C → 183.2 °F
        XCTAssertTrue(imperial.motorTempIsHot) // hot threshold is the SI °C value
        XCTAssertEqual(imperial.inverterTempText, "125.6°F") // 52 °C → 125.6 °F
    }

    func testProjectionPeakMotorTempUsesPresentSide() {
        let reading = PowertrainReading(motorTempCFront: nil, motorTempCRear: 70)
        let projection = PowertrainProjection.make(reading: reading, units: metricUnits())
        XCTAssertEqual(projection.motorTempText, "70.0°C")
        XCTAssertFalse(projection.motorTempIsHot)
    }

    func testProjectionRendersDashForMissingValues() {
        let projection = PowertrainProjection.make(reading: PowertrainReading(), units: metricUnits())
        XCTAssertNil(projection.shiftStateRawLabel)
        XCTAssertEqual(projection.shiftBadge, .other)
        XCTAssertEqual(projection.powerText, "— kW") // web `{… ?? '—'} kW`
        XCTAssertNil(projection.powerBar)
        XCTAssertEqual(projection.rpmFrontText, "—")
        XCTAssertEqual(projection.rpmRearText, "—")
        XCTAssertEqual(projection.torqueFrontText, "—")
        XCTAssertEqual(projection.torqueRearText, "—")
        XCTAssertEqual(projection.motorTempText, "—") // both sides missing
        XCTAssertFalse(projection.motorTempIsHot)
        XCTAssertEqual(projection.inverterTempText, "—")
        XCTAssertEqual(projection.regenText, "—")
    }

    // MARK: - Projector (loading / empty / error / data precedence)

    func testProjectorErrorTakesPrecedence() {
        let input = PowertrainInput(
            reading: PowertrainReading(powerKw: 10),
            errorMessage: "boom"
        )
        guard case let .error(message) = PowertrainProjector.resolve(input).phase else {
            return XCTFail("expected .error")
        }
        XCTAssertEqual(message, "boom")
    }

    func testProjectorLoadingWhenFetching() {
        let input = PowertrainInput(reading: PowertrainReading(powerKw: 10), isLoading: true)
        XCTAssertEqual(PowertrainProjector.resolve(input).phase, .loading)
    }

    func testProjectorEmptyWhenNoReading() {
        XCTAssertEqual(PowertrainProjector.resolve(PowertrainInput(reading: nil)).phase, .empty)
    }

    func testProjectorDataWhenReadingPresent() {
        let input = PowertrainInput(reading: PowertrainReading(shiftState: "D"), units: metricUnits())
        guard case let .data(projection) = PowertrainProjector.resolve(input).phase else {
            return XCTFail("expected .data")
        }
        XCTAssertEqual(projection.shiftBadge, .drive)
    }

    // MARK: - Model wiring + telemetry (P1/S11 view.opened)

    func testModelStartEmitsViewOpenedSlugOnce() {
        let spy = SpyPowertrainTelemetry()
        let model = PowertrainModel(source: InMemoryPowertrainSource(), telemetry: spy)
        model.start()
        model.start() // idempotent
        XCTAssertEqual(spy.openedSurfaces, ["PowertrainPanel"])
        XCTAssertEqual(PowertrainPanel.surfaceSlug, "PowertrainPanel")
    }

    func testModelAppliesPushedSnapshot() {
        let source = InMemoryPowertrainSource()
        let model = PowertrainModel(source: source, telemetry: SpyPowertrainTelemetry())
        model.start()
        source.push(PowertrainInput(reading: PowertrainReading(shiftState: "R"), units: metricUnits()))
        guard case let .data(projection) = model.phase else {
            return XCTFail("expected .data after push")
        }
        XCTAssertEqual(projection.shiftBadge, .reverse)
        XCTAssertEqual(model.connection, .live)
    }

    func testModelStartStopRefreshForwardToSource() {
        let source = InMemoryPowertrainSource()
        let model = PowertrainModel(source: source, telemetry: SpyPowertrainTelemetry())
        model.start()
        model.refresh()
        model.stop()
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testModelAutoRefreshesOnceOnStaleTransition() {
        let source = InMemoryPowertrainSource()
        let model = PowertrainModel(source: source, telemetry: SpyPowertrainTelemetry())
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(PowertrainInput(reading: PowertrainReading(powerKw: 1), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "stale transition triggers one auto-refresh")
        source.push(PowertrainInput(reading: PowertrainReading(powerKw: 1), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "staying stale does not re-refresh")
        XCTAssertEqual(model.connection, .stale)
    }

    // MARK: - Accessibility

    func testAccessibilitySummaryComposesParts() {
        XCTAssertEqual(
            PowertrainAccessibility.summary(shift: "D", power: "142.00 kW", regen: "0.00 kW"),
            "D, 142.00 kW, 0.00 kW"
        )
    }

    func testShiftPillLabelUsesRawElseUnknownFallback() {
        let drive = PowertrainProjection.make(reading: PowertrainReading(shiftState: "D"), units: metricUnits())
        XCTAssertEqual(PowertrainShiftPill.label(for: drive), "D")

        let unknown = PowertrainProjection.make(reading: PowertrainReading(), units: metricUnits())
        XCTAssertEqual(PowertrainShiftPill.label(for: unknown), "Unknown")
    }
}

// MARK: - Test doubles

/// Records the surfaces opened so the `view.opened` contract can be asserted without
/// an `os_log` round-trip. Single-threaded test usage only.
private final class SpyPowertrainTelemetry: PowertrainTelemetry, @unchecked Sendable {
    private(set) var openedSurfaces: [String] = []

    func viewOpened(surface: String) {
        openedSurfaces.append(surface)
    }
}
