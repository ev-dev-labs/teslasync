//
//  LifetimeSummary.Tests.swift
//  TeslaSync — P4 feature view · 0114 · LifetimeSummary (Apple)
//
//  Unit coverage for the LifetimeSummary surface:
//    • Adapter — fmtNumber / fmtInt / formatCurrency ports (grouping, precision,
//      non-finite coercion, locale + currency symbol), and the seven-tile builder
//      reproducing the exact web value expressions.
//    • View composition — the kind → label + unit-wrapper displayValue (kWh / min /
//      free-sessions "{{count}} ({{energy}})").
//    • State holder — `LifetimeSummaryProjection` phase resolution across loading /
//      error / empty / data plus the stale / offline overlays, the `LifetimeSummaryModel`
//      wiring, and the P1/S11 `view.opened` telemetry.
//    • Accessibility — the VoiceOver tile-summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryLifetimeSummarySource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Number formatting (port of web fmtNumber / fmtInt / formatCurrency)

final class LifetimeNumberFormatTests: XCTestCase {
    private let enUS = Locale(identifier: "en-US")

    func testDefaultPrecisionIsTwoDecimals() {
        XCTAssertEqual(LifetimeNumberFormat.number(1, locale: enUS), "1.00")
        XCTAssertEqual(LifetimeNumberFormat.number(350, locale: enUS), "350.00")
    }

    func testGroupingSeparatorApplied() {
        XCTAssertEqual(LifetimeNumberFormat.number(1234.5, decimals: 1, locale: enUS), "1,234.5")
        XCTAssertEqual(LifetimeNumberFormat.number(4210.6, decimals: 1, locale: enUS), "4,210.6")
    }

    func testDecimalsOverride() {
        XCTAssertEqual(LifetimeNumberFormat.number(29.6, decimals: 1, locale: enUS), "29.6")
        XCTAssertEqual(LifetimeNumberFormat.number(47, decimals: 0, locale: enUS), "47")
    }

    func testIntDropsFraction() {
        XCTAssertEqual(LifetimeNumberFormat.int(142, locale: enUS), "142")
        XCTAssertEqual(LifetimeNumberFormat.int(1234, locale: enUS), "1,234")
    }

    func testNonFiniteCoercesToZero() {
        XCTAssertEqual(LifetimeNumberFormat.number(.infinity, locale: enUS), "0.00")
        XCTAssertEqual(LifetimeNumberFormat.number(.nan, locale: enUS), "0.00")
    }

    func testCurrencyPrefixesSymbolWithoutSpace() {
        XCTAssertEqual(LifetimeNumberFormat.currency(1284.5, symbol: "$", decimals: 2, locale: enUS), "$1,284.50")
        XCTAssertEqual(LifetimeNumberFormat.currency(9.05, symbol: "$", decimals: 2, locale: enUS), "$9.05")
    }

    func testCurrencyHonoursLocaleAndSymbol() {
        // de-DE groups with "." and uses "," for the decimal separator.
        let deDE = Locale(identifier: "de-DE")
        XCTAssertEqual(LifetimeNumberFormat.currency(1284.5, symbol: "€", decimals: 2, locale: deDE), "€1.284,50")
    }
}

// MARK: - Formatting preferences (web useFormatting defaults)

final class LifetimeFormattingTests: XCTestCase {
    func testDefaultsMirrorWebGlobals() {
        let formatting = LifetimeFormatting()
        XCTAssertEqual(formatting.currencySymbol, "$")
        XCTAssertEqual(formatting.localeIdentifier, "en-US")
    }

    func testBlankSymbolFallsBackToDefaultSymbol() {
        XCTAssertEqual(LifetimeFormatting(currencySymbol: "   ").currencySymbol, "$")
    }

    func testBlankLocaleFallsBackToEnUS() {
        XCTAssertEqual(LifetimeFormatting(localeIdentifier: "").localeIdentifier, "en-US")
    }
}

// MARK: - Tile builder (web LifetimeSummary composition)

final class LifetimeMetricsBuilderTests: XCTestCase {
    private let core = LifetimeCoreStats(totalCost: 1284.5, totalEnergy: 4210.6, count: 142)
    private let metrics = LifetimeMetrics(
        avgSessionCost: 9.05,
        avgSessionEnergy: 29.6,
        avgDuration: 47,
        freeCount: 18,
        freeEnergy: 612.4
    )

    func testTilesAreInWebRenderOrder() {
        let tiles = LifetimeMetricsBuilder.tiles(coreStats: core, metrics: metrics)
        XCTAssertEqual(tiles.map(\.kind), [
            .totalSpent, .totalEnergy, .totalSessions,
            .avgSessionCost, .avgEnergy, .avgDuration, .freeSessions
        ])
    }

