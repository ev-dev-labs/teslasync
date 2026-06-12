//
//  WidgetStatGrid.Adapter.swift
//  TeslaSync — P4 widget primitive · 0010 · WidgetStatGrid (Apple)
//
//  The Foundation-only core for the stat grid — the SwiftUI parity of
//  `features/dashboard/widgets/shared/WidgetStatGrid.tsx`. This file owns the surface identity (the
//  diagnostics slug), the cell value type (``StatGridItem``, the native peer of the web `StatGridItem`),
//  its trend / tone sub-types, the props (``WidgetStatGridInput``), the view-ready cell
//  (``StatGridCellModel``), the resolved grid (``StatGridLayout``), the ``WidgetStatGridProjection``, and
//  the pure ``WidgetStatGridProjector`` that ports the web render decision (the `autoCols` column count,
//  the `compact ? 1` collapse, the `stats.length === 0` empty branch). No SwiftUI and no `@Observable`, so
//  every rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<WidgetStatGrid>` is a PURE presentational primitive — a shared widget
//  building block. It takes its data as plain props (`stats`, `compact`, `cols`) and renders a grid of
//  `StatCard`s, with no fetch, no React-Query cache, and no Promise, so it has NO loading, error, stale, or
//  offline branch (there is nothing to fetch, fail, age, or lose connectivity to — the host widget that
//  owns the query renders those). Inventing such chrome would fabricate states the source does not have, so
//  this surface reproduces only the source's REAL branches — exactly as the sibling presentational
//  primitives Delta (0081), MetricCard (0095), and WidgetComparisonCard (0003) did. The real branches: the
//  populated grid (one ``StatGridCellModel`` per stat, laid out in the resolved column count) and the empty
//  leaf (the web `stats.length === 0` → "No stats available").
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum WidgetStatGridSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "WidgetStatGrid"
}

// MARK: - StatTrendDirection (web `trend: 'up' | 'down' | 'flat'`)

/// The direction of a stat's trend — the native peer of the web `'up' | 'down' | 'flat'`. Drives both the
/// arrow glyph and the tone (web: `up` is the only "positive" direction — `positive: trend === 'up'`).
public enum StatTrendDirection: Sendable, Equatable {
    case up
    case down
    case flat

    /// Whether a rise is favorable — the web `positive: trend === 'up'`. `up` is green, `down` is red, and
    /// `flat` is muted (the web `trend.positive ? green : flat ? muted : red`).
    public var isPositive: Bool {
        self == .up
    }
}

// MARK: - StatTrend (web `{ direction, value: trendValue }`)

/// A stat's trend chip — the native peer of the web StatCard `trend` object. The web only renders the chip
/// when BOTH `trend` and `trendValue` are present (`stat.trend && stat.trendValue`), so this value type
/// pairs the two: a present ``StatTrend`` is the web "both present" case, `nil` is the "render nothing" case.
public struct StatTrend: Sendable, Equatable {
    /// The trend direction (web `direction`) — selects the arrow + tone.
    public let direction: StatTrendDirection
    /// The already-formatted trend magnitude shown next to the arrow (web `value: trendValue`).
    public let value: String

    public init(direction: StatTrendDirection, value: String) {
        self.direction = direction
        self.value = value
    }
}

// MARK: - StatValueTone (web `valueColor?: string`)

/// The semantic color of a stat's value — the native, theme-aware projection of the web
/// `valueColor?: string` className passthrough. The web forwards an arbitrary Tailwind class to the card;
/// porting raw classes is forbidden (no Tailwind ports), so — exactly as ``MetricCardColor`` (0095) maps
/// the web `neonColorMap[color]` to design tokens — this enum maps the value's intent to a P1/S9 token so
/// it recolors across light / dark / high-contrast. `nil`-equivalent default is ``primary``.
public enum StatValueTone: Sendable, Equatable {
    case primary
    case secondary
    case muted
    case success
    case danger
    case warning
    case accent
}

// MARK: - StatGridItem (web `StatGridItem`)

/// One stat cell's data — the native peer of the web `StatGridItem` interface. `value` is the
/// already-formatted display string (the web `value: string | number`, formatted by the caller at the
/// display boundary per the SI-cutover unit rules); `unit` is the optional trailing affix (web `unit?`);
/// `iconSystemName` is the optional SF Symbol (the native peer of the web `icon?: ReactNode`); `trend` is
/// the optional trend chip (web `trend` + `trendValue`); `valueTone` is the value's semantic color (web
/// `valueColor?`, defaulting to ``StatValueTone/primary``).
public struct StatGridItem: Sendable, Equatable {
    /// The cell label (web `label`) — caller-supplied + already localized, rendered verbatim.
    public let label: String
    /// The already-formatted headline value (web `value`).
    public let value: String
    /// The optional trailing unit affix (web `unit?`); `nil` / empty renders no affix.
    public let unit: String?
    /// The optional SF Symbol name (web `icon?`); `nil` renders no icon.
    public let iconSystemName: String?
    /// The optional trend chip (web `trend` + `trendValue`); `nil` renders no chip.
    public let trend: StatTrend?
    /// The value's semantic color (web `valueColor?`), defaulting to ``StatValueTone/primary``.
    public let valueTone: StatValueTone

    public init(
        label: String,
        value: String,
        unit: String? = nil,
        iconSystemName: String? = nil,
        trend: StatTrend? = nil,
        valueTone: StatValueTone = .primary
    ) {
        self.label = label
        self.value = value
        self.unit = unit
        self.iconSystemName = iconSystemName
        self.trend = trend
        self.valueTone = valueTone
    }
}

