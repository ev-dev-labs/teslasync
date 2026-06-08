//
//  TemperatureMetricCards.Tests.swift
//  TeslaSync — P4 feature view · 0161 · TemperatureMetricCards (Apple)
//
//  Unit coverage for the TemperatureMetricCards surface: the adapter (cached → projection) —
//  `TemperatureMetricsMath` conversion/format/percent + `TemperatureMetricsProjection` six-card
//  projection + phase resolution; the `TemperatureMetricCardsModel` state holder (phases,
//  refresh, stale auto-refresh, `view.opened` telemetry); and the VoiceOver card summary. No
//  network, no real store — the model is driven by `InMemoryTemperatureMetricsSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: conversion + formatting (web parity)

final class TemperatureMetricsMathTests: XCTestCase {
    func testSafeCoercesNonFinite() {
        XCTAssertEqual(TemperatureMetricsMath.safe(42), 42, accuracy: 0.0001)
        XCTAssertEqual(TemperatureMetricsMath.safe(nil), 0)
        XCTAssertEqual(TemperatureMetricsMath.safe(.nan), 0)
        XCTAssertEqual(TemperatureMetricsMath.safe(.infinity), 0)
        XCTAssertEqual(TemperatureMetricsMath.safe(-.infinity), 0)
    }

    func testTemperatureConversionMatchesWeb() {
        // convertTempFromSI: °C identity; °F = c * 9 / 5 + 32.
        XCTAssertEqual(TemperatureMetricsMath.convertTemperatureFromSI(98, to: .celsius), 98, accuracy: 0.0001)
        XCTAssertEqual(TemperatureMetricsMath.convertTemperatureFromSI(98, to: .fahrenheit), 208.4, accuracy: 0.0001)
        XCTAssertEqual(TemperatureMetricsMath.convertTemperatureFromSI(0, to: .fahrenheit), 32, accuracy: 0.0001)
        XCTAssertEqual(TemperatureMetricsMath.convertTemperatureFromSI(100, to: .fahrenheit), 212, accuracy: 0.0001)
    }

    func testNumberGroupingRoundingAndPrecision() {
        XCTAssertEqual(TemperatureMetricsMath.number(98.0, decimals: 1, localeIdentifier: "en_US"), "98.0")
        XCTAssertEqual(TemperatureMetricsMath.number(208.4, decimals: 1, localeIdentifier: "en_US"), "208.4")
        XCTAssertEqual(TemperatureMetricsMath.number(285, decimals: 0, localeIdentifier: "en_US"), "285")
        XCTAssertEqual(TemperatureMetricsMath.number(1234.5, decimals: 0, localeIdentifier: "en_US"), "1,235")
    }

    func testNumberGuardsNonFinite() {
        XCTAssertEqual(TemperatureMetricsMath.number(.nan, decimals: 0, localeIdentifier: "en_US"), "0")
        XCTAssertEqual(TemperatureMetricsMath.number(.infinity, decimals: 1, localeIdentifier: "en_US"), "0.0")
    }

    func testTemperatureInlineAppendsSymbolWithoutSpace() {
        // web: `${fmtNumber(value, 1)}${pref.temperature}` — no space, default precision 1.
        XCTAssertEqual(inline(98.0, .celsius), "98.0°C")
        XCTAssertEqual(inline(98.0, .fahrenheit), "208.4°F")
        XCTAssertEqual(inline(34.0, .fahrenheit), "93.2°F")
    }

    func testTemperatureInlineHonorsPrecisionOverride() {
        XCTAssertEqual(
            TemperatureMetricsMath.temperatureInline(98.0, unit: .celsius, precision: 0, localeIdentifier: "en_US"),
            "98°C"
        )
        XCTAssertEqual(
            TemperatureMetricsMath.temperatureInline(98.0, unit: .celsius, precision: 2, localeIdentifier: "en_US"),
            "98.00°C"
        )
    }

    func testTemperatureInlineEmDashForNullOrNonFinite() {
        XCTAssertEqual(inline(nil, .celsius), TemperatureMetricsMath.emDash)
        XCTAssertEqual(inline(.nan, .celsius), TemperatureMetricsMath.emDash)
        XCTAssertEqual(inline(.infinity, .fahrenheit), TemperatureMetricsMath.emDash)
    }

    func testIntegerIsGroupedZeroFraction() {
        XCTAssertEqual(TemperatureMetricsMath.integer(285, localeIdentifier: "en_US"), "285")
        XCTAssertEqual(TemperatureMetricsMath.integer(1234.5, localeIdentifier: "en_US"), "1,235")
    }

