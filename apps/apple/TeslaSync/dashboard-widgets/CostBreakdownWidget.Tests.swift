//
//  CostBreakdownWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0031 · CostBreakdownWidget (Apple)
//
//  Adapter / projection value-parity coverage for the CostBreakdownWidget surface — the numeric
//  pipeline ported from features/dashboard/widgets/CostBreakdownWidget.tsx is pinned to the exact
//  web display strings:
//    • cost-per-distance conversion (km pass-through / miles × MI_TO_KM / zero → em dash),
//    • number + currency formatting (fmtNumber / formatCurrency parity),
//    • the donut series (last 6 months, palette index), the ranked list (descending, capped at 5,
//      stable ties, bar fraction), the three stat cards, and the compact headline,
//    • the layout ladder (web `isCompact = cols <= 1`).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. Pure Foundation logic — no view rendering.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum CostFixture {
    static let entries: [CostMonthEntry] = [
        CostMonthEntry(month: "Jan", evCost: 10),
        CostMonthEntry(month: "Feb", evCost: 30),
        CostMonthEntry(month: "Mar", evCost: 20)
    ]

    static func data(
        entries: [CostMonthEntry] = CostFixture.entries,
        totalChargingCost: Double = 60,
        totalSavings: Double = 45,
        monthlySavings: Double = 5,
        costPerKmEv: Double = 0.05
    ) -> CostBreakdownData {
        CostBreakdownData(
            monthlyEntries: entries,
            totalChargingCost: totalChargingCost,
            totalSavings: totalSavings,
            monthlySavings: monthlySavings,
            costPerKmEv: costPerKmEv
        )
    }

    static func prefs(
        distance: CostBreakdownDistanceUnit = .miles,
        precision: Int = 2
    ) -> CostBreakdownPrefs {
        CostBreakdownPrefs(distance: distance, currencySymbol: "$", precision: precision, localeIdentifier: "en_US")
    }
}

// MARK: - Layout ladder

final class CostBreakdownLayoutTests: XCTestCase {
    func testResolveMatchesWebIsCompact() {
        XCTAssertEqual(CostBreakdownLayout.resolve(DashboardWidgetSize(cols: 0, rows: 4)), .compact)
        XCTAssertEqual(CostBreakdownLayout.resolve(DashboardWidgetSize(cols: 1, rows: 2)), .compact)
        XCTAssertEqual(CostBreakdownLayout.resolve(DashboardWidgetSize(cols: 2, rows: 4)), .standard)
        XCTAssertEqual(CostBreakdownLayout.resolve(DashboardWidgetSize(cols: 4, rows: 40)), .standard)
    }
}

// MARK: - Conversion + formatting

final class CostBreakdownFormatTests: XCTestCase {
    func testCostPerDistanceConversion() {
        XCTAssertEqual(convertCostPerDistance(costPerKm: 0.05, to: .kilometers), 0.05, accuracy: 1e-9)
        XCTAssertEqual(convertCostPerDistance(costPerKm: 0.05, to: .miles), 0.05 * 1.60934, accuracy: 1e-9)
        XCTAssertEqual(convertCostPerDistance(costPerKm: 0, to: .miles), 0, accuracy: 1e-9)
        XCTAssertEqual(convertCostPerDistance(costPerKm: .nan, to: .miles), 0, accuracy: 1e-9)
    }

    func testNumberFormatting() {
        XCTAssertEqual(CostBreakdownFormat.number(20, decimals: 0), "20")
        XCTAssertEqual(CostBreakdownFormat.number(0.080467, decimals: 3), "0.080")
        XCTAssertEqual(CostBreakdownFormat.number(0.05, decimals: 3), "0.050")
        XCTAssertEqual(CostBreakdownFormat.number(1234.5, decimals: 2), "1,234.50")
    }

