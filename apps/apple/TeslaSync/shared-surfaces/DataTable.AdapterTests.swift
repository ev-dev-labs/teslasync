//
//  DataTable.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0208 · DataTable (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity; the projector's column order /
//  per-page slice / page clamp / resolved width / mobile allow-list / leading-column count / duplicate-key
//  guard / content-state / selected-rows / export-disabled rules; the selection arithmetic (all/some, single,
//  membership, additive shift-range, select-all, expansion); the CSV serializer (RFC-4180 escaping + the
//  date-stamped filename); the i18next interpolation; the density metrics; and the value-type semantics. Split
//  from DataTable.Tests.swift (the state-holder / view / facade half) to keep each file within the SwiftLint
//  file-length budget. These run in the TeslaSync(/-macOS) XCTest targets; the derivation is pure, no network.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity + enums

final class DataTableAdapterIdentityTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(DataTableSurface.slug, "DataTable")
    }

    func testSelectionModeFlags() {
        XCTAssertFalse(DataTableSelectionMode.none.isSelectable)
        XCTAssertTrue(DataTableSelectionMode.single.isSelectable)
        XCTAssertTrue(DataTableSelectionMode.multi.isSelectable)
        XCTAssertFalse(DataTableSelectionMode.single.isMulti)
        XCTAssertTrue(DataTableSelectionMode.multi.isMulti)
    }

    func testSortDirectionToggleAndRawValues() {
        XCTAssertEqual(DataTableSortDirection.ascending.toggled, .descending)
        XCTAssertEqual(DataTableSortDirection.descending.toggled, .ascending)
        XCTAssertEqual(DataTableSortDirection.ascending.rawValue, "asc")
        XCTAssertEqual(DataTableSortDirection.descending.rawValue, "desc")
    }

    func testColumnAlignmentRawValuesMatchWeb() {
        XCTAssertEqual(DataTableColumnAlignment.leading.rawValue, "left")
        XCTAssertEqual(DataTableColumnAlignment.center.rawValue, "center")
        XCTAssertEqual(DataTableColumnAlignment.trailing.rawValue, "right")
    }
}

// MARK: - Density metrics (web fixed paddings / row heights)

final class DataTableDensityTests: XCTestCase {
    func testAutoResolvesToComfortable() {
        XCTAssertEqual(DataTableDensity.auto.resolved, .comfortable)
        XCTAssertEqual(DataTableDensity.compact.resolved, .compact)
    }

    func testRowHeightsMatchWebEstimates() {
        XCTAssertEqual(DataTableDensity.compact.rowHeight, 32)
        XCTAssertEqual(DataTableDensity.comfortable.rowHeight, 44)
        XCTAssertEqual(DataTableDensity.spacious.rowHeight, 56)
        XCTAssertEqual(DataTableDensity.auto.rowHeight, 44, "auto follows comfortable natively")
    }

    func testCellPaddingScalesWithDensity() {
        XCTAssertEqual(DataTableDensity.compact.cellPaddingH, 12)
        XCTAssertEqual(DataTableDensity.spacious.cellPaddingV, 16)
        XCTAssertEqual(DataTableDensity.comfortable.cellPaddingH, 16)
    }
}

// MARK: - Column order / visibility (web `applyColumnLayout`)

final class DataTableOrderTests: XCTestCase {
    private func specs() -> [DataTableColumnSpec] {
        [
            DataTableColumnSpec(key: "a", header: "A", alignment: .leading),
            DataTableColumnSpec(key: "b", header: "B", alignment: .center),
            DataTableColumnSpec(key: "c", header: "C", alignment: .trailing)
        ]
    }

    func testNilLayoutKeepsSourceOrder() {
        let ordered = DataTableProjector.orderedVisibleSpecs(specs(), layout: nil)
        XCTAssertEqual(ordered.map(\.key), ["a", "b", "c"])
    }