    func testPercentOfMaxUsesRawCelsiusRatio() {
        // 98 / 150 * 100 = 65.33 → "65" ; 132 / 150 * 100 = 88 → "88" ; 34 / 60 * 100 = 56.67 → "57".
        XCTAssertEqual(TemperatureMetricsMath.percentOfMax(98, maxTempC: 150, localeIdentifier: "en_US"), "65")
        XCTAssertEqual(TemperatureMetricsMath.percentOfMax(132, maxTempC: 150, localeIdentifier: "en_US"), "88")
        XCTAssertEqual(TemperatureMetricsMath.percentOfMax(34, maxTempC: 60, localeIdentifier: "en_US"), "57")
    }

    func testPercentOfMaxGuardsNonPositiveCeiling() {
        XCTAssertEqual(TemperatureMetricsMath.percentOfMax(50, maxTempC: 0, localeIdentifier: "en_US"), "0")
    }

    private func inline(_ celsius: Double?, _ unit: DrivetrainTemperatureUnit) -> String {
        TemperatureMetricsMath.temperatureInline(celsius, unit: unit, precision: nil, localeIdentifier: "en_US")
    }
}

// MARK: - Adapter: projection (web parity)

final class TemperatureMetricsProjectionTests: XCTestCase {
    private let celsius = TemperatureMetricsUnitPrefs(temperature: .celsius, localeIdentifier: "en_US")
    private let fahrenheit = TemperatureMetricsUnitPrefs(temperature: .fahrenheit, localeIdentifier: "en_US")

    private func sampleInput(_ health: DrivetrainHealthStatus = .warning) -> TemperatureMetricsInput {
        TemperatureMetricsInput(
            frontMotorTempC: 98.0,
            rearMotorTempC: 132.0,
            inverterTempC: 71.5,
            batteryTempC: 34.0,
            overallHealth: health,
            healthScore: health.score,
            peakPowerKw: 285
        )
    }

    func testCardCountOrderAndIdentity() {
        let cards = TemperatureMetricsProjection.cards(from: sampleInput(), prefs: celsius)
        XCTAssertEqual(cards.count, 6)
        XCTAssertEqual(
            cards.map(\.id),
            ["frontMotor", "rearMotor", "inverter", "battery", "healthScore", "peakPower"]
        )
    }

    func testSensorCatalogMatchesWeb() {
        // Parity guard: ceilings + icons the web `sensors` array hardcodes.
        XCTAssertEqual(TemperatureMetricsProjection.sensors.map(\.maxTempC), [150, 150, 120, 60])
        XCTAssertEqual(
            TemperatureMetricsProjection.sensors.map(\.systemImage),
            ["bolt.fill", "bolt.fill", "cpu", "battery.100.bolt"]
        )
    }

    func testCelsiusValuesMatchWeb() {
        let cards = TemperatureMetricsProjection.cards(from: sampleInput(), prefs: celsius)
        XCTAssertEqual(cards[0].value, "98.0°C")
        XCTAssertEqual(cards[1].value, "132.0°C")
        XCTAssertEqual(cards[2].value, "71.5°C")
        XCTAssertEqual(cards[3].value, "34.0°C")
        XCTAssertEqual(cards[4].value, "60%") // warning → HEALTH_SCORE 60
        XCTAssertEqual(cards[5].value, "285 kW")
    }

    func testFahrenheitValuesMatchWeb() {
        let cards = TemperatureMetricsProjection.cards(from: sampleInput(), prefs: fahrenheit)
        XCTAssertEqual(cards[0].value, "208.4°F") // 98 °C
        XCTAssertEqual(cards[3].value, "93.2°F") // 34 °C
        // The percentage subtitle stays a RAW Celsius ratio regardless of display unit.
        XCTAssertEqual(cards[0].subtitle, .percentOfMax("65"))
        XCTAssertEqual(cards[3].subtitle, .percentOfMax("57"))
    }

    func testSubtitlesAndAccents() {
        let cards = TemperatureMetricsProjection.cards(from: sampleInput(), prefs: celsius)
        XCTAssertEqual(cards[0].subtitle, .percentOfMax("65")) // 0.653 → amber
        XCTAssertEqual(cards[1].subtitle, .percentOfMax("88")) // 0.88 → red
        XCTAssertEqual(cards[2].subtitle, .percentOfMax("60")) // 0.596 → green
        XCTAssertEqual(cards.map(\.accent), [.amber, .red, .green, .green, .amber, .purple])
    }

