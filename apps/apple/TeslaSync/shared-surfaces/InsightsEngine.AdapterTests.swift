//
//  InsightsEngine.AdapterTests.swift — P4 shared surface · 0092 · InsightsEngine (Apple).
//  Foundation-only adapter coverage: the eight analyzers (computed facts, severity/trend/trendGood,
//  presence gates) pinned to the web expressions, plus the fmtNumber / formatCurrency port.
//

import XCTest
@testable import TeslaSync

private let utc = TimeZone(identifier: "UTC")!

private var utcCalendar: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = utc
    return calendar
}

private func utcDate(_ year: Int, _ month: Int, _ day: Int, _ hour: Int) -> Date {
    var components = DateComponents()
    components.year = year
    components.month = month
    components.day = day
    components.hour = hour
    components.timeZone = utc
    return utcCalendar.date(from: components)!
}

// MARK: - Charging cost

final class InsightsEngineChargingCostTests: XCTestCase {
    func testHomeSavesBranch() throws {
        let sessions = [
            InsightsEngineCharging(cost: 5, chargeEnergyAdded: 40, fastChargerType: nil, endBatteryLevel: nil),
            InsightsEngineCharging(cost: 6, chargeEnergyAdded: 45, fastChargerType: nil, endBatteryLevel: nil),
            InsightsEngineCharging(
                cost: 12,
                chargeEnergyAdded: 30,
                fastChargerType: "supercharger",
                endBatteryLevel: nil
            )
        ]
        let insight = try XCTUnwrap(InsightsEngineAnalyzers.chargingCost(sessions))
        XCTAssertEqual(insight.id, "charging-cost")
        XCTAssertEqual(insight.severity, .info)
        XCTAssertEqual(insight.trend, .up)
        XCTAssertTrue(insight.trendGood)
        guard case let .chargingCost(avgCost, branch) = insight.facts else { return XCTFail("facts") }
        XCTAssertEqual(avgCost, 0.2, accuracy: 1e-9)
        guard case let .homeSaves(savingsPct) = branch else { return XCTFail("branch") }
        XCTAssertEqual(savingsPct, 67.647058, accuracy: 1e-4)
    }

    func testHomeHigherBranch() throws {
        let sessions = [
            InsightsEngineCharging(cost: 12, chargeEnergyAdded: 30, fastChargerType: nil, endBatteryLevel: nil),
            InsightsEngineCharging(cost: 4, chargeEnergyAdded: 40, fastChargerType: "dc", endBatteryLevel: nil),
            InsightsEngineCharging(cost: 5, chargeEnergyAdded: 50, fastChargerType: "dc", endBatteryLevel: nil)
        ]
        let insight = try XCTUnwrap(InsightsEngineAnalyzers.chargingCost(sessions))
        XCTAssertEqual(insight.trend, .down)
        XCTAssertFalse(insight.trendGood)
        guard case let .chargingCost(_, branch) = insight.facts, case .homeHigher = branch else {
            return XCTFail("expected homeHigher")
        }
    }

    func testOverallOnlyWhenNoSupercharger() throws {
        let sessions = [
            InsightsEngineCharging(cost: 5, chargeEnergyAdded: 40, fastChargerType: nil, endBatteryLevel: nil),
            InsightsEngineCharging(cost: 6, chargeEnergyAdded: 45, fastChargerType: "", endBatteryLevel: nil)
        ]
        let insight = try XCTUnwrap(InsightsEngineAnalyzers.chargingCost(sessions))
        XCTAssertEqual(insight.trend, .neutral)
        guard case let .chargingCost(_, branch) = insight.facts, case .overallOnly = branch else {
            return XCTFail("expected overallOnly (empty string charger type is falsy → home)")
        }
    }

    func testGatedBelowTwoWithCost() {
        let sessions = [
            InsightsEngineCharging(cost: 5, chargeEnergyAdded: 40, fastChargerType: nil, endBatteryLevel: nil),
            InsightsEngineCharging(cost: nil, chargeEnergyAdded: 40, fastChargerType: nil, endBatteryLevel: nil),
            InsightsEngineCharging(cost: 9, chargeEnergyAdded: 0, fastChargerType: nil, endBatteryLevel: nil)
        ]
        XCTAssertNil(InsightsEngineAnalyzers.chargingCost(sessions))
    }
}

