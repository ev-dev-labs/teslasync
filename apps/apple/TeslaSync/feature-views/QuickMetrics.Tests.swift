//
//  QuickMetrics.Tests.swift
//  TeslaSync — P4 feature view · 0105 · QuickMetrics (Apple)
//
//  Unit coverage for the QuickMetrics surface:
//    • Adapter (cached → projection) — `QuickMetricsFormat` number / count / currency / unit /
//      duration parity with the web `fmtNumber` / `<AnimatedNumber>` / `<Currency>` /
//      `fmtWithUnit` / `formatDurationMinutes`, and `QuickMetricsProjection` six-tile projection
//      (order, values, tones, icons, animation flags) + content/empty/loading/error phase
//      resolution.
//    • State holder — `QuickMetricsModel` phase across loading / loaded / empty / failed, the
//      P1/S11 `view.opened` telemetry (once), the stale auto-refresh (once, re-armed on live),
//      and offline keeping cached metrics.
//    • Accessibility — the section summary + per-tile VoiceOver value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no bundle: the
//  adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: formatting (web fmtNumber / Currency / fmtWithUnit / formatDuration parity)

final class QuickMetricsFormatTests: XCTestCase {
    private let enUS = Locale(identifier: "en-US")

    func testCountGroupsThousands() {
        XCTAssertEqual(QuickMetricsFormat.count(1234, locale: enUS), "1,234")
        XCTAssertEqual(QuickMetricsFormat.count(7, locale: enUS), "7")
        XCTAssertEqual(QuickMetricsFormat.count(0, locale: enUS), "0")
    }

    func testNumberRoundsHalfAwayAndGuardsNonFinite() {
        XCTAssertEqual(QuickMetricsFormat.number(25.1149, decimals: 2, locale: enUS), "25.11")
        XCTAssertEqual(QuickMetricsFormat.number(1234.5, decimals: 0, locale: enUS), "1,235")
        XCTAssertEqual(QuickMetricsFormat.number(.nan, decimals: 2, locale: enUS), "0.00")
        XCTAssertEqual(QuickMetricsFormat.number(.infinity, decimals: 0, locale: enUS), "0")
    }

    func testNumberIsLocaleAware() {
        XCTAssertEqual(QuickMetricsFormat.number(1234.5, decimals: 1, locale: enUS), "1,234.5")
        // de-DE swaps the grouping/decimal separators (comma is the decimal mark).
        let de = QuickMetricsFormat.number(1234.5, decimals: 1, locale: Locale(identifier: "de-DE"))
        XCTAssertTrue(de.contains(",5"), "expected a decimal comma in de-DE, got \(de)")
        XCTAssertNotEqual(de, "1,234.5")
    }

    func testCurrencyPrefixesSymbolAtZeroPrecision() {
        XCTAssertEqual(QuickMetricsFormat.currency(51.0, symbol: "$", locale: enUS), "$51")
        XCTAssertEqual(QuickMetricsFormat.currency(1234.5, symbol: "$", locale: enUS), "$1,235")
        XCTAssertEqual(QuickMetricsFormat.currency(51.0, symbol: "€", locale: enUS), "€51")
    }

    func testCurrencyNonFiniteYieldsEmDashWithoutSymbol() {
        XCTAssertEqual(QuickMetricsFormat.currency(.nan, symbol: "$", locale: enUS), QuickMetricsFormat.emDash)
        XCTAssertEqual(QuickMetricsFormat.currency(.infinity, symbol: "$", locale: enUS), QuickMetricsFormat.emDash)
    }

    func testWithUnitAppendsSpaceAndUnit() {
        XCTAssertEqual(QuickMetricsFormat.withUnit(50, unit: "kWh", decimals: 2, locale: enUS), "50.00 kWh")
        XCTAssertEqual(QuickMetricsFormat.withUnit(25.1149, unit: "kWh", decimals: 2, locale: enUS), "25.11 kWh")
        XCTAssertEqual(QuickMetricsFormat.withUnit(.nan, unit: "kWh", decimals: 2, locale: enUS), "0.00 kWh")
    }

    func testDurationMatchesWebFormatDurationMinutes() {
        XCTAssertEqual(QuickMetricsFormat.duration(minutes: 90), "1h 30m")
        XCTAssertEqual(QuickMetricsFormat.duration(minutes: 2186), "36h 26m")
        XCTAssertEqual(QuickMetricsFormat.duration(minutes: 60), "1h 0m")
        XCTAssertEqual(QuickMetricsFormat.duration(minutes: 59), "59m")
        XCTAssertEqual(QuickMetricsFormat.duration(minutes: 0), "0m")
        XCTAssertEqual(QuickMetricsFormat.duration(minutes: 125), "2h 5m")
    }

