//
//  PageSkeleton.Views.swift
//  TeslaSync — P4 shared surface · 0132 · PageSkeleton (Apple)
//
//  The presentational leaves composed by the public skeleton blocks, reproducing the web
//  `components/feedback/PageSkeleton.tsx` shapes. Every box reuses the shared `TSSkeleton` primitive
//  (the native peer of the web `<Skeleton>` the source imports from `./Skeleton`) — DRY, so the
//  shimmer, the Reduce-Motion gate, and the token-driven fill live in one place — and every region is
//  wrapped as one VoiceOver "loading" element (the parity of the web `role="status" aria-busy="true"`
//  live region). The inner boxes are decorative (`TSSkeleton` is already `accessibilityHidden`), so a
//  screen reader hears one localized "Loading …" announcement per region, not a flurry of empty
//  placeholders. No networking and no string literals live here.
//

import SwiftUI

// MARK: - Loading-region accessibility wrapper (web `role="status" aria-busy`)

extension View {
    /// Marks a skeleton block as a single VoiceOver loading region: it collapses the decorative
    /// placeholder boxes into one element labelled with the region's localized "Loading …" string and
    /// flagged `updatesFrequently` (the native parity of the web `role="status" aria-busy="true"`
    /// live region), and stamps the web `data-testid` as the accessibility identifier.
    func pageSkeletonRegion(_ region: PageSkeletonRegion, label: String) -> some View {
        accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: label))
            .accessibilityAddTraits(.updatesFrequently)
            .accessibilityIdentifier(region.accessibilityIdentifier)
    }
}

// MARK: - Stat card (web `<Skeleton className="h-24 rounded-xl" />`)

/// A single stat-card placeholder — a full-column-width box at the web `h-24 rounded-xl` size. Used
/// as the grid cell in `StatGridSkeleton`.
struct PageSkeletonStatCard: View {
    var body: some View {
        TSSkeleton(
            height: PageSkeletonLayout.statCardHeight,
            cornerRadius: PageSkeletonLayout.statCardRadius
        )
    }
}

// MARK: - Table row (web `grid` of `cols` × `<Skeleton className="h-8 rounded" />`)

/// One table body row — `columns` equal-width cells at the web `h-8 rounded` size, laid out with the
/// web `gap-3` spacing. Equal-width cells reproduce the web `repeat(cols, minmax(0, 1fr))` grid track.
struct PageSkeletonTableRow: View {
    let columns: Int

    var body: some View {
        HStack(spacing: PageSkeletonLayout.tableColumnGap) {
            ForEach(0 ..< columns, id: \.self) { _ in
                TSSkeleton(
                    height: PageSkeletonLayout.tableCellHeight,
                    cornerRadius: PageSkeletonLayout.tableCellRadius
                )
            }
        }
    }
}
