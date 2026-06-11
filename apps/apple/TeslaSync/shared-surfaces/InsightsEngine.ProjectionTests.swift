//
//  InsightsEngine.ProjectionTests.swift
//  TeslaSync — P4 shared surface · 0092 · InsightsEngine (Apple)
//
//  Coverage for the projection (the exact localized + formatted prose per insight, the phase
//  resolution, the web build order, and the VoiceOver label), and for the state holder
//  (`InsightsEngineModel`): the P1/S11 `view.opened`-once telemetry, the stale one-shot auto-refresh +
//  re-arm, the offline no-refetch rule, and the refresh / stop delegation.
//
//  In the test bundle the per-surface strings table is absent, so the i18n facade returns the web
//  English `value:` fallbacks — which these assertions pin verbatim.
//

import XCTest
@testable import TeslaSync

private let enUS = InsightsEngineFormatting(
    InsightsEngineFormattingContext(currencySymbol: "$", localeIdentifier: "en_US")
)

private func computation(
    id: String = "x",
    icon: InsightsEngineIcon,
    severity: InsightsEngineSeverity = .info,
    trend: InsightsEngineTrend = .neutral,
    trendGood: Bool = true,
    facts: InsightsEngineFacts
) -> InsightsEngineComputation {
    InsightsEngineComputation(id: id, icon: icon, severity: severity, trend: trend, trendGood: trendGood, facts: facts)
}

private func text(_ icon: InsightsEngineIcon, _ facts: InsightsEngineFacts) -> String {
    InsightsEngineProjection.resolve(computation(icon: icon, facts: facts), formatting: enUS).description
}

// MARK: - Charging cost prose

final class InsightsEngineChargingCostProseTests: XCTestCase {
    func testHomeSaves() {
        let result = text(.chargingCost, .chargingCost(avgCost: 0.2, branch: .homeSaves(savingsPct: 67.647)))
        XCTAssertEqual(
            result,
            "Your average charging cost is $0.20/kWh. Home charging saves you 68% compared to Supercharging."
        )
    }

    func testHomeHigher() {
        let result = text(.chargingCost, .chargingCost(avgCost: 0.2, branch: .homeHigher))
        XCTAssertEqual(
            result,
            "Your average charging cost is $0.20/kWh. "
                + "Your home electricity rate is higher than Supercharger rates — consider off-peak charging."
        )
    }

    func testOverallOnly() {
        let result = text(.chargingCost, .chargingCost(avgCost: 0.2, branch: .overallOnly))
        XCTAssertEqual(result, "Your average charging cost is $0.20/kWh.")
    }
}

// MARK: - Remaining insight prose

final class InsightsEngineProseTests: XCTestCase {
    func testEfficiencyImproved() {
        let result = text(.efficiency, .efficiencyTrend(magnitudePct: 23.4449, improved: true))
        XCTAssertEqual(
            result,
            "Your driving efficiency improved 23.4% in recent drives compared to earlier drives. "
                + "Keep up the smooth driving!"
        )
    }

    func testEfficiencyDeclined() {
        let result = text(.efficiency, .efficiencyTrend(magnitudePct: 50.3333, improved: false))
        XCTAssertEqual(
            result,
            "Your driving efficiency decreased 50.3% in recent drives. "
                + "Consider gentler acceleration and highway cruise control."
        )
    }

    func testBatteryHealthExpected() {
        let result = text(.battery, .batteryHealth(healthPct: 94, yearlyRatePct: 12, aging: .expected))
        XCTAssertEqual(
            result,
            "Battery health is at 94.0%. Degradation rate is 12.0% per year — your battery is aging as expected."
        )
    }

    func testBatteryHealthWorse() {
        let result = text(.battery, .batteryHealth(healthPct: 88, yearlyRatePct: 12, aging: .worse))
        XCTAssertEqual(
            result,
            "Battery health is at 88.0%. Degradation rate is 12.0% per year — "
                + "your battery is aging worse than average."
        )
    }

    func testOptimalIdeal() {
        let result = text(.optimalCharging, .optimalCharging(avgEndLevel: 78, branch: .ideal))
        XCTAssertEqual(
            result,
            "You charge most often to 78%. "
                + "Great habit — most of your charges stay within the ideal 20–80% range for battery longevity."
        )
    }

    func testOptimalExceeds() {
        let result = text(.optimalCharging, .optimalCharging(avgEndLevel: 82, branch: .exceeds(above80Pct: 75)))
        XCTAssertEqual(
            result,
            "You charge most often to 82%. 75% of your charges exceed 80%. "
                + "For battery longevity, consider keeping charges between 20–80%."
        )
    }

