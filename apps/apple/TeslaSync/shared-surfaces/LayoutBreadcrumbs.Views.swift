//
//  LayoutBreadcrumbs.Views.swift
//  TeslaSync — P4 shared surface · 0170 · LayoutBreadcrumbs (Apple)
//
//  The presentational pieces of the global Layout breadcrumb row that are unique to this composition: the
//  empty slot (the faithful peer of the web `<Breadcrumbs>` returning `null`) and a DEBUG-only inspector
//  that stages every REAL branch over the actual route catalog — a rendered nested trail, a rendered deep
//  trail, an override-applied trail, a suppressed top-level page, and an unknown route — so the previews +
//  view-composition tests have a concrete reference. The trail itself is drawn by the shared
//  ``BreadcrumbOverridesTrailView`` (the sibling P4/0166 renderer, web `<Breadcrumbs>`); this surface does
//  not re-implement it. All copy resolves through P1/S10; all chrome is token-driven (P1/S9); no raw hex,
//  no Tailwind ports.
//

import SwiftUI

// MARK: - LayoutBreadcrumbsEmptySlot (web `<Breadcrumbs>` → null)

/// The empty breadcrumb slot — the faithful native peer of the web `<Breadcrumbs>` returning `null` for a
/// single-/zero-item trail. The surrounding Layout chrome row keeps its quick-search hint visible, so the
/// slot is a zero-content, accessibility-hidden keeper that preserves the row baseline without drawing a
/// panel. A friendly "no breadcrumb" message would drift from the source: top-level pages intentionally
/// render no trail (the DEBUG inspector shows that note for development visibility instead).
struct LayoutBreadcrumbsEmptySlot: View {
    var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .accessibilityHidden(true)
    }
}

#if DEBUG

    // MARK: - Sample data (DEBUG previews + view-composition tests)

    /// A small, representative slice of the real catalog the inspector exercises — a drive-detail chain, a
    /// deep replay chain, a top-level page, and an unknown route — plus the friendly override a loaded
    /// drive-detail page would push up (web override map; this value is sample DATA, an already-localized
    /// label a page registers, not surface copy).
    enum LayoutBreadcrumbsSampleData {
        static let drivePath = "/drives/4421"
        static let deepPath = "/drives/4421/replay"
        static let topLevelPath = "/vehicles"
        static let unknownPath = "/does-not-exist"

        /// The friendly override a loaded drive-detail page would register (web override map).
        static let driveOverride: BreadcrumbOverrideMap = ["/drives/:id": "Trip to office"]
    }

    /// One staged scenario the inspector renders — a path, the overrides in effect, and the i18n title
    /// that names the branch being demonstrated.
    enum LayoutBreadcrumbsScenario: String, CaseIterable, Identifiable {
        case nested
        case deep
        case overridden
        case suppressed
        case unknown

        var id: String {
            rawValue
        }

        var path: String {
            switch self {
            case .nested, .overridden: LayoutBreadcrumbsSampleData.drivePath
            case .deep: LayoutBreadcrumbsSampleData.deepPath
            case .suppressed: LayoutBreadcrumbsSampleData.topLevelPath
            case .unknown: LayoutBreadcrumbsSampleData.unknownPath
            }
        }

        var overrides: BreadcrumbOverrideMap {
            self == .overridden ? LayoutBreadcrumbsSampleData.driveOverride : [:]
        }

        var titleKey: String {
            "layoutBreadcrumbs.sample.scenario.\(rawValue)"
        }

        var titleFallback: String {
            switch self {
            case .nested: "Nested route (drive detail)"
            case .deep: "Deep route (trip replay)"
            case .overridden: "Override applied (drive detail)"
            case .suppressed: "Suppressed (top-level route)"
            case .unknown: "Unknown route (no trail)"
            }
        }
    }

    // MARK: - Inspector row (every branch rendered — never a blank box)

    /// One inspector row: the scenario title plus either the rendered trail or a friendly note for the
    /// branches the web composition draws nothing for (the suppressed single-item trail and the unknown
    /// route's empty trail). It resolves the trail through the pure projection over the REAL catalog, so
    /// the row faithfully mirrors what a live page would show.
    struct LayoutBreadcrumbsScenarioRow: View {
        let scenario: LayoutBreadcrumbsScenario

        private var resolved: BreadcrumbOverridesTrailResolved {
            LayoutBreadcrumbsProjection.resolve(path: scenario.path, overrides: scenario.overrides)
        }

        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: LayoutBreadcrumbsStrings.string(scenario.titleKey, scenario.titleFallback))
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                if resolved.isRendered {
                    BreadcrumbOverridesTrailView(items: resolved.items)
                } else {
                    note(for: resolved)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, TSSpacing.xs)
        }

        @ViewBuilder
        private func note(for resolved: BreadcrumbOverridesTrailResolved) -> some View {
            let key = resolved.isEmpty ? "layoutBreadcrumbs.sample.note.empty"
                : "layoutBreadcrumbs.sample.note.suppressed"
            let fallback = resolved.isEmpty ? "No breadcrumb — route not registered"
                : "Single item — breadcrumb hidden (top-level page)"
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: resolved.isEmpty ? "minus.circle" : "eye.slash")
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textMuted)
                Text(verbatim: LayoutBreadcrumbsStrings.string(key, fallback))
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
    }

    // MARK: - Live composite (the real LayoutBreadcrumbs view, previews + tests)

    /// The DEBUG live composite: a ``BreadcrumbOverridesProvider`` wrapping a page that registers the
    /// drive-detail override via ``SwiftUI/View/setBreadcrumbOverrides(_:)`` and the real
    /// ``LayoutBreadcrumbs`` row anchored at the drive-detail route, plus the inspector showing every
    /// scenario. It drives a fresh ``BreadcrumbOverridesStore`` so it never touches global state, and it
    /// proves the actual composition (env overrides + route model → trail) renders end-to-end.
    struct LayoutBreadcrumbsLiveSample: View {
        @State private var store = BreadcrumbOverridesStore()

        var body: some View {
            BreadcrumbOverridesProvider(store: store) {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    Color.clear
                        .frame(height: 0)
                        .setBreadcrumbOverrides(LayoutBreadcrumbsSampleData.driveOverride)
                    LayoutBreadcrumbs(pathname: LayoutBreadcrumbsSampleData.drivePath)
                    Divider().overlay(Color.TS.border)
                    ForEach(LayoutBreadcrumbsScenario.allCases) { scenario in
                        LayoutBreadcrumbsScenarioRow(scenario: scenario)
                        Divider().overlay(Color.TS.border)
                    }
                }
            }
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.bg)
        }
    }
#endif
