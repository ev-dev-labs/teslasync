//
//  Lightbox.Tests.swift
//  TeslaSync — P4 shared surface · 0219 · Lightbox (Apple)
//
//  The facade + seam + view-composition half of the coverage (the pure projector lives in
//  Lightbox.AdapterTests.swift; the state-holder in Lightbox.ModelTests.swift; split for the SwiftLint
//  file-length budget): the P1/S10 i18n facade (the web `t()` keys + the `{{…}}` interpolation), the
//  VoiceOver builders, the image-loader seam (the deterministic static double + the URLSession loader's
//  error mapping behind a stubbed protocol so no real network is touched), and that the public surface + every
//  subview compose in each real branch (loading / loaded / failed / empty / single / sequence / zoomed).
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Localization facade (P1/S10)

final class LightboxStringsTests: XCTestCase {
    func testInterpolateReplacesTokens() {
        XCTAssertEqual(LightboxStrings.interpolate("{{a}}-{{b}}", ["a": "1", "b": "2"]), "1-2")
        XCTAssertEqual(LightboxStrings.interpolate("plain", [:]), "plain")
    }

    func testCounterAndZoomPercentMirrorWebTemplates() {
        XCTAssertEqual(LightboxStrings.counter(current: 2, total: 5), "2 / 5")
        XCTAssertEqual(LightboxStrings.zoomPercent(150), "150%")
    }

    func testStaticFallbacksMatchWebCopy() {
        XCTAssertEqual(LightboxStrings.close, "Close image viewer")
        XCTAssertEqual(LightboxStrings.previous, "Previous image")
        XCTAssertEqual(LightboxStrings.next, "Next image")
        XCTAssertEqual(LightboxStrings.zoomOut, "Zoom out")
        XCTAssertEqual(LightboxStrings.zoomIn, "Zoom in")
        XCTAssertEqual(LightboxStrings.zoomReset, "Reset zoom")
    }

    func testNativeAdditionFallbacks() {
        XCTAssertEqual(LightboxStrings.dialog, "Image viewer")
        XCTAssertEqual(LightboxStrings.imageFallback, "Image")
        XCTAssertEqual(LightboxStrings.loading, "Loading image")
        XCTAssertEqual(LightboxStrings.emptyTitle, "No images to show")
        XCTAssertEqual(LightboxStrings.errorTitle, "Image failed to load")
        XCTAssertEqual(LightboxStrings.errorRetry, "Try again")
    }
}

// MARK: - Accessibility builders

final class LightboxAccessibilityTests: XCTestCase {
    func testImageLabelUsesAltOrFallback() {
        XCTAssertEqual(
            LightboxAccessibility.imageLabel(for: LightboxImage(source: "a", alt: "Front view")),
            "Front view"
        )
        XCTAssertEqual(
            LightboxAccessibility.imageLabel(for: LightboxImage(source: "a", alt: "")),
            LightboxStrings.imageFallback,
            "an empty (decorative) alt falls back to a generic label"
        )
    }

    func testLoadStatusPerPhase() {
        XCTAssertEqual(LightboxAccessibility.loadStatus(for: .loading), LightboxStrings.loading)
        XCTAssertEqual(LightboxAccessibility.loadStatus(for: .loaded(Data())), "")
        XCTAssertEqual(LightboxAccessibility.loadStatus(for: .failed), LightboxStrings.errorTitle)
    }
}

// MARK: - Image loader seam

final class LightboxImageLoaderTests: XCTestCase {
    func testStaticLoaderRecordsAndRoutesOutcome() async {
        let loader = StaticLightboxImageLoader(outcome: .loaded(Data([9])), perSource: ["x": .failed])
        let resolved = await loader.load("a")
        let overridden = await loader.load("x")
        XCTAssertEqual(resolved, .loaded(Data([9])))
        XCTAssertEqual(overridden, .failed, "per-source override wins over the default outcome")
        loader.prewarm("p")
        XCTAssertEqual(loader.loadedSources, ["a", "x"])
        XCTAssertEqual(loader.prewarmedSources, ["p"])
    }

