//
//  DetailedStatistics.Tests.swift
//  TeslaSync — P4 feature view · 0101 · DetailedStatistics (Apple)
//
//  Unit coverage for the DetailedStatistics surface:
//    • Adapter (cached → projection) — `DetailedStatisticsFormat` number / count / currency / unit /
//      duration / chargerName parity with the web `fmtNumber` / `<AnimatedNumber>` / `<Currency>` /
//      `fmtWithUnit` / `formatDuration` / `mostCommonType[0]`, and `DetailedStatisticsProjection`
//      six-tile projection (order, values, tones, label counts, animation flags) +
//      content/empty/loading/error phase resolution.
//    • State holder — `DetailedStatisticsModel` phase across loading / loaded / empty / failed, the
//      P1/S11 `view.opened` telemetry (once), the stale auto-refresh (once, re-armed on live), and
//      offline keeping cached statistics.
//    • Accessibility — the section summary + per-tile VoiceOver value content (incl. the Top Charger
//      "(N×)" label suffix).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no bundle: the
//  adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: formatting (web fmtNumber / Currency / fmtWithUnit / formatDuration parity)

@MainActor final class DetailedStatisticsFormatTests: XCTestCase {
    private let enUS = Locale(identifier: "en-US")

    func testCountGroupsThousands() {
        XCTAssertEqual(DetailedStatisticsFormat.count(47, locale: enUS), "47")
        XCTAssertEqual(DetailedStatisticsFormat.count(1234, locale: enUS), "1,234")
        XCTAssertEqual(DetailedStatisticsFormat.count(0, locale: enUS), "0")
    }

    func testNumberRoundsHalfAwayAndGuardsNonFinite() {
        XCTAssertEqual(DetailedStatisticsFormat.number(48.6, decimals: 2, locale: enUS), "48.60")
        XCTAssertEqual(DetailedStatisticsFormat.number(1234.5, decimals: 0, locale: enUS), "1,235")
        XCTAssertEqual(DetailedStatisticsFormat.number(.nan, decimals: 2, locale: enUS), "0.00")
        XCTAssertEqual(DetailedStatisticsFormat.number(.infinity, decimals: 0, locale: enUS), "0")
    }

    func testNumberIsLocaleAware() {
        XCTAssertEqual(DetailedStatisticsFormat.number(1234.5, decimals: 1, locale: enUS), "1,234.5")
        // de-DE swaps the grouping/decimal separators (comma is the decimal mark).
        let de = DetailedStatisticsFormat.number(1234.5, decimals: 1, locale: Locale(identifier: "de-DE"))
        XCTAssertTrue(de.contains(",5"), "expected a decimal comma in de-DE, got \(de)")
        XCTAssertNotEqual(de, "1,234.5")
    }

    func testCurrencyPrefixesSymbolAtRequestedPrecision() {
        XCTAssertEqual(DetailedStatisticsFormat.currency(612.0, symbol: "$", decimals: 2, locale: enUS), "$612.00")
        XCTAssertEqual(DetailedStatisticsFormat.currency(0.1427, symbol: "$", decimals: 3, locale: enUS), "$0.143")
        XCTAssertEqual(DetailedStatisticsFormat.currency(1234.5, symbol: "€", decimals: 2, locale: enUS), "€1,234.50")
    }

    func testCurrencyNonFiniteYieldsEmDashWithoutSymbol() {
        XCTAssertEqual(
            DetailedStatisticsFormat.currency(.nan, symbol: "$", decimals: 2, locale: enUS),
            DetailedStatisticsFormat.emDash
        )
        XCTAssertEqual(
            DetailedStatisticsFormat.currency(.infinity, symbol: "$", decimals: 3, locale: enUS),
            DetailedStatisticsFormat.emDash
        )
    }

    func testWithUnitAppendsSpaceAndUnit() {
        XCTAssertEqual(DetailedStatisticsFormat.withUnit(48.6, unit: "kW", decimals: 2, locale: enUS), "48.60 kW")
        XCTAssertEqual(DetailedStatisticsFormat.withUnit(48.6, unit: "kW", decimals: 1, locale: enUS), "48.6 kW")
        XCTAssertEqual(DetailedStatisticsFormat.withUnit(.nan, unit: "kW", decimals: 2, locale: enUS), "0.00 kW")
    }

