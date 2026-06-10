//
//  EnergyChargingPanel.Tests.swift
//  TeslaSync — P4 feature view · 0279 · EnergyChargingPanel (Apple)
//
//  Unit coverage for the EnergyChargingPanel surface:
//    • Adapter — the number / unit / speed formatters (ports of numberFormat.ts +
//      unitConversion.ts), the SI m/s → km-h / mph conversion, the charging-state
//      colour branch, and the per-field projection (cached → projection).
//    • State holder — `EnergyChargingProjector` across loading / empty / error / data,
//      plus the `EnergyChargingModel` wiring, the P1/S11 `view.opened` telemetry, and
//      the stale auto-refresh transition.
//    • Accessibility — the VoiceOver summary + the state-pill label.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryEnergyChargingSource`, and the locale
//  is injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

private func metricUnits(precision: Int? = nil) -> EnergyChargingUnits {
    EnergyChargingUnits(speed: .kilometersPerHour, precision: precision, locale: "en_US")
}

private func imperialUnits(precision: Int? = nil) -> EnergyChargingUnits {
    EnergyChargingUnits(speed: .milesPerHour, precision: precision, locale: "en_US")
}

@MainActor
final class EnergyChargingPanelTests: XCTestCase {
    // MARK: - Number / unit formatting (ports of numberFormat.ts)

    func testNumberUsesGroupingFixedDigitsAndHalfUp() {
        XCTAssertEqual(EnergyChargingFormat.number(402, decimals: 2, locale: enUS), "402.00")
        XCTAssertEqual(EnergyChargingFormat.number(11000, decimals: 2, locale: enUS), "11,000.00")
        XCTAssertEqual(EnergyChargingFormat.number(8400, decimals: 2, locale: enUS), "8,400.00")
        // Half-away-from-zero rounding (the toLocaleString default).
        XCTAssertEqual(EnergyChargingFormat.number(1.005, decimals: 2, locale: enUS), "1.01")
    }

    func testNumberCoercesNonFiniteToZero() {
        XCTAssertEqual(EnergyChargingFormat.number(.infinity, decimals: 2, locale: enUS), "0.00")
        XCTAssertEqual(EnergyChargingFormat.number(.nan, decimals: 0, locale: enUS), "0")
    }

    func testWithUnitAppendsSpacedUnit() {
        XCTAssertEqual(EnergyChargingFormat.withUnit(11000, "kW", decimals: 2, locale: enUS), "11,000.00 kW")
        XCTAssertEqual(EnergyChargingFormat.withUnit(8400, "kWh", decimals: 2, locale: enUS), "8,400.00 kWh")
    }

    // MARK: - Speed conversion (ports of convertSpeedFromSI + formatSpeed)

    func testSpeedUnitConversionMatchesWeb() {
        // km/h = mps * 3600 / 1000
        XCTAssertEqual(EnergySpeedUnit.kilometersPerHour.fromMetersPerSecond(10), 36, accuracy: 0.0001)
        // mph = mps * 3600 / 1609.344
        XCTAssertEqual(EnergySpeedUnit.milesPerHour.fromMetersPerSecond(10), 22.369362920544, accuracy: 0.0001)
    }

    func testSpeedUnitLabelAndInit() {
        XCTAssertEqual(EnergySpeedUnit.kilometersPerHour.label, "km/h")
        XCTAssertEqual(EnergySpeedUnit.milesPerHour.label, "mph")
        XCTAssertEqual(EnergySpeedUnit(label: "mph"), .milesPerHour)
        XCTAssertEqual(EnergySpeedUnit(label: "km/h"), .kilometersPerHour)
        XCTAssertEqual(EnergySpeedUnit(label: "furlong/fortnight"), .kilometersPerHour) // default
    }

    func testFormatSpeedDefaultsToZeroPrecisionWithLabel() {
        // 13.333… m/s → 48 km/h (0-decimal speed default).
        XCTAssertEqual(EnergyChargingFormat.speed(metersPerSecond: 13.3333, units: metricUnits()), "48 km/h")
        // 13.333… m/s → 29.83 mph, half-up to 30.
        XCTAssertEqual(EnergyChargingFormat.speed(metersPerSecond: 13.3333, units: imperialUnits()), "30 mph")
    }

