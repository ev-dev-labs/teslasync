//
//  ChargingSessionCard.Tests.swift
//  TeslaSync — P4 feature view · 0107 · ChargingSessionCard (Apple)
//
//  Adapter + scale + projection + formatting + label/accessibility coverage for
//  the ChargingSessionCard surface (the model/state-holder coverage lives in
//  `ChargingSessionCard.ModelTests`). Each test ports a web computation or branch.
//  These run in the TeslaSync(/-macOS) XCTest targets — no network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: numeric guard

final class ChargingSessionNumericTests: XCTestCase {
    func testSafeReturnsFiniteValuesElseZero() {
        XCTAssertEqual(ChargingSessionNumeric.safe(42.5), 42.5)
        XCTAssertEqual(ChargingSessionNumeric.safe(0), 0)
        XCTAssertEqual(ChargingSessionNumeric.safe(nil), 0)
        XCTAssertEqual(ChargingSessionNumeric.safe(.nan), 0)
        XCTAssertEqual(ChargingSessionNumeric.safe(.infinity), 0)
    }
}

// MARK: - Adapter: charger category (port of `getChargerCategory`)

final class ChargerKindTests: XCTestCase {
    func testMissingOrEmptyTypeIsHome() {
        XCTAssertEqual(ChargerKind.category(forType: nil), .home)
        XCTAssertEqual(ChargerKind.category(forType: ""), .home)
    }

    func testSuperchargerMatches() {
        XCTAssertEqual(ChargerKind.category(forType: "Supercharger V3"), .supercharger)
        XCTAssertEqual(ChargerKind.category(forType: "TPC"), .supercharger)
    }

    func testDcMatches() {
        XCTAssertEqual(ChargerKind.category(forType: "CCS"), .dc)
        XCTAssertEqual(ChargerKind.category(forType: "CHAdeMO"), .dc)
        XCTAssertEqual(ChargerKind.category(forType: "DC Fast"), .dc)
        XCTAssertEqual(ChargerKind.category(forType: "fast"), .dc)
    }

    func testHomeMatches() {
        XCTAssertEqual(ChargerKind.category(forType: "Home"), .home)
        XCTAssertEqual(ChargerKind.category(forType: "AC"), .home)
        XCTAssertEqual(ChargerKind.category(forType: "Wall Connector"), .home)
    }

    func testUnknownFallthrough() {
        XCTAssertEqual(ChargerKind.category(forType: "Mystery"), .unknown)
    }

    func testBadgeToneAndGlow() {
        XCTAssertEqual(ChargerKind.supercharger.badgeTone, .danger)
        XCTAssertEqual(ChargerKind.dc.badgeTone, .warning)
        XCTAssertEqual(ChargerKind.home.badgeTone, .success)
        XCTAssertEqual(ChargerKind.unknown.badgeTone, .success)
        XCTAssertEqual(ChargerKind.supercharger.glow, .cyan)
        XCTAssertEqual(ChargerKind.home.glow, .green)
        XCTAssertEqual(ChargerKind.dc.glow, .green)
    }
}

// MARK: - Scale: per-session helpers

final class ChargingSessionMetricsTests: XCTestCase {
    private func session(
        start: TimeInterval?,
        end: TimeInterval?,
        energyWh: Double = 0,
        avgPowerW: Double? = nil,
        cost: Double? = nil,
        odoStart: Double? = nil,
        odoEnd: Double? = nil
    ) -> ChargingSessionSummary {
        ChargingSessionSummary(
            id: 1,
            startedAt: start.map { Date(timeIntervalSince1970: $0) },
            endedAt: end.map { Date(timeIntervalSince1970: $0) },
            totalEnergyAddedWh: energyWh,
            avgPowerW: avgPowerW,
            costDecimal: cost,
            odometerStartM: odoStart,
            odometerEndM: odoEnd
        )
    }

    func testDurationMinutes() {
        XCTAssertEqual(ChargingSessionMetrics.durationMinutes(session(start: 0, end: 2160)), 36, accuracy: 0.0001)
        XCTAssertEqual(ChargingSessionMetrics.durationMinutes(session(start: nil, end: 60)), 0)
        XCTAssertEqual(ChargingSessionMetrics.durationMinutes(session(start: 100, end: 100)), 0)
        XCTAssertEqual(ChargingSessionMetrics.durationMinutes(session(start: 200, end: 100)), 0)
    }

