//
//  BrowserCompatBanner.Tests.swift
//  TeslaSync — P4 shared surface · 0114 · BrowserCompatBanner (Apple)
//
//  Adapter + projection coverage for the BrowserCompatBanner surface:
//    • Capabilities — the canonical required-capability set (the native mirror of the web feature
//      list): distinct ids, non-empty i18n key + fallback per capability.
//    • Copy — the verbatim web keys (`compat.banner.title` / `.body` / `.dismiss`) and the body
//      template carrying the `{features}` / `{recommendation}` tokens.
//    • Body — the feature-list join (web `missing.join(', ')`) and the token interpolation (web
//      `t('compat.banner.body', { features, recommendation })`), including a token-less template.
//    • Projection — the render branches plus the P4 leaf contract across loading / empty-compatible /
//      empty-acknowledged (dismissed) / error / data, including precedence.
//    • Accessibility — the composed VoiceOver banner label (web `role="status"` notice).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no device probe and no persistence,
//  so each assertion reads the pure adapter / projection directly.
//

import XCTest
@testable import TeslaSync

// MARK: - Capabilities (web required-feature list)

final class RequiredCapabilityTests: XCTestCase {
    func testCanonicalSetHasFiveCapabilities() {
        XCTAssertEqual(BrowserCompatCapabilities.all.count, 5)
    }

    func testEachCapabilityHasADistinctID() {
        let ids = Set(BrowserCompatCapabilities.all.map(\.id))
        XCTAssertEqual(ids.count, BrowserCompatCapabilities.all.count)
        XCTAssertFalse(ids.contains(""))
    }

    func testEachCapabilityHasANonEmptyKeyAndFallback() {
        for capability in BrowserCompatCapabilities.all {
            XCTAssertTrue(capability.nameKey.hasPrefix("compat.capability."))
            XCTAssertFalse(capability.nameFallback.isEmpty)
        }
    }
}

// MARK: - Copy (web `compat.banner.*`)

final class BrowserCompatCopyTests: XCTestCase {
    func testKeysMatchWebSourceVerbatim() {
        XCTAssertEqual(BrowserCompatCopy.titleKey, "compat.banner.title")
        XCTAssertEqual(BrowserCompatCopy.bodyKey, "compat.banner.body")
        XCTAssertEqual(BrowserCompatCopy.dismissKey, "compat.banner.dismiss")
    }

    func testBodyTemplateCarriesBothTokens() {
        XCTAssertTrue(BrowserCompatCopy.bodyFallback.contains(BrowserCompatBody.featuresToken))
        XCTAssertTrue(BrowserCompatCopy.bodyFallback.contains(BrowserCompatBody.recommendationToken))
    }

    func testFallbacksAreNonEmpty() {
        XCTAssertFalse(BrowserCompatCopy.titleFallback.isEmpty)
        XCTAssertFalse(BrowserCompatCopy.dismissFallback.isEmpty)
        XCTAssertFalse(BrowserCompatCopy.recommendationFallback.isEmpty)
    }
}

// MARK: - Body interpolation (web i18next interpolation + `join(', ')`)

final class BrowserCompatBodyTests: XCTestCase {
    func testFeatureListJoinsWithCommaSpace() {
        XCTAssertEqual(BrowserCompatBody.featureList(["Swift Charts", "MapKit"]), "Swift Charts, MapKit")
        XCTAssertEqual(BrowserCompatBody.featureList(["MapKit"]), "MapKit")
        XCTAssertEqual(BrowserCompatBody.featureList([]), "")
    }

    func testTextSubstitutesBothTokens() {
        let result = BrowserCompatBody.text(
            features: "Swift Charts, MapKit",
            recommendation: "Update to iOS 18.",
            template: "TeslaSync needs {features} to work correctly. {recommendation}"
        )
        XCTAssertEqual(result, "TeslaSync needs Swift Charts, MapKit to work correctly. Update to iOS 18.")
    }

