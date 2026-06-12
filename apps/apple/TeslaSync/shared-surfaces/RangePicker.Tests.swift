//
//  RangePicker.Tests.swift
//  TeslaSync — P4 shared surface · 0157 · RangePicker (Apple)
//
//  The pure-core coverage (the Foundation-only adapter / presets / projector): the surface identity, the
//  local-day ISO arithmetic (the ports of `isoFromDate` / `dateFromIso` / `diffDaysInclusive` / `formatRange`),
//  the 11 presets + `matchPresetId` + `resolveAllTimeStart` (the `datePresets.ts` port), the props→view
//  projection (active preset, trigger label/sub-label/day count, preset rows, calendar/empty flags), the
//  staged dirty/day-count helpers, the value-type equality, and the i18n facade fallbacks. Split from
//  RangePicker.ModelTests.swift (the SwiftUI / state-holder / calendar half) for the SwiftLint file budget.
//  Deterministic: a fixed UTC calendar + a fixed clock; no network.
//

import XCTest
@testable import TeslaSync

private let rpCal = RangePickerDates.gregorian(timeZone: TimeZone(identifier: "UTC") ?? .current)

private func rpDay(_ year: Int, _ month: Int, _ day: Int) -> Date {
    rpCal.date(from: DateComponents(year: year, month: month, day: day, hour: 12)) ?? Date()
}

private let rpNow = rpDay(2026, 3, 15)

// MARK: - Surface identity + date arithmetic

final class RangePickerDatesTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(RangePickerSurface.slug, "RangePicker")
        XCTAssertEqual(RangePicker.surfaceSlug, "RangePicker")
    }

    func testISORoundTrip() {
        XCTAssertEqual(RangePickerDates.iso(from: rpNow, calendar: rpCal), "2026-03-15")
        let parsed = RangePickerDates.date(from: "2026-03-15", calendar: rpCal)
        XCTAssertEqual(parsed.map { RangePickerDates.iso(from: $0, calendar: rpCal) }, "2026-03-15")
        XCTAssertNil(RangePickerDates.date(from: "not-a-date", calendar: rpCal))
    }

    func testDiffDaysInclusive() {
        XCTAssertEqual(RangePickerDates.diffDaysInclusive(start: "2026-03-15", end: "2026-03-15", calendar: rpCal), 1)
        XCTAssertEqual(RangePickerDates.diffDaysInclusive(start: "2026-03-09", end: "2026-03-15", calendar: rpCal), 7)
        XCTAssertEqual(RangePickerDates.diffDaysInclusive(start: "2026-03-01", end: "2026-03-31", calendar: rpCal), 31)
        // Reversed range floors at 1 (web Math.max(1, …)).
        XCTAssertEqual(RangePickerDates.diffDaysInclusive(start: "2026-03-15", end: "2026-03-10", calendar: rpCal), 1)
    }

    func testFormatRangeSingleDayShowsYear() {
        let text = RangePickerDates.formatRange(
            start: "2026-03-15", end: "2026-03-15", locale: Locale(identifier: "en_US"), calendar: rpCal
        )
        XCTAssertTrue(text.contains("Mar"))
        XCTAssertTrue(text.contains("15"))
        XCTAssertTrue(text.contains("2026"))
    }

    func testFormatRangeCrossYearShowsBothYears() {
        let text = RangePickerDates.formatRange(
            start: "2025-12-30", end: "2026-01-02", locale: Locale(identifier: "en_US"), calendar: rpCal
        )
        XCTAssertTrue(text.contains("2025"))
        XCTAssertTrue(text.contains("2026"))
        XCTAssertTrue(text.contains("–"))
    }

    func testFormatRangeSameYearDropsStartYear() {
        let text = RangePickerDates.formatRange(
            start: "2026-02-01", end: "2026-03-15", locale: Locale(identifier: "en_US"), calendar: rpCal
        )
        XCTAssertTrue(text.hasPrefix("Feb 1 "))
        XCTAssertTrue(text.hasSuffix("2026"))
        XCTAssertTrue(text.contains("–"))
    }
}

// MARK: - Presets (datePresets.ts port)

final class RangePickerPresetsTests: XCTestCase {
    private func resolve(_ id: String) -> RangePickerValue? {
        RangePickerPresets.resolve(id, now: rpNow, calendar: rpCal)
    }

