//
//  DataTable.Types.swift
//  TeslaSync — P4 shared surface · 0208 · DataTable (Apple)
//
//  The SwiftUI-facing public value types for the data table that cannot live in the Foundation-only adapter
//  because they carry a `@ViewBuilder` cell body or map to SwiftUI layout types: the generic
//  ``DataTableColumn`` (the native peer of the web `Column<T>`, with its per-row `render` closure erased to
//  `AnyView`), the ``DataTablePagination`` config (web `PaginationConfig`), the ``DataTableMenuAction`` row
//  context-menu item (web `rowContextMenu`'s `ContextMenuItem`), the ``DataTableMetrics`` layout tokens (P1/S9
//  peers of the web Tailwind metrics), and the SwiftUI alignment projection of ``DataTableColumnAlignment``.
//

import SwiftUI

// MARK: - DataTableColumn (web `Column<T>`)

/// One table column — the native peer of the web `Column<T>`. `cell` is the per-row renderer (web `render`),
/// erased to `AnyView` at the call site so heterogeneous columns live in one array; `csvValue` is the optional
/// plain-text export accessor (the native peer of the web `exportRow` per-column flattening — Swift has no
/// generic shallow key lookup, so a column opts into CSV by supplying it). The display knobs mirror the web
/// column options 1:1 and project to the closure-free ``DataTableColumnSpec`` (via ``spec``) the pure rules use.
public struct DataTableColumn<Row>: Identifiable {
    /// Stable identity + layout key (web `key`).
    public let key: String
    /// The header label (web `header`).
    public let header: String
    /// Whether the header is a sort toggle (web `sortable`).
    public let sortable: Bool
    /// Horizontal alignment (web `align`, default leading).
    public let alignment: DataTableColumnAlignment
    /// Whether the column starts visible (web `defaultVisible`, default `true`).
    public let defaultVisible: Bool
    /// Whether the column shows on narrow widths when a mobile allow-list is derived (web `visibleOnMobile`).
    public let visibleOnMobile: Bool
    /// The initial width in points, or `nil` for the default column width (web `defaultWidth`).
    public let defaultWidth: Double?
    /// The minimum resize width (web `minWidth`, default 60).
    public let minWidth: Double
    /// The maximum resize width (web `maxWidth`, default 800).
    public let maxWidth: Double

    let cell: (Row) -> AnyView
    /// The optional plain-text CSV accessor (web `exportRow`); set via ``exportingText(_:)``.
    var csvValue: ((Row) -> String)?

    public var id: String {
        key
    }

    /// The closure-free description the pure ordering / CSV-header / projection rules + tests consume.
    public var spec: DataTableColumnSpec {
        DataTableColumnSpec(
            key: key,
            header: header,
            sortable: sortable,
            alignment: alignment,
            defaultVisible: defaultVisible,
            visibleOnMobile: visibleOnMobile,
            defaultWidth: defaultWidth,
            minWidth: minWidth,
            maxWidth: maxWidth
        )
    }

    public init(
        key: String,
        header: String,
        sortable: Bool = false,
        alignment: DataTableColumnAlignment = .leading,
        defaultVisible: Bool = true,
        visibleOnMobile: Bool = false,
        defaultWidth: Double? = nil,
        minWidth: Double = 60,
        maxWidth: Double = 800,
        @ViewBuilder cell: @escaping (Row) -> some View
    ) {
        self.key = key
        self.header = header
        self.sortable = sortable
        self.alignment = alignment
        self.defaultVisible = defaultVisible
        self.visibleOnMobile = visibleOnMobile
        self.defaultWidth = defaultWidth
        self.minWidth = minWidth
        self.maxWidth = maxWidth
        csvValue = nil
        self.cell = { AnyView(cell($0)) }
    }