    func testHiddenColumnIsDropped() {
        let layout = ColumnLayout(order: ["a", "b", "c"], hidden: ["b"])
        let ordered = DataTableProjector.orderedVisibleSpecs(specs(), layout: layout)
        XCTAssertEqual(ordered.map(\.key), ["a", "c"])
    }

    func testReorderIsApplied() {
        let layout = ColumnLayout(order: ["c", "a", "b"], hidden: [])
        let ordered = DataTableProjector.orderedVisibleSpecs(specs(), layout: layout)
        XCTAssertEqual(ordered.map(\.key), ["c", "a", "b"])
    }

    func testMappingPreservesRichSpec() {
        let layout = ColumnLayout(order: ["c", "a"], hidden: ["b"])
        let ordered = DataTableProjector.orderedVisibleSpecs(specs(), layout: layout)
        XCTAssertEqual(ordered.first?.alignment, .trailing, "the reordered head keeps its alignment")
    }
}

// MARK: - Slice / clamp / width / leading / mobile

final class DataTableProjectorTests: XCTestCase {
    func testSliceReturnsThePageWindow() {
        let data = Array(0 ..< 10)
        XCTAssertEqual(DataTableProjector.slice(data, page: 2, pageSize: 3, enabled: true), [3, 4, 5])
    }

    func testSliceDisabledReturnsAll() {
        let data = Array(0 ..< 5)
        XCTAssertEqual(DataTableProjector.slice(data, page: 1, pageSize: 2, enabled: false), data)
    }

    func testSlicePastEndIsEmpty() {
        let data = Array(0 ..< 4)
        XCTAssertEqual(DataTableProjector.slice(data, page: 9, pageSize: 2, enabled: true), [])
    }

    func testClampedPage() {
        XCTAssertEqual(DataTableProjector.clampedPage(page: 5, pageSize: 3, total: 7), 3)
        XCTAssertEqual(DataTableProjector.clampedPage(page: 0, pageSize: 3, total: 7), 1)
        XCTAssertEqual(DataTableProjector.clampedPage(page: 2, pageSize: 3, total: 0), 1)
    }

    func testLeadingColumnCount() {
        XCTAssertEqual(DataTableProjector.leadingColumnCount(selection: .none, expandable: false), 0)
        XCTAssertEqual(DataTableProjector.leadingColumnCount(selection: .multi, expandable: false), 1)
        XCTAssertEqual(DataTableProjector.leadingColumnCount(selection: .none, expandable: true), 1)
        XCTAssertEqual(DataTableProjector.leadingColumnCount(selection: .single, expandable: true), 2)
    }

    func testResolvedWidth() {
        let spec = DataTableColumnSpec(key: "a", header: "A", defaultWidth: 120)
        XCTAssertEqual(DataTableProjector.width(for: spec, widths: ["a": 200]), 200, "stored width wins")
        XCTAssertEqual(DataTableProjector.width(for: spec, widths: [:]), 120, "falls back to defaultWidth")
        let noDefault = DataTableColumnSpec(key: "b", header: "B")
        XCTAssertNil(DataTableProjector.width(for: noDefault, widths: [:]))
    }

    func testMobileKeySet() {
        let specs = [
            DataTableColumnSpec(key: "a", header: "A", visibleOnMobile: true),
            DataTableColumnSpec(key: "b", header: "B", visibleOnMobile: false)
        ]
        XCTAssertEqual(DataTableProjector.mobileKeySet(specs, explicit: ["b"]), ["b"], "explicit wins")
        XCTAssertEqual(DataTableProjector.mobileKeySet(specs, explicit: nil), ["a"], "derived from visibleOnMobile")
        let none = [DataTableColumnSpec(key: "x", header: "X")]
        XCTAssertNil(DataTableProjector.mobileKeySet(none, explicit: nil))
    }

    func testIsHiddenOnMobile() {
        XCTAssertTrue(DataTableProjector.isHiddenOnMobile(key: "z", mobileSet: ["a", "b"]))
        XCTAssertFalse(DataTableProjector.isHiddenOnMobile(key: "a", mobileSet: ["a", "b"]))
        XCTAssertFalse(DataTableProjector.isHiddenOnMobile(key: "a", mobileSet: nil), "no allow-list shows all")
    }
}

