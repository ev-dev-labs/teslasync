//
//  DataTable.Adapter.swift
//  TeslaSync — P4 shared surface · 0208 · DataTable (Apple)
//
//  The Foundation-only core for the sortable data table — the SwiftUI parity of
//  `components/ui/DataTable.tsx`. This file owns the surface identity (the diagnostics slug), the i18n facade
//  seam, the public generic column model (``DataTableColumn``) plus its closure-free ``DataTableColumnSpec``
//  twin (so the ordering / CSV / projection rules stay unit-testable without SwiftUI), and the small value
//  enums the web encodes as string-union props: the selection mode (web `selectable`), the sort direction
//  (web `sortDir`), the column alignment (web `align`), and the information density (web `density` / the
//  legacy `compact`). The CSV serializer and the i18next interpolation live in the sibling
//  `DataTable.CSV.swift`; the order / slice / selection / content-state rules live in `DataTable.Projector.swift`.
//  No SwiftUI and no `@Observable`, so every value type and rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<DataTable>` is a PROP-DRIVEN presentational component. Its data arrives as
//  the plain `data: T[]` prop — there is no fetch, no React-Query cache, no Promise — so it has NO loading,
//  stale, or offline branch (there is nothing to fetch, age, or disconnect from; the hosting page owns those
//  states and feeds `data` down). The REAL render branches it DOES have, all reproduced here + previewed +
//  tested, are: the populated body (standard + lazily-windowed rows, the native peer of the web
//  `useVirtualizer`), the EMPTY body (`data.length === 0` → the `emptyMessage` row), and the ERROR fallback
//  (the `<SectionErrorBoundary>` "This table failed to render" row, reached on a row-render integrity failure
//  — reproduced as a real, detectable duplicate-key guard plus a host-triggerable failure, with a retry).
//  Inventing loading / stale / offline chrome would fabricate states the source lacks, so this surface
//  reproduces only the source's REAL branches — the same disposition the sibling presentational primitives
//  DataTableBulkBar (0209), DataTableResizer (0212), and Pagination (0221) used.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum DataTableSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "DataTable"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a plain
/// closure so the pure core has no dependency on a bundle: the production app passes the P1/S10 facade, while
/// tests pass an identity-fallback resolver.
public typealias DataTableResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Row key (web `RowKey = string | number`)

/// A row's stable identity — the native peer of the web `RowKey` (`string | number`). Modelled as `String`
/// so selection / expansion sets get clean value semantics; numeric ids are stringified by the caller's
/// `keyExtractor`, exactly as the web `Set<RowKey>` coerces them for membership.
public typealias DataTableRowKey = String

// MARK: - Selection mode (web `selectable`)

/// How rows may be selected — the native peer of the web `selectable: 'single' | 'multi' | 'none'`. `single`
/// is a radio-style one-at-a-time pick; `multi` adds the select-all header control and shift-click range
/// extension; `none` hides every selection affordance (web the `selectable === 'none'` default).
public enum DataTableSelectionMode: Sendable, Equatable {
    case none
    case single
    case multi

    /// Whether any selection affordance renders (web `isSelectable = selectable !== 'none'`).
    public var isSelectable: Bool {
        self != .none
    }

    /// Whether the multi-select header (select-all + indeterminate) and shift-range apply (web
    /// `selectable === 'multi'`).
    public var isMulti: Bool {
        self == .multi
    }
}

// MARK: - Sort direction (web `sortDir`)

/// A sortable column's active direction — the native peer of the web `sortDir: 'asc' | 'desc'`. Drives the
/// header chevron (web `ChevronUp` / `ChevronDown`) and the VoiceOver sort trait (web `aria-sort`).
public enum DataTableSortDirection: String, Sendable, Equatable {
    case ascending = "asc"
    case descending = "desc"

    /// The flipped direction — the web `useSortToggle` `d === 'asc' ? 'desc' : 'asc'` when re-clicking the
    /// active column.
    public var toggled: DataTableSortDirection {
        self == .ascending ? .descending : .ascending
    }
}

// MARK: - Column alignment (web `align`)

/// A column's horizontal alignment — the native peer of the web `align: 'left' | 'center' | 'right'`
/// (defaulting to leading). Mapped to SwiftUI `Alignment` / `TextAlignment` in the view layer so this enum
/// stays Foundation-only and testable.
public enum DataTableColumnAlignment: String, Sendable, Equatable {
    case leading = "left"
    case center
    case trailing = "right"
}

// MARK: - Density (web `density` / legacy `compact`)

/// The table's information density — the native peer of the web `density: 'compact' | 'comfortable' |
/// 'spacious' | 'auto'` (and the legacy `compact` boolean, which maps to `.compact`). `.auto` follows the
/// app's global density preference on the web via CSS vars; natively it resolves to `.comfortable` (the
/// default row metrics) and lets Dynamic Type scale the rows, so a caller who wants a fixed look passes an
/// explicit value. The metrics below are the native peers of the web fixed paddings (32 / 44 / 56 pt rows).
public enum DataTableDensity: String, Sendable, Equatable {
    case compact
    case comfortable
    case spacious
    case auto

    /// `.auto` resolved to the concrete native default — the peer of the web `density ?? (compact ?
    /// 'compact' : 'auto')` falling through to the global preference, which natively defaults to comfortable.
    public var resolved: DataTableDensity {
        self == .auto ? .comfortable : self
    }

    /// Horizontal cell inset in points (web `px-3` / `px-d-pad-x` / `px-5`).
    public var cellPaddingH: Double {
        switch resolved {
        case .compact: 12
        case .spacious: 20
        default: 16
        }
    }

    /// Vertical cell inset in points (web `py-2` / `py-d-pad-y` / `py-4`).
    public var cellPaddingV: Double {
        switch resolved {
        case .compact: 8
        case .spacious: 16
        default: 12
        }
    }

    /// The estimated / minimum row height in points — the native peer of the web density row-height estimate
    /// (32 compact / 44 comfortable / 56 spacious) the virtualizer seeds.
    public var rowHeight: Double {
        switch resolved {
        case .compact: 32
        case .spacious: 56
        default: 44
        }
    }
}

// MARK: - DataTableColumnSpec (closure-free column twin)

/// The closure-free projection of a ``DataTableColumn`` — a `Sendable`/`Equatable` value type so the column
/// order/visibility rules (``DataTableProjector``), the CSV header derivation, and the unit tests all agree
/// on one shape without dragging a render closure (or a generic `Row`) through the pure core.
public struct DataTableColumnSpec: Sendable, Equatable, Identifiable {
    public let key: String
    public let header: String
    public let sortable: Bool
    public let alignment: DataTableColumnAlignment
    public let defaultVisible: Bool
    public let visibleOnMobile: Bool
    public let defaultWidth: Double?
    public let minWidth: Double
    public let maxWidth: Double

    public var id: String {
        key
    }

    /// The CSV / accessibility label — the web `col.header || col.key` (an empty header falls back to key).
    public var displayLabel: String {
        header.isEmpty ? key : header
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
        maxWidth: Double = 800
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
    }
}