// MARK: - Efficiency trend

final class InsightsEngineEfficiencyTests: XCTestCase {
    private func drive(_ distanceM: Double, _ energyWh: Double?) -> InsightsEngineDrive {
        InsightsEngineDrive(distanceM: distanceM, energyUsedWh: energyWh, startTs: Date())
    }

    func testImproved() throws {
        let drives = [drive(10000, 1500), drive(12000, 1700), drive(11000, 2000), drive(9000, 1800)]
        let insight = try XCTUnwrap(InsightsEngineAnalyzers.efficiencyTrend(drives))
        XCTAssertEqual(insight.id, "efficiency-trend")
        XCTAssertEqual(insight.severity, .success)
        XCTAssertEqual(insight.trend, .up)
        XCTAssertTrue(insight.trendGood)
        guard case let .efficiencyTrend(magnitudePct, improved) = insight.facts else { return XCTFail("facts") }
        XCTAssertTrue(improved)
        XCTAssertEqual(magnitudePct, 23.4449, accuracy: 1e-3)
    }

    func testDeclined() throws {
        let drives = [drive(11000, 2200), drive(9000, 1900), drive(10000, 1400), drive(12000, 1600)]
        let insight = try XCTUnwrap(InsightsEngineAnalyzers.efficiencyTrend(drives))
        XCTAssertEqual(insight.severity, .warning)
        XCTAssertEqual(insight.trend, .down)
        XCTAssertFalse(insight.trendGood)
        guard case let .efficiencyTrend(magnitudePct, improved) = insight.facts else { return XCTFail("facts") }
        XCTAssertFalse(improved)
        XCTAssertEqual(magnitudePct, 50.3333, accuracy: 1e-3)
    }

    func testGatedBelowFourValid() {
        let drives = [drive(10000, 1500), drive(0, 1700), drive(11000, nil), drive(9000, 1800)]
        XCTAssertNil(InsightsEngineAnalyzers.efficiencyTrend(drives))
    }
}

// MARK: - Battery health

final class InsightsEngineBatteryHealthTests: XCTestCase {
    private func report(
        health: Double,
        capacity: Double,
        degradation: Double,
        trend: [Double]
    ) -> InsightsEngineBatteryReport {
        InsightsEngineBatteryReport(
            healthScore: health,
            currentCapacityPct: capacity,
            degradationPct: degradation,
            monthlyTrend: trend.map { InsightsEngineBatteryTrendPoint(capacityPct: $0) },
            estimatedRangeNewKm: nil,
            estimatedRangeCurrentKm: nil
        )
    }

    func testAgingExpectedUsesTrendRate() throws {
        let insight = try XCTUnwrap(
            InsightsEngineAnalyzers.batteryHealth(report(health: 92, capacity: 94, degradation: 6, trend: [96, 94]))
        )
        XCTAssertEqual(insight.severity, .success)
        XCTAssertEqual(insight.trend, .up)
        XCTAssertTrue(insight.trendGood)
        guard case let .batteryHealth(healthPct, yearlyRatePct, aging) = insight.facts else { return XCTFail("facts") }
        XCTAssertEqual(healthPct, 94, accuracy: 1e-9)
        XCTAssertEqual(yearlyRatePct, 12, accuracy: 1e-9)
        XCTAssertEqual(aging, .expected)
    }

    func testAgingWorseWhenHighDegradation() throws {
        let insight = try XCTUnwrap(
            InsightsEngineAnalyzers.batteryHealth(report(health: 80, capacity: 88, degradation: 12, trend: []))
        )
        XCTAssertEqual(insight.severity, .warning)
        XCTAssertEqual(insight.trend, .down)
        XCTAssertFalse(insight.trendGood)
        guard case let .batteryHealth(_, yearlyRatePct, aging) = insight.facts else { return XCTFail("facts") }
        XCTAssertEqual(yearlyRatePct, 12, accuracy: 1e-9)
        XCTAssertEqual(aging, .worse)
    }

