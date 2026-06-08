//
//  ThermalLoadPanel.Tests.swift
//  TeslaSync — P4 feature view · 0163 · ThermalLoadPanel (Apple)
//
//  Unit coverage for the ThermalLoadPanel surface:
//    • Adapter — the number / percent / temperature formatters (ports of
//      numberFormat.ts + unitConversion.ts), the severity thresholds, the bar
//      fraction math, and the inline-metric value fallbacks.
//    • State holder — `ThermalLoadProjection` across loading / empty / error / data,
//      plus the `ThermalLoadModel` wiring, the P1/S11 `view.opened` telemetry, and the
//      stale auto-refresh transition.
//    • Accessibility — the VoiceOver sensor + metric label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryThermalLoadSource`, and the locale is injected
//  for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

private func sensor(_ id: String, _ value: Double?, maxTemp: Double) -> ThermalSensorReading {
    ThermalSensorReading(
        id: id,
        labelKey: "drivetrain.\(id)",
        labelFallback: id,
        valueCelsius: value,
        maxTempCelsius: maxTemp
    )
}

private func sampleSensors() -> [ThermalSensorReading] {
    [
        sensor("frontMotor", 64, maxTemp: 150),
        sensor("rearMotor", 110, maxTemp: 150),
        sensor("inverter", 108, maxTemp: 120),
        sensor("battery", 31, maxTemp: 60)
    ]
}

private func samplePayload(
    sensors: [ThermalSensorReading]? = nil,
    peakPower: Double = 245,
    avgPower: Double = 38.4,
    stats: ThermalLoadStats? = ThermalLoadStats(totalDrives: 1280, regenRatio: 0.32)
) -> ThermalLoadPayload {
    ThermalLoadPayload(
        sensors: sensors ?? sampleSensors(),
        peakPower: peakPower,
        avgPower: avgPower,
        stats: stats
    )
}

// MARK: - Number formatting (port of numberFormat.ts fmtNumber / fmtInt / fmtPercent)

final class ThermalFormatNumberTests: XCTestCase {
    func testNumberGroupsAndFixesDecimals() {
        XCTAssertEqual(ThermalFormat.number(1234.5, decimals: 1, locale: enUS), "1,234.5")
        XCTAssertEqual(ThermalFormat.number(64, decimals: 1, locale: enUS), "64.0")
        XCTAssertEqual(ThermalFormat.number(0, decimals: 1, locale: enUS), "0.0")
    }

    func testNumberCoercesNonFiniteToZero() {
        XCTAssertEqual(ThermalFormat.number(.nan, decimals: 1, locale: enUS), "0.0")
        XCTAssertEqual(ThermalFormat.number(.infinity, decimals: 1, locale: enUS), "0.0")
    }

    func testIntegerRoundsAndGroups() {
        XCTAssertEqual(ThermalFormat.int(1280, locale: enUS), "1,280")
        XCTAssertEqual(ThermalFormat.int(245.7, locale: enUS), "246")
    }

    func testPercentAppendsSign() {
        XCTAssertEqual(ThermalFormat.percent(35.5, decimals: 1, locale: enUS), "35.5%")
        XCTAssertEqual(ThermalFormat.percent(100, decimals: 1, locale: enUS), "100.0%")
    }
}

// MARK: - Temperature formatting (web `formatTemperature` via `displayTemp`)

final class ThermalFormatTemperatureTests: XCTestCase {
    func testCelsiusOneDecimalNoSpace() {
        XCTAssertEqual(ThermalFormat.temperature(64, unit: .celsius, locale: enUS), "64.0°C")
        XCTAssertEqual(ThermalFormat.temperature(31.25, unit: .celsius, locale: enUS), "31.3°C")
    }

    func testFahrenheitConvertsLinearly() {
        // 64 °C → 147.2 °F.
        XCTAssertEqual(ThermalFormat.temperature(64, unit: .fahrenheit, locale: enUS), "147.2°F")
        // 0 °C → 32.0 °F.
        XCTAssertEqual(ThermalFormat.temperature(0, unit: .fahrenheit, locale: enUS), "32.0°F")
    }

    func testMissingOrNonFiniteIsEmDash() {
        XCTAssertEqual(ThermalFormat.temperature(nil, unit: .celsius, locale: enUS), "—")
        XCTAssertEqual(ThermalFormat.temperature(.nan, unit: .celsius, locale: enUS), "—")
        XCTAssertEqual(ThermalFormat.temperature(.infinity, unit: .fahrenheit, locale: enUS), "—")
    }

