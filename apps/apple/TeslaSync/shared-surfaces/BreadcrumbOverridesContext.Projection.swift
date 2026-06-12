//
//  BreadcrumbOverridesContext.Projection.swift
//  TeslaSync — P4 shared surface · 0166 · BreadcrumbOverridesContext (Apple)
//
//  The pure projection from the cached coordination state (the merged override map + the current
//  route) to the resolved, view-ready trail every consumer reads — the native port of what
//  `useBreadcrumbs(useBreadcrumbOverrides())` returns and what `<Breadcrumbs>` renders. The view is a
//  pure function of this value; every branch is unit tested.
//
//  This is the surface's data adapter in the "cached → projection" sense the acceptance calls for: it
//  takes the cached overrides for the active provider plus the current path, runs them through
//  ``BreadcrumbOverridesTrailBuilder``, and derives the trail, whether it suppresses itself (web
//  `<Breadcrumbs>` returns `null` for `<= 1` item), the current leaf, and how many overrides actually
//  landed — collapsing the matched / unknown and single / multi-item branches exactly as the web hook
//  + renderer do.
//

import Foundation

// MARK: - Resolved read-model (web useBreadcrumbs return + Breadcrumbs render decision)

/// The resolved, view-ready projection of the breadcrumb trail — the native peer of the web
/// `useBreadcrumbs` return value plus the `<Breadcrumbs>` self-suppression rule. `items` mirrors the
/// hook output (leaf-last); `isSuppressed` mirrors `<Breadcrumbs>`' `items.length <= 1 → return null`
/// (top-level pages render no breadcrumb without per-page wiring); `current` is the trailing leaf; and
/// `overrideCount` reports how many of the merged overrides actually matched a route in the trail.
public struct BreadcrumbOverridesTrailResolved: Sendable, Equatable {
    /// The breadcrumb items, leaf-last (web `useBreadcrumbs` output).
    public let items: [BreadcrumbOverridesTrailItem]
    /// How many merged overrides landed on a route present in this trail (diagnostics / inspector).
    public let appliedOverrideCount: Int

    public init(items: [BreadcrumbOverridesTrailItem], appliedOverrideCount: Int) {
        self.items = items
        self.appliedOverrideCount = appliedOverrideCount
    }

    /// `true` when the route matched nothing — an unknown / chrome-less route (web `[]`).
    public var isEmpty: Bool {
        items.isEmpty
    }

    /// `true` when `<Breadcrumbs>` would render nothing — a single-item (or empty) trail, the
    /// top-level-page case it self-suppresses (web `if (items.length <= 1) return null`).
    public var isSuppressed: Bool {
        items.count <= 1
    }

    /// `true` when the trail actually renders — more than one item (web renders the `<nav>`).
    public var isRendered: Bool {
        !isSuppressed
    }

    /// The number of breadcrumb items (web `items.length`).
    public var count: Int {
        items.count
    }

    /// The trailing (current-page) leaf — link-less plain text in the view (web `isLast`).
    public var current: BreadcrumbOverridesTrailItem? {
        items.last
    }

    /// The linked ancestor items (everything but the current leaf) — web items with an `href`.
    public var ancestors: [BreadcrumbOverridesTrailItem] {
        items.dropLast().map(\.self)
    }

    /// The empty trail — an unknown route / no breadcrumb (web `[]`).
    public static let empty = BreadcrumbOverridesTrailResolved(items: [], appliedOverrideCount: 0)
}

// MARK: - Projection (cached overrides + route → resolved trail)

/// Pure projection from the cached coordination state to the resolved trail. `resolve(table:path:
/// overrides:localize:)` builds the trail through ``BreadcrumbOverridesTrailBuilder`` (web
/// `useBreadcrumbs(overrides)`) and counts how many overrides matched a route the trail contains, so
/// the inspector / diagnostics can show "2 of 3 page overrides applied" without re-deriving the trail.
public enum BreadcrumbOverridesProjection {
    /// Projects the route table + current path + merged overrides into the resolved trail (web
    /// `useBreadcrumbs(useBreadcrumbOverrides())` + `<Breadcrumbs>` suppression).
    public static func resolve(
        table: BreadcrumbOverridesRouteTable,
        path: String,
        overrides: BreadcrumbOverrideMap,
        localize: BreadcrumbOverridesLocalize
    ) -> BreadcrumbOverridesTrailResolved {
        let items = BreadcrumbOverridesTrailBuilder.build(
            table: table,
            path: path,
            overrides: overrides,
            localize: localize
        )
        let patterns = Set(items.map(\.pattern))
        let applied = BreadcrumbOverridesReducer.sanitize(overrides).keys.count(where: { patterns.contains($0) })
        return BreadcrumbOverridesTrailResolved(items: items, appliedOverrideCount: applied)
    }

    /// Projects an already-built trail (the live path, where the items are computed once and reused).
    public static func resolve(
        items: [BreadcrumbOverridesTrailItem],
        appliedOverrideCount: Int
    ) -> BreadcrumbOverridesTrailResolved {
        BreadcrumbOverridesTrailResolved(items: items, appliedOverrideCount: appliedOverrideCount)
    }
}
