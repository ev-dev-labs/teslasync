//
//  TourOverlay.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0145 · TourOverlay (Apple)
//
//  Pure-core coverage for the TourOverlay surface — the SwiftUI parity of
//  `components/feedback/TourOverlay.tsx`:
//    • Placement — the web `'top' | 'bottom' | 'left' | 'right'` raw values + case set.
//    • Spotlight — the web `spotlight` 6pt cutout grow (default + custom pad + the CGRect).
//    • Tooltip positioner — the verbatim `getTooltipPosition` port: `maxWidth`, every placement's
//      anchors, the `clampLeft` / `clampTop` clamps (both bounds), and the anchors→origin resolution.
//    • Progress dots — the web dot row (current / completed / upcoming boundaries, empty when zero).
//    • Step counter — the web `{currentStep + 1} / {totalSteps}`.
//    • Nav model — the web back / finish / next-arrow shapes + the primary key/fallback (incl. the
//      single-step finish).
//    • Projection — every render branch across loading / loaded / empty / failed × anchor present.
//    • Accessibility — the templated `tour.dialogLabel` substitution.
//
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no rendered view: each
//  assertion reads the pure adapter directly.
//

import CoreGraphics
import XCTest
@testable import TeslaSync

// MARK: - Helpers

private let identityLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

private func rect(
    _ x: CGFloat,
    _ y: CGFloat,
    _ width: CGFloat,
    _ height: CGFloat
) -> TourOverlayTargetRect {
    TourOverlayTargetRect(x: x, y: y, width: width, height: height)
}

// MARK: - Placement

final class TourOverlayPlacementTests: XCTestCase {
    func testRawValuesMatchWeb() {
        XCTAssertEqual(TourOverlayPlacement.top.rawValue, "top")
        XCTAssertEqual(TourOverlayPlacement.bottom.rawValue, "bottom")
        XCTAssertEqual(TourOverlayPlacement.left.rawValue, "left")
        XCTAssertEqual(TourOverlayPlacement.right.rawValue, "right")
    }

    func testHasExactlyTheFourWebPlacements() {
        XCTAssertEqual(TourOverlayPlacement.allCases.count, 4)
    }
}

// MARK: - Spotlight geometry (web `spotlight`)

final class TourOverlaySpotlightGeometryTests: XCTestCase {
    func testDefaultPaddingMatchesWebSix() {
        XCTAssertEqual(TourOverlaySpotlightGeometry.padding, 6, accuracy: 0.0001)
    }

    func testFrameGrowsTargetByPaddingOnEveryEdge() {
        let spotlight = TourOverlaySpotlightGeometry.frame(for: rect(100, 200, 120, 40))
        XCTAssertEqual(spotlight.x, 94, accuracy: 0.0001)
        XCTAssertEqual(spotlight.y, 194, accuracy: 0.0001)
        XCTAssertEqual(spotlight.width, 132, accuracy: 0.0001)
        XCTAssertEqual(spotlight.height, 52, accuracy: 0.0001)
    }

    func testFrameHonoursACustomPadding() {
        let spotlight = TourOverlaySpotlightGeometry.frame(for: rect(100, 200, 120, 40), padding: 10)
        XCTAssertEqual(spotlight.x, 90, accuracy: 0.0001)
        XCTAssertEqual(spotlight.y, 190, accuracy: 0.0001)
        XCTAssertEqual(spotlight.width, 140, accuracy: 0.0001)
        XCTAssertEqual(spotlight.height, 60, accuracy: 0.0001)
    }

    func testRectExposesTheCutoutAsCGRect() {
        let spotlight = TourOverlaySpotlightGeometry.frame(for: rect(100, 200, 120, 40))
        XCTAssertEqual(spotlight.rect, CGRect(x: 94, y: 194, width: 132, height: 52))
    }
}

// MARK: - Tooltip positioner (web `getTooltipPosition`)

final class TourOverlayTooltipPositionerTests: XCTestCase {
    private let viewport = TourOverlayViewport(width: 1200, height: 900)
    /// left=300, top=250, right=460, bottom=300
    private var target: TourOverlayTargetRect {
        rect(300, 250, 160, 50)
    }

    func testMaxWidthMatchesWebClamp() {
        XCTAssertEqual(TourOverlayTooltipPositioner.maxWidth(viewport: viewport), 360, accuracy: 0.0001)
        let narrow = TourOverlayViewport(width: 320, height: 700)
        // min(360, 320 - 32) = 288
        XCTAssertEqual(TourOverlayTooltipPositioner.maxWidth(viewport: narrow), 288, accuracy: 0.0001)
    }

