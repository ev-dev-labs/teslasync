//
//  TeslaApiUsageCard.Tests.swift
//  TeslaSync — P4 feature view · 0257 · TeslaApiUsageCard (Apple)
//
//  Projection + accessibility coverage for the TeslaApiUsageCard surface: `TeslaApiUsageProjection`
//  across loading / empty / error / data (the budget bar, the three bands, the four details, the
//  de-duped Top-services / By-method top-lists, the over-budget banner, the footer), the
//  billing-window caption / reset clause, and the VoiceOver cell-label content. No network, no real
//  store; the locale + `now` + calendar are injected for determinism. The state-holder wiring lives
//  in TeslaApiUsageCard.ModelTests.swift.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

private func utcCalendar() -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC") ?? calendar.timeZone
    return calendar
}

private func utcDate(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 0) -> Date {
    var components = DateComponents()
    components.year = year
    components.month = month
    components.day = day
    components.hour = hour
    components.timeZone = TimeZone(identifier: "UTC")
    return utcCalendar().date(from: components) ?? Date()
}

private let sampleUsage = TeslaApiUsage(
    totalRequests: 84210,
    skippedPolls: 12040,
    estimatedCost: 3.20,
    costPerRequest: 0.00005,
    monthlyCredit: 5.00,
    estimatedRemaining: 1.80
)

private let sampleStats = TeslaApiLogStats(
    last24h: 4820,
    avgDurationMs: 142,
    errorRate: 0.8,
    errorCount: 39,
    byService: [
        TeslaApiUsageCountEntry(name: "tesla_fleet", count: 52000),
        TeslaApiUsageCountEntry(name: "geocoding", count: 18000),
        TeslaApiUsageCountEntry(name: "weather", count: 9000),
        TeslaApiUsageCountEntry(name: "elevation", count: 3200)
    ],
    byMethod: [
        TeslaApiUsageCountEntry(name: "GET", count: 70010),
        TeslaApiUsageCountEntry(name: "POST", count: 12000),
        TeslaApiUsageCountEntry(name: "DELETE", count: 2200)
    ]
)

private func resolveSample(
    usage: TeslaApiUsage = sampleUsage,
    stats: TeslaApiLogStats? = sampleStats,
    now: Date = utcDate(2024, 6, 15, 12)
) -> TeslaApiUsageResolved {
    TeslaApiUsageProjection.resolve(
        TeslaApiUsageInput(usage: usage, logStats: stats, now: now),
        locale: enUS,
        calendar: utcCalendar()
    )
}

// MARK: - Projection phases