    func testTileValuesReproduceWebExpressions() {
        let tiles = LifetimeMetricsBuilder.tiles(coreStats: core, metrics: metrics)
        // 1 formatCurrency(totalCost, 2)
        XCTAssertEqual(tiles[0].primaryText, "$1,284.50")
        // 2 fmtWithUnit(totalEnergy, 'kWh', 1) — numeric part only (unit added in view)
        XCTAssertEqual(tiles[1].primaryText, "4,210.6")
        // 3 fmtInt(count)
        XCTAssertEqual(tiles[2].primaryText, "142")
        // 4 formatCurrency(avgSessionCost, 2)
        XCTAssertEqual(tiles[3].primaryText, "$9.05")
        // 5 fmtWithUnit(avgSessionEnergy, 'kWh', 1)
        XCTAssertEqual(tiles[4].primaryText, "29.6")
        // 6 fmtNumber(avgDuration, 0)
        XCTAssertEqual(tiles[5].primaryText, "47")
        // 7 fmtInt(freeCount) + fmtWithUnit(freeEnergy, 'kWh', 1)
        XCTAssertEqual(tiles[6].primaryText, "18")
        XCTAssertEqual(tiles[6].secondaryText, "612.4")
    }

    func testTilesHonourFormattingPreferences() {
        let tiles = LifetimeMetricsBuilder.tiles(
            coreStats: core,
            metrics: metrics,
            formatting: LifetimeFormatting(currencySymbol: "€", localeIdentifier: "de-DE")
        )
        XCTAssertEqual(tiles[0].primaryText, "€1.284,50")
        XCTAssertEqual(tiles[1].primaryText, "4.210,6")
    }
}

// MARK: - View composition (kind → unit-wrapped display value)

final class LifetimeMetricDisplayValueTests: XCTestCase {
    func testEnergyKindsWrapWithKwhUnit() {
        let energy = LifetimeMetricProjection(kind: .totalEnergy, primaryText: "4,210.6")
        XCTAssertEqual(LifetimeMetricKind.totalEnergy.displayValue(energy), "4,210.6 kWh")
        let avg = LifetimeMetricProjection(kind: .avgEnergy, primaryText: "29.6")
        XCTAssertEqual(LifetimeMetricKind.avgEnergy.displayValue(avg), "29.6 kWh")
    }

    func testDurationWrapsWithMinUnit() {
        let duration = LifetimeMetricProjection(kind: .avgDuration, primaryText: "47")
        XCTAssertEqual(LifetimeMetricKind.avgDuration.displayValue(duration), "47 min")
    }

    func testFreeSessionsComposesCountAndEnergy() {
        let free = LifetimeMetricProjection(kind: .freeSessions, primaryText: "18", secondaryText: "612.4")
        XCTAssertEqual(LifetimeMetricKind.freeSessions.displayValue(free), "18 (612.4 kWh)")
    }

    func testCurrencyAndCountKindsPassThroughVerbatim() {
        let spent = LifetimeMetricProjection(kind: .totalSpent, primaryText: "$1,284.50")
        XCTAssertEqual(LifetimeMetricKind.totalSpent.displayValue(spent), "$1,284.50")
        let sessions = LifetimeMetricProjection(kind: .totalSessions, primaryText: "142")
        XCTAssertEqual(LifetimeMetricKind.totalSessions.displayValue(sessions), "142")
    }

    func testLabelKeysCoverEveryKind() {
        for kind in LifetimeMetricKind.allCases {
            XCTAssertFalse(kind.labelFallback.isEmpty)
            XCTAssertTrue(kind.labelKey.hasPrefix("costAnalysis.lifetime."))
        }
    }
}

// MARK: - Projection: phase resolution + overlays

final class LifetimeSummaryProjectionTests: XCTestCase {
    private let core = LifetimeCoreStats(totalCost: 100, totalEnergy: 400, count: 12)
    private let metrics = LifetimeMetrics(
        avgSessionCost: 8.3, avgSessionEnergy: 33.3, avgDuration: 40, freeCount: 2, freeEnergy: 50
    )

    func testLoadingTakesPrecedenceOverData() {
        let input = LifetimeSummaryInput(isLoading: true, coreStats: core, metrics: metrics)
        XCTAssertEqual(LifetimeSummaryProjection.resolve(input).phase, .loading)
    }

