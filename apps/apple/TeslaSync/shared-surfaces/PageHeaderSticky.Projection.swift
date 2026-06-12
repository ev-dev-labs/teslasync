//
//  PageHeaderSticky.Projection.swift
//  TeslaSync — P4 shared surface · 0172 · PageHeaderSticky (Apple)
//
//  The pure projection from the cached scroll state (the config + the current scroll geometry) to the
//  resolved, view-ready value the bar renders — the native peer of what the web component computes each
//  observer tick (`visible`) plus the render decision it makes (`if (!visible) return null`, and the
//  `scrollToTop ? <button> : <div>` split). The view is a pure function of this value; every branch is
//  unit tested.
//
//  This is the surface's data adapter in the "cached → projection" sense the acceptance calls for: it
//  takes the cached config + the latest scroll geometry, runs the geometry through
//  ``PageHeaderStickyVisibility``, and derives whether the bar renders, which form it takes (scroll-to-top
//  button vs. plain bar), the region label, and the composed scroll-to-top accessibility label —
//  collapsing the hidden / visible and button / plain branches exactly as the web component does.
//

import CoreGraphics
import Foundation

// MARK: - PageHeaderStickyMode (web `scrollToTop ? <button> : <div>`)

/// Which form a VISIBLE bar takes — the native peer of the web `scrollToTop ?` split. `.scrollToTop` is
/// the interactive button with the up-arrow glyph (web default); `.plain` is the non-interactive bar.
public enum PageHeaderStickyMode: String, Sendable, Equatable {
    /// The whole bar is a scroll-to-top button with a trailing up-arrow — web `scrollToTop` truthy.
    case scrollToTop
    /// The bar is a plain, non-interactive container — web `scrollToTop={false}`.
    case plain
}

// MARK: - Resolved read-model (web `visible` + render decision)

/// The resolved, view-ready projection of the sticky bar — the native peer of the web component's
/// per-tick render decision. `isVisible` mirrors `visible` (and the `if (!visible) return null` guard);
/// `mode` mirrors the `scrollToTop ? <button> : <div>` split; `regionLabel` is the `role="region"`
/// `aria-label`; `scrollToTopLabel` is the composed `${ariaLabel} — scroll to top` button label; and
/// `topOffset` is the pin offset (web `style={{ top }}`).
public struct PageHeaderStickyPresentation: Sendable, Equatable {
    /// `true` when the bar renders — web `visible` (the bar is `null` when `false`).
    public let isVisible: Bool
    /// The form a visible bar takes — web `scrollToTop ? button : div`.
    public let mode: PageHeaderStickyMode
    /// The sticky region's accessibility label — web `aria-label={ariaLabel}`.
    public let regionLabel: String
    /// The scroll-to-top button's accessibility label — web `${ariaLabel} — scroll to top`.
    public let scrollToTopLabel: String
    /// The offset the bar pins below the top — web `style={{ top: topOffset }}` (clamped >= 0).
    public let topOffset: CGFloat
    /// An optional test hook on the outer node — web `data-testid={testId}`.
    public let testID: String?

    public init(
        isVisible: Bool,
        mode: PageHeaderStickyMode,
        regionLabel: String,
        scrollToTopLabel: String,
        topOffset: CGFloat,
        testID: String?
    ) {
        self.isVisible = isVisible
        self.mode = mode
        self.regionLabel = regionLabel
        self.scrollToTopLabel = scrollToTopLabel
        self.topOffset = topOffset
        self.testID = testID
    }

    /// `true` when the bar is the interactive scroll-to-top button (web default) — convenience for the
    /// view + tests.
    public var isScrollToTop: Bool {
        mode == .scrollToTop
    }

    /// The hidden projection — the bar renders nothing (web `null`). Carries the config's labels so the
    /// view can keep a stable identity across the hidden ⇄ visible transition.
    public static func hidden(
        regionLabel: String,
        scrollToTopLabel: String,
        mode: PageHeaderStickyMode,
        topOffset: CGFloat,
        testID: String?
    ) -> PageHeaderStickyPresentation {
        PageHeaderStickyPresentation(
            isVisible: false,
            mode: mode,
            regionLabel: regionLabel,
            scrollToTopLabel: scrollToTopLabel,
            topOffset: topOffset,
            testID: testID
        )
    }
}

// MARK: - Projection (cached config + scroll geometry → resolved presentation)

/// Pure projection from the cached config + the latest scroll geometry to the resolved presentation.
/// `resolve(config:geometry:localize:)` runs the geometry through ``PageHeaderStickyVisibility`` (web
/// observer callback) and composes the labels through the injected localizer, so the view never recomputes
/// visibility or rebuilds copy itself.
public enum PageHeaderStickyProjection {
    /// Projects the config + scroll geometry into the resolved presentation (web per-tick `visible` +
    /// the `scrollToTop ?` render split). `localize` resolves the " — scroll to top" suffix; tests pass a
    /// fallback-only closure for determinism.
    public static func resolve(
        config: PageHeaderStickyConfig,
        geometry: PageHeaderStickyGeometry,
        localize: PageHeaderStickyLocalize
    ) -> PageHeaderStickyPresentation {
        let visible = PageHeaderStickyVisibility.isVisible(geometry, topOffset: config.topOffset)
        return PageHeaderStickyPresentation(
            isVisible: visible,
            mode: config.scrollToTop ? .scrollToTop : .plain,
            regionLabel: config.ariaLabel,
            scrollToTopLabel: config.scrollToTopAccessibilityLabel(localize: localize),
            topOffset: config.topOffset,
            testID: config.testID
        )
    }
}