    func testDurationRoundsRemainderHalfAwayFromZero() {
        XCTAssertEqual(QuickMetricsFormat.duration(minutes: 90.6), "1h 31m")
        XCTAssertEqual(QuickMetricsFormat.duration(minutes: 30.4), "30m")
    }

    func testDurationFallbackForInvalidInput() {
        XCTAssertEqual(QuickMetricsFormat.duration(minutes: -5), QuickMetricsFormat.emDash)
        XCTAssertEqual(QuickMetricsFormat.duration(minutes: .nan), QuickMetricsFormat.emDash)
        XCTAssertEqual(QuickMetricsFormat.duration(minutes: .infinity), QuickMetricsFormat.emDash)
    }
}

// MARK: - Adapter: projection (web stats consumer parity)

final class QuickMetricsProjectionTests: XCTestCase {
    private let enUS = Locale(identifier: "en-US")

    private func fullStats() -> QuickMetricsStats {
        QuickMetricsStats(
            totalEnergy: 1180.4,
            totalCost: 612.0,
            totalDuration: 2186,
            homeCount: 31,
            scCount: 12,
            dcCount: 4,
            count: 47
        )
    }

    func testNilStatsProjectsNoTiles() {
        XCTAssertTrue(QuickMetricsProjection.metrics(from: nil, currencySymbol: "$", locale: enUS).isEmpty)
    }

    func testTileOrderToneIconAndAnimationFlags() {
        let metrics = QuickMetricsProjection.metrics(from: fullStats(), currencySymbol: "$", locale: enUS)
        XCTAssertEqual(metrics.count, 6)
        XCTAssertEqual(
            metrics.map(\.id),
            ["home", "supercharger", "dcFast", "totalTime", "monthlyAvg", "perSession"]
        )
        XCTAssertEqual(metrics.map(\.tone), [.success, .danger, .warning, .primary, .primary, .primary])
        XCTAssertEqual(
            metrics.map(\.systemImage),
            ["house.fill", "bolt.fill", "bolt.car.fill", nil, nil, nil]
        )
        XCTAssertEqual(metrics.map(\.animatesValue), [true, true, true, false, false, false])
    }

    func testTileValuesMatchWeb() {
        let metrics = QuickMetricsProjection.metrics(
            from: fullStats(),
            currencySymbol: "$",
            locale: enUS,
            precision: 2
        )
        XCTAssertEqual(metrics[0].value, "31") // Home count
        XCTAssertEqual(metrics[1].value, "12") // Supercharger count
        XCTAssertEqual(metrics[2].value, "4") // DC Fast count
        XCTAssertEqual(metrics[3].value, "36h 26m") // Total Time (2186 min)
        XCTAssertEqual(metrics[4].value, "$51") // Monthly Avg ($612 / 12)
        XCTAssertEqual(metrics[5].value, "25.11 kWh") // Per Session (1180.4 / 47)
    }

    func testPerSessionGuardsZeroSessionCount() {
        let stats = QuickMetricsStats(
            totalEnergy: 500,
            totalCost: 0,
            totalDuration: 0,
            homeCount: 0,
            scCount: 0,
            dcCount: 0,
            count: 0
        )
        let metrics = QuickMetricsProjection.metrics(from: stats, currencySymbol: "$", locale: enUS, precision: 2)
        XCTAssertEqual(metrics[5].value, "0.00 kWh")
    }

    func testCurrencyAndPrecisionFollowPreferences() {
        let metrics = QuickMetricsProjection.metrics(
            from: fullStats(),
            currencySymbol: "€",
            locale: enUS,
            precision: 1
        )
        XCTAssertEqual(metrics[4].value, "€51") // Monthly Avg always 0 dp (web Currency precision=0)
        XCTAssertEqual(metrics[5].value, "25.1 kWh") // Per Session at the global precision (1 dp here)
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(QuickMetricsProjection.resolvePhase(.loading, hasStats: false), .loading)
        XCTAssertEqual(QuickMetricsProjection.resolvePhase(.loading, hasStats: true), .content)
        XCTAssertEqual(QuickMetricsProjection.resolvePhase(.empty, hasStats: false), .empty)
        XCTAssertEqual(QuickMetricsProjection.resolvePhase(.empty, hasStats: true), .empty)
        XCTAssertEqual(QuickMetricsProjection.resolvePhase(.loaded, hasStats: false), .empty)
        XCTAssertEqual(QuickMetricsProjection.resolvePhase(.loaded, hasStats: true), .content)
        XCTAssertEqual(QuickMetricsProjection.resolvePhase(.failed("e"), hasStats: false), .error("e"))
        XCTAssertEqual(QuickMetricsProjection.resolvePhase(.failed("e"), hasStats: true), .content)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(QuickMetricsSurface.slug, "QuickMetrics")
        XCTAssertEqual(QuickMetrics.surfaceSlug, "QuickMetrics")
    }
}