    func testAgingBetterWhenLowDegradation() throws {
        let insight = try XCTUnwrap(
            InsightsEngineAnalyzers.batteryHealth(report(health: 98, capacity: 97, degradation: 3, trend: [98, 97, 96]))
        )
        XCTAssertEqual(insight.severity, .success)
        guard case let .batteryHealth(_, yearlyRatePct, aging) = insight.facts else { return XCTFail("facts") }
        XCTAssertEqual(yearlyRatePct, 8, accuracy: 1e-9)
        XCTAssertEqual(aging, .better)
    }

    func testGatedWhenHealthScoreZero() {
        XCTAssertNil(
            InsightsEngineAnalyzers.batteryHealth(report(health: 0, capacity: 94, degradation: 6, trend: [96, 94]))
        )
    }
}

// MARK: - Optimal charging

final class InsightsEngineOptimalChargingTests: XCTestCase {
    private func session(_ endLevel: Double?) -> InsightsEngineCharging {
        InsightsEngineCharging(cost: nil, chargeEnergyAdded: 0, fastChargerType: nil, endBatteryLevel: endLevel)
    }

    func testIdealHabit() throws {
        let insight = try XCTUnwrap(InsightsEngineAnalyzers.optimalCharging([session(70), session(75), session(90)]))
        XCTAssertEqual(insight.severity, .success)
        XCTAssertEqual(insight.trend, .up)
        XCTAssertTrue(insight.trendGood)
        guard case let .optimalCharging(avgEndLevel, branch) = insight.facts else { return XCTFail("facts") }
        XCTAssertEqual(avgEndLevel, 78.3333, accuracy: 1e-3)
        guard case .ideal = branch else { return XCTFail("expected ideal") }
    }

    func testExceedsEightyPercent() throws {
        let insight = try XCTUnwrap(
            InsightsEngineAnalyzers.optimalCharging([session(85), session(90), session(95), session(60)])
        )
        XCTAssertEqual(insight.severity, .warning)
        XCTAssertEqual(insight.trend, .down)
        XCTAssertFalse(insight.trendGood)
        guard case let .optimalCharging(avgEndLevel, branch) = insight.facts else { return XCTFail("facts") }
        XCTAssertEqual(avgEndLevel, 82.5, accuracy: 1e-9)
        guard case let .exceeds(above80Pct) = branch else { return XCTFail("facts") }
        XCTAssertEqual(above80Pct, 75, accuracy: 1e-9)
    }

    func testGatedBelowThreeWithEndLevel() {
        XCTAssertNil(InsightsEngineAnalyzers.optimalCharging([session(70), session(nil), session(80)]))
    }
}

// MARK: - Vampire drain

final class InsightsEngineVampireDrainTests: XCTestCase {
    func testSentryHeavy() throws {
        let stats = InsightsEngineVampireDrain(
            avgDrainRate: 0.8, totalRangeLost: 25.4, avgSentryDrain: 1.2, avgNosentryDrain: 0.9, eventCount: 14
        )
        let insight = try XCTUnwrap(InsightsEngineAnalyzers.vampireDrain(stats))
        XCTAssertEqual(insight.severity, .warning)
        XCTAssertEqual(insight.trend, .down)
        XCTAssertFalse(insight.trendGood)
        guard case let .vampireDrain(branch) = insight.facts, case let .sentry(diffPct, daily) = branch else {
            return XCTFail("expected sentry branch")
        }
        XCTAssertEqual(diffPct, 33.3333, accuracy: 1e-3)
        XCTAssertEqual(daily, 28.8, accuracy: 1e-9)
    }