    /// Returns a copy of the column with a CSV export accessor — the native peer of the web `exportRow` per
    /// column. Chained after the cell so the column declaration stays a single trailing closure:
    /// `DataTableColumn(key:header:) { cell }.exportingText { row in row.name }`.
    public func exportingText(_ value: @escaping (Row) -> String) -> DataTableColumn<Row> {
        var copy = self
        copy.csvValue = value
        return copy
    }
}

// MARK: - DataTablePagination (web `PaginationConfig`)

/// The pagination configuration — the native peer of the web `PaginationConfig` (and the `pagination={true}`
/// shorthand, which maps to ``standard``). `defaultPageSize` seeds the page size (web default 25);
/// `pageSizeOptions` are the rows-per-page choices (web default `[20, 50, 100]`).
public struct DataTablePagination: Sendable, Equatable {
    public let defaultPageSize: Int
    public let pageSizeOptions: [Int]

    public init(defaultPageSize: Int = 25, pageSizeOptions: [Int] = [20, 50, 100]) {
        self.defaultPageSize = defaultPageSize
        self.pageSizeOptions = pageSizeOptions
    }

    /// The `pagination={true}` shorthand — default page size + default options.
    public static let standard = DataTablePagination()
}

// MARK: - DataTableMenuAction (web `rowContextMenu` item)

/// One row context-menu action — the native peer of the web `ContextMenuItem` a `rowContextMenu(row)` builder
/// returns. Rendered as a SwiftUI `Button` inside the row's `.contextMenu` (the HIG-idiomatic peer of the web
/// shared right-click popup). A destructive action gets the system destructive role.
public struct DataTableMenuAction: Identifiable {
    public let id = UUID()
    public let title: String
    public let systemImage: String?
    public let isDestructive: Bool
    public let action: @MainActor () -> Void

    public init(
        title: String,
        systemImage: String? = nil,
        isDestructive: Bool = false,
        action: @escaping @MainActor () -> Void
    ) {
        self.title = title
        self.systemImage = systemImage
        self.isDestructive = isDestructive
        self.action = action
    }
}

// MARK: - DataTableMetrics (P1/S9 layout tokens)

/// The table's precise layout metrics — the native peers of the web Tailwind values on `DataTable.tsx`. Kept
/// as named constants so the surface-specific numbers are documented rather than scattered magic literals,
/// mirroring the sibling surfaces' `…Layout` / `…Style` enums.
public enum DataTableMetrics {
    /// The leading control (selection / expand) column width — a comfortable HIG tap target.
    public static let controlColumnWidth: CGFloat = 44
    /// The fallback data-column width when neither a stored nor a default width is set (web auto-sizing peer).
    public static let defaultColumnWidth: CGFloat = 140
    /// Vertical spacing between the toolbar, the table, and the pager (web `space-y-2`).
    public static let sectionSpacing: CGFloat = 8
    /// The sort-direction chevron side (web `h-3 w-3`).
    public static let sortChevronSide: CGFloat = 12
    /// The expand chevron side (web `h-3.5 w-3.5`).
    public static let expandChevronSide: CGFloat = 14
    /// The reorder grip side (web `h-3 w-3`).
    public static let gripSide: CGFloat = 12
    /// The selection checkbox glyph side (web `<input type=checkbox>`).
    public static let checkboxSide: CGFloat = 18
    /// The hairline row / header separator width.
    public static let separatorWidth: CGFloat = 1
    /// The default capped scroll height when virtualization needs a bounded viewport (web `maxHeight ?? 600`).
    public static let virtualizedMaxHeight: CGFloat = 600
}

// MARK: - DataTableColumnAlignment ⇒ SwiftUI

extension DataTableColumnAlignment {
    /// The frame alignment for a cell's content (web `text-left` / `text-center` / `text-right`).
    var frameAlignment: Alignment {
        switch self {
        case .leading: .leading
        case .center: .center
        case .trailing: .trailing
        }
    }

    /// The multiline text alignment for a cell.
    var textAlignment: TextAlignment {
        switch self {
        case .leading: .leading
        case .center: .center
        case .trailing: .trailing
        }
    }
}
