//
//  VehiclePhotoGallery.Tests.swift
//  TeslaSync — P4 feature view · 0306 · VehiclePhotoGallery (Apple)
//
//  Adapter + projection coverage for the VehiclePhotoGallery surface:
//    • Layout — the web 2 / 3 / 4 responsive column ladder at every breakpoint boundary.
//    • Accessibility — the named/unnamed gallery descriptor + the `{{name}}` / `{{index}}` /
//      `{{total}}` interpolation the web `t(key, { ... })` calls perform.
//    • Projection — the web empty/data branch plus the P4 leaf contract across loading /
//      empty / error / data, the cached-grid-survives-failed-reload inline error, and the
//      index clamp guarding the immersive viewer.
//    • Image record — identity + equality of the normalized `LightboxImage`.
//    • Surface — the `view.opened` slug (P1/S11) + the view's forwarder.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Layout (web `grid-cols-2 sm:grid-cols-3 md:grid-cols-4`)

final class PhotoGalleryLayoutTests: XCTestCase {
    func testTwoColumnsBelowSmallBreakpoint() {
        XCTAssertEqual(PhotoGalleryLayout.columnCount(forWidth: 0), 2)
        XCTAssertEqual(PhotoGalleryLayout.columnCount(forWidth: 320), 2)
        XCTAssertEqual(PhotoGalleryLayout.columnCount(forWidth: 639), 2)
    }

    func testThreeColumnsAtSmallBreakpoint() {
        XCTAssertEqual(PhotoGalleryLayout.columnCount(forWidth: 640), 3)
        XCTAssertEqual(PhotoGalleryLayout.columnCount(forWidth: 700), 3)
        XCTAssertEqual(PhotoGalleryLayout.columnCount(forWidth: 767), 3)
    }

    func testFourColumnsAtMediumBreakpoint() {
        XCTAssertEqual(PhotoGalleryLayout.columnCount(forWidth: 768), 4)
        XCTAssertEqual(PhotoGalleryLayout.columnCount(forWidth: 1200), 4)
    }
}

// MARK: - Accessibility (web aria-label builders)

final class PhotoGalleryAccessibilityTests: XCTestCase {
    func testUnnamedGalleryDescriptor() {
        let descriptor = PhotoGalleryAccessibility.galleryLabel(hasVehicleName: false)
        XCTAssertEqual(descriptor.key, "vehicles.photos.gallery")
        XCTAssertEqual(descriptor.fallback, "Photo gallery")
    }

    func testNamedGalleryDescriptor() {
        let descriptor = PhotoGalleryAccessibility.galleryLabel(hasVehicleName: true)
        XCTAssertEqual(descriptor.key, "vehicles.photos.galleryNamed")
        XCTAssertEqual(descriptor.fallback, "{{name}} photo gallery")
    }

    func testInterpolateNameSubstitutesToken() {
        let result = PhotoGalleryAccessibility.interpolateName("{{name}} photo gallery", name: "Model Y")
        XCTAssertEqual(result, "Model Y photo gallery")
    }

    func testInterpolatePositionSubstitutesIndexAndTotal() {
        let result = PhotoGalleryAccessibility.interpolatePosition(
            "Open photo {{index}} of {{total}}",
            index: 3,
            total: 7
        )
        XCTAssertEqual(result, "Open photo 3 of 7")
    }

    func testInterpolatePositionForCounter() {
        let result = PhotoGalleryAccessibility.interpolatePosition("{{index}} of {{total}}", index: 1, total: 4)
        XCTAssertEqual(result, "1 of 4")
    }
}

// MARK: - Projection (web empty/data branch + P4 leaf contract)

final class PhotoGalleryProjectionTests: XCTestCase {
    func testInitialLoading() {
        XCTAssertEqual(PhotoGalleryProjection.resolvePhase(status: .loading, hasPhotos: false), .loading)
    }

    func testEmptyWhenResolvedWithoutPhotos() {
        XCTAssertEqual(PhotoGalleryProjection.resolvePhase(status: .loaded, hasPhotos: false), .empty)
    }

    func testDataWhenPhotosPresent() {
        XCTAssertEqual(PhotoGalleryProjection.resolvePhase(status: .loaded, hasPhotos: true), .data)
    }

    func testErrorWhenFirstLoadFailsWithNothingCached() {
        XCTAssertEqual(
            PhotoGalleryProjection.resolvePhase(status: .failed("boom"), hasPhotos: false),
            .error("boom")
        )
    }

    func testCachedGridSurvivesFailedReload() {
        let phase = PhotoGalleryProjection.resolvePhase(status: .failed("stale read"), hasPhotos: true)
        XCTAssertEqual(phase, .data)
        XCTAssertEqual(
            PhotoGalleryProjection.inlineErrorMessage(phase: phase, status: .failed("stale read")),
            "stale read"
        )
    }

    func testInlineErrorNilWhenNotData() {
        XCTAssertNil(PhotoGalleryProjection.inlineErrorMessage(phase: .empty, status: .failed("x")))
    }

    func testInlineErrorNilWhenMessageEmpty() {
        XCTAssertNil(PhotoGalleryProjection.inlineErrorMessage(phase: .data, status: .failed("")))
    }

    func testClampIndexWithinBounds() {
        XCTAssertEqual(PhotoGalleryProjection.clampIndex(3, count: 7), 3)
    }

    func testClampIndexBelowZero() {
        XCTAssertEqual(PhotoGalleryProjection.clampIndex(-2, count: 7), 0)
    }

    func testClampIndexAboveUpperBound() {
        XCTAssertEqual(PhotoGalleryProjection.clampIndex(99, count: 7), 6)
    }

    func testClampIndexEmptyCollection() {
        XCTAssertEqual(PhotoGalleryProjection.clampIndex(4, count: 0), 0)
    }
}

// MARK: - Image record (web `LightboxImage`)

final class PhotoGalleryImageTests: XCTestCase {
    func testIdentityUsesSource() {
        let image = PhotoGalleryImage(id: "https://cdn/photo-1.jpg", alt: "Front")
        XCTAssertEqual(image.id, "https://cdn/photo-1.jpg")
        XCTAssertNil(image.caption)
        XCTAssertNil(image.data)
    }

    func testEqualityConsidersAllFields() {
        let bytes = Data([0xFF, 0xD8, 0xFF])
        let lhs = PhotoGalleryImage(id: "a", alt: "Alt", caption: "Cap", data: bytes)
        let rhs = PhotoGalleryImage(id: "a", alt: "Alt", caption: "Cap", data: bytes)
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, PhotoGalleryImage(id: "a", alt: "Alt", caption: "Other", data: bytes))
    }
}

// MARK: - Surface identity (P1/S11 view.opened)

final class PhotoGallerySurfaceTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(PhotoGallerySurface.slug, "VehiclePhotoGallery")
    }

    func testViewSurfaceSlugMatchesSurface() {
        XCTAssertEqual(VehiclePhotoGallery.surfaceSlug, PhotoGallerySurface.slug)
    }
}
