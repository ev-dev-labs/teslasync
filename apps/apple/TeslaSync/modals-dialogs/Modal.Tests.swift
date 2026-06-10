//
//  Modal.Tests.swift
//  TeslaSync — P4 modal/dialog · 0014 · Modal (Apple)
//
//  Adapter + projection + accessibility coverage for the Modal surface — the pure, bundle-free rules
//  ported from components/ui/Modal.tsx:
//    • `ModalAdapter` — the size→max-width presets, the `sm` (640) responsive breakpoint, the
//      resolved width clamp, the height fraction, the per-edge radii, the bottom-pin, and the 44pt
//      close target (WCAG 2.5.5).
//    • `ModalProjection` — the `aria-labelledby`/`aria-label` precedence, the titled-header gate, and
//      the body-phase resolution (loading / empty / error / data).
//    • `ModalAccessibility` — the dialog label + per-phase VoiceOver summaries.
//
//  Copy resolves through an identity localizer so assertions read the real fallback without a bundle.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the real copy without
/// a bundle.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - Surface identity

final class ModalSurfaceTests: XCTestCase {
    func testSlugMatchesPromptSurface() {
        XCTAssertEqual(ModalSurface.slug, "Modal")
    }
}

// MARK: - Adapter: widths

final class ModalAdapterWidthTests: XCTestCase {
    func testMaxWidthPresets() {
        let wide: CGFloat = 1400
        XCTAssertEqual(ModalAdapter.maxWidth(for: .small, in: wide), 384)
        XCTAssertEqual(ModalAdapter.maxWidth(for: .medium, in: wide), 512)
        XCTAssertEqual(ModalAdapter.maxWidth(for: .large, in: wide), 672)
    }

    func testFullWidthIsClampedToNinetySixPercentThenEleven00() {
        // 96% of a small-ish regular viewport.
        XCTAssertEqual(ModalAdapter.maxWidth(for: .full, in: 1000), 960)
        // …capped at 1100 on very wide viewports.
        XCTAssertEqual(ModalAdapter.maxWidth(for: .full, in: 2000), 1100)
    }

    func testResolvedWidthFillsViewportWhenCompact() {
        // Below the breakpoint the dialog is a full-width bottom sheet.
        XCTAssertEqual(ModalAdapter.resolvedWidth(for: .medium, in: 390), 390)
        XCTAssertEqual(ModalAdapter.resolvedWidth(for: .full, in: 320), 320)
    }

    func testResolvedWidthClampsToCapMinusInsetWhenRegular() {
        // Wide viewport → the size cap wins.
        XCTAssertEqual(ModalAdapter.resolvedWidth(for: .medium, in: 1200), 512)
        // Narrow regular viewport (just past the breakpoint) → cap clamps to width - 2*inset.
        XCTAssertEqual(ModalAdapter.resolvedWidth(for: .large, in: 700), 700 - 32)
    }
}

// MARK: - Adapter: breakpoint + chrome

final class ModalAdapterBreakpointTests: XCTestCase {
    func testIsCompactAtBreakpoint() {
        XCTAssertTrue(ModalAdapter.isCompact(width: 639))
        XCTAssertFalse(ModalAdapter.isCompact(width: 640))
        XCTAssertEqual(ModalAdapter.compactBreakpoint, 640)
    }

    func testMaxHeightFraction() {
        XCTAssertEqual(ModalAdapter.maxHeightFraction(width: 400), 1.0)
        XCTAssertEqual(ModalAdapter.maxHeightFraction(width: 900), 0.9)
    }

    func testPinsToBottomOnlyWhenCompact() {
        XCTAssertTrue(ModalAdapter.pinsToBottom(width: 500))
        XCTAssertFalse(ModalAdapter.pinsToBottom(width: 800))
    }

    func testCompactRoundsTopCornersOnly() {
        let radii = ModalAdapter.cornerRadii(width: 400)
        XCTAssertEqual(radii.topLeading, ModalAdapter.cardCornerRadius)
        XCTAssertEqual(radii.topTrailing, ModalAdapter.cardCornerRadius)
        XCTAssertEqual(radii.bottomLeading, 0)
        XCTAssertEqual(radii.bottomTrailing, 0)
    }

