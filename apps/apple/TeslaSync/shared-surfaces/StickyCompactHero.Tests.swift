//
//  StickyCompactHero.Tests.swift
//  TeslaSync — P4 shared surface · 0201 · StickyCompactHero (Apple)
//
//  The model + view-composition + i18n half of the coverage (the pure status / config / visibility /
//  projection live in StickyCompactHero.AdapterTests.swift; split to keep each file within the SwiftLint
//  file-length budget):
//    • StickyCompactHeroModel — the initial hidden state, the geometry-driven visibility flips, the
//      unchanged-update no-op (the parity of React re-rendering only when the output changes), the prop
//      update re-derive (status / refreshing), the refresh routing (invoked when idle, ignored while
//      refreshing or when no handler exists — the web `disabled={refreshing}` guard), the once-only
//      `view.opened`, and config passthrough.
//    • Views — the bar (every status + state), the refresh button, the `.stickyCompactHero` /
//      `.stickyCompactHeroTarget` modifier spellings, the inspector + live + scenario samples compose;
//      copy resolves through P1/S10.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the model is in-process.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - StickyCompactHeroModel (web `useState(visible)` + IntersectionObserver effect)

@MainActor
final class StickyCompactHeroModelTests: XCTestCase {
    private func makeModel(
        status: StickyCompactHeroStatus = .healthy,
        hasRefresh: Bool = true,
        refreshing: Bool = false,
        topOffset: CGFloat = 0,
        onRefresh: (@MainActor () -> Void)? = nil,
        spy: SpyStickyCompactHeroTelemetry = SpyStickyCompactHeroTelemetry()
    ) -> StickyCompactHeroModel {
        StickyCompactHeroModel(
            config: StickyCompactHeroConfig(
                status: status,
                lastCheckedLabel: "12s ago",
                hasRefresh: hasRefresh,
                refreshing: refreshing,
                topOffset: topOffset
            ),
            onRefresh: onRefresh,
            telemetry: spy,
            localize: { _, fallback in fallback }
        )
    }

    private let visibleGeometry = StickyCompactHeroGeometry(targetTop: -120, targetBottom: -20, viewportHeight: 800)
    private let hiddenGeometry = StickyCompactHeroGeometry(targetTop: 100, targetBottom: 300, viewportHeight: 800)

    func testInitialPresentationIsHidden() {
        let model = makeModel()
        XCTAssertFalse(model.isVisible, "the bar starts hidden (web useState(false))")
        XCTAssertEqual(model.presentation.regionLabel, "Status summary")
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

    func testUnchangedGeometryKeepsPresentationStable() {
        let model = makeModel()
        model.updateGeometry(visibleGeometry)
        let first = model.presentation
        model.updateGeometry(StickyCompactHeroGeometry(targetTop: -200, targetBottom: -80, viewportHeight: 800))
        XCTAssertEqual(model.presentation, first, "a tick that doesn't flip visibility yields an equal presentation")
    }

    func testUpdatePropsReDerivesStatusAndRefreshing() {
        let model = makeModel(status: .healthy, refreshing: false)
        model.updateGeometry(visibleGeometry)
        XCTAssertEqual(model.presentation.headline, "All operational")
        XCTAssertFalse(model.presentation.isRefreshing)
        model.update(
            StickyCompactHeroConfig(status: .unhealthy, hasRefresh: true, refreshing: true),
            onRefresh: nil
        )
        XCTAssertEqual(model.presentation.headline, "Outage", "a rebind to a new status re-derives the headline")
        XCTAssertTrue(model.presentation.isRefreshing)
        XCTAssertEqual(model.presentation.status, .unhealthy)
    }

    func testRefreshInvokesHandlerWhenIdle() {
        let recorder = RefreshRecorder()
        let model = makeModel(refreshing: false, onRefresh: { recorder.record() })
        model.refresh()
        XCTAssertEqual(recorder.count, 1, "an idle refresh routes out through onRefresh (web onClick)")
    }

    func testRefreshIgnoredWhileRefreshing() {
        let recorder = RefreshRecorder()
        let model = makeModel(refreshing: true, onRefresh: { recorder.record() })
        model.refresh()
        XCTAssertEqual(recorder.count, 0, "web disabled={refreshing} blocks a second in-flight refresh")
    }

    func testRefreshIgnoredWhenNoHandler() {
        let recorder = RefreshRecorder()
        let model = makeModel(hasRefresh: false, onRefresh: { recorder.record() })
        model.refresh()
        XCTAssertEqual(recorder.count, 0, "no refresh affordance → no refresh (web onRefresh absent)")
    }

    func testConfigurationPassThrough() {
        let model = makeModel(status: .maintenance, topOffset: 56)
        XCTAssertEqual(model.configuration.topOffset, 56)
        XCTAssertEqual(model.configuration.status, .maintenance)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyStickyCompactHeroTelemetry()
        let model = makeModel(spy: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [StickyCompactHeroSurface.slug], "view.opened fires once per instance")
    }
}

// MARK: - Views (every branch composes + label presence)

@MainActor
final class StickyCompactHeroViewTests: XCTestCase {
    func testBarComposesForEveryStatus() {
        for status in StickyCompactHeroStatus.allCases {
            _ = StickyCompactHeroBar(
                presentation: StickyCompactHeroSampleData.presentation(status: status),
                onScrollToTop: {},
                onRefresh: {}
            )
        }
    }

