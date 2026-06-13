//
//  StickyCompactHero.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0201 · StickyCompactHero (Apple)
//
//  Pure-core coverage for the compact hero bar (the model + view-composition half lives in
//  StickyCompactHero.Tests.swift; split to keep each file within the SwiftLint file-length budget). This is
//  the "adapter (cached → projection)" unit test the acceptance calls for: it drives the status mapping
//  (icon / headline / tone), the config normalization, the IntersectionObserver visibility port, and the
//  projection, asserting the port of the web component's per-tick decision:
//    • status      — the SF Symbol (web lucide icon), the headline key + fallback (web SHORT_HEADLINE),
//                    and the semantic TSTone (web TEXT_FOR_STATUS hue) for every variant.
//    • config      — defaults; topOffset clamps non-negative; blank last-checked folds to nil.
//    • visibility  — isIntersecting (top-inset root), scrolledPast (top < 0), and the combined
//                    `!isIntersecting && scrolledPast` across hidden / below-viewport / straddling /
//                    scrolled-past / topOffset-shifted cases.
//    • projection  — hidden vs. visible; per-status icon + headline; last-checked / refresh branches;
//                    region + button labels; the spoken region value; passthrough.
//    • slug        — the diagnostics surface slug.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network, no model instance and no
//  SwiftUI, so each assertion reads the pure logic directly.
//

import CoreGraphics
import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class StickyCompactHeroSurfaceTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(StickyCompactHeroSurface.slug, "StickyCompactHero")
        XCTAssertEqual(StickyCompactHero.surfaceSlug, "StickyCompactHero")
    }
}

// MARK: - StickyCompactHeroStatus (web HeroStatus union → icon / headline / tone)

final class StickyCompactHeroStatusTests: XCTestCase {
    func testIconSystemNamePerStatus() {
        XCTAssertEqual(StickyCompactHeroStatus.healthy.iconSystemName, "checkmark.circle.fill")
        XCTAssertEqual(StickyCompactHeroStatus.degraded.iconSystemName, "exclamationmark.triangle.fill")
        XCTAssertEqual(StickyCompactHeroStatus.unhealthy.iconSystemName, "xmark.circle.fill")
        XCTAssertEqual(StickyCompactHeroStatus.unknown.iconSystemName, "questionmark.circle.fill")
        XCTAssertEqual(StickyCompactHeroStatus.maintenance.iconSystemName, "wrench.fill")
    }

    func testHeadlineFallbackMatchesWebShortHeadline() {
        XCTAssertEqual(StickyCompactHeroStatus.healthy.headlineFallback, "All operational")
        XCTAssertEqual(StickyCompactHeroStatus.degraded.headlineFallback, "Degraded")
        XCTAssertEqual(StickyCompactHeroStatus.unhealthy.headlineFallback, "Outage")
        XCTAssertEqual(StickyCompactHeroStatus.unknown.headlineFallback, "Status unknown")
        XCTAssertEqual(StickyCompactHeroStatus.maintenance.headlineFallback, "Maintenance")
    }

    func testHeadlineKeyPerStatus() {
        XCTAssertEqual(StickyCompactHeroStatus.healthy.headlineKey, "stickyCompactHero.status.healthy")
        XCTAssertEqual(StickyCompactHeroStatus.maintenance.headlineKey, "stickyCompactHero.status.maintenance")
    }

    func testTonePerStatusMatchesWebHue() {
        XCTAssertEqual(StickyCompactHeroStatus.healthy.tone, .success)
        XCTAssertEqual(StickyCompactHeroStatus.degraded.tone, .warning)
        XCTAssertEqual(StickyCompactHeroStatus.unhealthy.tone, .danger)
        XCTAssertEqual(StickyCompactHeroStatus.unknown.tone, .neutral)
        XCTAssertEqual(StickyCompactHeroStatus.maintenance.tone, .info)
    }

    func testEveryStatusHasNonEmptyMapping() {
        for status in StickyCompactHeroStatus.allCases {
            XCTAssertFalse(status.iconSystemName.isEmpty)
            XCTAssertFalse(status.headlineFallback.isEmpty)
            XCTAssertFalse(status.headlineKey.isEmpty)
        }
        XCTAssertEqual(StickyCompactHeroStatus.allCases.count, 5)
    }
}

// MARK: - StickyCompactHeroConfig (web props normalization)

