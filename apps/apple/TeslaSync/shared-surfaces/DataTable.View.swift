//
//  DataTable.View.swift
//  TeslaSync — P4 shared surface · 0208 · DataTable (Apple)
//
//  The public API of the sortable data table — the SwiftUI parity of `components/ui/DataTable.tsx`. Like the
//  web component it is PROP-DRIVEN (no fetcher): the host supplies `data`, the `columns` (each with a cell
//  renderer), and a `keyExtractor`, plus the optional sort / selection / expansion / resize / column-menu /
//  export / pagination / context-menu knobs. The view binds through ``DataTableModel`` (P1/S8) for the owned
//  page / layout / widths / export / failure state and the controlled selection / expansion sets, composes the
//  sibling surfaces at their integration points — ``DataTableBulkBar`` (0209) + ``DataTableColumnMenu`` (0210)
//  in the toolbar, ``DataTableResizer`` (0212) on resizable headers, ``PaginationView`` (0221) in the footer
//  (each its own prompt, out of scope here) — and renders the table's own chrome (header, rows, empty, error)
//  with the design tokens (P1/S9). It emits `view.opened` once (P1/S11). No networking, no Tailwind ports.
//

import SwiftUI

/// The sortable data table — the SwiftUI parity of `components/ui/DataTable.tsx`. Passing only `data`,
/// `columns`, and `keyExtractor` gives the lightweight base table; every advanced feature (sort, single/multi
/// selection with a bulk bar, expandable row drawers, per-column resize, a column visibility/reorder menu, CSV
/// export, pagination, a row context menu, mobile column hiding, and density) is an opt-in prop, exactly as on
/// the web. The body renders the toolbar, the sticky-header scroll region with lazily-windowed rows (the
/// native peer of the web `useVirtualizer`), and the pager — with real empty and error branches.
public struct DataTable<Row>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        DataTableSurface.slug
    }

    let data: [Row]
    let columns: [DataTableColumn<Row>]
    let keyExtractor: (Row) -> DataTableRowKey
    let sortKey: String?
    let sortDirection: DataTableSortDirection?
    let onSort: ((String) -> Void)?
    let emptyMessage: String?
    let density: DataTableDensity
    let pagination: DataTablePagination?
    let mobileColumns: [String]?
    let tableId: String?
    let selectionMode: DataTableSelectionMode
    let selectedKeys: Set<DataTableRowKey>
    let onSelectionChange: (@MainActor (Set<DataTableRowKey>) -> Void)?
    let bulkActions: ((_ selected: [Row]) -> AnyView)?
    let stickyHeader: Bool
    let maxHeight: CGFloat?
    let expandable: Bool
    let expandedKeys: Set<DataTableRowKey>
    let onExpandedChange: (@MainActor (Set<DataTableRowKey>) -> Void)?
    let renderExpanded: ((Row) -> AnyView)?
    let resizable: Bool
    let columnVisibility: Bool
    let columnReorder: Bool
    let exportable: Bool
    let exportFilename: String?
    let exportAll: (() async -> [Row])?
    let rowContextMenu: ((Row) -> [DataTableMenuAction])?

    @State var model: DataTableModel
    @State var paginationController: PaginationController
    @State var columnMenuController: DataTableColumnMenuController
    @State var exportDocument: DataTableCSVDocument?
    @State var isExportPresented = false
    @Environment(\.horizontalSizeClass) var horizontalSizeClass

    public init(
        data: [Row],
        columns: [DataTableColumn<Row>],
        keyExtractor: @escaping (Row) -> DataTableRowKey,
        sortKey: String? = nil,
        sortDirection: DataTableSortDirection? = nil,
        onSort: ((String) -> Void)? = nil,
        emptyMessage: String? = nil,
        density: DataTableDensity = .auto,
        pagination: DataTablePagination? = nil,
        mobileColumns: [String]? = nil,
        tableId: String? = nil,
        selectionMode: DataTableSelectionMode = .none,
        selectedKeys: Set<DataTableRowKey> = [],
        onSelectionChange: (@MainActor (Set<DataTableRowKey>) -> Void)? = nil,
        bulkActions: ((_ selected: [Row]) -> AnyView)? = nil,
        stickyHeader: Bool = true,
        maxHeight: CGFloat? = nil,
        expandable: Bool = false,
        expandedKeys: Set<DataTableRowKey> = [],
        onExpandedChange: (@MainActor (Set<DataTableRowKey>) -> Void)? = nil,
        renderExpanded: ((Row) -> AnyView)? = nil,
        resizable: Bool = false,
        columnVisibility: Bool = false,
        columnReorder: Bool = false,
        exportable: Bool = false,
        exportFilename: String? = nil,
        exportAll: (() async -> [Row])? = nil,
        rowContextMenu: ((Row) -> [DataTableMenuAction])? = nil,
        telemetry: any DataTableTelemetry = OSLogDataTableTelemetry()
    ) {
        self.data = data
        self.columns = columns
        self.keyExtractor = keyExtractor
        self.sortKey = sortKey
        self.sortDirection = sortDirection
        self.onSort = onSort
        self.emptyMessage = emptyMessage
        self.density = density
        self.pagination = pagination
        self.mobileColumns = mobileColumns
        self.tableId = tableId
        self.selectionMode = selectionMode
        self.selectedKeys = selectedKeys
        self.onSelectionChange = onSelectionChange
        self.bulkActions = bulkActions
        self.stickyHeader = stickyHeader
        self.maxHeight = maxHeight
        self.expandable = expandable
        self.expandedKeys = expandedKeys
        self.onExpandedChange = onExpandedChange
        self.renderExpanded = renderExpanded
        self.resizable = resizable
        self.columnVisibility = columnVisibility
        self.columnReorder = columnReorder
        self.exportable = exportable
        self.exportFilename = exportFilename
        self.exportAll = exportAll
        self.rowContextMenu = rowContextMenu
        let holder = DataTableModel(
            pageSize: pagination?.defaultPageSize ?? 25,
            selection: selectedKeys,
            expansion: expandedKeys,
            onSelectionChange: onSelectionChange,
            onExpandedChange: onExpandedChange,
            telemetry: telemetry
        )
        _model = State(initialValue: holder)
        _paginationController = State(initialValue: DataTableComposition.pagination(
            holder,
            config: pagination,
            total: data.count
        ))
        _columnMenuController = State(initialValue: DataTableComposition.columnMenu(
            holder,
            specs: columns.map(\.spec),
            toggleable: columnVisibility || columnReorder,
            reorderable: columnReorder
        ))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: DataTableMetrics.sectionSpacing) {
            if showsToolbar {
                toolbar
            }
            scrollRegion
            if isPaginationEnabled, !data.isEmpty {
                PaginationView(controller: paginationController)
            }
        }
        .onAppear { onAppear() }
        .onDisappear { model.stop() }
        .onChange(of: data.count) { _, total in onDataCountChange(total) }
        .onChange(of: model.page) { _, page in paginationController.page = page }
        .onChange(of: model.pageSize) { _, size in syncPageSize(size) }
        .onChange(of: model.layout) { _, layout in columnMenuController.apply(layout) }
        .onChange(of: selectedKeys) { _, keys in syncControlledInputs(selection: keys, expansion: expandedKeys) }
        .onChange(of: expandedKeys) { _, keys in syncControlledInputs(selection: selectedKeys, expansion: keys) }
        .fileExporter(
            isPresented: $isExportPresented,
            document: exportDocument,
            contentType: .commaSeparatedText,
            defaultFilename: exportFilename ?? DataTableCSV.defaultFilename(base: tableId ?? "table", date: Date())
        ) { _ in model.endExport() }
        .accessibilityElement(children: .contain)
    }
}
