//
//  BreadcrumbOverridesContext.Adapter.swift
//  TeslaSync — P4 shared surface · 0166 · BreadcrumbOverridesContext (Apple)
//
//  The testable, dependency-light core for the breadcrumb-overrides bridge — the SwiftUI parity of
//  components/layout/BreadcrumbOverridesContext.tsx plus the trail consumer it feeds
//  (hooks/useBreadcrumbs.ts) and the renderer that draws the result (components/layout/Breadcrumbs.tsx).
//  The web source is a coordination primitive, not a visual component: a React context whose provider
//  collects per-render label overrides keyed by route pattern (e.g. `/drives/:id` → "Trip to office")
//  from every mounted page and merges them so the single global Layout breadcrumb can show rich,
//  friendly labels. `Layout` reads `useBreadcrumbOverrides()` and forwards the merged map into
//  `useBreadcrumbs(overrides)`, which walks the route table to build the trail `<Breadcrumbs>` renders.
//
//  This file is the Foundation-only heart of the native peer:
//    • the surface slug (P1/S11 diagnostics),
//    • `BreadcrumbOverrideMap` + `BreadcrumbOverridesReducer` — the verbatim port of the provider's
//      merge memo (later registration wins per route key, empty labels dropped) plus the JSON-stable
//      signature `useSetBreadcrumbOverrides` compares to avoid re-registering identical content,
//    • `BreadcrumbOverridesRouteMeta` / `RouteTable` — the native peer of `ROUTE_META` (the i18n key,
//      the English fallback label, the optional parent pattern), kept ORDERED so "first pattern that
//      matches" is deterministic (web iterates `Object.keys(ROUTE_META)` in insertion order),
//    • `BreadcrumbOverridesPathMatch` — the `:param` segment matcher (web `matchPath({ end: true })`),
//    • `BreadcrumbOverridesTrailItem` + `BreadcrumbOverridesTrailBuilder` — the port of
//      `useBreadcrumbs`: match the path, walk the parent chain (cycle-broken), resolve each label
//      (override > i18n > default), substitute `{{param}}` in labels and `:param` in hrefs, and emit
//      the trailing item as plain text (no href).
//
//  No SwiftUI, no @Observable store, no networking — every branch is unit testable in isolation. The
//  i18n lookup is injected as a closure so the builder stays Foundation-only and the tests stay
//  deterministic; the live `@Observable` store + the provider live in the Model / view files.
//
//  Faithful-parity note: the web source performs NO fetch and reads NO remote data — the overrides
//  live entirely in React state for the life of the Layout provider — so it has no loading / error /
//  stale / offline branches. Its REAL branches are: inside vs. outside a provider (merged map vs.
//  `{}`), the override map empty vs. non-empty, multiple page registrations merged (later wins), and
//  on the trail it feeds: a matched route vs. an unknown one (`[]`), a suppressed single-item trail
//  vs. a rendered multi-item one, and an overridden label vs. the route default. This surface
//  reproduces exactly those — inventing loading/error chrome would contradict the source.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// The web source is anonymous (it has no slug of its own); the prompt assigns this surface the
/// canonical slug `BreadcrumbOverridesContext`, kept here (SwiftUI-free) so the state-holder can emit
/// telemetry without depending on the view layer.
public enum BreadcrumbOverridesSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "BreadcrumbOverridesContext"
}

// MARK: - BreadcrumbOverrideMap (web `BreadcrumbOverrideMap`)

/// A map of route pattern → friendly label — the native peer of the web
/// `type BreadcrumbOverrideMap = Partial<Record<string, string>>`. Keys are route patterns
/// (`/drives/:id`); values are the human label a page wants the global breadcrumb to show for that
/// route on this render (`"196th Street → Northeast 90th"`).
public typealias BreadcrumbOverrideMap = [String: String]

/// The i18n lookup the trail builder uses to resolve a route's label when no override is supplied —
/// `(key, fallback) -> String`, the native peer of `t(meta.i18nKey, meta.defaultLabel)`. Injected so
/// the builder stays Foundation-only and deterministic in tests (pass `{ _, fallback in fallback }`).
/// `@Sendable` so it crosses isolation boundaries cleanly under Swift 6 strict concurrency.
public typealias BreadcrumbOverridesLocalize = @Sendable (String, String) -> String

// MARK: - BreadcrumbOverridesReducer (web provider merge memo + useSetBreadcrumbOverrides signature)

/// The pure merge + signature semantics behind the provider — kept as pure functions over
/// caller-owned maps so the rules are unit tested without an `@Observable` store or a React tree.
public enum BreadcrumbOverridesReducer {
    /// Drops empty-valued keys from a single registration — the parity of the provider memo's
    /// `if (v) merged[k] = v` guard (a page registering `{ '/x': '' }` contributes nothing).
    public static func sanitize(_ map: BreadcrumbOverrideMap) -> BreadcrumbOverrideMap {
        map.filter { !$0.value.isEmpty }
    }

