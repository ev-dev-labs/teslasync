//
//  LoadingSkeleton.Views.swift
//  TeslaSync — P4 feature view · 0088 · LoadingSkeleton (Apple)
//
//  The presentational sub-views the LoadingSkeleton composes from: a single
//  shimmer block, a stat tile (web GlassPanel.p-4), a titled chart panel (web
//  GlassPanel.p-6), and a fixed-column responsive grid. Each is a pure function
//  of its spec value so the parent view stays a thin layout orchestration and
//  the shimmer / Reduce-Motion behaviour stays in `TSSkeleton`.
//

import SwiftUI

// MARK: - Block

/// Renders a single ``SkeletonBlock`` as a `TSSkeleton`, honouring the web
/// `mt-{n}` top inset. The shimmer animation and its Reduce-Motion opt-out live
/// in `TSSkeleton`; each block is hidden from VoiceOver because the surface is
/// announced as one busy element by the parent.
struct SkeletonBlockView: View {
    let block: SkeletonBlock

    var body: some View {
        TSSkeleton(width: block.width, height: block.height)
            .padding(.top, block.topInset)
    }
}

// MARK: - Stat cell (web GlassPanel.p-4)

/// A small stat tile: a glass panel wrapping a label + value skeleton.
struct LoadingSkeletonStatCellView: View {
    let cell: SkeletonStatCell

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: 0) {
                SkeletonBlockView(block: cell.label)
                SkeletonBlockView(block: cell.value)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Chart panel (web GlassPanel.p-6)

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

// MARK: - Responsive grid

/// A fixed-column `LazyVGrid` used for the skeleton's stat + comparison grids.
/// The column count is resolved by the caller from the current width bucket so
/// the grid stays a pure layout primitive. Cells are addressed by index because
/// the skeleton specs are interchangeable value types with no identity.
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
