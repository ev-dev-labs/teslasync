//
//  TeslaApiUsageCard.AdapterTests.swift
//  TeslaSync — P4 feature view · 0257 · TeslaApiUsageCard (Apple)
//
//  Adapter-level unit coverage: the number / integer / percent / count / plain-int formatters (port
//  of numberFormat.ts), the currency prefix, the budget + error-rate intent thresholds, the
//  by_service / by_method de-duplication, and the billing-window month math. Foundation-only; locale
//  + `now` + calendar injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

private func utcCalendar() -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC") ?? calendar.timeZone
    return calendar
}

private func utcDate(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 0, _ minute: Int = 0) -> Date {
    var components = DateComponents()
    components.year = year
    components.month = month
    components.day = day
    components.hour = hour
    components.minute = minute
    components.timeZone = TimeZone(identifier: "UTC")
    return utcCalendar().date(from: components) ?? Date()
}

// MARK: - Number / integer / percent / count / plain-int formatting

@MainActor final class TeslaApiUsageNumberTests: XCTestCase {
    func testNumberGroupsAndFixesTwoDecimals() {
        XCTAssertEqual(TeslaApiUsageNumber.number(1234.5, locale: enUS), "1,234.50")
        XCTAssertEqual(TeslaApiUsageNumber.number(0, locale: enUS), "0.00")
    }

    func testNumberCoercesNonFiniteToZero() {
        XCTAssertEqual(TeslaApiUsageNumber.number(.nan, locale: enUS), "0.00")
        XCTAssertEqual(TeslaApiUsageNumber.number(.infinity, locale: enUS), "0.00")
    }

    func testIntegerGroupsWithNoFractionAndRoundsHalfUp() {
        XCTAssertEqual(TeslaApiUsageNumber.integer(84210, locale: enUS), "84,210")
        XCTAssertEqual(TeslaApiUsageNumber.integer(12345.6, locale: enUS), "12,346")
        XCTAssertEqual(TeslaApiUsageNumber.integer(0, locale: enUS), "0")
    }

    func testPercentAppendsSuffixAtPrecision() {
        XCTAssertEqual(TeslaApiUsageNumber.percent(64, decimals: 0, locale: enUS), "64%")
        XCTAssertEqual(TeslaApiUsageNumber.percent(0.8, decimals: 1, locale: enUS), "0.8%")
        XCTAssertEqual(TeslaApiUsageNumber.percent(1234.5, decimals: 1, locale: enUS), "1,234.5%")
    }

    func testCountFormatsFiniteAndDashesOtherwise() {
        XCTAssertEqual(TeslaApiUsageNumber.count(4820, locale: enUS), "4,820")
        XCTAssertEqual(TeslaApiUsageNumber.count(nil, locale: enUS), "—")
        XCTAssertEqual(TeslaApiUsageNumber.count(.nan, locale: enUS), "—")
        XCTAssertEqual(TeslaApiUsageNumber.count(.infinity, locale: enUS), "—")
    }

    func testPlainIntDoesNotGroupAndRounds() {
        XCTAssertEqual(TeslaApiUsageNumber.plainInt(142), "142")
        XCTAssertEqual(TeslaApiUsageNumber.plainInt(141.6), "142")
        XCTAssertEqual(TeslaApiUsageNumber.plainInt(12345), "12345")
        XCTAssertEqual(TeslaApiUsageNumber.plainInt(.nan), "0")
    }

    func testCurrencyPrefixesSymbolAtPrecision() {
        XCTAssertEqual(TeslaApiUsageNumber.currency(3.2, symbol: "$", precision: 2, locale: enUS), "$3.20")
        XCTAssertEqual(TeslaApiUsageNumber.currency(1234.5, symbol: "$", precision: 2, locale: enUS), "$1,234.50")
        XCTAssertEqual(TeslaApiUsageNumber.currency(3.2, symbol: "€", precision: 2, locale: enUS), "€3.20")
        XCTAssertEqual(TeslaApiUsageNumber.currency(6.4, symbol: "$", precision: 0, locale: enUS), "$6")
    }
}

// MARK: - Budget + error-rate intents (web `budgetIntent` / `errorIntent`)

@MainActor final class TeslaApiUsageIntentTests: XCTestCase {
    func testBudgetNormalWarnDanger() {
        XCTAssertEqual(TeslaApiUsageIntent.forBudget(estimatedCost: 3.2, monthlyCredit: 5, pctOfBudget: 64), .normal)
        XCTAssertEqual(TeslaApiUsageIntent.forBudget(estimatedCost: 4.55, monthlyCredit: 5, pctOfBudget: 91), .warn)
        XCTAssertEqual(TeslaApiUsageIntent.forBudget(estimatedCost: 6.4, monthlyCredit: 5, pctOfBudget: 128), .danger)
    }

    func testBudgetEqualCostIsNotOverBudget() {
        // estimatedCost == monthlyCredit is NOT over budget (strict `>`); 100 % > 80 ⇒ warn.
        XCTAssertEqual(TeslaApiUsageIntent.forBudget(estimatedCost: 5, monthlyCredit: 5, pctOfBudget: 100), .warn)
    }