    func testVampireSentry() {
        let result = text(.vampireDrain, .vampireDrain(.sentry(diffPct: 33.3333, dailyRangeLoss: 28.8)))
        XCTAssertEqual(
            result,
            "Sentry Mode increases battery drain by 33%. "
                + "Consider disabling it at home to save ~28.8 km of range daily."
        )
    }

    func testVampireGeneral() {
        let result = text(.vampireDrain, .vampireDrain(.general(drainRate: 0.5, rangeLost: 10, eventCount: 5)))
        XCTAssertEqual(
            result,
            "Average vampire drain is 0.50 %/hr. Total range lost to idle drain: 10.0 km across 5 events."
        )
    }

    func testDrivingPatterns() {
        let facts = InsightsEngineFacts.drivingPatterns(avgDailyKm: 60, busiestDay: .monday, peakHour: 8, peakEnd: 9)
        let result = text(.drivingPatterns, facts)
        XCTAssertEqual(
            result,
            "You drive an average of 60.0 km/day. Your most active day is Monday. Peak driving time: 8:00–9:00."
        )
    }

    func testCostSavings() {
        let facts = InsightsEngineFacts.costSavings(savings: 322.5, kwh: 500, distanceKm: 3000, co2Kg: 400)
        let result = text(.costSavings, facts)
        XCTAssertEqual(
            result,
            "You've saved approximately $323 vs. gasoline based on 500 kWh consumed over 3,000 km. "
                + "That's also 400 kg of CO₂ saved!"
        )
    }

    func testRangeOptimizationEfficient() {
        let facts = InsightsEngineFacts.rangeOptimization(
            effWhKm: 160, effectiveRangeKm: 440.625, rangePct: 93.75, hint: .efficient
        )
        let result = text(.rangeOptimization, facts)
        XCTAssertEqual(
            result,
            "At your average efficiency of 160 Wh/km, your effective range is ~441 km (94% of rated range). "
                + "Your driving style is range-efficient — great work!"
        )
    }

    func testRangeOptimizationPrecondition() {
        let facts = InsightsEngineFacts.rangeOptimization(
            effWhKm: 200, effectiveRangeKm: 375, rangePct: 75, hint: .precondition
        )
        let result = text(.rangeOptimization, facts)
        XCTAssertEqual(
            result,
            "At your average efficiency of 200 Wh/km, your effective range is ~375 km (75% of rated range). "
                + "Consider preconditioning and reducing highway speed for better range."
        )
    }
}

// MARK: - Titles + accessibility

final class InsightsEngineResolvedInsightTests: XCTestCase {
    func testTitleAndAccessibilityLabelCompose() {
        let resolved = InsightsEngineProjection.resolve(
            computation(
                id: "charging-cost",
                icon: .chargingCost,
                severity: .info,
                trend: .up,
                trendGood: true,
                facts: .chargingCost(avgCost: 0.2, branch: .homeSaves(savingsPct: 67.647))
            ),
            formatting: enUS
        )
        XCTAssertEqual(resolved.title, "Charging Cost")
        XCTAssertEqual(
            resolved.accessibilityLabel,
            "Charging Cost. Trending up. "
                + "Your average charging cost is $0.20/kWh. Home charging saves you 68% compared to Supercharging."
        )
    }

    func testTitlesForEachIcon() {
        let expected: [InsightsEngineIcon: String] = [
            .chargingCost: "Charging Cost",
            .efficiency: "Efficiency Trend",
            .battery: "Battery Health",
            .optimalCharging: "Optimal Charging",
            .vampireDrain: "Vampire Drain",
            .drivingPatterns: "Driving Patterns",
            .costSavings: "EV Cost Savings",
            .rangeOptimization: "Range Optimization"
        ]
        for (icon, title) in expected {
            XCTAssertEqual(InsightsEngineProjection.title(for: icon), title)
        }
    }
}

// MARK: - Phase resolution + build order

private var utcCalendar: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    return calendar
}

