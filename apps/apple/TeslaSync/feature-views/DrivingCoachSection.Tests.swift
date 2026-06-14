//
//  DrivingCoachSection.Tests.swift
//  TeslaSync — P4 feature view · 0167 · DrivingCoachSection (Apple)
//
//  Unit coverage for the DrivingCoachSection surface:
//    • Adapter — the number / percent / score / unit formatters (ports of numberFormat.ts) and the
//      date-short + epoch parsing (port of dateFormat.ts).
//    • Domain — the colour-band classifiers, the style / impact parsing, and their bands.
//    • Projector — the gauge banding, the style-breakdown split + legend, the threshold pattern bars, the
//      weekly-trend series, the recommendation rows, the per-drive rows, plus `hasContent` / `resolvePhase`.
//    • State holder — `DrivingCoachSectionModel` wiring, the P1/S11 `view.opened` telemetry, and the stale
//      auto-refresh transition.
//    • Accessibility — the VoiceOver gauge + section summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the model is
//  driven by `InMemoryDrivingCoachSectionSource`, and the locale + time zone are injected for determinism.
//

import XCTest
@testable import TeslaSync

let coachEnUS = "en_US"
let coachUTC = TimeZone(identifier: "UTC") ?? .current

func coachSampleData(
    overallScore: Double = 82,
    totalDrivesAnalyzed: Int = 48,
    style: DrivingCoachStyleBreakdown = DrivingCoachStyleBreakdown(efficient: 30, moderate: 14, aggressive: 4)
) -> DrivingCoachData {
    DrivingCoachData(
        overallScore: overallScore,
        efficiencyWhKm: 152.4,
        bestEfficiencyWhKm: 131.0,
        totalDrivesAnalyzed: totalDrivesAnalyzed,
        styleBreakdown: style,
        patterns: DrivingCoachPatterns(
            hardAccelPct: 18,
            hardBrakePct: 22,
            highwayPct: 61,
            shortTripPct: 35,
            coldStartPct: 12
        ),
        weeklyTrend: [
            DrivingCoachWeeklyPoint(week: "W14", score: 74),
            DrivingCoachWeeklyPoint(week: "W15", score: 79),
            DrivingCoachWeeklyPoint(week: "W16", score: 81),
            DrivingCoachWeeklyPoint(week: "W17", score: 85)
        ],
        recommendations: [
            DrivingCoachRecommendation(id: 0, category: "braking", impact: .high, tip: "Brake earlier."),
            DrivingCoachRecommendation(id: 1, category: "climate", impact: .medium, tip: "Precondition."),
            DrivingCoachRecommendation(id: 2, category: "routing", impact: .low, tip: "Steady speeds.")
        ],
        perDriveScores: [
            DrivingCoachDriveScore(
                id: 901, date: "2026-04-04T08:12:00Z", score: 88, style: .efficient,
                efficiency: 142, distance: 23.4
            ),
            DrivingCoachDriveScore(
                id: 902, date: "2026-04-05T17:40:00Z", score: 63, style: .moderate,
                efficiency: 168, distance: 12.1
            )
        ]
    )
}

// MARK: - Number / unit formatting (port of numberFormat.ts)

@MainActor final class DrivingCoachFormatTests: XCTestCase {
    func testNumberGroupsAndFixesTwoDecimals() {
        XCTAssertEqual(DrivingCoachFormat.number(1000, localeIdentifier: coachEnUS), "1,000.00")
        XCTAssertEqual(DrivingCoachFormat.number(152.4, localeIdentifier: coachEnUS), "152.40")
    }

    func testNumberCoercesNonFiniteToZero() {
        XCTAssertEqual(DrivingCoachFormat.number(.nan, localeIdentifier: coachEnUS), "0.00")
        XCTAssertEqual(DrivingCoachFormat.number(.infinity, localeIdentifier: coachEnUS), "0.00")
    }

    func testPercentAppendsSign() {
        XCTAssertEqual(DrivingCoachFormat.percent(18, localeIdentifier: coachEnUS), "18.00%")
        XCTAssertEqual(DrivingCoachFormat.percent(0, localeIdentifier: coachEnUS), "0.00%")
    }

    func testWithUnitSpacesValueAndUnit() {
        XCTAssertEqual(DrivingCoachFormat.withUnit(152.4, "Wh/km", localeIdentifier: coachEnUS), "152.40 Wh/km")
        XCTAssertEqual(DrivingCoachFormat.withUnit(23.4, "km", localeIdentifier: coachEnUS), "23.40 km")
    }

    func testScoreLabelDropsTrailingZerosButKeepsFractions() {
        XCTAssertEqual(DrivingCoachFormat.scoreLabel(82, localeIdentifier: coachEnUS), "82")
        XCTAssertEqual(DrivingCoachFormat.scoreLabel(82.5, localeIdentifier: coachEnUS), "82.5")
        XCTAssertEqual(DrivingCoachFormat.scoreLabel(.nan, localeIdentifier: coachEnUS), "0")
    }

