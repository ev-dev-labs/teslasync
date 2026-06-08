//
//  ChargingSection.Tests.swift
//  TeslaSync — P4 feature view · 0074 · ChargingSection (Apple)
//
//  Unit coverage for the ChargingSection surface:
//    • Adapter (`ChargingSectionProjection` + `ChargingFormat`) — bar mapping + clamp, the
//      pctChange parity, the formatted stat tiles, the week-over-week badge
//      (tone + em-dash sentinel), content/empty resolution, and the number/currency
//      formatting (parity with the web `numberFormat` + `formatCurrency`).
//    • State holder (`ChargingSectionModel`) — phase across loading / loaded / empty
//      / failed, the P1/S11 `view.opened` telemetry (once), the stale auto-refresh
//      (exactly once), and offline keeping cached tiles.
//    • Accessibility — the section summary, chart summary, and per-bar VoiceOver
//      value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: projection + formatting

@MainActor
final class ChargingProjectionTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")

    private let daily: [ChargingDailyEnergy] = [
        ChargingDailyEnergy(day: "Mon", energy: 5),
        ChargingDailyEnergy(day: "Tue", energy: -2),
        ChargingDailyEnergy(day: "Wed", energy: 3)
    ]

    private let metrics = ChargingMetrics(
        sessionCount: 1234,
        energyAddedKwh: 42.5,
        avgChargeRateKw: 11.2,
        cost: 18.49,
        prevEnergyKwh: 40
    )

    func testBarsPreserveOrderAndClampNegatives() {
        let bars = ChargingSectionProjection.bars(from: daily)
        XCTAssertEqual(bars.map(\.day), ["Mon", "Tue", "Wed"])
        XCTAssertEqual(bars.map(\.index), [0, 1, 2])
        XCTAssertEqual(bars.map(\.energy), [5, 0, 3])
    }

    func testPctChange() {
        XCTAssertEqual(ChargingSectionProjection.pctChange(current: 120, previous: 100), 20, accuracy: 0.0001)
        XCTAssertEqual(ChargingSectionProjection.pctChange(current: 80, previous: 100), -20, accuracy: 0.0001)
        XCTAssertEqual(ChargingSectionProjection.pctChange(current: 50, previous: 0), 100, accuracy: 0.0001)
        XCTAssertEqual(ChargingSectionProjection.pctChange(current: 0, previous: 0), 0, accuracy: 0.0001)
    }

    func testStatsFormatting() {
        let stats = ChargingSectionProjection.stats(from: metrics, formatting: ChargingFormatting(), locale: posix)
        XCTAssertEqual(stats.map(\.kind), [.sessions, .totalEnergy, .avgRate, .totalCost])
        XCTAssertEqual(stats[0].value, "1,234")
        XCTAssertEqual(stats[1].value, "42.5 kWh")
        XCTAssertEqual(stats[2].value, "11.2 kW")
        XCTAssertEqual(stats[3].value, "$18.49")
    }

    func testStatsRespectCurrencySymbol() {
        let stats = ChargingSectionProjection.stats(
            from: metrics,
            formatting: ChargingFormatting(currencySymbol: "€"),
            locale: posix
        )
        XCTAssertEqual(stats[3].value, "€18.49")
    }

    func testTrendPositiveWhenGreaterOrEqual() {
        let trend = ChargingSectionProjection.trend(from: metrics, locale: posix)
        XCTAssertEqual(trend.tone, .positive)
        XCTAssertEqual(trend.value, "6.3%")
    }

    func testTrendNegativeWhenLess() {
        let lower = ChargingMetrics(
            sessionCount: 1,
            energyAddedKwh: 80,
            avgChargeRateKw: 1,
            cost: 1,
            prevEnergyKwh: 100
        )
        let trend = ChargingSectionProjection.trend(from: lower, locale: posix)
        XCTAssertEqual(trend.tone, .negative)
        XCTAssertEqual(trend.value, "-20.0%")
    }

    func testTrendDashWhenNoPriorBaseline() {
        let fresh = ChargingMetrics(sessionCount: 1, energyAddedKwh: 50, avgChargeRateKw: 1, cost: 1, prevEnergyKwh: 0)
        let trend = ChargingSectionProjection.trend(from: fresh, locale: posix)
        XCTAssertEqual(trend.value, "—")
        XCTAssertEqual(trend.tone, .positive)
    }

    func testHasContent() {
        let empty = ChargingMetrics(sessionCount: 0, energyAddedKwh: 0, avgChargeRateKw: 0, cost: 0, prevEnergyKwh: 0)
        XCTAssertFalse(ChargingSectionProjection.hasContent(metrics: empty, bars: []))
        XCTAssertTrue(ChargingSectionProjection.hasContent(metrics: empty, bars: ChargingSectionProjection.bars(from: daily)))
        let active = ChargingMetrics(sessionCount: 2, energyAddedKwh: 0, avgChargeRateKw: 0, cost: 0, prevEnergyKwh: 0)
        XCTAssertTrue(ChargingSectionProjection.hasContent(metrics: active, bars: []))
        XCTAssertFalse(ChargingSectionProjection.hasContent(metrics: nil, bars: []))
    }

    func testResolvePhase() {
        XCTAssertEqual(ChargingSectionProjection.resolvePhase(.loading, hasContent: false), .loading)
        XCTAssertEqual(ChargingSectionProjection.resolvePhase(.loaded, hasContent: true), .content)
        XCTAssertEqual(ChargingSectionProjection.resolvePhase(.loaded, hasContent: false), .empty)
        XCTAssertEqual(ChargingSectionProjection.resolvePhase(.failed("boom"), hasContent: true), .error("boom"))
    }

    func testTotalEnergy() {
        XCTAssertEqual(ChargingSectionProjection.totalEnergy(ChargingSectionProjection.bars(from: daily)), 8, accuracy: 0.0001)
    }

    func testNumberFormattingParity() {
        XCTAssertEqual(ChargingFormat.number(1234.5, fractionDigits: 1, locale: posix), "1,234.5")
        XCTAssertEqual(ChargingFormat.int(12345.6, locale: posix), "12,346")
        XCTAssertEqual(
            ChargingFormat.currency(18.49, fractionDigits: 2, formatting: ChargingFormatting(), locale: posix),
            "$18.49"
        )
        XCTAssertEqual(ChargingFormat.number(.nan, fractionDigits: 1, locale: posix), "0.0")
    }

    func testSurfaceSlug() {
        XCTAssertEqual(ChargingSurface.slug, "ChargingSection")
        XCTAssertEqual(ChargingSection.surfaceSlug, "ChargingSection")
    }
}

