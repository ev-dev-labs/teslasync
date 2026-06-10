//
//  BatteryDegradationForecastWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0011 · BatteryDegradationForecastWidget (Apple)
//
//  Adapter + formatting + accessibility coverage for the
//  BatteryDegradationForecastWidget surface (the state-holder + registry coverage
//  lives in BatteryDegradationForecastWidget.ModelTests.swift):
//    • Formatting — `BatteryDegradationForecastFormat` parity with web `fmtNumber`
//      (incl. the U+2212 minus sign, the "—" fallback glyph) and the projected
//      `Intl.DateTimeFormat({ year:'numeric', month:'short' })` output.
//    • Adapter (cached → projection) — `BatteryDegradationForecastBuilder` parity
//      with the web `healthTier` / `scoreToImpact` / `riskIcon` classifiers, the
//      `hasData` predicate, and the resolved-health (`?? `) + rate (`?? 0`) logic.
//    • Accessibility — the VoiceOver summary + per-risk-factor value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no real
//  store, exercised with an explicit en_US locale + UTC time zone so the
//  number/date output is stable across runners.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum BatteryDegradationForecastWidgetForecastFixture {
    static let enUS = Locale(identifier: "en_US")
    static let utc = TimeZone(identifier: "UTC") ?? .gmt

    /// A fixed projected date (2027-04-01, UTC) for the formatter assertions.
    static func projectedDate() -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = utc
        return calendar.date(from: DateComponents(year: 2027, month: 4, day: 1)) ?? Date(timeIntervalSince1970: 0)
    }

    static func riskFactors(_ count: Int) -> [BatteryDegradationForecastRiskFactor] {
        (0 ..< count).map { index in
            BatteryDegradationForecastRiskFactor(
                name: "Risk \(index)",
                score: Double(index),
                label: "Label \(index)",
                detail: "Detail \(index)"
            )
        }
    }

    static func snapshot(
        healthPct: Double? = nil,
        health: Double? = nil,
        rate: Double? = nil,
        date: Date? = nil,
        risks: [BatteryDegradationForecastRiskFactor] = [],
        recommendations: [String] = []
    ) -> BatteryDegradationForecastSnapshot {
        BatteryDegradationForecastSnapshot(
            currentHealthPct: healthPct,
            currentHealth: health,
            degradationRatePctPerMonth: rate,
            projected80Date: date,
            riskFactors: risks,
            recommendations: recommendations
        )
    }
}

// MARK: - Formatting

@MainActor final class BatteryDegradationForecastFormatTests: XCTestCase {
    private let enUS = BatteryDegradationForecastWidgetForecastFixture.enUS

    func testNumberRoundsHalfUpAndGroups() {
        XCTAssertEqual(BatteryDegradationForecastFormat.number(12.34, digits: 1, locale: enUS), "12.3")
        XCTAssertEqual(BatteryDegradationForecastFormat.number(12.36, digits: 1, locale: enUS), "12.4")
        XCTAssertEqual(BatteryDegradationForecastFormat.number(1234.5, digits: 1, locale: enUS), "1,234.5")
    }

    func testHealthValueAppendsPercentOrDash() {
        XCTAssertEqual(BatteryDegradationForecastFormat.healthValue(92.4, locale: enUS), "92.4%")
        XCTAssertEqual(BatteryDegradationForecastFormat.healthValue(91, locale: enUS), "91.0%")
        XCTAssertEqual(BatteryDegradationForecastFormat.healthValue(nil, locale: enUS), "\u{2014}")
        XCTAssertEqual(BatteryDegradationForecastFormat.healthValue(.nan, locale: enUS), "\u{2014}")
    }

    func testDegradationRateUsesMinusSignGlyph() {
        XCTAssertEqual(BatteryDegradationForecastFormat.degradationRate(0.42, locale: enUS), "\u{2212}0.42%")
        // The exact glyph is U+2212 MINUS SIGN, never an ASCII hyphen.
        XCTAssertFalse(BatteryDegradationForecastFormat.degradationRate(0.42, locale: enUS).contains("-"))
    }

    func testRiskScoreIsWholeNumber() {
        XCTAssertEqual(BatteryDegradationForecastFormat.riskScore(8, locale: enUS), "8")
        XCTAssertEqual(BatteryDegradationForecastFormat.riskScore(4.6, locale: enUS), "5")
    }

