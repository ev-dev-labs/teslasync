//
//  MotorEfficiencyInsights.Tests.swift
//  TeslaSync — P4 feature view · 0171 · MotorEfficiencyInsights (Apple)
//
//  Unit coverage for the MotorEfficiencyInsights surface:
//    • Adapter — the number / percent / unit / temperature formatters (ports of
//      numberFormat.ts `fmtNumber(v, 1)`), the throttle-style derivation
//      (`getThrottleStyle`), the thermal classification, the temperature conversion +
//      suffix (the "no double degree" regression), and the power-bar fraction.
//    • State holder — `MotorEfficiencyProjection` across loading / empty / error /
//      data and the derived style / thermal / fraction, plus the
//      `MotorEfficiencyInsightsModel` wiring, the P1/S11 `view.opened` telemetry, and
//      the stale auto-refresh transition.
//    • Accessibility — the VoiceOver metric label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryMotorEfficiencySource`, and the locale
//  is injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

private func sampleMetrics(
    averageTorqueNm: Double = 142.5,
    maxTorqueNm: Double = 421.0,
    highTorquePercent: Double = 18.4,
    averagePowerKW: Double = 64.0,
    averageMotorTempC: Double = 49.0,
    maxMotorTempC: Double = 64.0
) -> MotorMetrics {
    MotorMetrics(
        averageTorqueNm: averageTorqueNm,
        maxTorqueNm: maxTorqueNm,
        highTorquePercent: highTorquePercent,
        averagePowerKW: averagePowerKW,
        averageMotorTempC: averageMotorTempC,
        maxMotorTempC: maxMotorTempC
    )
}

// MARK: - Number formatting (port of numberFormat.ts fmtNumber / fmtWithUnit / fmtPercent)

@MainActor final class MotorEfficiencyFormatNumberTests: XCTestCase {
    func testNumberGroupsAndFixesOneDecimal() {
        XCTAssertEqual(MotorEfficiencyFormat.number(1234.5, locale: enUS), "1,234.5")
        XCTAssertEqual(MotorEfficiencyFormat.number(50, locale: enUS), "50.0")
        XCTAssertEqual(MotorEfficiencyFormat.number(0, locale: enUS), "0.0")
    }

    func testNumberCoercesNonFiniteToZero() {
        XCTAssertEqual(MotorEfficiencyFormat.number(.nan, locale: enUS), "0.0")
        XCTAssertEqual(MotorEfficiencyFormat.number(.infinity, locale: enUS), "0.0")
        XCTAssertEqual(MotorEfficiencyFormat.number(-.infinity, locale: enUS), "0.0")
    }

    func testWithUnitSpacesValueAndUnit() {
        XCTAssertEqual(MotorEfficiencyFormat.withUnit(142.5, "Nm", locale: enUS), "142.5 Nm")
        XCTAssertEqual(MotorEfficiencyFormat.withUnit(0, "kW", locale: enUS), "0.0 kW")
    }

    func testPercentHasNoSpace() {
        XCTAssertEqual(MotorEfficiencyFormat.percent(18.4, locale: enUS), "18.4%")
        XCTAssertEqual(MotorEfficiencyFormat.percent(100, locale: enUS), "100.0%")
    }
}

// MARK: - Temperature conversion + suffix (web `toTemperatureDisplay` + `tempUnit`)

@MainActor final class MotorTemperatureUnitTests: XCTestCase {
    func testCelsiusIsIdentityWithCelsiusSuffix() {
        XCTAssertEqual(MotorTemperatureUnit.celsius.convert(fromCelsius: 49), 49, accuracy: 1e-9)
        XCTAssertEqual(MotorTemperatureUnit.celsius.suffix, "°C")
    }

    func testFahrenheitConvertsWithFahrenheitSuffix() {
        // 49°C = 120.2°F (9/5 + 32)
        XCTAssertEqual(MotorTemperatureUnit.fahrenheit.convert(fromCelsius: 49), 120.2, accuracy: 1e-9)
        XCTAssertEqual(MotorTemperatureUnit.fahrenheit.suffix, "°F")
    }

    func testFormatNeverDoublesTheDegreeSymbol() {
        // The web "49.0°°C" regression guard: suffix already carries '°'.
        let celsius = MotorEfficiencyFormat.temperature(celsius: 49, unit: .celsius, locale: enUS)
        XCTAssertEqual(celsius, "49.0°C")
        XCTAssertFalse(celsius.contains("°°"))

        let maxCelsius = MotorEfficiencyFormat.temperature(celsius: 64, unit: .celsius, locale: enUS)
        XCTAssertEqual(maxCelsius, "64.0°C")

        let fahrenheit = MotorEfficiencyFormat.temperature(celsius: 49, unit: .fahrenheit, locale: enUS)
        XCTAssertEqual(fahrenheit, "120.2°F")
        XCTAssertFalse(fahrenheit.contains("°°"))
    }
}

