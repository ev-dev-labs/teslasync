//
//  ChargingOptimizerWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0022 · ChargingOptimizerWidget (Apple)
//
//  Adapter coverage for the ChargingOptimizerWidget surface — the cached →
//  projection pipeline (`ChargingOptimizerProjectionBuilder`) at parity with the
//  web ChargingOptimizerWidget.tsx data path: the `formatHour` clock label, the
//  `fmtInt` / `fmtNumber` formatters, the `{{token}}` interpolation, the
//  priority→tone map, the per-hour rate-timeline classification, the
//  recommendation→tip mapping, and the full projection build (incl. the `!data`
//  empty gate and the `monthlySavings > 0` compact-chip guard).
//
//  State-holder / registry / accessibility coverage lives in
//  ChargingOptimizerWidget.ModelTests.swift. Both run in the TeslaSync(/-macOS)
//  XCTest targets with no network and no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures (used by both ChargingOptimizerWidget test files)

enum ChargingOptimizerFixture {
    /// US-English / `$` so number assertions match the raw values.
    static let format = ChargingOptimizerFormatting(localeIdentifier: "en_US", currencySymbol: "$")

    /// Identity localizer — returns the English fallback (web catalog default).
    nonisolated(unsafe) static let localize: ChargingOptimizerLocalize = { _, fallback in fallback }

    /// A fully-populated, already-optimized optimizer payload.
    static let optimized = ChargingOptimizerInput(
        schedule: ChargingOptimizerScheduleInput(mostCommonStartHour: 1, avgChargeToPct: 80),
        cost: ChargingOptimizerCostInput(
            potentialMonthlySavings: 42,
            sessionsDuringPeakPct: 18,
            peakHours: [16, 17, 18, 19, 20],
            offpeakHours: [0, 1, 2, 3, 4, 5]
        ),
        recommendations: [
            ChargingOptimizerRecommendationInput(
                id: 0,
                title: "Shift to off-peak",
                detail: "Charge after midnight.",
                priority: "high"
            ),
            ChargingOptimizerRecommendationInput(
                id: 1,
                title: "Lower target",
                detail: "Charge to 80%.",
                priority: "medium"
            ),
            ChargingOptimizerRecommendationInput(
                id: 2,
                title: "Schedule departure",
                detail: "Precondition plugged in.",
                priority: "low"
            )
        ]
    )
}

// MARK: - Adapter: formatters + interpolation (parity with the web pipeline)

@MainActor final class ChargingOptimizerFormatTests: XCTestCase {
    private let locale = ChargingOptimizerFixture.format.locale

    func testFormatHourTwelveHourClock() {
        let fmt = ChargingOptimizerProjectionBuilder.formatHour
        XCTAssertEqual(fmt(0), "12 AM")
        XCTAssertEqual(fmt(24), "12 AM")
        XCTAssertEqual(fmt(12), "12 PM")
        XCTAssertEqual(fmt(1), "1 AM")
        XCTAssertEqual(fmt(6), "6 AM")
        XCTAssertEqual(fmt(11), "11 AM")
        XCTAssertEqual(fmt(13), "1 PM")
        XCTAssertEqual(fmt(18), "6 PM")
        XCTAssertEqual(fmt(23), "11 PM")
    }

    func testDecimalGroupingAndFixedDigits() {
        let builder = ChargingOptimizerProjectionBuilder.self
        XCTAssertEqual(builder.decimal(80, fractionDigits: 0, locale: locale), "80")
        XCTAssertEqual(builder.decimal(42, fractionDigits: 0, locale: locale), "42")
        XCTAssertEqual(builder.decimal(1234.5, fractionDigits: 0, locale: locale), "1,235")
        XCTAssertEqual(builder.decimal(.nan, fractionDigits: 0, locale: locale), "0")
        XCTAssertEqual(builder.intText(18, locale: locale), "18")
    }

    func testInterpolateReplacesDoubleBraceTokens() {
        let builder = ChargingOptimizerProjectionBuilder.self
        XCTAssertEqual(builder.interpolate("SOC {{pct}}%", ["pct": "80"]), "SOC 80%")
        XCTAssertEqual(builder.interpolate("${{amount}}/mo", ["amount": "42"]), "$42/mo")
        XCTAssertEqual(builder.interpolate("Peak charging: {{pct}}%", ["pct": "18"]), "Peak charging: 18%")
    }