    func testProjectedDateFormatsShortMonthAndYear() {
        let value = BatteryDegradationForecastFormat.projectedDate(
            BatteryDegradationForecastWidgetForecastFixture.projectedDate(),
            locale: enUS,
            timeZone: BatteryDegradationForecastWidgetForecastFixture.utc
        )
        XCTAssertEqual(value, "Apr 2027")
    }

    func testProjectedDateNilRendersDash() {
        XCTAssertEqual(
            BatteryDegradationForecastFormat.projectedDate(
                nil,
                locale: enUS,
                timeZone: BatteryDegradationForecastWidgetForecastFixture.utc
            ),
            "\u{2014}"
        )
    }
}

// MARK: - Adapter: classifiers + projection

@MainActor final class BatteryDegradationForecastBuilderTests: XCTestCase {
    func testTierClassifierBoundaries() {
        XCTAssertEqual(BatteryDegradationForecastBuilder.tier(forRate: 0), .healthy)
        XCTAssertEqual(BatteryDegradationForecastBuilder.tier(forRate: 0.05), .healthy)
        XCTAssertEqual(BatteryDegradationForecastBuilder.tier(forRate: 0.051), .normal)
        XCTAssertEqual(BatteryDegradationForecastBuilder.tier(forRate: 0.12), .normal)
        XCTAssertEqual(BatteryDegradationForecastBuilder.tier(forRate: 0.121), .accelerated)
    }

    func testImpactClassifierBoundaries() {
        XCTAssertEqual(BatteryDegradationForecastBuilder.impact(forScore: 7), .high)
        XCTAssertEqual(BatteryDegradationForecastBuilder.impact(forScore: 6.9), .medium)
        XCTAssertEqual(BatteryDegradationForecastBuilder.impact(forScore: 4), .medium)
        XCTAssertEqual(BatteryDegradationForecastBuilder.impact(forScore: 3.9), .low)
    }

    func testTierToImpactMapping() {
        XCTAssertEqual(BatteryDegradationForecastBuilder.impact(forTier: .healthy), .low)
        XCTAssertEqual(BatteryDegradationForecastBuilder.impact(forTier: .normal), .medium)
        XCTAssertEqual(BatteryDegradationForecastBuilder.impact(forTier: .accelerated), .high)
    }

    func testRiskSymbolMapping() {
        XCTAssertEqual(
            BatteryDegradationForecastBuilder.riskSymbol(forName: "High temperature exposure"),
            "thermometer.medium"
        )
        XCTAssertEqual(BatteryDegradationForecastBuilder.riskSymbol(forName: "DC fast charging"), "bolt.fill")
        XCTAssertEqual(
            BatteryDegradationForecastBuilder.riskSymbol(forName: "Battery state window"),
            "minus.plus.batteryblock.fill"
        )
        XCTAssertEqual(
            BatteryDegradationForecastBuilder.riskSymbol(forName: "Unknown stressor"),
            "exclamationmark.triangle.fill"
        )
    }

    func testBuildProjectionResolvesHealthAndRate() {
        let projection = BatteryDegradationForecastBuilder.buildProjection(
            snapshot: BatteryDegradationForecastWidgetForecastFixture.snapshot(healthPct: 92.4, health: 91, rate: 0.11)
        )
        XCTAssertEqual(projection.currentHealth, 92.4) // current_health_pct wins
        XCTAssertEqual(projection.rate, 0.11, accuracy: 0.0001)
        XCTAssertEqual(projection.tier, .normal)
        XCTAssertTrue(projection.hasData)
        XCTAssertFalse(projection.isEmpty)
    }

    func testBuildProjectionFallsBackToLegacyHealth() {
        let projection = BatteryDegradationForecastBuilder.buildProjection(
            snapshot: BatteryDegradationForecastWidgetForecastFixture.snapshot(healthPct: nil, health: 88)
        )
        XCTAssertEqual(projection.currentHealth, 88)
        XCTAssertEqual(projection.rate, 0) // degradation_rate ?? 0
        XCTAssertTrue(projection.hasData)
    }

    func testHasDataMirrorsWebPredicate() {
        // Neither health nor date → empty.
        XCTAssertFalse(BatteryDegradationForecastBuilder.buildProjection(snapshot: .empty).hasData)
        // Date only → has data.
        XCTAssertTrue(
            BatteryDegradationForecastBuilder.buildProjection(
                snapshot: BatteryDegradationForecastWidgetForecastFixture
                    .snapshot(date: BatteryDegradationForecastWidgetForecastFixture.projectedDate())
            ).hasData
        )
        // Health only → has data.
        XCTAssertTrue(
            BatteryDegradationForecastBuilder.buildProjection(
                snapshot: BatteryDegradationForecastWidgetForecastFixture.snapshot(health: 90)
            ).hasData
        )
    }