    func testPrecisionOverrideWins() {
        XCTAssertEqual(ThermalFormat.temperature(31, unit: .celsius, precision: 0, locale: enUS), "31°C")
        XCTAssertEqual(ThermalFormat.temperature(31, unit: .celsius, precision: 2, locale: enUS), "31.00°C")
    }

    func testNegativePrecisionFallsBackToDefault() {
        XCTAssertEqual(ThermalFormat.temperature(64, unit: .celsius, precision: -3, locale: enUS), "64.0°C")
    }
}

// MARK: - Inline-metric value fallbacks (web `peakPower > 0` / `stats ?`)

final class ThermalFormatMetricTests: XCTestCase {
    func testPeakPowerIntegerWithUnitOrDash() {
        XCTAssertEqual(ThermalFormat.powerInteger(245, locale: enUS), "245 kW")
        XCTAssertEqual(ThermalFormat.powerInteger(245.7, locale: enUS), "246 kW")
        XCTAssertEqual(ThermalFormat.powerInteger(0, locale: enUS), "—")
        XCTAssertEqual(ThermalFormat.powerInteger(-5, locale: enUS), "—")
    }

    func testAvgPowerDecimalWithUnitOrDash() {
        XCTAssertEqual(ThermalFormat.powerDecimal(38.4, locale: enUS), "38.4 kW")
        XCTAssertEqual(ThermalFormat.powerDecimal(0, locale: enUS), "—")
    }

    func testDrivesFromStatsOrDash() {
        XCTAssertEqual(ThermalFormat.drives(ThermalLoadStats(totalDrives: 1280, regenRatio: 0), locale: enUS), "1,280")
        XCTAssertEqual(ThermalFormat.drives(nil, locale: enUS), "—")
    }

    func testRegenRatioFromStatsOrDash() {
        XCTAssertEqual(
            ThermalFormat.regenRatio(ThermalLoadStats(totalDrives: 0, regenRatio: 0.32), locale: enUS),
            "32.0%"
        )
        XCTAssertEqual(ThermalFormat.regenRatio(nil, locale: enUS), "—")
    }
}

// MARK: - Severity ladder (web `tempSeverityColor`)

final class ThermalSeverityTests: XCTestCase {
    func testNilReadingIsUnknown() {
        XCTAssertEqual(ThermalSeverity.forTemperature(nil, maxTemp: 150), .unknown)
    }

    func testThresholds() {
        XCTAssertEqual(ThermalSeverity.forTemperature(64, maxTemp: 150), .good)
        XCTAssertEqual(ThermalSeverity.forTemperature(110, maxTemp: 150), .warning)
        XCTAssertEqual(ThermalSeverity.forTemperature(108, maxTemp: 120), .critical)
    }

    func testBoundariesAreInclusive() {
        // ratio == 0.65 → warning; ratio == 0.85 → critical.
        XCTAssertEqual(ThermalSeverity.forTemperature(97.5, maxTemp: 150), .warning)
        XCTAssertEqual(ThermalSeverity.forTemperature(97.4, maxTemp: 150), .good)
        XCTAssertEqual(ThermalSeverity.forTemperature(127.5, maxTemp: 150), .critical)
    }

    func testNonPositiveOrNonFiniteCeilingIsUnknown() {
        XCTAssertEqual(ThermalSeverity.forTemperature(40, maxTemp: 0), .unknown)
        XCTAssertEqual(ThermalSeverity.forTemperature(.nan, maxTemp: 150), .unknown)
    }
}

// MARK: - Bar fraction (web `MetricBar` `min(value / max * 100, 100)`)

final class ThermalBarTests: XCTestCase {
    func testProportionalFill() {
        XCTAssertEqual(ThermalBar.fraction(value: 64, maxTemp: 150), 64.0 / 150.0, accuracy: 1e-9)
    }

    func testNilReadingIsEmpty() {
        XCTAssertEqual(ThermalBar.fraction(value: nil, maxTemp: 150), 0, accuracy: 1e-9)
    }

    func testClampedToUnitRange() {
        XCTAssertEqual(ThermalBar.fraction(value: 300, maxTemp: 150), 1, accuracy: 1e-9)
        XCTAssertEqual(ThermalBar.fraction(value: -10, maxTemp: 150), 0, accuracy: 1e-9)
    }

    func testNonPositiveOrNonFiniteCeilingIsZero() {
        XCTAssertEqual(ThermalBar.fraction(value: 40, maxTemp: 0), 0, accuracy: 1e-9)
        XCTAssertEqual(ThermalBar.fraction(value: .nan, maxTemp: 150), 0, accuracy: 1e-9)
    }
}

// MARK: - Sensor reading derived values

