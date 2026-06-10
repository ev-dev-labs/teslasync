//
//  Popover.ModelTests.swift
//  TeslaSync — P4 modal / dialog · 0015 · Popover (Apple)
//
//  State-holder coverage for `PopoverModel`: the P1/S11 `view.opened` telemetry (once per open,
//  idempotent while open, re-emitted on re-open), the present / dismiss lifecycle + the `onClose`
//  callback (web `onClose`), the measuring → positioned transition (web `pos === null` → placed),
//  the placement / resolved-side / content-cap delegation to `PopoverGeometry`, the localized
//  accessibility labels, and the config defaults. SwiftUI-free; driven directly.
//

import CoreGraphics
import XCTest
@testable import TeslaSync

/// Records `view.opened` surfaces. Lock-guarded for the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyPopoverTelemetry: PopoverTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }
}

/// Counts `onClose` invocations (web `onClose`). MainActor-confined like the model that calls it.
@MainActor
private final class DismissRecorder {
    private(set) var count = 0
    func record() {
        count += 1
    }
}

@MainActor
final class PopoverModelTests: XCTestCase {
    private let viewport = CGSize(width: 1000, height: 800)
    private let anchor = CGRect(x: 100, y: 100, width: 80, height: 40)
    private let content = CGSize(width: 200, height: 120)

    private func sentinelLocalize(_: String, _ fallback: String) -> String {
        "L:" + fallback
    }

    // MARK: Telemetry

    func testPresentEmitsViewOpenedOncePerOpen() {
        let spy = SpyPopoverTelemetry()
        let model = PopoverModel(telemetry: spy)

        model.present()
        model.present() // already open → no second event
        XCTAssertEqual(spy.surfaces, [PopoverSurfaceID.slug])

        model.dismiss()
        model.present() // re-open → a fresh view-open event
        XCTAssertEqual(spy.surfaces.count, 2)
    }

    func testSetPresentedMirrorsBindingAndIsIdempotent() {
        let spy = SpyPopoverTelemetry()
        let model = PopoverModel(telemetry: spy)

        model.setPresented(true)
        model.setPresented(true)
        XCTAssertTrue(model.isPresented)
        XCTAssertEqual(spy.surfaces.count, 1)

        model.setPresented(false)
        XCTAssertFalse(model.isPresented)
    }

    // MARK: onClose

    func testDismissInvokesOnCloseOnlyWhenOpen() {
        let recorder = DismissRecorder()
        let model = PopoverModel(onDismiss: recorder.record)

        model.setPresented(false) // already closed → no callback
        XCTAssertEqual(recorder.count, 0)

        model.present()
        model.dismiss()
        XCTAssertEqual(recorder.count, 1)
    }

    // MARK: Measuring → positioned

    func testMeasuringTransitionsToPositioned() {
        let model = PopoverModel()
        XCTAssertFalse(model.isMeasuring) // not presented

        model.present()
        XCTAssertTrue(model.isMeasuring) // open, not yet measured
        XCTAssertNil(model.placement)

        model.updateViewport(viewport)
        model.updateAnchor(anchor)
        model.updateContent(content)
        XCTAssertNotNil(model.placement)
        XCTAssertFalse(model.isMeasuring)

        model.dismiss()
        XCTAssertNil(model.placement) // reset for next open
        XCTAssertFalse(model.isMeasuring)
    }

    func testPlacementStaysNilUntilFullyMeasured() {
        let model = PopoverModel()
        model.present()
        model.updateViewport(viewport)
        model.updateAnchor(anchor)
        XCTAssertNil(model.placement) // content size still unknown
    }

    // MARK: Geometry delegation

    func testPlacementMatchesEngine() {
        let model = PopoverModel(side: .bottom, align: .center)
        model.present()
        model.updateViewport(viewport)
        model.updateAnchor(anchor)
        model.updateContent(content)

        let expected = PopoverGeometry.place(
            anchor: anchor, content: content, viewport: viewport, side: .bottom, align: .center
        )
        XCTAssertEqual(model.placement, expected)
    }

    func testResolvedSideReflectsFlip() {
        let model = PopoverModel(side: .bottom)
        XCTAssertEqual(model.resolvedSide, .bottom) // before any placement

        model.present()
        model.updateViewport(viewport)
        model.updateAnchor(CGRect(x: 100, y: 760, width: 80, height: 30)) // little room below
        model.updateContent(content)
        XCTAssertEqual(model.resolvedSide, .top) // flipped up
    }

    func testContentMaxSizeMatchesEngineOnceMeasured() {
        let model = PopoverModel(side: .bottom)
        XCTAssertEqual(model.contentMaxSize, .zero) // viewport unmeasured → no cap

        model.present()
        model.updateAnchor(anchor)
        model.updateViewport(viewport)

        let expected = PopoverGeometry.availableContentSize(
            anchor: anchor, viewport: viewport, side: .bottom
        )
        XCTAssertEqual(model.contentMaxSize.width, expected.width, accuracy: 0.0001)
        XCTAssertEqual(model.contentMaxSize.height, expected.height, accuracy: 0.0001)
    }

    // MARK: Accessibility

    func testAccessibilityLabelsUseLocalizer() {
        let model = PopoverModel(localize: sentinelLocalize)
        XCTAssertEqual(model.regionAccessibilityLabel, "L:Popover")
        XCTAssertEqual(model.dismissAccessibilityLabel, "L:Dismiss")
        XCTAssertEqual(model.emptyAccessibilityLabel, "L:Nothing to show")
    }

    func testCustomAccessibilityLabelWins() {
        let model = PopoverModel(accessibilityLabel: "Trip details", localize: sentinelLocalize)
        XCTAssertEqual(model.regionAccessibilityLabel, "Trip details")
    }

    // MARK: Config defaults

    func testConfigDefaults() {
        let model = PopoverModel()
        XCTAssertEqual(model.side, .bottom)
        XCTAssertEqual(model.align, .start)
        XCTAssertEqual(model.sideOffset, PopoverGeometry.defaultSideOffset, accuracy: 0.0001)
        XCTAssertFalse(model.isPresented)
    }
}
