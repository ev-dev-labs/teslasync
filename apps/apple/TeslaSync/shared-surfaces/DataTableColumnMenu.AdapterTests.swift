//
//  DataTableColumnMenu.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0210 · DataTableColumnMenu (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the value types, and the
//  ColumnLayoutProjector — the verbatim port of `lib/columnOrderStore` (defaultColumnLayout,
//  effectiveColumnOrder, applyColumnLayout, moveColumn, toggleHiddenColumn) plus the component's two
//  mutation handlers (handleToggle's last-visible guard, handleMove's bounds clamp) and the per-row render
//  derivation. Split from DataTableColumnMenu.Tests.swift (the SwiftUI / state-holder half) to keep each
//  file within the SwiftLint file-length budget. These run in the TeslaSync(/-macOS) XCTest targets; the
//  derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class DataTableColumnMenuAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(DataTableColumnMenuSurface.slug, "DataTableColumnMenu")
    }
}

// MARK: - Value types

final class DataTableColumnMenuValueTypeTests: XCTestCase {
    func testDisplayLabelFallsBackToKeyWhenHeaderEmpty() {
        XCTAssertEqual(ColumnDescriptor(key: "sel", header: "").displayLabel, "sel")
        XCTAssertEqual(ColumnDescriptor(key: "name", header: "Drive").displayLabel, "Drive")
    }

    func testDescriptorDefaults() {
        let col = ColumnDescriptor(key: "name", header: "Drive")
        XCTAssertFalse(col.isRequired)
        XCTAssertTrue(col.defaultVisible)
        XCTAssertEqual(col.id, "name")
    }

    func testLayoutEmpty() {
        XCTAssertEqual(ColumnLayout.empty, ColumnLayout(order: [], hidden: []))
    }
}

// MARK: - Projector: columnOrderStore ports

final class ColumnLayoutProjectorStoreTests: XCTestCase {
    /// a, b, c(defaultVisible false), d(empty header)
    private func columns() -> [ColumnDescriptor] {
        [
            ColumnDescriptor(key: "a", header: "A"),
            ColumnDescriptor(key: "b", header: "B"),
            ColumnDescriptor(key: "c", header: "C", defaultVisible: false),
            ColumnDescriptor(key: "d", header: "")
        ]
    }

    func testDefaultLayout() {
        let layout = ColumnLayoutProjector.defaultLayout(columns())
        XCTAssertEqual(layout.order, ["a", "b", "c", "d"])
        XCTAssertEqual(layout.hidden, ["c"], "defaultVisible:false columns are pre-hidden")
    }

    func testEffectiveOrderNullAndEmptyAreSourceOrder() {
        XCTAssertEqual(ColumnLayoutProjector.effectiveOrder(columns(), layout: nil), ["a", "b", "c", "d"])
        XCTAssertEqual(
            ColumnLayoutProjector.effectiveOrder(columns(), layout: ColumnLayout(order: [], hidden: [])),
            ["a", "b", "c", "d"]
        )
    }

    func testEffectiveOrderPresentFirstThenSourceAppend() {
        let layout = ColumnLayout(order: ["d", "b"], hidden: [])
        XCTAssertEqual(
            ColumnLayoutProjector.effectiveOrder(columns(), layout: layout),
            ["d", "b", "a", "c"]
        )
    }

    func testEffectiveOrderDropsUnknownAndDedupes() {
        let layout = ColumnLayout(order: ["z", "b", "b", "a"], hidden: [])
        XCTAssertEqual(
            ColumnLayoutProjector.effectiveOrder(columns(), layout: layout),
            ["b", "a", "c", "d"], "unknown 'z' dropped, duplicate 'b' deduped, then source-order append"
        )
    }

    func testApplyLayoutNullHidesDefaultInvisible() {
        let visible = ColumnLayoutProjector.applyLayout(columns(), layout: nil).map(\.key)
        XCTAssertEqual(visible, ["a", "b", "d"], "c is defaultVisible:false")
    }

