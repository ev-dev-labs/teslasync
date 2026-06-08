//
//  TemperatureTrendChart.Tests.swift
//  TeslaSync — P4 feature view · 0162 · TemperatureTrendChart (Apple)
//
//  Unit coverage for the TemperatureTrendChart surface:
//    • Adapter (`TemperatureTrendProjector` + conversion) — the SI→display temperature
//      conversion (°C identity, °F = c·9/5+32), the finite-number guard, the indexed
//      drive points (with gaps for missing readings), the converted Warm Zone (35 °C)
//      / Freezing (0 °C) reference thresholds, the `data.length <= 1` content/empty
//      gate, and phase resolution (parity with the web component's render data).
//    • Formatting (`TemperatureTrendFormat`) — locale-aware decimal + unit strings.
//    • State holder (`TemperatureTrendChartModel`) — phase across loading / loaded /
//      empty / failed, the applied unit preference, the P1/S11 `view.opened` telemetry
//      (once), the stale auto-refresh (exactly once), and offline keeping the trend.
//    • Accessibility — the chart summary + per-point VoiceOver value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: conversion

final class TemperatureTrendConversionTests: XCTestCase {
    func testCelsiusIsIdentity() {
        XCTAssertEqual(convertTemperatureTrendFromSI(0, to: .celsius), 0, accuracy: 0.0001)
        XCTAssertEqual(convertTemperatureTrendFromSI(21.5, to: .celsius), 21.5, accuracy: 0.0001)
        XCTAssertEqual(convertTemperatureTrendFromSI(-12.3, to: .celsius), -12.3, accuracy: 0.0001)
    }

    func testFahrenheitMatchesWebFormula() {
        // Web `convertTempFromSI(c, '°F') == c * 9 / 5 + 32`.
        XCTAssertEqual(convertTemperatureTrendFromSI(0, to: .fahrenheit), 32, accuracy: 0.0001)
        XCTAssertEqual(convertTemperatureTrendFromSI(100, to: .fahrenheit), 212, accuracy: 0.0001)
        XCTAssertEqual(convertTemperatureTrendFromSI(35, to: .fahrenheit), 95, accuracy: 0.0001)
        XCTAssertEqual(convertTemperatureTrendFromSI(-40, to: .fahrenheit), -40, accuracy: 0.0001)
    }

    func testSafeGuardDropsNonFinite() {
        XCTAssertEqual(temperatureTrendSafe(21.0), 21.0)
        XCTAssertNil(temperatureTrendSafe(nil))
        XCTAssertNil(temperatureTrendSafe(.nan))
        XCTAssertNil(temperatureTrendSafe(.infinity))
    }

    func testUnitFromSymbol() {
        XCTAssertEqual(TemperatureTrendUnit.from(symbol: "°C"), .celsius)
        XCTAssertEqual(TemperatureTrendUnit.from(symbol: "°F"), .fahrenheit)
        XCTAssertEqual(TemperatureTrendUnit.from(symbol: "K"), .celsius)
    }
}

// MARK: - Adapter: projection

final class TemperatureTrendProjectorTests: XCTestCase {
    private let samples: [TemperatureTrendSample] = [
        TemperatureTrendSample(date: "Jun 1", outsideTempC: 20),
        TemperatureTrendSample(date: "Jun 3", outsideTempC: nil),
        TemperatureTrendSample(date: "Jun 5", outsideTempC: -5)
    ]

    func testPointsCarryIndexDateAndConvertedCelsius() {
        let points = TemperatureTrendProjector.points(from: samples, unit: .celsius)
        XCTAssertEqual(points.map(\.index), [0, 1, 2])
        XCTAssertEqual(points.map(\.date), ["Jun 1", "Jun 3", "Jun 5"])
        XCTAssertEqual(points[0].outsideTemp, 20)
        XCTAssertNil(points[1].outsideTemp)
        XCTAssertEqual(points[2].outsideTemp, -5)
    }

    func testPointsConvertToFahrenheit() throws {
        let points = TemperatureTrendProjector.points(from: samples, unit: .fahrenheit)
        let first = try XCTUnwrap(points[0].outsideTemp)
        XCTAssertEqual(first, 68, accuracy: 0.0001)
        XCTAssertNil(points[1].outsideTemp)
        let third = try XCTUnwrap(points[2].outsideTemp)
        XCTAssertEqual(third, 23, accuracy: 0.0001)
    }