@MainActor final class TeslaApiUsageProjectionPhaseTests: XCTestCase {
    func testErrorTakesPrecedenceOverData() {
        let resolved = TeslaApiUsageProjection.resolve(
            TeslaApiUsageInput(usage: sampleUsage, errorMessage: "boom"),
            locale: enUS,
            calendar: utcCalendar()
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testLoadingOnlyWhenNoUsage() {
        let loading = TeslaApiUsageProjection.resolve(TeslaApiUsageInput(isLoading: true), locale: enUS)
        XCTAssertEqual(loading.phase, .loading)
        // Web parity: isLoading with usage present renders data, not the skeleton.
        let withData = TeslaApiUsageProjection.resolve(
            TeslaApiUsageInput(usage: sampleUsage, isLoading: true),
            locale: enUS,
            calendar: utcCalendar()
        )
        XCTAssertEqual(withData.phase, .data)
    }

    func testEmptyWhenUsageAbsent() {
        let resolved = TeslaApiUsageProjection.resolve(TeslaApiUsageInput(), locale: enUS)
        guard case let .empty(message) = resolved.phase else {
            return XCTFail("expected empty phase")
        }
        XCTAssertTrue(message.contains("not available yet"))
        XCTAssertTrue(resolved.bands.isEmpty)
        XCTAssertNil(resolved.budget)
        XCTAssertTrue(resolved.footer.isEmpty)
    }

    func testDataPopulatesEverySection() {
        let resolved = resolveSample()
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertNotNil(resolved.budget)
        XCTAssertEqual(resolved.bands.count, 3)
        XCTAssertEqual(resolved.details.count, 4)
        XCTAssertEqual(resolved.footer.count, 2)
    }
}

// MARK: - Projection budget

@MainActor final class TeslaApiUsageProjectionBudgetTests: XCTestCase {
    func testBudgetHeadlineRightLabelCaptionIntent() {
        let budget = resolveSample().budget
        XCTAssertEqual(budget?.headline, "$3.20 of $5.00")
        XCTAssertEqual(budget?.rightLabel, "64% of monthly credit")
        XCTAssertEqual(budget?.caption, "Day 15 of 30 · resets in 15 days")
        XCTAssertEqual(budget?.intent, .normal)
        XCTAssertEqual(budget?.accessibilityLabel, "Tesla API budget used")
    }

    func testResetsTomorrowAtMonthEnd() {
        let budget = resolveSample(now: utcDate(2024, 6, 30, 23)).budget
        XCTAssertEqual(budget?.caption, "Day 30 of 30 · resets tomorrow")
    }

    func testResetsInOneDaySingular() {
        let budget = resolveSample(now: utcDate(2024, 6, 29, 12)).budget
        XCTAssertEqual(budget?.caption, "Day 29 of 30 · resets in 1 day")
    }

    func testWarnIntentAboveEightyPercent() {
        let warnUsage = TeslaApiUsage(estimatedCost: 4.55, monthlyCredit: 5.00)
        let budget = resolveSample(usage: warnUsage).budget
        XCTAssertEqual(budget?.intent, .warn)
        XCTAssertEqual(budget?.rightLabel, "91% of monthly credit")
    }
}

// MARK: - Projection bands + details

@MainActor final class TeslaApiUsageProjectionContentTests: XCTestCase {
    func testBandIdentityValuesUnits() {
        let bands = resolveSample().bands
        XCTAssertEqual(bands.map(\.id), ["thisMonth", "last24h", "forecastEom"])
        XCTAssertEqual(bands.map(\.value), ["84,210", "4,820", "$6.40"])
        XCTAssertEqual(bands.map(\.unit), ["requests", "requests", nil])
    }

    func testBandSubtitlesAndForecastIntent() {
        let bands = resolveSample().bands
        XCTAssertEqual(bands[0].sub, "$0.21/day avg")
        XCTAssertEqual(bands[1].sub, "$0.24/day burn")
        XCTAssertEqual(bands[2].sub, "recent rate: $7.23")
        // Forecast 6.40 > monthly credit 5.00 ⇒ danger (web `forecastFromMtd > monthly_credit`).
        XCTAssertEqual(bands[2].intent, .danger)
    }

    func testLast24hBandDashesWhenNull() {
        let stats = TeslaApiLogStats(last24h: nil, avgDurationMs: 142)
        let bands = resolveSample(stats: stats).bands
        XCTAssertEqual(bands[1].value, "—")
    }

    func testDetailsValuesAndErrorSuffix() {
        let details = resolveSample().details
        XCTAssertEqual(details.map(\.id), ["useful", "skipped", "avgLatency", "errorRate"])
        XCTAssertEqual(details.map(\.value), ["72,170", "12,040", "142 ms", "0.8%"])
        let errorDetail = details.first { $0.id == "errorRate" }
        XCTAssertEqual(errorDetail?.suffix, "(39)")
        XCTAssertEqual(errorDetail?.intent, .normal) // 0.8 % < 1 %
    }

    func testLatencyAndErrorRateDashWhenNull() {
        let stats = TeslaApiLogStats(last24h: 4820, avgDurationMs: nil, errorRate: nil, errorCount: nil)
        let details = resolveSample(stats: stats).details
        XCTAssertEqual(details.first { $0.id == "avgLatency" }?.value, "—")
        let errorDetail = details.first { $0.id == "errorRate" }
        XCTAssertEqual(errorDetail?.value, "—")
        XCTAssertNil(errorDetail?.suffix)
    }

    func testHighErrorRateIsDanger() {
        let stats = TeslaApiLogStats(errorRate: 6.5, errorCount: 300)
        let errorDetail = resolveSample(stats: stats).details.first { $0.id == "errorRate" }
        XCTAssertEqual(errorDetail?.value, "6.5%")
        XCTAssertEqual(errorDetail?.intent, .danger)
    }
}

// MARK: - Projection top-lists / banner / footer

@MainActor final class TeslaApiUsageProjectionListTests: XCTestCase {
    func testTopServicesSortDescAndCapAtThree() {
        let services = resolveSample().topLists.first { $0.id == "services" }
        XCTAssertEqual(services?.title, "Top services")
        XCTAssertEqual(services?.items.count, 3)
        XCTAssertEqual(services?.items.map(\.label), ["tesla_fleet", "geocoding", "weather"])
        XCTAssertEqual(services?.items.first?.value, "52,000")
    }

    func testByMethodSortDescNoCap() {
        let methods = resolveSample().topLists.first { $0.id == "methods" }
        XCTAssertEqual(methods?.title, "By method")
        XCTAssertEqual(methods?.items.map(\.label), ["GET", "POST", "DELETE"])
        XCTAssertEqual(methods?.items.map(\.value), ["70,010", "12,000", "2,200"])
    }

    func testNoTopListsWhenStatsAbsent() {
        let resolved = resolveSample(stats: nil)
        XCTAssertTrue(resolved.topLists.isEmpty)
    }

    func testDedupedServicesCollapseCamelClones() {
        let stats = TeslaApiLogStats(byService: [
            TeslaApiUsageCountEntry(name: "tesla_fleet", count: 28000),
            TeslaApiUsageCountEntry(name: "teslaFleet", count: 28000),
            TeslaApiUsageCountEntry(name: "geocoding", count: 5000)
        ])
        let services = resolveSample(stats: stats).topLists.first { $0.id == "services" }
        XCTAssertEqual(services?.items.map(\.label), ["tesla_fleet", "geocoding"])
    }

    func testBannerOnlyWhenOverBudget() {
        XCTAssertNil(resolveSample().banner)
        let over = TeslaApiUsage(estimatedCost: 6.40, monthlyCredit: 5.00)
        let banner = resolveSample(usage: over).banner
        XCTAssertEqual(banner?.title, "Over monthly credit")
        XCTAssertEqual(banner?.intent, .danger)
        XCTAssertTrue(banner?.description.contains("$5.00") ?? false)
        XCTAssertTrue(banner?.description.contains("$1.40") ?? false)
    }

    func testFooterLinksRoutesAndPrimary() {
        let footer = resolveSample().footer
        XCTAssertEqual(footer.map(\.id), ["logs", "tesla"])
        XCTAssertEqual(footer.map(\.route), ["/api-logs", "/tesla-account"])
        XCTAssertEqual(footer.map(\.primary), [true, false])
    }
}

// MARK: - Accessibility

@MainActor final class TeslaApiUsageAccessibilityTests: XCTestCase {
    func testLabelJoinsLabelAndValue() {
        XCTAssertEqual(
            TeslaApiUsageAccessibility.label("This month", "84,210 requests"),
            "This month: 84,210 requests"
        )
    }

    func testDetailSpokenValueAppendsSuffix() {
        let withSuffix = TeslaApiUsageDetail(id: "e", label: "Error rate", value: "0.8%", suffix: "(39)")
        XCTAssertEqual(withSuffix.spokenValue, "0.8% (39)")
        let plain = TeslaApiUsageDetail(id: "u", label: "Useful", value: "72,170")
        XCTAssertEqual(plain.spokenValue, "72,170")
    }
}
