//
//  Lightbox.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0219 · Lightbox (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the zoom-scale constants, the
//  bounds-clamped navigation (the verbatim port of the web `Math.max(0, i-1)` / `Math.min(total-1, i+1)`), the
//  stepped + clamped zoom (web `LIGHTBOX_MIN/MAX/STEP`), the percent readout (web `Math.round(zoom*100)`), the
//  reset enable, the neighbour pre-warm indices (web `[-1, 1]`), the resolved image, the full projection, and
//  the value-type semantics. Split from Lightbox.Tests.swift (the SwiftUI / state-holder half) to keep each
//  file within the SwiftLint file-length budget. The derivation is pure — no network, no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity + zoom scale

final class LightboxAdapterIdentityTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(LightboxSurface.slug, "Lightbox")
    }

    func testZoomScaleMatchesWebConstants() {
        XCTAssertEqual(LightboxZoom.minimum, 1, accuracy: 0.0001)
        XCTAssertEqual(LightboxZoom.maximum, 5, accuracy: 0.0001)
        XCTAssertEqual(LightboxZoom.step, 0.5, accuracy: 0.0001)
    }
}

// MARK: - Navigation (web goPrev / goNext / goFirst / goLast)

final class LightboxNavigationTests: XCTestCase {
    func testClampIndexBoundsAndEmpty() {
        XCTAssertEqual(LightboxProjector.clampIndex(-3, total: 5), 0)
        XCTAssertEqual(LightboxProjector.clampIndex(9, total: 5), 4)
        XCTAssertEqual(LightboxProjector.clampIndex(2, total: 5), 2)
        XCTAssertEqual(LightboxProjector.clampIndex(3, total: 0), 0, "empty list clamps to 0")
    }

    func testPreviousAndNextClampAtBounds() {
        XCTAssertEqual(LightboxProjector.previousIndex(0), 0, "web Math.max(0, i-1)")
        XCTAssertEqual(LightboxProjector.previousIndex(3), 2)
        XCTAssertEqual(LightboxProjector.nextIndex(4, total: 5), 4, "web Math.min(total-1, i+1)")
        XCTAssertEqual(LightboxProjector.nextIndex(1, total: 5), 2)
        XCTAssertEqual(LightboxProjector.nextIndex(0, total: 0), 0, "empty list stays at 0")
    }

    func testFirstAndLast() {
        XCTAssertEqual(LightboxProjector.firstIndex(), 0)
        XCTAssertEqual(LightboxProjector.lastIndex(total: 5), 4)
        XCTAssertEqual(LightboxProjector.lastIndex(total: 0), 0)
    }
}

// MARK: - Zoom (web zoomIn / zoomOut / clamp / percent)

final class LightboxZoomTests: XCTestCase {
    func testRound2AvoidsFloatDrift() {
        XCTAssertEqual(LightboxProjector.round2(1 + 0.5 + 0.5), 2, accuracy: 0.0001)
        XCTAssertEqual(LightboxProjector.round2(2.005), 2.01, accuracy: 0.0001)
    }

    func testZoomInStepsAndClampsAtMax() {
        XCTAssertEqual(LightboxProjector.zoomedIn(1), 1.5, accuracy: 0.0001)
        XCTAssertEqual(LightboxProjector.zoomedIn(4.5), 5, accuracy: 0.0001)
        XCTAssertEqual(LightboxProjector.zoomedIn(5), 5, accuracy: 0.0001, "clamped at LIGHTBOX_MAX_ZOOM")
    }

    func testZoomOutStepsAndClampsAtMin() {
        XCTAssertEqual(LightboxProjector.zoomedOut(5), 4.5, accuracy: 0.0001)
        XCTAssertEqual(LightboxProjector.zoomedOut(1.5), 1, accuracy: 0.0001)
        XCTAssertEqual(LightboxProjector.zoomedOut(1), 1, accuracy: 0.0001, "clamped at LIGHTBOX_MIN_ZOOM")
    }

    func testZoomCapabilityFlags() {
        XCTAssertTrue(LightboxProjector.canZoomIn(4.5))
        XCTAssertFalse(LightboxProjector.canZoomIn(5))
        XCTAssertTrue(LightboxProjector.canZoomOut(1.5))
        XCTAssertFalse(LightboxProjector.canZoomOut(1))
        XCTAssertFalse(LightboxProjector.isZoomed(1))
        XCTAssertTrue(LightboxProjector.isZoomed(1.5))
    }

    func testZoomPercentRounds() {
        XCTAssertEqual(LightboxProjector.zoomPercent(1), 100)
        XCTAssertEqual(LightboxProjector.zoomPercent(1.5), 150)
        XCTAssertEqual(LightboxProjector.zoomPercent(5), 500)
    }

