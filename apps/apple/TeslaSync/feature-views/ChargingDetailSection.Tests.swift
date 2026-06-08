//
//  ChargingDetailSection.Tests.swift
//  TeslaSync — P4 feature view · 0053 · ChargingDetailSection (Apple)
//
//  Unit coverage for the ChargingDetailSection surface:
//    • Adapter (analytics → projection) — `ChargingNumeric.safe`/`axisLabel`, the
//      `brandLeaderboard` (web `brandLeaderboard`), the `chargerTypeShares` (web
//      `chargerTypes.map` percentages), and the `MonthlyTrendScale` dual-axis math.
//    • State holder — `ChargingDetailModel` phase resolution across loading /
//      loaded / empty / error, projection wiring, the P1/S11 `view.opened`
//      telemetry + source wiring, and connection tracking.
//    • Formatting — `DefaultChargingDetailFormatting` currency + integer parity.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryChargingDetailSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: numeric guards (port of `safe`)

@MainActor final class ChargingNumericTests: XCTestCase {
    func testSafeReturnsFiniteValues() {
        XCTAssertEqual(ChargingNumeric.safe(42.5), 42.5)
        XCTAssertEqual(ChargingNumeric.safe(0), 0)
        XCTAssertEqual(ChargingNumeric.safe(-3), -3)
    }

    func testSafeZeroesNonFiniteAndNil() {
        XCTAssertEqual(ChargingNumeric.safe(nil), 0)
        XCTAssertEqual(ChargingNumeric.safe(.nan), 0)
        XCTAssertEqual(ChargingNumeric.safe(.infinity), 0)
        XCTAssertEqual(ChargingNumeric.safe(-.infinity), 0)
    }

    func testAxisLabelAbbreviatesMagnitudes() {
        XCTAssertEqual(ChargingNumeric.axisLabel(420), "420")
        XCTAssertEqual(ChargingNumeric.axisLabel(12500), "12.5k")
        XCTAssertEqual(ChargingNumeric.axisLabel(2_000_000), "2.0M")
        XCTAssertEqual(ChargingNumeric.axisLabel(.nan), "—")
    }
}

// MARK: - Adapter: charger-brand leaderboard (port of `brandLeaderboard`)

@MainActor final class BrandLeaderboardTests: XCTestCase {
    func testEmptyBrandsProduceNoRows() {
        XCTAssertTrue(ChargingProjection.brandLeaderboard([]).isEmpty)
    }

    func testRowsAreRankedInSourceOrderWithFractionOfMax() {
        let brands = [
            ChargerBrandDatum(brand: "Tesla", count: 1000),
            ChargerBrandDatum(brand: "EA", count: 500),
            ChargerBrandDatum(brand: "EVgo", count: 250)
        ]
        let rows = ChargingProjection.brandLeaderboard(brands)
        XCTAssertEqual(rows.map(\.rank), [1, 2, 3])
        XCTAssertEqual(rows.map(\.brand), ["Tesla", "EA", "EVgo"])
        XCTAssertEqual(rows[0].fraction, 1.0, accuracy: 0.0001)
        XCTAssertEqual(rows[1].fraction, 0.5, accuracy: 0.0001)
        XCTAssertEqual(rows[2].fraction, 0.25, accuracy: 0.0001)
    }

    func testAllZeroCountsDivideBySafeOneNotZero() {
        let brands = [
            ChargerBrandDatum(brand: "A", count: 0),
            ChargerBrandDatum(brand: "B", count: 0)
        ]
        let rows = ChargingProjection.brandLeaderboard(brands)
        XCTAssertEqual(rows.map(\.fraction), [0, 0])
        XCTAssertEqual(rows.map(\.count), [0, 0])
    }

    func testNonFiniteCountIsTreatedAsZero() {
        let rows = ChargingProjection.brandLeaderboard([ChargerBrandDatum(brand: "X", count: .nan)])
        XCTAssertEqual(rows.first?.count, 0)
        XCTAssertEqual(rows.first?.fraction, 0)
    }
}

// MARK: - Adapter: charger-type shares (port of `chargerTypes.map`)

@MainActor final class ChargerTypeShareTests: XCTestCase {
    func testEmptyTypesProduceNoShares() {
        XCTAssertTrue(ChargingProjection.chargerTypeShares([]).isEmpty)
    }

    func testFractionPercentAndColorIndex() {
        let types = [
            ChargingDetailSectionChargerTypeDatum(type: "Supercharger", count: 75),
            ChargingDetailSectionChargerTypeDatum(type: "Level 2", count: 25)
        ]
        let shares = ChargingProjection.chargerTypeShares(types)
        XCTAssertEqual(shares.map(\.colorIndex), [0, 1])
        XCTAssertEqual(shares[0].fraction, 0.75, accuracy: 0.0001)
        XCTAssertEqual(shares[0].percent, 75, accuracy: 0.0001)
        XCTAssertEqual(shares[1].fraction, 0.25, accuracy: 0.0001)
        XCTAssertEqual(shares[1].percent, 25, accuracy: 0.0001)
    }