    func testThresholdsConvertWarmAndFreezing() {
        let celsius = TemperatureTrendProjector.thresholds(unit: .celsius)
        XCTAssertEqual(celsius.first { $0.kind == .warmZone }?.value, 35)
        XCTAssertEqual(celsius.first { $0.kind == .freezing }?.value, 0)

        let fahrenheit = TemperatureTrendProjector.thresholds(unit: .fahrenheit)
        XCTAssertEqual(fahrenheit.first { $0.kind == .warmZone }?.value, 95)
        XCTAssertEqual(fahrenheit.first { $0.kind == .freezing }?.value, 32)
    }

    func testHasTrendNeedsAtLeastTwoSamples() {
        XCTAssertFalse(TemperatureTrendProjector.hasTrend(sampleCount: 0))
        XCTAssertFalse(TemperatureTrendProjector.hasTrend(sampleCount: 1))
        XCTAssertTrue(TemperatureTrendProjector.hasTrend(sampleCount: 2))
        XCTAssertTrue(TemperatureTrendProjector.hasTrend(sampleCount: 9))
    }

    func testProjectAssemblesEverything() {
        let projection = TemperatureTrendProjector.project(samples: samples, unit: .celsius)
        XCTAssertEqual(projection.points.count, 3)
        XCTAssertEqual(projection.thresholds.count, 2)
        XCTAssertEqual(projection.unitSymbol, "°C")
        XCTAssertTrue(projection.hasTrend)
        XCTAssertEqual(projection.plottablePoints.count, 2)
        XCTAssertEqual(projection.latestReading?.date, "Jun 5")
        XCTAssertEqual(projection.threshold(.warmZone)?.value, 35)
    }

    func testProjectSingleSampleHasNoTrend() {
        let projection = TemperatureTrendProjector.project(
            samples: [TemperatureTrendSample(date: "Jun 5", outsideTempC: 18)],
            unit: .celsius
        )
        XCTAssertFalse(projection.hasTrend)
        XCTAssertEqual(projection.points.count, 1)
    }

    func testResolvePhase() {
        XCTAssertEqual(TemperatureTrendProjector.resolvePhase(.loading, hasTrend: false), .loading)
        XCTAssertEqual(TemperatureTrendProjector.resolvePhase(.loaded, hasTrend: true), .content)
        XCTAssertEqual(TemperatureTrendProjector.resolvePhase(.loaded, hasTrend: false), .empty)
        XCTAssertEqual(TemperatureTrendProjector.resolvePhase(.failed("boom"), hasTrend: true), .error("boom"))
    }

    @MainActor
    func testSurfaceSlug() {
        XCTAssertEqual(TemperatureTrendSurface.slug, "TemperatureTrendChart")
        XCTAssertEqual(TemperatureTrendChart.surfaceSlug, "TemperatureTrendChart")
    }
}

// MARK: - Formatting

final class TemperatureTrendFormatTests: XCTestCase {
    private let posix = "en_US_POSIX"

    func testDecimalRendersUpToOneFractionDigit() {
        XCTAssertEqual(TemperatureTrendFormat.decimal(21.5, localeIdentifier: posix), "21.5")
        XCTAssertEqual(TemperatureTrendFormat.decimal(32.0, localeIdentifier: posix), "32")
        XCTAssertEqual(TemperatureTrendFormat.decimal(-3.14, localeIdentifier: posix), "-3.1")
    }

    func testDecimalNonFiniteIsEmDash() {
        XCTAssertEqual(TemperatureTrendFormat.decimal(.nan, localeIdentifier: posix), "—")
        XCTAssertEqual(TemperatureTrendFormat.decimal(.infinity, localeIdentifier: posix), "—")
    }

    func testTemperatureAppendsUnitAndHandlesNil() {
        XCTAssertEqual(TemperatureTrendFormat.temperature(21.5, unit: "°C", localeIdentifier: posix), "21.5 °C")
        XCTAssertEqual(TemperatureTrendFormat.temperature(95, unit: "°F", localeIdentifier: posix), "95 °F")
        XCTAssertEqual(TemperatureTrendFormat.temperature(nil, unit: "°C", localeIdentifier: posix), "—")
    }
}

// MARK: - State holder: TemperatureTrendChartModel

@MainActor
final class TemperatureTrendChartModelTests: XCTestCase {
    private func makeModel(
        initial: TemperatureTrendUpdate?,
        telemetry: TemperatureTrendChartTelemetry = SpyTemperatureTrendTelemetry()
    ) -> (TemperatureTrendChartModel, InMemoryTemperatureTrendSource) {
        let source = InMemoryTemperatureTrendSource(initial: initial)
        let model = TemperatureTrendChartModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private let trend: [TemperatureTrendSample] = [
        TemperatureTrendSample(date: "Jun 1", outsideTempC: 24),
        TemperatureTrendSample(date: "Jun 3", outsideTempC: 12),
        TemperatureTrendSample(date: "Jun 5", outsideTempC: -2)
    ]

    func testLoadedContentProjectsPoints() {
        let (model, source) = makeModel(initial: TemperatureTrendUpdate(status: .loaded, samples: trend))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.points.count, 3)
        XCTAssertEqual(model.thresholds.count, 2)
        XCTAssertEqual(model.projection.unitSymbol, "°C")
        XCTAssertEqual(model.points.first?.outsideTemp, 24)
        XCTAssertEqual(source.startCount, 1)
    }