    func testRegularRoundsAllCorners() {
        let radii = ModalAdapter.cornerRadii(width: 900)
        XCTAssertEqual(radii.topLeading, ModalAdapter.cardCornerRadius)
        XCTAssertEqual(radii.bottomTrailing, ModalAdapter.cardCornerRadius)
        XCTAssertEqual(radii.bottomLeading, ModalAdapter.cardCornerRadius)
        XCTAssertEqual(radii.topTrailing, ModalAdapter.cardCornerRadius)
    }

    func testCloseTargetMeetsWCAGMinimum() {
        XCTAssertEqual(ModalAdapter.closeButtonSide, 44)
    }
}

// MARK: - Projection: label precedence (web aria-labelledby vs aria-label)

final class ModalLabelTests: XCTestCase {
    func testTitleResolvesTitled() {
        XCTAssertEqual(ModalProjection.resolveLabel(title: "Settings", ariaLabel: nil), .titled("Settings"))
    }

    func testTitleTakesPrecedenceOverAriaLabel() {
        XCTAssertEqual(
            ModalProjection.resolveLabel(title: "Settings", ariaLabel: "Ignored"),
            .titled("Settings")
        )
    }

    func testEmptyTitleFallsBackToAriaLabel() {
        XCTAssertEqual(ModalProjection.resolveLabel(title: "", ariaLabel: "Quick action"), .anonymous("Quick action"))
        XCTAssertEqual(ModalProjection.resolveLabel(title: nil, ariaLabel: "Quick action"), .anonymous("Quick action"))
    }

    func testNeitherResolvesUntitled() {
        XCTAssertEqual(ModalProjection.resolveLabel(title: nil, ariaLabel: nil), .untitled)
        XCTAssertEqual(ModalProjection.resolveLabel(title: "", ariaLabel: ""), .untitled)
    }

    func testShowsHeaderOnlyWithNonEmptyTitle() {
        XCTAssertTrue(ModalProjection.showsHeader(title: "Settings"))
        XCTAssertFalse(ModalProjection.showsHeader(title: ""))
        XCTAssertFalse(ModalProjection.showsHeader(title: nil))
    }
}

// MARK: - Projection: body phase

final class ModalPhaseTests: XCTestCase {
    func testLoadingResolvesLoading() {
        XCTAssertEqual(ModalProjection.resolvePhase(status: .loading, hasContent: false), .loading)
        XCTAssertEqual(ModalProjection.resolvePhase(status: .loading, hasContent: true), .loading)
    }

    func testLoadedResolvesDataOrEmptyByContent() {
        XCTAssertEqual(ModalProjection.resolvePhase(status: .loaded, hasContent: true), .data)
        XCTAssertEqual(ModalProjection.resolvePhase(status: .loaded, hasContent: false), .empty)
    }

    func testFailedResolvesErrorWithMessage() {
        XCTAssertEqual(ModalProjection.resolvePhase(status: .failed("boom"), hasContent: true), .error("boom"))
    }
}

// MARK: - Accessibility

final class ModalAccessibilityTests: XCTestCase {
    func testDialogLabelByLabelKind() {
        XCTAssertEqual(
            ModalAccessibility.dialogLabel(for: .titled("Battery"), localize: passthroughLocalize),
            "Battery"
        )
        XCTAssertEqual(
            ModalAccessibility.dialogLabel(for: .anonymous("Quick action"), localize: passthroughLocalize),
            "Quick action"
        )
        XCTAssertEqual(
            ModalAccessibility.dialogLabel(for: .untitled, localize: passthroughLocalize),
            "Dialog"
        )
    }

    func testPerPhaseSummaries() {
        let cases: [(ModalBodyPhase, String)] = [
            (.loading, "Loading"),
            (.empty, "Nothing to show"),
            (.error("x"), "Something went wrong"),
            (.data, "Dialog content")
        ]
        for (phase, expected) in cases {
            XCTAssertEqual(
                ModalAccessibility.summary(for: phase, localize: passthroughLocalize),
                expected
            )
        }
    }
}