    func testDurationMatchesWebFormatDurationMinutes() {
        XCTAssertEqual(DetailedStatisticsFormat.duration(minutes: 90), "1h 30m")
        XCTAssertEqual(DetailedStatisticsFormat.duration(minutes: 46.4), "46m")
        XCTAssertEqual(DetailedStatisticsFormat.duration(minutes: 60), "1h 0m")
        XCTAssertEqual(DetailedStatisticsFormat.duration(minutes: 59), "59m")
        XCTAssertEqual(DetailedStatisticsFormat.duration(minutes: 0), "0m")
        XCTAssertEqual(DetailedStatisticsFormat.duration(minutes: 125), "2h 5m")
    }

    func testDurationRoundsRemainderHalfAwayFromZero() {
        XCTAssertEqual(DetailedStatisticsFormat.duration(minutes: 90.6), "1h 31m")
        XCTAssertEqual(DetailedStatisticsFormat.duration(minutes: 30.4), "30m")
    }

    func testDurationFallbackForInvalidInput() {
        XCTAssertEqual(DetailedStatisticsFormat.duration(minutes: -5), DetailedStatisticsFormat.emDash)
        XCTAssertEqual(DetailedStatisticsFormat.duration(minutes: .nan), DetailedStatisticsFormat.emDash)
        XCTAssertEqual(DetailedStatisticsFormat.duration(minutes: .infinity), DetailedStatisticsFormat.emDash)
    }

    func testChargerNameGuardsEmpty() {
        XCTAssertEqual(DetailedStatisticsFormat.chargerName("Tesla Supercharger"), "Tesla Supercharger")
        XCTAssertEqual(DetailedStatisticsFormat.chargerName(""), DetailedStatisticsFormat.emDash)
        XCTAssertEqual(DetailedStatisticsFormat.chargerName("   "), DetailedStatisticsFormat.emDash)
    }
}

// MARK: - Adapter: projection (web stats + enhanced consumer parity)

@MainActor final class DetailedStatisticsProjectionTests: XCTestCase {
    private let enUS = Locale(identifier: "en-US")

    private func fullStats() -> DetailedStatisticsStats {
        DetailedStatisticsStats(count: 47, avgPower: 48.6, totalCost: 612.0, avgCostPerKwh: 0.1427)
    }

    private func fullEnhanced() -> DetailedStatisticsEnhanced {
        DetailedStatisticsEnhanced(avgDuration: 46.4, mostCommonTypeName: "Tesla Supercharger", mostCommonTypeCount: 18)
    }

    func testNilSnapshotProjectsNoTiles() {
        XCTAssertTrue(
            DetailedStatisticsProjection.metrics(
                stats: nil, enhanced: fullEnhanced(), currencySymbol: "$", locale: enUS
            ).isEmpty
        )
        XCTAssertTrue(
            DetailedStatisticsProjection.metrics(
                stats: fullStats(), enhanced: nil, currencySymbol: "$", locale: enUS
            ).isEmpty
        )
    }

    func testTileOrderToneCountAndAnimationFlags() {
        let metrics = DetailedStatisticsProjection.metrics(
            stats: fullStats(), enhanced: fullEnhanced(), currencySymbol: "$", locale: enUS
        )
        XCTAssertEqual(metrics.count, 6)
        XCTAssertEqual(
            metrics.map(\.id),
            ["totalSessions", "avgDuration", "avgPower", "topCharger", "totalCost", "avgCostPerKwh"]
        )
        XCTAssertEqual(metrics.map(\.tone), [.primary, .primary, .power, .primary, .warning, .success])
        XCTAssertEqual(metrics.map(\.labelCount), [nil, nil, nil, 18, nil, nil])
        XCTAssertEqual(metrics.map(\.animatesValue), [true, false, false, false, false, false])
    }

