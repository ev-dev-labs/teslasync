//
//  ChargePlansWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0018 · ChargePlansWidget (Apple)
//
//  Adapter coverage for the ChargePlansWidget surface — the cached → projection
//  pipeline (`ChargePlansProjectionBuilder`) at parity with the web
//  ChargePlansWidget.tsx data path: status→tone (`badgeVariant`), the
//  `fmtInt` / `fmtNumber` / `formatCurrency` / `formatTime` / `formatDateShort`
//  formatters, the active-plan selection, the eight `planEntries` (incl. the
//  conditional savings), the rate rows, and the full projection build.
//
//  State-holder / registry / accessibility coverage lives in
//  ChargePlansWidget.ModelTests.swift. Both run in the TeslaSync(/-macOS) XCTest
//  targets with no network and no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures (used by both ChargePlansWidget test files)

enum ChargePlansFixture {
    /// Date rendering in UTC / en_US so assertions match the raw ISO calendar.
    static let format = ChargePlansFormatting(
        localeIdentifier: "en_US",
        timeZoneIdentifier: "UTC",
        currencySymbol: "$",
        currencyPrecision: 2
    )

    /// Identity localizer — returns the English fallback (web catalog default).
    nonisolated(unsafe) static let localize: ChargePlansLocalize = { _, fallback in fallback }

    /// A fully-populated scheduled plan with savings.
    static let scheduledPlan = ChargePlanInput(
        id: 1,
        status: "scheduled",
        targetSoc: 80,
        departBy: "2026-06-02T07:30:00Z",
        scheduledStart: "2026-06-02T01:00:00Z",
        scheduledEnd: "2026-06-02T05:30:00Z",
        ratePlan: "PG&E EV2-A",
        estimatedKwh: 42.6,
        estimatedCost: 6.39,
        savings: 4.12
    )

    static let rates: [RatePlanInput] = [
        RatePlanInput(id: "EV2-A", name: "EV2-A Time-of-Use", utility: "PG&E"),
        RatePlanInput(id: "EV-B", name: "EV-B Legacy", utility: "SCE")
    ]
}

// MARK: - Adapter: formatters (parity with the web pipeline)

@MainActor final class ChargePlansFormatTests: XCTestCase {
    private let format = ChargePlansFixture.format

    func testToneMapsStatusLikeBadgeVariant() {
        XCTAssertEqual(ChargePlansProjectionBuilder.tone(forStatus: "completed"), .success)
        XCTAssertEqual(ChargePlansProjectionBuilder.tone(forStatus: "active"), .warning)
        XCTAssertEqual(ChargePlansProjectionBuilder.tone(forStatus: "scheduled"), .warning)
        XCTAssertEqual(ChargePlansProjectionBuilder.tone(forStatus: "failed"), .danger)
        XCTAssertEqual(ChargePlansProjectionBuilder.tone(forStatus: "cancelled"), .danger)
        XCTAssertEqual(ChargePlansProjectionBuilder.tone(forStatus: "queued"), .neutral)
        XCTAssertEqual(ChargePlansProjectionBuilder.tone(forStatus: nil), .neutral)
    }

    func testDecimalGroupingAndFixedDigits() {
        let locale = format.locale
        XCTAssertEqual(ChargePlansProjectionBuilder.decimal(80, fractionDigits: 0, locale: locale), "80")
        XCTAssertEqual(ChargePlansProjectionBuilder.decimal(42.6, fractionDigits: 1, locale: locale), "42.6")
        XCTAssertEqual(ChargePlansProjectionBuilder.decimal(1234.5, fractionDigits: 1, locale: locale), "1,234.5")
        XCTAssertEqual(ChargePlansProjectionBuilder.decimal(.nan, fractionDigits: 1, locale: locale), "0.0")
    }

    func testCurrencyPrefixesSymbolWithPrecision() {
        XCTAssertEqual(ChargePlansProjectionBuilder.currency(6.39, format: format), "$6.39")
        XCTAssertEqual(ChargePlansProjectionBuilder.currency(4.1, format: format), "$4.10")
        XCTAssertEqual(ChargePlansProjectionBuilder.currency(1234.5, format: format), "$1,234.50")
    }

