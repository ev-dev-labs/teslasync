//
//  WidgetStatusGrid.Adapter.swift
//  TeslaSync — P4 widget primitive · 0011 · WidgetStatusGrid (Apple)
//
//  The Foundation-only core for the status grid — the SwiftUI parity of
//  `features/dashboard/widgets/shared/WidgetStatusGrid.tsx`. This file owns the surface identity (the
//  diagnostics slug), the status enum (``StatusCellKind``, the native peer of the web
//  `'ok' | 'warning' | 'error' | 'inactive' | 'unknown'` union), the cell value type (``StatusCell``),
//  the column target (``StatusGridColumns``, the web `2 | 3 | 4`), the props (``WidgetStatusGridInput``),
//  the view-ready cell (``StatusGridCell``), the resolved ``WidgetStatusGridProjection``, the pure
//  ``WidgetStatusGridProjector`` that ports the web render decision (the `compact ? 2 : cols` target, the
//  `!compact && cell.value` value gating, the `cells.length === 0` empty branch), and the pure
//  ``WidgetStatusGridLayout`` that ports the container-query column collapse. No SwiftUI and no
//  `@Observable`, so every rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<WidgetStatusGrid>` is a PURE presentational primitive — a shared widget
//  building block. It takes its data as plain props (`cells`, `cols`, `compact`, `emptyMessage`,
//  `emptyIcon`) and renders a grid of status chips, with no fetch, no React-Query cache, and no Promise, so
//  it has NO loading, error, stale, or offline branch (there is nothing to fetch, fail, age, or lose
//  connectivity to — the host widget that owns the query renders those). Inventing such chrome would
//  fabricate states the source does not have, so this surface reproduces only the source's REAL branches —
//  exactly as the sibling presentational primitives WidgetComparisonCard (0003), WidgetChartSummary (0002),
//  and WidgetStatGrid did. The real branches: the populated grid (one ``StatusGridCell`` per cell, the
//  responsive column collapse), the `compact` variant (two columns, value suppressed, tighter padding), and
//  the empty leaf (the web `cells.length === 0` → `<EmptyState message emptyIcon />`).
//

import CoreGraphics
import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum WidgetStatusGridSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "WidgetStatusGrid"
}

// MARK: - StatusCellKind (web `StatusCell['status']`)

/// A status cell's semantic state — the native peer of the web
/// `'ok' | 'warning' | 'error' | 'inactive' | 'unknown'` union. The raw values match the web string
/// literals verbatim so a caller can decode straight from an API string. `inactive` and `unknown` are
/// kept distinct (as the source does) even though they share neutral chrome, so the spoken status word
/// stays meaningful.
public enum StatusCellKind: String, Sendable, Equatable, CaseIterable {
    case ok
    case warning
    case error
    case inactive
    case unknown

    /// Whether the status carries a semantic tone (success / warning / danger). `inactive` / `unknown`
    /// are neutral — the web `bg-white/[0.03]` chrome with no colored accent.
    public var isSemantic: Bool {
        switch self {
        case .ok, .warning, .error: true
        case .inactive, .unknown: false
        }
    }
}

// MARK: - StatusCell (web `StatusCell`)

/// One status cell's data — the native peer of the web `StatusCell` interface. `id` is the stable
/// identity (web `id`, used as the `key`); `label` is the caller-supplied, already-localized caption
/// (web `label`); `status` is the semantic state (web `status`); `value` is the optional detail line shown
/// outside compact mode (web `value?`); `systemImage` is the optional leading SF Symbol — the native peer
/// of the web `icon?: ReactNode` (a web glyph maps to a platform symbol name, not a ported SVG).
public struct StatusCell: Sendable, Equatable, Identifiable {
    /// Stable identity (web `id`) — used as the `ForEach` id, mirroring the web `key={cell.id}`.
    public let id: String
    /// The cell caption (web `label`) — caller-supplied + already localized, rendered verbatim.
    public let label: String
    /// The semantic state (web `status`) — drives the chip tone and the status dot.
    public let status: StatusCellKind
    /// The optional detail line (web `value?`); shown only outside compact mode.
    public let value: String?
    /// The optional leading SF Symbol — the native peer of the web `icon?` glyph.
    public let systemImage: String?