final class StickyCompactHeroConfigTests: XCTestCase {
    func testDefaultsMatchWeb() {
        let config = StickyCompactHeroConfig(status: .healthy)
        XCTAssertNil(config.lastCheckedLabel, "web lastCheckedLabel is optional/absent by default")
        XCTAssertFalse(config.hasRefresh, "web onRefresh is optional/absent by default")
        XCTAssertFalse(config.refreshing, "web refreshing defaults to false")
        XCTAssertEqual(config.topOffset, 0, "web topOffset defaults to 0")
        XCTAssertFalse(config.showsLastChecked)
    }

    func testNegativeTopOffsetClampsToZero() {
        let config = StickyCompactHeroConfig(status: .healthy, topOffset: -40)
        XCTAssertEqual(config.topOffset, 0, "a negative inset is meaningless for a top-pinned bar")
    }

    func testPositiveTopOffsetPreserved() {
        let config = StickyCompactHeroConfig(status: .healthy, topOffset: 56)
        XCTAssertEqual(config.topOffset, 56)
    }

    func testBlankLastCheckedFoldsToNil() {
        XCTAssertNil(StickyCompactHeroConfig(status: .healthy, lastCheckedLabel: "").lastCheckedLabel)
        XCTAssertNil(StickyCompactHeroConfig(status: .healthy, lastCheckedLabel: "   ").lastCheckedLabel)
    }

    func testNonBlankLastCheckedTrimmedAndKept() {
        let config = StickyCompactHeroConfig(status: .healthy, lastCheckedLabel: "  12s ago  ")
        XCTAssertEqual(config.lastCheckedLabel, "12s ago")
        XCTAssertTrue(config.showsLastChecked)
    }

    func testRefreshFlagsPreserved() {
        let config = StickyCompactHeroConfig(status: .degraded, hasRefresh: true, refreshing: true)
        XCTAssertTrue(config.hasRefresh)
        XCTAssertTrue(config.refreshing)
    }
}

// MARK: - StickyCompactHeroVisibility (web IntersectionObserver callback)

final class StickyCompactHeroVisibilityTests: XCTestCase {
    /// Hero fully in view (intersecting the root) — the bar is hidden (web `isIntersecting` true).
    func testHeroInViewIsHidden() {
        let geometry = StickyCompactHeroGeometry(targetTop: 100, targetBottom: 300, viewportHeight: 800)
        XCTAssertTrue(StickyCompactHeroVisibility.isIntersecting(geometry, topOffset: 0))
        XCTAssertFalse(StickyCompactHeroVisibility.isVisible(geometry, topOffset: 0))
    }

    /// Hero still BELOW the viewport on first paint of a long page — hidden via the `scrolledPast` guard.
    func testHeroBelowViewportIsHidden() {
        let geometry = StickyCompactHeroGeometry(targetTop: 900, targetBottom: 1100, viewportHeight: 800)
        XCTAssertFalse(StickyCompactHeroVisibility.scrolledPast(geometry))
        XCTAssertFalse(StickyCompactHeroVisibility.isVisible(geometry, topOffset: 0))
    }

    /// Hero straddling the top (partly visible) — still intersecting, so hidden (web `isIntersecting`).
    func testHeroStraddlingTopIsHidden() {
        let geometry = StickyCompactHeroGeometry(targetTop: -50, targetBottom: 200, viewportHeight: 800)
        XCTAssertTrue(StickyCompactHeroVisibility.scrolledPast(geometry))
        XCTAssertTrue(StickyCompactHeroVisibility.isIntersecting(geometry, topOffset: 0))
        XCTAssertFalse(
            StickyCompactHeroVisibility.isVisible(geometry, topOffset: 0),
            "a partly-visible hero keeps the bar hidden"
        )
    }

    /// Hero scrolled fully above the viewport top — the bar is visible (web `!isIntersecting && top < 0`).
    func testHeroScrolledPastIsVisible() {
        let geometry = StickyCompactHeroGeometry(targetTop: -120, targetBottom: -20, viewportHeight: 800)
        XCTAssertFalse(StickyCompactHeroVisibility.isIntersecting(geometry, topOffset: 0))
        XCTAssertTrue(StickyCompactHeroVisibility.scrolledPast(geometry))
        XCTAssertTrue(StickyCompactHeroVisibility.isVisible(geometry, topOffset: 0))
    }

