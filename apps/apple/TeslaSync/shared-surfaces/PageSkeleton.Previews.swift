//
//  PageSkeleton.Previews.swift
//  TeslaSync — P4 shared surface · 0132 · PageSkeleton (Apple)
//
//  Xcode previews for the four building blocks the web source exports — each at its default and at a
//  configured variant (more cards, a shorter chart, a different row × column table) — plus a full
//  page-load composite that stacks all four the way a loading page mounts them. Each preview is staged
//  on the surface background so the token-driven shimmer reads correctly in light + dark. DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ view: some View) -> some View {
        view
            .padding()
            .frame(maxWidth: 480, alignment: .leading)
            .background(Color.TS.bg)
    }

    #Preview("Page header") {
        staged(PageHeaderSkeleton())
    }

    #Preview("Stat grid — default (4)") {
        staged(StatGridSkeleton())
    }

    #Preview("Stat grid — 6 cards") {
        staged(StatGridSkeleton(cards: 6))
    }

    #Preview("Chart block — default 320") {
        staged(ChartBlockSkeleton())
    }

    #Preview("Chart block — 200") {
        staged(ChartBlockSkeleton(height: 200))
    }

    #Preview("Table — default 8 × 4") {
        staged(TableSkeleton())
    }

    #Preview("Table — 3 × 5") {
        staged(TableSkeleton(rows: 3, cols: 5))
    }

    #Preview("Full page-load composite") {
        staged(
            ScrollView {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    PageHeaderSkeleton()
                    StatGridSkeleton()
                    ChartBlockSkeleton()
                    TableSkeleton(rows: 5)
                }
            }
        )
    }
#endif