// MARK: - Content state (web tbody branches)

final class DataTableContentStateTests: XCTestCase {
    func testDuplicateKeyDetection() {
        XCTAssertTrue(DataTableProjector.hasDuplicateKeys(["a", "b", "a"]))
        XCTAssertFalse(DataTableProjector.hasDuplicateKeys(["a", "b", "c"]))
    }

    func testEmptyWhenNoRows() {
        let state = DataTableProjector.contentState(rowCount: 0, forcedFailure: false, hasDuplicateKeys: false)
        XCTAssertEqual(state, .empty)
    }

    func testForcedFailureWinsEvenWhenEmpty() {
        let state = DataTableProjector.contentState(rowCount: 0, forcedFailure: true, hasDuplicateKeys: false)
        XCTAssertEqual(state, .failed)
    }

    func testDuplicateKeysFailOnPopulatedBody() {
        let state = DataTableProjector.contentState(rowCount: 3, forcedFailure: false, hasDuplicateKeys: true)
        XCTAssertEqual(state, .failed)
    }

    func testPopulatedRows() {
        let state = DataTableProjector.contentState(rowCount: 3, forcedFailure: false, hasDuplicateKeys: false)
        XCTAssertEqual(state, .rows)
    }

    func testSelectedRowsAndExportDisabled() {
        let data = ["a", "b", "c"]
        let selected = DataTableProjector.selectedRows(
            data,
            selection: ["a", "c"],
            isSelectable: true,
            keyExtractor: { $0 }
        )
        XCTAssertEqual(selected, ["a", "c"])
        XCTAssertTrue(DataTableProjector.isExportDisabled(exporting: false, rowCount: 0))
        XCTAssertTrue(DataTableProjector.isExportDisabled(exporting: true, rowCount: 5))
        XCTAssertFalse(DataTableProjector.isExportDisabled(exporting: false, rowCount: 5))
    }
}

// MARK: - Selection arithmetic (web `toggleRow` / `toggleAll`)

final class DataTableSelectionProjectorTests: XCTestCase {
    private let keys = ["a", "b", "c", "d"]

    func testAllAndSomeSelected() {
        XCTAssertTrue(DataTableSelectionProjector.allSelected(allKeys: keys, selection: ["a", "b", "c", "d"]))
        XCTAssertFalse(DataTableSelectionProjector.allSelected(allKeys: keys, selection: ["a"]))
        XCTAssertFalse(DataTableSelectionProjector.allSelected(allKeys: [], selection: []))
        XCTAssertTrue(DataTableSelectionProjector.someSelected(allKeys: keys, selection: ["a"]))
        XCTAssertFalse(DataTableSelectionProjector.someSelected(allKeys: keys, selection: ["a", "b", "c", "d"]))
        XCTAssertFalse(DataTableSelectionProjector.someSelected(allKeys: keys, selection: []))
    }

    func testSingleSelectReplacesAndClears() {
        XCTAssertEqual(DataTableSelectionProjector.toggleSingle(selection: [], key: "b"), ["b"])
        XCTAssertEqual(DataTableSelectionProjector.toggleSingle(selection: ["a"], key: "b"), ["b"])
        XCTAssertEqual(DataTableSelectionProjector.toggleSingle(selection: ["b"], key: "b"), [])
    }

    func testMembershipToggle() {
        XCTAssertEqual(DataTableSelectionProjector.toggleMembership(selection: ["a"], key: "b"), ["a", "b"])
        XCTAssertEqual(DataTableSelectionProjector.toggleMembership(selection: ["a", "b"], key: "b"), ["a"])
    }

    func testAdditiveRange() {
        let next = DataTableSelectionProjector.selectRange(
            allKeys: keys,
            selection: ["a"],
            anchor: "b",
            target: "d"
        )
        XCTAssertEqual(next, ["a", "b", "c", "d"], "the inclusive b…d range unions into the selection")
    }

