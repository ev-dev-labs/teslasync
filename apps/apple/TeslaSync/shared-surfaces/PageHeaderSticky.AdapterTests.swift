//
//  PageHeaderSticky.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0172 · PageHeaderSticky (Apple)
//
//  Pure-core coverage for the sticky bar (the model + view-composition half lives in
//  PageHeaderSticky.Tests.swift; split to keep each file within the SwiftLint file-length budget). This is
//  the "adapter (cached → projection)" unit test the acceptance calls for: it drives the config
//  normalization, the IntersectionObserver visibility port, and the projection, asserting the verbatim
//  port of the web component's per-tick decision:
//    • config      — topOffset clamps non-negative; the composed " — scroll to top" a11y label.
//    • visibility  — isIntersecting (top-inset root), scrolledPast (top < 0), and the combined
//                    `!isIntersecting && scrolledPast` across hidden / below-viewport / straddling /
//                    scrolled-past / topOffset-shifted cases.
//    • projection  — hidden vs. visible; scrollToTop vs. plain mode; region + button labels; passthrough.
//    • slug        — the diagnostics surface slug.
//
//  These run in the TeslaSync(/-macOS) XCTest targets (and a standalone SwiftPM harness). They have no
//  network, no model instance and no SwiftUI, so each assertion reads the pure logic directly.
//

import CoreGraphics
import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class PageHeaderStickySurfaceTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(PageHeaderStickySurface.slug, "PageHeaderSticky")
    }
}

// MARK: - PageHeaderStickyConfig (web props)

final class PageHeaderStickyConfigTests: XCTestCase {
    private let fallbackOnly: PageHeaderStickyLocalize = { _, fallback in fallback }

    func testDefaultsMatchWeb() {
        let config = PageHeaderStickyConfig(targetID: "drives-overview", ariaLabel: "Drive summary")
        XCTAssertTrue(config.scrollToTop, "web default scrollToTop = true")
        XCTAssertEqual(config.topOffset, 0, "web default topOffset = 0")
        XCTAssertNil(config.testID)
    }

    func testNegativeTopOffsetClampsToZero() {
        let config = PageHeaderStickyConfig(targetID: "t", ariaLabel: "a", topOffset: -40)
        XCTAssertEqual(config.topOffset, 0, "a negative inset is meaningless for a top-pinned bar")
    }

    func testPositiveTopOffsetPreserved() {
        let config = PageHeaderStickyConfig(targetID: "t", ariaLabel: "a", topOffset: 56)
        XCTAssertEqual(config.topOffset, 56)
    }

    func testScrollToTopAccessibilityLabelComposesSuffix() {
        let config = PageHeaderStickyConfig(targetID: "t", ariaLabel: "Drive history summary")
        XCTAssertEqual(
            config.scrollToTopAccessibilityLabel(localize: fallbackOnly),
            "Drive history summary — scroll to top"
        )
    }

    func testScrollToTopAccessibilityLabelUsesLocalizedSuffix() {
        let localize: PageHeaderStickyLocalize = { key, _ in
            key == "pageHeaderSticky.a11y.scrollToTopSuffix" ? "haut de page" : "?"
        }
        let config = PageHeaderStickyConfig(targetID: "t", ariaLabel: "Résumé")
        XCTAssertEqual(config.scrollToTopAccessibilityLabel(localize: localize), "Résumé — haut de page")
    }
}

// MARK: - PageHeaderStickyVisibility (web IntersectionObserver callback)

final class PageHeaderStickyVisibilityTests: XCTestCase {
    /// Hero fully in view (intersecting the root) — the bar is hidden (web `isIntersecting` true).
    func testHeroInViewIsHidden() {
        let geometry = PageHeaderStickyGeometry(targetTop: 100, targetBottom: 300, viewportHeight: 800)
        XCTAssertTrue(PageHeaderStickyVisibility.isIntersecting(geometry, topOffset: 0))
        XCTAssertFalse(PageHeaderStickyVisibility.isVisible(geometry, topOffset: 0))
    }

    /// Hero still BELOW the viewport on first paint of a long page — hidden via the `scrolledPast` guard
    /// (the false positive the web component explicitly guards against).
    func testHeroBelowViewportIsHidden() {
        let geometry = PageHeaderStickyGeometry(targetTop: 900, targetBottom: 1100, viewportHeight: 800)
        XCTAssertFalse(PageHeaderStickyVisibility.scrolledPast(geometry))
        XCTAssertFalse(PageHeaderStickyVisibility.isVisible(geometry, topOffset: 0))
    }

    /// Hero straddling the top (partly visible) — still intersecting, so hidden (web `isIntersecting`).
    func testHeroStraddlingTopIsHidden() {
        let geometry = PageHeaderStickyGeometry(targetTop: -50, targetBottom: 200, viewportHeight: 800)
        XCTAssertTrue(PageHeaderStickyVisibility.scrolledPast(geometry))
        XCTAssertTrue(PageHeaderStickyVisibility.isIntersecting(geometry, topOffset: 0))
        XCTAssertFalse(
            PageHeaderStickyVisibility.isVisible(geometry, topOffset: 0),
            "partly-visible hero keeps the bar hidden"
        )
    }

