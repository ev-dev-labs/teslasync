//
//  LoadingSkeleton.Model.swift
//  TeslaSync — P4 feature view · LoadingSkeleton (Apple)
//
//  The pure, host-free spec for the shared charging `LoadingSkeleton` surface.
//  Two web components share this native filename, so one parameterized surface
//  reproduces BOTH, each as a deterministic ``LoadingSkeletonLayout`` projection:
//
//    • `features/charging/components/charging-curve/LoadingSkeleton.tsx`  → `.chargingCurve` (P4·0088)
//    • `features/charging/components/cost-analysis/LoadingSkeleton.tsx`   → `.costAnalysis`  (P4·0115)
//
//  Both web sources are pure presentational skeletons with no data hooks and no
//  t() calls, so the "adapter" here is the static projection of each source's
//  region tree (header / grids / charts / table), which the XCTest suite asserts
//  block-for-block without a rendering host. This file also holds the diagnostics
//  identity (P1/S11 `view.opened`), the responsive-column policy (web
//  base/lg/xl breakpoints → native size class), and the P1/S10 i18n facade.
//
//  Spacing convention (matches the predecessor): block `mt-{n}` margins are
//  carried as exact web points on ``SkeletonBlock/topInset`` (Tailwind 1 unit =
//  4 pt); inter-region and grid gaps are carried as the semantic
//  ``SkeletonGridGap`` and resolved to platform spacing tokens by the view, so
//  the surface follows native rhythm rather than ported pixels.
//

import Foundation

// MARK: - Surface identity (P1/S11 view.opened)