private func fullSampleData() -> InsightsEngineData {
    let base = Date(timeIntervalSince1970: 1_700_000_000)
    return InsightsEngineData(
        drives: [
            InsightsEngineDrive(distanceM: 10000, energyUsedWh: 1500, startTs: base),
            InsightsEngineDrive(distanceM: 12000, energyUsedWh: 1700, startTs: base - 86400),
            InsightsEngineDrive(distanceM: 11000, energyUsedWh: 2000, startTs: base - 2 * 86400),
            InsightsEngineDrive(distanceM: 9000, energyUsedWh: 1800, startTs: base - 3 * 86400)
        ],
        chargingSessions: [
            InsightsEngineCharging(cost: 5, chargeEnergyAdded: 40, fastChargerType: nil, endBatteryLevel: 70),
            InsightsEngineCharging(cost: 6, chargeEnergyAdded: 45, fastChargerType: nil, endBatteryLevel: 75),
            InsightsEngineCharging(
                cost: 12,
                chargeEnergyAdded: 30,
                fastChargerType: "supercharger",
                endBatteryLevel: 90
            )
        ],
        energyStats: InsightsEngineEnergyStats(
            totalEnergyUsedKwh: 500, totalDistanceKm: 3000, totalCost: 60, co2SavedKg: 400, avgEfficiencyWhKm: 160
        ),
        batteryReport: InsightsEngineBatteryReport(
            healthScore: 92, currentCapacityPct: 94, degradationPct: 6,
            monthlyTrend: [
                InsightsEngineBatteryTrendPoint(capacityPct: 96),
                InsightsEngineBatteryTrendPoint(capacityPct: 94)
            ],
            estimatedRangeNewKm: 500, estimatedRangeCurrentKm: 470
        ),
        vampireDrainStats: InsightsEngineVampireDrain(
            avgDrainRate: 0.8, totalRangeLost: 25.4, avgSentryDrain: 1.2, avgNosentryDrain: 0.9, eventCount: 14
        )
    )
}

final class InsightsEnginePhaseTests: XCTestCase {
    func testLoadingPhase() {
        let resolved = InsightsEngineProjection.resolve(InsightsEngineInput(load: .loading))
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertTrue(resolved.insights.isEmpty)
    }

    func testErrorPhase() {
        let resolved = InsightsEngineProjection.resolve(InsightsEngineInput(load: .failed("boom")))
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testEmptyPhaseWhenNoInsights() {
        let resolved = InsightsEngineProjection.resolve(InsightsEngineInput(load: .loaded(InsightsEngineData())))
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertTrue(resolved.insights.isEmpty)
    }

    func testReadyBuildsAllInsightsInWebOrder() {
        let resolved = InsightsEngineProjection.resolve(
            InsightsEngineInput(load: .loaded(fullSampleData())),
            calendar: utcCalendar
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertEqual(
            resolved.insights.map(\.id),
            [
                "charging-cost", "efficiency-trend", "battery-health", "optimal-charging",
                "vampire-drain", "driving-patterns", "cost-savings", "range-optimization"
            ]
        )
    }
}

// MARK: - State holder (model lifecycle)

private final class SpyInsightsEngineTelemetry: InsightsEngineTelemetry, @unchecked Sendable {
    private(set) var opened: [String] = []
    func viewOpened(surface: String) {
        opened.append(surface)
    }
}

@MainActor
final class InsightsEngineModelTests: XCTestCase {
    func testEmitsViewOpenedExactlyOnce() {
        let telemetry = SpyInsightsEngineTelemetry()
        let model = InsightsEngineModel(source: InMemoryInsightsEngineSource(), telemetry: telemetry)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(telemetry.opened, [InsightsEngine.surfaceSlug])
    }

    func testPhaseTracksPushedSnapshots() {
        let source = InMemoryInsightsEngineSource()
        let model = InsightsEngineModel(source: source, calendar: utcCalendar)
        model.start()
        source.push(InsightsEngineInput(load: .loading))
        XCTAssertEqual(model.phase, .loading)
        source.push(InsightsEngineInput(load: .failed("nope")))
        XCTAssertEqual(model.phase, .error("nope"))
        source.push(InsightsEngineInput(load: .loaded(InsightsEngineData())))
        XCTAssertEqual(model.phase, .empty)
        source.push(InsightsEngineInput(load: .loaded(fullSampleData())))
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.insights.count, 8)
    }

    func testStaleAutoRefreshesOncePerEpisodeAndReArms() {
        let source = InMemoryInsightsEngineSource()
        let model = InsightsEngineModel(source: source)
        model.start()
        source.push(InsightsEngineInput(load: .loaded(fullSampleData()), connection: .live))
        XCTAssertEqual(source.refreshCount, 0)
        source.push(InsightsEngineInput(load: .loaded(fullSampleData()), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(InsightsEngineInput(load: .loaded(fullSampleData()), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "stale should auto-refresh only once per episode")
        source.push(InsightsEngineInput(load: .loaded(fullSampleData()), connection: .live))
        source.push(InsightsEngineInput(load: .loaded(fullSampleData()), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2, "a new stale episode re-triggers exactly once")
    }

    func testOfflineDoesNotRefetch() {
        let source = InMemoryInsightsEngineSource()
        let model = InsightsEngineModel(source: source)
        model.start()
        source.push(InsightsEngineInput(load: .loaded(fullSampleData()), connection: .offline))
        XCTAssertEqual(source.refreshCount, 0)
        XCTAssertEqual(model.connection, .offline)
    }

    func testRefreshAndStopForwardToSource() {
        let source = InMemoryInsightsEngineSource()
        let model = InsightsEngineModel(source: source)
        model.start()
        model.refresh()
        model.stop()
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(source.startCount, 1)
    }
}
