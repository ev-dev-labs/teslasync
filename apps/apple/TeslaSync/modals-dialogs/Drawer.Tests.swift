//
//  Drawer.Tests.swift
//  TeslaSync — P4 modal / dialog · 0013 · Drawer (Apple)
//
//  Adapter + projection + accessibility coverage for the Drawer surface:
//    • `DrawerEdge.from(web:)` — the web `side` ('left' | 'right', default 'right') mapping.
//    • `DrawerProjection.resolvePhase` — the loading / empty / error / content envelope, incl. the
//      keep-cached-rows-through-a-failed-reload rule.
//    • `DrawerProjection.reloadFailure` — the cached-rows-with-failure banner message.
//    • `DrawerProjection.dialogLabel` — the web `aria-label={title || 'Panel'}`.
//    • `DrawerProjection.countSummary` — the footer singular/plural count with `{{count}}` substitution.
//    • `DrawerAccessibility` — the per-state VoiceOver summary (+ freshness suffix), close, dismiss.
//
//  Pure, bundle-free: copy resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the real copy without a
/// bundle (the projection then applies any `{{count}}` substitution on top).
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - Edge (web `side`)

final class DrawerEdgeTests: XCTestCase {
    func testRightAndDefaultResolveTrailing() {
        XCTAssertEqual(DrawerEdge.from(web: "right"), .trailing)
        XCTAssertEqual(DrawerEdge.from(web: nil), .trailing)
        XCTAssertEqual(DrawerEdge.from(web: ""), .trailing)
    }

    func testLeftResolvesLeadingCaseAndSpaceInsensitive() {
        XCTAssertEqual(DrawerEdge.from(web: "left"), .leading)
        XCTAssertEqual(DrawerEdge.from(web: "LEFT"), .leading)
        XCTAssertEqual(DrawerEdge.from(web: "  Left "), .leading)
    }

    func testUnknownFallsBackToTrailing() {
        XCTAssertEqual(DrawerEdge.from(web: "top"), .trailing)
    }
}

// MARK: - Phase resolution

final class DrawerPhaseTests: XCTestCase {
    func testLoadingResolvesByItemPresence() {
        XCTAssertEqual(DrawerProjection.resolvePhase(status: .loading, hasItems: false), .loading)
        XCTAssertEqual(DrawerProjection.resolvePhase(status: .loading, hasItems: true), .content)
    }

    func testLoadedNoItemsResolvesEmpty() {
        XCTAssertEqual(DrawerProjection.resolvePhase(status: .loaded, hasItems: false), .empty)
    }

    func testLoadedWithItemsResolvesContent() {
        XCTAssertEqual(DrawerProjection.resolvePhase(status: .loaded, hasItems: true), .content)
    }

    func testFailedResolvesErrorOrKeepsContent() {
        XCTAssertEqual(DrawerProjection.resolvePhase(status: .failed("boom"), hasItems: false), .error("boom"))
        XCTAssertEqual(DrawerProjection.resolvePhase(status: .failed("boom"), hasItems: true), .content)
    }
}

// MARK: - Reload-failure banner

final class DrawerReloadFailureTests: XCTestCase {
    func testFailureWithCachedItemsSurfacesMessage() {
        XCTAssertEqual(DrawerProjection.reloadFailure(status: .failed("stale read"), hasItems: true), "stale read")
    }

    func testFailureWithNoItemsIsNil() {
        XCTAssertNil(DrawerProjection.reloadFailure(status: .failed("x"), hasItems: false))
    }

    func testNonFailureIsNil() {
        XCTAssertNil(DrawerProjection.reloadFailure(status: .loaded, hasItems: true))
        XCTAssertNil(DrawerProjection.reloadFailure(status: .loading, hasItems: true))
    }
}

// MARK: - Dialog label (web aria-label title || Panel)

final class DrawerDialogLabelTests: XCTestCase {
    func testTitleLabelsTheDialog() {
        XCTAssertEqual(
            DrawerProjection.dialogLabel(title: "Vehicle details", localize: passthroughLocalize),
            "Vehicle details"
        )
    }

    func testNilOrBlankTitleFallsBackToPanel() {
        XCTAssertEqual(DrawerProjection.dialogLabel(title: nil, localize: passthroughLocalize), "Panel")
        XCTAssertEqual(DrawerProjection.dialogLabel(title: "   ", localize: passthroughLocalize), "Panel")
    }
}

// MARK: - Footer count summary

final class DrawerCountSummaryTests: XCTestCase {
    func testSingularAndPluralSubstituteCount() {
        XCTAssertEqual(DrawerProjection.countSummary(1, localize: passthroughLocalize), "1 item")
        XCTAssertEqual(DrawerProjection.countSummary(4, localize: passthroughLocalize), "4 items")
        XCTAssertEqual(DrawerProjection.countSummary(0, localize: passthroughLocalize), "0 items")
    }
}

// MARK: - Accessibility

final class DrawerAccessibilityTests: XCTestCase {
    func testSummaryIsPhaseWordWhenLive() {
        XCTAssertEqual(
            DrawerAccessibility.summary(phase: .content, connection: .live, localize: passthroughLocalize),
            "Content loaded"
        )
        XCTAssertEqual(
            DrawerAccessibility.summary(phase: .empty, connection: .live, localize: passthroughLocalize),
            "No content"
        )
    }

    func testSummaryAppendsFreshnessWhenNotLive() {
        XCTAssertEqual(
            DrawerAccessibility.summary(phase: .content, connection: .stale, localize: passthroughLocalize),
            "Content loaded, Stale"
        )
        XCTAssertEqual(
            DrawerAccessibility.summary(phase: .content, connection: .offline, localize: passthroughLocalize),
            "Content loaded, Offline"
        )
    }

    func testErrorAndLoadingSummaries() {
        XCTAssertEqual(
            DrawerAccessibility.summary(phase: .error("x"), connection: .live, localize: passthroughLocalize),
            "Failed to load content"
        )
        XCTAssertEqual(
            DrawerAccessibility.summary(phase: .loading, connection: .live, localize: passthroughLocalize),
            "Loading content"
        )
    }

    func testCloseAndDismissLabels() {
        XCTAssertEqual(DrawerAccessibility.closeLabel(localize: passthroughLocalize), "Close")
        XCTAssertEqual(DrawerAccessibility.dismissLabel(localize: passthroughLocalize), "Dismiss")
    }
}
