//
//  CostSummaryCards.Tests.swift
//  TeslaSync — P4 feature view · 0111 · CostSummaryCards (Apple)
//
//  Unit coverage for the CostSummaryCards surface: the adapter (CostFormat golden vectors +
//  CostSummaryProjection six-card values/subtitles/labels/icons/accents/glows + zero fallback
//  + phase resolution, all web-parity), the CostSummaryModel state holder (phases, refresh,
//  stale auto-refresh, P1/S11 view.opened telemetry), and the accessibility tile summary.
//  No network, no real store: the model is driven by InMemoryCostSummarySource and the i18n
//  facade is an injected echo closure asserting the web English fallbacks.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: formatting (web parity)

@MainActor final class CostFormatTests: XCTestCase {
    func testSafeCoercesNonFinite() {
        XCTAssertEqual(CostFormat.safe(42), 42, accuracy: 0.0001)
        XCTAssertEqual(CostFormat.safe(.nan), 0)
        XCTAssertEqual(CostFormat.safe(.infinity), 0)
        XCTAssertEqual(CostFormat.safe(-.infinity), 0)
    }

    func testFmtNumberGroupingRoundingAndPrecision() {
        XCTAssertEqual(CostFormat.fmtNumber(1234.56, decimals: 2, locale: "en-US"), "1,234.56")
        XCTAssertEqual(CostFormat.fmtNumber(0.1423, decimals: 3, locale: "en-US"), "0.142")
        XCTAssertEqual(CostFormat.fmtNumber(0.0584, decimals: 3, locale: "en-US"), "0.058")
        XCTAssertEqual(CostFormat.fmtNumber(1024.5, decimals: 1, locale: "en-US"), "1,024.5")
        XCTAssertEqual(CostFormat.fmtNumber(30.66, decimals: 1, locale: "en-US"), "30.7")
    }

    func testFmtNumberGuardsNonFinite() {
        XCTAssertEqual(CostFormat.fmtNumber(.nan, decimals: 2, locale: "en-US"), "0.00")
        XCTAssertEqual(CostFormat.fmtNumber(.infinity, decimals: 1, locale: "en-US"), "0.0")
    }

    func testLocaleSwapsGroupingAndDecimalSeparators() {
        XCTAssertEqual(CostFormat.fmtNumber(1234.56, decimals: 2, locale: "de-DE"), "1.234,56")
        XCTAssertEqual(CostFormat.fmtNumber(0.1423, decimals: 3, locale: "de-DE"), "0,142")
        XCTAssertEqual(CostFormat.fmtNumber(1024.5, decimals: 1, locale: "de-DE"), "1.024,5")
        XCTAssertEqual(CostFormat.fmtNumber(1234.56, decimals: 2, locale: nil), "1,234.56")
        XCTAssertEqual(CostFormat.fmtNumber(1234.56, decimals: 2, locale: "   "), "1,234.56")
    }

    func testFmtIntIsZeroDecimalGrouped() {
        XCTAssertEqual(CostFormat.fmtInt(128, locale: "en-US"), "128")
        XCTAssertEqual(CostFormat.fmtInt(12345.6, locale: "en-US"), "12,346")
    }

    func testFmtWithUnitJoinsValueAndUnit() {
        XCTAssertEqual(CostFormat.fmtWithUnit(1024.5, unit: "kWh", decimals: 1, locale: "en-US"), "1,024.5 kWh")
        XCTAssertEqual(CostFormat.fmtWithUnit(0, unit: "kWh", decimals: 1, locale: "en-US"), "0.0 kWh")
    }

    func testCurrencyPrependsSymbol() {
        XCTAssertEqual(CostFormat.currency(1234.56, decimals: 2, symbol: "$", locale: "en-US"), "$1,234.56")
        XCTAssertEqual(CostFormat.currency(210.4, decimals: 2, symbol: "€", locale: "de-DE"), "€210,40")
        XCTAssertEqual(CostFormat.currency(0, decimals: 3, symbol: "$", locale: "en-US"), "$0.000")
    }

    func testPercentAppendsSymbol() {
        XCTAssertEqual(CostFormat.percent(62.34, decimals: 1, locale: "en-US"), "62.3%")
        XCTAssertEqual(CostFormat.percent(.nan, decimals: 1, locale: "en-US"), "0.0%")
    }
}

// MARK: - Adapter: projection (web parity)

