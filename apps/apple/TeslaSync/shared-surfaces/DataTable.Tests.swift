//
//  DataTable.Tests.swift
//  TeslaSync — P4 shared surface · 0208 · DataTable (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projector / selection / CSV
//  live in DataTable.AdapterTests.swift; split to keep each file within the SwiftLint file-length budget):
//    • DataTableModel — the once-only `view.opened`; the owned page / page-size (size change resets to page 1,
//      data-count change resets to page 1); the layout + widths + export + failure mutators; the selection
//      routing (single replace/clear, multi membership, the additive shift-range from the advancing anchor,
//      select-all, clear); the expansion toggle; and the controlled-prop update (set + closure refresh).
//    • Views — the public surface + the leaf cells compose.
//    • Strings — every web `t(...)` key resolves through the P1/S10 facade with the English fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - DataTableModel (owned state + selection routing)

@MainActor
final class DataTableModelTests: XCTestCase {
    private let keys = ["a", "b", "c", "d"]

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyDataTableTelemetry()
        let model = DataTableModel(telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [DataTableSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyDataTableTelemetry()
        let model = DataTableModel(telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, [DataTableSurface.slug], "view.opened fires once per instance")
    }

    func testPaginationMutators() {
        let model = DataTableModel(pageSize: 25)
        model.setPage(4)
        XCTAssertEqual(model.page, 4)
        model.setPage(0)
        XCTAssertEqual(model.page, 1, "page clamps to at least 1")
        model.setPage(3)
        model.setPageSize(50)
        XCTAssertEqual(model.pageSize, 50)
        XCTAssertEqual(model.page, 1, "a page-size change returns to page 1")
        model.setPage(2)
        model.resetPageForDataChange()
        XCTAssertEqual(model.page, 1, "a data-count change returns to page 1")
    }

    func testLayoutWidthsExportFailureMutators() {
        let model = DataTableModel()
        model.setLayout(ColumnLayout(order: ["b", "a"], hidden: ["c"]))
        XCTAssertEqual(model.layout?.order, ["b", "a"])
        model.resetLayout()
        XCTAssertNil(model.layout)
        model.setWidth(key: "a", width: 120)
        model.commitWidth(key: "a", width: 160)
        XCTAssertEqual(model.widths["a"], 160)
        model.beginExport()
        XCTAssertTrue(model.exporting)
        model.endExport()
        XCTAssertFalse(model.exporting)
        model.markFailure()
        XCTAssertTrue(model.forcedFailure)
        model.retry()
        XCTAssertFalse(model.forcedFailure)
        model.setDragOver("a")
        XCTAssertEqual(model.dragOverColumnKey, "a")
    }

    func testSingleSelectReplacesAndMirrors() {
        let recorder = SelectionRecorder()
        let model = DataTableModel(onSelectionChange: { recorder.record($0) })
        model.toggleRow(key: "b", shift: false, mode: .single, allKeys: keys)
        XCTAssertEqual(model.selection, ["b"])
        XCTAssertEqual(recorder.last, ["b"], "the host is notified (web onSelectionChange)")
        model.toggleRow(key: "b", shift: false, mode: .single, allKeys: keys)
        XCTAssertEqual(model.selection, [], "re-picking the sole row clears it")
    }

    func testMultiMembershipAndShiftRangeFromAdvancingAnchor() {
        let model = DataTableModel()
        model.toggleRow(key: "b", shift: false, mode: .multi, allKeys: keys)
        XCTAssertEqual(model.selection, ["b"], "a plain multi click toggles membership + advances the anchor")
        model.toggleRow(key: "d", shift: true, mode: .multi, allKeys: keys)
        XCTAssertEqual(model.selection, ["b", "c", "d"], "a shift click unions the b…d range")
    }

    func testToggleAllAndClear() {
        let model = DataTableModel()
        model.toggleAll(allKeys: keys)
        XCTAssertEqual(model.selection, Set(keys))
        model.toggleAll(allKeys: keys)
        XCTAssertEqual(model.selection, [])
        model.toggleRow(key: "a", shift: false, mode: .multi, allKeys: keys)
        model.clearSelection()
        XCTAssertEqual(model.selection, [])
    }

    func testExpansionToggleMirrors() {
        let recorder = SelectionRecorder()
        let model = DataTableModel(onExpandedChange: { recorder.record($0) })
        model.toggleExpand(key: "a")
        XCTAssertEqual(model.expansion, ["a"])
        XCTAssertEqual(recorder.last, ["a"])
        model.toggleExpand(key: "a")
        XCTAssertEqual(model.expansion, [])
    }

    func testUpdateRefreshesControlledSetsAndClosures() {
        let stale = SelectionRecorder()
        let fresh = SelectionRecorder()
        let model = DataTableModel(onSelectionChange: { stale.record($0) })
        model.update(selection: ["x"], expansion: ["y"], onSelectionChange: { fresh.record($0) }, onExpandedChange: nil)
        XCTAssertEqual(model.selection, ["x"])
        XCTAssertEqual(model.expansion, ["y"])
        model.toggleRow(key: "z", shift: false, mode: .multi, allKeys: ["x", "z"])
        XCTAssertTrue(stale.events.isEmpty, "the stale closure is discarded")
        XCTAssertEqual(fresh.last, ["x", "z"], "the change routes through the refreshed closure")
    }

    func testSelectionIsNoOpInNoneMode() {
        let model = DataTableModel()
        model.toggleRow(key: "a", shift: false, mode: .none, allKeys: keys)
        XCTAssertEqual(model.selection, [])
    }
}

// MARK: - Views (public surface + leaf cells compose)

@MainActor
final class DataTableViewTests: XCTestCase {
    private func columns() -> [DataTableColumn<String>] {
        [
            DataTableColumn(key: "value", header: "Value", sortable: true) { Text(verbatim: $0) }
                .exportingText { $0 }
        ]
    }

