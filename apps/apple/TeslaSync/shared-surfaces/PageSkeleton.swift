//
//  PageSkeleton.swift
//  TeslaSync — P4 shared surface · 0132 · PageSkeleton (Apple)
//
//  The SwiftUI parity of `web/src/components/feedback/PageSkeleton.tsx`: the four shaped loading-
//  skeleton building blocks a page mounts while its data resolves, so the loading UI claims the same
//  space the real content will fill and the perceived load is "loading → ready" rather than "empty →
//  suddenly full". Each block is the exact peer of a web export:
//
//    • PageHeaderSkeleton  — the `<PageContainer>` title + subtitle rows.
//    • StatGridSkeleton    — the 2-up (compact) / 4-up (regular) stat-card row, `cards` configurable.
//    • ChartBlockSkeleton  — a single layout-preserving chart box, `height` configurable.
//    • TableSkeleton       — a header bar plus `rows` × `cols` body cells.
//
//  Every box reuses the shared `TSSkeleton` primitive (the native peer of the web `<Skeleton>`); every
//  dimension and gap comes from the P1/S9 tokens (no Tailwind ports); every region announces itself to
//  VoiceOver as a localized "Loading …" status via the P1/S10 facade; and each block emits the
//  `view.opened` diagnostics event once (P1/S11) through its `PageSkeletonModel`. The blocks are pure
//  presentation — there is no data, hence no empty / error / stale / offline branch: the loading shape
//  IS the surface (see PageSkeleton.Projection.swift). No networking lives in these views.
//

import SwiftUI

// MARK: - PageHeaderSkeleton (web `PageHeaderSkeleton`)

/// Mirrors the web `<PageContainer>` title + subtitle row: a wide title bar over a wider, container-
/// capped subtitle bar. The parity of the web `space-y-2` block with `h-8 w-64` + `h-4 w-96 max-w-full`.
public struct PageHeaderSkeleton: View {
    @State private var model: PageSkeletonModel

    /// Designated initializer — adopts a fully-formed model (previews / tests inject a telemetry spy
    /// + an English string stub).
    public init(model: PageSkeletonModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer mirroring the web prop-less mount `<PageHeaderSkeleton />`.
    public init() {
        self.init(model: PageSkeletonModel())
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: PageSkeletonLayout.headerSpacing) {
            TSSkeleton(height: PageSkeletonLayout.titleHeight)
                .frame(maxWidth: PageSkeletonLayout.titleMaxWidth, alignment: .leading)
            TSSkeleton(height: PageSkeletonLayout.subtitleHeight)
                .frame(maxWidth: PageSkeletonLayout.subtitleMaxWidth, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .pageSkeletonRegion(.pageHeader, label: model.label(for: .pageHeader))
        .onAppear { model.start() }
    }
}

// MARK: - StatGridSkeleton (web `StatGridSkeleton`)

/// A responsive grid of stat-card placeholders — 2 columns in a compact width and 4 in a regular
/// width (iPad / macOS), the parity of the web `grid-cols-2 md:grid-cols-4`. `cards` (default 4) sets
/// how many placeholders render.
public struct StatGridSkeleton: View {
    private let cards: Int
    @State private var model: PageSkeletonModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    /// Designated initializer.
    public init(cards: Int = PageSkeletonLayout.defaultStatCards, model: PageSkeletonModel) {
        self.cards = cards
        _model = State(initialValue: model)
    }

    /// Convenience initializer mirroring the web `<StatGridSkeleton cards={…} />`.
    public init(cards: Int = PageSkeletonLayout.defaultStatCards) {
        self.init(cards: cards, model: PageSkeletonModel())
    }

    private var isRegularWidth: Bool {
        #if os(iOS)
            horizontalSizeClass != .compact
        #else
            true
        #endif
    }

    private var columnCount: Int {
        PageSkeletonLayout.statColumns(isRegularWidth: isRegularWidth)
    }

    public var body: some View {
        LazyVGrid(
            columns: Array(
                repeating: GridItem(.flexible(), spacing: PageSkeletonLayout.statGridGap),
                count: columnCount
            ),
            spacing: PageSkeletonLayout.statGridGap
        ) {
            ForEach(0 ..< PageSkeletonLayout.clampedCount(cards), id: \.self) { _ in
                PageSkeletonStatCard()
            }
        }
        .pageSkeletonRegion(.statGrid, label: model.label(for: .statGrid))
        .onAppear { model.start() }
    }
}

// MARK: - ChartBlockSkeleton (web `ChartBlockSkeleton`)

/// A single rectangular placeholder sized to a chart container — the parity of the web full-width
/// `<Skeleton rounded-xl height={height} />`. `height` (default 320) sets the box height.
public struct ChartBlockSkeleton: View {
    private let height: CGFloat
    @State private var model: PageSkeletonModel

    /// Designated initializer.
    public init(height: CGFloat = PageSkeletonLayout.defaultChartHeight, model: PageSkeletonModel) {
        self.height = height
        _model = State(initialValue: model)
    }

    /// Convenience initializer mirroring the web `<ChartBlockSkeleton height={…} />`.
    public init(height: CGFloat = PageSkeletonLayout.defaultChartHeight) {
        self.init(height: height, model: PageSkeletonModel())
    }

    public var body: some View {
        TSSkeleton(height: height, cornerRadius: PageSkeletonLayout.chartRadius)
            .frame(maxWidth: .infinity)
            .pageSkeletonRegion(.chart, label: model.label(for: .chart))
            .onAppear { model.start() }
    }
}

// MARK: - TableSkeleton (web `TableSkeleton`)

/// A table-shaped skeleton — a header bar over `rows` body rows of `cols` equal-width cells, the
/// parity of the web header `h-10 rounded-t-xl` plus the `rows` × `cols` grid of `h-8 rounded` cells.
/// `rows` defaults to 8 and `cols` to 4.
public struct TableSkeleton: View {
    private let rows: Int
    private let columns: Int
    @State private var model: PageSkeletonModel

    /// Designated initializer.
    public init(
        rows: Int = PageSkeletonLayout.defaultTableRows,
        cols: Int = PageSkeletonLayout.defaultTableCols,
        model: PageSkeletonModel
    ) {
        self.rows = rows
        columns = cols
        _model = State(initialValue: model)
    }

    /// Convenience initializer mirroring the web `<TableSkeleton rows={…} cols={…} />`.
    public init(
        rows: Int = PageSkeletonLayout.defaultTableRows,
        cols: Int = PageSkeletonLayout.defaultTableCols
    ) {
        self.init(rows: rows, cols: cols, model: PageSkeletonModel())
    }

    public var body: some View {
        VStack(spacing: PageSkeletonLayout.tableRowSpacing) {
            TSSkeleton(
                height: PageSkeletonLayout.tableHeaderHeight,
                cornerRadius: PageSkeletonLayout.tableHeaderRadius
            )
            ForEach(0 ..< PageSkeletonLayout.clampedCount(rows), id: \.self) { _ in
                PageSkeletonTableRow(columns: PageSkeletonLayout.clampedCount(columns))
            }
        }
        .pageSkeletonRegion(.table, label: model.label(for: .table))
        .onAppear { model.start() }
    }
}