    func testToneForPriorityMapsLikeImpactBadgeMap() {
        let builder = ChargingOptimizerProjectionBuilder.self
        XCTAssertEqual(builder.tone(forPriority: "high"), .success)
        XCTAssertEqual(builder.tone(forPriority: "medium"), .warning)
        XCTAssertEqual(builder.tone(forPriority: "low"), .neutral)
        XCTAssertNil(builder.tone(forPriority: "urgent"))
        XCTAssertNil(builder.tone(forPriority: nil))
    }
}

// MARK: - Adapter: rate-timeline classification + tips

@MainActor final class ChargingOptimizerTimelineTests: XCTestCase {
    private let localize = ChargingOptimizerFixture.localize

    func testSlotKindPeakWinsThenOffpeakThenStandard() {
        let builder = ChargingOptimizerProjectionBuilder.self
        XCTAssertEqual(builder.slotKind(hour: 17, peakHours: [16, 17], offpeakHours: [17]), .peak)
        XCTAssertEqual(builder.slotKind(hour: 2, peakHours: [16], offpeakHours: [1, 2, 3]), .offpeak)
        XCTAssertEqual(builder.slotKind(hour: 9, peakHours: [16], offpeakHours: [1, 2]), .standard)
    }

    func testBuildTimelineHas24CellsWithOptimalMarkerAndLabels() {
        let timeline = ChargingOptimizerProjectionBuilder.buildTimeline(
            optimalStartHour: 1,
            peakHours: [16, 17, 18, 19, 20],
            offpeakHours: [0, 1, 2, 3, 4, 5],
            localize: localize
        )
        XCTAssertEqual(timeline.count, 24)
        XCTAssertEqual(timeline[0].kind, .offpeak)
        XCTAssertEqual(timeline[1].kind, .offpeak)
        XCTAssertTrue(timeline[1].isOptimalStart)
        XCTAssertFalse(timeline[0].isOptimalStart)
        XCTAssertEqual(timeline[16].kind, .peak)
        XCTAssertEqual(timeline[12].kind, .standard)
        XCTAssertEqual(timeline[16].kindLabel, "Peak")
        XCTAssertEqual(timeline[0].kindLabel, "Off-peak")
        XCTAssertEqual(timeline[12].kindLabel, "Standard")
        XCTAssertEqual(timeline[13].hourText, "1 PM")
    }

    func testBuildTipsMapsTitleDetailImpactAndLabel() {
        let tips = ChargingOptimizerProjectionBuilder.buildTips(
            ChargingOptimizerFixture.optimized.recommendations,
            localize: localize
        )
        XCTAssertEqual(tips.count, 3)
        XCTAssertEqual(tips[0].id, 0)
        XCTAssertEqual(tips[0].title, "Shift to off-peak")
        XCTAssertEqual(tips[0].detail, "Charge after midnight.")
        XCTAssertEqual(tips[0].impact, .success)
        XCTAssertEqual(tips[0].impactLabel, "high")
        XCTAssertEqual(tips[1].impact, .warning)
        XCTAssertEqual(tips[2].impact, .neutral)
    }

    func testBuildTipsNullSafeAndUnknownPriority() {
        let recs = [
            ChargingOptimizerRecommendationInput(id: 0, title: nil, detail: nil, priority: "urgent"),
            ChargingOptimizerRecommendationInput(id: 1, title: "Has title", detail: "Has detail", priority: nil)
        ]
        let tips = ChargingOptimizerProjectionBuilder.buildTips(recs, localize: localize)
        XCTAssertEqual(tips[0].title, "—")
        XCTAssertEqual(tips[0].detail, "—")
        XCTAssertNil(tips[0].impact)
        XCTAssertNil(tips[0].impactLabel)
        XCTAssertNil(tips[1].impact)
        XCTAssertNil(tips[1].impactLabel)
    }
}

// MARK: - Adapter: full projection build

