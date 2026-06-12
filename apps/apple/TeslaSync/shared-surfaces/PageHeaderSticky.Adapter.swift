//
//  PageHeaderSticky.Adapter.swift
//  TeslaSync — P4 shared surface · 0172 · PageHeaderSticky (Apple)
//
//  The testable, dependency-light core for the page-header sticky bar — the SwiftUI parity of
//  components/layout/PageHeaderSticky.tsx. The web source is a pure presentational component (it fetches
//  nothing): an `IntersectionObserver`-driven bar that stays hidden until the page hero scrolls ABOVE the
//  top of the viewport, then pins itself there showing a compressed page summary, and (by default) turns
//  the whole bar into a click-to-scroll-to-top affordance with a small up-arrow glyph.
//
//  This file is the Foundation-only heart of the native peer:
//    • the surface slug (P1/S11 diagnostics),
//    • `PageHeaderStickyConfig` — the value-type peer of the web props (targetId, scrollToTop, topOffset,
//      ariaLabel, testId), normalized (a negative topOffset clamps to 0, web `top: topOffset`),
//    • `PageHeaderStickyGeometry` — the scroll snapshot the visibility decision runs over: the target's
//      top + bottom in the scroll viewport's coordinate space (y = 0 is the visible top) plus the visible
//      viewport height — the three numbers an `IntersectionObserver` entry carries
//      (`boundingClientRect.top` / `.bottom`, the root height),
//    • `PageHeaderStickyVisibility` — the VERBATIM port of the observer callback: the bar is visible iff
//      the target is NOT intersecting the top-inset root AND its top has scrolled above the viewport
//      (`!entry.isIntersecting && entry.boundingClientRect.top < 0`).
//
//  No SwiftUI, no @Observable model, no networking — every branch is unit testable in isolation. The
//  i18n lookup is injected as a closure so the core stays Foundation-only and the tests stay
//  deterministic; the live `@Observable` model + the SwiftUI scroll plumbing live in the Model / view files.
//
//  Faithful-parity note: the web source performs NO fetch and reads NO remote data — it only observes a
//  scroll position — so it has NO loading / empty / error / stale / offline branches. Its REAL branches
//  are: hidden vs. visible (the observer decision), scroll-to-top enabled (a button + up-arrow glyph) vs.
//  disabled (a plain bar), and the summary content it renders (truncated when long). This surface
//  reproduces exactly those; inventing data-state chrome would contradict the source (Honesty Covenant 5).
//

import CoreGraphics
import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// The web component is anonymous (each page passes its own `ariaLabel`); the prompt assigns this
/// surface the canonical slug `PageHeaderSticky`, kept here (SwiftUI-free) so the state-holder can emit
/// telemetry without depending on the view layer.
public enum PageHeaderStickySurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "PageHeaderSticky"
}

// MARK: - Localization facade typealias (P1/S10)

/// The i18n lookup the surface uses to resolve its accessibility wording — `(key, fallback) -> String`,
/// the native peer of `t(key, default)`. Injected so the pure core stays Foundation-only and
/// deterministic in tests (pass `{ _, fallback in fallback }`). `@Sendable` so it crosses isolation
/// boundaries cleanly under Swift 6 strict concurrency.
public typealias PageHeaderStickyLocalize = @Sendable (String, String) -> String

// MARK: - PageHeaderStickyConfig (web props)

/// The configuration of one sticky bar — the value-type peer of the web `PageHeaderStickyProps`. It
/// carries the `targetId` (the hero whose scroll position drives visibility — in native this binds the
/// bar to its anchor structurally rather than by a global DOM id), whether the bar is a scroll-to-top
/// affordance (`scrollToTop`, web default `true`), the `topOffset` it pins below (web `top: topOffset`,
/// clamped non-negative), the `ariaLabel` for the region, and an optional `testId`.
public struct PageHeaderStickyConfig: Sendable, Equatable {
    /// The id of the anchor (page hero) whose visibility drives the bar — web `targetId`.
    public let targetID: String
    /// When `true`, the whole bar is a scroll-to-top button with an up-arrow glyph — web `scrollToTop`.
    public let scrollToTop: Bool
    /// The offset from the top of the viewport the bar pins below — web `topOffset` (clamped >= 0).
    public let topOffset: CGFloat
    /// The accessibility label for the sticky region — web `ariaLabel`.
    public let ariaLabel: String
    /// An optional test hook on the outer node — web `testId`.
    public let testID: String?