    func testErrorTakesPrecedenceOverCachedData() {
        let input = LifetimeSummaryInput(errorMessage: "boom", coreStats: core, metrics: metrics)
        XCTAssertEqual(LifetimeSummaryProjection.resolve(input).phase, .error("boom"))
    }

    func testEmptyWhenCoreStatsMissing() {
        let input = LifetimeSummaryInput(metrics: metrics)
        let resolved = LifetimeSummaryProjection.resolve(input)
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertTrue(resolved.tiles.isEmpty)
    }

    func testEmptyWhenMetricsMissing() {
        let input = LifetimeSummaryInput(coreStats: core)
        let resolved = LifetimeSummaryProjection.resolve(input)
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertTrue(resolved.tiles.isEmpty)
    }

    func testEmptyWhenBothMissing() {
        XCTAssertEqual(LifetimeSummaryProjection.resolve(LifetimeSummaryInput()).phase, .empty)
    }

    func testDataWhenBothPresent() {
        let resolved = LifetimeSummaryProjection.resolve(
            LifetimeSummaryInput(coreStats: core, metrics: metrics)
        )
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.tiles.count, LifetimeMetricKind.allCases.count)
    }

    func testStaleAndOfflineRequireContent() {
        let withData = LifetimeSummaryInput(
            coreStats: core, metrics: metrics, isStale: true, isOffline: true
        )
        let resolvedWith = LifetimeSummaryProjection.resolve(withData)
        XCTAssertTrue(resolvedWith.isStale)
        XCTAssertTrue(resolvedWith.isOffline)

        let noData = LifetimeSummaryInput(isLoading: true, isStale: true, isOffline: true)
        let resolvedWithout = LifetimeSummaryProjection.resolve(noData)
        XCTAssertFalse(resolvedWithout.isStale)
        XCTAssertFalse(resolvedWithout.isOffline)
    }

    func testFetchingFlagPassesThrough() {
        let input = LifetimeSummaryInput(isFetching: true, coreStats: core, metrics: metrics)
        XCTAssertTrue(LifetimeSummaryProjection.resolve(input).isFetching)
    }
}

// MARK: - State holder: wiring + telemetry

@MainActor
final class LifetimeSummaryModelTests: XCTestCase {
    private let core = LifetimeCoreStats(totalCost: 100, totalEnergy: 400, count: 12)
    private let metrics = LifetimeMetrics(
        avgSessionCost: 8.3, avgSessionEnergy: 33.3, avgDuration: 40, freeCount: 2, freeEnergy: 50
    )

    private func makeModel(
        _ input: LifetimeSummaryInput,
        telemetry: LifetimeSummaryTelemetry = OSLogLifetimeSummaryTelemetry()
    ) -> (LifetimeSummaryModel, InMemoryLifetimeSummarySource) {
        let source = InMemoryLifetimeSummarySource(initial: input)
        let model = LifetimeSummaryModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyLifetimeSummaryTelemetry()
        let (model, source) = makeModel(
            LifetimeSummaryInput(coreStats: core, metrics: metrics), telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.tiles.count, LifetimeMetricKind.allCases.count)
        XCTAssertEqual(spy.surfaces, [LifetimeSummary.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(LifetimeSummaryInput(isLoading: true))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(LifetimeSummaryInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(LifetimeSummaryInput(
            isFetching: true, coreStats: core, metrics: metrics, isStale: true
        ))
        XCTAssertEqual(model.phase, .data)
        XCTAssertTrue(model.isFetching)
        XCTAssertTrue(model.isStale)
        XCTAssertEqual(model.tiles.count, LifetimeMetricKind.allCases.count)
    }

    func testStopResetsStartGate() {
        let spy = SpyLifetimeSummaryTelemetry()
        let (model, _) = makeModel(LifetimeSummaryInput(coreStats: core, metrics: metrics), telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, [LifetimeSummary.surfaceSlug, LifetimeSummary.surfaceSlug])
    }
}

// MARK: - Accessibility summary content

final class LifetimeSummaryAccessibilityTests: XCTestCase {
    func testTileSummaryJoinsLabelAndValue() {
        let summary = LifetimeSummaryAccessibility.tileSummary(label: "Total Spent", value: "$1,284.50")
        XCTAssertEqual(summary, "Total Spent, $1,284.50")
    }

    func testTileSummaryDropsEmptyFragments() {
        let summary = LifetimeSummaryAccessibility.tileSummary(label: "Total Sessions", value: "")
        XCTAssertEqual(summary, "Total Sessions")
        XCTAssertFalse(summary.hasSuffix(", "))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyLifetimeSummaryTelemetry: LifetimeSummaryTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
