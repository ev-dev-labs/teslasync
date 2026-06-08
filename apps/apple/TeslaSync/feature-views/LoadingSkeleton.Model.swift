//
//  LoadingSkeleton.Model.swift
//  TeslaSync — P4 feature view · 0088 · LoadingSkeleton (Apple)
//
//  The pure, host-free spec for the charging-curve LoadingSkeleton surface: the
//  diagnostics identity (P1/S11 `view.opened`), the deterministic layout
//  projection that mirrors every region + skeleton block of the web source
//  (features/charging/components/charging-curve/LoadingSkeleton.tsx), the
//  responsive column policy (web base / lg / xl breakpoints → native size class),
//  and the P1/S10 i18n facade. No SwiftUI view code and no networking live here —
//  the web component is a pure presentational skeleton with no data hooks, so the
//  "adapter" here is the static projection of the source's structure, which the
//  XCTest suite asserts block-for-block without a rendering host.
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

// MARK: - Skeleton block (web <Skeleton className="h-{n} w-{n}"/>)

/// A single shimmer block — the native projection of a web
/// `<Skeleton className="h-{n} w-{n}"/>`. Tailwind sizes are converted at the
/// canonical 1 unit = 4 pt scale. `width == nil` reproduces the web `w-full`
/// (the block fills its container); `topInset` reproduces the web `mt-{n}` that
/// separates a block from the one stacked above it.
public struct SkeletonBlock: Equatable, Sendable {
    /// Fixed width in points, or `nil` for a full-width block (web `w-full`).
    public let width: CGFloat?
    /// Fixed height in points.
    public let height: CGFloat
    /// Leading top inset in points (web `mt-{n}`); `0` when the block has none.
    public let topInset: CGFloat

    public init(width: CGFloat?, height: CGFloat, topInset: CGFloat = 0) {
        self.width = width
        self.height = height
        self.topInset = topInset
    }

    /// Whether the block stretches to fill its container (web `w-full`).
    public var fillsWidth: Bool {
        width == nil
    }
}

// MARK: - Region specs

/// A small stat tile — the web `GlassPanel.p-4` with a label + value skeleton.
public struct SkeletonStatCell: Equatable, Sendable {
    public let label: SkeletonBlock
    public let value: SkeletonBlock

    public init(label: SkeletonBlock, value: SkeletonBlock) {
        self.label = label
        self.value = value
    }
}

/// A titled chart/panel block — the web `GlassPanel.p-6` with a heading + a
/// full-width body block standing in for the eventual chart.
public struct SkeletonChartPanel: Equatable, Sendable {
    public let title: SkeletonBlock
    public let chartBody: SkeletonBlock