    public init(
        targetID: String,
        ariaLabel: String,
        scrollToTop: Bool = true,
        topOffset: CGFloat = 0,
        testID: String? = nil
    ) {
        self.targetID = targetID
        self.ariaLabel = ariaLabel
        self.scrollToTop = scrollToTop
        // Web sets `style={{ top: topOffset }}`; a negative inset is meaningless for a top-pinned bar,
        // so it clamps to 0 (the web default) rather than pinning above the viewport.
        self.topOffset = max(0, topOffset)
        self.testID = testID
    }

    /// The composed accessibility label for the scroll-to-top button — web
    /// `aria-label={`${ariaLabel} — scroll to top`}`. `localize` supplies the localized " — scroll to
    /// top" suffix so the whole label stays translatable (no hardcoded English in the view).
    public func scrollToTopAccessibilityLabel(localize: PageHeaderStickyLocalize) -> String {
        let suffix = localize("pageHeaderSticky.a11y.scrollToTopSuffix", "scroll to top")
        return "\(ariaLabel) — \(suffix)"
    }
}

// MARK: - PageHeaderStickyGeometry (IntersectionObserver entry)

/// The scroll snapshot the visibility decision runs over — the native peer of the three numbers an
/// `IntersectionObserver` entry carries. `targetTop` / `targetBottom` are the anchor's top + bottom in
/// the scroll viewport's coordinate space (y = 0 is the visible top, increasing downward — exactly
/// `entry.boundingClientRect.top` / `.bottom`); `viewportHeight` is the visible scroll height (the
/// observer root's height). A SwiftUI scroll reader fills this from
/// `proxy.frame(in: .scrollView).minY/.maxY` + the container height.
public struct PageHeaderStickyGeometry: Sendable, Equatable {
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
    public static let initial = PageHeaderStickyGeometry(targetTop: 0, targetBottom: 0, viewportHeight: 0)
}

// MARK: - PageHeaderStickyVisibility (web IntersectionObserver callback)

/// The pure visibility decision — the VERBATIM port of the web observer callback. Kept as pure functions
/// over a ``PageHeaderStickyGeometry`` + the `topOffset` so the rule is unit tested without an
/// `IntersectionObserver`, a SwiftUI scroll view, or an `@Observable` model.
public enum PageHeaderStickyVisibility {
    /// `true` when the anchor overlaps the top-inset observer root `[topOffset, viewportHeight]` — the
    /// native peer of `entry.isIntersecting` with `rootMargin: -topOffset 0 0 0` and `threshold: 0` (any
    /// overlap counts). The anchor intersects iff its bottom is below the inset top AND its top is above
    /// the viewport bottom.
    public static func isIntersecting(_ geometry: PageHeaderStickyGeometry, topOffset: CGFloat) -> Bool {
        let inset = max(0, topOffset)
        return geometry.targetBottom > inset && geometry.targetTop < geometry.viewportHeight
    }

    /// `true` when the anchor's top has scrolled above the top of the viewport — web
    /// `entry.boundingClientRect.top < 0`. This guard is what stops the bar appearing while the anchor is
    /// still BELOW the viewport on the first paint of a long page (a false positive without it).
    public static func scrolledPast(_ geometry: PageHeaderStickyGeometry) -> Bool {
        geometry.targetTop < 0
    }

    /// The bar's visibility — web `setVisible(!entry.isIntersecting && scrolledPast)`. Visible iff the
    /// anchor is NOT intersecting the top-inset root AND it has scrolled above the viewport top.
    public static func isVisible(_ geometry: PageHeaderStickyGeometry, topOffset: CGFloat) -> Bool {
        !isIntersecting(geometry, topOffset: topOffset) && scrolledPast(geometry)
    }
}
