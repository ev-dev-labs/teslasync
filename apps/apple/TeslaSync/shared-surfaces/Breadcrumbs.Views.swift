//
//  Breadcrumbs.Views.swift
//  TeslaSync — P4 shared surface · 0167 · Breadcrumbs (Apple)
//
//  The presentational pieces of the breadcrumb trail: the trail renderer (the native parity of the body of
//  components/layout/Breadcrumbs.tsx — a leading Home link, a `chevron`-separated chain, ancestor crumbs as
//  links and the trailing crumb as bold link-less text), the empty slot (the faithful peer of the web
//  `return null`), and a DEBUG-only inspector that stages every REAL branch (a rendered trail, a deep
//  trail, the same deep trail collapsed for a compact width, a suppressed single-item trail, and an empty
//  input) so the previews + view-composition tests have a concrete reference. All copy resolves through
//  P1/S10; all chrome is token-driven (P1/S9); no raw hex, no Tailwind ports.
//
//  Native adaptation (documented, not a shortcut): the web renderer hides middle items behind an ellipsis
//  on narrow screens (`hidden sm:inline` + one `…` per hidden item). The idiomatic Apple treatment is a
//  single collapsed `…` between the first crumb and the current leaf on a compact width (decided by the
//  pure ``BreadcrumbsProjection``), wrapped in a horizontal scroll so an overflowing chain on any width
//  stays fully reachable. The data, order, links, current-leaf emphasis, truncation and suppression rule
//  are reproduced exactly. There is no motion to gate for Reduce Motion — the web only animates a CSS hover
//  color (`transition-colors`), which has no native peer.
//

import SwiftUI

// MARK: - BreadcrumbsTrailView (web `<nav>` body)

/// The breadcrumb trail renderer — the native parity of the `<Breadcrumbs>` `<nav>` body. It draws a
/// leading Home button, then each crumb separated by a `chevron.right`, with ancestor crumbs as tappable
/// links (web `<PrefetchLink>`), the trailing crumb as bold link-less text (web `isLast`), and a collapsed
/// `…` for the hidden middle on a compact width. The whole chain scrolls horizontally so it never clips.
struct BreadcrumbsTrailView: View {
    let resolved: BreadcrumbsResolved
    let homeAccessibilityLabel: String?
    let onSelect: (BreadcrumbsCrumb) -> Void
    let onHome: () -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TSSpacing.xs) {
                homeLink
                ForEach(resolved.crumbs) { crumb in
                    separator
                    crumbView(crumb)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: BreadcrumbsStrings.navLabel))
    }

    /// The leading Home link (web `<PrefetchLink to={homeHref}>` wrapping the `Home` glyph).
    private var homeLink: some View {
        Button { onHome() } label: {
            Image(systemName: "house")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: homeAccessibilityLabel ?? BreadcrumbsStrings.homeLabel))
        .accessibilityAddTraits([.isButton, .isLink])
    }

    /// The inter-crumb chevron (web `<ChevronRight>`), decorative for VoiceOver.
    private var separator: some View {
        Image(systemName: "chevron.right")
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityHidden(true)
    }

    /// One crumb — a link-less leaf / plain crumb, a tappable ancestor link, or the collapsed ellipsis.
    @ViewBuilder
    private func crumbView(_ crumb: BreadcrumbsCrumb) -> some View {
        switch crumb.kind {
        case .ellipsis:
            ellipsis
        case let .item(label, href, isCurrent):
            if isCurrent || href == nil {
                staticCrumb(label, isCurrent: isCurrent)
            } else {
                linkCrumb(crumb, label: label)
            }
        }
    }

    /// The collapsed-middle indicator (web `…`, `aria-hidden`).
    private var ellipsis: some View {
        Text(verbatim: "…")
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityHidden(true)
    }

    /// A link-less crumb — the current leaf (bold, secondary) or a plain ancestor with no `href` (muted).
    /// Web `isLast ? text-secondary font-medium : text-muted`, both `truncate max-w-[200px]`.
    private func staticCrumb(_ label: String, isCurrent: Bool) -> some View {
        Text(verbatim: label)
            .font(Font.TS.body)
            .fontWeight(isCurrent ? .medium : .regular)
            .foregroundStyle(isCurrent ? Color.TS.textSecondary : Color.TS.textMuted)
            .lineLimit(1)
            .truncationMode(.tail)
            .frame(maxWidth: 200, alignment: .leading)
            .accessibilityLabel(Text(verbatim: label))
            .accessibilityAddTraits(isCurrent ? [.isStaticText, .isSelected] : .isStaticText)
    }

    /// A tappable ancestor crumb (web `<PrefetchLink to={item.href}>`, `text-muted truncate max-w-[200px]`).
    private func linkCrumb(_ crumb: BreadcrumbsCrumb, label: String) -> some View {
        Button { onSelect(crumb) } label: {
            Text(verbatim: label)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: 200, alignment: .leading)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityAddTraits([.isButton, .isLink])
    }
}

// MARK: - BreadcrumbsEmptySlot (web `return null`)