final class ThermalSensorReadingTests: XCTestCase {
    func testFractionAndSeverity() {
        let good = sensor("frontMotor", 64, maxTemp: 150)
        XCTAssertEqual(good.fraction, 64.0 / 150.0, accuracy: 1e-9)
        XCTAssertEqual(good.severity, .good)

        let critical = sensor("inverter", 108, maxTemp: 120)
        XCTAssertEqual(critical.severity, .critical)

        let unknown = sensor("battery", nil, maxTemp: 60)
        XCTAssertEqual(unknown.fraction, 0, accuracy: 1e-9)
        XCTAssertEqual(unknown.severity, .unknown)
    }
}

// MARK: - Severity → tone mapping (web colour ladder)

final class ThermalToneMapTests: XCTestCase {
    func testEachSeverityMapsToATone() {
        XCTAssertEqual(ThermalToneMap.tone(for: .unknown), .neutral)
        XCTAssertEqual(ThermalToneMap.tone(for: .good), .success)
        XCTAssertEqual(ThermalToneMap.tone(for: .warning), .warning)
        XCTAssertEqual(ThermalToneMap.tone(for: .critical), .danger)
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

final class ThermalLoadProjectionTests: XCTestCase {
    func testErrorTakesPrecedence() {
        let resolved = ThermalLoadProjection.resolve(
            ThermalLoadInput(payload: samplePayload(), errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testLoadingWhenFlaggedOrNoSnapshot() {
        XCTAssertEqual(ThermalLoadProjection.resolve(ThermalLoadInput(isLoading: true)).phase, .loading)
        XCTAssertEqual(ThermalLoadProjection.resolve(ThermalLoadInput(payload: nil)).phase, .loading)
    }

    func testEmptyWhenNoSensors() {
        let resolved = ThermalLoadProjection.resolve(
            ThermalLoadInput(payload: samplePayload(sensors: []))
        )
        XCTAssertEqual(resolved.phase, .empty)
    }

    func testDataResolvesSensorsPowerAndStats() {
        let resolved = ThermalLoadProjection.resolve(ThermalLoadInput(payload: samplePayload()))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.sensors.count, 4)
        XCTAssertEqual(resolved.peakPower, 245, accuracy: 1e-9)
        XCTAssertEqual(resolved.avgPower, 38.4, accuracy: 1e-9)
        XCTAssertEqual(resolved.stats?.totalDrives, 1280)
    }

    func testUnitContextCarriedThrough() {
        let resolved = ThermalLoadProjection.resolve(ThermalLoadInput(
            payload: samplePayload(),
            units: ThermalUnitContext(temperature: .fahrenheit, locale: "en_US", precision: 0)
        ))
        XCTAssertEqual(resolved.units.temperature, .fahrenheit)
        XCTAssertEqual(resolved.units.precision, 0)
    }
}

// MARK: - State holder: wiring, telemetry, freshness

@MainActor
final class ThermalLoadModelTests: XCTestCase {
    private func makeModel(
        _ input: ThermalLoadInput,
        telemetry: ThermalLoadTelemetry = OSLogThermalLoadTelemetry()
    ) -> (ThermalLoadModel, InMemoryThermalLoadSource) {
        let source = InMemoryThermalLoadSource(initial: input)
        let model = ThermalLoadModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var dataInput: ThermalLoadInput {
        ThermalLoadInput(payload: samplePayload())
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyThermalLoadTelemetry()
        let (model, source) = makeModel(dataInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.sensors.count, 4)
        XCTAssertEqual(spy.surfaces, [ThermalLoadPanel.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(ThermalLoadInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.resolved.sensors.isEmpty)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(ThermalLoadInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(dataInput)
        XCTAssertEqual(model.phase, .data)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(dataInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(ThermalLoadInput(payload: samplePayload(), connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(ThermalLoadInput(payload: samplePayload(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(ThermalLoadInput(payload: samplePayload(), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(ThermalLoadPanel.surfaceSlug, "ThermalLoadPanel")
    }
}

// MARK: - Accessibility summary content

final class ThermalAccessibilityTests: XCTestCase {
    func testSensorLabelJoinsParts() {
        XCTAssertEqual(
            ThermalAccessibility.sensorLabel(name: "Front Motor", value: "64.0°C"),
            "Front Motor, 64.0°C"
        )
    }

    func testMetricLabelJoinsParts() {
        XCTAssertEqual(
            ThermalAccessibility.metricLabel(label: "Peak Power", value: "245 kW"),
            "Peak Power, 245 kW"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyThermalLoadTelemetry: ThermalLoadTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