    /// Merges every registration into one override map — the verbatim port of the provider's
    /// `overrides` memo. Registrations are merged in ascending registration-id order, which equals the
    /// web `Map` insertion order (ids are monotonically increasing, web `nextId++`), so a LATER
    /// registration wins for the same route key (matching React's latest-effect-wins semantics).
    /// Empty labels are dropped (web `if (v)`).
    public static func merge(_ registrations: [Int: BreadcrumbOverrideMap]) -> BreadcrumbOverrideMap {
        var merged: BreadcrumbOverrideMap = [:]
        for id in registrations.keys.sorted() {
            guard let map = registrations[id] else { continue }
            for (key, value) in map where !value.isEmpty {
                merged[key] = value
            }
        }
        return merged
    }

    /// A canonical, content-stable signature for a registration map — the native peer of the web
    /// `JSON.stringify(map)` that `useSetBreadcrumbOverrides` compares so passing a fresh literal with
    /// identical content does NOT re-register. Keys are sorted so `{a,b}` and `{b,a}` collapse to one
    /// signature; the unit separators are control chars no route key or label contains.
    public static func signature(_ map: BreadcrumbOverrideMap) -> String {
        sanitize(map)
            .sorted { $0.key < $1.key }
            .map { "\($0.key)\u{1}\($0.value)" }
            .joined(separator: "\u{2}")
    }

    /// `true` when two maps carry identical content (order-independent) — web `serialised === prev`.
    public static func areEquivalent(_ lhs: BreadcrumbOverrideMap, _ rhs: BreadcrumbOverrideMap) -> Bool {
        signature(lhs) == signature(rhs)
    }
}

// MARK: - BreadcrumbOverridesRouteMeta / RouteTable (web ROUTE_META)

/// One route's breadcrumb metadata — the native peer of a `ROUTE_META` entry: the route `pattern`
/// (the keying string `/drives/:id`), the `i18nKey` for its label, the English `defaultLabel` used as
/// the i18n fallback, and the optional `parent` pattern the trail walks up to compose the chain.
public struct BreadcrumbOverridesRouteMeta: Sendable, Equatable {
    public let pattern: String
    public let i18nKey: String
    public let defaultLabel: String
    public let parent: String?

    public init(pattern: String, i18nKey: String, defaultLabel: String, parent: String? = nil) {
        self.pattern = pattern
        self.i18nKey = i18nKey
        self.defaultLabel = defaultLabel
        self.parent = parent
    }
}

/// The ordered route table — the native peer of `ROUTE_META`. It keeps the entries in declaration
/// order so `firstMatch(path:)` resolves "the first registered pattern that matches" deterministically
/// (web iterates `Object.keys(ROUTE_META)`), and indexes them by pattern for the O(1) parent walk
/// (web `ROUTE_META[current]`).
public struct BreadcrumbOverridesRouteTable: Sendable {
    public let entries: [BreadcrumbOverridesRouteMeta]
    private let byPattern: [String: BreadcrumbOverridesRouteMeta]

    public init(_ entries: [BreadcrumbOverridesRouteMeta]) {
        self.entries = entries
        byPattern = Dictionary(entries.map { ($0.pattern, $0) }, uniquingKeysWith: { first, _ in first })
    }

    /// The metadata for an exact pattern key — web `ROUTE_META[current]`.
    public func meta(for pattern: String) -> BreadcrumbOverridesRouteMeta? {
        byPattern[pattern]
    }

    /// The first registered pattern that matches a concrete path — web's `Object.keys(ROUTE_META)`
    /// iteration that picks the first `matchPath({ end: true })`. `nil` for unknown / chrome-less routes.
    public func firstMatch(path: String) -> BreadcrumbOverridesRouteMeta? {
        entries.first { BreadcrumbOverridesPathMatch.matches(pattern: $0.pattern, path: path) }
    }
}

// MARK: - BreadcrumbOverridesPathMatch (web matchPath, end: true)

/// The `:param` segment matcher — the native peer of `matchPath({ path: pattern, end: true }, path)`.
/// A pattern segment beginning with `:` captures the concrete path segment under its name; every other
/// segment must match literally; the segment counts must be equal (a full, `end: true` match). Leading
/// / trailing slashes are normalized so `/drives/` and `/drives` match the same pattern.
public enum BreadcrumbOverridesPathMatch {
    /// Splits a URL path / route pattern into its non-empty segments (normalizing slashes).
    public static func segments(_ value: String) -> [Substring] {
        value.split(separator: "/", omittingEmptySubsequences: true)
    }

    /// `true` when `path` fully matches `pattern` (web `matchPath({ end: true })`).
    public static func matches(pattern: String, path: String) -> Bool {
        params(pattern: pattern, path: path) != nil
    }

