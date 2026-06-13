//
//  TourOverlay.Tests.swift
//  TeslaSync — P4 shared surface · 0145 · TourOverlay (Apple)
//
//  State-holder coverage for the TourOverlay surface — the model that binds the web `useTour` contract:
//    • start — emits the `view.opened` telemetry once and starts the source (idempotent).
//    • apply — a pushed snapshot drives the phase / connection / step / anchor / index / count, and the
//      derived spotlight + tooltip-layout + dots + nav + counter + dialog label track it.
//    • commands — next / prev / skip forward to the control seam (web `onNext` / `onPrev` / `onSkip`).
//    • freshness — a stale transition auto-refreshes exactly once; offline does not.
//    • leaf contract — the inline refresh-failure surfaces only while a cached anchor is on screen.
//
//  These run in the TeslaSync(/-macOS) XCTest targets, driving the model through an in-memory source
//  with no network and no rendered view.
//

import CoreGraphics
import XCTest
@testable import TeslaSync

// MARK: - Spies

private final class SpyTourOverlayTelemetry: TourOverlayTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var opened: [String] = []

    var openedSurfaces: [String] {
        lock.withLock { opened }
    }

    func viewOpened(surface: String) {
        lock.withLock { opened.append(surface) }
    }
}

private final class SpyTourOverlayController: TourOverlayController, @unchecked Sendable {
    private let lock = NSLock()
    private(set) var nextCount = 0
    private(set) var prevCount = 0
    private(set) var skipCount = 0

    func next() {
        lock.withLock { nextCount += 1 }
    }

    func prev() {
        lock.withLock { prevCount += 1 }
    }

    func skip() {
        lock.withLock { skipCount += 1 }
    }
}

private let identityLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

private func anchoredUpdate(
    status: TourOverlayLoadStatus = .loaded,
    connection: TourOverlayConnection = .live,
    placement: TourOverlayPlacement = .bottom,
    currentStep: Int = 0,
    totalSteps: Int = 4
) -> TourOverlayUpdate {
    TourOverlayUpdate(
        status: status,
        connection: connection,
        step: TourOverlayStep(id: "#anchor", title: "Title", detail: "Detail", placement: placement),
        targetRect: TourOverlayTargetRect(x: 300, y: 250, width: 160, height: 50),
        currentStep: currentStep,
        totalSteps: totalSteps
    )
}

// MARK: - Model

@MainActor
final class TourOverlayModelTests: XCTestCase {
    func testStartEmitsViewOpenedAndStartsSource() {
        let source = InMemoryTourOverlaySource(initial: TourOverlayUpdate(status: .loaded))
        let telemetry = SpyTourOverlayTelemetry()
        let model = TourOverlayModel(source: source, telemetry: telemetry)

        model.start()
        model.start() // idempotent

        XCTAssertEqual(telemetry.openedSurfaces, ["TourOverlay"])
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(model.phase, .empty) // loaded + no anchor
    }

    func testApplyDrivesPhaseStepAndAnchor() {
        let source = InMemoryTourOverlaySource()
        let model = TourOverlayModel(source: source)
        model.start()

        source.push(anchoredUpdate(currentStep: 1, totalSteps: 4))

        XCTAssertEqual(model.phase, .data)
        XCTAssertTrue(model.hasAnchor)
        XCTAssertEqual(model.currentStep, 1)
        XCTAssertEqual(model.totalSteps, 4)
        XCTAssertEqual(model.connection, .live)
        XCTAssertNotNil(model.spotlight)
        XCTAssertEqual(model.step?.title, "Title")
    }

    func testDerivedDecorationsTrackTheSnapshot() {
        let source = InMemoryTourOverlaySource()
        let model = TourOverlayModel(source: source, localize: identityLocalize)
        model.start()

        source.push(anchoredUpdate(currentStep: 1, totalSteps: 4))

        XCTAssertEqual(model.stepCounterText, "2 / 4")
        XCTAssertTrue(model.navModel.showsBack)
        XCTAssertEqual(model.progressDots.count, 4)
        XCTAssertEqual(model.dialogAccessibilityLabel, "Tour step 2 of 4")
    }

    func testTooltipLayoutMatchesPositionerAndIsNilWithoutAnchor() {
        let source = InMemoryTourOverlaySource()
        let model = TourOverlayModel(source: source)
        model.start()

        let viewport = TourOverlayViewport(width: 1200, height: 900)
        source.push(anchoredUpdate(placement: .right))
        let expected = TourOverlayTooltipPositioner.layout(
            placement: .right,
            rect: TourOverlayTargetRect(x: 300, y: 250, width: 160, height: 50),
            viewport: viewport
        )
        XCTAssertEqual(model.tooltipLayout(viewport: viewport), expected)

        source.push(TourOverlayUpdate(status: .loaded)) // no anchor
        XCTAssertNil(model.tooltipLayout(viewport: viewport))
    }

    func testNextPrevSkipForwardToController() {
        let source = InMemoryTourOverlaySource()
        let controller = SpyTourOverlayController()
        let model = TourOverlayModel(source: source, controller: controller)
        model.start()

        model.next()
        model.next()
        model.prev()
        model.skip()

        XCTAssertEqual(controller.nextCount, 2)
        XCTAssertEqual(controller.prevCount, 1)
        XCTAssertEqual(controller.skipCount, 1)
    }

    func testRefreshForwardsToSource() {
        let source = InMemoryTourOverlaySource()
        let model = TourOverlayModel(source: source)
        model.start()

        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let source = InMemoryTourOverlaySource()
        let model = TourOverlayModel(source: source)
        model.start()

        source.push(anchoredUpdate(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)

        // A second stale snapshot does not re-trigger the one-shot auto-refresh.
        source.push(anchoredUpdate(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)

        // Back to live, then stale again → re-arms exactly once.
        source.push(anchoredUpdate(connection: .live))
        source.push(anchoredUpdate(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let source = InMemoryTourOverlaySource()
        let model = TourOverlayModel(source: source)
        model.start()

        source.push(anchoredUpdate(connection: .offline))
        XCTAssertEqual(source.refreshCount, 0)
        XCTAssertEqual(model.connection, .offline)
    }

    func testInlineErrorOnlyWhileCachedAnchorPresent() {
        let source = InMemoryTourOverlaySource()
        let model = TourOverlayModel(source: source)
        model.start()

        // Failure with a cached anchor → still data, inline failure surfaced.
        source.push(anchoredUpdate(status: .failed("refresh failed")))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.inlineErrorMessage, "refresh failed")

        // Failure with no anchor → error phase, no inline message (the error state owns it).
        source.push(TourOverlayUpdate(status: .failed("hard failure")))
        XCTAssertEqual(model.phase, .error("hard failure"))
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testStopStopsSource() {
        let source = InMemoryTourOverlaySource()
        let model = TourOverlayModel(source: source)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}
