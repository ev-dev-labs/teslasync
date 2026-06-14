//
//  Lightbox.ModelTests.swift
//  TeslaSync — P4 shared surface · 0219 · Lightbox (Apple)
//
//  The state-holder coverage (P1/S8): the index seeding (web `safeInitialIndex`), the once-per-open
//  `view.opened` emission + its re-emit on reopen (P1/S11), the bounds-clamped navigation that resets the
//  zoom + pan on a new image (web effect on `[index]`), the stepped + clamped zoom (web `zoomIn` / `zoomOut`
//  with the snap-to-1x pan reset), the zoom-gated pan (web `if (zoom <= 1) return`), the image load lifecycle
//  through the seam (loaded / failed + retry), the neighbour pre-warm, the `initialIndex` reset semantics
//  (re-applied on open, ignored while open — web `wasOpenRef`), and the dismiss closure (web `onClose`). These
//  run in the TeslaSync(/-macOS) XCTest targets; the only async work is the injected loader.
//

import XCTest
@testable import TeslaSync

@MainActor
final class LightboxModelTests: XCTestCase {
    private static let images = [
        LightboxImage(source: "a", alt: "A"),
        LightboxImage(source: "b", alt: "B"),
        LightboxImage(source: "c", alt: "C")
    ]

    private func makeModel(
        open: Bool = true,
        images: [LightboxImage] = images,
        initialIndex: Int = 0,
        loader: any LightboxImageLoading = StaticLightboxImageLoader(),
        telemetry: any LightboxTelemetry = SpyLightboxTelemetry(),
        onClose: @escaping @MainActor () -> Void = {}
    ) -> LightboxModel {
        LightboxModel(
            input: LightboxInput(isOpen: open, images: images, initialIndex: initialIndex),
            onClose: onClose,
            loader: loader,
            telemetry: telemetry
        )
    }

    // MARK: Seeding + telemetry

    func testInitSeedsIndexFromSafeInitialIndex() {
        XCTAssertEqual(makeModel(initialIndex: 2).index, 2)
        XCTAssertEqual(makeModel(initialIndex: 9).index, 2, "clamps to the last image")
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyLightboxTelemetry()
        let model = makeModel(telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [LightboxSurface.slug])
    }

    func testStopThenStartDoesNotReEmitWhileOpen() {
        let spy = SpyLightboxTelemetry()
        let model = makeModel(telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, [LightboxSurface.slug], "re-appear while open does not re-emit")
    }

    func testReopenReEmitsViewOpened() {
        let spy = SpyLightboxTelemetry()
        let model = makeModel(telemetry: spy)
        model.start()
        model.update(LightboxInput(isOpen: false, images: Self.images, initialIndex: 0))
        model.update(LightboxInput(isOpen: true, images: Self.images, initialIndex: 0))
        XCTAssertEqual(spy.surfaces, [LightboxSurface.slug, LightboxSurface.slug], "each open is a view.opened")
    }

    // MARK: Navigation

    func testGoNextAndPreviousClampAndResetZoomPan() {
        let model = makeModel()
        model.start()
        model.zoomIn()
        model.setPan(LightboxPan(x: 12, y: 8))
        model.goNext()
        XCTAssertEqual(model.index, 1)
        XCTAssertEqual(model.zoom, 1, accuracy: 0.0001, "new image resets zoom")
        XCTAssertEqual(model.pan, .zero, "new image resets pan")
        model.goPrevious()
        XCTAssertEqual(model.index, 0)
        model.goPrevious()
        XCTAssertEqual(model.index, 0, "clamped at the first image")
    }

    func testGoFirstAndGoLast() {
        let model = makeModel(initialIndex: 1)
        model.start()
        model.goLast()
        XCTAssertEqual(model.index, 2)
        model.goFirst()
        XCTAssertEqual(model.index, 0)
    }

    // MARK: Zoom + pan

    func testZoomInOutClampAndResetPanAtMin() {
        let model = makeModel()
        model.start()
        model.zoomIn()
        model.zoomIn()
        XCTAssertEqual(model.zoom, 2, accuracy: 0.0001)
        model.setPan(LightboxPan(x: 20, y: 0))
        model.zoomOut()
        XCTAssertEqual(model.zoom, 1.5, accuracy: 0.0001)
        XCTAssertTrue(model.pan.isOffset, "pan persists while still zoomed")
        model.zoomOut()
        XCTAssertEqual(model.zoom, 1, accuracy: 0.0001)
        XCTAssertEqual(model.pan, .zero, "snapping back to 1x re-centres the pan")
    }