    /// The captured `:param` values when `path` matches `pattern`, else `nil` — the native peer of
    /// the `params` `matchPath` returns (and `useParams()` exposes). The root pattern `/` matches the
    /// root path with no params.
    public static func params(pattern: String, path: String) -> [String: String]? {
        let patternSegments = segments(pattern)
        let pathSegments = segments(path)
        guard patternSegments.count == pathSegments.count else { return nil }

        var captured: [String: String] = [:]
        for (patternSegment, pathSegment) in zip(patternSegments, pathSegments) {
            if patternSegment.hasPrefix(":") {
                guard !pathSegment.isEmpty else { return nil }
                captured[String(patternSegment.dropFirst())] = String(pathSegment)
            } else if patternSegment != pathSegment {
                return nil
            }
        }
        return captured
    }
}

// MARK: - BreadcrumbOverridesTrailItem (web BreadcrumbItem)

/// One breadcrumb in the resolved trail — the native peer of the web `BreadcrumbItem`: a `label` plus
/// an optional `href` (`nil` = the current page, rendered as plain text with no link). `isCurrent`
/// flags the trailing item so the view can render it as the bold, link-less leaf (web `isLast`).
public struct BreadcrumbOverridesTrailItem: Identifiable, Hashable, Sendable {
    public let pattern: String
    public let label: String
    public let href: String?
    public let isCurrent: Bool

    /// Stable identity for `ForEach` — the resolved route pattern (unique within one trail).
    public var id: String {
        pattern
    }

    public init(pattern: String, label: String, href: String?, isCurrent: Bool) {
        self.pattern = pattern
        self.label = label
        self.href = href
        self.isCurrent = isCurrent
    }
}

// MARK: - BreadcrumbOverridesTrailBuilder (web useBreadcrumbs)

/// The pure trail builder — the verbatim port of `useBreadcrumbs(overrides)`. Given the route table,
/// the current path and the merged override map, it matches the path, walks the parent chain (with the
/// same defensive cycle-break the web hook carries), resolves each label (page override > i18n key >
/// default), substitutes `{{param}}` markers in labels and `:param` markers in hrefs, and
/// returns the trail leaf-last with the trailing item as link-less plain text. An unknown route yields
/// an empty trail (web `if (!matchedPattern) return []`).
public enum BreadcrumbOverridesTrailBuilder {
    /// Builds the breadcrumb trail for a path. `localize` resolves a route's label from its i18n key
    /// with the English fallback (web `t(meta.i18nKey, meta.defaultLabel)`); tests pass a fallback-only
    /// closure for determinism.
    public static func build(
        table: BreadcrumbOverridesRouteTable,
        path: String,
        overrides: BreadcrumbOverrideMap,
        localize: BreadcrumbOverridesLocalize
    ) -> [BreadcrumbOverridesTrailItem] {
        guard let matched = table.firstMatch(path: path) else { return [] }
        let params = BreadcrumbOverridesPathMatch.params(pattern: matched.pattern, path: path) ?? [:]

        var items: [BreadcrumbOverridesTrailItem] = []
        var visited: Set<String> = []
        var current: String? = matched.pattern

        while let pattern = current {
            if visited.contains(pattern) { break }
            visited.insert(pattern)
            guard let meta = table.meta(for: pattern) else { break }

            let isCurrent = pattern == matched.pattern
            items.insert(
                item(for: meta, isCurrent: isCurrent, overrides: overrides, params: params, localize: localize),
                at: 0
            )
            current = meta.parent
        }
        return items
    }

    /// Resolves one route's trail item — label (override > i18n > default) with `{{param}}` filled in,
    /// and the href (`nil` for the current leaf, else the pattern with `:param` filled in).
    private static func item(
        for meta: BreadcrumbOverridesRouteMeta,
        isCurrent: Bool,
        overrides: BreadcrumbOverrideMap,
        params: [String: String],
        localize: BreadcrumbOverridesLocalize
    ) -> BreadcrumbOverridesTrailItem {
        let base = overrides[meta.pattern] ?? localize(meta.i18nKey, meta.defaultLabel)
        let label = fill(base, params: params, token: { "{{\($0)}}" })
        let href = isCurrent ? nil : fill(meta.pattern, params: params, token: { ":\($0)" })
        return BreadcrumbOverridesTrailItem(pattern: meta.pattern, label: label, href: href, isCurrent: isCurrent)
    }

    /// Substitutes every `param` into `value` at the marker the `token` builder produces — web
    /// `label.replace('{{key}}', value)` for labels and `href.replace(':key', value)` for hrefs.
    private static func fill(
        _ value: String,
        params: [String: String],
        token: (String) -> String
    ) -> String {
        var result = value
        for (key, paramValue) in params where !paramValue.isEmpty {
            result = result.replacingOccurrences(of: token(key), with: paramValue)
        }
        return result
    }
}
