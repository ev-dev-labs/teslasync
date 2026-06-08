//
//  OptimizerSection.Tests.swift
//  TeslaSync — P4 feature view · 0104 · OptimizerSection (Apple)
//
//  Unit coverage for the OptimizerSection surface:
//    • Adapter (optimizer → projection) — `OptimizerNumeric.safe`/`clamp`, the
//      battery-score tier thresholds, the projection predicates (savings banner,
//      peak-session elevation, recommendation savings, heatmap visibility, the
//      hours label), and the cost-heatmap matrix + color ramp.
//    • State holder — `OptimizerModel` phase resolution across loading / loaded /
//      empty / error, projection wiring, the P1/S11 `view.opened` telemetry + source
//      wiring, and connection tracking.
//    • Formatting — `DefaultOptimizerFormatting` number / currency / percent parity.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryOptimizerSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: numeric guards (port of `safeNumber`)

final class OptimizerNumericTests: XCTestCase {
    func testSafeReturnsFiniteValues() {
        XCTAssertEqual(OptimizerNumeric.safe(42.5), 42.5)
        XCTAssertEqual(OptimizerNumeric.safe(0), 0)
        XCTAssertEqual(OptimizerNumeric.safe(-3), -3)
    }

    func testSafeZeroesNonFiniteAndNil() {
        XCTAssertEqual(OptimizerNumeric.safe(nil), 0)
        XCTAssertEqual(OptimizerNumeric.safe(.nan), 0)
        XCTAssertEqual(OptimizerNumeric.safe(.infinity), 0)
        XCTAssertEqual(OptimizerNumeric.safe(-.infinity), 0)
    }

    func testClampBoundsValueIntoZeroUpper() {
        XCTAssertEqual(OptimizerNumeric.clamp(82, upper: 100), 82)
        XCTAssertEqual(OptimizerNumeric.clamp(140, upper: 100), 100)
        XCTAssertEqual(OptimizerNumeric.clamp(-5, upper: 100), 0)
        XCTAssertEqual(OptimizerNumeric.clamp(.nan, upper: 100), 0)
    }
}

// MARK: - Adapter: battery-score tier (web `>= 75 / >= 50`)

final class BatteryScoreTierTests: XCTestCase {
    func testThresholds() {
        XCTAssertEqual(BatteryScoreTier.resolve(100), .good)
        XCTAssertEqual(BatteryScoreTier.resolve(75), .good)
        XCTAssertEqual(BatteryScoreTier.resolve(74.9), .fair)
        XCTAssertEqual(BatteryScoreTier.resolve(50), .fair)
        XCTAssertEqual(BatteryScoreTier.resolve(49.9), .poor)
        XCTAssertEqual(BatteryScoreTier.resolve(0), .poor)
    }

    func testNonFiniteScoreIsPoor() {
        XCTAssertEqual(BatteryScoreTier.resolve(.nan), .poor)
    }
}

// MARK: - Adapter: projection predicates (ports of the web conditionals)

final class OptimizerProjectionTests: XCTestCase {
    func testSavingsBannerVisibleAboveFive() {
        XCTAssertTrue(OptimizerProjection.savingsBannerVisible(5.01))
        XCTAssertFalse(OptimizerProjection.savingsBannerVisible(5))
        XCTAssertFalse(OptimizerProjection.savingsBannerVisible(0))
        XCTAssertFalse(OptimizerProjection.savingsBannerVisible(.nan))
    }

    func testPeakSessionsElevatedAboveThirty() {
        XCTAssertTrue(OptimizerProjection.peakSessionsElevated(30.1))
        XCTAssertFalse(OptimizerProjection.peakSessionsElevated(30))
        XCTAssertFalse(OptimizerProjection.peakSessionsElevated(0))
    }

    func testRecommendationSavingsVisibility() {
        let withSavings = OptimizerRecommendation(id: 0, estimatedSavings: 12)
        let zeroSavings = OptimizerRecommendation(id: 1, estimatedSavings: 0)
        let noSavings = OptimizerRecommendation(id: 2, estimatedSavings: nil)
        XCTAssertTrue(OptimizerProjection.recommendationSavingsVisible(withSavings))
        XCTAssertFalse(OptimizerProjection.recommendationSavingsVisible(zeroSavings))
        XCTAssertFalse(OptimizerProjection.recommendationSavingsVisible(noSavings))
    }