    func testZeroTotalYieldsZeroFractions() {
        let types = [
            ChargingDetailSectionChargerTypeDatum(type: "A", count: 0),
            ChargingDetailSectionChargerTypeDatum(type: "B", count: 0)
        ]
        let shares = ChargingProjection.chargerTypeShares(types)
        XCTAssertEqual(shares.map(\.fraction), [0, 0])
        XCTAssertEqual(shares.map(\.percent), [0, 0])
    }
}

// MARK: - Adapter: monthly-trend dual-axis scale

@MainActor final class MonthlyTrendScaleTests: XCTestCase {
    private let points = [
        MonthlyChargePoint(month: "Jan", energy: 300, avgPower: 50, sessions: 20),
        MonthlyChargePoint(month: "Feb", energy: 420, avgPower: 66, sessions: 29)
    ]

    func testLeftMaxSpansEnergyAndSessionsRightMaxSpansPower() {
        let scale = ChargingProjection.monthlyTrendScale(points)
        XCTAssertEqual(scale.leftMax, 420, accuracy: 0.0001)
        XCTAssertEqual(scale.rightMax, 66, accuracy: 0.0001)
    }

    func testEmptyPointsClampToOne() {
        let scale = ChargingProjection.monthlyTrendScale([])
        XCTAssertEqual(scale.leftMax, 1)
        XCTAssertEqual(scale.rightMax, 1)
    }

    func testPlottedAndTruePowerAreInverses() {
        let scale = ChargingProjection.monthlyTrendScale(points)
        let plotted = scale.plotted(power: 66)
        XCTAssertEqual(plotted, 420, accuracy: 0.0001)
        XCTAssertEqual(scale.truePower(fromPlotted: plotted), 66, accuracy: 0.0001)
        XCTAssertEqual(scale.truePower(fromPlotted: scale.plotted(power: 33)), 33, accuracy: 0.0001)
    }

    func testTrailingTicksAndDomain() {
        let scale = ChargingProjection.monthlyTrendScale(points)
        let ticks = scale.trailingTickPositions
        XCTAssertEqual(ticks.count, 5)
        XCTAssertEqual(ticks.first, 0)
        XCTAssertEqual(ticks.last ?? 0, 420, accuracy: 0.0001)
        XCTAssertEqual(scale.domainUpperBound, 420 * 1.05, accuracy: 0.0001)
    }
}

// MARK: - Formatting: web `formatCurrency` / `fmtInt` parity

@MainActor final class ChargingFormattingTests: XCTestCase {
    private let formatting = DefaultChargingDetailFormatting()

    func testCurrencyUsesSymbolGroupingAndFixedDecimals() {
        XCTAssertEqual(formatting.formatCurrency(1234.5, decimals: 2), "$1,234.50")
        XCTAssertEqual(formatting.formatCurrency(8.43, decimals: 2), "$8.43")
        XCTAssertEqual(formatting.formatCurrency(0, decimals: 2), "$0.00")
    }

    func testCurrencyDefaultDecimalsIsTwo() {
        XCTAssertEqual(formatting.formatCurrency(7.1), "$7.10")
    }

    func testCurrencyZeroesNonFinite() {
        XCTAssertEqual(formatting.formatCurrency(.nan, decimals: 2), "$0.00")
    }

    func testIntegerGroupsAndRounds() {
        XCTAssertEqual(formatting.formatInt(1204), "1,204")
        XCTAssertEqual(formatting.formatInt(12345.6), "12,346")
        XCTAssertEqual(formatting.formatInt(0), "0")
    }
}

// MARK: - Accessibility summary content

