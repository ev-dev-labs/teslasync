//
//  StickyCompactHero.Previews.swift
//  TeslaSync — P4 shared surface · 0201 · StickyCompactHero (Apple)
//
//  Xcode previews for every real branch of the compact hero bar: the live scroll demo (the hidden ⇄
//  visible transition a real page shows, with a working refresh toggle), every status variant (healthy /
//  degraded / unhealthy / unknown / maintenance), the with / without last-checked label, the with /
//  without refresh affordance, the refreshing spinner, the full inspector, and the hidden-branch note.
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
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
        StickyCompactHeroLiveSample()
    }

    #Preview("Inspector · all statuses + states") {
        ScrollView { StickyCompactHeroInspector() }
    }

    #Preview("Status · healthy") {
        staged("healthy · icon + headline + last-checked + refresh") {
            StickyCompactHeroBar(
                presentation: StickyCompactHeroSampleData.presentation(status: .healthy),
                onScrollToTop: {},
                onRefresh: {}
            )
        }
    }

    #Preview("Status · degraded") {
        staged("degraded · amber hue") {
            StickyCompactHeroBar(
                presentation: StickyCompactHeroSampleData.presentation(status: .degraded),
                onScrollToTop: {},
                onRefresh: {}
            )
        }
    }

    #Preview("Status · unhealthy") {
        staged("unhealthy · red hue") {
            StickyCompactHeroBar(
                presentation: StickyCompactHeroSampleData.presentation(status: .unhealthy),
                onScrollToTop: {},
                onRefresh: {}
            )
        }
    }

    #Preview("Status · unknown") {
        staged("unknown · neutral hue") {
            StickyCompactHeroBar(
                presentation: StickyCompactHeroSampleData.presentation(status: .unknown),
                onScrollToTop: {},
                onRefresh: {}
            )
        }
    }

    #Preview("Status · maintenance") {
        staged("maintenance · info hue") {
            StickyCompactHeroBar(
                presentation: StickyCompactHeroSampleData.presentation(status: .maintenance),
                onScrollToTop: {},
                onRefresh: {}
            )
        }
    }

    #Preview("Refreshing · spinner") {
        staged("refreshing · glyph spins · button disabled") {
            StickyCompactHeroBar(
                presentation: StickyCompactHeroSampleData.presentation(status: .healthy, refreshing: true),
                onScrollToTop: {},
                onRefresh: {}
            )
        }
    }

    #Preview("Minimal · no last-checked, no refresh") {
        staged("minimal · headline + scroll-to-top only") {
            StickyCompactHeroBar(
                presentation: StickyCompactHeroSampleData.presentation(
                    status: .healthy,
                    showsLastChecked: false,
                    hasRefresh: false
                ),
                onScrollToTop: {}
            )
        }
    }

    #Preview("Hidden · hero in view") {
        staged("hidden branch · web renders null") {
            StickyCompactHeroHiddenRow()
        }
    }
#endif