    func testTimeTextShortAndInvalid() {
        let time = ChargePlansProjectionBuilder.timeText("2026-06-02T07:30:00Z", format: format)
        XCTAssertTrue(time.contains("7:30"), "expected 7:30 in \(time)")
        XCTAssertTrue(time.contains("AM"), "expected AM in \(time)")
        XCTAssertEqual(ChargePlansProjectionBuilder.timeText(nil, format: format), "—")
        XCTAssertEqual(ChargePlansProjectionBuilder.timeText("not-a-date", format: format), "—")
    }

    func testDateShortTextMonthDayAndInvalid() {
        XCTAssertEqual(ChargePlansProjectionBuilder.dateShortText("2026-06-02T07:30:00Z", format: format), "Jun 2")
        XCTAssertEqual(ChargePlansProjectionBuilder.dateShortText(nil, format: format), "—")
        XCTAssertEqual(ChargePlansProjectionBuilder.dateShortText("nope", format: format), "—")
    }

    func testDateTimeTextCombinesDateAndTime() {
        let combined = ChargePlansProjectionBuilder.dateTimeText("2026-06-02T01:00:00Z", format: format)
        XCTAssertTrue(combined.contains("Jun 2"), "expected Jun 2 in \(combined)")
        XCTAssertTrue(combined.contains("1:00"), "expected 1:00 in \(combined)")
        XCTAssertEqual(ChargePlansProjectionBuilder.dateTimeText(nil, format: format), "— —")
    }
}

// MARK: - Adapter: active-plan selection + entries

@MainActor final class ChargePlansAdapterTests: XCTestCase {
    private let format = ChargePlansFixture.format
    private let localize = ChargePlansFixture.localize

    func testSelectActivePlanPrefersActiveOrScheduled() {
        let plans = [
            ChargePlanInput(id: 1, status: "completed"),
            ChargePlanInput(id: 2, status: "scheduled"),
            ChargePlanInput(id: 3, status: "active")
        ]
        XCTAssertEqual(ChargePlansProjectionBuilder.selectActivePlan(plans)?.id, 2)
    }

    func testSelectActivePlanFallsBackToFirst() {
        let plans = [
            ChargePlanInput(id: 7, status: "completed"),
            ChargePlanInput(id: 8, status: "failed")
        ]
        XCTAssertEqual(ChargePlansProjectionBuilder.selectActivePlan(plans)?.id, 7)
    }

    func testSelectActivePlanEmptyIsNil() {
        XCTAssertNil(ChargePlansProjectionBuilder.selectActivePlan([]))
    }

    func testPlanEntriesOrderValuesAndBadges() {
        let entries = ChargePlansProjectionBuilder.planEntries(
            for: ChargePlansFixture.scheduledPlan,
            format: format,
            localize: localize
        )
        XCTAssertEqual(entries.map(\.id), [
            "targetSoc", "departure", "schedStart", "schedEnd", "estEnergy", "estCost", "savings", "ratePlan"
        ])
        XCTAssertEqual(entries[0].value, "80%")
        XCTAssertEqual(entries[0].badge?.text, "scheduled")
        XCTAssertEqual(entries[0].badge?.tone, .warning)
        XCTAssertTrue(entries[1].value.contains("7:30"))
        XCTAssertEqual(entries[4].value, "42.6 kWh")
        XCTAssertEqual(entries[5].value, "$6.39")
        XCTAssertEqual(entries[6].value, "$4.12")
        XCTAssertEqual(entries[6].badge?.text, "saved")
        XCTAssertEqual(entries[6].badge?.tone, .success)
        XCTAssertEqual(entries[7].value, "PG&E EV2-A")
    }

    func testPlanEntriesOmitSavingsWhenNotPositive() {
        var plan = ChargePlansFixture.scheduledPlan
        plan.savings = 0
        let zero = ChargePlansProjectionBuilder.planEntries(for: plan, format: format, localize: localize)
        XCTAssertFalse(zero.map(\.id).contains("savings"))
        XCTAssertEqual(zero.count, 7)
        XCTAssertEqual(zero.last?.id, "ratePlan")

        plan.savings = nil
        let missing = ChargePlansProjectionBuilder.planEntries(for: plan, format: format, localize: localize)
        XCTAssertFalse(missing.map(\.id).contains("savings"))
    }