    func testHealthCardAccentTracksVerdict() {
        XCTAssertEqual(TemperatureMetricsProjection.healthCard(sampleInput(.good)).value, "95%")
        XCTAssertEqual(TemperatureMetricsProjection.healthCard(sampleInput(.good)).accent, .green)
        XCTAssertEqual(TemperatureMetricsProjection.healthCard(sampleInput(.warning)).accent, .amber)
        XCTAssertEqual(TemperatureMetricsProjection.healthCard(sampleInput(.critical)).value, "25%")
        XCTAssertEqual(TemperatureMetricsProjection.healthCard(sampleInput(.critical)).accent, .red)
    }

    func testPeakPowerCardEmDashWhenNonPositive() {
        let zero = TemperatureMetricsInput(overallHealth: .good, healthScore: 95, peakPowerKw: 0)
        XCTAssertEqual(TemperatureMetricsProjection.peakPowerCard(zero, prefs: celsius).value, "—")
        let big = TemperatureMetricsInput(overallHealth: .good, healthScore: 95, peakPowerKw: 1234.5)
        XCTAssertEqual(TemperatureMetricsProjection.peakPowerCard(big, prefs: celsius).value, "1,235 kW")
    }

    func testNeonAccentThresholds() {
        XCTAssertEqual(TemperatureMetricsProjection.neonAccent(for: nil, maxTempC: 150), .green)
        XCTAssertEqual(TemperatureMetricsProjection.neonAccent(for: 128, maxTempC: 150), .red) // 0.853
        XCTAssertEqual(TemperatureMetricsProjection.neonAccent(for: 105, maxTempC: 150), .amber) // 0.70
        XCTAssertEqual(TemperatureMetricsProjection.neonAccent(for: 60, maxTempC: 150), .green) // 0.40
        XCTAssertEqual(TemperatureMetricsProjection.neonAccent(for: 127.5, maxTempC: 150), .red) // exactly 0.85
        XCTAssertEqual(TemperatureMetricsProjection.neonAccent(for: 97.5, maxTempC: 150), .amber) // exactly 0.65
    }

    func testNilInputRendersEmDashSensorsAndDefaults() {
        let cards = TemperatureMetricsProjection.cards(from: nil, prefs: celsius)
        XCTAssertEqual(cards.count, 6)
        for index in 0 ..< 4 {
            XCTAssertEqual(cards[index].value, TemperatureMetricsProjection.emDash)
            XCTAssertEqual(cards[index].subtitle, .noData)
            XCTAssertEqual(cards[index].accent, .green) // tempNeonColor(null) → green
        }
        XCTAssertEqual(cards[4].value, "95%") // default health good
        XCTAssertEqual(cards[5].value, TemperatureMetricsProjection.emDash) // peak 0 → em-dash
    }

    func testPartialInputEmDashesOnlyMissingSensors() {
        let input = TemperatureMetricsInput(
            frontMotorTempC: nil,
            rearMotorTempC: 132.0,
            inverterTempC: nil,
            batteryTempC: 34.0,
            overallHealth: .good,
            healthScore: 95,
            peakPowerKw: 0
        )
        let cards = TemperatureMetricsProjection.cards(from: input, prefs: celsius)
        XCTAssertEqual(cards[0].value, TemperatureMetricsProjection.emDash)
        XCTAssertEqual(cards[0].subtitle, .noData)
        XCTAssertEqual(cards[1].value, "132.0°C")
        XCTAssertEqual(cards[2].value, TemperatureMetricsProjection.emDash)
        XCTAssertEqual(cards[3].value, "34.0°C")
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(TemperatureMetricsProjection.resolvePhase(.loading, hasValue: false), .loading)
        XCTAssertEqual(TemperatureMetricsProjection.resolvePhase(.loading, hasValue: true), .content)
        XCTAssertEqual(TemperatureMetricsProjection.resolvePhase(.empty, hasValue: false), .empty)
        XCTAssertEqual(TemperatureMetricsProjection.resolvePhase(.empty, hasValue: true), .empty)
        XCTAssertEqual(TemperatureMetricsProjection.resolvePhase(.loaded, hasValue: false), .empty)
        XCTAssertEqual(TemperatureMetricsProjection.resolvePhase(.loaded, hasValue: true), .content)
        XCTAssertEqual(TemperatureMetricsProjection.resolvePhase(.failed("e"), hasValue: false), .error("e"))
        XCTAssertEqual(TemperatureMetricsProjection.resolvePhase(.failed("e"), hasValue: true), .content)
    }
}

// MARK: - State holder: phases + refresh + telemetry