// MARK: - Throttle style derivation (web helpers.ts getThrottleStyle)

@MainActor final class MotorThrottleStyleTests: XCTestCase {
    func testThresholds() {
        XCTAssertEqual(MotorThrottle.style(forAveragePowerKW: 0), .conservative)
        XCTAssertEqual(MotorThrottle.style(forAveragePowerKW: 19.99), .conservative)
        XCTAssertEqual(MotorThrottle.style(forAveragePowerKW: 20), .moderate)
        XCTAssertEqual(MotorThrottle.style(forAveragePowerKW: 79.99), .moderate)
        XCTAssertEqual(MotorThrottle.style(forAveragePowerKW: 80), .aggressive)
        XCTAssertEqual(MotorThrottle.style(forAveragePowerKW: 250), .aggressive)
    }

    func testNonFiniteMatchesWebComparisonSemantics() {
        // Web `getThrottleStyle` uses raw `<`, so (like JS) NaN/+∞ fall through to
        // aggressive and -∞ is conservative — Swift's `<` reproduces this exactly.
        XCTAssertEqual(MotorThrottle.style(forAveragePowerKW: .nan), .aggressive)
        XCTAssertEqual(MotorThrottle.style(forAveragePowerKW: .infinity), .aggressive)
        XCTAssertEqual(MotorThrottle.style(forAveragePowerKW: -.infinity), .conservative)
    }

    func testLabelKeysAndFallbacks() {
        XCTAssertEqual(MotorThrottleStyle.conservative.labelFallback, "Conservative")
        XCTAssertEqual(MotorThrottleStyle.moderate.labelKey, "dynamics.moderate")
        XCTAssertEqual(MotorThrottleStyle.aggressive.labelFallback, "Aggressive")
    }
}

// MARK: - Thermal classification (web maxMotorTemp < 100 / < 140 thresholds)

@MainActor final class MotorThermalStatusTests: XCTestCase {
    func testThresholdsOnRawCelsius() {
        XCTAssertEqual(MotorThermalStatus.classify(maxMotorTempC: 64), .good)
        XCTAssertEqual(MotorThermalStatus.classify(maxMotorTempC: 99.99), .good)
        XCTAssertEqual(MotorThermalStatus.classify(maxMotorTempC: 100), .warm)
        XCTAssertEqual(MotorThermalStatus.classify(maxMotorTempC: 139.99), .warm)
        XCTAssertEqual(MotorThermalStatus.classify(maxMotorTempC: 140), .hot)
        XCTAssertEqual(MotorThermalStatus.classify(maxMotorTempC: 148), .hot)
    }

    func testNonFiniteMatchesWebComparisonSemantics() {
        // Web compares raw `maxMotorTemp < 100 / < 140`; NaN/+∞ fall through to hot.
        XCTAssertEqual(MotorThermalStatus.classify(maxMotorTempC: .nan), .hot)
        XCTAssertEqual(MotorThermalStatus.classify(maxMotorTempC: .infinity), .hot)
        XCTAssertEqual(MotorThermalStatus.classify(maxMotorTempC: -.infinity), .good)
    }

    func testLabelKeysAndFallbacks() {
        XCTAssertEqual(MotorThermalStatus.good.labelFallback, "Thermal: Good")
        XCTAssertEqual(MotorThermalStatus.warm.labelKey, "dynamics.thermalWarm")
        XCTAssertEqual(MotorThermalStatus.hot.labelFallback, "Thermal: Hot")
    }
}

// MARK: - Power-bar fraction (web MetricBar value/max=200)

@MainActor final class MotorPowerFractionTests: XCTestCase {
    func testProportionalToTwoHundred() {
        XCTAssertEqual(MotorEfficiencyFormat.powerFraction(64), 0.32, accuracy: 1e-9)
        XCTAssertEqual(MotorEfficiencyFormat.powerFraction(0), 0, accuracy: 1e-9)
    }

    func testClampedAndNonFiniteSafe() {
        XCTAssertEqual(MotorEfficiencyFormat.powerFraction(250), 1, accuracy: 1e-9)
        XCTAssertEqual(MotorEfficiencyFormat.powerFraction(-5), 0, accuracy: 1e-9)
        XCTAssertEqual(MotorEfficiencyFormat.powerFraction(.nan), 0, accuracy: 1e-9)
    }
}

// MARK: - Projection (web render branch + P4 leaf contract)