    func testAvgPowerWPrefersEnergyOverTimeThenFallsBack() {
        let computed = ChargingSessionMetrics.avgPowerW(session(start: 0, end: 2160, energyWh: 42500))
        XCTAssertEqual(computed, 70833.33, accuracy: 0.5)
        XCTAssertEqual(ChargingSessionMetrics.avgPowerW(session(start: nil, end: nil, avgPowerW: 8000)), 8000)
        XCTAssertEqual(ChargingSessionMetrics.avgPowerW(session(start: nil, end: nil)), 0)
    }

    func testCostPerKwh() {
        XCTAssertEqual(
            ChargingSessionMetrics.costPerKwh(session(start: 0, end: 2160, energyWh: 42500, cost: 13.6)) ?? -1,
            0.32,
            accuracy: 0.0001
        )
        XCTAssertNil(ChargingSessionMetrics.costPerKwh(session(start: 0, end: 60, energyWh: 0, cost: 5)))
        XCTAssertNil(ChargingSessionMetrics.costPerKwh(session(start: 0, end: 60, energyWh: 1000, cost: nil)))
        XCTAssertNil(ChargingSessionMetrics.costPerKwh(session(start: 0, end: 60, energyWh: 1000, cost: 0)))
    }

    func testDistanceAddedM() {
        XCTAssertEqual(
            ChargingSessionMetrics.distanceAddedM(session(start: 0, end: 60, odoStart: 1000, odoEnd: 1200)) ?? -1,
            200,
            accuracy: 0.0001
        )
        XCTAssertNil(ChargingSessionMetrics.distanceAddedM(session(start: 0, end: 60, odoStart: nil, odoEnd: 1200)))
        XCTAssertNil(ChargingSessionMetrics.distanceAddedM(session(start: 0, end: 60, odoStart: 1200, odoEnd: 1200)))
        XCTAssertNil(ChargingSessionMetrics.distanceAddedM(session(start: 0, end: 60, odoStart: 1200, odoEnd: 1000)))
    }

    func testBatteryFriendlyScoreInlineAlgorithm() {
        XCTAssertEqual(ChargingSessionMetrics.batteryFriendlyScore(startPct: 18, endPct: 72), 100)
        XCTAssertEqual(ChargingSessionMetrics.batteryFriendlyScore(startPct: 42, endPct: 80), 85)
        XCTAssertEqual(ChargingSessionMetrics.batteryFriendlyScore(startPct: 90, endPct: 100), 15)
        XCTAssertEqual(ChargingSessionMetrics.batteryFriendlyScore(startPct: 60, endPct: 85), 50)
        XCTAssertNil(ChargingSessionMetrics.batteryFriendlyScore(startPct: nil, endPct: 80))
        XCTAssertNil(ChargingSessionMetrics.batteryFriendlyScore(startPct: 20, endPct: nil))
    }
}

// MARK: - Scale: A–F grade (port of `numericToGrade`)

final class ChargingScoreGradeTests: XCTestCase {
    func testThresholds() {
        XCTAssertEqual(ChargingScoreGrade.grade(forScore: 100), .gradeAPlus)
        XCTAssertEqual(ChargingScoreGrade.grade(forScore: 90), .gradeAPlus)
        XCTAssertEqual(ChargingScoreGrade.grade(forScore: 89.9), .gradeA)
        XCTAssertEqual(ChargingScoreGrade.grade(forScore: 80), .gradeA)
        XCTAssertEqual(ChargingScoreGrade.grade(forScore: 79), .gradeB)
        XCTAssertEqual(ChargingScoreGrade.grade(forScore: 65), .gradeB)
        XCTAssertEqual(ChargingScoreGrade.grade(forScore: 64), .gradeC)
        XCTAssertEqual(ChargingScoreGrade.grade(forScore: 50), .gradeC)
        XCTAssertEqual(ChargingScoreGrade.grade(forScore: 49), .gradeD)
        XCTAssertEqual(ChargingScoreGrade.grade(forScore: 35), .gradeD)
        XCTAssertEqual(ChargingScoreGrade.grade(forScore: 34), .gradeF)
        XCTAssertEqual(ChargingScoreGrade.grade(forScore: 0), .gradeF)
        XCTAssertEqual(ChargingScoreGrade.grade(forScore: nil), .gradeNone)
        XCTAssertEqual(ChargingScoreGrade.grade(forScore: .nan), .gradeNone)
    }