    func testVisibleRiskFactorsCapAtFive() {
        let projection = BatteryDegradationForecastBuilder.buildProjection(
            snapshot: BatteryDegradationForecastWidgetForecastFixture.snapshot(
                health: 90,
                risks: BatteryDegradationForecastWidgetForecastFixture.riskFactors(8)
            )
        )
        XCTAssertEqual(projection.riskFactors.count, 8)
        XCTAssertEqual(projection.visibleRiskFactors.count, 5)
    }

    func testShowsRateOnlyWhenPositive() {
        XCTAssertTrue(
            BatteryDegradationForecastBuilder.buildProjection(
                snapshot: BatteryDegradationForecastWidgetForecastFixture.snapshot(health: 90, rate: 0.02)
            ).showsRate
        )
        XCTAssertFalse(
            BatteryDegradationForecastBuilder.buildProjection(
                snapshot: BatteryDegradationForecastWidgetForecastFixture.snapshot(health: 90, rate: 0)
            ).showsRate
        )
    }

    func testRiskFactorDisplayFallbacks() {
        let blank = BatteryDegradationForecastRiskFactor(name: "Thermal stress", score: 6, label: "  ", detail: nil)
        XCTAssertEqual(blank.displayTitle, "Thermal stress") // label blank → name
        XCTAssertNil(blank.displayDetail) // detail nil → nil (view substitutes em dash)

        let full = BatteryDegradationForecastRiskFactor(name: "n", score: 6, label: "Heat", detail: "Hot")
        XCTAssertEqual(full.displayTitle, "Heat")
        XCTAssertEqual(full.displayDetail, "Hot")
    }
}

// MARK: - Accessibility summary content

@MainActor final class BatteryDegradationForecastAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let enUS = BatteryDegradationForecastWidgetForecastFixture.enUS

    func testSummaryIncludesTitleProjectedTierAndHealth() {
        let projection = BatteryDegradationForecastBuilder.buildProjection(
            snapshot: BatteryDegradationForecastWidgetForecastFixture.snapshot(
                healthPct: 92.4,
                rate: 0.11,
                date: BatteryDegradationForecastWidgetForecastFixture.projectedDate()
            )
        )
        let spoken = BatteryDegradationForecastAccessibility.summary(
            for: projection,
            localize: echo,
            locale: enUS,
            timeZone: BatteryDegradationForecastWidgetForecastFixture.utc
        )
        XCTAssertTrue(spoken.contains("Battery Forecast"))
        XCTAssertTrue(spoken.contains("Projected 80% Capacity Apr 2027"))
        XCTAssertTrue(spoken.contains("Normal"))
        XCTAssertTrue(spoken.contains("Current Health 92.4%"))
    }

    func testSummaryReadsEmptyMessageWhenNoData() {
        let spoken = BatteryDegradationForecastAccessibility.summary(
            for: .empty,
            localize: echo,
            locale: enUS,
            timeZone: BatteryDegradationForecastWidgetForecastFixture.utc
        )
        XCTAssertTrue(spoken.contains("No degradation forecast data"))
    }

    func testRiskFactorLabelFormatsTitleDetailAndScore() {
        let factor = BatteryDegradationForecastRiskFactor(
            name: "n",
            score: 8,
            label: "Heat exposure",
            detail: "Frequent thermal stress"
        )
        let spoken = BatteryDegradationForecastAccessibility.riskFactorLabel(factor, localize: echo, locale: enUS)
        XCTAssertEqual(spoken, "Heat exposure: Frequent thermal stress. Score 8")
    }

    func testRiskFactorLabelSubstitutesDashForBlankDetail() {
        let factor = BatteryDegradationForecastRiskFactor(name: "Heat", score: 5, label: nil, detail: nil)
        let spoken = BatteryDegradationForecastAccessibility.riskFactorLabel(factor, localize: echo, locale: enUS)
        XCTAssertTrue(spoken.contains("\u{2014}")) // em dash for missing detail
        XCTAssertTrue(spoken.hasPrefix("Heat:"))
    }
}
