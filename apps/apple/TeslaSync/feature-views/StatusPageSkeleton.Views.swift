//
//  StatusPageSkeleton.Views.swift
//  TeslaSync — P4 feature view · StatusPageSkeleton (Apple)
//
//  The presentational sub-views the StatusPageSkeleton composes from: a single
//  shimmer block (fixed / fractional / full width, square or pill), the hero
//  (avatar + title/subtitle + trailing action), the pill chip bar, a titled row
//  group (web GlassPanel of uniform rows), and a collapsed accordion row. Each is
//  a pure function of its spec value so the parent view stays a thin
//  region-dispatch and the shimmer / Reduce-Motion behaviour stays in
//  `TSSkeleton`.
//

import SwiftUI

// MARK: - Block

/// Renders a single ``StatusSkeletonBlock`` as a `TSSkeleton`, honouring the web
/// width policy (fixed / fractional / full), corner treatment (`rounded` / pill),
/// and the `mt-{n}` top inset. The shimmer animation and its Reduce-Motion
/// opt-out live in `TSSkeleton`; each block is hidden from VoiceOver because the
/// surface is announced as one busy element by the parent.
struct StatusSkeletonBlockView: View {
    let block: StatusSkeletonBlock

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
            StatusFractionalWidthSkeleton(fraction: fraction, height: block.height, cornerRadius: cornerRadius)
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
struct StatusFractionalWidthSkeleton: View {
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

// MARK: - Hero (web GlassPanel.p-5, flex items-start gap-4)

/// The hero panel: a leading circular avatar, a flexible title + subtitle column
/// (web `flex-1`), and a trailing action block, top-aligned (web `items-start`).
struct StatusSkeletonHeroView: View {
    let hero: StatusSkeletonHero

    var body: some View {
        TSGlassPanel {
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                StatusSkeletonBlockView(block: hero.avatar)
                VStack(alignment: .leading, spacing: 0) {
                    StatusSkeletonBlockView(block: hero.title)
                    StatusSkeletonBlockView(block: hero.subtitle)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                StatusSkeletonBlockView(block: hero.action)
            }
        }
    }
}

// MARK: - Chip bar (web flex gap-2 overflow-hidden)

/// The horizontal pill chip bar. The web row clips its overflow rather than
/// scrolling (`overflow-hidden`), so the chips are laid leading-aligned and the
/// row is clipped to its width.
struct StatusSkeletonChipBarView: View {
    let chipBar: StatusSkeletonChipBar

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            ForEach(Array(chipBar.chips.enumerated()), id: \.offset) { _, chip in
                StatusSkeletonBlockView(block: chip)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .clipped()
    }
}

// MARK: - Row group (web GlassPanel of heading + uniform rows)

/// A titled row group: a glass panel wrapping a heading then a uniform stack of
/// full-width rows (web `space-y-{n}` of `SkeletonRow`).
struct StatusSkeletonRowGroupView: View {
    let group: StatusSkeletonRowGroup

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: 0) {
                StatusSkeletonBlockView(block: group.heading)
                VStack(spacing: group.rowSpacing) {
                    ForEach(0 ..< group.rowCount, id: \.self) { _ in
                        StatusSkeletonBlockView(block: .fill(height: group.rowHeight))
                    }
                }
                .padding(.top, group.rowsTopInset)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Accordion row (web GlassPanel.p-5, flex items-center gap-3)

/// A collapsed accordion row: a leading icon, a flexible title + subtitle column
/// (web `flex-1`), and a trailing accessory block, centred (web `items-center`).
struct StatusSkeletonAccordionRowView: View {
    let row: StatusSkeletonAccordionRow

    var body: some View {
        TSGlassPanel {
            HStack(alignment: .center, spacing: TSSpacing.md) {
                StatusSkeletonBlockView(block: row.icon)
                VStack(alignment: .leading, spacing: 0) {
                    StatusSkeletonBlockView(block: row.title)
                    StatusSkeletonBlockView(block: row.subtitle)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                StatusSkeletonBlockView(block: row.trailing)
            }
        }
    }
}

// MARK: - Region dispatch

/// Renders one ``StatusPageSkeletonRegion`` to its native sub-view. Keeping the
/// dispatch in one place lets the parent surface stay a simple ordered walk of
/// the projection.
struct StatusPageSkeletonRegionView: View {
    let region: StatusPageSkeletonRegion

    var body: some View {
        switch region {
        case let .hero(hero):
            StatusSkeletonHeroView(hero: hero)
        case let .chipBar(chipBar):
            StatusSkeletonChipBarView(chipBar: chipBar)
        case let .rowGroup(group):
            StatusSkeletonRowGroupView(group: group)
        case let .accordionRow(row):
            StatusSkeletonAccordionRowView(row: row)
        }
    }
}