@MainActor final class MotorEfficiencyProjectionTests: XCTestCase {
    func testErrorTakesPrecedence() {
        let resolved = MotorEfficiencyProjection.resolve(
            MotorEfficiencyInput(metrics: sampleMetrics(), errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.metrics)
    }

    func testLoadingWhenFlagged() {
        XCTAssertEqual(MotorEfficiencyProjection.resolve(MotorEfficiencyInput(isLoading: true)).phase, .loading)
    }

    func testEmptyWhenMetricsNil() {
        XCTAssertEqual(MotorEfficiencyProjection.resolve(MotorEfficiencyInput(metrics: nil)).phase, .empty)
    }

    func testDataResolvesDerivedFields() {
        let resolved = MotorEfficiencyProjection.resolve(
            MotorEfficiencyInput(metrics: sampleMetrics(), throttleStyle: .moderate)
        )
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.metrics, sampleMetrics())
        XCTAssertEqual(resolved.throttleStyle, .moderate)
        XCTAssertEqual(resolved.thermalStatus, .good)
        XCTAssertEqual(resolved.powerFraction, 0.32, accuracy: 1e-9)
    }

    func testDataDerivesStyleWhenPropOmitted() {
        let resolved = MotorEfficiencyProjection.resolve(
            MotorEfficiencyInput(metrics: sampleMetrics(averagePowerKW: 10), throttleStyle: nil)
        )
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.throttleStyle, .conservative)
    }

    func testTemperatureUnitCarriedThroughEveryPhase() {
        let loading = MotorEfficiencyProjection.resolve(
            MotorEfficiencyInput(temperatureUnit: .fahrenheit, isLoading: true)
        )
        XCTAssertEqual(loading.temperatureUnit, .fahrenheit)

        let data = MotorEfficiencyProjection.resolve(
            MotorEfficiencyInput(metrics: sampleMetrics(), temperatureUnit: .fahrenheit)
        )
        XCTAssertEqual(data.temperatureUnit, .fahrenheit)
    }
}

// MARK: - State holder: wiring, telemetry, freshness

@MainActor final class MotorEfficiencyInsightsModelTests: XCTestCase {
    private func makeModel(
        _ input: MotorEfficiencyInput,
        telemetry: MotorEfficiencyTelemetry = OSLogMotorEfficiencyTelemetry()
    ) -> (MotorEfficiencyInsightsModel, InMemoryMotorEfficiencySource) {
        let source = InMemoryMotorEfficiencySource(initial: input)
        let model = MotorEfficiencyInsightsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var dataInput: MotorEfficiencyInput {
        MotorEfficiencyInput(metrics: sampleMetrics(), throttleStyle: .moderate)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyMotorEfficiencyTelemetry()
        let (model, source) = makeModel(dataInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.metrics, sampleMetrics())
        XCTAssertEqual(spy.surfaces, [MotorEfficiencyInsights.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(MotorEfficiencyInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertNil(model.resolved.metrics)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(MotorEfficiencyInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(dataInput)
        XCTAssertEqual(model.phase, .data)
    }

    func testEmptyPushProjectsEmpty() {
        let (model, source) = makeModel(MotorEfficiencyInput(isLoading: true))
        model.start()
        source.push(MotorEfficiencyInput(metrics: nil))
        XCTAssertEqual(model.phase, .empty)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(dataInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(MotorEfficiencyInput(metrics: sampleMetrics(), connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(MotorEfficiencyInput(metrics: sampleMetrics(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testLiveThenStaleReArmsAutoRefresh() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(MotorEfficiencyInput(metrics: sampleMetrics(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(MotorEfficiencyInput(metrics: sampleMetrics(), connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(MotorEfficiencyInput(metrics: sampleMetrics(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(MotorEfficiencyInput(metrics: sampleMetrics(), connection: .offline))
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
        XCTAssertEqual(MotorEfficiencyInsights.surfaceSlug, "MotorEfficiencyInsights")
    }
}

// MARK: - Accessibility summary content

@MainActor final class MotorEfficiencyAccessibilityTests: XCTestCase {
    func testJoinFiltersEmptyAndJoins() {
        XCTAssertEqual(MotorEfficiencyAccessibility.join(["Avg Torque", "", "142.5 Nm"]), "Avg Torque, 142.5 Nm")
        XCTAssertEqual(MotorEfficiencyAccessibility.join([]), "")
    }

    func testMetricLabelJoinsLabelAndValue() {
        XCTAssertEqual(
            MotorEfficiencyAccessibility.metric("Max Motor Temp", "64.0°C"),
            "Max Motor Temp, 64.0°C"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyMotorEfficiencyTelemetry: MotorEfficiencyTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