    func testTextToleratesTemplateWithoutTokens() {
        let result = BrowserCompatBody.text(
            features: "Swift Charts",
            recommendation: "Update.",
            template: "Some features are unavailable."
        )
        XCTAssertEqual(result, "Some features are unavailable.")
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class BrowserCompatProjectionTests: XCTestCase {
    private let sampleMissing = [BrowserCompatCapabilities.swiftCharts, BrowserCompatCapabilities.mapKit]

    func testMissingNotDismissedProjectsData() throws {
        let resolved = BrowserCompatProjection.resolve(
            input: BrowserCompatInput(missing: sampleMissing)
        )
        XCTAssertEqual(resolved.phase, .data)
        let data = try XCTUnwrap(resolved.data)
        XCTAssertEqual(data.missing, sampleMissing)
        XCTAssertNil(resolved.emptyKind)
    }

    func testNoMissingProjectsEmptyCompatible() {
        let resolved = BrowserCompatProjection.resolve(input: BrowserCompatInput())
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertEqual(resolved.emptyKind, .compatible)
        XCTAssertNil(resolved.data)
    }

    func testDismissedWithMissingProjectsEmptyAcknowledged() {
        let resolved = BrowserCompatProjection.resolve(
            input: BrowserCompatInput(missing: sampleMissing, dismissed: true)
        )
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertEqual(resolved.emptyKind, .acknowledged)
        XCTAssertNil(resolved.data)
    }

    func testCompatibleWinsOverDismissed() {
        // No missing capabilities + dismissed → still the positive "compatible" card (web both null).
        let resolved = BrowserCompatProjection.resolve(input: BrowserCompatInput(dismissed: true))
        XCTAssertEqual(resolved.emptyKind, .compatible)
    }

    func testErrorInputProjectsError() {
        let resolved = BrowserCompatProjection.resolve(
            input: BrowserCompatInput(missing: sampleMissing, errorMessage: "probe boom")
        )
        XCTAssertEqual(resolved.phase, .error("probe boom"))
        XCTAssertNil(resolved.data)
    }

    func testLoadingProjectsLoading() {
        let resolved = BrowserCompatProjection.resolve(input: BrowserCompatInput(isLoading: true))
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testErrorBeatsLoading() {
        let resolved = BrowserCompatProjection.resolve(
            input: BrowserCompatInput(isLoading: true, errorMessage: "timeout")
        )
        XCTAssertEqual(resolved.phase, .error("timeout"))
    }

    func testEmptyErrorMessageDoesNotForceError() {
        let resolved = BrowserCompatProjection.resolve(
            input: BrowserCompatInput(missing: sampleMissing, errorMessage: "")
        )
        XCTAssertEqual(resolved.phase, .data)
    }

    func testLoadingBeatsMissingWarning() {
        let resolved = BrowserCompatProjection.resolve(
            input: BrowserCompatInput(missing: sampleMissing, isLoading: true)
        )
        XCTAssertEqual(resolved.phase, .loading)
    }
}

// MARK: - Accessibility

final class BrowserCompatAccessibilityTests: XCTestCase {
    func testBannerLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            BrowserCompatAccessibility.bannerLabel(
                title: "Your device is missing required features",
                body: "TeslaSync needs Swift Charts to work correctly."
            ),
            "Your device is missing required features. TeslaSync needs Swift Charts to work correctly."
        )
    }

    func testBannerLabelDoesNotDoubleTerminalPunctuation() {
        XCTAssertEqual(
            BrowserCompatAccessibility.bannerLabel(title: "Missing features.", body: "Update soon."),
            "Missing features. Update soon."
        )
    }

    func testBannerLabelHandlesEmptyParts() {
        XCTAssertEqual(BrowserCompatAccessibility.bannerLabel(title: "", body: "Only body"), "Only body")
        XCTAssertEqual(BrowserCompatAccessibility.bannerLabel(title: "Only title", body: ""), "Only title")
    }
}
