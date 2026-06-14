//
//  DataTable.Logic.swift
//  TeslaSync — P4 shared surface · 0208 · DataTable (Apple)
//
//  The data table's derived render state (the web pure derivations), its composition (toolbar · sticky-header
//  scroll region · body branches), and its lifecycle / controlled-prop sync — split out of `DataTable.swift`
//  to keep each file within the SwiftLint file-length budget. Every derivation delegates to the Foundation-only
//  ``DataTableProjector`` / ``DataTableSelectionProjector`` so the view holds no branch logic of its own.
//

import SwiftUI

// MARK: - Derived state (web pure derivations)

extension DataTable {
    /// The ordered, visible columns for the current layout, additionally filtered to the mobile allow-list on
    /// compact widths — the web `visibleColumns` + `colHiddenClass` combined.
    var effectiveColumns: [DataTableColumn<Row>] {
        let ordered = DataTableProjector.orderedVisibleSpecs(columns.map(\.spec), layout: model.layout)
        let byKey = Dictionary(columns.map { ($0.key, $0) }, uniquingKeysWith: { first, _ in first })
        let result = ordered.compactMap { byKey[$0.key] }
        guard horizontalSizeClass == .compact else { return result }
        guard let mobileSet = DataTableProjector.mobileKeySet(columns.map(\.spec), explicit: mobileColumns) else {
            return result
        }
        return result.filter { mobileSet.contains($0.key) }
    }

    /// Every row key in source order (web `allRowKeys`).
    var allKeys: [DataTableRowKey] {
        data.map(keyExtractor)
    }

    /// The current page's rows (web `paginatedData`).
    var pageRows: [Row] {
        DataTableProjector.slice(data, page: model.page, pageSize: model.pageSize, enabled: isPaginationEnabled)
    }

    /// The page's rows wrapped with their stable id for `ForEach` (web the React `key={rowKey}`).
    var keyedPageRows: [DataTableKeyedRow<Row>] {
        pageRows.map { DataTableKeyedRow(id: keyExtractor($0), value: $0) }
    }

    /// The selected rows in source order, for the bulk-actions slot (web `selectedRows`).
    var selectedRows: [Row] {
        DataTableProjector.selectedRows(
            data,
            selection: model.selection,
            isSelectable: selectionMode.isSelectable,
            keyExtractor: keyExtractor
        )
    }

    /// Whether every row is selected — drives the header select-all control (web `allSelected`).
    var allSelected: Bool {
        DataTableSelectionProjector.allSelected(allKeys: allKeys, selection: model.selection)
    }

    /// Whether some-but-not-all rows are selected — the header indeterminate state (web `someSelected`).
    var someSelected: Bool {
        DataTableSelectionProjector.someSelected(allKeys: allKeys, selection: model.selection)
    }

    /// The resolved body branch (web `<tbody>` conditional): error → empty → populated.
    var contentState: DataTableContentState {
        DataTableProjector.contentState(
            rowCount: data.count,
            forcedFailure: model.forcedFailure,
            hasDuplicateKeys: DataTableProjector.hasDuplicateKeys(pageRows.map(keyExtractor))
        )
    }

    /// Whether pagination is enabled (web `paginationEnabled = !!pagination`).
    var isPaginationEnabled: Bool {
        pagination != nil
    }

    /// Whether the column visibility / reorder menu renders (web `showColumnMenu`, requires a `tableId`).
    var showsColumnMenu: Bool {
        (columnVisibility || columnReorder) && tableId != nil
    }

    /// Whether the toolbar row renders (web `showToolbar`): the column menu, a non-empty selection, or export.
    var showsToolbar: Bool {
        showsColumnMenu || (selectionMode.isSelectable && !selectedRows.isEmpty) || exportable
    }

    /// Whether per-column resize handles render (web `resizable && tableId`).
    var resizeEnabled: Bool {
        resizable && tableId != nil
    }

    /// Whether header drag-to-reorder is active (web `headerReorderEnabled`).
    var reorderEnabled: Bool {
        columnReorder && tableId != nil
    }

