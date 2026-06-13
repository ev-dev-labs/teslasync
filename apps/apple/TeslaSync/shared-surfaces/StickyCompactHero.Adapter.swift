//
//  StickyCompactHero.Adapter.swift
//  TeslaSync — P4 shared surface · 0201 · StickyCompactHero (Apple)
//
//  The testable, dependency-light core for the collapsed-on-scroll hero bar — the SwiftUI parity of
//  `components/status/StickyCompactHero.tsx`. The web source is a pure presentational component (it fetches
//  nothing): an `IntersectionObserver`-driven bar that stays hidden until the page hero scrolls ABOVE the
//  top of the viewport, then pins a compressed status summary there — a status icon + short headline (in
//  the status hue), an optional last-checked label, a trailing up-arrow, and (when a handler is supplied) a
//  refresh affordance. Tapping the bar smooth-scrolls the page back to the top.
//
//  This file is the Foundation-only heart of the native peer:
//    • the surface slug (P1/S11 diagnostics),
//    • ``StickyCompactHeroStatus`` — the native peer of the web `HeroStatus` union, carrying the per-status
//      SF Symbol (web lucide icon), the headline catalog key + fallback (web `SHORT_HEADLINE`), and the
//      semantic ``TSTone`` (web `TEXT_FOR_STATUS` hue, theme-aware here),
//    • ``StickyCompactHeroConfig`` — the value-type peer of the web props (status, lastCheckedLabel,
//      whether a refresh handler exists, refreshing, topOffset), normalized (a negative topOffset clamps to
//      0; a blank last-checked label folds to nil, the native peer of the web `{lastCheckedLabel && …}`),
//    • ``StickyCompactHeroGeometry`` — the scroll snapshot the visibility decision runs over (the three
//      numbers an `IntersectionObserver` entry carries),
//    • ``StickyCompactHeroVisibility`` — the port of the observer callback.
//
//  No SwiftUI, no `@Observable` model, no networking — every branch is unit testable in isolation. The
//  i18n lookup is injected as a closure so the core stays Foundation-only and the tests stay deterministic;
//  the live `@Observable` model + the SwiftUI scroll plumbing live in the Model / view files.
//
//  Faithful-parity note: the web source performs NO fetch and reads NO remote data — it only observes a
//  scroll position and renders its props — so it has NO loading / empty / error / stale / offline branch
//  (there is nothing to fetch, fail, age, or lose connectivity to). Its REAL branches are: hidden vs.
//  visible (the observer decision), the five status variants (icon + headline + hue), the optional
//  last-checked label, and the optional refresh affordance (idle vs. refreshing). This surface reproduces
//  exactly those; inventing data-state chrome would contradict the source (Honesty Covenant 5), exactly as
//  the sibling scroll-driven primitive PageHeaderSticky (0172) and the status primitive HealthRow (0197) did.
//

import CoreGraphics
import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum StickyCompactHeroSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "StickyCompactHero"
}

// MARK: - Localization facade typealias (P1/S10)

/// The i18n lookup the surface uses to resolve its copy + accessibility wording — `(key, fallback) ->
/// String`, the native peer of `t(key, default)`. Injected so the pure core stays Foundation-only and
/// deterministic in tests (pass `{ _, fallback in fallback }`). `@Sendable` so it crosses isolation
/// boundaries cleanly under Swift 6 strict concurrency.
public typealias StickyCompactHeroLocalize = @Sendable (String, String) -> String

// MARK: - StickyCompactHeroStatus (web `HeroStatus` union)

/// The instance health status — the native peer of the web `HeroStatus`
/// (`'healthy' | 'degraded' | 'unhealthy' | 'unknown' | 'maintenance'`) imported from `StatusHero`. It
/// drives the leading icon, the short headline, and the hue. The web fixes each to a lucide icon, a
/// `SHORT_HEADLINE` string, and a `*-400` text colour; the native peer maps to an SF Symbol, a localized
/// headline (resolved through the P1/S10 facade), and the shared semantic ``TSTone`` token so the hue
/// recolours across light / dark / high-contrast rather than the web's fixed hue.
public enum StickyCompactHeroStatus: String, Sendable, Equatable, CaseIterable {
    /// All systems operational (web `healthy` → CheckCircle, green).
    case healthy
    /// Degraded performance (web `degraded` → AlertTriangle, amber).
    case degraded
    /// Service outage (web `unhealthy` → XCircle, red).
    case unhealthy
    /// Status unknown (web `unknown` → HelpCircle, zinc).
    case unknown
    /// Scheduled maintenance (web `maintenance` → Wrench, blue).
    case maintenance

