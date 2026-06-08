//
//  BatteryTab.Tests.swift
//  TeslaSync — P4 feature view · 0052 · BatteryTab (Apple)
//
//  Unit coverage for the BatteryTab surface:
//    • Adapter (cached → projection) — distance/energy conversion + number/energy formatting +
//      `date.slice(5)` + the five metric-card projections (value / label / subtitle / tone / icon) +
//      the chart-point projection (index, short label, km→unit range) + the chart axis domains,
//      all parity with the web `safe`, `convertDistanceFromSI`, `formatEnergy`, and `fmtNumber` rules.
//    • State holder — `BatteryTabModel` phase resolution across loading / empty / error / content,
//      cached-stays-content on failure, the refresh delegation, the stale auto-refresh, and the
//      P1/S11 `view.opened` telemetry.
//    • Accessibility — the VoiceOver metrics summary.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryBatteryTabSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: conversion / formatting / projection (web parity)

@MainActor
final class BatteryTabAdapterTests: XCTestCase {
    private let locale = "en_US"

    func testDistanceConversionMatchesWebFactors() {
        XCTAssertEqual(convertBatteryDistanceFromSI(1000, to: .kilometers), 1, accuracy: 1e-9)
        XCTAssertEqual(convertBatteryDistanceFromSI(1609.344, to: .miles), 1, accuracy: 1e-9)
        // Non-finite collapses to 0 (web `safe`).
        XCTAssertEqual(convertBatteryDistanceFromSI(.nan, to: .miles), 0, accuracy: 1e-9)
    }

    func testEnergyConversionMatchesWebFactors() {
        XCTAssertEqual(convertBatteryEnergyFromSI(1000, to: .kilowattHours), 1, accuracy: 1e-9)
        XCTAssertEqual(convertBatteryEnergyFromSI(1000, to: .wattHours), 1000, accuracy: 1e-9)
        XCTAssertEqual(convertBatteryEnergyFromSI(.infinity, to: .kilowattHours), 0, accuracy: 1e-9)
    }

    func testSafeNumberGuards() {
        XCTAssertEqual(BatteryTabFormat.safeNumber(5), 5, accuracy: 1e-9)
        XCTAssertEqual(BatteryTabFormat.safeNumber(.nan), 0, accuracy: 1e-9)
        XCTAssertEqual(BatteryTabFormat.safeNumber(.infinity), 0, accuracy: 1e-9)
    }

    func testNumberAndIntegerFormatting() {
        XCTAssertEqual(BatteryTabFormat.number(1234.5, decimals: 1, localeIdentifier: locale), "1,234.5")
        XCTAssertEqual(BatteryTabFormat.number(2.5, decimals: 2, localeIdentifier: locale), "2.50")
        XCTAssertEqual(BatteryTabFormat.integer(1234, localeIdentifier: locale), "1,234")
        // Non-finite collapses to 0 before formatting.
        XCTAssertEqual(BatteryTabFormat.number(.nan, decimals: 0, localeIdentifier: locale), "0")
    }

    func testEnergyFormattingJoinsValueAndSymbol() {
        XCTAssertEqual(
            BatteryTabFormat.energy(75000, unit: .kilowattHours, decimals: 1, localeIdentifier: locale),
            "75.0 kWh"
        )
        XCTAssertEqual(
            BatteryTabFormat.energy(500, unit: .wattHours, decimals: 0, localeIdentifier: locale),
            "500 Wh"
        )
    }

    func testShortDateLabelSlicesYear() {
        XCTAssertEqual(BatteryTabProjector.shortDateLabel("2026-05-01"), "05-01")
        XCTAssertEqual(BatteryTabProjector.shortDateLabel("abc"), "abc")
    }

