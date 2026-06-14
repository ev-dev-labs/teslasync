//
//  HelpSegment.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0179 · HelpSegment (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity + the `?` key-cap glyph, the
//  density resolution (the web `iconOnly` prop crossed with the `xl` breakpoint), the density flags
//  (key-cap + inline-label gates), the per-action SF Symbol + key-cap eligibility, and the projector — the
//  per-action tooltip / VoiceOver label / inline label resolution (English fallback + catalog override),
//  the key-cap presence rule (shortcuts, expanded only), the inline-label gate (wide only), the three-
//  affordance ordering, and value-type equality. Split from HelpSegment.Tests.swift (the SwiftUI / state-
//  holder half) to keep each file within the SwiftLint file-length budget. These run in the
//  TeslaSync(/-macOS) XCTest targets; the derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Test resolvers

/// Returns the `default` fallback for every key — the test / preview-bundle behavior (web `t(missingKey,
/// default)` → the default).
private let fallbackResolve: HelpSegmentResolve = { _, fallback in fallback }

/// A fake catalog mapping a few keys to localized values; unknown keys fall back. Lets tests assert a
/// present key wins over the English fallback (web translation hit).
private let catalogResolve: HelpSegmentResolve = { key, fallback in
    let catalog = [
        HelpSegmentKey.shortcutsTooltip: "Raccourcis clavier",
        HelpSegmentKey.tourLabel: "Visite guidée",
        HelpSegmentKey.feedbackAria: "Ouvrir le formulaire de retour"
    ]
    return catalog[key] ?? fallback
}

// MARK: - Surface identity

final class HelpSegmentAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(HelpSegmentSurface.slug, "HelpSegment")
    }

    func testKeyCapGlyphIsQuestionMark() {
        XCTAssertEqual(HelpSegmentSurface.shortcutKeyCap, "?")
    }
}

// MARK: - Density (web `iconOnly` × the `xl` breakpoint)

final class HelpSegmentDensityTests: XCTestCase {
    func testResolveMapsIconOnlyRegardlessOfWidth() {
        XCTAssertEqual(HelpSegmentDensity.resolve(iconOnly: true, isWide: true), .iconOnly)
        XCTAssertEqual(HelpSegmentDensity.resolve(iconOnly: true, isWide: false), .iconOnly)
    }

    func testResolveMapsWideToFullAndNarrowToCompact() {
        XCTAssertEqual(HelpSegmentDensity.resolve(iconOnly: false, isWide: true), .full)
        XCTAssertEqual(HelpSegmentDensity.resolve(iconOnly: false, isWide: false), .compact)
    }

    func testKeyCapGate() {
        XCTAssertFalse(HelpSegmentDensity.iconOnly.showsKeyCap)
        XCTAssertTrue(HelpSegmentDensity.compact.showsKeyCap)
        XCTAssertTrue(HelpSegmentDensity.full.showsKeyCap)
    }

    func testInlineLabelGate() {
        XCTAssertFalse(HelpSegmentDensity.iconOnly.showsInlineLabel)
        XCTAssertFalse(HelpSegmentDensity.compact.showsInlineLabel)
        XCTAssertTrue(HelpSegmentDensity.full.showsInlineLabel)
    }
}

// MARK: - Action metadata (SF Symbol + key-cap eligibility)

final class HelpSegmentActionTests: XCTestCase {
    func testSystemImages() {
        XCTAssertEqual(HelpSegmentAction.shortcuts.systemImage, "keyboard")
        XCTAssertEqual(HelpSegmentAction.tour.systemImage, "questionmark.circle")
        XCTAssertEqual(HelpSegmentAction.feedback.systemImage, "ladybug")
    }

    func testOnlyShortcutsShowsKeyCap() {
        XCTAssertTrue(HelpSegmentAction.shortcuts.showsKeyCap)
        XCTAssertFalse(HelpSegmentAction.tour.showsKeyCap)
        XCTAssertFalse(HelpSegmentAction.feedback.showsKeyCap)
    }

    func testAllCasesInWebOrder() {
        XCTAssertEqual(HelpSegmentAction.allCases, [.shortcuts, .tour, .feedback])
    }
}

