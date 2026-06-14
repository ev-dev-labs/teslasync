//
//  DataTableColumnsMenu.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0211 · DataTableColumnsMenu (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the value types, the layout
//  metrics, and the DataTableColumnsMenuProjector — the verbatim port of the component's two mutation
//  handlers (`toggle` with the last-visible guard + source-order rebuild on show, `showAll`) and the per-row
//  render derivation. Split from DataTableColumnsMenu.Tests.swift (the SwiftUI / state-holder half) to keep
//  each file within the SwiftLint file-length budget. These run in the TeslaSync(/-macOS) XCTest targets; the
//  derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class DataTableColumnsMenuAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(DataTableColumnsMenuSurface.slug, "DataTableColumnsMenu")
    }
}

// MARK: - Value types

final class DataTableColumnsMenuValueTypeTests: XCTestCase {
    func testDisplayLabelFallsBackToKeyWhenHeaderEmpty() {
        XCTAssertEqual(DataTableColumnsMenuColumn(key: "sel", header: "").displayLabel, "sel")
        XCTAssertEqual(DataTableColumnsMenuColumn(key: "name", header: "Drive").displayLabel, "Drive")
    }

    func testColumnDefaults() {
        let col = DataTableColumnsMenuColumn(key: "name", header: "Drive")
        XCTAssertFalse(col.isRequired)
        XCTAssertEqual(col.id, "name")
    }

    func testRowIdentityIsKey() {
        let row = DataTableColumnsMenuRow(key: "a", label: "A", isVisible: true, toggleDisabled: false)
        XCTAssertEqual(row.id, "a")
    }
}

// MARK: - Projector: row derivation

final class DataTableColumnsMenuProjectorRowTests: XCTestCase {
    /// select(required), name, distance, energy(empty header)
    private func columns() -> [DataTableColumnsMenuColumn] {
        [
            DataTableColumnsMenuColumn(key: "select", header: "", isRequired: true),
            DataTableColumnsMenuColumn(key: "name", header: "Drive"),
            DataTableColumnsMenuColumn(key: "distance", header: "Distance"),
            DataTableColumnsMenuColumn(key: "energy", header: "")
        ]
    }

    func testRowsFlagsAndOrder() {
        let rows = DataTableColumnsMenuProjector.rows(columns(), visibleKeys: ["select", "name", "distance"])
        XCTAssertEqual(rows.map(\.key), ["select", "name", "distance", "energy"])

        // required column: pinned visible, checkbox disabled
        XCTAssertTrue(rows[0].isVisible)
        XCTAssertTrue(rows[0].toggleDisabled, "required column can't be toggled")
        XCTAssertEqual(rows[0].label, "select", "empty header falls back to key")

        // middle visible column
        XCTAssertTrue(rows[1].isVisible)
        XCTAssertFalse(rows[1].toggleDisabled)

        // hidden column (not in visibleKeys)
        XCTAssertFalse(rows[3].isVisible, "energy is not visible")
        XCTAssertFalse(rows[3].toggleDisabled, "a hidden column can always be shown")
        XCTAssertEqual(rows[3].label, "energy")
    }

    func testRowsLastVisibleGuardDisablesItsCheckbox() {
        let rows = DataTableColumnsMenuProjector.rows(columns(), visibleKeys: ["name"])
        let rowName = rows.first { $0.key == "name" }
        let rowDistance = rows.first { $0.key == "distance" }
        XCTAssertEqual(rowName?.isVisible, true)
        XCTAssertEqual(rowName?.toggleDisabled, true, "the last visible column's checkbox is disabled")
        XCTAssertEqual(rowDistance?.isVisible, false)
        XCTAssertEqual(rowDistance?.toggleDisabled, false, "a hidden column can always be re-shown")
    }

    func testVisibleColumnsInSourceOrder() {
        let visible = DataTableColumnsMenuProjector
            .visibleColumns(columns(), visibleKeys: ["distance", "select"])
            .map(\.key)
        XCTAssertEqual(visible, ["select", "distance"], "kept in source order regardless of visibleKeys order")
    }
}

// MARK: - Projector: component mutation handlers

final class DataTableColumnsMenuProjectorHandlerTests: XCTestCase {
    private func columns() -> [DataTableColumnsMenuColumn] {
        [
            DataTableColumnsMenuColumn(key: "a", header: "A"),
            DataTableColumnsMenuColumn(key: "b", header: "B"),
            DataTableColumnsMenuColumn(key: "c", header: "C"),
            DataTableColumnsMenuColumn(key: "d", header: "D")
        ]
    }

    func testToggleHidesVisibleColumn() {
        let next = DataTableColumnsMenuProjector.toggledKeys(columns(), visibleKeys: ["a", "b", "c"], key: "b")
        XCTAssertEqual(next, ["a", "c"], "hides 'b', preserving the remaining order")
    }

    func testToggleShowsHiddenColumnInSourceOrder() {
        // 'd' was hidden and the current order is scrambled; showing it rebuilds in source order.
        let next = DataTableColumnsMenuProjector.toggledKeys(columns(), visibleKeys: ["c", "a"], key: "d")
        XCTAssertEqual(next, ["a", "c", "d"], "show rebuilds the list in original column order")
    }

    func testToggleRefusesLastVisibleColumn() {
        XCTAssertNil(
            DataTableColumnsMenuProjector.toggledKeys(columns(), visibleKeys: ["a"], key: "a"),
            "can't hide the last visible column"
        )
    }

    func testToggleShowWhenAllHidden() {
        let next = DataTableColumnsMenuProjector.toggledKeys(columns(), visibleKeys: [], key: "c")
        XCTAssertEqual(next, ["c"], "showing from an empty set yields just that key")
    }

    func testAllKeysIsSourceOrder() {
        XCTAssertEqual(DataTableColumnsMenuProjector.allKeys(columns()), ["a", "b", "c", "d"])
    }

    func testEmptyColumnsProjectEmptyRows() {
        XCTAssertTrue(DataTableColumnsMenuProjector.rows([], visibleKeys: []).isEmpty)
        XCTAssertTrue(DataTableColumnsMenuProjector.allKeys([]).isEmpty)
    }
}

// MARK: - Layout metrics

final class DataTableColumnsMenuLayoutTests: XCTestCase {
    func testMetricsAreSane() {
        XCTAssertEqual(DataTableColumnsMenuLayout.popoverWidth, 224)
        XCTAssertEqual(DataTableColumnsMenuLayout.listMaxHeight, 256)
        XCTAssertGreaterThan(DataTableColumnsMenuLayout.rowMinHeight, 0)
        XCTAssertGreaterThan(DataTableColumnsMenuLayout.checkboxSide, DataTableColumnsMenuLayout.headingFontSize)
    }
}
