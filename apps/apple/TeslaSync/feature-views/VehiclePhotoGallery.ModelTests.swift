//
//  VehiclePhotoGallery.ModelTests.swift
//  TeslaSync — P4 feature view · 0306 · VehiclePhotoGallery (Apple)
//
//  Lifecycle + binding coverage for `PhotoGalleryModel`: the `view.opened` telemetry (once +
//  idempotent), the start/stop/refresh plumbing to the source, the snapshot →
//  photos/connection/phase application, the immersive-viewer open/close/next/previous
//  navigation with bounds clamping, the active-index guard when the set shrinks (and the
//  auto-close when it empties), the stale → one-shot auto-refresh transition, and the resolved
//  accessible labels. Driven by the in-memory source double, with no network.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Test doubles

private final class CountingPhotoGalleryTelemetry: PhotoGalleryTelemetry, @unchecked Sendable {
    private(set) var opened: [String] = []
    func viewOpened(surface: String) {
        opened.append(surface)
    }
}

/// Echo localizer: returns the English fallback verbatim so resolved labels are asserted with
/// no loaded catalog (interpolation is then applied by the model).
private let echoLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

private func samplePhotos(_ count: Int) -> [PhotoGalleryImage] {
    (0 ..< count).map { index in
        PhotoGalleryImage(id: "photo-\(index)", alt: "Alt \(index)", data: Data([0xFF, 0xD8, 0xFF]))
    }
}

// MARK: - Lifecycle + telemetry