    func testSurfaceComposesFromProps() {
        _ = DataTable(
            data: ["a", "b"],
            columns: columns(),
            keyExtractor: { $0 },
            sortKey: "value",
            sortDirection: .descending,
            onSort: { _ in },
            density: .compact,
            pagination: .standard,
            tableId: "t",
            selectionMode: .multi,
            selectedKeys: ["a"],
            onSelectionChange: { _ in },
            bulkActions: { rows in AnyView(Text(verbatim: "\(rows.count)")) },
            expandable: true,
            expandedKeys: [],
            onExpandedChange: { _ in },
            renderExpanded: { AnyView(Text(verbatim: $0)) },
            resizable: true,
            columnVisibility: true,
            columnReorder: true,
            exportable: true,
            rowContextMenu: { row in [DataTableMenuAction(title: "Copy \(row)", action: {})] }
        )
        XCTAssertEqual(DataTable<String>.surfaceSlug, "DataTable")
    }

    func testLeafCellsCompose() {
        _ = DataTableEmptyRow(message: "Empty", width: 320)
        _ = DataTableErrorFallback(width: 320, onRetry: {})
        _ = DataTableSelectAllToggle(allSelected: false, someSelected: true, onToggle: {})
        _ = DataTableExpandControl(isExpanded: true, onToggle: {})
        _ = DataTableSelectionControl(isSelected: true, isMulti: true, onToggle: { _ in })
        _ = DataTableCSVDocument(text: "a,b\r\n1,2")
    }
}

// MARK: - Strings facade (P1/S10)

final class DataTableStringsTests: XCTestCase {
    func testSelectionAndExpansionLabels() {
        XCTAssertEqual(DataTableStrings.rowSelectionLabel(isSelected: true), "Deselect row")
        XCTAssertEqual(DataTableStrings.rowSelectionLabel(isSelected: false), "Select row")
        XCTAssertEqual(DataTableStrings.selectAllLabel(allSelected: true), "Deselect all rows")
        XCTAssertEqual(DataTableStrings.selectAllLabel(allSelected: false), "Select all rows")
        XCTAssertEqual(DataTableStrings.rowExpansionLabel(isExpanded: true), "Collapse row")
        XCTAssertEqual(DataTableStrings.rowExpansionLabel(isExpanded: false), "Expand row")
        XCTAssertEqual(DataTableStrings.expandColumnHeader, "Expand row")
    }

    func testExportErrorEmptyAndResizeLabels() {
        XCTAssertEqual(DataTableStrings.exportButtonLabel, "Download CSV")
        XCTAssertEqual(DataTableStrings.exportAccessibilityLabel, "Download table as CSV")
        XCTAssertEqual(DataTableStrings.errorTitle, "This table failed to render")
        XCTAssertEqual(DataTableStrings.retry, "Try again")
        XCTAssertEqual(DataTableStrings.emptyDefault, "No data")
        XCTAssertEqual(DataTableStrings.resizeLabel(column: "VIN"), "Resize column VIN")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6.
private final class SpyDataTableTelemetry: DataTableTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}

/// Records the selection / expansion sets routed out through the `@MainActor` host closures.
@MainActor
private final class SelectionRecorder {
    private(set) var events: [Set<DataTableRowKey>] = []

    var last: Set<DataTableRowKey>? {
        events.last
    }

    func record(_ value: Set<DataTableRowKey>) {
        events.append(value)
    }
}