@MainActor
final class TemperatureMetricCardsModelTests: XCTestCase {
    private func makeModel(
        _ update: TemperatureMetricsUpdate,
        telemetry: TemperatureMetricsTelemetry = OSLogTemperatureMetricsTelemetry()
    ) -> (TemperatureMetricCardsModel, InMemoryTemperatureMetricsSource) {
        let source = InMemoryTemperatureMetricsSource(initial: update)
        let model = TemperatureMetricCardsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func sampleInput() -> TemperatureMetricsInput {
        TemperatureMetricsInput(
            frontMotorTempC: 98.0,
            rearMotorTempC: 132.0,
            inverterTempC: 71.5,
            batteryTempC: 34.0,
            overallHealth: .warning,
            healthScore: 60,
            peakPowerKw: 285
        )
    }

    private func loaded(_ connection: TemperatureMetricsConnection = .live) -> TemperatureMetricsUpdate {
        TemperatureMetricsUpdate(
            status: .loaded,
            input: sampleInput(),
            unitPrefs: TemperatureMetricsUnitPrefs(temperature: .celsius, localeIdentifier: "en_US"),
            connection: connection,
            updatedAt: Date()
        )
    }

    func testInitialContentPhaseAndCards() {
        let (model, _) = makeModel(loaded())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.cards.count, 6)
        XCTAssertEqual(model.cards[0].value, "98.0°C")
    }

    func testLoadingAndErrorPhases() {
        let (loading, _) = makeModel(TemperatureMetricsUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (failed, _) = makeModel(TemperatureMetricsUpdate(status: .failed("boom")))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
    }

    func testEmptyPhaseStillProjectsCards() {
        let (model, _) = makeModel(TemperatureMetricsUpdate(status: .empty, input: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.cards.count, 6)
        XCTAssertEqual(model.cards[0].value, TemperatureMetricsProjection.emDash)
    }

    func testCachedInputStaysContentWhileFailing() {
        let (model, source) = makeModel(loaded())
        model.start()
        source.push(
            TemperatureMetricsUpdate(
                status: .failed("net"),
                input: sampleInput(),
                unitPrefs: TemperatureMetricsUnitPrefs(temperature: .celsius),
                connection: .stale
            )
        )
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .stale)
    }

    func testRefreshDelegates() {
        let (model, source) = makeModel(loaded())
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshFiresOncePerEpisode() {
        let (model, source) = makeModel(loaded(.live))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(loaded(.stale))
        source.push(loaded(.stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(loaded(.live))
        source.push(loaded(.stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyTemperatureMetricsTelemetry()
        let (model, source) = makeModel(TemperatureMetricsUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [TemperatureMetricCards.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testConnectionAndRefreshingTrackUpdates() {
        let (model, source) = makeModel(TemperatureMetricsUpdate(status: .loading))
        model.start()
        source.push(
            TemperatureMetricsUpdate(
                status: .loaded,
                input: sampleInput(),
                unitPrefs: TemperatureMetricsUnitPrefs(temperature: .celsius),
                refreshing: true,
                connection: .offline,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.refreshing)
        XCTAssertNotNil(model.updatedAt)
    }
}

// MARK: - Accessibility summary

final class TemperatureMetricsAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testSensorCardSummaryReadsLabelValuePercent() {
        let card = TemperatureMetricCardModel(
            id: "frontMotor",
            labelKey: "drivetrain.frontMotor",
            labelFallback: "Front Motor",
            value: "98.0°C",
            subtitle: .percentOfMax("65"),
            systemImage: "bolt.fill",
            accent: .amber
        )
        let summary = TemperatureMetricsAccessibility.cardSummary(card, localize: echo)
        XCTAssertEqual(summary, "Front Motor, 98.0°C, 65% of max")
    }

    func testNoDataCardSummaryReadsNoData() {
        let card = TemperatureMetricCardModel(
            id: "inverter",
            labelKey: "drivetrain.inverter",
            labelFallback: "Inverter",
            value: TemperatureMetricsProjection.emDash,
            subtitle: .noData,
            systemImage: "cpu",
            accent: .green
        )
        let summary = TemperatureMetricsAccessibility.cardSummary(card, localize: echo)
        XCTAssertEqual(summary, "Inverter, —, No data")
    }

    func testHealthCardSummaryHasNoSubtitle() {
        let card = TemperatureMetricsProjection.healthCard(
            TemperatureMetricsInput(overallHealth: .good, healthScore: 95, peakPowerKw: 0)
        )
        let summary = TemperatureMetricsAccessibility.cardSummary(card, localize: echo)
        XCTAssertEqual(summary, "Health Score, 95%")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyTemperatureMetricsTelemetry: TemperatureMetricsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