@MainActor final class ChargingOptimizerBuildTests: XCTestCase {
    private let format = ChargingOptimizerFixture.format
    private let localize = ChargingOptimizerFixture.localize

    func testBuildOptimizedProjection() {
        let proj = ChargingOptimizerProjectionBuilder.build(
            data: ChargingOptimizerFixture.optimized,
            format: format,
            localize: localize
        )
        XCTAssertTrue(proj.hasData)
        XCTAssertEqual(proj.optimalStartHour, 1)
        XCTAssertEqual(proj.optimalStartText, "1 AM")
        XCTAssertEqual(proj.targetSocText, "80%")
        XCTAssertEqual(proj.targetSocShortText, "SOC 80%")
        XCTAssertEqual(proj.savingsText, "$42")
        XCTAssertEqual(proj.savingsShortText, "$42/mo")
        XCTAssertEqual(proj.peakUsageText, "Peak charging: 18%")
        XCTAssertTrue(proj.scheduleMatchesOptimal)
        XCTAssertEqual(proj.scheduleBadgeText, "Optimized")
        XCTAssertEqual(proj.scheduleBadgeTone, .success)
        XCTAssertEqual(proj.timeline.count, 24)
        XCTAssertEqual(proj.timelineAxisLabels, ["12 AM", "6 AM", "12 PM", "6 PM", "12 AM"])
        XCTAssertEqual(proj.tips.count, 3)
        XCTAssertTrue(proj.hasTips)
    }

    func testBuildSuboptimalShowsCanImproveAndHidesSavingsChip() {
        let data = ChargingOptimizerInput(
            schedule: ChargingOptimizerScheduleInput(mostCommonStartHour: 18, avgChargeToPct: 90),
            cost: ChargingOptimizerCostInput(
                potentialMonthlySavings: 0,
                sessionsDuringPeakPct: 62,
                peakHours: [16, 17, 18],
                offpeakHours: [1, 2, 3]
            ),
            recommendations: []
        )
        let proj = ChargingOptimizerProjectionBuilder.build(data: data, format: format, localize: localize)
        XCTAssertFalse(proj.scheduleMatchesOptimal)
        XCTAssertEqual(proj.scheduleBadgeText, "Can improve")
        XCTAssertEqual(proj.scheduleBadgeTone, .warning)
        XCTAssertNil(proj.savingsShortText)
        XCTAssertEqual(proj.savingsText, "$0")
        XCTAssertFalse(proj.hasTips)
    }

    func testBuildNilPayloadIsEmptyProjection() {
        let proj = ChargingOptimizerProjectionBuilder.build(data: nil, format: format, localize: localize)
        XCTAssertFalse(proj.hasData)
        XCTAssertEqual(proj, .empty)
    }

    func testBuildPresentButEmptyPayloadStillHasData() {
        let proj = ChargingOptimizerProjectionBuilder.build(
            data: ChargingOptimizerInput(),
            format: format,
            localize: localize
        )
        XCTAssertTrue(proj.hasData)
        XCTAssertEqual(proj.optimalStartHour, 0)
        XCTAssertEqual(proj.optimalStartText, "12 AM")
        XCTAssertEqual(proj.targetSocText, "0%")
        XCTAssertEqual(proj.savingsText, "$0")
        XCTAssertNil(proj.savingsShortText)
        XCTAssertEqual(proj.peakUsageText, "Peak charging: 0%")
        XCTAssertTrue(proj.scheduleMatchesOptimal)
        XCTAssertEqual(proj.timeline.count, 24)
        XCTAssertFalse(proj.hasTips)
    }

    func testScheduleMatchBoundaryAt30Percent() {
        func matches(_ pct: Double) -> Bool {
            let data = ChargingOptimizerInput(cost: ChargingOptimizerCostInput(sessionsDuringPeakPct: pct))
            return ChargingOptimizerProjectionBuilder
                .build(data: data, format: format, localize: localize)
                .scheduleMatchesOptimal
        }
        XCTAssertTrue(matches(29.9))
        XCTAssertFalse(matches(30))
        XCTAssertFalse(matches(30.1))
    }
}