    /// The empty-body message (web `emptyMessage` default "No data").
    var resolvedEmptyMessage: String {
        emptyMessage ?? DataTableStrings.emptyDefault
    }

    /// The number of leading control columns (web `leadingColCount`).
    var leadingColumnCount: Int {
        DataTableProjector.leadingColumnCount(selection: selectionMode, expandable: expandable)
    }

    /// The resolved width in points for a column (web `widthFor`, then the default column width fallback).
    func columnWidth(for spec: DataTableColumnSpec) -> CGFloat {
        if let resolved = DataTableProjector.width(for: spec, widths: model.widths) {
            return CGFloat(resolved)
        }
        return DataTableMetrics.defaultColumnWidth
    }

    /// The full content width (leading controls + every visible column) — sizes the empty / error rows to span.
    var totalContentWidth: CGFloat {
        let leading = CGFloat(leadingColumnCount) * DataTableMetrics.controlColumnWidth
        return leading + effectiveColumns.reduce(0) { $0 + columnWidth(for: $1.spec) }
    }
}

// MARK: - Composition (toolbar · scroll region · body)

extension DataTable {
    /// The toolbar — the bulk bar (composed ``DataTableBulkBar``), the CSV export control, and the column menu
    /// (composed ``DataTableColumnMenu``), shown only when at least one of them is relevant (web `showToolbar`).
    var toolbar: some View {
        DataTableToolbar(
            exportable: exportable,
            exporting: model.exporting,
            exportDisabled: DataTableProjector.isExportDisabled(exporting: model.exporting, rowCount: data.count),
            onExport: { performExport() },
            showsColumnMenu: showsColumnMenu,
            columnMenuController: columnMenuController,
            selectionEnabled: selectionMode.isSelectable,
            selectedCount: selectedRows.count,
            onClearSelection: { model.clearSelection() },
            bulkActions: bulkActions.map { $0(selectedRows) }
        )
    }

    /// The sticky-header scroll region — a horizontally + vertically scrollable, lazily-windowed table (the
    /// native peer of the web `overflow` wrapper + `useVirtualizer`), with the header pinned (web `stickyHead`).
    var scrollRegion: some View {
        ScrollView([.horizontal, .vertical]) {
            LazyVStack(alignment: .leading, spacing: 0, pinnedViews: effectiveStickyHeaderPins) {
                Section {
                    bodyContent
                } header: {
                    headerRow
                }
            }
        }
        .frame(maxHeight: maxHeight)
        .background(TSMaterial.panel, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: DataTableMetrics.separatorWidth)
        )
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
    }

    /// The pinned-views set for the lazy stack (web `stickyHeader` default true).
    var effectiveStickyHeaderPins: PinnedScrollableViews {
        stickyHeader ? [.sectionHeaders] : []
    }

    /// The header row (sort toggles, select-all, expand header, grips, resize handles).
    var headerRow: some View {
        DataTableHeaderRow(
            specs: effectiveColumns.map(\.spec),
            selectionMode: selectionMode,
            expandable: expandable,
            sortKey: sortKey,
            sortDirection: sortDirection,
            onSort: onSort,
            allSelected: allSelected,
            someSelected: someSelected,
            onToggleAll: { model.toggleAll(allKeys: allKeys) },
            resizeEnabled: resizeEnabled,
            reorderEnabled: reorderEnabled,
            dragOverKey: model.dragOverColumnKey,
            controlWidth: DataTableMetrics.controlColumnWidth,
            width: { columnWidth(for: $0) },
            onResize: { key, value in model.setWidth(key: key, width: value) },
            onResizeEnd: { key, value in model.commitWidth(key: key, width: value) },
            onReorderTo: { source, target in reorderTo(source: source, target: target) },
            onDragOver: { key in model.setDragOver(key) }
        )
        .background(TSMaterial.panel)
    }

    /// The body — the resolved content-state branch (web `<tbody>`): error fallback, empty row, or the rows.
    @ViewBuilder
    var bodyContent: some View {
        switch contentState {
        case .failed:
            DataTableErrorFallback(width: totalContentWidth, onRetry: { model.retry() })
        case .empty:
            DataTableEmptyRow(message: resolvedEmptyMessage, width: totalContentWidth)
        case .rows:
            ForEach(keyedPageRows) { keyed in
                dataRow(keyed)
            }
        }
    }

    /// One data row + its optional expanded drawer (web `renderDataRow`).
    func dataRow(_ keyed: DataTableKeyedRow<Row>) -> some View {
        DataTableDataRow(
            row: keyed.value,
            rowKey: keyed.id,
            columns: effectiveColumns,
            selectionMode: selectionMode,
            isSelected: model.selection.contains(keyed.id),
            expandable: expandable,
            isExpanded: model.expansion.contains(keyed.id),
            density: density,
            controlWidth: DataTableMetrics.controlColumnWidth,
            width: { columnWidth(for: $0) },
            onToggleRow: { shift in
                model.toggleRow(key: keyed.id, shift: shift, mode: selectionMode, allKeys: allKeys)
            },
            onToggleExpand: { model.toggleExpand(key: keyed.id) },
            expandedContent: renderExpanded.map { $0(keyed.value) },
            contextActions: rowContextMenu?(keyed.value) ?? []
        )
    }
}

