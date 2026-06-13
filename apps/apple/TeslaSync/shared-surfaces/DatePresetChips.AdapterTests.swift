//
//  DatePresetChips.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0151 · DatePresetChips (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the preset catalog (the 1:1
//  port of `datePresets.ts` — order, default ids, lookup), the per-preset range resolution against a fixed
//  "now" (the verbatim port of each `DatePreset.resolve(now)`), and the projector's catalog → chips
//  derivation (the verbatim port of `DATE_PRESETS.filter(p => ids.has(p.id))` — catalog order, set dedupe,
//  unknown-id drop, active flag). Split from DatePresetChips.Tests.swift (the SwiftUI / state-holder half) to
//  keep each file within the SwiftLint file-length budget. These run in the TeslaSync(/-macOS) XCTest
//  targets; the derivation is pure, with a fixed clock + a fixed-zone calendar.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class DatePresetChipsAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(DatePresetChipsSurface.slug, "DatePresetChips")
    }
}

// MARK: - Catalog (web `DATE_PRESETS` + `DEFAULT_PRESET_IDS`)

final class DatePresetChipsCatalogTests: XCTestCase {
    func testCatalogMirrorsWebOrder() {
        XCTAssertEqual(
            DatePresetChipsCatalog.all.map(\.id),
            ["today", "yesterday", "7d", "30d", "90d", "mtd", "qtd", "ytd", "lastMonth", "1y", "all"]
        )
    }

    func testEveryPresetCarriesItsWebKeyAndFallback() {
        XCTAssertEqual(DatePresetChipsCatalog.preset(for: "7d")?.i18nKey, "date.preset.last7")
        XCTAssertEqual(DatePresetChipsCatalog.preset(for: "7d")?.fallback, "Last 7 days")
        XCTAssertEqual(DatePresetChipsCatalog.preset(for: "all")?.i18nKey, "date.preset.all")
        XCTAssertEqual(DatePresetChipsCatalog.preset(for: "all")?.fallback, "All time")
    }

    func testDefaultIDsMirrorWeb() {
        XCTAssertEqual(DatePresetChipsCatalog.defaultIDs, ["today", "7d", "30d", "mtd", "ytd", "all"])
    }

    func testLookupUnknownReturnsNil() {
        XCTAssertNil(DatePresetChipsCatalog.preset(for: "nope"))
    }
}

// MARK: - Resolution (web each `DatePreset.resolve(now)`) — the catalog → range adapter

final class DatePresetChipsResolutionTests: XCTestCase {
    /// A fixed UTC Gregorian calendar so the ISO math is timezone-independent in CI.
    private let cal = DatePresetChipsCatalog.gregorian(timeZone: TimeZone(identifier: "UTC")!)

    /// 2024-03-15 (a leap year, Q1) — the fixed "now" the expected ranges below are computed against.
    private var now: Date {
        var components = DateComponents()
        components.year = 2024
        components.month = 3
        components.day = 15
        components.hour = 12
        return cal.date(from: components)!
    }

    private func resolve(_ id: String) -> DatePresetChipsRange? {
        DatePresetChipsCatalog.resolve(id, now: now, calendar: cal)
    }

    private func assertRange(_ id: String, _ start: String, _ end: String, line: UInt = #line) {
        let range = resolve(id)
        XCTAssertEqual(range?.start, start, "\(id) start", line: line)
        XCTAssertEqual(range?.end, end, "\(id) end", line: line)
    }

    func testToday() {
        assertRange("today", "2024-03-15", "2024-03-15")
    }

    func testYesterday() {
        assertRange("yesterday", "2024-03-14", "2024-03-14")
    }

    func testLast7() {
        assertRange("7d", "2024-03-09", "2024-03-15")
    }

    func testLast30() {
        assertRange("30d", "2024-02-15", "2024-03-15")
    }

    func testLast90() {
        assertRange("90d", "2023-12-17", "2024-03-15")
    }

    func testMonthToDate() {
        assertRange("mtd", "2024-03-01", "2024-03-15")
    }

    func testQuarterToDate() {
        assertRange("qtd", "2024-01-01", "2024-03-15")
    }

    func testYearToDate() {
        assertRange("ytd", "2024-01-01", "2024-03-15")
    }

    func testLastMonthSpansLeapFebruary() {
        assertRange("lastMonth", "2024-02-01", "2024-02-29")
    }

    func testLastYear() {
        assertRange("1y", "2023-03-15", "2024-03-15")
    }

    func testAllTimeFloorsToBaseline() {
        assertRange("all", "2015-01-01", "2024-03-15")
    }

    func testUnknownIDResolvesNil() {
        XCTAssertNil(resolve("nope"))
    }