    func testBottomPlacementAnchorsTopLeft() throws {
        let layout = TourOverlayTooltipPositioner.layout(placement: .bottom, rect: target, viewport: viewport)
        XCTAssertEqual(try XCTUnwrap(layout.top), 316, accuracy: 0.0001) // clampTop(300 + 16)
        XCTAssertEqual(try XCTUnwrap(layout.left), 300, accuracy: 0.0001) // clampLeft(300)
        XCTAssertNil(layout.bottom)
        XCTAssertNil(layout.right)
        XCTAssertEqual(layout.maxWidth, 360, accuracy: 0.0001)
    }

    func testTopPlacementAnchorsBottomLeft() throws {
        let layout = TourOverlayTooltipPositioner.layout(placement: .top, rect: target, viewport: viewport)
        XCTAssertEqual(try XCTUnwrap(layout.bottom), 666, accuracy: 0.0001) // max(88, 900 - 250 + 16)
        XCTAssertEqual(try XCTUnwrap(layout.left), 300, accuracy: 0.0001)
        XCTAssertNil(layout.top)
        XCTAssertNil(layout.right)
    }

    func testRightPlacementAnchorsTopLeftPastTheElement() throws {
        let layout = TourOverlayTooltipPositioner.layout(placement: .right, rect: target, viewport: viewport)
        XCTAssertEqual(try XCTUnwrap(layout.top), 250, accuracy: 0.0001) // clampTop(250)
        XCTAssertEqual(try XCTUnwrap(layout.left), 476, accuracy: 0.0001) // clampLeft(460 + 16)
        XCTAssertNil(layout.bottom)
        XCTAssertNil(layout.right)
    }

    func testLeftPlacementAnchorsTopRight() throws {
        let layout = TourOverlayTooltipPositioner.layout(placement: .left, rect: target, viewport: viewport)
        XCTAssertEqual(try XCTUnwrap(layout.top), 250, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(layout.right), 916, accuracy: 0.0001) // max(16, 1200 - 300 + 16)
        XCTAssertNil(layout.bottom)
        XCTAssertNil(layout.left)
    }

    func testClampLeftAndClampTopHitBothBounds() throws {
        let tight = TourOverlayViewport(width: 400, height: 500)
        // Upper bound: clampLeft -> 400 - 360 - 16 = 24; clampTop -> 500 - 72 - 160 = 268.
        let high = TourOverlayTooltipPositioner.layout(
            placement: .bottom, rect: rect(380, 600, 10, 10), viewport: tight
        )
        XCTAssertEqual(try XCTUnwrap(high.left), 24, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(high.top), 268, accuracy: 0.0001)

        // Lower bound: both clamp to pad (16).
        let low = TourOverlayTooltipPositioner.layout(
            placement: .bottom, rect: rect(5, -120, 10, 10), viewport: tight
        )
        XCTAssertEqual(try XCTUnwrap(low.left), 16, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(low.top), 16, accuracy: 0.0001)
    }

    func testOriginResolvesTopLeftAnchorsDirectly() {
        let layout = TourOverlayTooltipLayout(top: 316, left: 300, maxWidth: 360)
        let origin = TourOverlayTooltipPositioner.origin(
            layout: layout, viewport: viewport, tooltipSize: CGSize(width: 360, height: 200)
        )
        XCTAssertEqual(origin.x, 300, accuracy: 0.0001)
        XCTAssertEqual(origin.y, 316, accuracy: 0.0001)
    }

    func testOriginResolvesBottomAnchorFromMeasuredHeight() {
        let layout = TourOverlayTooltipLayout(bottom: 666, left: 300, maxWidth: 360)
        let origin = TourOverlayTooltipPositioner.origin(
            layout: layout, viewport: viewport, tooltipSize: CGSize(width: 360, height: 200)
        )
        // vh - bottom - height = 900 - 666 - 200
        XCTAssertEqual(origin.y, 34, accuracy: 0.0001)
        XCTAssertEqual(origin.x, 300, accuracy: 0.0001)
    }

    func testOriginResolvesRightAnchorFromMeasuredWidth() {
        let layout = TourOverlayTooltipLayout(top: 250, right: 900, maxWidth: 360)
        let origin = TourOverlayTooltipPositioner.origin(
            layout: layout, viewport: viewport, tooltipSize: CGSize(width: 360, height: 200)
        )
        // vw - right - width = 1200 - 900 - 360
        XCTAssertEqual(origin.x, -60, accuracy: 0.0001)
        XCTAssertEqual(origin.y, 250, accuracy: 0.0001)
    }
}

// MARK: - Progress dots

final class TourOverlayProgressTests: XCTestCase {
    func testDotsMarkCurrentCompletedAndUpcoming() {
        let dots = TourOverlayProgress.dots(currentStep: 1, totalSteps: 4)
        XCTAssertEqual(dots.map(\.id), [0, 1, 2, 3])
        XCTAssertEqual(dots.map(\.state), [.completed, .current, .upcoming, .upcoming])
        XCTAssertEqual(dots.filter(\.state.isCurrent).map(\.id), [1])
    }