    func testMetricsProjectionValuesLabelsTonesIcons() {
        let latest = BatteryTrendPointDTO(
            date: "2026-05-01",
            healthScore: 95.0,
            capacityWh: 75000,
            degradationPct: 2.5,
            rangeKm: 500,
            cycleCount: 120
        )
        let units = BatteryUnitPrefs(distance: .miles, energy: .kilowattHours, localeIdentifier: locale)
        let metrics = BatteryTabProjector.metrics(latest: latest, units: units)

        XCTAssertEqual(metrics.map(\.id), ["health-score", "capacity", "degradation", "est-range", "cycles"])
        XCTAssertEqual(metrics[0].value, "95.0")
        XCTAssertEqual(metrics[0].subtitle, "%")
        XCTAssertEqual(metrics[0].tone, .success)
        XCTAssertEqual(metrics[0].systemImage, "heart.fill")
        XCTAssertEqual(metrics[0].label, "Health Score")
        XCTAssertEqual(metrics[1].value, "75.0 kWh")
        XCTAssertEqual(metrics[1].tone, .info)
        XCTAssertEqual(metrics[2].value, "2.50")
        XCTAssertEqual(metrics[2].tone, .warning)
        // 500 km → 500000 m ÷ 1609.344 = 310.69 → "311"; subtitle is the active distance unit.
        XCTAssertEqual(metrics[3].value, "311")
        XCTAssertEqual(metrics[3].subtitle, "mi")
        XCTAssertEqual(metrics[3].tone, .accent)
        XCTAssertEqual(metrics[4].value, "120")
        XCTAssertEqual(metrics[4].subtitle, "")
    }

    func testMetricsProjectionEmDashWhenNoLatest() {
        let metrics = BatteryTabProjector.metrics(latest: nil, units: BatteryUnitPrefs(localeIdentifier: locale))
        XCTAssertEqual(metrics.count, 5)
        XCTAssertTrue(metrics.allSatisfy { $0.value == BatteryTabProjector.emDash })
    }

    func testChartPointProjectionConvertsRangeAndShortLabels() {
        let trend = [
            BatteryTrendPointDTO(
                date: "2026-04-01", healthScore: 99, capacityWh: 75000,
                degradationPct: 1, rangeKm: 505, cycleCount: 96
            ),
            BatteryTrendPointDTO(
                date: "2026-04-08", healthScore: 98, capacityWh: 74600,
                degradationPct: 2, rangeKm: 498, cycleCount: 104
            )
        ]
        let projKm = BatteryTabProjector.project(trend: trend, units: BatteryUnitPrefs(distance: .kilometers))
        XCTAssertEqual(projKm.chart.points.count, 2)
        XCTAssertEqual(projKm.chart.points[0].index, 0)
        XCTAssertEqual(projKm.chart.points[0].shortLabel, "04-01")
        XCTAssertEqual(projKm.chart.points[0].rangeDisplay, 505, accuracy: 1e-6)
        XCTAssertEqual(projKm.distanceSymbol, "km")
        XCTAssertEqual(projKm.energySymbol, "kWh")

        let projMi = BatteryTabProjector.project(trend: trend, units: BatteryUnitPrefs(distance: .miles))
        XCTAssertEqual(projMi.chart.points[0].rangeDisplay, 505_000 / 1609.344, accuracy: 1e-6)
        XCTAssertEqual(projMi.distanceSymbol, "mi")
    }

    func testChartDomains() {
        let trend = [
            BatteryTrendPointDTO(
                date: "2026-04-01", healthScore: 99, capacityWh: 75000,
                degradationPct: 1, rangeKm: 505, cycleCount: 100
            ),
            BatteryTrendPointDTO(
                date: "2026-04-08", healthScore: 98, capacityWh: 74600,
                degradationPct: 5, rangeKm: 498, cycleCount: 150
            )
        ]
        let chart = BatteryTabProjector.project(trend: trend, units: BatteryUnitPrefs()).chart
        XCTAssertEqual(chart.healthDomain, 80 ... 100)
        XCTAssertEqual(chart.degradationMax, 5 * 1.1, accuracy: 1e-9)
        XCTAssertEqual(chart.cycleMax, 150 * 1.1, accuracy: 1e-9)
    }

    func testChartDomainsFallBackToOneWhenAllZero() {
        let chart = BatteryChartData(points: [], distanceSymbol: "km")
        XCTAssertEqual(chart.degradationMax, 1, accuracy: 1e-9)
        XCTAssertEqual(chart.cycleMax, 1, accuracy: 1e-9)
    }
}

// MARK: - State holder: phases + projection + refresh + telemetry

@MainActor
final class BatteryTabModelTests: XCTestCase {
    private func sampleTrend() -> [BatteryTrendPointDTO] {
        [
            BatteryTrendPointDTO(
                date: "2026-05-01", healthScore: 95, capacityWh: 75000,
                degradationPct: 2.5, rangeKm: 500, cycleCount: 120
            )
        ]
    }