// MARK: - State holder: ChargingSectionModel

@MainActor
final class ChargingSectionModelTests: XCTestCase {
    private func makeModel(
        initial: ChargingUpdate?,
        telemetry: ChargingSectionTelemetry = SpyChargingTelemetry()
    ) -> (ChargingSectionModel, InMemoryChargingSource) {
        let source = InMemoryChargingSource(initial: initial)
        let model = ChargingSectionModel(
            source: source,
            telemetry: telemetry,
            locale: Locale(identifier: "en_US_POSIX")
        )
        return (model, source)
    }

    private let metrics = ChargingMetrics(
        sessionCount: 3,
        energyAddedKwh: 30,
        avgChargeRateKw: 10,
        cost: 5,
        prevEnergyKwh: 20
    )

    private let daily = [
        ChargingDailyEnergy(day: "Mon", energy: 12),
        ChargingDailyEnergy(day: "Tue", energy: 18)
    ]

    func testLoadedContentProjectsBarsStatsTrend() {
        let update = ChargingUpdate(status: .loaded, metrics: metrics, dailyEnergy: daily)
        let (model, source) = makeModel(initial: update)
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.bars.count, 2)
        XCTAssertEqual(model.stats.count, 4)
        XCTAssertEqual(model.trend.tone, .positive)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedEmptyResolvesEmptyPhase() {
        let zero = ChargingMetrics(sessionCount: 0, energyAddedKwh: 0, avgChargeRateKw: 0, cost: 0, prevEnergyKwh: 0)
        let (model, _) = makeModel(initial: ChargingUpdate(status: .loaded, metrics: zero, dailyEnergy: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.bars.isEmpty)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: ChargingUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: ChargingUpdate(status: .failed("timeout")))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyChargingTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ChargingSurface.slug])
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(ChargingUpdate(status: .loaded, metrics: metrics, dailyEnergy: daily, connection: .stale))
        source.push(ChargingUpdate(status: .loaded, metrics: metrics, dailyEnergy: daily, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(ChargingUpdate(status: .loaded, metrics: metrics, dailyEnergy: daily, connection: .stale))
        source.push(ChargingUpdate(status: .loaded, metrics: metrics, dailyEnergy: daily, connection: .live))
        source.push(ChargingUpdate(status: .loaded, metrics: metrics, dailyEnergy: daily, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedTilesWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(ChargingUpdate(status: .loaded, metrics: metrics, dailyEnergy: daily, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.bars.count, 2)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: ChargingUpdate(status: .failed("x")))
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

@MainActor
final class ChargingSectionAccessibilityTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")

    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testSectionSummaryIncludesStats() {
        let metrics = ChargingMetrics(
            sessionCount: 9,
            energyAddedKwh: 42.5,
            avgChargeRateKw: 11.2,
            cost: 18.49,
            prevEnergyKwh: 40
        )
        let stats = ChargingSectionProjection.stats(from: metrics, formatting: ChargingFormatting(), locale: posix)
        let summary = ChargingSectionAccessibility.sectionSummary(stats: stats, localize: echo)
        XCTAssertTrue(summary.contains("Charging"))
        XCTAssertTrue(summary.contains("Sessions 9"))
        XCTAssertTrue(summary.contains("Total Energy Added 42.5 kWh"))
        XCTAssertTrue(summary.contains("Total Cost $18.49"))
    }

    func testChartSummaryIncludesTotal() {
        let bars = ChargingSectionProjection.bars(from: [
            ChargingDailyEnergy(day: "Mon", energy: 5),
            ChargingDailyEnergy(day: "Tue", energy: 3)
        ])
        let summary = ChargingSectionAccessibility.chartSummary(bars: bars, localize: echo, locale: posix)
        XCTAssertTrue(summary.contains("Daily Energy Added (kWh)"))
        XCTAssertTrue(summary.contains("2 days"))
        XCTAssertTrue(summary.contains("8.0 kWh"))
        XCTAssertTrue(summary.contains("Energy Added"))
    }

    func testChartSummaryEmpty() {
        let summary = ChargingSectionAccessibility.chartSummary(bars: [], localize: echo, locale: posix)
        XCTAssertTrue(summary.contains("Daily Energy Added (kWh)"))
        XCTAssertTrue(summary.contains("No data available"))
    }

    func testBarLabel() {
        let bar = ChargingEnergyBar(index: 0, day: "Mon", energy: 5)
        XCTAssertEqual(ChargingSectionAccessibility.barLabel(bar, localize: echo, locale: posix), "Mon: 5.0 kWh Energy Added")
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyChargingTelemetry: ChargingSectionTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