    func testFormatSpeedHonoursPrecisionOverride() {
        XCTAssertEqual(
            EnergyChargingFormat.speed(metersPerSecond: 13.3333, units: metricUnits(precision: 1)),
            "48.0 km/h"
        )
    }

    func testFormatSpeedNilOrNonFiniteIsEmptySentinel() {
        XCTAssertEqual(EnergyChargingFormat.speed(metersPerSecond: nil, units: metricUnits()), "—")
        XCTAssertEqual(EnergyChargingFormat.speed(metersPerSecond: .infinity, units: metricUnits()), "—")
        let custom = EnergyChargingUnits(speed: .kilometersPerHour, locale: "en_US", emptyDisplay: "n/a")
        XCTAssertEqual(EnergyChargingFormat.speed(metersPerSecond: nil, units: custom), "n/a")
    }

    // MARK: - Charging-state badge (web colour branch)

    func testStateBadgeMapsWebTernary() {
        XCTAssertEqual(EnergyChargingStateBadge.from("Charging"), .charging)
        XCTAssertEqual(EnergyChargingStateBadge.from("Complete"), .complete)
        XCTAssertEqual(EnergyChargingStateBadge.from("Stopped"), .other)
        XCTAssertEqual(EnergyChargingStateBadge.from(nil), .other)
    }

    // MARK: - Projection (cached → projection)

    func testProjectionFormatsEveryFieldMetric() {
        let reading = EnergyChargingReading(
            chargerVoltage: 402,
            chargerActualCurrent: 24,
            chargerPowerW: 11000,
            chargeEnergyAddedWh: 8400,
            chargingState: "Charging",
            batteryLevel: 64,
            rangeAddedMetersPerHour: 48000
        )
        let projection = EnergyChargingProjection.make(reading: reading, units: metricUnits())
        XCTAssertEqual(projection.voltageValue, "402.00")
        XCTAssertEqual(projection.voltageUnit, "V")
        XCTAssertEqual(projection.currentValue, "24.00")
        XCTAssertEqual(projection.currentUnit, "A")
        XCTAssertEqual(projection.powerText, "11,000.00 kW")
        XCTAssertEqual(projection.energyAddedText, "8,400.00 kWh")
        XCTAssertEqual(projection.batteryLevelText, "64.00%")
        XCTAssertEqual(projection.chargeRateText, "48 km/h")
        XCTAssertEqual(projection.stateRawLabel, "Charging")
        XCTAssertEqual(projection.stateBadge, .charging)
    }

    func testProjectionUsesImperialSpeed() {
        let reading = EnergyChargingReading(rangeAddedMetersPerHour: 48000)
        let projection = EnergyChargingProjection.make(reading: reading, units: imperialUnits())
        XCTAssertEqual(projection.chargeRateText, "30 mph")
    }

    func testProjectionRendersDashForMissingValues() {
        let projection = EnergyChargingProjection.make(reading: EnergyChargingReading(), units: metricUnits())
        XCTAssertEqual(projection.voltageValue, "—")
        XCTAssertEqual(projection.currentValue, "—")
        XCTAssertEqual(projection.powerText, "—")
        XCTAssertEqual(projection.energyAddedText, "—")
        XCTAssertEqual(projection.batteryLevelText, "—")
        XCTAssertEqual(projection.chargeRateText, "—")
        XCTAssertNil(projection.stateRawLabel)
        XCTAssertEqual(projection.stateBadge, .other)
    }

    // MARK: - Projector (loading / empty / error / data precedence)

    func testProjectorErrorTakesPrecedence() {
        let input = EnergyChargingInput(
            reading: EnergyChargingReading(batteryLevel: 50),
            errorMessage: "boom"
        )
        guard case let .error(message) = EnergyChargingProjector.resolve(input).phase else {
            return XCTFail("expected .error")
        }
        XCTAssertEqual(message, "boom")
    }

