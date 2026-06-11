//
//  ActiveFilterChips.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0147 · ActiveFilterChips (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the visible/overflow split
//  (the verbatim port of the web `useMemo` — `maxVisible <= 0` collapses all; `count <= maxVisible` keeps
//  all inline; otherwise one inline slot is reserved for "+N more"), the hide / empty / clear-all flags,
//  the i18next `{{token}}` interpolation, the rotating dedupe padding, and the announcement composition.
//  Split from ActiveFilterChips.Tests.swift (the SwiftUI / state-holder half) to keep each file within the
//  SwiftLint file-length budget. These run in the TeslaSync(/-macOS) XCTest targets; the derivation is
//  pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class ActiveFilterChipsAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(ActiveFilterChipsSurface.slug, "ActiveFilterChips")
    }
}

// MARK: - Partition (web `useMemo` visible/overflow split)

final class ActiveFilterChipsPartitionTests: XCTestCase {
    private func chips(_ count: Int) -> [FilterChipDescriptor] {
        (0 ..< count).map { FilterChipDescriptor(id: "k\($0)", label: "Label\($0)", value: "Value\($0)") }
    }

    func testAllInlineWhenAtOrUnderCap() {
        let result = ActiveFilterChipsProjector.partition(filters: chips(3), maxVisible: 8)
        XCTAssertEqual(result.visible.count, 3)
        XCTAssertTrue(result.overflow.isEmpty)
        XCTAssertFalse(result.hasOverflow)
    }

    func testReservesOneInlineSlotWhenOverCap() {
        // Web test: maxVisible 2, 5 chips → 1 inline + 4 collapsed ("+4 more").
        let result = ActiveFilterChipsProjector.partition(filters: chips(5), maxVisible: 2)
        XCTAssertEqual(result.visible.map(\.id), ["k0"])
        XCTAssertEqual(result.overflow.map(\.id), ["k1", "k2", "k3", "k4"])
        XCTAssertEqual(result.overflowCount, 4)
    }

    func testThreeChipsMaxVisibleTwo() {
        let result = ActiveFilterChipsProjector.partition(filters: chips(3), maxVisible: 2)
        XCTAssertEqual(result.visible.map(\.id), ["k0"])
        XCTAssertEqual(result.overflow.map(\.id), ["k1", "k2"])
    }

    func testEverythingCollapsesWhenMaxVisibleZero() {
        // Web test: maxVisible 0 → no inline chips, all behind "+N more".
        let result = ActiveFilterChipsProjector.partition(filters: chips(2), maxVisible: 0)
        XCTAssertTrue(result.visible.isEmpty)
        XCTAssertEqual(result.overflowCount, 2)
    }

    func testEverythingCollapsesWhenMaxVisibleNegative() {
        let result = ActiveFilterChipsProjector.partition(filters: chips(3), maxVisible: -5)
        XCTAssertTrue(result.visible.isEmpty)
        XCTAssertEqual(result.overflowCount, 3)
    }

    func testExactlyAtCapKeepsAllInline() {
        let result = ActiveFilterChipsProjector.partition(filters: chips(4), maxVisible: 4)
        XCTAssertEqual(result.visible.count, 4)
        XCTAssertTrue(result.overflow.isEmpty)
    }
}

// MARK: - Resolve (hide / empty / clear-all flags)

final class ActiveFilterChipsResolveTests: XCTestCase {
    private func chips(_ count: Int) -> [FilterChipDescriptor] {
        (0 ..< count).map { FilterChipDescriptor(id: "k\($0)", label: "L\($0)", value: "V\($0)") }
    }

    func testHiddenWhenEmptyAndHideWhenEmpty() {
        let projection = ActiveFilterChipsProjector.resolve(
            ActiveFilterChipsInput(filters: [], hasClearAll: true, hideWhenEmpty: true)
        )
        XCTAssertTrue(projection.isHidden)
        XCTAssertTrue(projection.isEmpty)
    }

    func testNotHiddenWhenEmptyButHideWhenEmptyFalse() {
        let projection = ActiveFilterChipsProjector.resolve(
            ActiveFilterChipsInput(filters: [], hasClearAll: true, hideWhenEmpty: false)
        )
        XCTAssertFalse(projection.isHidden)
        XCTAssertTrue(projection.isEmpty)
    }

    func testClearAllRequiresAtLeastOneChip() {
        // Web: `onClearAll && filters.length > 0`.
        let empty = ActiveFilterChipsProjector.resolve(
            ActiveFilterChipsInput(filters: [], hasClearAll: true, hideWhenEmpty: false)
        )
        XCTAssertFalse(empty.showsClearAll, "no chips → no Clear all even with a handler")
        let populated = ActiveFilterChipsProjector.resolve(
            ActiveFilterChipsInput(filters: chips(2), hasClearAll: true)
        )
        XCTAssertTrue(populated.showsClearAll)
    }