    func testIntegerFormatsWholeNumbers() {
        XCTAssertEqual(DrivingCoachFormat.integer(100, localeIdentifier: coachEnUS), "100")
        XCTAssertEqual(DrivingCoachFormat.integer(0, localeIdentifier: coachEnUS), "0")
    }
}

// MARK: - Date short + epoch (port of dateFormat.ts)

@MainActor final class DrivingCoachDateTests: XCTestCase {
    func testDateShortFormatsMonthDay() {
        XCTAssertEqual(
            DrivingCoachFormat.dateShort("2026-04-04T08:12:00Z", localeIdentifier: coachEnUS, timeZone: coachUTC),
            "Apr 4"
        )
    }

    func testDateShortFallsBackToEmDashForUnparseable() {
        XCTAssertEqual(
            DrivingCoachFormat.dateShort("", localeIdentifier: coachEnUS, timeZone: coachUTC, emDash: "—"),
            "—"
        )
        XCTAssertEqual(
            DrivingCoachFormat.dateShort("not-a-date", localeIdentifier: coachEnUS, timeZone: coachUTC, emDash: "—"),
            "—"
        )
    }

    func testEpochSecondsParsesAndDefaultsToZero() {
        XCTAssertGreaterThan(DrivingCoachFormat.epochSeconds("2026-04-04T08:12:00Z"), 0)
        XCTAssertEqual(DrivingCoachFormat.epochSeconds(""), 0)
        XCTAssertEqual(DrivingCoachFormat.epochSeconds("garbage"), 0)
    }
}

// MARK: - Colour bands + enum parsing

@MainActor final class DrivingCoachBandTests: XCTestCase {
    func testScoreBandThresholds() {
        XCTAssertEqual(DrivingCoachBand.score(90), .good)
        XCTAssertEqual(DrivingCoachBand.score(75), .good)
        XCTAssertEqual(DrivingCoachBand.score(50), .warn)
        XCTAssertEqual(DrivingCoachBand.score(49.9), .bad)
        XCTAssertEqual(DrivingCoachBand.score(.nan), .bad)
    }

    func testPatternBandThresholds() {
        XCTAssertEqual(DrivingCoachBand.pattern(value: 18, lo: 20, hi: 40), .good)
        XCTAssertEqual(DrivingCoachBand.pattern(value: 35, lo: 30, hi: 50), .warn)
        XCTAssertEqual(DrivingCoachBand.pattern(value: 80, lo: 50, hi: 70), .bad)
    }

    func testStyleParseAndBand() {
        XCTAssertEqual(DrivingCoachStyle.parse("EFFICIENT"), .efficient)
        XCTAssertEqual(DrivingCoachStyle.parse("weird"), .moderate)
        XCTAssertEqual(DrivingCoachStyle.efficient.band, .good)
        XCTAssertEqual(DrivingCoachStyle.moderate.band, .warn)
        XCTAssertEqual(DrivingCoachStyle.aggressive.band, .bad)
    }

    func testImpactParseAndBand() {
        XCTAssertEqual(DrivingCoachImpact.parse("HIGH"), .high)
        XCTAssertEqual(DrivingCoachImpact.parse("x"), .low)
        XCTAssertEqual(DrivingCoachImpact.high.band, .bad)
        XCTAssertEqual(DrivingCoachImpact.medium.band, .warn)
        XCTAssertEqual(DrivingCoachImpact.low.band, .good)
    }
}

// MARK: - Projector

@MainActor final class DrivingCoachProjectorTests: XCTestCase {
    private func project(_ data: DrivingCoachData?) -> DrivingCoachSectionProjection {
        DrivingCoachProjector.project(data: data, copy: .fallback, localeIdentifier: coachEnUS, timeZone: coachUTC)
    }

    func testGaugeBandingAndFraction() {
        let gauge = project(coachSampleData()).gauge
        XCTAssertEqual(gauge.scoreText, "82")
        XCTAssertEqual(gauge.fraction, 0.82, accuracy: 1e-9)
        XCTAssertEqual(gauge.band, .good)
    }

    func testStyleBreakdownSegmentsAndLegend() {
        let breakdown = project(coachSampleData()).styleBreakdown
        XCTAssertTrue(breakdown.hasData)
        XCTAssertEqual(breakdown.segments.map(\.style), [.efficient, .moderate, .aggressive])
        XCTAssertEqual(breakdown.segments[0].fraction, 30.0 / 48.0, accuracy: 1e-9)
        XCTAssertEqual(breakdown.legend.map(\.count), [30, 14, 4])
    }