    func testLabelsAndTones() {
        XCTAssertEqual(ChargingScoreGrade.gradeAPlus.label, "A+")
        XCTAssertEqual(ChargingScoreGrade.gradeNone.label, "—")
        XCTAssertEqual(ChargingScoreGrade.gradeAPlus.tone, .success)
        XCTAssertEqual(ChargingScoreGrade.gradeB.tone, .info)
        XCTAssertEqual(ChargingScoreGrade.gradeC.tone, .warning)
        XCTAssertEqual(ChargingScoreGrade.gradeD.tone, .danger)
        XCTAssertEqual(ChargingScoreGrade.gradeF.tone, .critical)
        XCTAssertEqual(ChargingScoreGrade.gradeNone.tone, .neutral)
    }
}

// MARK: - Scale: battery-delta display (port of `BatteryDelta`)

final class ChargingBatteryDeltaDisplayTests: XCTestCase {
    func testRise() {
        let display = ChargingBatteryDeltaDisplay.make(startPct: 18, endPct: 72)
        XCTAssertTrue(display.hasData)
        XCTAssertEqual(display.label, "+54%")
        XCTAssertEqual(display.tone, .success)
        XCTAssertEqual(display.fromPercent, 18)
        XCTAssertEqual(display.toPercent, 72)
    }

    func testDropUsesUnicodeMinusAndAmber() {
        let display = ChargingBatteryDeltaDisplay.make(startPct: 90, endPct: 89)
        XCTAssertEqual(display.label, "\u{2212}1%")
        XCTAssertEqual(display.tone, .warning)
    }

    func testZeroIsDashNeutral() {
        let display = ChargingBatteryDeltaDisplay.make(startPct: 80, endPct: 80)
        XCTAssertTrue(display.hasData)
        XCTAssertEqual(display.label, "—")
        XCTAssertEqual(display.tone, .neutral)
    }

    func testMissingIsUnknown() {
        let display = ChargingBatteryDeltaDisplay.make(startPct: nil, endPct: 80)
        XCTAssertFalse(display.hasData)
        XCTAssertEqual(display.label, "—")
        XCTAssertNil(display.fromPercent)
    }
}

// MARK: - Projection (port of the web card body)

final class ChargingSessionCardProjectionTests: XCTestCase {
    private let milesConverter: (Double) -> Double = { $0 * 0.621_371 }

    private var supercharger: ChargingSessionSummary {
        ChargingSessionSummary(
            id: 4821,
            chargerType: "Supercharger V3",
            startedAt: Date(timeIntervalSince1970: 0),
            endedAt: Date(timeIntervalSince1970: 2160),
            totalEnergyAddedWh: 42500,
            peakPowerW: 142_000,
            avgPowerW: 70800,
            costDecimal: 13.6,
            startSocPct: 18,
            endSocPct: 72,
            odometerStartM: 30_120_000,
            odometerEndM: 30_320_000,
            startPlace: "Mountain View Supercharger"
        )
    }

    private var freeHome: ChargingSessionSummary {
        ChargingSessionSummary(
            id: 4822,
            chargerType: "Home Wall Connector",
            startedAt: Date(timeIntervalSince1970: 0),
            endedAt: Date(timeIntervalSince1970: 20400),
            totalEnergyAddedWh: 31200,
            peakPowerW: 11000,
            avgPowerW: 5500,
            costDecimal: nil,
            startSocPct: 42,
            endSocPct: 80
        )
    }