    func testClearAllHiddenWithoutHandler() {
        let projection = ActiveFilterChipsProjector.resolve(
            ActiveFilterChipsInput(filters: chips(2), hasClearAll: false)
        )
        XCTAssertFalse(projection.showsClearAll)
    }

    func testPopulatedIsNotHidden() {
        let projection = ActiveFilterChipsProjector.resolve(
            ActiveFilterChipsInput(filters: chips(3), hideWhenEmpty: true)
        )
        XCTAssertFalse(projection.isHidden)
        XCTAssertFalse(projection.isEmpty)
        XCTAssertEqual(projection.visible.count, 3)
    }
}

// MARK: - Interpolation (web i18next `{{token}}`)

final class ActiveFilterChipsInterpolationTests: XCTestCase {
    func testMoreCountInterpolation() {
        XCTAssertEqual(
            ActiveFilterChipsProjector.moreCountLabel(template: "+{{count}} more", count: 4),
            "+4 more"
        )
    }

    func testRemoveAriaInterpolation() {
        XCTAssertEqual(
            ActiveFilterChipsProjector.removeAccessibilityLabel(
                template: "Remove filter {{label}}",
                label: "Vehicle"
            ),
            "Remove filter Vehicle"
        )
    }

    func testInterpolateLeavesUnknownTokensUntouched() {
        XCTAssertEqual(
            ActiveFilterChipsProjector.interpolate("a {{x}} b {{y}}", ["x": "1"]),
            "a 1 b {{y}}"
        )
    }
}

// MARK: - Announcements (web live-region text + rotating dedupe padding)

final class ActiveFilterChipsAnnouncementTests: XCTestCase {
    private let zwsp = ActiveFilterChipsProjector.zeroWidthSpace

    func testPaddingRotatesEveryFour() {
        XCTAssertEqual(ActiveFilterChipsProjector.announcementPadding(sequence: 0), "")
        XCTAssertEqual(ActiveFilterChipsProjector.announcementPadding(sequence: 1), zwsp)
        XCTAssertEqual(ActiveFilterChipsProjector.announcementPadding(sequence: 2), zwsp + zwsp)
        XCTAssertEqual(ActiveFilterChipsProjector.announcementPadding(sequence: 3), zwsp + zwsp + zwsp)
        XCTAssertEqual(ActiveFilterChipsProjector.announcementPadding(sequence: 4), "")
        XCTAssertEqual(ActiveFilterChipsProjector.announcementPadding(sequence: 5), zwsp)
    }

    func testRemovalAnnouncementComposesLabelAndPadding() {
        let text = ActiveFilterChipsProjector.removalAnnouncement(
            removedText: "Filter removed",
            label: "Vehicle",
            sequence: 1
        )
        XCTAssertTrue(text.hasPrefix("Filter removed: Vehicle"))
        XCTAssertTrue(text.hasSuffix(zwsp))
    }

    func testClearedAllAnnouncementComposesTextAndPadding() {
        let text = ActiveFilterChipsProjector.clearedAllAnnouncement(
            clearedText: "All filters cleared",
            sequence: 2
        )
        XCTAssertTrue(text.hasPrefix("All filters cleared"))
        XCTAssertTrue(text.hasSuffix(zwsp + zwsp))
    }
}

// MARK: - Value-type equality

final class ActiveFilterChipsValueTypeTests: XCTestCase {
    func testDescriptorEquality() {
        let lhs = FilterChipDescriptor(id: "v", label: "Vehicle", value: "Model 3")
        let rhs = FilterChipDescriptor(id: "v", label: "Vehicle", value: "Model 3")
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, FilterChipDescriptor(id: "v", label: "Vehicle", value: "Model Y"))
    }

    func testInputEquality() {
        let chips = [FilterChipDescriptor(id: "v", label: "Vehicle", value: "Model 3")]
        let lhs = ActiveFilterChipsInput(filters: chips, hasClearAll: true, hideWhenEmpty: false, maxVisible: 6)
        let rhs = ActiveFilterChipsInput(filters: chips, hasClearAll: true, hideWhenEmpty: false, maxVisible: 6)
        XCTAssertEqual(lhs, rhs)
        let other = ActiveFilterChipsInput(filters: chips, hasClearAll: false, hideWhenEmpty: false, maxVisible: 6)
        XCTAssertNotEqual(lhs, other)
    }
}
