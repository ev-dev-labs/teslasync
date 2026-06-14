//
//  DataTable.Projector.swift
//  TeslaSync — P4 shared surface · 0208 · DataTable (Apple)
//
//  The Foundation-only projection rules for the data table — the surface's data adapter in the "data ->
//  projection" sense the acceptance calls for: it takes the rows, columns, layout, widths, and selection a
//  page already holds (no fetch, no clock) and reproduces the web component's pure derivations as
//  deterministic functions: the visible-column order (delegating to the shared `ColumnLayoutProjector`, the
//  native port of `lib/columnOrderStore`), the per-page slice (web `data.slice`), the resolved column width
//  (web `widthFor`), the mobile allow-list (web `effectiveMobileColumns` / `colHiddenClass`), the leading
//  control-column count (web `leadingColCount`), and the render content-state (populated / empty / error). The
//  selection arithmetic lives in the sibling ``DataTableSelectionProjector``. Every rule is unit-tested across
//  its boundaries with no SwiftUI and no `@Observable`.
//

import Foundation

// MARK: - DataTableContentState (web tbody branches)

/// Which body branch the table renders — the native peer of the web `<tbody>` conditional: the error
/// fallback (web `<SectionErrorBoundary>` "This table failed to render"), the empty row (web `data.length ===
/// 0`), or the populated rows (web the standard / virtualized map). Resolved purely so the view holds no
/// branch logic and every state is testable.
public enum DataTableContentState: Sendable, Equatable {
    /// The row-render integrity failure — the web SectionErrorBoundary fallback (reached on a host-signalled
    /// failure or a duplicate-key collision, the native peer of React's "two children with the same key").
    case failed
    /// No rows — the web `data.length === 0` empty branch (the `emptyMessage` row).
    case empty
    /// Populated — the web row map (standard + lazily-windowed).
    case rows
}

// MARK: - DataTableProjector (web pure derivations)

/// The table's pure render derivations (excluding the selection arithmetic). Delegates column ordering to the
/// shared ``ColumnLayoutProjector`` so the native port of `lib/columnOrderStore` is not duplicated.
public enum DataTableProjector {
    // MARK: Column order / visibility (web `applyColumnLayout`)

    /// Maps a column spec to the shared ``ColumnDescriptor`` the ordering projector consumes (control columns
    /// — selection / expand — are never part of `columns`, so `isRequired` is always `false` here).
    public static func descriptor(_ spec: DataTableColumnSpec) -> ColumnDescriptor {
        ColumnDescriptor(key: spec.key, header: spec.header, isRequired: false, defaultVisible: spec.defaultVisible)
    }

    /// The ordered, visible column specs for a layout — the native peer of the web `visibleColumns =
    /// applyColumnLayout(columns, layout)`: it runs the shared ordering projector over the descriptors, then
    /// maps the resulting keys back to the rich specs (preserving alignment / widths / sortability). A key the
    /// ordering drops (hidden) is excluded; an unknown key is ignored.
    public static func orderedVisibleSpecs(
        _ specs: [DataTableColumnSpec],
        layout: ColumnLayout?
    ) -> [DataTableColumnSpec] {
        let byKey = Dictionary(specs.map { ($0.key, $0) }, uniquingKeysWith: { first, _ in first })
        let ordered = ColumnLayoutProjector.applyLayout(specs.map(descriptor), layout: layout)
        return ordered.compactMap { byKey[$0.key] }
    }

    // MARK: Leading control columns (web `leadingColCount`)

    /// The number of leading control columns — the verbatim web `(isSelectable ? 1 : 0) + (expandable ? 1 :
    /// 0)`: a selection checkbox/radio column and/or an expand-chevron column precede the data columns.
    public static func leadingColumnCount(selection: DataTableSelectionMode, expandable: Bool) -> Int {
        (selection.isSelectable ? 1 : 0) + (expandable ? 1 : 0)
    }

    // MARK: Per-page slice (web `data.slice`)

