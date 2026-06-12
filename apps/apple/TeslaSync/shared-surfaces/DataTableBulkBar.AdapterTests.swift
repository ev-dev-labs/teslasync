//
//  DataTableBulkBar.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0209 · DataTableBulkBar (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the hidden resolution (the
//  verbatim port of the web `count <= 0` → `return null`), the projection (count echo + slot + clear
//  flags), the i18next `{{count}}` interpolation, the rotating announcement padding, and the value-type
//  equality. Split from DataTableBulkBar.Tests.swift (the SwiftUI / state-holder half) to keep each file
//  within the SwiftLint file-length budget. These run in the TeslaSync(/-macOS) XCTest targets; the
//  derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class DataTableBulkBarAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(DataTableBulkBarSurface.slug, "DataTableBulkBar")
    }
}

// MARK: - Hidden resolution (web `count <= 0` → `return null`)

final class DataTableBulkBarHiddenTests: XCTestCase {
    func testHiddenAtOrBelowZero() {
        XCTAssertTrue(DataTableBulkBarProjector.isHidden(count: 0))
        XCTAssertTrue(DataTableBulkBarProjector.isHidden(count: -1))
        XCTAssertTrue(DataTableBulkBarProjector.isHidden(count: -42))
    }

    func testVisibleAboveZero() {
        XCTAssertFalse(DataTableBulkBarProjector.isHidden(count: 1))
        XCTAssertFalse(DataTableBulkBarProjector.isHidden(count: 128))
    }
}

// MARK: - Projection (count echo + slot + clear flags)

final class DataTableBulkBarProjectionTests: XCTestCase {
    func testHiddenProjectionHasNoClear() {
        let projection = DataTableBulkBarProjector.resolve(DataTableBulkBarInput(count: 0, hasActions: true))
        XCTAssertTrue(projection.isHidden)
        XCTAssertFalse(projection.showsClear, "a hidden bar renders no clear button")
        XCTAssertEqual(projection.count, 0)
    }

    func testVisibleProjectionWithActions() {
        let projection = DataTableBulkBarProjector.resolve(DataTableBulkBarInput(count: 3, hasActions: true))
        XCTAssertFalse(projection.isHidden)
        XCTAssertTrue(projection.showsActions)
        XCTAssertTrue(projection.showsClear, "the visible bar always renders the clear button")
        XCTAssertEqual(projection.count, 3)
    }

    func testVisibleProjectionWithoutActions() {
        let projection = DataTableBulkBarProjector.resolve(DataTableBulkBarInput(count: 5, hasActions: false))
        XCTAssertFalse(projection.isHidden)
        XCTAssertFalse(projection.showsActions, "no slot when the page supplied no actions")
        XCTAssertTrue(projection.showsClear)
        XCTAssertEqual(projection.count, 5)
    }
}

// MARK: - Interpolation (web i18next `{{count}}`)

final class DataTableBulkBarInterpolationTests: XCTestCase {
    func testSelectedLabelInterpolatesCount() {
        XCTAssertEqual(
            DataTableBulkBarProjector.selectedLabel(template: "{{count}} selected", count: 3),
            "3 selected"
        )
        XCTAssertEqual(
            DataTableBulkBarProjector.selectedLabel(template: "{{count}} selected", count: 1),
            "1 selected"
        )
    }

    func testSelectedLabelHasNoGroupingSeparator() {
        // i18next default interpolation inserts the raw integer with no thousands separator.
        XCTAssertEqual(
            DataTableBulkBarProjector.selectedLabel(template: "{{count}} selected", count: 1024),
            "1024 selected"
        )
    }

    func testInterpolateReplacesEveryOccurrence() {
        XCTAssertEqual(
            DataTableBulkBarProjector.interpolate("{{a}}-{{b}}-{{a}}", ["a": "1", "b": "2"]),
            "1-2-1"
        )
    }
}

// MARK: - Announcement padding (rotating ZWSP dedupe)

final class DataTableBulkBarAnnouncementTests: XCTestCase {
    func testPaddingRotatesModuloFour() {
        let zwsp = DataTableBulkBarProjector.zeroWidthSpace
        XCTAssertEqual(DataTableBulkBarProjector.announcementPadding(sequence: 0), "")
        XCTAssertEqual(DataTableBulkBarProjector.announcementPadding(sequence: 1), zwsp)
        XCTAssertEqual(DataTableBulkBarProjector.announcementPadding(sequence: 4), "")
        XCTAssertEqual(DataTableBulkBarProjector.announcementPadding(sequence: 6), String(repeating: zwsp, count: 2))
    }

    func testPaddingHandlesNegativeSequence() {
        XCTAssertEqual(DataTableBulkBarProjector.announcementPadding(sequence: -1).count, 3)
    }

    func testSelectionAnnouncementAppendsPadding() {
        let zwsp = DataTableBulkBarProjector.zeroWidthSpace
        XCTAssertEqual(
            DataTableBulkBarProjector.selectionAnnouncement(selectedText: "3 selected", sequence: 1),
            "3 selected" + zwsp
        )
        XCTAssertEqual(
            DataTableBulkBarProjector.selectionAnnouncement(selectedText: "3 selected", sequence: 4),
            "3 selected"
        )
    }

    func testConsecutiveAnnouncementsDifferForReReading() {
        let first = DataTableBulkBarProjector.selectionAnnouncement(selectedText: "3 selected", sequence: 1)
        let second = DataTableBulkBarProjector.selectionAnnouncement(selectedText: "3 selected", sequence: 2)
        XCTAssertNotEqual(first, second, "padding makes an identical count re-read by VoiceOver")
    }
}

// MARK: - Value-type equality

final class DataTableBulkBarValueTypeTests: XCTestCase {
    func testInputEquality() {
        XCTAssertEqual(
            DataTableBulkBarInput(count: 3, hasActions: true),
            DataTableBulkBarInput(count: 3, hasActions: true)
        )
        XCTAssertNotEqual(
            DataTableBulkBarInput(count: 3, hasActions: true),
            DataTableBulkBarInput(count: 4, hasActions: true)
        )
        XCTAssertNotEqual(
            DataTableBulkBarInput(count: 3, hasActions: true),
            DataTableBulkBarInput(count: 3, hasActions: false)
        )
    }

    func testProjectionEquality() {
        let lhs = DataTableBulkBarProjector.resolve(DataTableBulkBarInput(count: 3, hasActions: true))
        let rhs = DataTableBulkBarProjector.resolve(DataTableBulkBarInput(count: 3, hasActions: true))
        XCTAssertEqual(lhs, rhs)
        let other = DataTableBulkBarProjector.resolve(DataTableBulkBarInput(count: 2, hasActions: true))
        XCTAssertNotEqual(lhs, other)
    }
}