    func testTileValuesMatchWeb() {
        let metrics = DetailedStatisticsProjection.metrics(
            stats: fullStats(), enhanced: fullEnhanced(), currencySymbol: "$", locale: enUS, precision: 2
        )
        XCTAssertEqual(metrics[0].value, "47") // Total Sessions
        XCTAssertEqual(metrics[1].value, "46m") // Avg Duration (46.4 min)
        XCTAssertEqual(metrics[2].value, "48.60 kW") // Avg Power (precision 2)
        XCTAssertEqual(metrics[3].value, "Tesla Supercharger") // Top Charger (raw label)
        XCTAssertEqual(metrics[4].value, "$612.00") // Total Cost (2 dp)
        XCTAssertEqual(metrics[5].value, "$0.143") // Avg $/kWh (3 dp)
    }

    func testCurrencyAndPrecisionFollowPreferences() {
        let metrics = DetailedStatisticsProjection.metrics(
            stats: fullStats(), enhanced: fullEnhanced(), currencySymbol: "€", locale: enUS, precision: 1
        )
        XCTAssertEqual(metrics[2].value, "48.6 kW") // Avg Power follows the global precision (1 dp)
        XCTAssertEqual(metrics[4].value, "€612.00") // Total Cost always 2 dp (web Currency default)
        XCTAssertEqual(metrics[5].value, "€0.143") // Avg $/kWh always 3 dp (web Currency precision=3)
    }

    func testTopChargerEmptyNameGuardsToEmDash() {
        let enhanced = DetailedStatisticsEnhanced(avgDuration: 12, mostCommonTypeName: "", mostCommonTypeCount: 0)
        let metrics = DetailedStatisticsProjection.metrics(
            stats: fullStats(), enhanced: enhanced, currencySymbol: "$", locale: enUS
        )
        XCTAssertEqual(metrics[3].value, DetailedStatisticsFormat.emDash)
        XCTAssertEqual(metrics[3].labelCount, 0)
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(DetailedStatisticsProjection.resolvePhase(.loading, hasData: false), .loading)
        XCTAssertEqual(DetailedStatisticsProjection.resolvePhase(.loading, hasData: true), .content)
        XCTAssertEqual(DetailedStatisticsProjection.resolvePhase(.empty, hasData: false), .empty)
        XCTAssertEqual(DetailedStatisticsProjection.resolvePhase(.empty, hasData: true), .empty)
        XCTAssertEqual(DetailedStatisticsProjection.resolvePhase(.loaded, hasData: false), .empty)
        XCTAssertEqual(DetailedStatisticsProjection.resolvePhase(.loaded, hasData: true), .content)
        XCTAssertEqual(DetailedStatisticsProjection.resolvePhase(.failed("e"), hasData: false), .error("e"))
        XCTAssertEqual(DetailedStatisticsProjection.resolvePhase(.failed("e"), hasData: true), .content)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(DetailedStatisticsSurface.slug, "DetailedStatistics")
        XCTAssertEqual(DetailedStatistics.surfaceSlug, "DetailedStatistics")
    }
}

// MARK: - State holder: DetailedStatisticsModel

@MainActor final class DetailedStatisticsModelTests: XCTestCase {
    private func sampleStats() -> DetailedStatisticsStats {
        DetailedStatisticsStats(count: 20, avgPower: 11.0, totalCost: 240, avgCostPerKwh: 0.25)
    }

    private func sampleEnhanced() -> DetailedStatisticsEnhanced {
        DetailedStatisticsEnhanced(avgDuration: 90, mostCommonTypeName: "AC/Home", mostCommonTypeCount: 12)
    }

