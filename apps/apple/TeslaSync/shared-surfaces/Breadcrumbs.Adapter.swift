//
//  Breadcrumbs.Adapter.swift
//  TeslaSync — P4 shared surface · 0167 · Breadcrumbs (Apple)
//
//  The testable, dependency-light core for the breadcrumb trail — the SwiftUI parity of
//  components/layout/Breadcrumbs.tsx. The web source is a pure presentational component: it takes an
//  ordered `items: BreadcrumbItem[]` (`{ label, href? }`), self-suppresses for `items.length <= 1`
//  (`return null`), and otherwise draws a leading Home link followed by a `chevron`-separated chain where
//  the trailing item is bold link-less text and every ancestor is a link (when it carries an `href`). On a
//  narrow screen it hides the middle items behind an ellipsis (`hidden sm:inline` + `…`).
//
//  This file owns the pure, SwiftUI-free pieces the view is a function of — the diagnostics slug, the
//  input item model (the web `BreadcrumbItem`), the resolved display-crumb read-model, and the projection
//  that turns the input items + the current size class into the ordered crumbs to render. It is the
//  surface's data adapter in the "cached → projection" sense the acceptance calls for: the host's cached
//  items are projected into the exact crumbs `<Breadcrumbs>` would draw (suppression, current-leaf,
//  link-vs-text, and the compact collapse), so every branch is unit testable without a view or a network.
//
//  Faithful-parity note (documented, not a shortcut): `Breadcrumbs.tsx` performs NO fetch and reads NO
//  remote data — its only hook is `useTranslation` and its data arrives as props — so it has no loading /
//  error / stale / offline branches. Its REAL states are the ones it renders: a multi-item trail (regular
//  width), the same trail with the middle collapsed to a single ellipsis (compact width), a suppressed
//  single-item trail (`items.length <= 1 → null`), and an empty input. This surface reproduces exactly
//  those; inventing freshness chrome would contradict the source.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). The
/// web source is an anonymous presentational component; the prompt assigns this surface the canonical
/// slug `Breadcrumbs`, kept here (SwiftUI-free) so the state-holder can emit telemetry without depending
/// on the view layer.
public enum BreadcrumbsSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "Breadcrumbs"
}

// MARK: - BreadcrumbsItem (web `BreadcrumbItem`)

/// One breadcrumb input item — the native peer of the web `BreadcrumbItem { label: string; href?: string }`.
/// `href == nil` marks a non-navigable crumb (web "undefined = current page (no link)"); the trailing item
/// is treated as the current page regardless of its `href`, exactly like the web `isLast` branch.
public struct BreadcrumbsItem: Hashable, Sendable {
    /// The visible crumb text (web `item.label`).
    public let label: String
    /// The crumb's navigation target, or `nil` for a non-linked crumb (web `item.href`).
    public let href: String?

    public init(label: String, href: String? = nil) {
        self.label = label
        self.href = href
    }
}

// MARK: - BreadcrumbsCrumb (one rendered crumb — leaf-last, post collapse)

/// A single crumb to render, after the projection has applied the current-leaf rule and the compact
/// collapse — the unit the trail view iterates. A crumb is either a real `item` (carrying its resolved
/// label, optional link target, and whether it is the current page) or the collapsed `ellipsis` that
/// stands in for the hidden middle items on a narrow screen (web `…`).
public struct BreadcrumbsCrumb: Identifiable, Hashable, Sendable {
    /// The kind of crumb — a real item or the collapsed-middle ellipsis.
    public enum Kind: Hashable, Sendable {
        /// A real breadcrumb item. `href` is `nil` for the current leaf (web `isLast` → link-less text) and
        /// for an ancestor that carried no `href`; `isCurrent` drives the trailing-item emphasis.
        case item(label: String, href: String?, isCurrent: Bool)
        /// The collapsed-middle indicator shown on a compact width (web `…`, `aria-hidden`).
        case ellipsis
    }

    /// A stable identity for `ForEach` — the item's original index, or ``BreadcrumbsProjection/ellipsisID``
    /// for the collapsed ellipsis (the web list keys by index, `key={i}`).
    public let id: Int
    public let kind: Kind

    public init(id: Int, kind: Kind) {
        self.id = id
        self.kind = kind
    }

    /// The crumb's visible label, or `nil` for the ellipsis.
    public var label: String? {
        if case let .item(label, _, _) = kind { return label }
        return nil
    }

    /// The crumb's link target, or `nil` for the current leaf, a link-less ancestor, or the ellipsis.
    public var href: String? {
        if case let .item(_, href, _) = kind { return href }
        return nil
    }

    /// `true` for the trailing current-page crumb (web `isLast`) — bold, link-less text.
    public var isCurrent: Bool {
        if case let .item(_, _, isCurrent) = kind { return isCurrent }
        return false
    }

    /// `true` for the collapsed-middle ellipsis (web `…`).
    public var isEllipsis: Bool {
        if case .ellipsis = kind { return true }
        return false
    }