    /// Hero scrolled fully above the viewport top — the bar is visible (web `!isIntersecting && top < 0`).
    func testHeroScrolledPastIsVisible() {
        let geometry = PageHeaderStickyGeometry(targetTop: -120, targetBottom: -20, viewportHeight: 800)
        XCTAssertFalse(PageHeaderStickyVisibility.isIntersecting(geometry, topOffset: 0))
        XCTAssertTrue(PageHeaderStickyVisibility.scrolledPast(geometry))
        XCTAssertTrue(PageHeaderStickyVisibility.isVisible(geometry, topOffset: 0))
    }

    /// A positive topOffset shifts the threshold: a hero whose bottom sits within the offset band is no
    /// longer intersecting the inset root, so the bar appears earlier (web `rootMargin: -topOffset`).
    func testTopOffsetShiftsThreshold() {
        let geometry = PageHeaderStickyGeometry(targetTop: -50, targetBottom: 40, viewportHeight: 800)
        XCTAssertFalse(PageHeaderStickyVisibility.isVisible(geometry, topOffset: 0), "intersects the un-inset root")
        XCTAssertTrue(
            PageHeaderStickyVisibility.isVisible(geometry, topOffset: 60),
            "bottom is within the -60 inset band"
        )
    }

    func testInitialGeometryIsHidden() {
        XCTAssertFalse(PageHeaderStickyVisibility.isVisible(.initial, topOffset: 0), "the bar starts hidden")
    }
}

// MARK: - PageHeaderStickyProjection (web `visible` + render split)

final class PageHeaderStickyProjectionTests: XCTestCase {
    private let fallbackOnly: PageHeaderStickyLocalize = { _, fallback in fallback }

    private func config(
        scrollToTop: Bool = true,
        topOffset: CGFloat = 0,
        testID: String? = nil
    ) -> PageHeaderStickyConfig {
        PageHeaderStickyConfig(
            targetID: "drives-overview",
            ariaLabel: "Drive history summary",
            scrollToTop: scrollToTop,
            topOffset: topOffset,
            testID: testID
        )
    }

    private let visibleGeometry = PageHeaderStickyGeometry(targetTop: -120, targetBottom: -20, viewportHeight: 800)
    private let hiddenGeometry = PageHeaderStickyGeometry(targetTop: 100, targetBottom: 300, viewportHeight: 800)

    func testHiddenWhenHeroInView() {
        let resolved = PageHeaderStickyProjection.resolve(
            config: config(),
            geometry: hiddenGeometry,
            localize: fallbackOnly
        )
        XCTAssertFalse(resolved.isVisible)
    }

    func testVisibleWhenScrolledPast() {
        let resolved = PageHeaderStickyProjection.resolve(
            config: config(),
            geometry: visibleGeometry,
            localize: fallbackOnly
        )
        XCTAssertTrue(resolved.isVisible)
    }

    func testScrollToTopMode() {
        let resolved = PageHeaderStickyProjection.resolve(
            config: config(scrollToTop: true),
            geometry: visibleGeometry,
            localize: fallbackOnly
        )
        XCTAssertEqual(resolved.mode, .scrollToTop)
        XCTAssertTrue(resolved.isScrollToTop)
    }

    func testPlainMode() {
        let resolved = PageHeaderStickyProjection.resolve(
            config: config(scrollToTop: false),
            geometry: visibleGeometry,
            localize: fallbackOnly
        )
        XCTAssertEqual(resolved.mode, .plain)
        XCTAssertFalse(resolved.isScrollToTop)
    }

    func testRegionAndButtonLabels() {
        let resolved = PageHeaderStickyProjection.resolve(
            config: config(),
            geometry: visibleGeometry,
            localize: fallbackOnly
        )
        XCTAssertEqual(resolved.regionLabel, "Drive history summary")
        XCTAssertEqual(resolved.scrollToTopLabel, "Drive history summary — scroll to top")
    }

    func testTopOffsetAndTestIDPassThrough() {
        let resolved = PageHeaderStickyProjection.resolve(
            config: config(topOffset: 56, testID: "drives-sticky"),
            geometry: visibleGeometry,
            localize: fallbackOnly
        )
        XCTAssertEqual(resolved.topOffset, 56)
        XCTAssertEqual(resolved.testID, "drives-sticky")
    }

    func testHiddenFactory() {
        let hidden = PageHeaderStickyPresentation.hidden(
            regionLabel: "R", scrollToTopLabel: "R — scroll to top", mode: .scrollToTop, topOffset: 0, testID: nil
        )
        XCTAssertFalse(hidden.isVisible)
        XCTAssertTrue(hidden.isScrollToTop)
    }
}
