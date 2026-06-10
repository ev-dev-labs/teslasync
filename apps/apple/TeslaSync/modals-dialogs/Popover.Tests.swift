//
//  Popover.Tests.swift
//  TeslaSync — P4 modal / dialog · 0015 · Popover (Apple)
//
//  Geometry + accessibility coverage for the `Popover` primitive — the parity-critical core:
//    • `PopoverGeometry.resolveSide` — the web flip rule in both directions (and the no-flip arms
//      when the requested side fits or the opposite side has no more room).
//    • `PopoverGeometry.place` — the full `compute()` port: bottom / top placement, the start / end /
//      center cross-axis alignment, and the horizontal + vertical viewport clamps.
//    • `PopoverGeometry.availableContentSize` — the per-side fit cap (+ the non-negative guard).
//    • `PopoverAccessibility` / `PopoverStrings` — the region / dismiss / empty labels (the custom
//      `ariaLabel` vs. localized default) and the facade fallback resolution.
//
//  The state-holder coverage lives in Popover.ModelTests.swift. Pure + bundle-free: copy resolves
//  through an identity localizer.
//

import CoreGraphics
import XCTest
@testable import TeslaSync

private let echoFallback: @Sendable (String, String) -> String = { _, fallback in fallback }

final class PopoverGeometryTests: XCTestCase {
    private let viewport = CGSize(width: 1000, height: 800)
    private let anchor = CGRect(x: 100, y: 100, width: 80, height: 40)
    private let content = CGSize(width: 200, height: 120)

    // MARK: resolveSide (web flip)

    func testResolveSideKeepsBottomWhenItFits() {
        XCTAssertEqual(
            PopoverGeometry.resolveSide(.bottom, contentHeight: 100, spaceAbove: 300, spaceBelow: 400),
            .bottom
        )
    }

    func testResolveSideFlipsBottomToTopWhenAboveHasMoreRoom() {
        XCTAssertEqual(
            PopoverGeometry.resolveSide(.bottom, contentHeight: 300, spaceAbove: 400, spaceBelow: 200),
            .top
        )
    }

    func testResolveSideKeepsBottomWhenAboveIsNotRoomier() {
        // Overflows below, but above has no more space → no flip (web `spaceAbove > spaceBelow`).
        XCTAssertEqual(
            PopoverGeometry.resolveSide(.bottom, contentHeight: 300, spaceAbove: 150, spaceBelow: 200),
            .bottom
        )
    }

    func testResolveSideFlipsTopToBottomWhenBelowHasMoreRoom() {
        XCTAssertEqual(
            PopoverGeometry.resolveSide(.top, contentHeight: 300, spaceAbove: 200, spaceBelow: 400),
            .bottom
        )
    }

    func testResolveSideKeepsTopWhenItFits() {
        XCTAssertEqual(
            PopoverGeometry.resolveSide(.top, contentHeight: 100, spaceAbove: 400, spaceBelow: 200),
            .top
        )
    }

    // MARK: place — sides

    func testPlaceBottomStart() {
        let placement = PopoverGeometry.place(
            anchor: anchor, content: content, viewport: viewport, side: .bottom, align: .start
        )
        XCTAssertEqual(placement.resolvedSide, .bottom)
        XCTAssertEqual(placement.top, 146, accuracy: 0.0001) // maxY(140) + sideOffset(6)
        XCTAssertEqual(placement.left, 100, accuracy: 0.0001) // anchor.minX
    }

    func testPlaceTopNoFlipWhenRoomy() {
        let lowAnchor = CGRect(x: 100, y: 400, width: 80, height: 40)
        let placement = PopoverGeometry.place(
            anchor: lowAnchor, content: content, viewport: viewport, side: .top, align: .start
        )
        XCTAssertEqual(placement.resolvedSide, .top)
        XCTAssertEqual(placement.top, 274, accuracy: 0.0001) // minY(400) - sideOffset(6) - height(120)
        XCTAssertEqual(placement.left, 100, accuracy: 0.0001)
    }

    func testPlaceFlipsToTopForBottomAnchor() {
        let bottomAnchor = CGRect(x: 100, y: 760, width: 80, height: 30)
        let placement = PopoverGeometry.place(
            anchor: bottomAnchor, content: content, viewport: viewport, side: .bottom, align: .start
        )
        XCTAssertEqual(placement.resolvedSide, .top) // not enough room below → flips up
    }

    // MARK: place — alignment

