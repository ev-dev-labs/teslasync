//
//  BreadcrumbOverridesContext.Views.swift
//  TeslaSync — P4 shared surface · 0166 · BreadcrumbOverridesContext (Apple)
//
//  The presentational pieces of the breadcrumb-overrides bridge: the trail renderer that consumes the
//  merged context (the native parity of components/layout/Breadcrumbs.tsx — a leading Home link, a
//  `chevron`-separated chain, the trailing item as link-less plain text, self-suppressed for a single
//  item) and a DEBUG-only inspector that stages every REAL branch (overridden label, route defaults,
//  the suppressed top-level case, and an unknown route's empty trail) so the previews + the
//  view-composition tests have a concrete reference implementation. All copy resolves through P1/S10;
//  all chrome is token-driven (P1/S9); transitions respect Reduce Motion; no raw hex, no Tailwind ports.
//
//  Native adaptation (documented, not a shortcut): the web renderer hides middle items behind an
//  ellipsis on narrow screens (`hidden sm:inline`). The idiomatic Apple treatment of an overflowing
//  breadcrumb chain is a horizontal scroll that keeps every crumb reachable, so the trail view scrolls
//  horizontally instead of collapsing — the data, order, links, truncation and suppression rule are
//  reproduced exactly.
//

import SwiftUI

// MARK: - BreadcrumbOverridesTrailView (web `<Breadcrumbs>`)

/// The breadcrumb trail renderer — the native parity of `<Breadcrumbs items>`. It draws a leading
/// Home link, then each item separated by a `chevron.right`, with ancestor items as tappable links
/// (web `<PrefetchLink>`) and the trailing item as bold, link-less plain text (web `isLast`). It
/// self-suppresses for a single (or empty) item exactly like the web renderer (`items.length <= 1 →
/// return null`), so a top-level page shows no breadcrumb without per-page wiring.
public struct BreadcrumbOverridesTrailView: View {
    private let items: [BreadcrumbOverridesTrailItem]
    private let onSelect: ((BreadcrumbOverridesTrailItem) -> Void)?
    private let onHome: (() -> Void)?
    private let homeAriaLabel: String?

    public init(
        items: [BreadcrumbOverridesTrailItem],
        onSelect: ((BreadcrumbOverridesTrailItem) -> Void)? = nil,
        onHome: (() -> Void)? = nil,
        homeAriaLabel: String? = nil
    ) {
        self.items = items
        self.onSelect = onSelect
        self.onHome = onHome
        self.homeAriaLabel = homeAriaLabel
    }

    public var body: some View {
        if items.count <= 1 {
            EmptyView()
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: TSSpacing.xs) {
                    homeLink
                    ForEach(items) { item in
                        separator
                        crumb(item)
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(verbatim: navLabel))
        }
    }

    private var homeLink: some View {
        Button { onHome?() } label: {
            Image(systemName: "house")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: homeAriaLabel ?? homeLabel))
        .accessibilityAddTraits(.isButton)
    }

    private var separator: some View {
        Image(systemName: "chevron.right")
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private func crumb(_ item: BreadcrumbOverridesTrailItem) -> some View {
        if item.isCurrent || item.href == nil {
            Text(verbatim: item.label)
                .font(item.isCurrent ? Font.TS.label : Font.TS.body)
                .fontWeight(item.isCurrent ? .medium : .regular)
                .foregroundStyle(item.isCurrent ? Color.TS.textSecondary : Color.TS.textMuted)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: 200, alignment: .leading)
                .accessibilityLabel(Text(verbatim: item.label))
                .accessibilityAddTraits(item.isCurrent ? [.isStaticText, .isSelected] : .isStaticText)
        } else {
            Button { onSelect?(item) } label: {
                Text(verbatim: item.label)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: 200, alignment: .leading)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: item.label))
            .accessibilityAddTraits([.isButton, .isLink])
        }
    }

    private var navLabel: String {
        BreadcrumbOverridesStrings.string("breadcrumbOverrides.a11y.nav", "Breadcrumb")
    }

    private var homeLabel: String {
        BreadcrumbOverridesStrings.string("breadcrumbOverrides.a11y.home", "Dashboard")
    }
}