    func testErrorRateThresholds() {
        XCTAssertEqual(TeslaApiUsageIntent.forErrorRate(nil), .normal)
        XCTAssertEqual(TeslaApiUsageIntent.forErrorRate(0.5), .normal)
        XCTAssertEqual(TeslaApiUsageIntent.forErrorRate(1), .warn)
        XCTAssertEqual(TeslaApiUsageIntent.forErrorRate(4.9), .warn)
        XCTAssertEqual(TeslaApiUsageIntent.forErrorRate(5), .danger)
        XCTAssertEqual(TeslaApiUsageIntent.forErrorRate(12), .danger)
    }
}

// MARK: - Grouped-map de-duplication (web `dedupeMap`)

@MainActor final class TeslaApiUsageDedupeTests: XCTestCase {
    private func entry(_ name: String, _ count: Double) -> TeslaApiUsageCountEntry {
        TeslaApiUsageCountEntry(name: name, count: count)
    }

    func testCamelAliasMatchesWebRegex() {
        XCTAssertEqual(TeslaApiUsageDedupe.camelAlias("tesla_fleet"), "teslaFleet")
        XCTAssertEqual(TeslaApiUsageDedupe.camelAlias("a__b"), "a_B")
        XCTAssertEqual(TeslaApiUsageDedupe.camelAlias("a_2b"), "a2b")
        XCTAssertEqual(TeslaApiUsageDedupe.camelAlias("plain"), "plain")
    }

    func testCollapseDropsCamelCaseCloneOfSnakeAlias() {
        let collapsed = TeslaApiUsageDedupe.collapse([
            entry("tesla_fleet", 28000),
            entry("teslaFleet", 28000),
            entry("geocoding", 5000)
        ])
        XCTAssertEqual(collapsed.map(\.name), ["tesla_fleet", "geocoding"])
        XCTAssertEqual(collapsed.first?.count, 28000)
    }

    func testCollapsePreservesOrderAndUniqueEntries() {
        let collapsed = TeslaApiUsageDedupe.collapse([
            entry("GET", 70010),
            entry("POST", 12000),
            entry("DELETE", 2200)
        ])
        XCTAssertEqual(collapsed.map(\.name), ["GET", "POST", "DELETE"])
    }

    func testCollapseEmptyIsEmpty() {
        XCTAssertTrue(TeslaApiUsageDedupe.collapse([]).isEmpty)
    }
}

// MARK: - Billing-window math (web `derived`)

@MainActor final class TeslaApiUsageDerivedTests: XCTestCase {
    private let usage = TeslaApiUsage(
        totalRequests: 84210,
        skippedPolls: 12040,
        estimatedCost: 3.20,
        costPerRequest: 0.00005,
        monthlyCredit: 5.00
    )

    func testMidMonthDayCountsAndBudget() {
        let derived = TeslaApiUsageDerived.derive(
            usage: usage,
            last24h: 4820,
            now: utcDate(2024, 6, 15, 12),
            calendar: utcCalendar()
        )
        XCTAssertEqual(derived.totalDaysInMonth, 30)
        XCTAssertEqual(derived.daysElapsed, 15)
        XCTAssertEqual(derived.daysRemaining, 15)
        XCTAssertEqual(derived.pctOfBudget, 64, accuracy: 1e-9)
        XCTAssertEqual(derived.dailyAvgCost, 3.20 / 15, accuracy: 1e-9)
        XCTAssertEqual(derived.dailyAvgRequests, 5614, accuracy: 1e-9)
        XCTAssertEqual(derived.forecastFromMtd, 6.4, accuracy: 1e-9)
        XCTAssertEqual(derived.last24hBurn, 0.241, accuracy: 1e-9)
        XCTAssertEqual(derived.forecastFromRecent, 7.23, accuracy: 1e-9)
    }

    func testLeapFebruaryTotalDays() {
        let derived = TeslaApiUsageDerived.derive(
            usage: usage,
            last24h: nil,
            now: utcDate(2024, 2, 10),
            calendar: utcCalendar()
        )
        XCTAssertEqual(derived.totalDaysInMonth, 29)
        XCTAssertEqual(derived.daysElapsed, 9)
        XCTAssertEqual(derived.daysRemaining, 20)
        // last24h nil ⇒ burn 0 (web `?? 0`).
        XCTAssertEqual(derived.last24hBurn, 0, accuracy: 1e-9)
    }

    func testMonthStartClampsElapsedToOne() {
        let derived = TeslaApiUsageDerived.derive(
            usage: usage,
            last24h: 0,
            now: utcDate(2024, 6, 1),
            calendar: utcCalendar()
        )
        XCTAssertEqual(derived.daysElapsed, 1)
        XCTAssertEqual(derived.daysRemaining, 29)
    }

    func testEndOfMonthRemainingIsZero() {
        let derived = TeslaApiUsageDerived.derive(
            usage: usage,
            last24h: 4820,
            now: utcDate(2024, 6, 30, 23),
            calendar: utcCalendar()
        )
        XCTAssertEqual(derived.daysElapsed, 30)
        XCTAssertEqual(derived.daysRemaining, 0)
    }

    func testZeroMonthlyCreditGuardsPercent() {
        let zeroCredit = TeslaApiUsage(estimatedCost: 2, monthlyCredit: 0)
        let derived = TeslaApiUsageDerived.derive(
            usage: zeroCredit,
            last24h: nil,
            now: utcDate(2024, 6, 15),
            calendar: utcCalendar()
        )
        XCTAssertEqual(derived.pctOfBudget, 0, accuracy: 1e-9)
    }
}