    public init(
        id: String,
        label: String,
        status: StatusCellKind,
        value: String? = nil,
        systemImage: String? = nil
    ) {
        self.id = id
        self.label = label
        self.status = status
        self.value = value
        self.systemImage = systemImage
    }
}

// MARK: - StatusGridColumns (web `cols?: 2 | 3 | 4`)

/// The target column count — the native peer of the web `cols?: 2 | 3 | 4`. A closed enum (not a bare
/// `Int`) so an out-of-range count is unrepresentable, matching the web literal union. The raw value is
/// the column count, so the layout math reads `target.rawValue` directly.
public enum StatusGridColumns: Int, Sendable, Equatable, CaseIterable {
    case two = 2
    case three = 3
    case four = 4
}

// MARK: - WidgetStatusGridInput (web props)

/// The component's props — the native peer of `WidgetStatusGridProps`. A value type so the view, the
/// state-holder, and the pure projection agree on one shape, and so a SwiftUI `.onChange` can detect a
/// prop change cheaply when a reused grid rebinds. `emptyMessage` is an optional override of the web
/// default (`'No status data available'`, resolved through the P1/S10 facade when `nil`); `emptySystemImage`
/// is the empty-leaf glyph — the native peer of the web `emptyIcon?`.
public struct WidgetStatusGridInput: Sendable, Equatable {
    /// Default empty-leaf SF Symbol — a grid of status dots, the native peer of the web `emptyIcon?`.
    public static let defaultEmptySystemImage = "circle.grid.2x2"

    /// The status cells to render (web `cells`). An empty array resolves to the empty branch.
    public let cells: [StatusCell]
    /// The target column count (web `cols`, default 2). Collapses responsively per the layout.
    public let columns: StatusGridColumns
    /// Whether to render the condensed variant — two columns, no value line, tighter padding (web `compact`).
    public let compact: Bool
    /// Optional override of the empty-leaf headline (web `emptyMessage`); `nil` uses the facade default.
    public let emptyMessage: String?
    /// The empty-leaf SF Symbol (web `emptyIcon?`); defaults to ``defaultEmptySystemImage``.
    public let emptySystemImage: String

    public init(
        cells: [StatusCell],
        columns: StatusGridColumns = .two,
        compact: Bool = false,
        emptyMessage: String? = nil,
        emptySystemImage: String = WidgetStatusGridInput.defaultEmptySystemImage
    ) {
        self.cells = cells
        self.columns = columns
        self.compact = compact
        self.emptyMessage = emptyMessage
        self.emptySystemImage = emptySystemImage
    }
}

// MARK: - StatusGridCell (view-ready)

/// A resolved, view-ready cell — everything the SwiftUI chip needs as a pure function of a ``StatusCell``
/// plus the `compact` flag (no derivation in the view). `value` is already gated by `compact` (web
/// `!compact && cell.value`): it is `nil` in compact mode regardless of the source value. `id` carries the
/// source identity for the SwiftUI `ForEach`.
public struct StatusGridCell: Sendable, Equatable, Identifiable {
    /// Stable identity (web `cell.id`).
    public let id: String
    /// The cell caption (web `label`).
    public let label: String
    /// The semantic state (web `status`).
    public let status: StatusCellKind
    /// The detail line, already gated by `compact` (web `!compact && cell.value`) — `nil` when hidden.
    public let value: String?
    /// The optional leading SF Symbol (web `icon?`).
    public let systemImage: String?

    public init(
        id: String,
        label: String,
        status: StatusCellKind,
        value: String?,
        systemImage: String?
    ) {
        self.id = id
        self.label = label
        self.status = status
        self.value = value
        self.systemImage = systemImage
    }
}

// MARK: - WidgetStatusGridProjection (web render output)