    /// A positive topOffset shifts the threshold: a hero whose bottom sits within the offset band is no
    /// longer intersecting the inset root, so the bar appears earlier (web `rootMargin: -topOffset`).
    func testTopOffsetShiftsThreshold() {
        let geometry = StickyCompactHeroGeometry(targetTop: -50, targetBottom: 40, viewportHeight: 800)
        XCTAssertFalse(StickyCompactHeroVisibility.isVisible(geometry, topOffset: 0), "intersects the un-inset root")
        XCTAssertTrue(
            StickyCompactHeroVisibility.isVisible(geometry, topOffset: 60),
            "the bottom is within the -60 inset band"
        )
    }

    func testInitialGeometryIsHidden() {
        XCTAssertFalse(StickyCompactHeroVisibility.isVisible(.initial, topOffset: 0), "the bar starts hidden")
    }
}

// MARK: - StickyCompactHeroProjection (web `visible` + render decisions)

final class StickyCompactHeroProjectionTests: XCTestCase {
    private let fallbackOnly: StickyCompactHeroLocalize = { _, fallback in fallback }
    private let visibleGeometry = StickyCompactHeroGeometry(targetTop: -120, targetBottom: -20, viewportHeight: 800)
    private let hiddenGeometry = StickyCompactHeroGeometry(targetTop: 100, targetBottom: 300, viewportHeight: 800)

    private func resolve(
        _ config: StickyCompactHeroConfig,
        geometry: StickyCompactHeroGeometry? = nil
    ) -> StickyCompactHeroPresentation {
        StickyCompactHeroProjection.resolve(
            config: config,
            geometry: geometry ?? visibleGeometry,
            localize: fallbackOnly
        )
    }

    func testHiddenWhenHeroInView() {
        XCTAssertFalse(resolve(StickyCompactHeroConfig(status: .healthy), geometry: hiddenGeometry).isVisible)
    }

    func testVisibleWhenScrolledPast() {
        XCTAssertTrue(resolve(StickyCompactHeroConfig(status: .healthy)).isVisible)
    }

    func testPerStatusIconAndHeadline() {
        for status in StickyCompactHeroStatus.allCases {
            let presentation = resolve(StickyCompactHeroConfig(status: status))
            XCTAssertEqual(presentation.status, status)
            XCTAssertEqual(presentation.iconSystemName, status.iconSystemName)
            XCTAssertEqual(presentation.headline, status.headlineFallback)
        }
    }

    func testRefreshAffordanceBranch() {
        XCTAssertFalse(resolve(StickyCompactHeroConfig(status: .healthy, hasRefresh: false)).showsRefresh)
        let withRefresh = resolve(StickyCompactHeroConfig(status: .healthy, hasRefresh: true, refreshing: true))
        XCTAssertTrue(withRefresh.showsRefresh)
        XCTAssertTrue(withRefresh.isRefreshing)
    }

    func testLastCheckedBranch() {
        XCTAssertFalse(resolve(StickyCompactHeroConfig(status: .healthy)).showsLastChecked)
        let withLabel = resolve(StickyCompactHeroConfig(status: .healthy, lastCheckedLabel: "12s ago"))
        XCTAssertTrue(withLabel.showsLastChecked)
        XCTAssertEqual(withLabel.lastCheckedLabel, "12s ago")
    }

    func testAccessibilityLabels() {
        let presentation = resolve(StickyCompactHeroConfig(status: .healthy))
        XCTAssertEqual(presentation.regionLabel, "Status summary")
        XCTAssertEqual(presentation.scrollToTopLabel, "Scroll to top of page")
        XCTAssertEqual(presentation.refreshLabel, "Refresh status")
        XCTAssertEqual(presentation.refreshingValue, "Refreshing")
    }

    func testRegionValueComposition() {
        let noLabel = resolve(StickyCompactHeroConfig(status: .degraded))
        XCTAssertEqual(noLabel.regionValue, "Degraded", "headline alone when there is no last-checked label")
        let withLabel = resolve(StickyCompactHeroConfig(status: .degraded, lastCheckedLabel: "12s ago"))
        XCTAssertEqual(withLabel.regionValue, "Degraded · 12s ago")
    }

    func testLocalizedHeadlineUsesResolver() {
        let localize: StickyCompactHeroLocalize = { key, _ in
            key == "stickyCompactHero.status.healthy" ? "Tout opérationnel" : "?"
        }
        let presentation = StickyCompactHeroProjection.resolve(
            config: StickyCompactHeroConfig(status: .healthy),
            geometry: visibleGeometry,
            localize: localize
        )
        XCTAssertEqual(presentation.headline, "Tout opérationnel")
    }

    func testTopOffsetPassThrough() {
        XCTAssertEqual(resolve(StickyCompactHeroConfig(status: .healthy, topOffset: 56)).topOffset, 56)
    }
}