    func testSuperchargerProjection() {
        let projection = ChargingSessionCardProjection.make(session: supercharger, toDistanceDisplayKm: milesConverter)
        XCTAssertEqual(projection.category, .supercharger)
        XCTAssertEqual(projection.glow, .cyan)
        XCTAssertEqual(projection.durationMinutes, 36, accuracy: 0.0001)
        XCTAssertEqual(projection.energyKwh, 42.5, accuracy: 0.0001)
        XCTAssertEqual(projection.avgRateKw ?? -1, 70.8333, accuracy: 0.001)
        XCTAssertEqual(projection.peakPowerKw ?? -1, 142, accuracy: 0.0001)
        XCTAssertEqual(projection.costPerKwh ?? -1, 0.32, accuracy: 0.0001)
        XCTAssertEqual(projection.costDecimal ?? -1, 13.6, accuracy: 0.0001)
        XCTAssertFalse(projection.isFree)
        XCTAssertEqual(projection.score ?? -1, 100, accuracy: 0.0001)
        XCTAssertEqual(projection.scoreGrade, .gradeAPlus)
        XCTAssertEqual(projection.distanceGainedDisplay ?? -1, 124.274, accuracy: 0.01)
        XCTAssertTrue(projection.showsEnergyBadge)
        XCTAssertFalse(projection.showsFreeBadge)
        XCTAssertTrue(projection.showsDistanceGained)
    }

    func testFreeHomeProjection() {
        let projection = ChargingSessionCardProjection.make(session: freeHome, toDistanceDisplayKm: milesConverter)
        XCTAssertEqual(projection.category, .home)
        XCTAssertEqual(projection.glow, .green)
        XCTAssertTrue(projection.isFree)
        XCTAssertTrue(projection.showsFreeBadge)
        XCTAssertNil(projection.costPerKwh)
        XCTAssertNil(projection.costDecimal)
        XCTAssertNil(projection.distanceGainedDisplay)
        XCTAssertFalse(projection.showsDistanceGained)
        XCTAssertEqual(projection.score ?? -1, 85, accuracy: 0.0001)
        XCTAssertEqual(projection.scoreGrade, .gradeA)
        XCTAssertEqual(projection.avgRateKw ?? -1, 5.5059, accuracy: 0.001)
    }

    func testInProgressSessionHasNoDurationAndNoScoreBadge() {
        let inProgress = ChargingSessionSummary(
            id: 99,
            chargerType: "CCS",
            startedAt: Date(timeIntervalSince1970: 0),
            endedAt: nil,
            totalEnergyAddedWh: 0,
            avgPowerW: 8000,
            startSocPct: nil,
            endSocPct: nil
        )
        let projection = ChargingSessionCardProjection.make(session: inProgress, toDistanceDisplayKm: milesConverter)
        XCTAssertEqual(projection.category, .dc)
        XCTAssertEqual(projection.durationMinutes, 0)
        XCTAssertEqual(projection.avgRateKw ?? -1, 8, accuracy: 0.0001)
        XCTAssertEqual(projection.energyKwh, 0)
        XCTAssertFalse(projection.showsEnergyBadge)
        XCTAssertNil(projection.scoreGrade)
        XCTAssertTrue(projection.isFree)
        XCTAssertFalse(projection.showsFreeBadge)
    }
}

// MARK: - Formatting parity

final class ChargingSessionCardFormattingTests: XCTestCase {
    private let formatting = DefaultChargingSessionCardFormatting()

    func testNumberAndIntGroupingAndRounding() {
        XCTAssertEqual(formatting.formatNumber(1234.5, decimals: 2), "1,234.50")
        XCTAssertEqual(formatting.formatNumber(11), "11.00")
        XCTAssertEqual(formatting.formatInt(124.27), "124")
        XCTAssertEqual(formatting.formatInt(124.6), "125")
    }

    func testCurrency() {
        XCTAssertEqual(formatting.formatCurrency(13.6, decimals: 2), "$13.60")
        XCTAssertEqual(formatting.formatCurrency(0.32, decimals: 2), "$0.32")
        XCTAssertEqual(formatting.formatCurrency(0), "$0.00")
    }

    func testDurationMinutesParity() {
        XCTAssertEqual(formatting.formatDurationMinutes(36), "36m")
        XCTAssertEqual(formatting.formatDurationMinutes(340), "5h 40m")
        XCTAssertEqual(formatting.formatDurationMinutes(90.4), "1h 30m")
        XCTAssertEqual(formatting.formatDurationMinutes(59.6), "60m")
        XCTAssertEqual(formatting.formatDurationMinutes(0), "0m")
        XCTAssertEqual(formatting.formatDurationMinutes(nil), "—")
        XCTAssertEqual(formatting.formatDurationMinutes(-5), "—")
    }