    func testCanResetWhenZoomedOrPanned() {
        XCTAssertFalse(LightboxProjector.canReset(zoom: 1, pan: .zero))
        XCTAssertTrue(LightboxProjector.canReset(zoom: 1.5, pan: .zero), "zoomed enables reset")
        XCTAssertTrue(LightboxProjector.canReset(zoom: 1, pan: LightboxPan(x: 12, y: 0)), "panned enables reset")
    }
}

// MARK: - Neighbours + resolved image

final class LightboxResolveTests: XCTestCase {
    private let images = [
        LightboxImage(source: "a", alt: "A"),
        LightboxImage(source: "b", alt: "B"),
        LightboxImage(source: "c", alt: "C")
    ]

    func testNeighbourIndicesFilteredToRange() {
        XCTAssertEqual(LightboxProjector.neighbourIndices(index: 0, total: 3), [1], "no -1 at the first image")
        XCTAssertEqual(LightboxProjector.neighbourIndices(index: 1, total: 3), [0, 2])
        XCTAssertEqual(LightboxProjector.neighbourIndices(index: 2, total: 3), [1], "no +1 at the last image")
        XCTAssertEqual(LightboxProjector.neighbourIndices(index: 0, total: 1), [], "single image has no neighbours")
    }

    func testResolvedImageClampsAndHandlesEmpty() {
        XCTAssertEqual(LightboxProjector.resolvedImage(images: images, index: 1)?.source, "b")
        XCTAssertEqual(LightboxProjector.resolvedImage(images: images, index: 9)?.source, "c", "clamps to last")
        XCTAssertNil(LightboxProjector.resolvedImage(images: [], index: 0))
    }
}

// MARK: - Projection (view-ready chrome)

final class LightboxProjectionTests: XCTestCase {
    func testFirstImageOfSequence() {
        let projection = LightboxProjector.resolve(index: 0, total: 3, zoom: 1, pan: .zero)
        XCTAssertTrue(projection.isFirst)
        XCTAssertFalse(projection.isLast)
        XCTAssertTrue(projection.showsNavigation, "total > 1 shows nav")
        XCTAssertFalse(projection.canZoomOut)
        XCTAssertTrue(projection.canZoomIn)
        XCTAssertFalse(projection.canReset)
        XCTAssertEqual(projection.zoomPercent, 100)
    }

    func testLastImageAndSingleImage() {
        let last = LightboxProjector.resolve(index: 2, total: 3, zoom: 1, pan: .zero)
        XCTAssertTrue(last.isLast)
        XCTAssertFalse(last.isFirst)
        let single = LightboxProjector.resolve(index: 0, total: 1, zoom: 1, pan: .zero)
        XCTAssertFalse(single.showsNavigation, "single image hides nav")
        XCTAssertTrue(single.isFirst)
        XCTAssertTrue(single.isLast)
    }

    func testZoomedProjectionEnablesPanAndReset() {
        let projection = LightboxProjector.resolve(index: 1, total: 3, zoom: 2, pan: LightboxPan(x: 5, y: 5))
        XCTAssertTrue(projection.isZoomed)
        XCTAssertTrue(projection.canZoomIn)
        XCTAssertTrue(projection.canZoomOut)
        XCTAssertTrue(projection.canReset)
        XCTAssertEqual(projection.zoomPercent, 200)
    }
}

// MARK: - Value types

final class LightboxValueTypeTests: XCTestCase {
    func testImageIdentityAndEquality() {
        let image = LightboxImage(source: "url", alt: "Alt", caption: "Cap")
        XCTAssertEqual(image.id, "url", "id is the source (web src)")
        XCTAssertEqual(image, LightboxImage(source: "url", alt: "Alt", caption: "Cap"))
        XCTAssertNotEqual(image, LightboxImage(source: "url", alt: "Alt"))
    }

    func testInputTotalAndSafeInitialIndex() {
        let input = LightboxInput(
            isOpen: true,
            images: [LightboxImage(source: "a", alt: "A"), LightboxImage(source: "b", alt: "B")],
            initialIndex: 9
        )
        XCTAssertEqual(input.total, 2)
        XCTAssertEqual(input.safeInitialIndex, 1, "clamps out-of-range initialIndex")
        let empty = LightboxInput(isOpen: true, images: [], initialIndex: 3)
        XCTAssertEqual(empty.safeInitialIndex, 0, "empty list clamps to 0")
    }

    func testPanOffsetAndZero() {
        XCTAssertFalse(LightboxPan.zero.isOffset)
        XCTAssertTrue(LightboxPan(x: 0, y: 4).isOffset)
        XCTAssertTrue(LightboxPan(x: -2, y: 0).isOffset)
    }
}