    func testDotsAreEmptyForZeroSteps() {
        XCTAssertTrue(TourOverlayProgress.dots(currentStep: 0, totalSteps: 0).isEmpty)
    }

    func testLastStepMarksEveryPriorDotCompleted() {
        let dots = TourOverlayProgress.dots(currentStep: 2, totalSteps: 3)
        XCTAssertEqual(dots.map(\.state), [.completed, .completed, .current])
    }
}

// MARK: - Step counter

final class TourOverlayStepCounterTests: XCTestCase {
    func testCounterIsOneIndexedOverTotal() {
        XCTAssertEqual(TourOverlayStepCounter.text(currentStep: 0, totalSteps: 4), "1 / 4")
        XCTAssertEqual(TourOverlayStepCounter.text(currentStep: 3, totalSteps: 4), "4 / 4")
    }
}

// MARK: - Navigation model

final class TourOverlayNavTests: XCTestCase {
    func testFirstStepHidesBackAndShowsNextWithArrow() {
        let nav = TourOverlayNav.model(currentStep: 0, totalSteps: 4)
        XCTAssertFalse(nav.showsBack)
        XCTAssertFalse(nav.isLastStep)
        XCTAssertTrue(nav.showsNextArrow)
        XCTAssertEqual(nav.primaryTitleKey, "tour.next")
        XCTAssertEqual(nav.primaryTitleFallback, "Next")
    }

    func testMiddleStepShowsBackAndNext() {
        let nav = TourOverlayNav.model(currentStep: 1, totalSteps: 4)
        XCTAssertTrue(nav.showsBack)
        XCTAssertFalse(nav.isLastStep)
        XCTAssertTrue(nav.showsNextArrow)
    }

    func testLastStepShowsFinishWithoutArrow() {
        let nav = TourOverlayNav.model(currentStep: 3, totalSteps: 4)
        XCTAssertTrue(nav.showsBack)
        XCTAssertTrue(nav.isLastStep)
        XCTAssertFalse(nav.showsNextArrow)
        XCTAssertEqual(nav.primaryTitleKey, "tour.finish")
        XCTAssertEqual(nav.primaryTitleFallback, "Get Started!")
    }

    func testSingleStepTourIsImmediatelyTheFinish() {
        let nav = TourOverlayNav.model(currentStep: 0, totalSteps: 1)
        XCTAssertFalse(nav.showsBack)
        XCTAssertTrue(nav.isLastStep)
        XCTAssertFalse(nav.showsNextArrow)
        XCTAssertEqual(nav.primaryTitleKey, "tour.finish")
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class TourOverlayProjectionTests: XCTestCase {
    func testLoadingWithoutAnchorIsLoading() {
        XCTAssertEqual(TourOverlayProjection.resolve(status: .loading, hasAnchor: false), .loading)
    }

    func testLoadingWithCachedAnchorShowsData() {
        XCTAssertEqual(TourOverlayProjection.resolve(status: .loading, hasAnchor: true), .data)
    }

    func testLoadedWithoutAnchorIsEmpty() {
        XCTAssertEqual(TourOverlayProjection.resolve(status: .loaded, hasAnchor: false), .empty)
    }

    func testLoadedWithAnchorIsData() {
        XCTAssertEqual(TourOverlayProjection.resolve(status: .loaded, hasAnchor: true), .data)
    }

    func testEmptyStatusIsAlwaysEmpty() {
        XCTAssertEqual(TourOverlayProjection.resolve(status: .empty, hasAnchor: false), .empty)
        XCTAssertEqual(TourOverlayProjection.resolve(status: .empty, hasAnchor: true), .empty)
    }

    func testFailedWithoutAnchorIsErrorWithMessage() {
        XCTAssertEqual(TourOverlayProjection.resolve(status: .failed("boom"), hasAnchor: false), .error("boom"))
    }

    func testFailedWithCachedAnchorKeepsShowingData() {
        XCTAssertEqual(TourOverlayProjection.resolve(status: .failed("boom"), hasAnchor: true), .data)
    }
}

// MARK: - Accessibility

final class TourOverlayAccessibilityTests: XCTestCase {
    func testDialogLabelSubstitutesOneIndexedStepAndTotal() {
        let label = TourOverlayAccessibility.dialogLabel(
            currentStep: 0, totalSteps: 4, localize: identityLocalize
        )
        XCTAssertEqual(label, "Tour step 1 of 4")
    }

    func testDialogLabelSubstitutesArbitraryStep() {
        let label = TourOverlayAccessibility.dialogLabel(
            currentStep: 2, totalSteps: 5, localize: identityLocalize
        )
        XCTAssertEqual(label, "Tour step 3 of 5")
    }
}