    func testProjectorLoadingWhenFetching() {
        let input = EnergyChargingInput(reading: EnergyChargingReading(batteryLevel: 50), isLoading: true)
        XCTAssertEqual(EnergyChargingProjector.resolve(input).phase, .loading)
    }

    func testProjectorEmptyWhenNoReading() {
        XCTAssertEqual(EnergyChargingProjector.resolve(EnergyChargingInput(reading: nil)).phase, .empty)
    }

    func testProjectorDataWhenReadingPresent() {
        let input = EnergyChargingInput(reading: EnergyChargingReading(batteryLevel: 80), units: metricUnits())
        guard case let .data(projection) = EnergyChargingProjector.resolve(input).phase else {
            return XCTFail("expected .data")
        }
        XCTAssertEqual(projection.batteryLevelText, "80.00%")
    }

    // MARK: - Model wiring + telemetry (P1/S11 view.opened)

    func testModelStartEmitsViewOpenedSlugOnce() {
        let spy = SpyEnergyChargingTelemetry()
        let model = EnergyChargingModel(source: InMemoryEnergyChargingSource(), telemetry: spy)
        model.start()
        model.start() // idempotent
        XCTAssertEqual(spy.openedSurfaces, ["EnergyChargingPanel"])
        XCTAssertEqual(EnergyChargingPanel.surfaceSlug, "EnergyChargingPanel")
    }

    func testModelAppliesPushedSnapshot() {
        let source = InMemoryEnergyChargingSource()
        let model = EnergyChargingModel(source: source, telemetry: SpyEnergyChargingTelemetry())
        model.start()
        source.push(EnergyChargingInput(reading: EnergyChargingReading(batteryLevel: 42), units: metricUnits()))
        guard case let .data(projection) = model.phase else {
            return XCTFail("expected .data after push")
        }
        XCTAssertEqual(projection.batteryLevelText, "42.00%")
        XCTAssertEqual(model.connection, .live)
    }

    func testModelStartStopRefreshForwardToSource() {
        let source = InMemoryEnergyChargingSource()
        let model = EnergyChargingModel(source: source, telemetry: SpyEnergyChargingTelemetry())
        model.start()
        model.refresh()
        model.stop()
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testModelAutoRefreshesOnceOnStaleTransition() {
        let source = InMemoryEnergyChargingSource()
        let model = EnergyChargingModel(source: source, telemetry: SpyEnergyChargingTelemetry())
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(EnergyChargingInput(reading: EnergyChargingReading(batteryLevel: 1), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "stale transition triggers one auto-refresh")
        source.push(EnergyChargingInput(reading: EnergyChargingReading(batteryLevel: 1), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "staying stale does not re-refresh")
        XCTAssertEqual(model.connection, .stale)
    }

    // MARK: - Accessibility

    func testAccessibilitySummaryComposesParts() {
        XCTAssertEqual(
            EnergyChargingAccessibility.summary(state: "Charging", battery: "64.00%", power: "11,000.00 kW"),
            "Charging, 64.00%, 11,000.00 kW"
        )
    }

    func testStatePillLabelUsesRawElseUnknownFallback() {
        let charging = EnergyChargingProjection.make(
            reading: EnergyChargingReading(chargingState: "Charging"),
            units: metricUnits()
        )
        XCTAssertEqual(EnergyChargingStatePill.label(for: charging), "Charging")

        let unknown = EnergyChargingProjection.make(reading: EnergyChargingReading(), units: metricUnits())
        XCTAssertEqual(EnergyChargingStatePill.label(for: unknown), "Unknown")
    }
}

// MARK: - Test doubles

/// Records the surfaces opened so the `view.opened` contract can be asserted without
/// an `os_log` round-trip. Single-threaded test usage only.
private final class SpyEnergyChargingTelemetry: EnergyChargingTelemetry, @unchecked Sendable {
    private(set) var openedSurfaces: [String] = []

    func viewOpened(surface: String) {
        openedSurfaces.append(surface)
    }
}