/// The empty breadcrumb slot — the faithful native peer of `<Breadcrumbs>` returning `null` for a `<= 1`
/// item input. A surrounding header keeps its baseline without drawing a panel, so the slot is a
/// zero-content, accessibility-hidden keeper. A "no breadcrumb" message would drift from the source:
/// top-level pages intentionally render no trail (the DEBUG inspector shows that note for development
/// visibility instead).
struct BreadcrumbsEmptySlot: View {
    var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .accessibilityHidden(true)
    }
}

#if DEBUG

    // MARK: - Sample data (DEBUG previews + view-composition tests)

    /// A small, representative slice of trails the inspector exercises — a normal nested trail, a deep
    /// trail (multiple ancestors, used to show the compact collapse), a single-item top-level trail, and an
    /// empty input — so the previews + tests exercise every real branch of the projection + renderer.
    enum BreadcrumbsSampleData {
        static let nested: [BreadcrumbsItem] = [
            BreadcrumbsItem(label: "Vehicles", href: "/vehicles"),
            BreadcrumbsItem(label: "Model 3", href: "/vehicles/7"),
            BreadcrumbsItem(label: "Battery Health")
        ]

        static let deep: [BreadcrumbsItem] = [
            BreadcrumbsItem(label: "Drives", href: "/drives"),
            BreadcrumbsItem(label: "Drive Detail", href: "/drives/4421"),
            BreadcrumbsItem(label: "Trip Replay", href: "/drives/4421/replay"),
            BreadcrumbsItem(label: "Segment 3")
        ]

        static let topLevel: [BreadcrumbsItem] = [
            BreadcrumbsItem(label: "Dashboard")
        ]

        static let empty: [BreadcrumbsItem] = []
    }

    /// One staged scenario the inspector renders — the input items, the width it is resolved for, and the
    /// i18n title that names the branch being demonstrated.
    enum BreadcrumbsScenario: String, CaseIterable, Identifiable {
        case rendered
        case deep
        case collapsed
        case suppressed
        case empty

        var id: String {
            rawValue
        }

        var items: [BreadcrumbsItem] {
            switch self {
            case .rendered: BreadcrumbsSampleData.nested
            case .deep, .collapsed: BreadcrumbsSampleData.deep
            case .suppressed: BreadcrumbsSampleData.topLevel
            case .empty: BreadcrumbsSampleData.empty
            }
        }

        var isCompact: Bool {
            self == .collapsed
        }

        var titleKey: String {
            "breadcrumbs.sample.scenario.\(rawValue)"
        }

        var titleFallback: String {
            switch self {
            case .rendered: "Rendered trail (nested route)"
            case .deep: "Deep trail (regular width)"
            case .collapsed: "Collapsed trail (compact width)"
            case .suppressed: "Suppressed (top-level page)"
            case .empty: "Empty (no items)"
            }
        }
    }

    // MARK: - Inspector row (every branch rendered — never a blank box)

    /// One inspector row: the scenario title plus either the rendered trail or a friendly note for the
    /// branches the web component draws nothing for (the suppressed single-item trail and the empty input).
    /// It resolves through the pure projection, so the row faithfully mirrors what a live page would show.
    struct BreadcrumbsScenarioRow: View {
        let scenario: BreadcrumbsScenario

        private var resolved: BreadcrumbsResolved {
            BreadcrumbsProjection.resolve(items: scenario.items, isCompact: scenario.isCompact)
        }

        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: BreadcrumbsStrings.string(scenario.titleKey, scenario.titleFallback))
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                if resolved.isRendered {
                    BreadcrumbsTrailView(
                        resolved: resolved,
                        homeAccessibilityLabel: nil,
                        onSelect: { _ in },
                        onHome: {}
                    )
                } else {
                    note(for: resolved)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, TSSpacing.xs)
        }

        @ViewBuilder
        private func note(for resolved: BreadcrumbsResolved) -> some View {
            let key = resolved.isEmpty ? "breadcrumbs.sample.note.empty" : "breadcrumbs.sample.note.suppressed"
            let fallback = resolved.isEmpty
                ? "No breadcrumb — empty trail"
                : "Single item — breadcrumb hidden (top-level page)"
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: resolved.isEmpty ? "minus.circle" : "eye.slash")
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textMuted)
                Text(verbatim: BreadcrumbsStrings.string(key, fallback))
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
    }

    // MARK: - Sample composite (previews + tests)

    /// The DEBUG sample composite: the real ``Breadcrumbs`` view fed the nested trail, then the inspector
    /// staging every scenario. It proves the actual composition renders end-to-end and gives the previews +
    /// view-composition tests a single entry point.
    struct BreadcrumbsSample: View {
        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                Breadcrumbs(items: BreadcrumbsSampleData.nested)
                Divider().overlay(Color.TS.border)
                ForEach(BreadcrumbsScenario.allCases) { scenario in
                    BreadcrumbsScenarioRow(scenario: scenario)
                    Divider().overlay(Color.TS.border)
                }
            }
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.bg)
        }
    }
#endif