    func testGeneralWhenLowDifference() throws {
        let stats = InsightsEngineVampireDrain(
            avgDrainRate: 0.5, totalRangeLost: 10, avgSentryDrain: 0.5, avgNosentryDrain: 0.45, eventCount: 5
        )
        let insight = try XCTUnwrap(InsightsEngineAnalyzers.vampireDrain(stats))
        XCTAssertEqual(insight.severity, .info)
        XCTAssertEqual(insight.trend, .neutral)
        XCTAssertTrue(insight.trendGood)
        guard case let .vampireDrain(branch) = insight.facts, case let .general(rate, lost, count) = branch else {
            return XCTFail("expected general branch")
        }
        XCTAssertEqual(rate, 0.5, accuracy: 1e-9)
        XCTAssertEqual(lost, 10, accuracy: 1e-9)
        XCTAssertEqual(count, 5)
    }

    func testGatedWhenNoEvents() {
        let stats = InsightsEngineVampireDrain(
            avgDrainRate: 0.5, totalRangeLost: 10, avgSentryDrain: 0.5, avgNosentryDrain: 0.45, eventCount: 0
        )
        XCTAssertNil(InsightsEngineAnalyzers.vampireDrain(stats))
    }

    func testGatedWhenNoDrain() {
        let stats = InsightsEngineVampireDrain(
            avgDrainRate: 0, totalRangeLost: 0, avgSentryDrain: 0, avgNosentryDrain: 0, eventCount: 3
        )
        XCTAssertNil(InsightsEngineAnalyzers.vampireDrain(stats))
    }
}

// MARK: - Driving patterns

final class InsightsEngineDrivingPatternsTests: XCTestCase {
    func testBusiestDayAndPeakHour() throws {
        let drives = [
            InsightsEngineDrive(distanceM: 30000, energyUsedWh: nil, startTs: utcDate(2023, 1, 3, 8)),
            InsightsEngineDrive(distanceM: 20000, energyUsedWh: nil, startTs: utcDate(2023, 1, 2, 9)),
            InsightsEngineDrive(distanceM: 10000, energyUsedWh: nil, startTs: utcDate(2023, 1, 2, 8))
        ]
        let insight = try XCTUnwrap(InsightsEngineAnalyzers.drivingPatterns(drives, calendar: utcCalendar))
        XCTAssertEqual(insight.severity, .info)
        XCTAssertEqual(insight.trend, .neutral)
        guard case let .drivingPatterns(avgDailyKm, busiestDay, peakHour, peakEnd) = insight.facts else {
            return XCTFail("facts")
        }
        XCTAssertEqual(avgDailyKm, 60, accuracy: 1e-9)
        XCTAssertEqual(busiestDay, .monday)
        XCTAssertEqual(peakHour, 8)
        XCTAssertEqual(peakEnd, 9)
    }

    func testGatedBelowThreeDrives() {
        let drives = [
            InsightsEngineDrive(distanceM: 1000, energyUsedWh: nil, startTs: utcDate(2023, 1, 2, 8)),
            InsightsEngineDrive(distanceM: 1000, energyUsedWh: nil, startTs: utcDate(2023, 1, 3, 8))
        ]
        XCTAssertNil(InsightsEngineAnalyzers.drivingPatterns(drives, calendar: utcCalendar))
    }
}

// MARK: - Cost savings + range optimization

final class InsightsEngineEnergyInsightTests: XCTestCase {
    private func energy(
        kwh: Double = 500, distanceKm: Double = 3000, cost: Double = 60, co2: Double = 400, eff: Double = 160
    ) -> InsightsEngineEnergyStats {
        InsightsEngineEnergyStats(
            totalEnergyUsedKwh: kwh, totalDistanceKm: distanceKm, totalCost: cost, co2SavedKg: co2,
            avgEfficiencyWhKm: eff
        )
    }

    func testCostSavings() throws {
        let insight = try XCTUnwrap(InsightsEngineAnalyzers.costSavings(energy()))
        XCTAssertEqual(insight.severity, .success)
        XCTAssertEqual(insight.trend, .up)
        guard case let .costSavings(savings, kwh, distanceKm, co2) = insight.facts else { return XCTFail("facts") }
        XCTAssertEqual(savings, 322.5, accuracy: 1e-9)
        XCTAssertEqual(kwh, 500, accuracy: 1e-9)
        XCTAssertEqual(distanceKm, 3000, accuracy: 1e-9)
        XCTAssertEqual(co2, 400, accuracy: 1e-9)
    }