@MainActor
final class PhotoGalleryModelLifecycleTests: XCTestCase {
    func testStartEmitsViewOpenedOnceAndStartsSource() {
        let source = InMemoryPhotoGallerySource()
        let telemetry = CountingPhotoGalleryTelemetry()
        let model = PhotoGalleryModel(source: source, telemetry: telemetry)

        model.start()
        model.start()

        XCTAssertEqual(telemetry.opened, [PhotoGallerySurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testStopStopsSourceAndAllowsRestart() {
        let source = InMemoryPhotoGallerySource()
        let telemetry = CountingPhotoGalleryTelemetry()
        let model = PhotoGalleryModel(source: source, telemetry: telemetry)

        model.start()
        model.stop()
        model.start()

        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(source.startCount, 2)
        XCTAssertEqual(telemetry.opened.count, 2)
    }

    func testInitialPhaseIsLoading() {
        let model = PhotoGalleryModel(source: InMemoryPhotoGallerySource())
        XCTAssertEqual(model.phase, .loading)
    }

    func testRefreshForwardsToSource() {
        let source = InMemoryPhotoGallerySource()
        let model = PhotoGalleryModel(source: source)
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }
}

// MARK: - Snapshot application

@MainActor
final class PhotoGalleryModelSnapshotTests: XCTestCase {
    func testAppliesPhotosConnectionAndPhase() {
        let source = InMemoryPhotoGallerySource()
        let model = PhotoGalleryModel(source: source)
        model.start()

        source.push(PhotoGalleryUpdate(status: .loaded, photos: samplePhotos(3), connection: .offline))

        XCTAssertTrue(model.hasPhotos)
        XCTAssertEqual(model.photoCount, 3)
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .data)
    }

    func testEmptyResolvesToEmptyPhase() {
        let source = InMemoryPhotoGallerySource()
        let model = PhotoGalleryModel(source: source)
        model.start()

        source.push(PhotoGalleryUpdate(status: .loaded, photos: []))

        XCTAssertFalse(model.hasPhotos)
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailureResolvesToError() {
        let source = InMemoryPhotoGallerySource()
        let model = PhotoGalleryModel(source: source)
        model.start()

        source.push(PhotoGalleryUpdate(status: .failed("offline"), photos: []))

        XCTAssertEqual(model.phase, .error("offline"))
    }

    func testCachedGridSurvivesFailedReloadWithInlineError() {
        let source = InMemoryPhotoGallerySource()
        let model = PhotoGalleryModel(source: source)
        model.start()

        source.push(PhotoGalleryUpdate(status: .failed("reload failed"), photos: samplePhotos(2)))

        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.inlineErrorMessage, "reload failed")
    }

    func testStaleTransitionTriggersOneShotRefresh() {
        let source = InMemoryPhotoGallerySource()
        let model = PhotoGalleryModel(source: source)
        model.start()

        source.push(PhotoGalleryUpdate(status: .loaded, photos: samplePhotos(2), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale does not re-trigger the auto-refresh.
        source.push(PhotoGalleryUpdate(status: .loaded, photos: samplePhotos(2), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)

        // A live episode re-arms the one-shot.
        source.push(PhotoGalleryUpdate(status: .loaded, photos: samplePhotos(2), connection: .live))
        source.push(PhotoGalleryUpdate(status: .loaded, photos: samplePhotos(2), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }
}

// MARK: - Immersive viewer navigation

@MainActor
final class PhotoGalleryModelViewerTests: XCTestCase {
    private func loadedModel(_ count: Int) -> (PhotoGalleryModel, InMemoryPhotoGallerySource) {
        let source = InMemoryPhotoGallerySource()
        let model = PhotoGalleryModel(source: source, localize: echoLocalize)
        model.start()
        source.push(PhotoGalleryUpdate(status: .loaded, photos: samplePhotos(count)))
        return (model, source)
    }

    func testOpenSetsIndexAndShowsViewer() {
        let (model, _) = loadedModel(5)
        model.open(at: 2)
        XCTAssertTrue(model.isViewerOpen)
        XCTAssertEqual(model.activeIndex, 2)
        XCTAssertEqual(model.activeImage?.id, "photo-2")
    }

    func testOpenClampsOutOfRangeIndex() {
        let (model, _) = loadedModel(3)
        model.open(at: 99)
        XCTAssertEqual(model.activeIndex, 2)
    }

    func testOpenIsNoOpWhenEmpty() {
        let source = InMemoryPhotoGallerySource()
        let model = PhotoGalleryModel(source: source)
        model.start()
        source.push(PhotoGalleryUpdate(status: .loaded, photos: []))

        model.open(at: 0)
        XCTAssertFalse(model.isViewerOpen)
    }

    func testNextAndPreviousClampAtBounds() {
        let (model, _) = loadedModel(3)
        model.open(at: 0)
        XCTAssertFalse(model.canGoPrevious)
        XCTAssertTrue(model.canGoNext)

        model.showPrevious()
        XCTAssertEqual(model.activeIndex, 0)

        model.showNext()
        model.showNext()
        XCTAssertEqual(model.activeIndex, 2)
        XCTAssertTrue(model.canGoPrevious)
        XCTAssertFalse(model.canGoNext)

        model.showNext()
        XCTAssertEqual(model.activeIndex, 2)
    }

    func testCloseHidesViewer() {
        let (model, _) = loadedModel(3)
        model.open(at: 1)
        model.close()
        XCTAssertFalse(model.isViewerOpen)
    }

    func testShrinkingSetClampsActiveIndex() {
        let (model, source) = loadedModel(5)
        model.open(at: 4)
        XCTAssertEqual(model.activeIndex, 4)

        source.push(PhotoGalleryUpdate(status: .loaded, photos: samplePhotos(2)))
        XCTAssertEqual(model.activeIndex, 1)
        XCTAssertTrue(model.isViewerOpen)
    }

    func testEmptyingSetClosesViewer() {
        let (model, source) = loadedModel(3)
        model.open(at: 1)
        XCTAssertTrue(model.isViewerOpen)

        source.push(PhotoGalleryUpdate(status: .loaded, photos: []))
        XCTAssertFalse(model.isViewerOpen)
        XCTAssertNil(model.activeImage)
    }
}

// MARK: - Resolved labels (web `t(key, { ... })`)

@MainActor
final class PhotoGalleryModelLabelTests: XCTestCase {
    func testUnnamedGalleryLabel() {
        let source = InMemoryPhotoGallerySource()
        let model = PhotoGalleryModel(source: source, localize: echoLocalize)
        XCTAssertEqual(model.galleryAccessibilityLabel, "Photo gallery")
    }

    func testNamedGalleryLabelInterpolatesName() {
        let source = InMemoryPhotoGallerySource()
        let model = PhotoGalleryModel(source: source, localize: echoLocalize, vehicleName: "Cybertruck")
        XCTAssertEqual(model.galleryAccessibilityLabel, "Cybertruck photo gallery")
    }

    func testThumbnailLabelIsOneBased() {
        let source = InMemoryPhotoGallerySource()
        let model = PhotoGalleryModel(source: source, localize: echoLocalize)
        model.start()
        source.push(PhotoGalleryUpdate(status: .loaded, photos: samplePhotos(7)))

        XCTAssertEqual(model.thumbnailLabel(at: 0), "Open photo 1 of 7")
        XCTAssertEqual(model.thumbnailLabel(at: 6), "Open photo 7 of 7")
    }

    func testViewerCounterIsOneBased() {
        let source = InMemoryPhotoGallerySource()
        let model = PhotoGalleryModel(source: source, localize: echoLocalize)
        model.start()
        source.push(PhotoGalleryUpdate(status: .loaded, photos: samplePhotos(4)))
        model.open(at: 2)

        XCTAssertEqual(model.viewerCounterLabel, "3 of 4")
    }

    func testImageAltFallsBackWhenEmpty() {
        let source = InMemoryPhotoGallerySource()
        let model = PhotoGalleryModel(source: source, localize: echoLocalize)
        let decorative = PhotoGalleryImage(id: "x", alt: "")
        let described = PhotoGalleryImage(id: "y", alt: "Rear view")

        XCTAssertEqual(model.imageAlt(decorative), "Vehicle photo")
        XCTAssertEqual(model.imageAlt(described), "Rear view")
    }
}