    func testCatalogShapeMatchesWeb() {
        XCTAssertEqual(RangePickerPresets.all.count, 11)
        XCTAssertEqual(RangePickerPresets.all.first?.id, "today")
        XCTAssertEqual(RangePickerPresets.all.last?.id, "all")
        XCTAssertEqual(RangePickerPresets.defaultIDs, ["today", "7d", "30d", "mtd", "ytd", "all"])
        XCTAssertEqual(RangePickerPresets.preset(for: "7d")?.fallback, "Last 7 days")
        XCTAssertNil(RangePickerPresets.preset(for: "nope"))
    }

    func testTrailingPresets() {
        XCTAssertEqual(resolve("today"), RangePickerValue(start: "2026-03-15", end: "2026-03-15"))
        XCTAssertEqual(resolve("yesterday"), RangePickerValue(start: "2026-03-14", end: "2026-03-14"))
        XCTAssertEqual(resolve("7d"), RangePickerValue(start: "2026-03-09", end: "2026-03-15"))
        XCTAssertEqual(resolve("30d"), RangePickerValue(start: "2026-02-14", end: "2026-03-15"))
        XCTAssertEqual(resolve("90d"), RangePickerValue(start: "2025-12-16", end: "2026-03-15"))
        XCTAssertEqual(resolve("1y"), RangePickerValue(start: "2025-03-15", end: "2026-03-15"))
    }

    func testCalendarAnchoredPresets() {
        XCTAssertEqual(resolve("mtd"), RangePickerValue(start: "2026-03-01", end: "2026-03-15"))
        XCTAssertEqual(resolve("qtd"), RangePickerValue(start: "2026-01-01", end: "2026-03-15"))
        XCTAssertEqual(resolve("ytd"), RangePickerValue(start: "2026-01-01", end: "2026-03-15"))
        XCTAssertEqual(resolve("lastMonth"), RangePickerValue(start: "2026-02-01", end: "2026-02-28"))
        XCTAssertEqual(resolve("all"), RangePickerValue(start: "2015-01-01", end: "2026-03-15"))
        XCTAssertNil(resolve("unknown"))
    }

    func testResolveAllTimeStart() {
        XCTAssertEqual(RangePickerPresets.resolveAllTimeStart(minDate: nil), "2015-01-01")
        XCTAssertEqual(RangePickerPresets.resolveAllTimeStart(minDate: "2024-06-01"), "2024-06-01")
        XCTAssertEqual(RangePickerPresets.resolveAllTimeStart(minDate: "2010-01-01"), "2015-01-01")
    }

    func testMatchPresetID() {
        XCTAssertEqual(
            RangePickerPresets.matchPresetID(start: "2026-03-09", end: "2026-03-15", now: rpNow, calendar: rpCal),
            "7d"
        )
        XCTAssertEqual(
            RangePickerPresets.matchPresetID(start: "2026-03-15", end: "2026-03-15", now: rpNow, calendar: rpCal),
            "today"
        )
        XCTAssertNil(
            RangePickerPresets.matchPresetID(start: "2026-01-05", end: "2026-02-09", now: rpNow, calendar: rpCal)
        )
    }
}

// MARK: - Projector (props → view-ready)

final class RangePickerProjectorTests: XCTestCase {
    private func resolve(_ input: RangePickerInput) -> RangePickerProjection {
        RangePickerProjector.resolve(
            input, now: rpNow, calendar: rpCal, locale: Locale(identifier: "en_US"),
            strings: { _, fallback in fallback }
        )
    }

    func testActivePresetLabelsTheTrigger() {
        let projection = resolve(RangePickerInput(value: RangePickerValue(start: "2026-03-09", end: "2026-03-15")))
        XCTAssertEqual(projection.activePresetID, "7d")
        XCTAssertEqual(projection.triggerLabel, "Last 7 days")
        XCTAssertEqual(projection.dayCount, 7)
        XCTAssertEqual(projection.presets.first { $0.id == "7d" }?.isActive, true)
    }