    /// The leading SF Symbol — the native peer of the web `ICON_FOR_STATUS` lucide glyph (`CheckCircle`,
    /// `AlertTriangle`, `XCircle`, `HelpCircle`, `Wrench`).
    public var iconSystemName: String {
        switch self {
        case .healthy: "checkmark.circle.fill"
        case .degraded: "exclamationmark.triangle.fill"
        case .unhealthy: "xmark.circle.fill"
        case .unknown: "questionmark.circle.fill"
        case .maintenance: "wrench.fill"
        }
    }

    /// The headline catalog key — the localized peer of the web `SHORT_HEADLINE` literal.
    public var headlineKey: String {
        "stickyCompactHero.status.\(rawValue)"
    }

    /// The English headline fallback — the verbatim web `SHORT_HEADLINE` value, used when the catalog has
    /// no localization (and in test / preview bundles).
    public var headlineFallback: String {
        switch self {
        case .healthy: "All operational"
        case .degraded: "Degraded"
        case .unhealthy: "Outage"
        case .unknown: "Status unknown"
        case .maintenance: "Maintenance"
        }
    }

    /// The semantic tone — the theme-aware token projection of the web `TEXT_FOR_STATUS` hue (`healthy →
    /// success`, `degraded → warning`, `unhealthy → danger`, `unknown → neutral`, `maintenance → info`).
    /// Reuses the shared ``TSTone`` so the icon + headline recolour across themes, where the web's fixed
    /// `*-400` hues did not. Defined here (the enum is colour-free) so the mapping is unit tested without
    /// SwiftUI; the view reads ``TSTone/color``.
    public var tone: TSTone {
        switch self {
        case .healthy: .success
        case .degraded: .warning
        case .unhealthy: .danger
        case .unknown: .neutral
        case .maintenance: .info
        }
    }
}

// MARK: - StickyCompactHeroConfig (web props)

/// The configuration of one compact hero bar — the value-type peer of the web `StickyCompactHeroProps`,
/// minus the `targetId` (in native the bar binds to its anchor structurally rather than by a global DOM
/// id) and the `onRefresh` closure (held by the state-holder, since closures are neither `Equatable` nor
/// `Sendable`). It carries the `status`, the optional `lastCheckedLabel` (web `{lastCheckedLabel && …}` —
/// a blank label folds to `nil`, the native peer of the JS falsy guard), whether a refresh affordance is
/// present (`hasRefresh`, web `onRefresh != null`), whether a refresh is in flight (`refreshing`, web
/// `refreshing`), and the `topOffset` it pins below (web `top: topOffset`, clamped non-negative). A value
/// type so the view, the state-holder, and the pure projection agree on one shape, and so a SwiftUI
/// `.onChange` can detect a prop change cheaply when the page rebinds a fresh status / last-checked label.
public struct StickyCompactHeroConfig: Sendable, Equatable {
    /// The instance health status driving the icon, headline, and hue (web `status`).
    public let status: StickyCompactHeroStatus
    /// The last-checked relative label, e.g. "12s ago" — web `lastCheckedLabel`. A blank value is folded
    /// to `nil` (the web `{lastCheckedLabel && …}` falsy guard), so the separator never renders alone.
    public let lastCheckedLabel: String?
    /// Whether the refresh affordance is present — web `onRefresh != null` (`{onRefresh && <button>}`).
    public let hasRefresh: Bool
    /// Whether a refresh is in flight — web `refreshing` (spins the glyph + disables the button).
    public let refreshing: Bool
    /// The offset from the top of the viewport the bar pins below — web `topOffset` (clamped >= 0).
    public let topOffset: CGFloat

    public init(
        status: StickyCompactHeroStatus,
        lastCheckedLabel: String? = nil,
        hasRefresh: Bool = false,
        refreshing: Bool = false,
        topOffset: CGFloat = 0
    ) {
        self.status = status
        // Web renders the label only when truthy (`{lastCheckedLabel && …}`); a blank / whitespace string
        // is falsy there, so it folds to nil here and the leading "·" separator never renders alone.
        let trimmed = lastCheckedLabel?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.lastCheckedLabel = (trimmed?.isEmpty == false) ? trimmed : nil
        self.hasRefresh = hasRefresh
        self.refreshing = refreshing
        // Web sets `style={{ top: topOffset }}`; a negative inset is meaningless for a top-pinned bar, so
        // it clamps to 0 (the web default) rather than pinning above the viewport.
        self.topOffset = max(0, topOffset)
    }