    func testRangeIsOrderIndependent() {
        let next = DataTableSelectionProjector.selectRange(allKeys: keys, selection: [], anchor: "d", target: "b")
        XCTAssertEqual(next, ["b", "c", "d"])
    }

    func testRangeFallsBackToMembershipWhenEndpointMissing() {
        let next = DataTableSelectionProjector.selectRange(
            allKeys: keys,
            selection: [],
            anchor: "zzz",
            target: "c"
        )
        XCTAssertEqual(next, ["c"], "a missing anchor degrades to a plain toggle of the target")
    }

    func testToggleAll() {
        XCTAssertEqual(DataTableSelectionProjector.toggleAll(allKeys: keys, selection: []), Set(keys))
        XCTAssertEqual(DataTableSelectionProjector.toggleAll(allKeys: keys, selection: Set(keys)), [])
    }

    func testExpansionToggle() {
        XCTAssertEqual(DataTableSelectionProjector.toggleExpansion(expansion: [], key: "a"), ["a"])
        XCTAssertEqual(DataTableSelectionProjector.toggleExpansion(expansion: ["a"], key: "a"), [])
    }
}

// MARK: - CSV + interpolation (web `lib/csvExport` + i18next)

final class DataTableCSVTests: XCTestCase {
    func testEscapeQuotesOnlyWhenNeeded() {
        XCTAssertEqual(DataTableCSV.escape("plain"), "plain")
        XCTAssertEqual(DataTableCSV.escape("a,b"), "\"a,b\"")
        XCTAssertEqual(DataTableCSV.escape("a\"b"), "\"a\"\"b\"", "embedded quotes are doubled")
        XCTAssertEqual(DataTableCSV.escape("a\nb"), "\"a\nb\"")
    }

    func testRecordJoinsEscapedCells() {
        XCTAssertEqual(DataTableCSV.record(["a", "b,c", "d"]), "a,\"b,c\",d")
    }

    func testEncodeJoinsHeaderAndRowsWithCRLF() {
        let csv = DataTableCSV.encode(headers: ["Name", "SoC"], rows: [["Aurora", "82"], ["Comet", "47"]])
        XCTAssertEqual(csv, "Name,SoC\r\nAurora,82\r\nComet,47")
    }

    func testDefaultFilenameIsDateStamped() {
        let epoch = Date(timeIntervalSince1970: 0)
        XCTAssertEqual(DataTableCSV.defaultFilename(base: "drives", date: epoch), "drives-1970-01-01")
        XCTAssertEqual(DataTableCSV.defaultFilename(base: "", date: epoch), "table-1970-01-01")
    }

    func testInterpolationReplacesEveryToken() {
        XCTAssertEqual(
            DataTableInterpolation.interpolate("Resize column {{col}} ({{col}})", ["col": "VIN"]),
            "Resize column VIN (VIN)"
        )
    }
}

// MARK: - Value-type semantics

final class DataTableValueTypeTests: XCTestCase {
    func testColumnSpecEquality() {
        let base = DataTableColumnSpec(key: "a", header: "A", sortable: true)
        XCTAssertEqual(base, DataTableColumnSpec(key: "a", header: "A", sortable: true))
        XCTAssertNotEqual(base, DataTableColumnSpec(key: "a", header: "A", sortable: false))
    }

    func testColumnSpecDisplayLabelFallsBackToKey() {
        XCTAssertEqual(DataTableColumnSpec(key: "vin", header: "").displayLabel, "vin")
        XCTAssertEqual(DataTableColumnSpec(key: "vin", header: "VIN").displayLabel, "VIN")
    }

    func testPaginationDefaults() {
        XCTAssertEqual(DataTablePagination.standard.defaultPageSize, 25)
        XCTAssertEqual(DataTablePagination.standard.pageSizeOptions, [20, 50, 100])
    }
}