@MainActor final class CostSummaryProjectionTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    private let imperial = CostSummaryUnitContext(
        gasPrice: 3.5,
        distanceUnit: "mi",
        isMiles: true,
        currencySymbol: "$",
        gasUnit: .gallon,
        locale: "en-US"
    )

    private let metric = CostSummaryUnitContext(
        gasPrice: 1.65,
        distanceUnit: "km",
        isMiles: false,
        currencySymbol: "€",
        gasUnit: .liter,
        locale: "de-DE"
    )

    private func fullStats() -> CostSummaryStats {
        CostSummaryStats(
            totalCost: 1234.56,
            count: 128,
            avgCostPerKwh: 0.1423,
            costPerDist: 0.0584,
            totalEnergy: 1024.5,
            gallonsEquiv: 30.66,
            savings: 210.4,
            savingsPercent: 62.34
        )
    }

    func testCardCountOrderAndIdentity() {
        let cards = CostSummaryProjection.cards(from: fullStats(), context: imperial, localize: echo)
        XCTAssertEqual(cards.count, 6)
        XCTAssertEqual(
            cards.map(\.id),
            ["totalCost", "avgPerKwh", "costPerDist", "totalEnergy", "gasSavings", "savingsPercent"]
        )
    }

    func testImperialValuesMatchWeb() {
        let cards = CostSummaryProjection.cards(from: fullStats(), context: imperial, localize: echo)
        XCTAssertEqual(cards[0].value, "$1,234.56")
        XCTAssertEqual(cards[1].value, "$0.142")
        XCTAssertEqual(cards[2].value, "$0.058")
        XCTAssertEqual(cards[3].value, "1,024.5 kWh")
        XCTAssertEqual(cards[4].value, "$210.40")
        XCTAssertEqual(cards[5].value, "62.3%")
    }

    func testImperialSubtitlesMatchWeb() {
        let cards = CostSummaryProjection.cards(from: fullStats(), context: imperial, localize: echo)
        XCTAssertEqual(cards[0].subtitle, "128 sessions")
        XCTAssertEqual(cards[1].subtitle, "blended rate")
        XCTAssertEqual(cards[2].subtitle, "per mi")
        XCTAssertEqual(cards[3].subtitle, "30.7 gal equiv")
        XCTAssertEqual(cards[4].subtitle, "vs $3.50/gal")
        XCTAssertEqual(cards[5].subtitle, "vs gasoline")
    }

    func testImperialLabelsMatchWeb() {
        let cards = CostSummaryProjection.cards(from: fullStats(), context: imperial, localize: echo)
        XCTAssertEqual(
            cards.map(\.label),
            ["Total Cost", "Avg $/kWh", "Cost Per Mile", "Total Energy", "Gas Savings $", "Savings %"]
        )
    }

    func testMetricLocaleAndCurrencyContext() {
        let cards = CostSummaryProjection.cards(from: fullStats(), context: metric, localize: echo)
        XCTAssertEqual(cards[0].value, "€1.234,56")
        XCTAssertEqual(cards[1].value, "€0,142")
        XCTAssertEqual(cards[3].value, "1.024,5 kWh")
        XCTAssertEqual(cards[3].subtitle, "30,7 gal equiv")
        XCTAssertEqual(cards[4].subtitle, "vs €1,65/L")
        XCTAssertEqual(cards[2].label, "Cost Per km")
        XCTAssertEqual(cards[2].subtitle, "per km")
    }

    func testIconsAccentsAndGlows() {
        let cards = CostSummaryProjection.cards(from: fullStats(), context: imperial, localize: echo)
        XCTAssertEqual(
            cards.map(\.systemImage),
            [
                "dollarsign.circle.fill",
                "bolt.fill",
                "car.fill",
                "bolt.fill",
                "fuelpump.fill",
                "chart.line.downtrend.xyaxis"
            ]
        )
        XCTAssertEqual(cards.map(\.accent), [.cyan, .yellow, .blue, .green, .red, .emerald])
        XCTAssertEqual(cards.map(\.glow), [.cyan, .none, .none, .green, .green, .green])
    }

    func testNilStatsRendersZeroedCards() {
        // Web `coreStats?.x ?? 0`: the empty surface renders six zeroed tiles, never blanks.
        let cards = CostSummaryProjection.cards(from: nil, context: imperial, localize: echo)
        XCTAssertEqual(cards.count, 6)
        XCTAssertEqual(cards[0].value, "$0.00")
        XCTAssertEqual(cards[0].subtitle, "0 sessions")
        XCTAssertEqual(cards[1].value, "$0.000")
        XCTAssertEqual(cards[3].value, "0.0 kWh")
        XCTAssertEqual(cards[3].subtitle, "0.0 gal equiv")
        XCTAssertEqual(cards[5].value, "0.0%")
        XCTAssertEqual(cards[4].subtitle, "vs $3.50/gal") // gas price still renders from context
    }

    func testNonFiniteStatsCoercedToZero() {
        let stats = CostSummaryStats(totalCost: .infinity, avgCostPerKwh: .nan, savingsPercent: .nan)
        let cards = CostSummaryProjection.cards(from: stats, context: imperial, localize: echo)
        XCTAssertEqual(cards[0].value, "$0.00")
        XCTAssertEqual(cards[1].value, "$0.000")
        XCTAssertEqual(cards[5].value, "0.0%")
    }

    func testAccentAndGlowColorsResolve() {
        XCTAssertNotEqual(CostAccent.blue.color, CostAccent.cyan.color)
        XCTAssertEqual(CostAccent.green.color, CostAccent.emerald.color)
        XCTAssertNotNil(CostGlow.cyan.color)
        XCTAssertNotNil(CostGlow.green.color)
        XCTAssertNil(CostGlow.none.color)
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(CostSummaryProjection.resolvePhase(.loading, hasValue: false), .loading)
        XCTAssertEqual(CostSummaryProjection.resolvePhase(.loading, hasValue: true), .content)
        XCTAssertEqual(CostSummaryProjection.resolvePhase(.empty, hasValue: false), .empty)
        XCTAssertEqual(CostSummaryProjection.resolvePhase(.empty, hasValue: true), .empty)
        XCTAssertEqual(CostSummaryProjection.resolvePhase(.loaded, hasValue: false), .empty)
        XCTAssertEqual(CostSummaryProjection.resolvePhase(.loaded, hasValue: true), .content)
        XCTAssertEqual(CostSummaryProjection.resolvePhase(.failed("e"), hasValue: false), .error("e"))
        XCTAssertEqual(CostSummaryProjection.resolvePhase(.failed("e"), hasValue: true), .content)
    }
}