    func testCostSavingsGatedWhenNoSavings() {
        XCTAssertNil(InsightsEngineAnalyzers.costSavings(energy(distanceKm: 10)))
        XCTAssertNil(InsightsEngineAnalyzers.costSavings(energy(kwh: 0)))
    }

    func testRangeOptimizationSuccess() throws {
        let battery = InsightsEngineBatteryReport(
            healthScore: 90, currentCapacityPct: 94, degradationPct: 6, monthlyTrend: [],
            estimatedRangeNewKm: 500, estimatedRangeCurrentKm: 470
        )
        let insight = try XCTUnwrap(InsightsEngineAnalyzers.rangeOptimization(energy(), battery: battery))
        XCTAssertEqual(insight.severity, .success)
        XCTAssertEqual(insight.trend, .up)
        guard case let .rangeOptimization(effWhKm, effectiveRangeKm, rangePct, hint) = insight.facts else {
            return XCTFail("facts")
        }
        XCTAssertEqual(effWhKm, 160, accuracy: 1e-9)
        XCTAssertEqual(effectiveRangeKm, 440.625, accuracy: 1e-6)
        XCTAssertEqual(rangePct, 93.75, accuracy: 1e-9)
        XCTAssertEqual(hint, .efficient)
    }

    func testRangeOptimizationWarningWithDefaults() throws {
        let insight = try XCTUnwrap(InsightsEngineAnalyzers.rangeOptimization(energy(eff: 200), battery: nil))
        XCTAssertEqual(insight.severity, .warning)
        XCTAssertEqual(insight.trend, .down)
        XCTAssertFalse(insight.trendGood)
        guard case let .rangeOptimization(_, _, rangePct, hint) = insight.facts else { return XCTFail("facts") }
        XCTAssertEqual(rangePct, 75, accuracy: 1e-9)
        XCTAssertEqual(hint, .precondition)
    }

    func testRangeOptimizationGatedWhenNoEfficiency() {
        XCTAssertNil(InsightsEngineAnalyzers.rangeOptimization(energy(eff: 0), battery: nil))
    }
}

// MARK: - Formatting (web `fmtNumber` + `formatCurrency`)

final class InsightsEngineFormattingTests: XCTestCase {
    private let fmt = InsightsEngineFormatting(
        InsightsEngineFormattingContext(currencySymbol: "$", localeIdentifier: "en_US")
    )

    func testFixedPrecisionWithGrouping() {
        XCTAssertEqual(fmt.number(1234.5, decimals: 1), "1,234.5")
        XCTAssertEqual(fmt.number(0.2, decimals: 2), "0.20")
        XCTAssertEqual(fmt.number(3000, decimals: 0), "3,000")
    }

    func testRoundingAwayFromZero() {
        XCTAssertEqual(fmt.number(67.647, decimals: 0), "68")
        XCTAssertEqual(fmt.number(322.5, decimals: 0), "323")
        XCTAssertEqual(fmt.number(440.625, decimals: 0), "441")
    }

    func testNonFiniteCoercesToZero() {
        XCTAssertEqual(fmt.number(.infinity, decimals: 2), "0.00")
        XCTAssertEqual(fmt.number(.nan, decimals: 0), "0")
    }

    func testCurrencyPrependsSymbol() {
        XCTAssertEqual(fmt.currency(0.2, decimals: 2), "$0.20")
        XCTAssertEqual(fmt.currency(323, decimals: 0), "$323")
    }

    func testBlankCurrencySymbolUsesDollarFallback() {
        let blank = InsightsEngineFormatting(InsightsEngineFormattingContext(currencySymbol: "   "))
        XCTAssertEqual(blank.currency(1, decimals: 0), "$1")
    }

    func testCustomCurrencySymbol() {
        let euro = InsightsEngineFormatting(
            InsightsEngineFormattingContext(currencySymbol: "€", localeIdentifier: "en_US")
        )
        XCTAssertEqual(euro.currency(1234, decimals: 0), "€1,234")
    }
}