// MARK: - Lifecycle / sync (web effects + controlled props)

extension DataTable {
    /// First appear — emits `view.opened`, feeds the controlled props in, and syncs the composed controllers.
    func onAppear() {
        model.start()
        syncControlledInputs(selection: selectedKeys, expansion: expandedKeys)
        paginationController.total = data.count
        paginationController.page = model.page
        paginationController.pageSize = model.pageSize
        columnMenuController.apply(model.layout)
    }

    /// The web `useEffect(() => setPage(1), [data.length])` — reset to page 1 and resync the pager totals.
    func onDataCountChange(_ total: Int) {
        model.resetPageForDataChange()
        paginationController.total = total
        paginationController.page = model.page
    }

    /// Pushes a page-size change into the composed pager (web `onPageSizeChange` resets to page 1).
    func syncPageSize(_ size: Int) {
        paginationController.pageSize = size
        paginationController.page = model.page
    }

    /// Mirrors the controlled selection / expansion props into the model (web controlled re-render).
    func syncControlledInputs(selection: Set<DataTableRowKey>, expansion: Set<DataTableRowKey>) {
        model.update(
            selection: selection,
            expansion: expansion,
            onSelectionChange: onSelectionChange,
            onExpandedChange: onExpandedChange
        )
    }

    /// Reorders a column to the dropped target's slot (web `handleHeaderDrop` → `moveColumn(order, source,
    /// targetIndex)`) via the shared layout projector, persisting the new order through the model.
    func reorderTo(source: String, target: String) {
        guard source != target else { return }
        let descriptors = columns.map { DataTableProjector.descriptor($0.spec) }
        let base = model.layout ?? ColumnLayoutProjector.defaultLayout(descriptors)
        let order = ColumnLayoutProjector.effectiveOrder(descriptors, layout: model.layout)
        guard let targetIndex = order.firstIndex(of: target) else { return }
        let nextOrder = ColumnLayoutProjector.moveColumn(order, key: source, toIndex: targetIndex)
        model.setLayout(ColumnLayout(order: nextOrder, hidden: base.hidden))
    }

    /// Builds the CSV from the visible columns (or the `exportAll` row set) and presents the system exporter
    /// (web `handleExportCsv` → `downloadCSV`). The in-flight flag is cleared in the `fileExporter` completion.
    func performExport() {
        guard !model.exporting else { return }
        model.beginExport()
        if let exportAll {
            Task { await presentExport(rows: exportAll()) }
        } else {
            presentExport(rows: data)
        }
    }

    /// Encodes the rows to CSV and triggers the exporter sheet.
    func presentExport(rows: [Row]) {
        let cols = effectiveColumns
        let headers = cols.map(\.spec.displayLabel)
        let body = rows.map { row in cols.map { $0.csvValue?(row) ?? "" } }
        exportDocument = DataTableCSVDocument(text: DataTableCSV.encode(headers: headers, rows: body))
        isExportPresented = true
    }
}