    func testApplyLayoutDropsHidden() {
        let layout = ColumnLayout(order: [], hidden: ["b"])
        let visible = ColumnLayoutProjector.applyLayout(columns(), layout: layout).map(\.key)
        XCTAssertEqual(visible, ["a", "c", "d"])
    }

    func testApplyLayoutEmptyFallsBackToDefaultVisible() {
        let layout = ColumnLayout(order: [], hidden: ["a", "b", "c", "d"])
        let visible = ColumnLayoutProjector.applyLayout(columns(), layout: layout).map(\.key)
        XCTAssertEqual(visible, ["a", "b", "d"], "all-hidden stale layout falls back to default-visible set")
    }

    func testVisibleCount() {
        XCTAssertEqual(ColumnLayoutProjector.visibleCount(columns(), layout: nil), 3)
    }

    func testMoveColumn() {
        let order = ["a", "b", "c", "d"]
        XCTAssertEqual(ColumnLayoutProjector.moveColumn(order, key: "b", toIndex: 0), ["b", "a", "c", "d"])
        XCTAssertEqual(ColumnLayoutProjector.moveColumn(order, key: "b", toIndex: 3), ["a", "c", "d", "b"])
        XCTAssertEqual(ColumnLayoutProjector.moveColumn(order, key: "z", toIndex: 0), order, "missing key unchanged")
        XCTAssertEqual(ColumnLayoutProjector.moveColumn(order, key: "a", toIndex: 99), ["b", "c", "d", "a"], "clamped")
    }

    func testToggleHiddenPreservesOrder() {
        let layout = ColumnLayout(order: ["a", "b"], hidden: [])
        XCTAssertEqual(ColumnLayoutProjector.toggleHidden(layout, key: "a").hidden, ["a"])
        let hiddenA = ColumnLayout(order: ["a", "b"], hidden: ["a"])
        XCTAssertEqual(ColumnLayoutProjector.toggleHidden(hiddenA, key: "a").hidden, [], "un-hide removes it")
        XCTAssertEqual(ColumnLayoutProjector.toggleHidden(hiddenA, key: "a").order, ["a", "b"])
    }

    func testEffectiveHidden() {
        XCTAssertEqual(ColumnLayoutProjector.effectiveHidden(columns(), layout: nil), ["c"])
        let layout = ColumnLayout(order: [], hidden: ["a"])
        XCTAssertEqual(ColumnLayoutProjector.effectiveHidden(columns(), layout: layout), ["a"])
    }
}

// MARK: - Projector: component mutation handlers

final class ColumnLayoutProjectorHandlerTests: XCTestCase {
    private func columns() -> [ColumnDescriptor] {
        [
            ColumnDescriptor(key: "a", header: "A"),
            ColumnDescriptor(key: "b", header: "B"),
            ColumnDescriptor(key: "c", header: "C", defaultVisible: false),
            ColumnDescriptor(key: "d", header: "")
        ]
    }

    func testToggledLayoutHidesVisible() {
        let next = ColumnLayoutProjector.toggledLayout(columns(), layout: nil, key: "a")
        XCTAssertEqual(next?.hidden.sorted(), ["a", "c"], "hides 'a' on top of the default-hidden 'c'")
    }

    func testToggledLayoutUnhidesHidden() {
        let next = ColumnLayoutProjector.toggledLayout(columns(), layout: nil, key: "c")
        XCTAssertEqual(next?.hidden, [], "un-hides the default-hidden 'c'")
    }

    func testToggledLayoutRefusesLastVisible() {
        let cols = [ColumnDescriptor(key: "a", header: "A"), ColumnDescriptor(key: "b", header: "B")]
        let layout = ColumnLayout(order: ["a", "b"], hidden: ["b"]) // only 'a' visible
        XCTAssertNil(
            ColumnLayoutProjector.toggledLayout(cols, layout: layout, key: "a"),
            "can't hide the last visible column"
        )
    }