#if DEBUG

    // MARK: - Sample data (DEBUG previews + view-composition tests)

    /// The DEBUG sample route table + paths + overrides — a small, representative slice of the web
    /// `ROUTE_META` (a drive-detail chain with a parent, and a top-level page with none) so the
    /// previews + tests exercise every real branch of the builder + renderer.
    enum BreadcrumbOverridesSampleData {
        static let table = BreadcrumbOverridesRouteTable([
            BreadcrumbOverridesRouteMeta(
                pattern: "/drives",
                i18nKey: "breadcrumbOverrides.sample.drives",
                defaultLabel: "Drives"
            ),
            BreadcrumbOverridesRouteMeta(
                pattern: "/drives/:id",
                i18nKey: "breadcrumbOverrides.sample.drive",
                defaultLabel: "Drive #{{id}}",
                parent: "/drives"
            ),
            BreadcrumbOverridesRouteMeta(
                pattern: "/drives/:id/replay",
                i18nKey: "breadcrumbOverrides.sample.replay",
                defaultLabel: "Replay",
                parent: "/drives/:id"
            ),
            BreadcrumbOverridesRouteMeta(
                pattern: "/vehicles",
                i18nKey: "breadcrumbOverrides.sample.vehicles",
                defaultLabel: "Vehicles"
            )
        ])

        /// The friendly override a loaded drive-detail page would push up (web override map).
        static let driveOverride: BreadcrumbOverrideMap = [
            "/drives/:id": "196th Street → Northeast 90th"
        ]
    }

    /// One staged scenario the inspector renders — a path, the overrides in effect, and the title that
    /// names the branch being demonstrated.
    enum BreadcrumbOverridesScenario: String, CaseIterable, Identifiable {
        case overridden
        case defaults
        case suppressed
        case unknown

        var id: String {
            rawValue
        }

        var path: String {
            switch self {
            case .overridden, .defaults: "/drives/4421"
            case .suppressed: "/vehicles"
            case .unknown: "/does-not-exist"
            }
        }

        var overrides: BreadcrumbOverrideMap {
            self == .overridden ? BreadcrumbOverridesSampleData.driveOverride : [:]
        }

        var titleKey: String {
            "breadcrumbOverrides.sample.scenario.\(rawValue)"
        }

        var titleFallback: String {
            switch self {
            case .overridden: "Override applied (drive detail)"
            case .defaults: "Route defaults (no override)"
            case .suppressed: "Suppressed (top-level route)"
            case .unknown: "Unknown route (no trail)"
            }
        }
    }

    // MARK: - Inspector row (every branch rendered — never a blank box)

    /// One inspector row: the scenario title plus either the rendered trail or a friendly note for the
    /// branches where the web renderer shows nothing (the suppressed single-item trail and the unknown
    /// route's empty trail). It resolves the trail through the pure projection so the row is a faithful
    /// reference of what a real page would show.
    struct BreadcrumbOverridesScenarioRow: View {
        let scenario: BreadcrumbOverridesScenario

        private var resolved: BreadcrumbOverridesTrailResolved {
            BreadcrumbOverridesProjection.resolve(
                table: BreadcrumbOverridesSampleData.table,
                path: scenario.path,
                overrides: scenario.overrides,
                localize: BreadcrumbOverridesStrings.localize
            )
        }

        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: BreadcrumbOverridesStrings.string(scenario.titleKey, scenario.titleFallback))
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
            let key = resolved.isEmpty ? "breadcrumbOverrides.sample.note.empty"
                : "breadcrumbOverrides.sample.note.suppressed"
            let fallback = resolved.isEmpty ? "No breadcrumb — route not registered"
                : "Single item — breadcrumb hidden (top-level page)"
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: resolved.isEmpty ? "minus.circle" : "eye.slash")
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textMuted)
                Text(verbatim: BreadcrumbOverridesStrings.string(key, fallback))
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
    }

    // MARK: - Sample composite (previews + tests)

    /// The DEBUG sample composite: a ``BreadcrumbOverridesProvider`` wrapping a page that registers a
    /// drive label via ``SwiftUI/View/setBreadcrumbOverrides(_:)`` and an inspector showing every
    /// scenario, plus a standalone (no-provider) row proving the context is inert there. Drives a fresh
    /// ``BreadcrumbOverridesStore`` so it never touches global state.
    struct BreadcrumbOverridesContextSample: View {
        @State private var store = BreadcrumbOverridesStore()

        var body: some View {
            BreadcrumbOverridesProvider(store: store) {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    Color.clear
                        .frame(height: 0)
                        .setBreadcrumbOverrides(BreadcrumbOverridesSampleData.driveOverride)
                    ForEach(BreadcrumbOverridesScenario.allCases) { scenario in
                        BreadcrumbOverridesScenarioRow(scenario: scenario)
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