    func testCustomRangeFallsBackToCustomLabel() {
        let projection = resolve(RangePickerInput(value: RangePickerValue(start: "2026-01-05", end: "2026-02-09")))
        XCTAssertNil(projection.activePresetID)
        XCTAssertEqual(projection.triggerLabel, "Custom range")
        XCTAssertTrue(projection.showsCalendar)
        XCTAssertFalse(projection.isEmpty)
    }

    func testPresetsOnlyHidesCalendar() {
        let projection = resolve(RangePickerInput(
            value: RangePickerValue(start: "2026-03-15", end: "2026-03-15"), presetsOnly: true
        ))
        XCTAssertFalse(projection.showsCalendar)
        XCTAssertFalse(projection.isEmpty)
    }

    func testPresetsOnlyWithNoPresetsIsEmpty() {
        let projection = resolve(RangePickerInput(
            value: RangePickerValue(start: "2026-03-15", end: "2026-03-15"), presetIDs: [], presetsOnly: true
        ))
        XCTAssertTrue(projection.isEmpty)
        XCTAssertTrue(projection.presets.isEmpty)
    }

    func testPresetRowsDropUnknownIDs() {
        let rows = RangePickerProjector.presetRows(["7d", "bogus", "all"], activeID: "all") { _, fallback in fallback }
        XCTAssertEqual(rows.map(\.id), ["7d", "all"])
        XCTAssertEqual(rows.first { $0.id == "all" }?.isActive, true)
    }

    func testStagedHelpers() {
        let value = RangePickerValue(start: "2026-03-01", end: "2026-03-10")
        XCTAssertFalse(RangePickerProjector.isStagedDirty(stagedStart: nil, stagedEnd: nil, value: value))
        XCTAssertFalse(RangePickerProjector.isStagedDirty(
            stagedStart: "2026-03-01", stagedEnd: "2026-03-10", value: value
        ))
        XCTAssertTrue(RangePickerProjector.isStagedDirty(
            stagedStart: "2026-03-02", stagedEnd: "2026-03-10", value: value
        ))
        XCTAssertNil(RangePickerProjector.stagedDays(stagedStart: "2026-03-01", stagedEnd: nil, calendar: rpCal))
        XCTAssertEqual(
            RangePickerProjector.stagedDays(stagedStart: "2026-03-01", stagedEnd: "2026-03-10", calendar: rpCal), 10
        )
    }
}

// MARK: - Value types + strings facade

final class RangePickerValueTypeTests: XCTestCase {
    func testValueEquality() {
        XCTAssertEqual(
            RangePickerValue(start: "a", end: "b"), RangePickerValue(start: "a", end: "b")
        )
        XCTAssertNotEqual(
            RangePickerValue(start: "a", end: "b"), RangePickerValue(start: "a", end: "c")
        )
    }

    func testInputEquality() {
        let value = RangePickerValue(start: "2026-03-01", end: "2026-03-10")
        let lhs = RangePickerInput(value: value, presetIDs: ["7d"], enableCompare: true)
        let rhs = RangePickerInput(value: value, presetIDs: ["7d"], enableCompare: true)
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, RangePickerInput(value: value, presetIDs: ["30d"], enableCompare: true))
    }

    func testStringFallbacks() {
        XCTAssertEqual(RangePickerStrings.triggerLabel, "Date range")
        XCTAssertEqual(RangePickerStrings.popoverLabel, "Date range picker")
        XCTAssertEqual(RangePickerStrings.presetGroupLabel, "Quick date range")
        XCTAssertEqual(RangePickerStrings.compareLabel, "Compare to previous period")
        XCTAssertEqual(RangePickerStrings.cancel, "Cancel")
        XCTAssertEqual(RangePickerStrings.apply, "Apply")
        XCTAssertEqual(RangePickerStrings.empty, "No date ranges available")
        XCTAssertEqual(RangePickerStrings.summaryDays(5), "5 days")
        XCTAssertEqual(RangePickerStrings.summaryDays(1), "1 days")
    }

    func testConnectivityFallbacks() {
        XCTAssertEqual(RangePickerStrings.live, "Live")
        XCTAssertEqual(RangePickerStrings.stale, "Stale")
        XCTAssertEqual(RangePickerStrings.offline, "Offline")
        XCTAssertEqual(RangePickerStrings.dayStart, "Range start")
        XCTAssertEqual(RangePickerStrings.dayEnd, "Range end")
    }
}