    func testFahrenheitPreferenceConvertsAndLabels() throws {
        let update = TemperatureTrendUpdate(
            status: .loaded,
            samples: trend,
            units: TemperatureTrendUnitPrefs(temperature: .fahrenheit)
        )
        let (model, _) = makeModel(initial: update)
        model.start()
        XCTAssertEqual(model.units.temperature, .fahrenheit)
        XCTAssertEqual(model.projection.unitSymbol, "°F")
        let first = try XCTUnwrap(model.points.first?.outsideTemp)
        XCTAssertEqual(first, 75.2, accuracy: 0.0001)
    }

    func testSingleSampleResolvesEmptyPhase() {
        let update = TemperatureTrendUpdate(
            status: .loaded,
            samples: [TemperatureTrendSample(date: "Jun 5", outsideTempC: 18)]
        )
        let (model, _) = makeModel(initial: update)
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadedEmptyResolvesEmptyPhase() {
        let (model, _) = makeModel(initial: TemperatureTrendUpdate(status: .loaded, samples: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: TemperatureTrendUpdate(status: .loading, samples: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: TemperatureTrendUpdate(status: .failed("timeout"), samples: []))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyTemperatureTrendTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [TemperatureTrendSurface.slug])
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(TemperatureTrendUpdate(status: .loaded, samples: trend, connection: .stale))
        source.push(TemperatureTrendUpdate(status: .loaded, samples: trend, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(TemperatureTrendUpdate(status: .loaded, samples: trend, connection: .stale))
        source.push(TemperatureTrendUpdate(status: .loaded, samples: trend, connection: .live))
        source.push(TemperatureTrendUpdate(status: .loaded, samples: trend, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedTrendWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(TemperatureTrendUpdate(status: .loaded, samples: trend, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.points.count, 3)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: TemperatureTrendUpdate(status: .failed("x"), samples: []))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopStopsSource() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Accessibility: VoiceOver summaries

final class TemperatureTrendAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }

    private func projection(unit: TemperatureTrendUnit) -> TemperatureTrendProjection {
        TemperatureTrendProjector.project(
            samples: [
                TemperatureTrendSample(date: "Jun 1", outsideTempC: 24),
                TemperatureTrendSample(date: "Jun 3", outsideTempC: nil),
                TemperatureTrendSample(date: "Jun 5", outsideTempC: -2)
            ],
            unit: unit
        )
    }

    func testChartSummaryIncludesLatestReading() {
        let summary = TemperatureTrendAccessibility.chartSummary(
            projection: projection(unit: .celsius),
            localize: echo,
            localeIdentifier: "en_US_POSIX"
        )
        XCTAssertTrue(summary.contains("Temperature Trend"))
        XCTAssertTrue(summary.contains("2 drives"))
        XCTAssertTrue(summary.contains("Latest"))
        XCTAssertTrue(summary.contains("Jun 5"))
        XCTAssertTrue(summary.contains("Outside Temp -2 °C"))
    }

    func testChartSummaryEmptyWhenNoTrend() {
        let projection = TemperatureTrendProjector.project(
            samples: [TemperatureTrendSample(date: "Jun 5", outsideTempC: 18)],
            unit: .celsius
        )
        let summary = TemperatureTrendAccessibility.chartSummary(projection: projection, localize: echo)
        XCTAssertTrue(summary.contains("Temperature Trend"))
        XCTAssertTrue(summary.contains("No data available"))
    }

    func testPointValueWithReading() {
        let point = TemperatureTrendPoint(index: 0, date: "Jun 1", outsideTemp: 24)
        let value = TemperatureTrendAccessibility.pointValue(
            point,
            unit: "°C",
            localize: echo,
            localeIdentifier: "en_US_POSIX"
        )
        XCTAssertEqual(value, "Jun 1: Outside Temp 24 °C")
    }

    func testPointValueWithoutReading() {
        let point = TemperatureTrendPoint(index: 1, date: "Jun 3", outsideTemp: nil)
        let value = TemperatureTrendAccessibility.pointValue(point, unit: "°C", localize: echo)
        XCTAssertEqual(value, "Jun 3: no reading")
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyTemperatureTrendTelemetry: TemperatureTrendChartTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