    func testPlanEntriesNullSafeDefaults() {
        let bare = ChargePlanInput(id: 9)
        let entries = ChargePlansProjectionBuilder.planEntries(for: bare, format: format, localize: localize)
        XCTAssertEqual(entries[0].value, "0%")
        XCTAssertEqual(entries[0].badge?.text, "—")
        XCTAssertEqual(entries[0].badge?.tone, .neutral)
        XCTAssertEqual(entries[1].value, "—")
        XCTAssertEqual(entries.first { $0.id == "estEnergy" }?.value, "—")
        XCTAssertEqual(entries.first { $0.id == "estCost" }?.value, "—")
        XCTAssertEqual(entries.last?.value, "—")
    }

    func testRateRowsMapUtilityNameAndIdBadge() {
        let rows = ChargePlansProjectionBuilder.rateRows(ChargePlansFixture.rates)
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows[0].id, "rate-0-EV2-A")
        XCTAssertEqual(rows[0].label, "PG&E")
        XCTAssertEqual(rows[0].value, "EV2-A Time-of-Use")
        XCTAssertEqual(rows[0].badge?.text, "EV2-A")
        XCTAssertEqual(rows[0].badge?.tone, .neutral)
        XCTAssertTrue(rows[0].mono)
    }

    func testRateRowsNullSafeDefaults() {
        let rows = ChargePlansProjectionBuilder.rateRows([RatePlanInput(id: "")])
        XCTAssertEqual(rows[0].label, "—")
        XCTAssertEqual(rows[0].value, "—")
        XCTAssertEqual(rows[0].badge?.text, "—")
    }
}

// MARK: - Adapter: full projection build

@MainActor final class ChargePlansBuildTests: XCTestCase {
    private let format = ChargePlansFixture.format
    private let localize = ChargePlansFixture.localize

    func testBuildProducesActiveProjection() throws {
        let projection = ChargePlansProjectionBuilder.build(
            plans: [ChargePlansFixture.scheduledPlan],
            rates: ChargePlansFixture.rates,
            format: format,
            localize: localize
        )
        let active = try XCTUnwrap(projection.active)
        XCTAssertEqual(active.statusText, "scheduled")
        XCTAssertEqual(active.statusTone, .warning)
        XCTAssertEqual(active.ratePlanHeaderText, "PG&E EV2-A")
        XCTAssertEqual(active.targetSocText, "80%")
        XCTAssertTrue(active.departureText.contains("7:30"))
        XCTAssertNotNil(active.compactDepartureText)
        XCTAssertEqual(active.entries.count, 8)
        XCTAssertEqual(active.detailEntries.map(\.id), [
            "schedStart", "schedEnd", "estEnergy", "estCost", "savings", "ratePlan"
        ])
        XCTAssertTrue(projection.hasPlans)
        XCTAssertTrue(projection.hasRates)
        XCTAssertTrue(projection.hasData)
    }

    func testBuildRatesOnlyHasNoActivePlan() {
        let projection = ChargePlansProjectionBuilder.build(
            plans: [],
            rates: ChargePlansFixture.rates,
            format: format,
            localize: localize
        )
        XCTAssertNil(projection.active)
        XCTAssertFalse(projection.hasPlans)
        XCTAssertTrue(projection.hasRates)
        XCTAssertTrue(projection.hasData)
    }

    func testBuildEmptyHasNoData() {
        let projection = ChargePlansProjectionBuilder.build(
            plans: [],
            rates: [],
            format: format,
            localize: localize
        )
        XCTAssertNil(projection.active)
        XCTAssertFalse(projection.hasData)
        XCTAssertTrue(projection.rateRows.isEmpty)
    }

    func testCompactDepartureNilWithoutDepartBy() {
        var plan = ChargePlansFixture.scheduledPlan
        plan.departBy = nil
        let projection = ChargePlansProjectionBuilder.build(
            plans: [plan],
            rates: [],
            format: format,
            localize: localize
        )
        XCTAssertNil(projection.active?.compactDepartureText)
        XCTAssertEqual(projection.active?.departureText, "—")
    }
}
