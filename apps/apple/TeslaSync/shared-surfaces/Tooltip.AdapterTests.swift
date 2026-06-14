//
//  Tooltip.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0231 · Tooltip (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the value types
//  (``TooltipSide`` web-side mapping + round-trip, ``TooltipWrap`` multiline mapping), the layout metrics
//  (``TooltipMetrics`` — the native peers of the web Tailwind sizes), and the ``TooltipProjector`` — the
//  accessibility-description / never-a-blank-box rules. Split from Tooltip.Tests.swift (the SwiftUI /
//  state-holder half) to keep each file within the SwiftLint file-length budget. These run in the
//  TeslaSync(/-macOS) XCTest targets; the derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class TooltipAdapterSurfaceTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(TooltipSurface.slug, "Tooltip")
    }
}

// MARK: - TooltipSide (web `side` + `sideClasses`)

final class TooltipSideTests: XCTestCase {
    func testWebSideMapping() {
        XCTAssertEqual(TooltipSide(webSide: "top"), .top)
        XCTAssertEqual(TooltipSide(webSide: "bottom"), .bottom)
        XCTAssertEqual(TooltipSide(webSide: "left"), .leading)
        XCTAssertEqual(TooltipSide(webSide: "right"), .trailing)
        XCTAssertEqual(TooltipSide(webSide: "unknown"), .top, "unknown falls back to the web default")
    }

    func testWebSideRoundTrip() {
        for side in TooltipSide.allCases {
            XCTAssertEqual(TooltipSide(webSide: side.webSide), side, "\(side) must round-trip through webSide")
        }
    }

    func testWebSideLiterals() {
        XCTAssertEqual(TooltipSide.top.webSide, "top")
        XCTAssertEqual(TooltipSide.bottom.webSide, "bottom")
        XCTAssertEqual(TooltipSide.leading.webSide, "left")
        XCTAssertEqual(TooltipSide.trailing.webSide, "right")
    }

    func testIsHorizontal() {
        XCTAssertFalse(TooltipSide.top.isHorizontal)
        XCTAssertFalse(TooltipSide.bottom.isHorizontal)
        XCTAssertTrue(TooltipSide.leading.isHorizontal)
        XCTAssertTrue(TooltipSide.trailing.isHorizontal)
    }

    func testDefaultsAndCases() {
        XCTAssertEqual(TooltipSide.webDefault, .top)
        XCTAssertEqual(TooltipSide.allCases.count, 4)
    }
}

// MARK: - TooltipWrap (web `multiline`)

final class TooltipWrapTests: XCTestCase {
    func testMultilineMapping() {
        XCTAssertEqual(TooltipWrap(multiline: true), .multiline)
        XCTAssertEqual(TooltipWrap(multiline: false), .singleLine)
    }

    func testIsMultiline() {
        XCTAssertTrue(TooltipWrap.multiline.isMultiline)
        XCTAssertFalse(TooltipWrap.singleLine.isMultiline)
    }

    func testDefaultsAndCases() {
        XCTAssertEqual(TooltipWrap.webDefault, .singleLine, "web multiline absent → whitespace-nowrap")
        XCTAssertEqual(TooltipWrap.allCases.count, 2)
    }
}

// MARK: - TooltipMetrics (web Tailwind sizes)

final class TooltipMetricsTests: XCTestCase {
    func testMetricsMatchWebTailwind() {
        XCTAssertEqual(TooltipMetrics.horizontalPadding, 10, "web px-2.5")
        XCTAssertEqual(TooltipMetrics.verticalPadding, 6, "web py-1.5")
        XCTAssertEqual(TooltipMetrics.cornerRadius, TSRadius.sm, "web rounded-lg → 8pt design radius")
        XCTAssertEqual(TooltipMetrics.gap, TSSpacing.sm, "web mb-2/mt-2/mr-2/ml-2 → 8pt design spacing")
        XCTAssertEqual(TooltipMetrics.multilineMaxWidth, 260, "web max-w-[260px]")
        XCTAssertEqual(TooltipMetrics.hiddenScale, 0.95, "web scale-95")
    }

    func testShadowAndHairlineAreSane() {
        XCTAssertGreaterThan(TooltipMetrics.shadowRadius, 0)
        XCTAssertGreaterThan(TooltipMetrics.shadowYOffset, 0)
        XCTAssertGreaterThan(TooltipMetrics.shadowOpacity, 0)
        XCTAssertLessThanOrEqual(TooltipMetrics.shadowOpacity, 1)
        XCTAssertGreaterThan(TooltipMetrics.increasedContrastHairline, 0)
    }
}

// MARK: - TooltipProjector (web content + id rules)

final class TooltipProjectorTests: XCTestCase {
    func testAccessibilityDescriptionPlainText() {
        XCTAssertEqual(TooltipProjector.accessibilityDescription("Battery health"), "Battery health")
    }

    func testAccessibilityDescriptionTrimsSurroundingWhitespace() {
        XCTAssertEqual(TooltipProjector.accessibilityDescription("  Health  \n"), "Health")
    }

    func testAccessibilityDescriptionNilWhenEmptyOrWhitespace() {
        XCTAssertNil(TooltipProjector.accessibilityDescription(""))
        XCTAssertNil(TooltipProjector.accessibilityDescription("   \n\t "))
    }

    func testShouldRenderBubble() {
        XCTAssertTrue(TooltipProjector.shouldRenderBubble(content: "Health"))
        XCTAssertFalse(TooltipProjector.shouldRenderBubble(content: ""), "empty → never a blank box")
        XCTAssertFalse(TooltipProjector.shouldRenderBubble(content: "   "), "whitespace → never a blank box")
    }
}