    func testZoomInClampsAtMaximum() {
        let model = makeModel()
        model.start()
        for _ in 0 ..< 20 {
            model.zoomIn()
        }
        XCTAssertEqual(model.zoom, LightboxZoom.maximum, accuracy: 0.0001)
    }

    func testZoomResetClearsZoomAndPan() {
        let model = makeModel()
        model.start()
        model.zoomIn()
        model.setPan(LightboxPan(x: 5, y: 5))
        model.zoomReset()
        XCTAssertEqual(model.zoom, 1, accuracy: 0.0001)
        XCTAssertEqual(model.pan, .zero)
    }

    func testSetPanIgnoredUntilZoomed() {
        let model = makeModel()
        model.start()
        model.setPan(LightboxPan(x: 10, y: 10))
        XCTAssertEqual(model.pan, .zero, "web: pan is a no-op until zoom > 1")
        model.zoomIn()
        model.setPan(LightboxPan(x: 10, y: 10))
        XCTAssertEqual(model.pan, LightboxPan(x: 10, y: 10))
    }

    // MARK: Image load lifecycle

    func testLoadSuccessSetsLoadedPhase() async {
        let data = Data([1, 2, 3, 4])
        let model = makeModel(loader: StaticLightboxImageLoader(outcome: .loaded(data)))
        model.start()
        await model.awaitCurrentLoad()
        XCTAssertEqual(model.loadPhase, .loaded(data))
    }

    func testLoadFailureSetsFailedPhase() async {
        let model = makeModel(loader: StaticLightboxImageLoader(outcome: .failed))
        model.start()
        await model.awaitCurrentLoad()
        XCTAssertEqual(model.loadPhase, .failed)
    }

    func testRetryReloadsCurrentImage() async {
        let loader = StaticLightboxImageLoader(outcome: .failed)
        let model = makeModel(loader: loader)
        model.start()
        await model.awaitCurrentLoad()
        model.retry()
        await model.awaitCurrentLoad()
        XCTAssertEqual(loader.loadedSources, ["a", "a"], "retry forces a reload of the same source")
    }

    func testPrewarmsNeighboursOnOpen() {
        let loader = StaticLightboxImageLoader()
        let model = makeModel(loader: loader)
        model.start()
        XCTAssertEqual(loader.prewarmedSources, ["b"], "index 0 of 3 pre-warms its single neighbour")
    }

    // MARK: initialIndex reset semantics (web wasOpenRef)

    func testInitialIndexIgnoredWhileOpenButAppliedOnReopen() {
        let model = makeModel(initialIndex: 0)
        model.start()
        model.goNext()
        XCTAssertEqual(model.index, 1)
        model.update(LightboxInput(isOpen: true, images: Self.images, initialIndex: 2))
        XCTAssertEqual(model.index, 1, "a re-render with a new initialIndex does not snap an open viewer")
        model.update(LightboxInput(isOpen: false, images: Self.images, initialIndex: 2))
        model.update(LightboxInput(isOpen: true, images: Self.images, initialIndex: 2))
        XCTAssertEqual(model.index, 2, "reopen re-applies the initialIndex")
    }

    // MARK: Dismiss + derived

    func testCloseInvokesOnClose() {
        let recorder = CloseRecorder()
        let model = makeModel(onClose: { recorder.record() })
        model.close()
        XCTAssertEqual(recorder.count, 1)
    }

    func testCurrentImageResolves() {
        let model = makeModel(initialIndex: 1)
        XCTAssertEqual(model.currentImage?.source, "b")
        XCTAssertEqual(model.projection.total, 3)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyLightboxTelemetry: LightboxTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.withLock { storage }
    }

    func viewOpened(surface: String) {
        lock.withLock { storage.append(surface) }
    }
}

/// Records `close()` invocations routed through the dismiss closure (web `onClose`).
@MainActor
private final class CloseRecorder {
    private(set) var count = 0

    func record() {
        count += 1
    }
}