    func testCurrencyFormatting() {
        XCTAssertEqual(CostBreakdownFormat.currency(60, symbol: "$", precision: 2), "$60.00")
        XCTAssertEqual(CostBreakdownFormat.currency(5, symbol: "$", precision: 2), "$5.00")
        XCTAssertEqual(CostBreakdownFormat.currency(0.080467, symbol: "$", precision: 3), "$0.080")
    }
}

// MARK: - Stat cards

final class CostBreakdownStatCardTests: XCTestCase {
    func testStatCardsMiles() {
        let projection = CostBreakdownProjector.project(
            data: CostFixture.data(),
            prefs: CostFixture.prefs(distance: .miles)
        )
        let cards = projection.statCards
        XCTAssertEqual(cards.count, 3)
        XCTAssertEqual(cards[0].id, "total-cost")
        XCTAssertEqual(cards[0].label, "Total Cost")
        XCTAssertEqual(cards[0].value, "$60.00")
        XCTAssertEqual(cards[1].id, "cost-per-distance")
        XCTAssertEqual(cards[1].label, "Cost / mi")
        XCTAssertEqual(cards[1].value, "$0.080")
        XCTAssertEqual(cards[2].id, "gas-savings")
        XCTAssertEqual(cards[2].label, "Gas Savings")
        XCTAssertEqual(cards[2].value, "$45.00")
        XCTAssertEqual(cards[2].sublabel, "Lifetime")
    }

    func testStatCardsKilometers() {
        let projection = CostBreakdownProjector.project(
            data: CostFixture.data(),
            prefs: CostFixture.prefs(distance: .kilometers)
        )
        XCTAssertEqual(projection.statCards[1].label, "Cost / km")
        XCTAssertEqual(projection.statCards[1].value, "$0.050")
    }

    func testCostPerDistanceZeroShowsEmDash() {
        let data = CostFixture.data(costPerKmEv: 0)
        let projection = CostBreakdownProjector.project(data: data, prefs: CostFixture.prefs())
        XCTAssertEqual(projection.statCards[1].value, "—")
    }

    func testGasSavingsZeroShowsEmDashAndNoSublabel() {
        let data = CostFixture.data(totalSavings: 0)
        let projection = CostBreakdownProjector.project(data: data, prefs: CostFixture.prefs())
        XCTAssertEqual(projection.statCards[2].value, "—")
        XCTAssertNil(projection.statCards[2].sublabel)
    }
}

// MARK: - Compact headline

final class CostBreakdownCompactTests: XCTestCase {
    func testCompactUsesLastMonthAndSavings() {
        let projection = CostBreakdownProjector.project(data: CostFixture.data(), prefs: CostFixture.prefs())
        let compact = projection.compact
        XCTAssertEqual(compact.bigValue, "20") // last entry (Mar), not the max (Feb 30)
        XCTAssertEqual(compact.unit, "$")
        XCTAssertEqual(compact.label, "This Month")
        XCTAssertEqual(compact.subtitle, "Saved $5.00 vs gas")
        XCTAssertEqual(compact.badgeText, "Saving")
    }

    func testCompactWithoutSavingsHidesSubtitleAndBadge() {
        let data = CostFixture.data(totalSavings: 0, monthlySavings: 0)
        let projection = CostBreakdownProjector.project(data: data, prefs: CostFixture.prefs())
        XCTAssertNil(projection.compact.subtitle)
        XCTAssertNil(projection.compact.badgeText)
    }
}

// MARK: - Donut series

final class CostBreakdownDonutTests: XCTestCase {
    func testDonutSegmentsMapMonths() {
        let projection = CostBreakdownProjector.project(data: CostFixture.data(), prefs: CostFixture.prefs())
        let segments = projection.donutSegments
        XCTAssertEqual(segments.map(\.label), ["Jan", "Feb", "Mar"])
        XCTAssertEqual(segments.map(\.value), [10, 30, 20])
        XCTAssertEqual(segments.map(\.paletteIndex), [0, 1, 2])
        XCTAssertEqual(segments.map(\.formattedValue), ["$10.00", "$30.00", "$20.00"])
    }