    func testBarComposesForEveryState() {
        _ = StickyCompactHeroBar(
            presentation: StickyCompactHeroSampleData.presentation(status: .healthy, refreshing: true),
            onScrollToTop: {},
            onRefresh: {}
        )
        _ = StickyCompactHeroBar(
            presentation: StickyCompactHeroSampleData.presentation(
                status: .healthy,
                showsLastChecked: false,
                hasRefresh: false
            ),
            onScrollToTop: {}
        )
        _ = StickyCompactHeroRefreshButton(
            label: "Refresh status",
            refreshingValue: "Refreshing",
            isRefreshing: true,
            action: {}
        )
    }

    func testModifierSpellingsCompose() {
        _ = ScrollView { Text(verbatim: "hero").stickyCompactHeroTarget() }
            .stickyCompactHero(status: .healthy, lastCheckedLabel: "12s ago", onRefresh: {}, refreshing: false)
        let model = StickyCompactHeroModel(config: StickyCompactHeroConfig(status: .degraded))
        _ = ScrollView { Text(verbatim: "hero") }
            .stickyCompactHero(model: model, onRefresh: {})
    }

    func testInspectorAndSamplesCompose() {
        _ = StickyCompactHeroInspector()
        _ = StickyCompactHeroLiveSample()
        _ = StickyCompactHeroHiddenRow()
        for scenario in StickyCompactHeroScenario.allCases {
            _ = StickyCompactHeroScenarioRow(scenario: scenario)
        }
        XCTAssertEqual(StickyCompactHeroScenario.allCases.count, 8)
    }

    func testSampleDataPresentationsAreVisible() {
        for status in StickyCompactHeroStatus.allCases {
            XCTAssertTrue(StickyCompactHeroSampleData.presentation(status: status).isVisible)
        }
        XCTAssertFalse(StickyCompactHeroSampleData.lastChecked.isEmpty)
    }
}

// MARK: - Strings facade (P1/S10)

final class StickyCompactHeroStringsTests: XCTestCase {
    func testStatusHeadlineFallbacks() {
        XCTAssertEqual(
            StickyCompactHeroStrings.string("stickyCompactHero.status.healthy", "All operational"),
            "All operational"
        )
        XCTAssertEqual(StickyCompactHeroStrings.string("stickyCompactHero.status.unhealthy", "Outage"), "Outage")
    }

    func testAccessibilityFallbacks() {
        XCTAssertEqual(
            StickyCompactHeroStrings.string("stickyCompactHero.region", "Status summary"),
            "Status summary"
        )
        XCTAssertEqual(StickyCompactHeroStrings.localize("any.key", "Fallback"), "Fallback")
        XCTAssertEqual(StickyCompactHeroStrings.table, "StickyCompactHero")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it satisfies
/// the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyStickyCompactHeroTelemetry: StickyCompactHeroTelemetry, @unchecked Sendable {
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

/// Records refresh-handler invocations routed out through the page `onRefresh` (the `@MainActor` closure
/// seam).
@MainActor
private final class RefreshRecorder {
    private(set) var count = 0

    func record() {
        count += 1
    }
}
