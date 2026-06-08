//
//  AiUsageCard.AdapterTests.swift
//  TeslaSync — P4 feature view · 0237 · AiUsageCard (Apple)
//
//  Adapter-level unit coverage: the number / integer / count / plain-int formatters (port of
//  numberFormat.ts), the micro-cents → dollars scaling, the currency prefix, the error-rate intent
//  thresholds, the relative-time bucketing, and the recent-row summary. Foundation-only; locale +
//  `now` injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")
private let fixedNow = Date(timeIntervalSince1970: 1_700_000_000)

private func iso(_ secondsAgo: TimeInterval) -> String {
    ISO8601DateFormatter().string(from: fixedNow.addingTimeInterval(-secondsAgo))
}

// MARK: - Number / integer / count / plain-int formatting

final class AiUsageNumberTests: XCTestCase {
    func testNumberGroupsAndFixesTwoDecimals() {
        XCTAssertEqual(AiUsageNumber.number(1234.5, locale: enUS), "1,234.50")
        XCTAssertEqual(AiUsageNumber.number(0, locale: enUS), "0.00")
    }

    func testNumberCoercesNonFiniteToZero() {
        XCTAssertEqual(AiUsageNumber.number(.nan, locale: enUS), "0.00")
        XCTAssertEqual(AiUsageNumber.number(.infinity, locale: enUS), "0.00")
    }

    func testIntegerGroupsWithNoFractionAndRounds() {
        XCTAssertEqual(AiUsageNumber.integer(18450, locale: enUS), "18,450")
        XCTAssertEqual(AiUsageNumber.integer(12345.6, locale: enUS), "12,346")
        XCTAssertEqual(AiUsageNumber.integer(0, locale: enUS), "0")
    }

    func testCountFormatsFiniteAndDashesOtherwise() {
        XCTAssertEqual(AiUsageNumber.count(42, locale: enUS), "42")
        XCTAssertEqual(AiUsageNumber.count(18450, locale: enUS), "18,450")
        XCTAssertEqual(AiUsageNumber.count(nil, locale: enUS), "—")
        XCTAssertEqual(AiUsageNumber.count(.nan, locale: enUS), "—")
        XCTAssertEqual(AiUsageNumber.count(.infinity, locale: enUS), "—")
    }

    func testPlainIntDoesNotGroupAndRoundsHalfUp() {
        XCTAssertEqual(AiUsageNumber.plainInt(642), "642")
        XCTAssertEqual(AiUsageNumber.plainInt(1234.6), "1235")
        XCTAssertEqual(AiUsageNumber.plainInt(12345), "12345")
        XCTAssertEqual(AiUsageNumber.plainInt(.nan), "0")
    }
}

// MARK: - Micro-cents → dollars + currency

final class AiUsageMoneyTests: XCTestCase {
    func testMicroCentsAsDollarsDividesByOneMillion() {
        XCTAssertEqual(AiUsageNumber.microCentsAsDollars(1_234_560), 1.23456, accuracy: 1e-9)
        XCTAssertEqual(AiUsageNumber.microCentsAsDollars(50_000_000), 50, accuracy: 1e-9)
        XCTAssertEqual(AiUsageNumber.microCentsAsDollars(0), 0, accuracy: 1e-9)
    }

    func testMicroCentsAsDollarsCoercesNullAndNonFiniteToZero() {
        XCTAssertEqual(AiUsageNumber.microCentsAsDollars(nil), 0, accuracy: 1e-9)
        XCTAssertEqual(AiUsageNumber.microCentsAsDollars(.nan), 0, accuracy: 1e-9)
        XCTAssertEqual(AiUsageNumber.microCentsAsDollars(.infinity), 0, accuracy: 1e-9)
    }

    func testCurrencyPrefixesSymbolAtPrecision() {
        XCTAssertEqual(AiUsageNumber.currency(1.23456, symbol: "$", precision: 2, locale: enUS), "$1.23")
        XCTAssertEqual(AiUsageNumber.currency(1234.5, symbol: "$", precision: 2, locale: enUS), "$1,234.50")
        XCTAssertEqual(AiUsageNumber.currency(1.23456, symbol: "€", precision: 2, locale: enUS), "€1.23")
        XCTAssertEqual(AiUsageNumber.currency(1.23456, symbol: "$", precision: 0, locale: enUS), "$1")
    }
}