    public init(title: SkeletonBlock, chartBody: SkeletonBlock) {
        self.title = title
        self.chartBody = chartBody
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

/// The deterministic projection of the web LoadingSkeleton's structure: seven
/// stacked regions, each reproduced block-for-block from
/// `features/charging/components/charging-curve/LoadingSkeleton.tsx`. Keeping the
/// structure in a value type lets the XCTest suite assert every dimension and
/// count without a rendering host — the same approach the other P4 surfaces use
/// for their adapters.
public struct LoadingSkeletonLayout: Equatable, Sendable {
    public let headerTitle: SkeletonBlock
    public let headerSubtitle: SkeletonBlock
    public let filters: [SkeletonBlock]
    public let summaryStats: [SkeletonStatCell]
    public let summaryColumns: ResponsiveColumns
    public let primaryChart: SkeletonChartPanel
    public let secondaryChart: SkeletonChartPanel
    public let comparisonCharts: [SkeletonChartPanel]
    public let comparisonColumns: ResponsiveColumns
    public let footerStats: [SkeletonStatCell]
    public let footerColumns: ResponsiveColumns

    public init(
        headerTitle: SkeletonBlock,
        headerSubtitle: SkeletonBlock,
        filters: [SkeletonBlock],
        summaryStats: [SkeletonStatCell],
        summaryColumns: ResponsiveColumns,
        primaryChart: SkeletonChartPanel,
        secondaryChart: SkeletonChartPanel,
        comparisonCharts: [SkeletonChartPanel],
        comparisonColumns: ResponsiveColumns,
        footerStats: [SkeletonStatCell],
        footerColumns: ResponsiveColumns
    ) {
        self.headerTitle = headerTitle
        self.headerSubtitle = headerSubtitle
        self.filters = filters
        self.summaryStats = summaryStats
        self.summaryColumns = summaryColumns
        self.primaryChart = primaryChart
        self.secondaryChart = secondaryChart
        self.comparisonCharts = comparisonCharts
        self.comparisonColumns = comparisonColumns
        self.footerStats = footerStats
        self.footerColumns = footerColumns
    }

    /// The number of top-level stacked regions (the web root `space-y-6`
    /// children: header, filters, summary grid, two charts, comparison grid,
    /// footer grid).
    public var regionCount: Int {
        7
    }
}

public extension LoadingSkeletonLayout {
    /// The charging-curve loading skeleton, projected 1:1 from the web source.
    /// Tailwind sizes use the canonical 1 unit = 4 pt scale.
    static let chargingCurve = LoadingSkeletonLayout(
        headerTitle: SkeletonBlock(width: 192, height: 32),
        headerSubtitle: SkeletonBlock(width: 288, height: 16),
        filters: [
            SkeletonBlock(width: 192, height: 40),
            SkeletonBlock(width: 256, height: 40)
        ],
        summaryStats: Array(
            repeating: SkeletonStatCell(
                label: SkeletonBlock(width: 64, height: 12),
                value: SkeletonBlock(width: 80, height: 28, topInset: 8)
            ),
            count: 6
        ),
        summaryColumns: ResponsiveColumns(compact: 2, regular: 6),
        primaryChart: SkeletonChartPanel(
            title: SkeletonBlock(width: 160, height: 20),
            chartBody: SkeletonBlock(width: nil, height: 256, topInset: 16)
        ),
        secondaryChart: SkeletonChartPanel(
            title: SkeletonBlock(width: 224, height: 20),
            chartBody: SkeletonBlock(width: nil, height: 208, topInset: 16)
        ),
        comparisonCharts: Array(
            repeating: SkeletonChartPanel(
                title: SkeletonBlock(width: 176, height: 20),
                chartBody: SkeletonBlock(width: nil, height: 192, topInset: 16)
            ),
            count: 2
        ),
        comparisonColumns: ResponsiveColumns(compact: 1, regular: 2),
        footerStats: Array(
            repeating: SkeletonStatCell(
                label: SkeletonBlock(width: 80, height: 12),
                value: SkeletonBlock(width: 64, height: 28, topInset: 8)
            ),
            count: 4
        ),
        footerColumns: ResponsiveColumns(compact: 2, regular: 4)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves this surface's strings by key with an English fallback so the view
/// holds no hardcoded literals. The web source is an anonymous skeleton (no
/// `t()` calls), so the only string is the native VoiceOver label the Apple HIG
/// busy/loading-state contract requires. Keys live in the "LoadingSkeleton"
/// table, folded into the app `Localizable.xcstrings` catalog at integration
/// time.
public enum LoadingSkeletonLSStrings {
    public static let table = "LoadingSkeleton"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

/// The localization keys this surface resolves, kept in one place so the view,
/// the `.strings` table, and the tests never drift.
public enum LoadingSkeletonStringsKey {
    /// VoiceOver label announcing the whole surface as a single busy element.
    public static let accessibilityLabel = "chargingCurve.loading.accessibilityLabel"
    /// The English fallback — also the value shipped in the `.strings` table.
    public static let accessibilityLabelFallback = "Loading charging analysis"
}
