//
//  LoadingSkeleton.Views.swift
//  TeslaSync — P4 feature view · LoadingSkeleton (Apple)
//
//  The presentational sub-views the LoadingSkeleton composes from: a single
//  shimmer block (fixed / fractional / full width, square or pill), the page
//  header (title + subtitle + optional trailing pill), a stat tile (web
//  GlassPanel.p-4), a titled chart panel, a row table, and a fixed-column
//  responsive grid. Each is a pure function of its spec value so the parent view
//  stays a thin region-dispatch and the shimmer / Reduce-Motion behaviour stays
//  in `TSSkeleton`.
//

import SwiftUI

// MARK: - Grid gap → platform token

private extension SkeletonGridGap {
    /// The platform spacing token for this web gap (native rhythm, not ported px).
    var spacing: CGFloat {
        switch self {
        case .gap4: TSSpacing.lg
        case .gap6: TSSpacing.xl
        }
    }
}

// MARK: - Block

/// Renders a single ``SkeletonBlock`` as a `TSSkeleton`, honouring the web width
/// policy (fixed / fractional / full), corner treatment (`rounded` / pill), and
/// the `mt-{n}` top inset. The shimmer animation and its Reduce-Motion opt-out
/// live in `TSSkeleton`; each block is hidden from VoiceOver because the surface
/// is announced as one busy element by the parent.
struct SkeletonBlockView: View {
    let block: SkeletonBlock

    var body: some View {
        blockBody
            .padding(.top, block.topInset)
    }

    @ViewBuilder private var blockBody: some View {
        switch block.width {
        case let .points(points):
            TSSkeleton(width: points, height: block.height, cornerRadius: cornerRadius)
        case .fill:
            TSSkeleton(width: nil, height: block.height, cornerRadius: cornerRadius)
        case let .fraction(fraction):
            FractionalWidthSkeleton(fraction: fraction, height: block.height, cornerRadius: cornerRadius)
        }
    }

    private var cornerRadius: CGFloat {
        switch block.shape {
        case .rounded: TSRadius.sm
        case .pill: TSRadius.pill
        }
    }
}

/// A shimmer block sized to a fraction of its container's width (web `"{p}%"`).
/// `TSSkeleton` only takes a fixed or fill width, so the container width is read
/// once via `GeometryReader` and multiplied by the fraction; the height is fixed
/// so the reader does not stretch the surrounding stack.
struct FractionalWidthSkeleton: View {
    let fraction: CGFloat
    let height: CGFloat
    let cornerRadius: CGFloat

    var body: some View {
        GeometryReader { proxy in
            TSSkeleton(
                width: max(proxy.size.width * fraction, 0),
                height: height,
                cornerRadius: cornerRadius
            )
        }
        .frame(height: height)
    }
}

// MARK: - Header (web flex header with optional trailing pill)

/// The page header: a leading title + subtitle column with an optional trailing
/// accessory. With an accessory it reproduces the web `sm:flex-row
/// sm:justify-between` (a centred row on regular width, a stacked column on
/// compact); with none it is the plain title column (web `space-y-2`).
struct LoadingSkeletonHeaderView: View {
    let header: SkeletonHeader
    let isRegularWidth: Bool

    var body: some View {
        if let accessory = header.trailingAccessory {
            if isRegularWidth {
                HStack(alignment: .center, spacing: 0) {
                    titles
                    Spacer(minLength: TSSpacing.lg)
                    SkeletonBlockView(block: accessory)
                }
            } else {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    titles
                    SkeletonBlockView(block: accessory)
                }
            }
        } else {
            titles
        }
    }

    private var titles: some View {
        VStack(alignment: .leading, spacing: 0) {
            SkeletonBlockView(block: header.title)
            SkeletonBlockView(block: header.subtitle)
        }
    }
}

// MARK: - Stat cell (web GlassPanel.p-4)

/// A small stat tile: a glass panel wrapping an ordered stack of shimmer lines.
struct LoadingSkeletonStatCellView: View {
    let cell: SkeletonStatCell

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(cell.lines.enumerated()), id: \.offset) { _, line in
                    SkeletonBlockView(block: line)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Chart panel (web GlassPanel)

/// A titled chart slot: a glass panel wrapping a heading + full-width body
/// skeleton.
struct LoadingSkeletonChartPanelView: View {
    let panel: SkeletonChartPanel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: 0) {
                SkeletonBlockView(block: panel.title)
                SkeletonBlockView(block: panel.chartBody)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Table (web GlassPanel.p-4 with mt-4 space-y-2 rows)

/// A table slot: a glass panel wrapping a heading then a uniform stack of
/// full-width row blocks.
struct LoadingSkeletonTableView: View {
    let table: SkeletonTable

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: 0) {
                SkeletonBlockView(block: table.title)
                VStack(spacing: table.rowSpacing) {
                    ForEach(0 ..< table.rowCount, id: \.self) { _ in
                        SkeletonBlockView(block: .fill(height: table.rowHeight))
                    }
                }
                .padding(.top, table.rowsTopInset)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Responsive grid

/// A fixed-column `LazyVGrid` used for the skeleton's stat + chart grids. The
/// column count is resolved by the caller from the current width bucket so the
/// grid stays a pure layout primitive. Cells are addressed by index because the
/// skeleton specs are interchangeable value types with no identity.
struct LoadingSkeletonGrid<Content: View>: View {
    let count: Int
    let columns: Int
    let spacing: CGFloat
    @ViewBuilder let content: (Int) -> Content

    private var gridColumns: [GridItem] {
        Array(
            repeating: GridItem(.flexible(), spacing: spacing, alignment: .top),
            count: max(columns, 1)
        )
    }

    var body: some View {
        LazyVGrid(columns: gridColumns, spacing: spacing) {
            ForEach(0 ..< count, id: \.self) { index in
                content(index)
            }
        }
    }
}

// MARK: - Region dispatch

/// Renders one ``LoadingSkeletonRegion`` to its native sub-view, resolving grid
/// column counts from the current width bucket. Keeping the dispatch in one
/// place lets the parent surface stay a simple ordered walk of the projection.
struct LoadingSkeletonRegionView: View {
    let region: LoadingSkeletonRegion
    let isRegularWidth: Bool

    var body: some View {
        switch region {
        case let .header(header):
            LoadingSkeletonHeaderView(header: header, isRegularWidth: isRegularWidth)
        case let .filterRow(blocks):
            filterRow(blocks)
        case let .statGrid(grid):
            LoadingSkeletonGrid(
                count: grid.cells.count,
                columns: grid.columns.count(isRegularWidth: isRegularWidth),
                spacing: grid.gap.spacing
            ) { index in
                LoadingSkeletonStatCellView(cell: grid.cells[index])
            }
        case let .chartPanel(panel):
            LoadingSkeletonChartPanelView(panel: panel)
        case let .chartGrid(grid):
            LoadingSkeletonGrid(
                count: grid.panels.count,
                columns: grid.columns.count(isRegularWidth: isRegularWidth),
                spacing: grid.gap.spacing
            ) { index in
                LoadingSkeletonChartPanelView(panel: grid.panels[index])
            }
        case let .table(table):
            LoadingSkeletonTableView(table: table)
        }
    }

    private func filterRow(_ blocks: [SkeletonBlock]) -> some View {
        HStack(spacing: TSSpacing.lg) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                SkeletonBlockView(block: block)
            }
            Spacer(minLength: 0)
        }
    }
}