// MARK: - Error-rate intent (web `errorIntent`)

final class AiUsageIntentTests: XCTestCase {
    func testNoErrorsOrNoCallsIsNormal() {
        XCTAssertEqual(AiUsageIntent.forErrorRate(errorCount: 0, callCount: 42), .normal)
        XCTAssertEqual(AiUsageIntent.forErrorRate(errorCount: 5, callCount: 0), .normal)
    }

    func testBelowFivePercentIsWarn() {
        XCTAssertEqual(AiUsageIntent.forErrorRate(errorCount: 1, callCount: 42), .warn)
    }

    func testAtOrAboveFivePercentIsDanger() {
        XCTAssertEqual(AiUsageIntent.forErrorRate(errorCount: 2, callCount: 40), .danger)
        XCTAssertEqual(AiUsageIntent.forErrorRate(errorCount: 9, callCount: 40), .danger)
    }
}

// MARK: - Relative-time bucket (web `formatRelativeTime`)

final class AiUsageRelativeTests: XCTestCase {
    func testBucketsSecondsMinutesHoursDays() {
        XCTAssertEqual(AiUsageRelative.bucket(fromISO: iso(35), now: fixedNow), .seconds(35))
        XCTAssertEqual(AiUsageRelative.bucket(fromISO: iso(300), now: fixedNow), .minutes(5))
        XCTAssertEqual(AiUsageRelative.bucket(fromISO: iso(7200), now: fixedNow), .hours(2))
        XCTAssertEqual(AiUsageRelative.bucket(fromISO: iso(259_200), now: fixedNow), .days(3))
    }

    func testFutureClampsToZeroSeconds() {
        XCTAssertEqual(AiUsageRelative.bucket(fromISO: iso(-10), now: fixedNow), .seconds(0))
    }

    func testUnparseableReturnsRaw() {
        XCTAssertEqual(AiUsageRelative.bucket(fromISO: "not-a-date", now: fixedNow), .raw("not-a-date"))
    }

    func testRelativeLabelTemplates() {
        XCTAssertEqual(AiUsageProjection.relativeLabel(.seconds(35)), "35s ago")
        XCTAssertEqual(AiUsageProjection.relativeLabel(.minutes(5)), "5m ago")
        XCTAssertEqual(AiUsageProjection.relativeLabel(.hours(2)), "2h ago")
        XCTAssertEqual(AiUsageProjection.relativeLabel(.days(3)), "3d ago")
        XCTAssertEqual(AiUsageProjection.relativeLabel(.raw("xyz")), "xyz")
    }
}

// MARK: - Recent-row summary (web `summarizeRecentRow`)

final class AiUsageSummaryTests: XCTestCase {
    func testSummaryJoinsFeatureModelTokensRelative() {
        let row = AiUsageRecentRow(
            id: 1,
            featureID: "chat",
            model: "gpt-4o-mini",
            inputTokens: 820,
            outputTokens: 240,
            startedAt: iso(35)
        )
        XCTAssertEqual(
            AiUsageProjection.summarize(row, now: fixedNow, locale: enUS),
            "chat · gpt-4o-mini · 1,060 tok · 35s ago"
        )
    }

    func testSummaryRendersZeroTokens() {
        let row = AiUsageRecentRow(
            id: 2,
            featureID: "ping",
            model: "none",
            inputTokens: 0,
            outputTokens: 0,
            startedAt: iso(300)
        )
        XCTAssertEqual(
            AiUsageProjection.summarize(row, now: fixedNow, locale: enUS),
            "ping · none · 0 tok · 5m ago"
        )
    }

    func testStatusGlyphReflectsError() {
        let ok = AiUsageRecentRow(id: 1, featureID: "a", model: "m", inputTokens: 1, outputTokens: 1, startedAt: iso(1))
        let bad = AiUsageRecentRow(
            id: 2,
            featureID: "a",
            model: "m",
            inputTokens: 1,
            outputTokens: 1,
            startedAt: iso(1),
            error: "boom"
        )
        XCTAssertEqual(ok.statusGlyph, "✓")
        XCTAssertEqual(bad.statusGlyph, "✗")
    }
}