// MARK: - StatGridColumns (web `cols?: 2 | 3 | 4`)

/// The explicit column override — the native peer of the web `cols?: 2 | 3 | 4`. `nil` (omitted) defers to
/// ``WidgetStatGridProjector/autoCols(_:)``, exactly like the web `cols ?? autoCols(stats.length)`.
public enum StatGridColumns: Int, Sendable, Equatable {
    case two = 2
    case three = 3
    case four = 4
}

// MARK: - WidgetStatGridInput (web props)

/// The component's props — the native peer of `WidgetStatGridProps`. A value type so the view, the
/// state-holder, and the pure projection agree on one shape, and so a SwiftUI `.onChange` can detect a prop
/// change cheaply when a reused grid rebinds.
public struct WidgetStatGridInput: Sendable, Equatable {
    /// The stats to render (web `stats`). An empty array resolves to the empty branch.
    public let stats: [StatGridItem]
    /// Whether to render the condensed single-column variant (web `compact`).
    public let compact: Bool
    /// The optional explicit column count (web `cols?`); `nil` auto-resolves from the stat count.
    public let cols: StatGridColumns?

    public init(stats: [StatGridItem], compact: Bool = false, cols: StatGridColumns? = nil) {
        self.stats = stats
        self.compact = compact
        self.cols = cols
    }
}

// MARK: - StatGridCellModel (view-ready)

/// A resolved, view-ready cell — the stat plus its stable positional identity for the SwiftUI `ForEach`
/// (more robust than the web `key={stat.label}`, which assumes unique labels). A pure passthrough of the
/// ``StatGridItem`` (no derivation in the view).
public struct StatGridCellModel: Sendable, Equatable, Identifiable {
    /// Stable positional identity for `ForEach` (the stat's index in the list).
    public let id: Int
    /// The cell's data (web stat), rendered by the SwiftUI cell.
    public let item: StatGridItem

    public init(id: Int, item: StatGridItem) {
        self.id = id
        self.item = item
    }
}

// MARK: - StatGridLayout (resolved grid)

/// The resolved grid — the view-ready peer of the web `<div className={grid + containerColsClass[cols]}>`:
/// the target column count (web `resolvedCols`), whether the condensed gap applies (web
/// `compact ? gap-2 : gap-3`), and the ordered cells. The view reads `columns` for the `LazyVGrid` track
/// count and `isCompact` for the inter-item spacing, so no layout math lives in the view.
public struct StatGridLayout: Sendable, Equatable {
    /// The target column count (web `resolvedCols`) — 1 when compact, else the explicit / auto count.
    public let columns: Int
    /// Whether the condensed inter-item gap applies (web `compact ? gap-2 : gap-3`).
    public let isCompact: Bool
    /// The ordered, view-ready cells (web `stats.map(...)`).
    public let cells: [StatGridCellModel]

    public init(columns: Int, isCompact: Bool, cells: [StatGridCellModel]) {
        self.columns = columns
        self.isCompact = isCompact
        self.cells = cells
    }
}

// MARK: - WidgetStatGridProjection (web render output)

/// The resolved render decision — the two real branches of the web source: the populated grid (one
/// ``StatGridCellModel`` per stat) or the empty leaf (web `stats.length === 0`).
public enum WidgetStatGridProjection: Sendable, Equatable {
    /// No stats — the web `<EmptyState message="No stats available" />` branch.
    case empty
    /// One or more cells — the web `<div className="grid …">stats.map(…)</div>`.
    case populated(StatGridLayout)
}

// MARK: - WidgetStatGridProjector (web render body)

/// The pure projection from the props to the view-ready model — the surface's data adapter in the
/// "state → projection" sense the acceptance calls for: it takes the props a host already holds (no fetch,
/// no clock) and derives the rendered grid. Unit tested across the `autoCols` table, the `compact`
/// collapse, the explicit-`cols` override, the cell mapping, and the empty branch.
public enum WidgetStatGridProjector {
    /// The column count when `compact` — the web `compact ? 1`.
    public static let compactColumns = 1

    /// The auto column count — the verbatim port of the web `autoCols(count)`:
    /// `count % 3 === 0 → 3`, else `count % 4 === 0 → 4`, else `2`.
    public static func autoCols(_ count: Int) -> Int {
        if count % 3 == 0 { return 3 }
        if count % 4 == 0 { return 4 }
        return 2
    }

    /// Resolves the target column count — the verbatim port of
    /// `compact ? 1 : (cols ?? autoCols(stats.length))`.
    public static func resolveColumns(_ input: WidgetStatGridInput) -> Int {
        if input.compact { return compactColumns }
        return input.cols?.rawValue ?? autoCols(input.stats.count)
    }

    /// Builds the view-ready cells from the props — the web `stats.map((stat) => <StatCard … />)`.
    public static func cells(_ input: WidgetStatGridInput) -> [StatGridCellModel] {
        input.stats.enumerated().map { index, item in
            StatGridCellModel(id: index, item: item)
        }
    }

    /// Resolves the whole render decision from the props — the native peer of the web component's render.
    /// Empty stats short-circuit to the empty leaf BEFORE the column math, exactly like the web guard.
    public static func resolve(_ input: WidgetStatGridInput) -> WidgetStatGridProjection {
        guard !input.stats.isEmpty else { return .empty }
        let layout = StatGridLayout(
            columns: resolveColumns(input),
            isCompact: input.compact,
            cells: cells(input)
        )
        return .populated(layout)
    }
}
