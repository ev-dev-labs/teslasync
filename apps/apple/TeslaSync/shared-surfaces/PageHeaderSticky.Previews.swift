//
//  PageHeaderSticky.Previews.swift
//  TeslaSync — P4 shared surface · 0172 · PageHeaderSticky (Apple)
//
//  Xcode previews for every real branch of the sticky bar: the live scroll demo (the hidden ⇄ visible
//  transition a real page shows), the scroll-to-top button bar, the plain bar, the long-summary
//  truncation case, and the hidden-branch note. DEBUG-only; compiled by the app targets and skipped by
//  the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Live · scroll to reveal") {
        PageHeaderStickyLiveSample()
    }

    #Preview("Inspector · all branches") {
        ScrollView { PageHeaderStickyInspector() }
    }

    #Preview("Bar · scroll-to-top (default)") {
        staged("scroll-to-top button · up-arrow glyph") {
            PageHeaderStickyBar(
                presentation: PageHeaderStickySampleData.presentation(mode: .scrollToTop),
                onScrollToTop: {},
                summary: { Text(verbatim: PageHeaderStickySampleData.summary) }
            )
        }
    }

    #Preview("Bar · plain (scrollToTop = false)") {
        staged("plain bar · no arrow · labeled region") {
            PageHeaderStickyBar(
                presentation: PageHeaderStickySampleData.presentation(mode: .plain)
            ) {
                Text(verbatim: PageHeaderStickySampleData.summary)
            }
        }
    }

    #Preview("Bar · long summary (truncated)") {
        staged("long summary · single-line truncation") {
            PageHeaderStickyBar(
                presentation: PageHeaderStickySampleData.presentation(mode: .scrollToTop),
                onScrollToTop: {},
                summary: { Text(verbatim: PageHeaderStickySampleData.longSummary) }
            )
        }
    }

    #Preview("Hidden · hero in view") {
        staged("hidden branch · web renders null") {
            PageHeaderStickyHiddenRow()
        }
    }
#endif
