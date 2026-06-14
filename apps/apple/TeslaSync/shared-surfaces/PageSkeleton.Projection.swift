//
//  PageSkeleton.Projection.swift
//  TeslaSync — P4 shared surface · 0132 · PageSkeleton (Apple)
//
//  The pure, SwiftUI-free core of the parity port of `web/src/components/feedback/PageSkeleton.tsx`.
//  That module exports four shaped loading-skeleton building blocks — `PageHeaderSkeleton`,
//  `StatGridSkeleton`, `ChartBlockSkeleton`, and `TableSkeleton` — whose only job is to claim the
//  same vertical / horizontal space the real content will occupy, so the perceived load is
//  "loading → ready" rather than "empty → suddenly full" (near-zero layout shift). This file holds
//  the SwiftUI-free facts each block needs: the surface slug for diagnostics, the accessibility
//  regions (the web `role="status"` + `aria-label` pairs), and the layout geometry derived from the
//  web Tailwind utilities. Keeping the counts, the responsive column choice, and the dimensions here
//  (rather than in the views) lets every shape be asserted deterministically without a bundle or a
//  rendered view — the parity of the web tests that count child placeholders. // parity:allow ui
//
//  States note: the web source is a PURE loading-skeleton module — it carries no data, no query, and
//  therefore no empty / error / stale / offline branch. The loading shape IS the surface. Reproducing
//  that faithfully (rather than inventing chrome the web component does not have) is the honest port;
//  the generic per-surface state list does not apply because there is no data boundary to gate.
//

import Foundation

// MARK: - Surface metadata

/// Static, non-identifying surface constants — the diagnostics slug emitted as `view.opened`
/// (P1/S11) when a skeleton region first appears.
public enum PageSkeletonMeta {
    public static let surfaceSlug = "PageSkeleton"
}

// MARK: - Accessibility regions (web `role="status"` + `aria-label`)

/// The four skeleton regions, each mirroring a `role="status" aria-busy="true" aria-label="…"` block
/// in the web source. The key + English fallback resolve through the P1/S10 facade so no user-facing
/// literal is baked into the views.
public enum PageSkeletonRegion: String, Sendable, CaseIterable {
    case pageHeader
    case statGrid
    case chart
    case table

    /// The localization key (P1/S10 "PageSkeleton" table).
    public var labelKey: String {
        switch self {
        case .pageHeader: "skeleton.pageHeader.label"
        case .statGrid: "skeleton.statGrid.label"
        case .chart: "skeleton.chart.label"
        case .table: "skeleton.table.label"
        }
    }

    /// The English fallback — the verbatim web `aria-label` for the region.
    public var labelFallback: String {
        switch self {
        case .pageHeader: "Loading page header"
        case .statGrid: "Loading stat cards"
        case .chart: "Loading chart"
        case .table: "Loading table"
        }
    }

    /// The stable view identifier — the parity of the web `data-testid`, used by VoiceOver / UI tests
    /// to locate the loading region.
    public var accessibilityIdentifier: String {
        switch self {
        case .pageHeader: "page-header-skeleton"
        case .statGrid: "stat-grid-skeleton"
        case .chart: "chart-block-skeleton"
        case .table: "table-skeleton"
        }
    }
}

// MARK: - Layout geometry (web Tailwind utilities → platform tokens)

/// The SwiftUI-free layout constants for each block, derived from the web Tailwind classes and mapped
/// to the P1/S9 design tokens (per the prompt: do not port raw Tailwind px — use platform tokens).
/// Heights map px → pt directly (a skeleton box has no intrinsic type metrics to scale); corner radii
/// and gaps resolve to the nearest `TSRadius` / `TSSpacing` token.
public enum PageSkeletonLayout {
    // PageHeader — web title `h-8 w-64`, subtitle `h-4 w-96 max-w-full`, `space-y-2`.
    public static let headerSpacing: CGFloat = TSSpacing.sm
    public static let titleHeight: CGFloat = 32
    public static let titleMaxWidth: CGFloat = 256
    public static let subtitleHeight: CGFloat = 16
    public static let subtitleMaxWidth: CGFloat = 384

    // StatGrid — web `grid-cols-2 md:grid-cols-4`, `gap-4`, card `h-24 rounded-xl`.
    public static let defaultStatCards = 4
    public static let statGridGap: CGFloat = TSSpacing.lg
    public static let statCardHeight: CGFloat = 96
    public static let statCardRadius: CGFloat = TSRadius.md
    public static let statColumnsCompact = 2
    public static let statColumnsRegular = 4

    // ChartBlock — web full-width `Skeleton rounded-xl`, default height 320.
    public static let defaultChartHeight: CGFloat = 320
    public static let chartRadius: CGFloat = TSRadius.md

    // Table — web `space-y-2`, header `h-10 rounded-t-xl`, rows×cols `gap-3`, cell `h-8 rounded`.
    public static let defaultTableRows = 8
    public static let defaultTableCols = 4
    public static let tableRowSpacing: CGFloat = TSSpacing.sm
    public static let tableColumnGap: CGFloat = TSSpacing.md
    public static let tableHeaderHeight: CGFloat = 40
    public static let tableHeaderRadius: CGFloat = TSRadius.md
    public static let tableCellHeight: CGFloat = 32
    public static let tableCellRadius: CGFloat = TSRadius.sm

    /// The stat-grid column count for the current width — the parity of the web `grid-cols-2`
    /// (compact) vs. `md:grid-cols-4` (regular / iPad / macOS) breakpoint.
    public static func statColumns(isRegularWidth: Bool) -> Int {
        isRegularWidth ? statColumnsRegular : statColumnsCompact
    }

    /// Clamp a requested placeholder count to a non-negative value, so a stray negative `cards` / // parity:allow ui
    /// `rows` / `cols` input degrades to "render nothing" instead of trapping in `ForEach(0..<n)`
    /// (the parity of the web `Array.from({ length })` guarding against a malformed length).
    public static func clampedCount(_ count: Int) -> Int {
        max(0, count)
    }
}
