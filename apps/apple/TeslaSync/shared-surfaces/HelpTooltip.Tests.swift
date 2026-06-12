//
//  HelpTooltip.Tests.swift
//  TeslaSync — P4 shared surface · 0216 · HelpTooltip (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projector + value types live
//  in HelpTooltip.AdapterTests.swift; split to keep each file within the SwiftLint file-length budget):
//    • HelpTooltipController — the once-only `view.opened` (gated on content, the web `return null`), the
//      resolved content (text vs i18nKey), the derived accessible name (web `ariaLabel ??
//      t('help.tooltip.iconLabel')`) and learn-more label (web `learnMore.label ?? t('common.learnMore')`),
//      the carried placement / size props, and the reveal state.
//    • Views — the public host + every subview compose in each branch (default / custom glyph, body with and
//      without a learn-more link, valid and malformed link URL, each glyph size).
//    • Strings — the copy resolves through the P1/S10 facade with the English fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - HelpTooltipController (state + resolution + derived labels)

@MainActor
final class HelpTooltipControllerTests: XCTestCase {
    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let controller = HelpTooltipController(text: "Body", telemetry: spy)
        controller.start()
        controller.start()
        XCTAssertEqual(spy.surfaces, [HelpTooltipSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let controller = HelpTooltipController(text: "Body", telemetry: spy)
        controller.start()
        controller.stop()
        controller.start()
        XCTAssertEqual(spy.surfaces, [HelpTooltipSurface.slug], "view.opened fires once per instance")
    }

    func testStartDoesNotEmitWhenNoContent() {
        let spy = SpyTelemetry()
        let controller = HelpTooltipController(telemetry: spy) // no text / i18nKey -> no content
        controller.start()
        XCTAssertFalse(controller.hasContent)
        XCTAssertTrue(spy.surfaces.isEmpty, "a surface that renders nothing (web return null) reports no open")
    }

    func testHasContentReflectsResolution() {
        XCTAssertTrue(HelpTooltipController(text: "Body").hasContent)
        XCTAssertFalse(HelpTooltipController(text: "").hasContent)
        XCTAssertFalse(HelpTooltipController().hasContent)
    }

    func testResolvedBodyFromI18nKeyViaInjectedResolver() {
        let resolver: HelpTooltipResolve = { key, fallback in key == "drain.help" ? "Parked loss." : fallback }
        let controller = HelpTooltipController(
            text: "ignored",
            i18nKey: "drain.help",
            defaultValue: "fallback",
            resolve: resolver
        )
        XCTAssertEqual(controller.content?.text, "Parked loss.", "i18nKey wins over text")
    }

    func testResolvedBodyFromPlainText() {
        XCTAssertEqual(HelpTooltipController(text: "Plain copy").content?.text, "Plain copy")
    }

    func testAccessibilityLabelDefaultsToIconLabel() {
        // Default resolver -> NSLocalizedString returns the value fallback in the test bundle.
        XCTAssertEqual(HelpTooltipController(text: "Body").accessibilityLabel, "More info")
    }

    func testAccessibilityLabelHonorsOverride() {
        let controller = HelpTooltipController(text: "Body", ariaLabel: "More info about vampire drain")
        XCTAssertEqual(controller.accessibilityLabel, "More info about vampire drain")
    }

    func testAccessibilityLabelUsesInjectedResolver() {
        let resolver: HelpTooltipResolve = { key, fallback in
            key == HelpTooltipStrings.iconLabelKey ? "Mehr Infos" : fallback
        }
        XCTAssertEqual(HelpTooltipController(text: "Body", resolve: resolver).accessibilityLabel, "Mehr Infos")
    }

    func testLearnMoreLabelDefault() {
        let controller = HelpTooltipController(text: "Body", learnMore: HelpTooltipLearnMore(url: "https://x.io"))
        XCTAssertEqual(controller.learnMoreLabel, "Learn more")
    }

    func testLearnMoreLabelHonorsOverride() {
        let controller = HelpTooltipController(
            text: "Body",
            learnMore: HelpTooltipLearnMore(url: "https://x.io", label: "Read the guide")
        )
        XCTAssertEqual(controller.learnMoreLabel, "Read the guide")
    }

    func testCarriesPlacementAndSize() {
        let controller = HelpTooltipController(text: "Body", placement: .trailing, size: .md)
        XCTAssertEqual(controller.placement, .trailing)
        XCTAssertEqual(controller.size, .md)
    }

    func testRevealState() {
        let controller = HelpTooltipController(text: "Body")
        XCTAssertFalse(controller.isPresented)
        controller.present()
        XCTAssertTrue(controller.isPresented)
        controller.dismiss()
        XCTAssertFalse(controller.isPresented)
        controller.toggle()
        XCTAssertTrue(controller.isPresented)
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class HelpTooltipViewTests: XCTestCase {
    func testSurfaceSlugExposed() {
        XCTAssertEqual(HelpTooltip<HelpTooltipDefaultIcon>.surfaceSlug, "HelpTooltip")
    }

    func testHostComposesWithDefaultAndCustomGlyph() {
        let controller = HelpTooltipController(text: "Body")
        _ = HelpTooltip(controller: controller)
        _ = HelpTooltip(controller: controller) {
            Image(systemName: "info.circle").accessibilityHidden(true)
        }
        _ = HelpTooltip(controller: HelpTooltipController()) // no-content branch composes (renders EmptyView)
    }

    func testDefaultIconComposesForEachSize() {
        for size in HelpTooltipSize.allCases {
            _ = HelpTooltipDefaultIcon(size: size)
        }
    }

    func testIconButtonComposes() {
        let controller = HelpTooltipController(text: "Body")
        _ = HelpTooltipIconButton(controller: controller) {
            HelpTooltipDefaultIcon(size: controller.size)
        }
    }

    func testBodyComposesWithAndWithoutLearnMore() {
        _ = HelpTooltipBody(
            content: HelpTooltipContent(text: "Just copy"),
            learnMoreLabel: HelpTooltipStrings.learnMoreDefault
        )
        _ = HelpTooltipBody(
            content: HelpTooltipContent(
                text: "With a link",
                learnMore: HelpTooltipLearnMore(url: "https://teslasync.io")
            ),
            learnMoreLabel: "Learn more"
        )
    }

    func testLearnMoreLinkComposesForValidAndMalformedURL() {
        _ = HelpTooltipLearnMoreLink(
            label: "Learn more",
            learnMore: HelpTooltipLearnMore(url: "https://teslasync.io")
        )
        // Malformed / empty URL -> the non-interactive labelled fallback branch still composes.
        _ = HelpTooltipLearnMoreLink(
            label: "Learn more",
            learnMore: HelpTooltipLearnMore(url: "")
        )
    }
}

// MARK: - Strings facade (P1/S10)

final class HelpTooltipStringsTests: XCTestCase {
    func testStaticFallbacks() {
        XCTAssertEqual(HelpTooltipStrings.iconLabel, "More info")
        XCTAssertEqual(HelpTooltipStrings.learnMore, "Learn more")
    }

    func testKeysAreStable() {
        XCTAssertEqual(HelpTooltipStrings.iconLabelKey, "help.tooltip.iconLabel")
        XCTAssertEqual(HelpTooltipStrings.learnMoreKey, "common.learnMore")
        XCTAssertEqual(HelpTooltipStrings.table, "HelpTooltip")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: HelpTooltipTelemetry, @unchecked Sendable {
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