    private func makeModel(
        initial: DetailedStatisticsUpdate?,
        telemetry: DetailedStatisticsTelemetry = SpyDetailedStatisticsTelemetry()
    ) -> (DetailedStatisticsModel, InMemoryDetailedStatisticsSource) {
        let source = InMemoryDetailedStatisticsSource(initial: initial)
        let model = DetailedStatisticsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func loaded(_ connection: DetailedStatisticsConnection = .live) -> DetailedStatisticsUpdate {
        DetailedStatisticsUpdate(
            status: .loaded,
            stats: sampleStats(),
            enhanced: sampleEnhanced(),
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
        XCTAssertEqual(model.metrics[0].value, "20")
        XCTAssertEqual(model.metrics[1].value, "1h 30m")
        XCTAssertEqual(model.metrics[2].value, "11.00 kW")
        XCTAssertEqual(model.metrics[3].value, "AC/Home")
        XCTAssertEqual(model.metrics[4].value, "$240.00")
        XCTAssertEqual(model.metrics[5].value, "$0.250")
        XCTAssertEqual(source.startCount, 1)
    }

    func testNilSnapshotResolvesEmptyPhase() {
        let (model, _) = makeModel(initial: DetailedStatisticsUpdate(status: .loaded, stats: nil, enhanced: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.metrics.isEmpty)
    }

    func testLoadingAndErrorPhases() {
        let (loading, _) = makeModel(initial: DetailedStatisticsUpdate(status: .loading, stats: nil, enhanced: nil))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (failed, _) = makeModel(
            initial: DetailedStatisticsUpdate(status: .failed("timeout"), stats: nil, enhanced: nil)
        )
        failed.start()
        XCTAssertEqual(failed.phase, .error("timeout"))
    }

    func testCachedDataStaysContentWhileFailing() {
        let (model, source) = makeModel(initial: loaded())
        model.start()
        source.push(
            DetailedStatisticsUpdate(
                status: .failed("net"),
                stats: sampleStats(),
                enhanced: sampleEnhanced(),
                connection: .stale
            )
        )
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .stale)
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyDetailedStatisticsTelemetry()
        let (model, source) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [DetailedStatisticsSurface.slug])
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

    func testOfflineKeepsCachedDataWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(loaded(.offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.metrics.count, 6)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testConnectionRefreshingAndTimestampTrackUpdates() {
        let (model, source) = makeModel(initial: DetailedStatisticsUpdate(status: .loading))
        model.start()
        source.push(
            DetailedStatisticsUpdate(
                status: .loaded,
                stats: sampleStats(),
                enhanced: sampleEnhanced(),
                connection: .offline,
                refreshing: true,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.refreshing)
        XCTAssertNotNil(model.updatedAt)
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(
            initial: DetailedStatisticsUpdate(status: .failed("x"), stats: nil, enhanced: nil)
        )
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

@MainActor final class DetailedStatisticsAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    private func metrics() -> [DetailedStatistic] {
        DetailedStatisticsProjection.metrics(
            stats: DetailedStatisticsStats(count: 20, avgPower: 11.0, totalCost: 240, avgCostPerKwh: 0.25),
            enhanced: DetailedStatisticsEnhanced(
                avgDuration: 90, mostCommonTypeName: "AC/Home", mostCommonTypeCount: 12
            ),
            currencySymbol: "$",
            locale: Locale(identifier: "en-US")
        )
    }

    func testSectionSummaryIncludesTitleAndTiles() {
        let summary = DetailedStatisticsAccessibility.sectionSummary(metrics: metrics(), localize: echo)
        XCTAssertTrue(summary.contains("Detailed Statistics:"))
        XCTAssertTrue(summary.contains("Total Sessions 20"))
        XCTAssertTrue(summary.contains("Top Charger (12×) AC/Home"))
        XCTAssertTrue(summary.contains("Avg $/kWh $0.250"))
    }

    func testSectionSummaryEmptyUsesFriendlyMessage() {
        let summary = DetailedStatisticsAccessibility.sectionSummary(metrics: [], localize: echo)
        XCTAssertTrue(summary.contains("Detailed Statistics"))
        XCTAssertTrue(summary.contains("No charging statistics available yet"))
    }

    func testComposedLabelAddsCountSuffixOnlyForTopCharger() throws {
        let all = metrics()
        let top = try XCTUnwrap(all.first { $0.id == "topCharger" })
        let sessions = try XCTUnwrap(all.first { $0.id == "totalSessions" })
        XCTAssertEqual(DetailedStatisticsAccessibility.composedLabel(top, localize: echo), "Top Charger (12×)")
        XCTAssertEqual(DetailedStatisticsAccessibility.composedLabel(sessions, localize: echo), "Total Sessions")
    }

    func testTileLabel() throws {
        let power = try XCTUnwrap(metrics().first { $0.id == "avgPower" })
        XCTAssertEqual(DetailedStatisticsAccessibility.tileLabel(power, localize: echo), "Avg Power: 11.00 kW")
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyDetailedStatisticsTelemetry: DetailedStatisticsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