@MainActor final class ChargingAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let formatting = DefaultChargingDetailFormatting()

    func testBrandRowSummaryHasRankBrandCountAndWord() {
        let row = BrandLeaderboardRow(rank: 1, brand: "Tesla", count: 1204, fraction: 1)
        let summary = ChargingAccessibility.brandRowSummary(
            row,
            sessionsWord: "sessions",
            formatInt: formatting.formatInt
        )
        XCTAssertEqual(summary, "#1 Tesla, 1,204 sessions")
    }

    func testChargerTypeSummaryHasTypeCountAndPercent() {
        let share = ChargerTypeShare(type: "Supercharger", count: 980, fraction: 0.66, percent: 66, colorIndex: 0)
        let summary = ChargingAccessibility.chargerTypeSummary(share, formatInt: formatting.formatInt)
        XCTAssertEqual(summary, "Supercharger, 980 (66%)")
    }

    func testCostSummaryListsAllFourStats() {
        let stats = CostStats(min: 1.2, avg: 8.4, median: 7.1, max: 24.9)
        let summary = ChargingAccessibility.costSummary(
            stats,
            labels: CostLabels(min: "Min Cost", avg: "Avg Cost", median: "Median Cost", max: "Max Cost"),
            formatCurrency: { formatting.formatCurrency($0, decimals: 2) }
        )
        XCTAssertTrue(summary.contains("Min Cost $1.20"))
        XCTAssertTrue(summary.contains("Avg Cost $8.40"))
        XCTAssertTrue(summary.contains("Median Cost $7.10"))
        XCTAssertTrue(summary.contains("Max Cost $24.90"))
    }

    func testMonthlyTrendSummarySpansMonthsAndSeries() {
        let points = [
            MonthlyChargePoint(month: "Jan", energy: 300, avgPower: 50, sessions: 20),
            MonthlyChargePoint(month: "Jun", energy: 420, avgPower: 66, sessions: 29)
        ]
        let summary = ChargingAccessibility.monthlyTrendSummary(
            points,
            labels: MonthlyTrendLabels(
                title: "Monthly Charging Trend",
                energy: "Energy (kWh)",
                power: "Avg Power (kW)",
                sessions: "sessions"
            ),
            formatInt: formatting.formatInt
        )
        XCTAssertTrue(summary.contains("Monthly Charging Trend"))
        XCTAssertTrue(summary.contains("Jan–Jun"))
        XCTAssertTrue(summary.contains("Energy (kWh)"))
        XCTAssertTrue(summary.contains("Avg Power (kW)"))
        XCTAssertTrue(summary.contains("49 sessions"))
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class ChargingDetailModelTests: XCTestCase {
    private func makeModel(
        _ update: ChargingAnalyticsUpdate,
        telemetry: ChargingDetailTelemetry = OSLogChargingDetailTelemetry()
    ) -> (ChargingDetailModel, InMemoryChargingDetailSource) {
        let source = InMemoryChargingDetailSource(initial: update)
        let model = ChargingDetailModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var sample: ChargingAnalytics {
        ChargingAnalytics(
            brands: [ChargerBrandDatum(brand: "Tesla", count: 100)],
            chargerTypes: [ChargingDetailSectionChargerTypeDatum(type: "Supercharger", count: 80)],
            monthlyTrend: [MonthlyChargePoint(month: "Jan", energy: 300, avgPower: 50, sessions: 20)],
            costStats: CostStats(min: 1, avg: 5, median: 4, max: 9)
        )
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(ChargingAnalyticsUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testEmptyStatusShowsLoadedSoPanelsSelfEmpty() {
        let (model, _) = makeModel(ChargingAnalyticsUpdate(status: .empty, analytics: ChargingAnalytics()))
        model.start()
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertTrue(model.isEmpty)
    }

    func testFailedWithoutDataShowsError() {
        let (model, _) = makeModel(ChargingAnalyticsUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsLoadedEvenWhileLoadingOrFailed() {
        let (loading, _) = makeModel(ChargingAnalyticsUpdate(status: .loading, analytics: sample))
        loading.start()
        XCTAssertEqual(loading.phase, .loaded)

        let (failed, _) = makeModel(ChargingAnalyticsUpdate(status: .failed("net"), analytics: sample))
        failed.start()
        XCTAssertEqual(failed.phase, .loaded)
        XCTAssertFalse(failed.isEmpty)
    }

    func testProjectionsAreComputedFromAnalytics() {
        let (model, _) = makeModel(ChargingAnalyticsUpdate(status: .loaded, analytics: sample))
        model.start()
        XCTAssertEqual(model.brandLeaderboard.count, 1)
        XCTAssertEqual(model.brandLeaderboard.first?.rank, 1)
        XCTAssertEqual(model.chargerTypeShares.count, 1)
        XCTAssertEqual(model.monthlyTrend.count, 1)
        XCTAssertEqual(model.monthlyTrendScale.leftMax, 300, accuracy: 0.0001)
        XCTAssertNotNil(model.costStats)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyChargingDetailTelemetry()
        let (model, source) = makeModel(ChargingAnalyticsUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ChargingDetailSection.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(ChargingAnalyticsUpdate(status: .loaded, analytics: sample))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndDataTrackUpdates() {
        let (model, source) = makeModel(ChargingAnalyticsUpdate(status: .loading))
        model.start()
        source.push(
            ChargingAnalyticsUpdate(
                status: .loaded,
                connection: .offline,
                analytics: sample,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertFalse(model.isEmpty)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyChargingDetailTelemetry: ChargingDetailTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