    /// `true` when the crumb renders as a tappable link — an ancestor that carries an `href` (web
    /// `!isLast && item.href` → `<PrefetchLink>`).
    public var isLink: Bool {
        href != nil && !isCurrent
    }
}

// MARK: - BreadcrumbsResolved (web useTranslation-only render decision)

/// The resolved, view-ready projection of the breadcrumb input — the native peer of the decision
/// `<Breadcrumbs>` makes from its `items` prop. `crumbs` is the ordered, leaf-last list to draw (already
/// collapsed for the active size class); `isSuppressed` mirrors `items.length <= 1 → return null` (a
/// top-level page renders no breadcrumb); `current` is the trailing leaf.
public struct BreadcrumbsResolved: Sendable, Equatable {
    /// The crumbs to render, leaf-last and post-collapse. Empty when the trail self-suppresses.
    public let crumbs: [BreadcrumbsCrumb]
    /// The original input item count (web `items.length`) — the suppression input, preserved so the empty
    /// and single-item branches stay distinguishable for diagnostics + the DEBUG inspector.
    public let itemCount: Int

    public init(crumbs: [BreadcrumbsCrumb], itemCount: Int) {
        self.crumbs = crumbs
        self.itemCount = itemCount
    }

    /// `true` when `<Breadcrumbs>` would render nothing — a single-item (or empty) trail, the case it
    /// self-suppresses (web `if (items.length <= 1) return null`).
    public var isSuppressed: Bool {
        itemCount <= 1
    }

    /// `true` when the trail actually renders — more than one input item (web renders the `<nav>`).
    public var isRendered: Bool {
        !isSuppressed
    }

    /// `true` when the input carried no items at all — distinct from the single-item top-level case for
    /// the DEBUG inspector's friendly note (both render nothing).
    public var isEmpty: Bool {
        itemCount == 0
    }

    /// `true` when the middle crumbs were collapsed to a single ellipsis for a compact width (web mobile).
    public var isCollapsed: Bool {
        crumbs.contains { $0.isEllipsis }
    }

    /// The number of crumbs actually drawn (post-collapse).
    public var count: Int {
        crumbs.count
    }

    /// The trailing current-page crumb — link-less emphasized text (web `isLast`).
    public var current: BreadcrumbsCrumb? {
        crumbs.last { $0.isCurrent }
    }

    /// The suppressed result for `<= 1` input items — the native peer of the web `null`.
    public static let suppressed = BreadcrumbsResolved(crumbs: [], itemCount: 0)
}

// MARK: - BreadcrumbsProjection (cached items + size class → display crumbs)

/// Pure projection from the cached input items + the active horizontal size class to the ordered crumbs
/// the trail view draws — the native port of the body of `<Breadcrumbs>`. It applies the suppression rule
/// (`items.length <= 1 → []`), the current-leaf rule (the trailing item is link-less, web `isLast`), and
/// the compact collapse (the middle items fold into one ellipsis on a narrow width, web `hidden sm:inline`
/// + `…`). The view is a pure function of this output; every branch is unit tested.
public enum BreadcrumbsProjection {
    /// The synthetic id of the collapsed-middle ellipsis crumb — outside the real `0..<count` index range
    /// so it never collides with an item's index identity.
    public static let ellipsisID = -1

    /// Projects the input items into the resolved render decision for the active size class.
    public static func resolve(items: [BreadcrumbsItem], isCompact: Bool) -> BreadcrumbsResolved {
        BreadcrumbsResolved(crumbs: displayCrumbs(items: items, isCompact: isCompact), itemCount: items.count)
    }

    /// Builds the ordered, leaf-last crumbs to draw. Returns `[]` for a self-suppressed trail
    /// (`items.length <= 1`). On a compact width with at least one middle item, the middle is collapsed
    /// into a single ellipsis between the first crumb and the current leaf (the idiomatic Apple peer of the
    /// web hiding every middle item behind `…`); otherwise every crumb is shown in order.
    public static func displayCrumbs(items: [BreadcrumbsItem], isCompact: Bool) -> [BreadcrumbsCrumb] {
        guard items.count > 1 else { return [] }
        let lastIndex = items.count - 1
        let hasMiddle = items.count > 2
        if isCompact, hasMiddle {
            return [
                crumb(items[0], at: 0, isCurrent: false),
                BreadcrumbsCrumb(id: ellipsisID, kind: .ellipsis),
                crumb(items[lastIndex], at: lastIndex, isCurrent: true)
            ]
        }
        return items.enumerated().map { offset, item in
            crumb(item, at: offset, isCurrent: offset == lastIndex)
        }
    }

    /// Maps one input item to a render crumb. The current (trailing) item is link-less plain text in the
    /// web renderer (`isLast` → `<span>`), so its `href` is dropped; an ancestor keeps its `href` when
    /// present (web renders a link only `if (!isLast && item.href)`, else a plain `<span>`).
    private static func crumb(_ item: BreadcrumbsItem, at index: Int, isCurrent: Bool) -> BreadcrumbsCrumb {
        let href = isCurrent ? nil : item.href
        return BreadcrumbsCrumb(id: index, kind: .item(label: item.label, href: href, isCurrent: isCurrent))
    }
}