// MARK: - State holder: phases + refresh + telemetry

@MainActor final class CostSummaryModelTests: XCTestCase {
    private func makeModel(
        _ update: CostSummaryUpdate,
        telemetry: CostSummaryTelemetry = OSLogCostSummaryTelemetry()
    ) -> (CostSummaryModel, InMemoryCostSummarySource) {
        let source = InMemoryCostSummarySource(initial: update)
        let model = CostSummaryModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func sampleStats() -> CostSummaryStats {
        CostSummaryStats(
            totalCost: 1234.56,
            count: 128,
            avgCostPerKwh: 0.1423,
            costPerDist: 0.0584,
            totalEnergy: 1024.5,
            gallonsEquiv: 30.66,
            savings: 210.4,
            savingsPercent: 62.34
        )
    }

    private func imperialContext() -> CostSummaryUnitContext {
        CostSummaryUnitContext(
            gasPrice: 3.5,
            distanceUnit: "mi",
            isMiles: true,
            currencySymbol: "$",
            gasUnit: .gallon,
            locale: "en-US"
        )
    }

    private func loaded(_ connection: CostSummaryConnection = .live) -> CostSummaryUpdate {
        CostSummaryUpdate(
            status: .loaded,
            stats: sampleStats(),
            context: imperialContext(),
            connection: connection,
            updatedAt: Date()
        )
    }

    func testInitialContentPhaseAndCards() {
        let (model, _) = makeModel(loaded())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.cards.count, 6)
        XCTAssertEqual(model.cards[0].value, "$1,234.56")
    }

    func testLoadingAndErrorPhases() {
        let (loading, _) = makeModel(CostSummaryUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (failed, _) = makeModel(CostSummaryUpdate(status: .failed("boom")))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
    }

    func testEmptyPhaseStillProjectsZeroedCards() {
        let (model, _) = makeModel(
            CostSummaryUpdate(status: .empty, stats: nil, context: imperialContext())
        )
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.cards.count, 6)
        XCTAssertEqual(model.cards[0].value, "$0.00")
        XCTAssertEqual(model.cards[0].subtitle, "0 sessions")
    }

    func testCachedStatsStayContentWhileFailing() {
        let (model, source) = makeModel(loaded())
        model.start()
        source.push(
            CostSummaryUpdate(
                status: .failed("net"),
                stats: sampleStats(),
                context: imperialContext(),
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
        let spy = SpyCostSummaryTelemetry()
        let (model, source) = makeModel(CostSummaryUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [CostSummaryCards.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testConnectionAndRefreshingTrackUpdates() {
        let (model, source) = makeModel(CostSummaryUpdate(status: .loading))
        model.start()
        source.push(
            CostSummaryUpdate(
                status: .loaded,
                stats: sampleStats(),
                context: imperialContext(),
                refreshing: true,
                connection: .offline,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.refreshing)
        XCTAssertNotNil(model.updatedAt)
    }

    func testStopThenStartReArmsViewOpenedTelemetry() {
        let spy = SpyCostSummaryTelemetry()
        let (model, _) = makeModel(CostSummaryUpdate(status: .loading), telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces.count, 2)
    }
}

// MARK: - Accessibility summary

@MainActor final class CostSummaryAccessibilityTests: XCTestCase {
    func testCardSummaryReadsLabelValueSubtitle() {
        let card = CostSummaryCardModel(
            id: "totalCost",
            label: "Total Cost",
            value: "$1,234.56",
            subtitle: "128 sessions",
            systemImage: "dollarsign.circle.fill",
            accent: .cyan,
            glow: .cyan
        )
        XCTAssertEqual(CostSummaryAccessibility.cardSummary(card), "Total Cost, $1,234.56 128 sessions")
    }

    func testCardSummaryReadsZeroValue() {
        let card = CostSummaryCardModel(
            id: "savingsPercent",
            label: "Savings %",
            value: "0.0%",
            subtitle: "vs gasoline",
            systemImage: "chart.line.downtrend.xyaxis",
            accent: .emerald,
            glow: .green
        )
        let summary = CostSummaryAccessibility.cardSummary(card)
        XCTAssertTrue(summary.contains("Savings %"))
        XCTAssertTrue(summary.contains("0.0%"))
        XCTAssertTrue(summary.contains("vs gasoline"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyCostSummaryTelemetry: CostSummaryTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