    func testTimestamp() {
        XCTAssertEqual(formatting.formatTimestamp(nil), "—")
        XCTAssertNotEqual(formatting.formatTimestamp(Date(timeIntervalSince1970: 1_700_000_000)), "—")
    }

    func testDistanceConversionAndUnit() {
        let imperial = DefaultChargingSessionCardFormatting(unit: .miles)
        let metric = DefaultChargingSessionCardFormatting(unit: .kilometers)
        XCTAssertEqual(imperial.distanceDisplay(kilometers: 200), 124.2742, accuracy: 0.001)
        XCTAssertEqual(imperial.distanceUnit, "mi")
        XCTAssertEqual(metric.distanceDisplay(kilometers: 200), 200, accuracy: 0.0001)
        XCTAssertEqual(metric.distanceUnit, "km")
    }
}

// MARK: - Labels + accessibility builders (no hardcoded literals in the view)

final class ChargingSessionCardLabelsTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testChargerLabels() {
        XCTAssertEqual(ChargingSessionCardLabels.chargerLabel(.supercharger, localize: echo), "Supercharger")
        XCTAssertEqual(ChargingSessionCardLabels.chargerLabel(.dc, localize: echo), "DC Fast")
        XCTAssertEqual(ChargingSessionCardLabels.chargerLabel(.home, localize: echo), "Home / AC")
        XCTAssertEqual(ChargingSessionCardLabels.chargerLabel(.unknown, localize: echo), "Charger")
    }

    func testMetricTemplates() {
        XCTAssertEqual(ChargingSessionCardLabels.energy(valueText: "42.50", localize: echo), "42.50 kWh")
        XCTAssertEqual(ChargingSessionCardLabels.peak(valueText: "142.00", localize: echo), "142.00 kW peak")
        XCTAssertEqual(ChargingSessionCardLabels.average(valueText: "70.83", localize: echo), "~70.83 kW avg")
        XCTAssertEqual(ChargingSessionCardLabels.costPerKwh(valueText: "$0.32", localize: echo), "($0.32/kWh)")
        XCTAssertEqual(
            ChargingSessionCardLabels.distanceGained(valueText: "124", unit: "mi", localize: echo),
            "+124 mi"
        )
        XCTAssertEqual(ChargingSessionCardLabels.free(localize: echo), "Free")
    }

    func testAccessibilityBuilders() {
        XCTAssertEqual(
            ChargingSessionCardAccessibility.scoreAria(valueText: "100", localize: echo),
            "Battery-friendly score: 100"
        )
        XCTAssertEqual(
            ChargingSessionCardAccessibility.batteryDelta(fromText: "18", toText: "72", localize: echo),
            "Battery 18% to 72%"
        )
        XCTAssertEqual(ChargingSessionCardAccessibility.batteryDeltaUnknown(localize: echo), "Battery delta unknown")
        XCTAssertEqual(ChargingSessionCardAccessibility.selectSession(localize: echo), "Select charging session")
    }

    func testRowSummaryJoinsPresentPartsAndDropsNils() {
        let summary = ChargingSessionCardAccessibility.rowSummary(parts: [
            "Apr 4, 2:05 PM",
            "Supercharger",
            "36m",
            "42.50 kWh",
            "Battery 18% to 72%",
            "Battery-friendly score: 100"
        ])
        XCTAssertTrue(summary.contains("Supercharger"))
        XCTAssertTrue(summary.contains("42.50 kWh"))
        XCTAssertTrue(summary.contains("Battery-friendly score: 100"))

        let terse = ChargingSessionCardAccessibility.rowSummary(parts: [
            "Apr 4, 2:05 PM", "Home / AC", "5h 40m", nil, "Battery delta unknown", nil
        ])
        XCTAssertFalse(terse.contains("kWh"))
        XCTAssertEqual(terse, "Apr 4, 2:05 PM, Home / AC, 5h 40m, Battery delta unknown")
    }
}