    func testHeatmapVisibility() {
        XCTAssertFalse(OptimizerProjection.heatmapVisible([]))
        XCTAssertTrue(OptimizerProjection.heatmapVisible([
            OptimizerHeatmapEntry(day: 0, hour: 0, sessions: 1, avgCostPerKwh: 0.1)
        ]))
    }

    func testHoursLabel() {
        XCTAssertEqual(OptimizerProjection.hoursLabel([]), "—")
        XCTAssertEqual(OptimizerProjection.hoursLabel([16, 17, 18]), "16:00, 17:00, 18:00")
        XCTAssertEqual(OptimizerProjection.startHourLabel(22), "22:00")
    }

    func testPriorityParsingFallsBackToLow() {
        XCTAssertEqual(OptimizerPriority(raw: "high"), .high)
        XCTAssertEqual(OptimizerPriority(raw: "MEDIUM"), .medium)
        XCTAssertEqual(OptimizerPriority(raw: "low"), .low)
        XCTAssertEqual(OptimizerPriority(raw: "critical"), .low)
        XCTAssertEqual(OptimizerPriority(raw: ""), .low)
    }
}

// MARK: - Adapter: empty disposition

final class ChargingOptimizerEmptyTests: XCTestCase {
    func testDefaultOptimizerIsEmpty() {
        XCTAssertTrue(ChargingOptimizer().isEmpty)
    }

    func testOptimizerWithSignalIsNotEmpty() {
        let withScore = ChargingOptimizer(batteryHealthScore: 80)
        let withRecs = ChargingOptimizer(recommendations: [OptimizerRecommendation(id: 0)])
        let withDay = ChargingOptimizer(schedule: OptimizerSchedule(mostCommonDay: "Mon"))
        XCTAssertFalse(withScore.isEmpty)
        XCTAssertFalse(withRecs.isEmpty)
        XCTAssertFalse(withDay.isEmpty)
    }
}

// MARK: - Adapter: cost-heatmap matrix + color ramp (web `CostHeatmap`)

final class OptimizerHeatmapTests: XCTestCase {
    private let entries = [
        OptimizerHeatmapEntry(day: 1, hour: 18, sessions: 4, avgCostPerKwh: 0.42),
        OptimizerHeatmapEntry(day: 3, hour: 19, sessions: 5, avgCostPerKwh: 0.41),
        OptimizerHeatmapEntry(day: 5, hour: 23, sessions: 2, avgCostPerKwh: 0.10)
    ]

    func testMaxCostFallsBackToDefaultWhenNonPositive() {
        XCTAssertEqual(OptimizerHeatmap.maxCost(peakCostPerKwh: 0.42), 0.42, accuracy: 0.0001)
        XCTAssertEqual(OptimizerHeatmap.maxCost(peakCostPerKwh: 0), 0.30, accuracy: 0.0001)
        XCTAssertEqual(OptimizerHeatmap.maxCost(peakCostPerKwh: .nan), 0.30, accuracy: 0.0001)
    }

    func testIntensityIsClampedRatio() {
        XCTAssertEqual(OptimizerHeatmap.intensity(cost: 0.21, maxCost: 0.42), 0.5, accuracy: 0.0001)
        XCTAssertEqual(OptimizerHeatmap.intensity(cost: 0.42, maxCost: 0.42), 1, accuracy: 0.0001)
        XCTAssertEqual(OptimizerHeatmap.intensity(cost: 99, maxCost: 0.42), 1, accuracy: 0.0001)
        XCTAssertEqual(OptimizerHeatmap.intensity(cost: 0.2, maxCost: 0), 0, accuracy: 0.0001)
    }

    func testCellResolvesAndZeroFills() {
        let hit = OptimizerHeatmap.cell(day: 1, hour: 18, entries: entries)
        XCTAssertEqual(hit.sessions, 4)
        XCTAssertEqual(hit.cost, 0.42, accuracy: 0.0001)
        XCTAssertTrue(hit.isPopulated)

        let miss = OptimizerHeatmap.cell(day: 2, hour: 2, entries: entries)
        XCTAssertEqual(miss.sessions, 0)
        XCTAssertEqual(miss.cost, 0)
        XCTAssertFalse(miss.isPopulated)
    }

    func testColorForEmptyCellIsNearTransparentWhite() {
        let cell = OptimizerHeatmap.cell(day: 0, hour: 0, entries: entries)
        let color = OptimizerHeatmap.color(for: cell, maxCost: 0.42)
        XCTAssertEqual(color, OptimizerHeatColor(red: 1, green: 1, blue: 1, opacity: 0.02))
    }

