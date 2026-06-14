//
//  Breadcrumbs.Previews.swift
//  TeslaSync — P4 shared surface · 0167 · Breadcrumbs (Apple)
//
//  Xcode previews for every real branch of the breadcrumb trail: the full live sample (the real
//  ``Breadcrumbs`` view plus every staged scenario), the rendered nested trail, the deep trail on a regular
//  width, the same deep trail collapsed for a compact width, the suppressed single-item case, and the empty
//  input. DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
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
        ScrollView { BreadcrumbsSample() }
    }

    #Preview("Trail · nested") {
        staged("nested route · three crumbs") {
            BreadcrumbsScenarioRow(scenario: .rendered)
        }
    }

    #Preview("Trail · deep (regular)") {
        staged("deep route · all ancestors shown") {
            BreadcrumbsScenarioRow(scenario: .deep)
        }
    }

    #Preview("Trail · collapsed (compact)") {
        staged("compact width · middle collapsed to …") {
            BreadcrumbsScenarioRow(scenario: .collapsed)
        }
    }

    #Preview("Suppressed · top-level") {
        staged("top-level page · single item · breadcrumb hidden") {
            BreadcrumbsScenarioRow(scenario: .suppressed)
        }
    }

    #Preview("Empty · no items") {
        staged("no items · no trail") {
            BreadcrumbsScenarioRow(scenario: .empty)
        }
    }
#endif