    func testURLSessionLoaderMapsNetworkErrorToFailed() async {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [LightboxStubURLProtocol.self]
        let session = URLSession(configuration: config)
        let outcome = await URLSessionLightboxImageLoader(session: session).load("https://teslasync.test/p.png")
        XCTAssertEqual(outcome, .failed, "a failed fetch maps to the retry-able error envelope")
    }
}

/// A `URLProtocol` that fails every request, so the URLSession loader's error mapping is exercised with no
/// real network. Not `final` — its `override class func` requirements would otherwise trip the
/// `static_over_final_class` rule, and a `class func` cannot be expressed as `static` here.
private class LightboxStubURLProtocol: URLProtocol {
    override class func canInit(with _: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
    }

    override func stopLoading() {}
}

// MARK: - View composition (every real branch composes)

@MainActor
final class LightboxViewCompositionTests: XCTestCase {
    private static let images = [
        LightboxImage(source: "a", alt: "A"),
        LightboxImage(source: "b", alt: "B", caption: "Caption")
    ]

    private func model(images: [LightboxImage] = images, initialIndex: Int = 0) -> LightboxModel {
        LightboxModel(
            input: LightboxInput(isOpen: true, images: images, initialIndex: initialIndex),
            loader: StaticLightboxImageLoader()
        )
    }

    func testPublicSurfaceComposesFromPropsAndModel() {
        _ = Lightbox(open: true, onClose: {}, images: Self.images, initialIndex: 1)
        _ = Lightbox(open: false, onClose: {}, images: [])
        _ = Lightbox(model: model())
        XCTAssertEqual(Lightbox.surfaceSlug, "Lightbox")
    }

    func testOverlayAndBarsComposeForSequence() {
        let holder = model()
        _ = LightboxOverlay(model: holder, reduceMotion: false)
        _ = LightboxTopBar(model: holder)
        _ = LightboxImageArea(model: holder, reduceMotion: true)
        _ = LightboxBottomBar(model: holder)
        XCTAssertTrue(holder.projection.showsNavigation)
    }

    func testEmptyChromeComposesWhenNoImages() {
        let holder = model(images: [])
        _ = LightboxOverlay(model: holder, reduceMotion: false)
        _ = LightboxEmptyChrome(model: holder)
        XCTAssertEqual(holder.total, 0)
    }

    func testImageContentComposesForEveryPhase() {
        let image = LightboxImage(source: "a", alt: "A", caption: "Cap")
        _ = LightboxImageContent(phase: .loading, image: image, zoom: 1, pan: .zero, onRetry: {}, reduceMotion: false)
        _ = LightboxImageContent(
            phase: .loaded(Data([1, 2])),
            image: image,
            zoom: 2,
            pan: LightboxPan(x: 5, y: 5),
            onRetry: {},
            reduceMotion: true
        )
        _ = LightboxImageContent(phase: .failed, image: image, zoom: 1, pan: .zero, onRetry: {}, reduceMotion: false)
    }

    func testStateAndControlLeavesCompose() {
        _ = LightboxLoadingSkeleton(reduceMotion: false)
        _ = LightboxErrorState(onRetry: {})
        _ = LightboxEmptyState()
        _ = LightboxRetryButton(action: {})
        _ = LightboxIconButton(systemName: "xmark", label: "Close", action: {})
        _ = LightboxCounter(current: 1, total: 2)
        _ = LightboxCaption(caption: "Caption")
        _ = LightboxCaption(caption: nil)
        _ = LightboxZoomControls(
            projection: LightboxProjector.resolve(index: 0, total: 2, zoom: 1.5, pan: .zero),
            onZoomOut: {},
            onZoomIn: {},
            onReset: {}
        )
    }
}
