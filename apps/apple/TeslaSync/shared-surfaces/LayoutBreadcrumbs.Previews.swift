//
//  LayoutBreadcrumbs.Previews.swift
//  TeslaSync — P4 shared surface · 0170 · LayoutBreadcrumbs (Apple)
//
//  Xcode previews for every real branch of the global Layout breadcrumb row: the full live composite (a
//  provider + a page that registers a drive label + the real ``LayoutBreadcrumbs`` row + every scenario
//  staged), the rendered trail with a page override applied, the rendered deep trail on route defaults,
//  the suppressed top-level case, and the unknown-route empty case. DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
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

    #Preview("Live · all branches") {
        ScrollView { LayoutBreadcrumbsLiveSample() }
    }

    #Preview("Trail · override applied") {
        staged("drive detail · page override pushed up") {
            LayoutBreadcrumbsScenarioRow(scenario: .overridden)
        }
    }

    #Preview("Trail · deep route defaults") {
        staged("trip replay · route default labels") {
            LayoutBreadcrumbsScenarioRow(scenario: .deep)
        }
    }

    #Preview("Suppressed · top-level") {
        staged("top-level route · single item · breadcrumb hidden") {
            LayoutBreadcrumbsScenarioRow(scenario: .suppressed)
        }
    }

    #Preview("Unknown route · empty") {
        staged("unregistered route · no trail") {
            LayoutBreadcrumbsScenarioRow(scenario: .unknown)
        }
    }
#endif
