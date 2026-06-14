//
//  Tooltip.Tests.swift
//  TeslaSync — P4 shared surface · 0231 · Tooltip (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure value types + projector live
//  in Tooltip.AdapterTests.swift; split to keep each file within the SwiftLint file-length budget):
//    • TooltipController — the once-only `view.opened` (gated on content, the P4 never-a-blank-box rule), the
//      derived accessibility description (web `aria-describedby`) and localized bubble role (web
//      `role="tooltip"`), the carried side / wrap props, and the reveal state.
//    • Views — the public host + every subview compose in each branch (string / controller / rich-content
//      init, every side and wrap, the outward-offset modifier).
//    • Strings — the role copy resolves through the P1/S10 facade with the English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - TooltipController (state + telemetry + derived projections)

@MainActor
final class TooltipControllerTests: XCTestCase {
    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let controller = TooltipController(text: "Body", telemetry: spy)
        controller.start()
        controller.start()
        XCTAssertEqual(spy.surfaces, [TooltipSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let controller = TooltipController(text: "Body", telemetry: spy)
        controller.start()
        controller.stop()
        controller.start()
        XCTAssertEqual(spy.surfaces, [TooltipSurface.slug], "view.opened fires once per instance")
    }

    func testStartDoesNotEmitWhenEmptyContent() {
        let spy = SpyTelemetry()
        let controller = TooltipController(text: "   \n ", telemetry: spy)
        controller.start()
        XCTAssertFalse(controller.hasContent)
        XCTAssertTrue(spy.surfaces.isEmpty, "a surface that renders no bubble reports no open")
    }

    func testHasContentReflectsContent() {
        XCTAssertTrue(TooltipController(text: "Body").hasContent)
        XCTAssertFalse(TooltipController(text: "").hasContent)
        XCTAssertFalse(TooltipController(text: "  ").hasContent)
    }

    func testAccessibilityDescriptionTrimsAndNilsWhenEmpty() {
        XCTAssertEqual(TooltipController(text: "  Battery health ").accessibilityDescription, "Battery health")
        XCTAssertNil(TooltipController(text: "   ").accessibilityDescription)
    }

    func testRoleDescriptionDefault() {
        // Default resolver -> NSLocalizedString returns the value fallback in the test bundle.
        XCTAssertEqual(TooltipController(text: "Body").roleDescription, "Tooltip")
    }

    func testRoleDescriptionUsesInjectedResolver() {
        let resolver: TooltipResolve = { key, fallback in
            key == TooltipStrings.roleKey ? "Sprechblase" : fallback
        }
        XCTAssertEqual(TooltipController(text: "Body", resolve: resolver).roleDescription, "Sprechblase")
    }

    func testCarriesSideAndWrap() {
        let controller = TooltipController(text: "Body", side: .leading, wrap: .multiline)
        XCTAssertEqual(controller.side, .leading)
        XCTAssertEqual(controller.wrap, .multiline)
    }

    func testCarriesWebDefaults() {
        let controller = TooltipController(text: "Body")
        XCTAssertEqual(controller.side, .top)
        XCTAssertEqual(controller.wrap, .singleLine)
    }

    func testRevealState() {
        let controller = TooltipController(text: "Body")
        XCTAssertFalse(controller.isPresented)
        controller.present()
        XCTAssertTrue(controller.isPresented)
        controller.dismiss()
        XCTAssertFalse(controller.isPresented)
        controller.toggle()
        XCTAssertTrue(controller.isPresented)
        controller.toggle()
        XCTAssertFalse(controller.isPresented)
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class TooltipViewTests: XCTestCase {
    func testSurfaceSlugExposed() {
        XCTAssertEqual(Tooltip<Text, TooltipText>.surfaceSlug, "Tooltip")
    }

    func testHostComposesStringControllerAndRichInit() {
        _ = Tooltip("Body") { Text(verbatim: "trigger") }
        _ = Tooltip(controller: TooltipController(text: "Body")) { Text(verbatim: "trigger") }
        _ = Tooltip(
            controller: TooltipController(text: "Body", wrap: .multiline),
            content: { Label("Rich", systemImage: "bolt.fill") },
            trigger: { Text(verbatim: "trigger") }
        )
        // Empty-body host composes (renders the trigger with no bubble).
        _ = Tooltip("") { Text(verbatim: "trigger") }
    }

    func testHostComposesEachSideAndWrap() {
        for side in TooltipSide.allCases {
            for wrap in TooltipWrap.allCases {
                _ = Tooltip("Body", side: side, wrap: wrap) { Text(verbatim: "trigger") }
            }
        }
    }

    func testBubbleComposesEachSideAndWrap() {
        for side in TooltipSide.allCases {
            for wrap in TooltipWrap.allCases {
                _ = TooltipBubble(
                    side: side,
                    wrap: wrap,
                    roleDescription: "Tooltip",
                    isVisible: true,
                    reduceMotion: false
                ) {
                    TooltipText(text: "Body", wrap: wrap)
                }
            }
        }
    }

    func testBubbleComposesHiddenAndReduceMotion() {
        _ = TooltipBubble(
            side: .top,
            wrap: .singleLine,
            roleDescription: "Tooltip",
            isVisible: false,
            reduceMotion: true
        ) {
            TooltipText(text: "Body", wrap: .singleLine)
        }
    }

    func testTextComposesSingleAndMultiline() {
        _ = TooltipText(text: "One line", wrap: .singleLine)
        _ = TooltipText(text: "A longer body that wraps across lines for multiline.", wrap: .multiline)
    }

    func testOutwardOffsetComposesEachSide() {
        for side in TooltipSide.allCases {
            _ = Text(verbatim: "x").modifier(TooltipOutwardOffset(side: side, gap: TooltipMetrics.gap))
        }
    }

    func testSideGeometryMapping() {
        XCTAssertEqual(TooltipSide.top.overlayAlignment, .top)
        XCTAssertEqual(TooltipSide.bottom.overlayAlignment, .bottom)
        XCTAssertEqual(TooltipSide.leading.overlayAlignment, .leading)
        XCTAssertEqual(TooltipSide.trailing.overlayAlignment, .trailing)
        XCTAssertEqual(TooltipSide.top.scaleAnchor, .bottom)
        XCTAssertEqual(TooltipSide.bottom.scaleAnchor, .top)
        XCTAssertEqual(TooltipSide.leading.scaleAnchor, .trailing)
        XCTAssertEqual(TooltipSide.trailing.scaleAnchor, .leading)
    }
}

// MARK: - Strings facade (P1/S10)

final class TooltipStringsTests: XCTestCase {
    func testRoleFallback() {
        XCTAssertEqual(TooltipStrings.role, "Tooltip")
    }

    func testKeysAreStable() {
        XCTAssertEqual(TooltipStrings.roleKey, "tooltip.a11y.role")
        XCTAssertEqual(TooltipStrings.table, "Tooltip")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: TooltipTelemetry, @unchecked Sendable {
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