// MARK: - State holder: QuickMetricsModel

@MainActor
final class QuickMetricsModelTests: XCTestCase {
    private func sampleStats() -> QuickMetricsStats {
        QuickMetricsStats(
            totalEnergy: 1000,
            totalCost: 240,
            totalDuration: 90,
            homeCount: 10,
            scCount: 5,
            dcCount: 2,
            count: 20
        )
    }

    private func makeModel(
        initial: QuickMetricsUpdate?,
        telemetry: QuickMetricsTelemetry = SpyQuickMetricsTelemetry()
    ) -> (QuickMetricsModel, InMemoryQuickMetricsSource) {
        let source = InMemoryQuickMetricsSource(initial: initial)
        let model = QuickMetricsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func loaded(_ connection: QuickMetricsConnection = .live) -> QuickMetricsUpdate {
        QuickMetricsUpdate(
            status: .loaded,
            stats: sampleStats(),
            currencySymbol: "$",
            precision: 2,
            locale: "en-US",
            connection: connection,
            updatedAt: Date()
        )
    }

    func testLoadedContentProjectsTiles() {
        let (model, source) = makeModel(initial: loaded())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.metrics.count, 6)
        XCTAssertEqual(model.metrics[0].value, "10")
        XCTAssertEqual(model.metrics[3].value, "1h 30m")
        XCTAssertEqual(model.metrics[4].value, "$20")
        XCTAssertEqual(model.metrics[5].value, "50.00 kWh")
        XCTAssertEqual(source.startCount, 1)
    }

    func testNilStatsResolvesEmptyPhase() {
        let (model, _) = makeModel(initial: QuickMetricsUpdate(status: .loaded, stats: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.metrics.isEmpty)
    }

    func testLoadingAndErrorPhases() {
        let (loading, _) = makeModel(initial: QuickMetricsUpdate(status: .loading, stats: nil))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (failed, _) = makeModel(initial: QuickMetricsUpdate(status: .failed("timeout"), stats: nil))
        failed.start()
        XCTAssertEqual(failed.phase, .error("timeout"))
    }

    func testCachedStatsStayContentWhileFailing() {
        let (model, source) = makeModel(initial: loaded())
        model.start()
        source.push(
            QuickMetricsUpdate(status: .failed("net"), stats: sampleStats(), connection: .stale)
        )
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .stale)
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyQuickMetricsTelemetry()
        let (model, source) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [QuickMetricsSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testStaleAutoRefreshFiresOncePerEpisode() {
        let (model, source) = makeModel(initial: loaded(.live))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(loaded(.stale))
        source.push(loaded(.stale))
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
        source.push(loaded(.live))
        source.push(loaded(.stale))
        XCTAssertEqual(source.refreshCount, 2, "returning to live re-arms the stale auto-refresh")
        _ = model
    }

    func testOfflineKeepsCachedMetricsWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(loaded(.offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.metrics.count, 6)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testConnectionRefreshingAndTimestampTrackUpdates() {
        let (model, source) = makeModel(initial: QuickMetricsUpdate(status: .loading))
        model.start()
        source.push(
            QuickMetricsUpdate(
                status: .loaded,
                stats: sampleStats(),
                refreshing: true,
                connection: .offline,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.refreshing)
        XCTAssertNotNil(model.updatedAt)
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: QuickMetricsUpdate(status: .failed("x"), stats: nil))
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

final class QuickMetricsAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    private func metrics() -> [QuickMetric] {
        QuickMetricsProjection.metrics(
            from: QuickMetricsStats(
                totalEnergy: 1000,
                totalCost: 240,
                totalDuration: 90,
                homeCount: 10,
                scCount: 5,
                dcCount: 2,
                count: 20
            ),
            currencySymbol: "$",
            locale: Locale(identifier: "en-US")
        )
    }

    func testSectionSummaryIncludesLabelAndTiles() {
        let summary = QuickMetricsAccessibility.sectionSummary(metrics: metrics(), localize: echo)
        XCTAssertTrue(summary.contains("Charging metrics:"))
        XCTAssertTrue(summary.contains("Home 10"))
        XCTAssertTrue(summary.contains("Supercharger 5"))
        XCTAssertTrue(summary.contains("Per Session 50.00 kWh"))
    }

    func testSectionSummaryEmptyUsesFriendlyMessage() {
        let summary = QuickMetricsAccessibility.sectionSummary(metrics: [], localize: echo)
        XCTAssertTrue(summary.contains("Charging metrics"))
        XCTAssertTrue(summary.contains("No charging metrics available yet"))
    }

    func testTileLabel() throws {
        let home = try XCTUnwrap(metrics().first { $0.id == "home" })
        XCTAssertEqual(QuickMetricsAccessibility.tileLabel(home, localize: echo), "Home: 10")
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyQuickMetricsTelemetry: QuickMetricsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