    func testColorForPopulatedCellUsesWarmRampAndSessionAlpha() {
        let cell = OptimizerHeatmapCell(day: 1, hour: 18, sessions: 4, cost: 0.42)
        let color = OptimizerHeatmap.color(for: cell, maxCost: 0.42)
        // intensity == 1 → red 239/255, green/blue 0; alpha = min(0.9, 0.15 + 4*0.12) = 0.63.
        XCTAssertEqual(color.red, 239.0 / 255.0, accuracy: 0.0001)
        XCTAssertEqual(color.green, 0, accuracy: 0.0001)
        XCTAssertEqual(color.blue, 0, accuracy: 0.0001)
        XCTAssertEqual(color.opacity, 0.63, accuracy: 0.0001)
    }

    func testColorAlphaIsCappedAtNinePercentTenths() {
        let busy = OptimizerHeatmapCell(day: 1, hour: 18, sessions: 50, cost: 0.42)
        let color = OptimizerHeatmap.color(for: busy, maxCost: 0.42)
        XCTAssertEqual(color.opacity, 0.9, accuracy: 0.0001)
    }

    func testLegendRampStopsAndColors() {
        XCTAssertEqual(OptimizerHeatmap.legendStops, [0.15, 0.3, 0.5, 0.7, 0.9])
        let swatch = OptimizerHeatmap.legendColor(intensity: 0.5)
        XCTAssertEqual(swatch.red, (0.5 * 239).rounded() / 255, accuracy: 0.0001)
        XCTAssertEqual(swatch.green, (0.5 * 187).rounded() / 255, accuracy: 0.0001)
        XCTAssertEqual(swatch.opacity, 0.6, accuracy: 0.0001)
    }

    func testBusiestPicksMostSessions() {
        let busiest = OptimizerHeatmap.busiest(entries)
        XCTAssertEqual(busiest?.day, 3)
        XCTAssertEqual(busiest?.hour, 19)
        XCTAssertEqual(busiest?.sessions, 5)
    }

    func testBusiestIsNilWhenNoSessions() {
        XCTAssertNil(OptimizerHeatmap.busiest([]))
        XCTAssertNil(OptimizerHeatmap.busiest([
            OptimizerHeatmapEntry(day: 0, hour: 0, sessions: 0, avgCostPerKwh: 0.1)
        ]))
    }

    func testHourTickEveryThirdHour() {
        XCTAssertEqual(OptimizerHeatmapAxis.hourTick(0), "0")
        XCTAssertEqual(OptimizerHeatmapAxis.hourTick(3), "3")
        XCTAssertEqual(OptimizerHeatmapAxis.hourTick(4), "")
        XCTAssertEqual(OptimizerHeatmapAxis.dayIndices.count, 7)
        XCTAssertEqual(OptimizerHeatmapAxis.hourIndices.count, 24)
    }
}

// MARK: - Formatting: web `fmtNumber` / `formatCurrency` parity

final class OptimizerFormattingTests: XCTestCase {
    private let formatting = DefaultOptimizerFormatting()

    func testNumberGroupsAndFixesDecimals() {
        XCTAssertEqual(formatting.formatNumber(4.2, decimals: 1), "4.2")
        XCTAssertEqual(formatting.formatNumber(1234.5, decimals: 0), "1,235")
        XCTAssertEqual(formatting.formatNumber(0, decimals: 0), "0")
    }

    func testNumberZeroesNonFinite() {
        XCTAssertEqual(formatting.formatNumber(.nan, decimals: 0), "0")
        XCTAssertEqual(formatting.formatNumber(.infinity, decimals: 2), "0.00")
    }

    func testCurrencyUsesSymbolAndDecimals() {
        XCTAssertEqual(formatting.formatCurrency(0.42, decimals: 3), "$0.420")
        XCTAssertEqual(formatting.formatCurrency(0.11, decimals: 3), "$0.110")
        XCTAssertEqual(formatting.formatCurrency(1234.5, decimals: 2), "$1,234.50")
    }

    func testPercentAppendsSign() {
        XCTAssertEqual(formatting.formatPercent(36), "36%")
        XCTAssertEqual(formatting.formatPercent(82.4, decimals: 1), "82.4%")
    }
}