/// The resolved render decision — the two real branches of the web source: the populated grid (one
/// ``StatusGridCell`` per cell, plus the resolved target column count) or the empty leaf (web
/// `cells.length === 0`). The empty-leaf copy is resolved at the view boundary (it may be a caller
/// override), so it is not carried here — matching the sibling primitives.
public enum WidgetStatusGridProjection: Sendable, Equatable {
    /// No cells — the web `<EmptyState />` branch.
    case empty
    /// One or more cells — the web grid, carrying the cells and the resolved target column count.
    case populated(cells: [StatusGridCell], columns: StatusGridColumns)
}

// MARK: - WidgetStatusGridProjector (web render body)

/// The pure projection from the props to the view-ready model — the surface's data adapter in the
/// "state → projection" sense the acceptance calls for: it takes the props a host already holds (no fetch,
/// no clock, no measured width) and derives the rendered cells + the target column count. Unit tested
/// across the `compact` column collapse, the value gating, the cell mapping, and the empty branch.
public enum WidgetStatusGridProjector {
    /// The resolved target column count — the verbatim port of `resolvedCols = compact ? 2 : cols`.
    public static func resolvedColumns(_ input: WidgetStatusGridInput) -> StatusGridColumns {
        input.compact ? .two : input.columns
    }

    /// Builds the view-ready cells — the web `cells.map(...)`, with the value gated by `compact`
    /// (web `!compact && cell.value`).
    public static func cells(_ input: WidgetStatusGridInput) -> [StatusGridCell] {
        input.cells.map { cell in
            StatusGridCell(
                id: cell.id,
                label: cell.label,
                status: cell.status,
                value: input.compact ? nil : cell.value,
                systemImage: cell.systemImage
            )
        }
    }

    /// Resolves the whole render decision from the props — the native peer of the web component's render
    /// (`cells.length === 0 ? <EmptyState/> : <div className="grid">…`).
    public static func resolve(_ input: WidgetStatusGridInput) -> WidgetStatusGridProjection {
        let resolved = cells(input)
        guard !resolved.isEmpty else { return .empty }
        return .populated(cells: resolved, columns: resolvedColumns(input))
    }
}

// MARK: - WidgetStatusGridLayout (web container-query column collapse)

/// The pure layout decision — the native peer of the web container-query class table that collapses the
/// grid based on the *widget's own rendered width* (web `@container` on the widget content area), not the
/// viewport. A 3- or 4-up grid relaxes on a narrow widget — whether narrow because the user is on a phone
/// or because the widget only spans one column on a wide desktop. Kept Foundation-pure so the breakpoints
/// are unit-tested without SwiftUI; the view supplies the measured width.
public enum WidgetStatusGridLayout {
    /// Web `@xs` container breakpoint (≈ 16rem) — below it a 3-up grid shows a single column.
    public static let xsBreakpoint: CGFloat = 256
    /// Web `@sm` container breakpoint (≈ 24rem) — at/above it a 3-up grid reaches three columns and a
    /// 4-up grid reaches four.
    public static let smBreakpoint: CGFloat = 384

    /// The rendered column count for a target and a measured width — the verbatim port of the web class
    /// table:
    ///   • 2 → `grid-cols-2` (always two);
    ///   • 3 → `grid-cols-1 @xs:grid-cols-2 @sm:grid-cols-3`;
    ///   • 4 → `grid-cols-2 @sm:grid-cols-4`.
    /// A not-yet-measured width (`0`) yields the web base (narrowest) class — 1 for a 3-up, 2 otherwise —
    /// so the first paint matches the web SSR baseline before the reflow.
    public static func columnCount(target: StatusGridColumns, availableWidth: CGFloat) -> Int {
        switch target {
        case .two:
            2
        case .three:
            if availableWidth >= smBreakpoint {
                3
            } else if availableWidth >= xsBreakpoint {
                2
            } else {
                1
            }
        case .four:
            availableWidth >= smBreakpoint ? 4 : 2
        }
    }
}