    func testMovedLayoutUp() {
        let next = ColumnLayoutProjector.movedLayout(columns(), layout: nil, key: "b", direction: -1)
        XCTAssertEqual(next?.order, ["b", "a", "c", "d"])
        XCTAssertEqual(next?.hidden, ["c"], "hidden set preserved across reorder")
    }

    func testMovedLayoutDown() {
        let next = ColumnLayoutProjector.movedLayout(columns(), layout: nil, key: "a", direction: 1)
        XCTAssertEqual(next?.order, ["b", "a", "c", "d"])
    }

    func testMovedLayoutRefusesOffEnds() {
        XCTAssertNil(ColumnLayoutProjector.movedLayout(columns(), layout: nil, key: "a", direction: -1), "top")
        XCTAssertNil(ColumnLayoutProjector.movedLayout(columns(), layout: nil, key: "d", direction: 1), "bottom")
    }
}

// MARK: - Projector: row projection

final class ColumnLayoutProjectorRowTests: XCTestCase {
    func testRowsFlagsAndOrder() {
        let columns = [
            ColumnDescriptor(key: "sel", header: "", isRequired: true),
            ColumnDescriptor(key: "a", header: "A"),
            ColumnDescriptor(key: "b", header: "B"),
            ColumnDescriptor(key: "c", header: "C", defaultVisible: false)
        ]
        let rows = ColumnLayoutProjector.rows(columns, layout: nil)
        XCTAssertEqual(rows.map(\.key), ["sel", "a", "b", "c"])

        // required column: pinned visible, checkbox disabled
        XCTAssertTrue(rows[0].isVisible)
        XCTAssertTrue(rows[0].toggleDisabled, "required column can't be toggled")
        XCTAssertFalse(rows[0].canMoveUp, "first row can't move up")
        XCTAssertEqual(rows[0].label, "sel", "empty header falls back to key")

        // middle visible column
        XCTAssertTrue(rows[1].isVisible)
        XCTAssertFalse(rows[1].toggleDisabled)
        XCTAssertTrue(rows[1].canMoveUp)
        XCTAssertTrue(rows[1].canMoveDown)

        // default-hidden column
        XCTAssertFalse(rows[3].isVisible, "c is defaultVisible:false")
        XCTAssertFalse(rows[3].canMoveDown, "last row can't move down")
    }

    func testRowsLastVisibleGuardDisablesItsCheckbox() {
        let columns = [ColumnDescriptor(key: "a", header: "A"), ColumnDescriptor(key: "b", header: "B")]
        let layout = ColumnLayout(order: ["a", "b"], hidden: ["b"]) // only 'a' visible
        let rows = ColumnLayoutProjector.rows(columns, layout: layout)
        let rowA = rows.first { $0.key == "a" }
        let rowB = rows.first { $0.key == "b" }
        XCTAssertEqual(rowA?.isVisible, true)
        XCTAssertEqual(rowA?.toggleDisabled, true, "the last visible column's checkbox is disabled")
        XCTAssertEqual(rowB?.isVisible, false)
        XCTAssertEqual(rowB?.toggleDisabled, false, "a hidden column can always be re-shown")
    }

    func testRowsSkipUnknownOrderKeys() {
        let columns = [ColumnDescriptor(key: "a", header: "A")]
        let layout = ColumnLayout(order: ["ghost", "a"], hidden: [])
        let rows = ColumnLayoutProjector.rows(columns, layout: layout)
        XCTAssertEqual(rows.map(\.key), ["a"], "an order key with no descriptor is skipped")
    }
}

// MARK: - Layout metrics

final class DataTableColumnMenuLayoutTests: XCTestCase {
    func testMetricsAreSane() {
        XCTAssertEqual(DataTableColumnMenuLayout.popoverWidth, 288)
        XCTAssertEqual(DataTableColumnMenuLayout.listMaxHeight, 288)
        XCTAssertGreaterThan(DataTableColumnMenuLayout.stepButtonSide, DataTableColumnMenuLayout.iconSide)
        XCTAssertGreaterThan(DataTableColumnMenuLayout.rowMinHeight, 0)
    }
}