    private func makeModel(
        _ update: BatteryTabUpdate,
        telemetry: BatteryTabTelemetry = OSLogBatteryTabTelemetry()
    ) -> (BatteryTabModel, InMemoryBatteryTabSource) {
        let source = InMemoryBatteryTabSource(initial: update)
        let model = BatteryTabModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(BatteryTabModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(BatteryTabModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(BatteryTabModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(BatteryTabModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(BatteryTabModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(BatteryTabModel.resolvePhase(status: .failed("e"), hasData: false), .error("e"))
        XCTAssertEqual(BatteryTabModel.resolvePhase(status: .failed("e"), hasData: true), .content)
    }

    func testContentPhaseBuildsProjection() {
        let (model, _) = makeModel(BatteryTabUpdate(status: .loaded, trend: sampleTrend()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.metrics.count, 5)
        XCTAssertEqual(model.projection?.chart.points.count, 1)
    }

    func testEmptyAndLoadingAndErrorPhases() {
        let (empty, _) = makeModel(BatteryTabUpdate(status: .loaded, trend: []))
        empty.start()
        XCTAssertEqual(empty.phase, .empty)
        XCTAssertNil(empty.projection)

        let (loading, _) = makeModel(BatteryTabUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (failed, _) = makeModel(BatteryTabUpdate(status: .failed("boom")))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
        XCTAssertNil(failed.projection)
    }

    func testCachedTrendStaysContentWhileFailing() {
        let (model, source) = makeModel(BatteryTabUpdate(status: .loaded, trend: sampleTrend()))
        model.start()
        source.push(BatteryTabUpdate(status: .failed("net"), connection: .offline, trend: sampleTrend()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .offline)
        XCTAssertNotNil(model.projection)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(BatteryTabUpdate(status: .loaded, trend: sampleTrend()))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshFiresOncePerEpisode() {
        let (model, source) = makeModel(BatteryTabUpdate(status: .loaded, trend: sampleTrend()))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(BatteryTabUpdate(status: .loaded, connection: .stale, trend: sampleTrend()))
        source.push(BatteryTabUpdate(status: .loaded, connection: .stale, trend: sampleTrend()))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(BatteryTabUpdate(status: .loaded, connection: .live, trend: sampleTrend()))
        source.push(BatteryTabUpdate(status: .loaded, connection: .stale, trend: sampleTrend()))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshSuppressedWhileFetching() {
        let (model, source) = makeModel(BatteryTabUpdate(status: .loaded, trend: sampleTrend()))
        model.start()
        source.push(
            BatteryTabUpdate(status: .loaded, connection: .stale, isFetching: true, trend: sampleTrend())
        )
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyBatteryTabTelemetry()
        let (model, source) = makeModel(BatteryTabUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [BatteryTabSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testConnectionAndFetchingTrackUpdates() {
        let (model, source) = makeModel(BatteryTabUpdate(status: .loading))
        model.start()
        source.push(
            BatteryTabUpdate(
                status: .loaded, connection: .offline, isFetching: true,
                trend: sampleTrend(), updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.isFetching)
        XCTAssertNotNil(model.updatedAt)
    }

    func testStopDelegatesToSource() {
        let (model, source) = makeModel(BatteryTabUpdate(status: .loading))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Accessibility summary

@MainActor
final class BatteryTabAccessibilityTests: XCTestCase {
    func testMetricsSummaryIncludesLabelsValuesAndUnits() {
        let latest = BatteryTrendPointDTO(
            date: "2026-05-01", healthScore: 95, capacityWh: 75000,
            degradationPct: 2.5, rangeKm: 500, cycleCount: 120
        )
        let units = BatteryUnitPrefs(distance: .miles, energy: .kilowattHours, localeIdentifier: "en_US")
        let metrics = BatteryTabProjector.metrics(latest: latest, units: units)
        let summary = BatteryTabAccessibility.metricsSummary(for: metrics)
        XCTAssertTrue(summary.contains("Battery"))
        XCTAssertTrue(summary.contains("Health Score 95.0 %"))
        XCTAssertTrue(summary.contains("Capacity 75.0 kWh"))
        XCTAssertTrue(summary.contains("Cycles 120"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyBatteryTabTelemetry: BatteryTabTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