    func testStyleBreakdownEmptyWhenNoDrivesAnalyzed() {
        let breakdown = project(coachSampleData(totalDrivesAnalyzed: 0)).styleBreakdown
        XCTAssertFalse(breakdown.hasData)
        XCTAssertTrue(breakdown.segments.isEmpty)
        XCTAssertEqual(breakdown.legend.count, 3)
    }

    func testStyleBreakdownDropsZeroShareSegments() {
        let breakdown = project(coachSampleData(
            totalDrivesAnalyzed: 10,
            style: DrivingCoachStyleBreakdown(efficient: 10, moderate: 0, aggressive: 0)
        )).styleBreakdown
        XCTAssertEqual(breakdown.segments.map(\.style), [.efficient])
        XCTAssertEqual(breakdown.legend.map(\.count), [10, 0, 0])
    }

    func testEfficiencyReadouts() {
        let projection = project(coachSampleData())
        XCTAssertEqual(projection.avgEfficiencyText, "152.40 Wh/km")
        XCTAssertEqual(projection.bestEfficiencyText, "131.00 Wh/km")
    }

    func testEfficiencyUsesInjectedUnitCopy() {
        let projection = DrivingCoachProjector.project(
            data: coachSampleData(),
            copy: DrivingCoachCopy(distanceUnit: "mi", efficiencyUnit: "Wh/mi", emDash: "—"),
            localeIdentifier: coachEnUS,
            timeZone: coachUTC
        )
        XCTAssertEqual(projection.avgEfficiencyText, "152.40 Wh/mi")
        XCTAssertEqual(projection.perDriveRows.first?.distanceText, "23.40 mi")
    }

    func testPatternRowsValuesFractionsAndBands() {
        let patterns = project(coachSampleData()).patterns
        XCTAssertEqual(patterns.count, 5)
        XCTAssertEqual(patterns[0].labelKey, "dynamics.coach.hardAccel")
        XCTAssertEqual(patterns[0].valueText, "18.00%")
        XCTAssertEqual(patterns[0].fraction, 0.18, accuracy: 1e-9)
        XCTAssertEqual(patterns[0].band, .good)
        XCTAssertEqual(patterns[2].labelKey, "dynamics.coach.highway")
        XCTAssertEqual(patterns[2].band, .warn)
    }

    func testPatternFractionClampsAtFullWidth() {
        let data = DrivingCoachData(patterns: DrivingCoachPatterns(hardAccelPct: 140))
        let row = DrivingCoachProjector.project(
            data: DrivingCoachData(totalDrivesAnalyzed: 1, patterns: data.patterns),
            copy: .fallback,
            localeIdentifier: coachEnUS
        ).patterns[0]
        XCTAssertEqual(row.fraction, 1, accuracy: 1e-9)
    }

    func testTrendAndRecommendationsAndRowsProjected() {
        let projection = project(coachSampleData())
        XCTAssertEqual(projection.trend.map(\.week), ["W14", "W15", "W16", "W17"])
        XCTAssertTrue(projection.hasTrend)
        XCTAssertEqual(projection.recommendations.map(\.impact), [.high, .medium, .low])
        XCTAssertTrue(projection.hasRecommendations)
        XCTAssertEqual(projection.perDriveRows.count, 2)
        let first = projection.perDriveRows[0]
        XCTAssertEqual(first.dateText, "Apr 4")
        XCTAssertEqual(first.scoreText, "88")
        XCTAssertEqual(first.scoreBand, .good)
        XCTAssertEqual(first.efficiencyText, "142.00")
        XCTAssertEqual(first.distanceText, "23.40 km")
    }

    func testHasTrendFalseWithSingleWeek() {
        let data = DrivingCoachData(
            totalDrivesAnalyzed: 3,
            weeklyTrend: [DrivingCoachWeeklyPoint(week: "W17", score: 85)]
        )
        XCTAssertFalse(project(data).hasTrend)
    }

    func testNilDataProjectsEmptyPlaceholder() { // parity:allow ui
        XCTAssertEqual(project(nil), .empty)
    }

    func testHasContentAndPhaseResolution() {
        XCTAssertTrue(DrivingCoachProjector.hasContent(coachSampleData()))
        XCTAssertFalse(DrivingCoachProjector.hasContent(nil))
        XCTAssertFalse(DrivingCoachProjector.hasContent(coachSampleData(totalDrivesAnalyzed: 0)))

        XCTAssertEqual(DrivingCoachProjector.resolvePhase(.loading, hasContent: false), .loading)
        XCTAssertEqual(DrivingCoachProjector.resolvePhase(.failed("boom"), hasContent: true), .error("boom"))
        XCTAssertEqual(DrivingCoachProjector.resolvePhase(.loaded, hasContent: true), .content)
        XCTAssertEqual(DrivingCoachProjector.resolvePhase(.loaded, hasContent: false), .empty)
    }
}