// MARK: - Projector — copy resolution + layout gates

final class HelpSegmentProjectorTests: XCTestCase {
    private func action(
        _ action: HelpSegmentAction,
        in projection: HelpSegmentProjection
    ) -> HelpSegmentActionProjection {
        guard let match = projection.actions.first(where: { $0.action == action }) else {
            preconditionFailure("missing \(action) in projection")
        }
        return match
    }

    func testResolveProducesThreeAffordancesInOrder() {
        let projection = HelpSegmentProjector.resolve(density: .full, resolve: fallbackResolve)
        XCTAssertEqual(projection.density, .full)
        XCTAssertEqual(projection.actions.map(\.action), [.shortcuts, .tour, .feedback])
    }

    func testShortcutsCopyAndKeyCapWhenWide() {
        let projection = HelpSegmentProjector.resolve(density: .full, resolve: fallbackResolve)
        let shortcuts = action(.shortcuts, in: projection)
        XCTAssertEqual(shortcuts.tooltip, "Keyboard shortcuts")
        XCTAssertEqual(shortcuts.accessibilityLabel, "Open keyboard shortcuts")
        XCTAssertEqual(shortcuts.inlineLabel, "for shortcuts")
        XCTAssertTrue(shortcuts.showsInlineLabel)
        XCTAssertEqual(shortcuts.keyCap, "?")
    }

    func testTourCopyWhenWide() {
        let projection = HelpSegmentProjector.resolve(density: .full, resolve: fallbackResolve)
        let tour = action(.tour, in: projection)
        XCTAssertEqual(tour.tooltip, "Take a tour")
        XCTAssertEqual(tour.accessibilityLabel, "Open tour launcher")
        XCTAssertEqual(tour.inlineLabel, "Take a tour")
        XCTAssertNil(tour.keyCap)
    }

    func testFeedbackCopyWhenWide() {
        let projection = HelpSegmentProjector.resolve(density: .full, resolve: fallbackResolve)
        let feedback = action(.feedback, in: projection)
        XCTAssertEqual(feedback.tooltip, "Report bug")
        XCTAssertEqual(feedback.accessibilityLabel, "Open feedback / bug report form")
        XCTAssertEqual(feedback.inlineLabel, "Report bug")
        XCTAssertNil(feedback.keyCap)
    }

    func testCompactKeepsKeyCapButHidesLabels() {
        let projection = HelpSegmentProjector.resolve(density: .compact, resolve: fallbackResolve)
        let shortcuts = action(.shortcuts, in: projection)
        XCTAssertEqual(shortcuts.keyCap, "?")
        XCTAssertFalse(shortcuts.showsInlineLabel)
        XCTAssertFalse(action(.tour, in: projection).showsInlineLabel)
    }

    func testIconOnlyDropsKeyCapAndLabels() {
        let projection = HelpSegmentProjector.resolve(density: .iconOnly, resolve: fallbackResolve)
        for descriptor in projection.actions {
            XCTAssertNil(descriptor.keyCap, "\(descriptor.action) should drop the key cap when icon-only")
            XCTAssertFalse(descriptor.showsInlineLabel)
        }
    }

    func testCatalogTranslationWinsOverFallback() {
        let projection = HelpSegmentProjector.resolve(density: .full, resolve: catalogResolve)
        XCTAssertEqual(action(.shortcuts, in: projection).tooltip, "Raccourcis clavier")
        XCTAssertEqual(action(.tour, in: projection).inlineLabel, "Visite guidée")
        XCTAssertEqual(action(.feedback, in: projection).accessibilityLabel, "Ouvrir le formulaire de retour")
    }

    func testProjectionEquality() {
        let lhs = HelpSegmentProjector.resolve(density: .full, resolve: fallbackResolve)
        let rhs = HelpSegmentProjector.resolve(density: .full, resolve: fallbackResolve)
        XCTAssertEqual(lhs, rhs)
        let other = HelpSegmentProjector.resolve(density: .iconOnly, resolve: fallbackResolve)
        XCTAssertNotEqual(lhs, other)
    }
}