    /// Whether a last-checked label is present after normalization (web truthy `lastCheckedLabel`).
    public var showsLastChecked: Bool {
        lastCheckedLabel != nil
    }
}

// MARK: - StickyCompactHeroGeometry (IntersectionObserver entry)

/// The scroll snapshot the visibility decision runs over — the native peer of the three numbers an
/// `IntersectionObserver` entry carries. `targetTop` / `targetBottom` are the anchor hero's top + bottom
/// in the scroll viewport's coordinate space (y = 0 is the visible top, increasing downward — exactly
/// `entry.boundingClientRect.top` / `.bottom`); `viewportHeight` is the visible scroll height (the
/// observer root's height). A SwiftUI scroll reader fills this from `proxy.frame(in: .scrollView).minY /
/// .maxY` + the container height.
public struct StickyCompactHeroGeometry: Sendable, Equatable {
    /// The anchor's top edge in viewport coordinates — web `entry.boundingClientRect.top`.
    public let targetTop: CGFloat
    /// The anchor's bottom edge in viewport coordinates — web `entry.boundingClientRect.bottom`.
    public let targetBottom: CGFloat
    /// The visible scroll-viewport height — the `IntersectionObserver` root height.
    public let viewportHeight: CGFloat

    public init(targetTop: CGFloat, targetBottom: CGFloat, viewportHeight: CGFloat) {
        self.targetTop = targetTop
        self.targetBottom = targetBottom
        self.viewportHeight = viewportHeight
    }

    /// The neutral first-paint snapshot — the anchor sits at the top of the viewport, nothing scrolled.
    /// Visibility over this is `false` (the bar starts hidden, web `useState(false)`).
    public static let initial = StickyCompactHeroGeometry(targetTop: 0, targetBottom: 0, viewportHeight: 0)
}

// MARK: - StickyCompactHeroVisibility (web IntersectionObserver callback)

/// The pure visibility decision — the port of the web observer callback. The web computes
/// `setVisible(!entry.isIntersecting)` over an observer whose root is inset by `-topOffset` at the top
/// (`rootMargin: -topOffset 0 0 0`, `threshold: 0`), starting hidden (`useState(false)`). The native peer
/// adds the `scrolledPast` clause (the anchor top has scrolled above the viewport) which (a) realizes the
/// start-hidden initial state for the synthetic first geometry and (b) encodes the documented "renders the
/// compact bar once that target has scrolled out of view" intent — the same guard the sibling
/// PageHeaderSticky (0172) carries (whose own web source spells it `!isIntersecting && top < 0`). Kept as
/// pure functions over a ``StickyCompactHeroGeometry`` + the `topOffset` so the rule is unit tested
/// without an `IntersectionObserver`, a SwiftUI scroll view, or an `@Observable` model.
public enum StickyCompactHeroVisibility {
    /// `true` when the anchor overlaps the top-inset observer root `[topOffset, viewportHeight]` — the
    /// native peer of `entry.isIntersecting` with `rootMargin: -topOffset 0 0 0` and `threshold: 0` (any
    /// overlap counts). The anchor intersects iff its bottom is below the inset top AND its top is above
    /// the viewport bottom.
    public static func isIntersecting(_ geometry: StickyCompactHeroGeometry, topOffset: CGFloat) -> Bool {
        let inset = max(0, topOffset)
        return geometry.targetBottom > inset && geometry.targetTop < geometry.viewportHeight
    }

    /// `true` when the anchor's top has scrolled above the top of the viewport — web
    /// `entry.boundingClientRect.top < 0`. This is what keeps the bar hidden on the neutral first paint
    /// (web `useState(false)`) and while the anchor is still below the viewport on a long page.
    public static func scrolledPast(_ geometry: StickyCompactHeroGeometry) -> Bool {
        geometry.targetTop < 0
    }

    /// The bar's visibility — web `setVisible(!entry.isIntersecting)` realized with the start-hidden
    /// `scrolledPast` guard. Visible iff the anchor is NOT intersecting the top-inset root AND it has
    /// scrolled above the viewport top.
    public static func isVisible(_ geometry: StickyCompactHeroGeometry, topOffset: CGFloat) -> Bool {
        !isIntersecting(geometry, topOffset: topOffset) && scrolledPast(geometry)
    }
}