    func testQuarterStartMovesWithTheQuarter() throws {
        // November (Q4) → quarter starts October 1 (web `Math.floor(month/3)*3`).
        var components = DateComponents()
        components.year = 2024
        components.month = 11
        components.day = 20
        components.hour = 12
        let november = try XCTUnwrap(cal.date(from: components))
        let range = DatePresetChipsCatalog.resolve("qtd", now: november, calendar: cal)
        XCTAssertEqual(range?.start, "2024-10-01")
        XCTAssertEqual(range?.end, "2024-11-20")
    }
}

// MARK: - Projector (web `DATE_PRESETS.filter(p => ids.has(p.id))` + active flag)

final class DatePresetChipsProjectorTests: XCTestCase {
    func testDefaultIDsResolveToSixChipsInCatalogOrder() {
        let projection = DatePresetChipsProjector.resolve(DatePresetChipsInput())
        XCTAssertFalse(projection.isEmpty)
        XCTAssertEqual(projection.chips.map(\.id), ["today", "7d", "30d", "mtd", "ytd", "all"])
    }

    func testChipsFollowCatalogOrderNotPropOrder() {
        // Web filters DATE_PRESETS, so the rendered order is catalog order regardless of the prop order.
        let input = DatePresetChipsInput(presetIDs: ["all", "today", "7d"])
        let projection = DatePresetChipsProjector.resolve(input)
        XCTAssertEqual(projection.chips.map(\.id), ["today", "7d", "all"])
    }

    func testDuplicateIDsAreDeduped() {
        let input = DatePresetChipsInput(presetIDs: ["today", "today", "7d"])
        let projection = DatePresetChipsProjector.resolve(input)
        XCTAssertEqual(projection.chips.map(\.id), ["today", "7d"])
    }

    func testUnknownIDsAreDropped() {
        let input = DatePresetChipsInput(presetIDs: ["today", "bogus", "all"])
        let projection = DatePresetChipsProjector.resolve(input)
        XCTAssertEqual(projection.chips.map(\.id), ["today", "all"])
    }

    func testActiveFlagMarksTheMatchingChip() {
        let input = DatePresetChipsInput(presetIDs: ["today", "7d", "30d"], activeID: "7d")
        let projection = DatePresetChipsProjector.resolve(input)
        XCTAssertEqual(projection.chips.filter(\.isActive).map(\.id), ["7d"])
    }

    func testNoActiveWhenActiveIDUnknown() {
        let input = DatePresetChipsInput(presetIDs: ["today", "7d"], activeID: "lastMonth")
        let projection = DatePresetChipsProjector.resolve(input)
        XCTAssertTrue(projection.chips.allSatisfy { !$0.isActive })
    }

    func testEmptyWhenNoIDsMatch() {
        XCTAssertTrue(DatePresetChipsProjector.resolve(DatePresetChipsInput(presetIDs: [])).isEmpty)
        let unknown = DatePresetChipsInput(presetIDs: ["x1", "x2"])
        XCTAssertTrue(DatePresetChipsProjector.resolve(unknown).isEmpty)
    }

    func testChipCarriesLabelKeys() {
        let chip = DatePresetChipsProjector.resolve(DatePresetChipsInput(presetIDs: ["7d"])).chips.first
        XCTAssertEqual(chip?.i18nKey, "date.preset.last7")
        XCTAssertEqual(chip?.fallback, "Last 7 days")
    }
}

// MARK: - Value-type equality

final class DatePresetChipsValueTypeTests: XCTestCase {
    func testRangeEquality() {
        XCTAssertEqual(
            DatePresetChipsRange(start: "2024-01-01", end: "2024-01-31"),
            DatePresetChipsRange(start: "2024-01-01", end: "2024-01-31")
        )
    }

    func testSelectionFromRange() {
        let selection = DatePresetChipsSelection(
            id: "mtd",
            range: DatePresetChipsRange(start: "2024-03-01", end: "2024-03-15")
        )
        XCTAssertEqual(selection, DatePresetChipsSelection(id: "mtd", start: "2024-03-01", end: "2024-03-15"))
    }

    func testInputEquality() {
        let lhs = DatePresetChipsInput(presetIDs: ["today", "7d"], activeID: "7d", size: .medium)
        let rhs = DatePresetChipsInput(presetIDs: ["today", "7d"], activeID: "7d", size: .medium)
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, DatePresetChipsInput(presetIDs: ["today", "7d"], activeID: "today", size: .medium))
    }

    func testChipEquality() {
        let lhs = DatePresetChipsChip(id: "7d", i18nKey: "date.preset.last7", fallback: "Last 7 days", isActive: true)
        let rhs = DatePresetChipsChip(id: "7d", i18nKey: "date.preset.last7", fallback: "Last 7 days", isActive: true)
        XCTAssertEqual(lhs, rhs)
        let inactive = DatePresetChipsChip(
            id: "7d",
            i18nKey: "date.preset.last7",
            fallback: "Last 7 days",
            isActive: false
        )
        XCTAssertNotEqual(lhs, inactive)
    }
}
