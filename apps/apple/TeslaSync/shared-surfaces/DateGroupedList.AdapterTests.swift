//
//  DateGroupedList.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0080 · DateGroupedList (Apple)
//
//  Coverage for the pure, dependency-light core of the DateGroupedList surface:
//    • Group — the generic `DateGroupedListGroup<T>` (web interface parity): the `Identifiable` id,
//      and the non-generic `header` projection that drops the item payload but keeps its count.
//    • Accessibility — the spoken section label across the full / no-relative / no-summary / neither
//      combinations, with empty parts dropped (no dangling separators).
//    • Meta — the diagnostics slug, the web spacing defaults (`space-y-3` = 12, `space-y-6` = 24),
//      and the middot separator glyph.
//    • Input / header — the snapshot + header init defaults.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure adapter directly.
//

import XCTest
@testable import TeslaSync

// MARK: - Group (web `DateGroupedListGroup<T>` + header projection)

final class DateGroupedListGroupTests: XCTestCase {
    func testIdIsDateKey() {
        let group = DateGroupedListGroup(dateKey: "2026-05-09", dateLabel: "May 9, 2026", items: [1, 2, 3])
        XCTAssertEqual(group.id, "2026-05-09")
    }

    func testHeaderProjectionCarriesFieldsAndItemCount() {
        let group = DateGroupedListGroup(
            dateKey: "2026-05-09",
            dateLabel: "May 9, 2026",
            items: ["a", "b"],
            relativeLabel: "3 days ago",
            summary: "2 drives · 6.2 mi"
        )
        let header = group.header
        XCTAssertEqual(header.dateKey, "2026-05-09")
        XCTAssertEqual(header.dateLabel, "May 9, 2026")
        XCTAssertEqual(header.relativeLabel, "3 days ago")
        XCTAssertEqual(header.summary, "2 drives · 6.2 mi")
        XCTAssertEqual(header.itemCount, 2)
        XCTAssertEqual(header.id, "2026-05-09")
    }

    func testHeaderProjectionDropsItemPayloadButCountsIt() {
        let group = DateGroupedListGroup(dateKey: "k", dateLabel: "Today", items: [10, 20, 30, 40])
        XCTAssertEqual(group.header.itemCount, 4)
        XCTAssertNil(group.header.relativeLabel)
        XCTAssertNil(group.header.summary)
    }

    func testEmptyGroupHasZeroItemCount() {
        let group = DateGroupedListGroup<Int>(dateKey: "k", dateLabel: "Today", items: [])
        XCTAssertEqual(group.header.itemCount, 0)
    }
}

// MARK: - Header init defaults

final class DateGroupedListGroupHeaderTests: XCTestCase {
    func testOptionalDefaultsAreNil() {
        let header = DateGroupedListGroupHeader(dateKey: "k", dateLabel: "Today", itemCount: 1)
        XCTAssertNil(header.relativeLabel)
        XCTAssertNil(header.summary)
        XCTAssertEqual(header.itemCount, 1)
    }
}

// MARK: - Accessibility (spoken section label)

final class DateGroupedListAccessibilityTests: XCTestCase {
    func testFullLabelJoinsAllParts() {
        let label = DateGroupedListAccessibility.sectionLabel(
            dateLabel: "May 9, 2026",
            relativeLabel: "3 days ago",
            summary: "2 drives · 6.2 mi"
        )
        XCTAssertEqual(label, "May 9, 2026, 3 days ago, 2 drives · 6.2 mi")
    }

    func testDropsMissingRelative() {
        let label = DateGroupedListAccessibility.sectionLabel(
            dateLabel: "May 9, 2026",
            relativeLabel: nil,
            summary: "2 drives · 6.2 mi"
        )
        XCTAssertEqual(label, "May 9, 2026, 2 drives · 6.2 mi")
    }

    func testDropsMissingSummary() {
        let label = DateGroupedListAccessibility.sectionLabel(
            dateLabel: "May 9, 2026",
            relativeLabel: "3 days ago",
            summary: nil
        )
        XCTAssertEqual(label, "May 9, 2026, 3 days ago")
    }

    func testDropsEmptyStrings() {
        let label = DateGroupedListAccessibility.sectionLabel(
            dateLabel: "May 9, 2026",
            relativeLabel: "",
            summary: ""
        )
        XCTAssertEqual(label, "May 9, 2026")
    }

    func testDateOnly() {
        let label = DateGroupedListAccessibility.sectionLabel(
            dateLabel: "Today",
            relativeLabel: nil,
            summary: nil
        )
        XCTAssertEqual(label, "Today")
    }
}

// MARK: - Meta (slug + web layout defaults)

final class DateGroupedListMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(DateGroupedListMeta.surfaceSlug, "DateGroupedList")
    }

    func testSpacingDefaultsMatchWebProps() {
        // web `itemSpacing` default `space-y-3` = 0.75rem = 12pt; `groupSpacing` `space-y-6` = 24pt.
        XCTAssertEqual(DateGroupedListMeta.defaultItemSpacing, 12)
        XCTAssertEqual(DateGroupedListMeta.defaultGroupSpacing, 24)
    }

    func testSpacingDefaultsMapToTokens() {
        XCTAssertEqual(DateGroupedListMeta.defaultItemSpacing, TSSpacing.md)
        XCTAssertEqual(DateGroupedListMeta.defaultGroupSpacing, TSSpacing.x2xl)
    }

    func testRelativeSeparatorIsMiddot() {
        XCTAssertEqual(DateGroupedListMeta.relativeSeparator, "\u{00B7}")
        XCTAssertEqual(DateGroupedListMeta.relativeSeparator, "·")
    }
}

// MARK: - Input defaults

final class DateGroupedListInputTests: XCTestCase {
    func testDefaultInputIsEmpty() {
        let input = DateGroupedListInput()
        XCTAssertTrue(input.headers.isEmpty)
    }

    func testInputEquatableByHeaders() {
        let header = DateGroupedListGroupHeader(dateKey: "k", dateLabel: "Today", itemCount: 1)
        XCTAssertEqual(DateGroupedListInput(headers: [header]), DateGroupedListInput(headers: [header]))
        XCTAssertNotEqual(DateGroupedListInput(headers: [header]), DateGroupedListInput(headers: []))
    }
}
