//
//  BreadcrumbOverridesContext.Previews.swift
//  TeslaSync — P4 shared surface · 0166 · BreadcrumbOverridesContext (Apple)
//
//  Xcode previews for every real branch of the breadcrumb-overrides bridge: the full inspector (a
//  provider + a page that registers a drive label + every scenario staged), the rendered trail with a
//  page override applied, the trail on route defaults, the suppressed top-level case, the unknown-route
//  empty case, and a standalone (no-provider) row proving the context is inert there. DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func resolvedTrail(_ scenario: BreadcrumbOverridesScenario) -> BreadcrumbOverridesTrailResolved {
        BreadcrumbOverridesProjection.resolve(
            table: BreadcrumbOverridesSampleData.table,
            path: scenario.path,
            overrides: scenario.overrides,
            localize: BreadcrumbOverridesStrings.localize
        )
    }

    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: () -> some View) -> some View {
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

    #Preview("Inspector · all branches") {
        ScrollView { BreadcrumbOverridesContextSample() }
    }

    #Preview("Trail · override applied") {
        staged("drive detail · page override pushed up") {
            BreadcrumbOverridesTrailView(items: resolvedTrail(.overridden).items)
        }
    }

    #Preview("Trail · route defaults") {
        staged("drive detail · route default labels") {
            BreadcrumbOverridesTrailView(items: resolvedTrail(.defaults).items)
        }
    }

    #Preview("Suppressed · top-level") {
        staged("top-level route · single item · breadcrumb hidden") {
            BreadcrumbOverridesScenarioRow(scenario: .suppressed)
        }
    }

    #Preview("Unknown route · empty") {
        staged("unregistered route · no trail") {
            BreadcrumbOverridesScenarioRow(scenario: .unknown)
        }
    }

    #Preview("Standalone (no provider)") {
        staged("no provider · context is empty · register is inert") {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                BreadcrumbOverridesReader { overrides in
                    Text(verbatim: overrides.isEmpty ? "overrides: {} (no provider)" : "overrides present")
                        .font(Font.TS.body)
                        .foregroundStyle(Color.TS.textSecondary)
                }
                BreadcrumbOverridesTrailView(items: resolvedTrail(.defaults).items)
            }
            .setBreadcrumbOverrides(BreadcrumbOverridesSampleData.driveOverride)
        }
    }
#endif