/// Stable, non-identifying identity for the `LoadingSkeleton` feature view. The
/// slug is the value emitted with the P1/S11 `view.opened` diagnostics contract
/// and is referenced by both the view and its tests so the two never drift.
public enum LoadingSkeletonSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "LoadingSkeleton"

    /// Reports the surface becoming visible. This is the exact code path the
    /// view runs from its `.task`, factored out so it is unit-testable without a
    /// rendering host.
    public static func reportOpen(to telemetry: any LoadingSkeletonTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Skeleton block primitives (web `<Skeleton/>`)

/// The width policy of a shimmer block, mapped from the web `Skeleton` `width`
/// prop: a fixed CSS length (`"220px"` / Tailwind `w-{n}`), a percentage of the
/// container (`"60%"`), or the `Skeleton` default `"100%"` (web `w-full`).
public enum SkeletonWidth: Equatable, Sendable {
    /// A fixed width in points (web `"{n}px"` or Tailwind `w-{n}` at 1 unit = 4 pt).
    case points(CGFloat)
    /// A fraction of the container width in `0...1` (web `"{p}%"`).
    case fraction(CGFloat)
    /// Stretches to fill the container (web `w-full` / the `Skeleton` default).
    case fill
}

/// The corner treatment of a shimmer block, mapped from the web `Skeleton`
/// `rounded` prop: the default small radius, or a full pill (`rounded-full`).
public enum SkeletonShape: Equatable, Sendable {
    /// The default small corner radius (web `rounded`).
    case rounded
    /// A full pill, used for button-shaped blocks (web `rounded` prop → `rounded-full`).
    case pill
}

/// A single shimmer block — the native projection of one web `<Skeleton/>`.
/// `topInset` reproduces the web `mt-{n}` (or a `space-y-{n}` gap) that separates
/// a block from the one stacked above it, so sub-views can stack with zero
/// spacing and let the data carry the rhythm.
public struct SkeletonBlock: Equatable, Sendable {
    /// The width policy (web `width` prop).
    public let width: SkeletonWidth
    /// Fixed height in points (web `height` prop / Tailwind `h-{n}`).
    public let height: CGFloat
    /// Leading top inset in points (web `mt-{n}` / `space-y-{n}`); `0` when none.
    public let topInset: CGFloat
    /// Corner treatment (web `rounded` prop).
    public let shape: SkeletonShape

    public init(
        width: SkeletonWidth,
        height: CGFloat,
        topInset: CGFloat = 0,
        shape: SkeletonShape = .rounded
    ) {
        self.width = width
        self.height = height
        self.topInset = topInset
        self.shape = shape
    }

    /// Whether the block stretches to fill its container (web `w-full`).
    public var fillsWidth: Bool {
        width == .fill
    }
}

public extension SkeletonBlock {
    /// A fixed-width block (web `"{n}px"` / Tailwind `w-{n}`).
    static func fixed(
        _ width: CGFloat,
        height: CGFloat,
        topInset: CGFloat = 0,
        shape: SkeletonShape = .rounded
    ) -> SkeletonBlock {
        SkeletonBlock(width: .points(width), height: height, topInset: topInset, shape: shape)
    }

    /// A percentage-width block (web `"{p}%"`), `fraction` in `0...1`.
    static func fraction(
        _ fraction: CGFloat,
        height: CGFloat,
        topInset: CGFloat = 0,
        shape: SkeletonShape = .rounded
    ) -> SkeletonBlock {
        SkeletonBlock(width: .fraction(fraction), height: height, topInset: topInset, shape: shape)
    }

    /// A full-width block (web `w-full` / the `Skeleton` default).
    static func fill(
        height: CGFloat,
        topInset: CGFloat = 0,
        shape: SkeletonShape = .rounded
    ) -> SkeletonBlock {
        SkeletonBlock(width: .fill, height: height, topInset: topInset, shape: shape)
    }
}

// MARK: - Grid gap (web gap-{n} → platform spacing token, resolved by the view)

/// The gap between grid items, named after the web Tailwind `gap-{n}` so each
/// projection reads like the source. The view maps it to a platform spacing
/// token, preserving native rhythm instead of porting pixels.
public enum SkeletonGridGap: Equatable, Sendable {
    /// Web `gap-4`.
    case gap4
    /// Web `gap-6`.
    case gap6
}

// MARK: - Region specs

/// The page header — a leading title + subtitle, with an optional trailing
/// accessory block. `.chargingCurve` has no accessory (web `space-y-2`);
/// `.costAnalysis` carries a pill button on the trailing edge (web
/// `sm:flex-row sm:justify-between`).
public struct SkeletonHeader: Equatable, Sendable {
    public let title: SkeletonBlock
    public let subtitle: SkeletonBlock
    public let trailingAccessory: SkeletonBlock?

    public init(title: SkeletonBlock, subtitle: SkeletonBlock, trailingAccessory: SkeletonBlock? = nil) {
        self.title = title
        self.subtitle = subtitle
        self.trailingAccessory = trailingAccessory
    }
}

/// A stat tile — the web `GlassPanel.p-4` with an ordered stack of shimmer lines
/// (two lines on `.chargingCurve`, three on `.costAnalysis`).
public struct SkeletonStatCell: Equatable, Sendable {
    public let lines: [SkeletonBlock]

    public init(lines: [SkeletonBlock]) {
        self.lines = lines
    }
}

/// A responsive grid of stat tiles (web `grid grid-cols-* gap-*`).
public struct SkeletonStatGrid: Equatable, Sendable {
    public let cells: [SkeletonStatCell]
    public let columns: ResponsiveColumns
    public let gap: SkeletonGridGap

    public init(cells: [SkeletonStatCell], columns: ResponsiveColumns, gap: SkeletonGridGap) {
        self.cells = cells
        self.columns = columns
        self.gap = gap
    }
}

/// A titled chart slot — the web `GlassPanel` with a heading + a full-width body
/// block standing in for the eventual chart.
public struct SkeletonChartPanel: Equatable, Sendable {
    public let title: SkeletonBlock
    public let chartBody: SkeletonBlock

    public init(title: SkeletonBlock, chartBody: SkeletonBlock) {
        self.title = title
        self.chartBody = chartBody
    }
}

/// A responsive grid of titled chart panels (web `grid grid-cols-* gap-*`).
public struct SkeletonChartGrid: Equatable, Sendable {
    public let panels: [SkeletonChartPanel]
    public let columns: ResponsiveColumns
    public let gap: SkeletonGridGap

    public init(panels: [SkeletonChartPanel], columns: ResponsiveColumns, gap: SkeletonGridGap) {
        self.panels = panels
        self.columns = columns
        self.gap = gap
    }
}

/// A table slot — the web `GlassPanel.p-4` with a heading then a uniform stack of
/// full-width row blocks (web `mt-4 space-y-2` of `<Skeleton h-8/>`).
public struct SkeletonTable: Equatable, Sendable {
    public let title: SkeletonBlock
    public let rowHeight: CGFloat
    public let rowCount: Int
    public let rowSpacing: CGFloat
    public let rowsTopInset: CGFloat

    public init(title: SkeletonBlock, rowHeight: CGFloat, rowCount: Int, rowSpacing: CGFloat, rowsTopInset: CGFloat) {
        self.title = title
        self.rowHeight = rowHeight
        self.rowCount = rowCount
        self.rowSpacing = rowSpacing
        self.rowsTopInset = rowsTopInset
    }
}

/// One top-level stacked region of the skeleton (a child of the web root
/// `space-y-6`). Modelling regions as an ordered enum lets a single rendering
/// engine reproduce both web sources while the tests assert each region's spec
/// block-for-block.
public enum LoadingSkeletonRegion: Equatable, Sendable {
    case header(SkeletonHeader)
    case filterRow([SkeletonBlock])
    case statGrid(SkeletonStatGrid)
    case chartPanel(SkeletonChartPanel)
    case chartGrid(SkeletonChartGrid)
    case table(SkeletonTable)
}

public extension LoadingSkeletonRegion {
    var asHeader: SkeletonHeader? {
        if case let .header(value) = self { return value }
        return nil
    }

    var asFilterRow: [SkeletonBlock]? {
        if case let .filterRow(value) = self { return value }
        return nil
    }

    var asStatGrid: SkeletonStatGrid? {
        if case let .statGrid(value) = self { return value }
        return nil
    }

    var asChartPanel: SkeletonChartPanel? {
        if case let .chartPanel(value) = self { return value }
        return nil
    }

    var asChartGrid: SkeletonChartGrid? {
        if case let .chartGrid(value) = self { return value }
        return nil
    }

    var asTable: SkeletonTable? {
        if case let .table(value) = self { return value }
        return nil
    }
}

// MARK: - Responsive columns (web base / lg / xl → native width bucket)

/// The column count for a grid at the two native width buckets, mapped from the
/// web Tailwind breakpoints. `compact` is the web base (`grid-cols-{n}`),
/// `regular` is the web wide layout (`lg:`/`xl:`) used on iPad, Mac, and wide
/// iPhone. The view resolves the bucket from the horizontal size class.
public struct ResponsiveColumns: Equatable, Sendable {
    public let compact: Int
    public let regular: Int

    public init(compact: Int, regular: Int) {
        self.compact = compact
        self.regular = regular
    }

    /// The column count for the given width bucket, never below one.
    public func count(isRegularWidth: Bool) -> Int {
        max(isRegularWidth ? regular : compact, 1)
    }
}

// MARK: - Layout projection (the web source's structure, 1:1)

/// The deterministic projection of a web `LoadingSkeleton`'s structure: an
/// ordered list of regions reproduced block-for-block from the source, plus the
/// VoiceOver busy-state label the Apple HIG requires. Keeping the structure in a
/// value type lets the XCTest suite assert every dimension and count without a
/// rendering host.
public struct LoadingSkeletonLayout: Equatable, Sendable {
    public let regions: [LoadingSkeletonRegion]
    public let accessibilityLabelKey: String
    public let accessibilityLabelFallback: String

    public init(
        regions: [LoadingSkeletonRegion],
        accessibilityLabelKey: String,
        accessibilityLabelFallback: String
    ) {
        self.regions = regions
        self.accessibilityLabelKey = accessibilityLabelKey
        self.accessibilityLabelFallback = accessibilityLabelFallback
    }

    /// The number of top-level stacked regions (the web root `space-y-6` children).
    public var regionCount: Int {
        regions.count
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves this surface's strings by key with an English fallback so the view
/// holds no hardcoded literals. The web sources are anonymous skeletons (no
/// `t()` calls), so the only strings are the native VoiceOver labels the Apple
/// HIG busy/loading-state contract requires — one per layout. Keys live in the
/// "LoadingSkeleton" table, folded into the app `Localizable.xcstrings` catalog
/// at integration time.
public enum LoadingSkeletonLSStrings {
    public static let table = "LoadingSkeleton"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

/// The localization keys this surface resolves, kept in one place so the view,
/// the `.strings` table, and the tests never drift.
public enum LoadingSkeletonStringsKey {
    /// VoiceOver label announcing the charging-curve skeleton as one busy element.
    public static let chargingCurveAccessibilityLabel = "chargingCurve.loading.accessibilityLabel"
    /// English fallback for the charging-curve label (also shipped in `.strings`).
    public static let chargingCurveAccessibilityLabelFallback = "Loading charging analysis"
    /// VoiceOver label announcing the cost-analysis skeleton as one busy element.
    public static let costAnalysisAccessibilityLabel = "costAnalysis.loading.accessibilityLabel"
    /// English fallback for the cost-analysis label (also shipped in `.strings`).
    public static let costAnalysisAccessibilityLabelFallback = "Loading cost analysis"
}
