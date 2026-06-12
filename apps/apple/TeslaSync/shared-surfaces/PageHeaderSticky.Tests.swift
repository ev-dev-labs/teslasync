//
//  PageHeaderSticky.Tests.swift
//  TeslaSync — P4 shared surface · 0172 · PageHeaderSticky (Apple)
//
//  The model + view-composition + i18n half of the coverage (the pure config + visibility + projection
//  live in PageHeaderSticky.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • PageHeaderStickyModel — initial hidden state, geometry-driven visibility flips, the
//      unchanged-update no-op (the parity of React re-rendering only when `visible` changes), the
//      once-only `view.opened`, and config passthrough.
//    • Views — the bar (scroll-to-top + plain), the `.pageHeaderSticky` / `.pageHeaderStickyTarget`
//      modifier spellings, the inspector + live + scenario samples compose; copy resolves through P1/S10.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the model is in-process.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - PageHeaderStickyModel (web `useState(visible)` + IntersectionObserver effect)

@MainActor
final class PageHeaderStickyModelTests: XCTestCase {
    private func makeModel(
        scrollToTop: Bool = true,
        topOffset: CGFloat = 0,
        spy: SpyPageHeaderStickyTelemetry = SpyPageHeaderStickyTelemetry()
    ) -> PageHeaderStickyModel {
        PageHeaderStickyModel(
            config: PageHeaderStickyConfig(
                targetID: "drives-overview",
                ariaLabel: "Drive history summary",
                scrollToTop: scrollToTop,
                topOffset: topOffset
            ),
            telemetry: spy,
            localize: { _, fallback in fallback }
        )
    }

    private let visibleGeometry = PageHeaderStickyGeometry(targetTop: -120, targetBottom: -20, viewportHeight: 800)
    private let hiddenGeometry = PageHeaderStickyGeometry(targetTop: 100, targetBottom: 300, viewportHeight: 800)

    func testInitialPresentationIsHidden() {
        let model = makeModel()
        XCTAssertFalse(model.isVisible, "the bar starts hidden (web useState(false))")
        XCTAssertEqual(model.presentation.regionLabel, "Drive history summary")
    }

    func testUpdateGeometryRevealsBar() {
        let model = makeModel()
        model.updateGeometry(visibleGeometry)
        XCTAssertTrue(model.isVisible)
    }

    func testUpdateGeometryHidesAgain() {
        let model = makeModel()
        model.updateGeometry(visibleGeometry)
        XCTAssertTrue(model.isVisible)
        model.updateGeometry(hiddenGeometry)
        XCTAssertFalse(model.isVisible, "scrolling the hero back into view hides the bar")
    }

    func testUnchangedUpdateKeepsPresentationStable() {
        let model = makeModel()
        model.updateGeometry(visibleGeometry)
        let first = model.presentation
        // A different scroll tick that does NOT flip visibility resolves to an equal presentation.
        model.updateGeometry(PageHeaderStickyGeometry(targetTop: -200, targetBottom: -80, viewportHeight: 800))
        XCTAssertEqual(model.presentation, first, "a tick that doesn't flip visibility yields an equal presentation")
    }

    func testConfigurationPassThrough() {
        let model = makeModel(scrollToTop: false, topOffset: 56)
        XCTAssertEqual(model.configuration.topOffset, 56)
        XCTAssertFalse(model.configuration.scrollToTop)
        XCTAssertEqual(model.presentation.mode, .plain)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyPageHeaderStickyTelemetry()
        let model = makeModel(spy: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [PageHeaderStickySurface.slug], "view.opened fires once per instance")
    }
}

// MARK: - Views (every branch composes + label presence)

@MainActor
final class PageHeaderStickyViewTests: XCTestCase {
    func testBarComposesForBothModes() {
        _ = PageHeaderStickyBar(
            presentation: PageHeaderStickySampleData.presentation(mode: .scrollToTop),
            onScrollToTop: {},
            summary: { Text(verbatim: "summary") }
        )
        _ = PageHeaderStickyBar(
            presentation: PageHeaderStickySampleData.presentation(mode: .plain)
        ) { Text(verbatim: "summary") }
    }

    func testModifierSpellingsCompose() {
        _ = ScrollView { Text(verbatim: "hero").pageHeaderStickyTarget() }
            .pageHeaderSticky(targetID: "drives-overview", ariaLabel: "Drive history summary") {
                Text(verbatim: "summary")
            }
        let model = PageHeaderStickyModel(
            config: PageHeaderStickyConfig(targetID: "t", ariaLabel: "a")
        )
        _ = ScrollView { Text(verbatim: "hero") }
            .pageHeaderSticky(model: model) { Text(verbatim: "summary") }
    }

    func testInspectorAndSamplesCompose() {
        _ = PageHeaderStickyInspector()
        _ = PageHeaderStickyLiveSample()
        _ = PageHeaderStickyHiddenRow()
        for scenario in PageHeaderStickyScenario.allCases {
            _ = PageHeaderStickyScenarioRow(scenario: scenario)
        }
        XCTAssertEqual(PageHeaderStickyScenario.allCases.count, 3)
    }

    func testSampleDataPresentationsAreVisible() {
        XCTAssertTrue(PageHeaderStickySampleData.presentation(mode: .scrollToTop).isVisible)
        XCTAssertTrue(PageHeaderStickySampleData.presentation(mode: .plain).isVisible)
        XCTAssertFalse(PageHeaderStickySampleData.summary.isEmpty)
        XCTAssertFalse(PageHeaderStickySampleData.longSummary.isEmpty)
    }

    func testCopyResolvesFromCatalog() {
        XCTAssertEqual(
            PageHeaderStickyStrings.string("pageHeaderSticky.a11y.scrollToTopSuffix", "scroll to top"),
            "scroll to top"
        )
        XCTAssertEqual(PageHeaderStickyStrings.localize("any.key", "Fallback"), "Fallback")
        XCTAssertEqual(PageHeaderStickyStrings.table, "PageHeaderSticky")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it satisfies
/// the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyPageHeaderStickyTelemetry: PageHeaderStickyTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}