    func testPlaceAlignCenter() {
        let placement = PopoverGeometry.place(
            anchor: anchor, content: content, viewport: viewport, side: .bottom, align: .center
        )
        // anchorCenterX(140) - content.width/2(100) = 40
        XCTAssertEqual(placement.left, 40, accuracy: 0.0001)
    }

    func testPlaceAlignEnd() {
        let rightAnchor = CGRect(x: 500, y: 100, width: 80, height: 40)
        let placement = PopoverGeometry.place(
            anchor: rightAnchor, content: content, viewport: viewport, side: .bottom, align: .end
        )
        // maxX(580) - content.width(200) = 380
        XCTAssertEqual(placement.left, 380, accuracy: 0.0001)
    }

    // MARK: place — clamps

    func testPlaceClampsRightEdge() {
        let rightAnchor = CGRect(x: 900, y: 100, width: 80, height: 40)
        let placement = PopoverGeometry.place(
            anchor: rightAnchor, content: content, viewport: viewport, side: .bottom, align: .start
        )
        // 900 + 200 + 8 > 1000 → left = 1000 - 200 - 8
        XCTAssertEqual(placement.left, 792, accuracy: 0.0001)
    }

    func testPlaceClampsLeftEdge() {
        let edgeAnchor = CGRect(x: 4, y: 100, width: 20, height: 40)
        let placement = PopoverGeometry.place(
            anchor: edgeAnchor, content: content, viewport: viewport, side: .bottom, align: .start
        )
        XCTAssertEqual(placement.left, PopoverGeometry.margin, accuracy: 0.0001) // clamped to 8
    }

    func testPlaceClampsVerticallyWhenBothSidesOverflow() {
        let tinyViewport = CGSize(width: 300, height: 150)
        let smallAnchor = CGRect(x: 10, y: 10, width: 50, height: 20)
        let tallContent = CGSize(width: 200, height: 200)
        let placement = PopoverGeometry.place(
            anchor: smallAnchor, content: tallContent, viewport: tinyViewport, side: .bottom, align: .start
        )
        XCTAssertEqual(placement.top, PopoverGeometry.margin, accuracy: 0.0001) // clamped to top margin
    }

    // MARK: availableContentSize

    func testAvailableContentSizeBottom() {
        let size = PopoverGeometry.availableContentSize(anchor: anchor, viewport: viewport, side: .bottom)
        XCTAssertEqual(size.width, 984, accuracy: 0.0001) // 1000 - 2*8
        XCTAssertEqual(size.height, 646, accuracy: 0.0001) // 800 - 140 - 6 - 8
    }

    func testAvailableContentSizeTopGuardsNegative() {
        let highAnchor = CGRect(x: 10, y: 5, width: 40, height: 10)
        let size = PopoverGeometry.availableContentSize(anchor: highAnchor, viewport: viewport, side: .top)
        XCTAssertEqual(size.height, 0, accuracy: 0.0001) // 5 - 6 - 8 < 0 → guarded to 0
    }

    // MARK: axes

    func testSideOpposite() {
        XCTAssertEqual(PopoverSide.bottom.opposite, .top)
        XCTAssertEqual(PopoverSide.top.opposite, .bottom)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(PopoverSurfaceID.slug, "Popover")
    }
}

final class PopoverAccessibilityTests: XCTestCase {
    func testRegionLabelPrefersCustom() {
        XCTAssertEqual(
            PopoverAccessibility.regionLabel(custom: "Trip details", localize: echoFallback),
            "Trip details"
        )
    }

    func testRegionLabelFallsBackForBlankCustom() {
        XCTAssertEqual(
            PopoverAccessibility.regionLabel(custom: "   ", localize: echoFallback),
            PopoverAccessibility.regionFallback
        )
    }

    func testRegionLabelFallsBackForNilCustom() {
        XCTAssertEqual(
            PopoverAccessibility.regionLabel(custom: nil, localize: echoFallback),
            "Popover"
        )
    }

    func testDismissAndEmptyLabels() {
        XCTAssertEqual(PopoverAccessibility.dismissLabel(localize: echoFallback), "Dismiss")
        XCTAssertEqual(PopoverAccessibility.emptyLabel(localize: echoFallback), "Nothing to show")
    }

    func testStringsFacadeResolvesFallback() {
        // The "Popover" table isn't in the test bundle → the facade returns the supplied fallback.
        XCTAssertEqual(PopoverStrings.string("popover.dismiss", "Dismiss"), "Dismiss")
    }
}