    /// The 1-based page's rows — the verbatim port of the web `data.slice((page - 1) * pageSize, page *
    /// pageSize)`. Returns the whole array when pagination is disabled (`pageSize <= 0`); a page past the end
    /// yields an empty slice (the controller clamps `page` so this is defensive).
    public static func slice<Row>(_ data: [Row], page: Int, pageSize: Int, enabled: Bool) -> [Row] {
        guard enabled, pageSize > 0 else { return data }
        let start = max(0, (page - 1) * pageSize)
        guard start < data.count else { return [] }
        let end = min(data.count, start + pageSize)
        return Array(data[start ..< end])
    }

    /// Clamps a page into `1 ... pageCount` for the current totals — the native guard behind the web `setPage(1)`
    /// reset on `data.length` change (so a shrunk list never strands the view on an empty trailing page).
    public static func clampedPage(page: Int, pageSize: Int, total: Int) -> Int {
        guard pageSize > 0 else { return 1 }
        let pages = max(1, Int((Double(total) / Double(pageSize)).rounded(.up)))
        return min(max(1, page), pages)
    }

    // MARK: Resolved width (web `widthFor`)

    /// The resolved width in points for a column — the verbatim port of the web `widthFor`: the user's stored
    /// width wins, else the column's `defaultWidth`, else `nil` (content sizing).
    public static func width(for spec: DataTableColumnSpec, widths: [String: Double]) -> Double? {
        if let stored = widths[spec.key] { return stored }
        return spec.defaultWidth
    }

    // MARK: Mobile allow-list (web `effectiveMobileColumns` / `colHiddenClass`)

    /// The effective mobile-visible key set — the native peer of the web `effectiveMobileColumns`: the explicit
    /// `mobileColumns` prop wins; otherwise the set is derived from the columns' `visibleOnMobile` flags; when
    /// neither yields any key the result is `nil` (every column shows at every width — the wrapper scrolls).
    public static func mobileKeySet(_ specs: [DataTableColumnSpec], explicit: [String]?) -> Set<String>? {
        if let explicit { return Set(explicit) }
        let derived = specs.filter(\.visibleOnMobile).map(\.key)
        return derived.isEmpty ? nil : Set(derived)
    }

    /// Whether a column is hidden at narrow widths — the web `colHiddenClass`: hidden when a mobile allow-list
    /// exists and does not contain the key.
    public static func isHiddenOnMobile(key: String, mobileSet: Set<String>?) -> Bool {
        guard let mobileSet else { return false }
        return !mobileSet.contains(key)
    }

    // MARK: Content state (web tbody branches)

    /// Whether the visible page has a duplicate row key — the native integrity check behind the web
    /// SectionErrorBoundary (duplicate React keys break row rendering). A pure `Set`-count comparison.
    public static func hasDuplicateKeys(_ keys: [DataTableRowKey]) -> Bool {
        Set(keys).count != keys.count
    }

    /// Resolves the body branch — failure (host-signalled OR a duplicate-key collision) wins, then the empty
    /// branch (no rows), else the populated branch. The web checks empty INSIDE the boundary, so a render
    /// failure on a non-empty body shows the fallback; an empty body cannot fail (nothing renders).
    public static func contentState(
        rowCount: Int,
        forcedFailure: Bool,
        hasDuplicateKeys: Bool
    ) -> DataTableContentState {
        if rowCount == 0 { return forcedFailure ? .failed : .empty }
        if forcedFailure || hasDuplicateKeys { return .failed }
        return .rows
    }

    // MARK: Selected rows (web bulk-actions slot)

    /// The selected rows in source order — the verbatim port of the web `selectedRows = data.filter(row =>
    /// selectionSet.has(keyExtractor(row)))`. Empty when selection is disabled.
    public static func selectedRows<Row>(
        _ data: [Row],
        selection: Set<DataTableRowKey>,
        isSelectable: Bool,
        keyExtractor: (Row) -> DataTableRowKey
    ) -> [Row] {
        guard isSelectable else { return [] }
        return data.filter { selection.contains(keyExtractor($0)) }
    }

    /// Whether the CSV export control is disabled — the web `disabled={exporting || data.length === 0}`.
    public static func isExportDisabled(exporting: Bool, rowCount: Int) -> Bool {
        exporting || rowCount == 0
    }
}