    func testDonutKeepsOnlyLastSixMonths() {
        let entries = (1 ... 8).map { CostMonthEntry(month: "M\($0)", evCost: Double($0)) }
        let projection = CostBreakdownProjector.project(
            data: CostFixture.data(entries: entries),
            prefs: CostFixture.prefs()
        )
        let segments = projection.donutSegments
        XCTAssertEqual(segments.count, 6)
        XCTAssertEqual(segments.first?.label, "M3")
        XCTAssertEqual(segments.last?.label, "M8")
        XCTAssertEqual(segments.map(\.paletteIndex), [0, 1, 2, 3, 4, 5])
        XCTAssertEqual(segments.first?.id, "donut-2")
    }

    func testDonutFormattedValueAlwaysTwoDecimals() {
        // Web `CostTooltip` uses formatCurrency(value, 2) regardless of the user precision.
        let projection = CostBreakdownProjector.project(
            data: CostFixture.data(),
            prefs: CostFixture.prefs(precision: 0)
        )
        XCTAssertEqual(projection.donutSegments.map(\.formattedValue), ["$10.00", "$30.00", "$20.00"])
    }

    func testBlankMonthFallsBackToEmDash() {
        let entries = [CostMonthEntry(month: "", evCost: 5)]
        let projection = CostBreakdownProjector.project(
            data: CostFixture.data(entries: entries),
            prefs: CostFixture.prefs()
        )
        XCTAssertEqual(projection.donutSegments.first?.label, "—")
    }
}

// MARK: - Ranked list

final class CostBreakdownRankedTests: XCTestCase {
    func testRankedSortsDescendingWithChronologicalPalette() {
        let projection = CostBreakdownProjector.project(data: CostFixture.data(), prefs: CostFixture.prefs())
        let items = projection.rankedItems
        XCTAssertEqual(items.map(\.label), ["Feb", "Mar", "Jan"])
        XCTAssertEqual(items.map(\.rank), [1, 2, 3])
        XCTAssertEqual(items.map(\.value), [30, 20, 10])
        XCTAssertEqual(items.map(\.formattedValue), ["$30.00", "$20.00", "$10.00"])
        // Palette colour stays tied to the chronological index (Feb=1, Mar=2, Jan=0).
        XCTAssertEqual(items.map(\.paletteIndex), [1, 2, 0])
        XCTAssertEqual(items[0].barFraction, 1.0, accuracy: 1e-9)
        XCTAssertEqual(items[1].barFraction, 20.0 / 30.0, accuracy: 1e-9)
        XCTAssertEqual(items[2].barFraction, 10.0 / 30.0, accuracy: 1e-9)
    }

    func testRankedCapsAtFive() {
        let entries = (1 ... 7).map { CostMonthEntry(month: "M\($0)", evCost: Double($0)) }
        let projection = CostBreakdownProjector.project(
            data: CostFixture.data(entries: entries),
            prefs: CostFixture.prefs()
        )
        XCTAssertEqual(projection.rankedItems.count, 5)
        XCTAssertEqual(projection.rankedItems.first?.label, "M7")
        XCTAssertEqual(projection.rankedItems.last?.label, "M3")
    }

    func testRankedTiesKeepChronologicalOrder() {
        let entries = [
            CostMonthEntry(month: "A", evCost: 5),
            CostMonthEntry(month: "B", evCost: 5),
            CostMonthEntry(month: "C", evCost: 5)
        ]
        let projection = CostBreakdownProjector.project(
            data: CostFixture.data(entries: entries),
            prefs: CostFixture.prefs()
        )
        XCTAssertEqual(projection.rankedItems.map(\.label), ["A", "B", "C"])
    }

    func testRankedUsesUserPrecision() {
        let projection = CostBreakdownProjector.project(
            data: CostFixture.data(),
            prefs: CostFixture.prefs(precision: 0)
        )
        XCTAssertEqual(projection.rankedItems.map(\.formattedValue), ["$30", "$20", "$10"])
    }
}
