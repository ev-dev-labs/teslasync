//
//  DataTableResizer.Tests.swift
//  TeslaSync — P4 shared surface · 0212 · DataTableResizer (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types
//  live in DataTableResizer.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • DataTableResizerModel — the once-only `view.opened`; the drag streaming (start-width capture +
//      clamped `onResize`); the drag release (`onResizeEnd` with the controlled width); the keyboard /
//      VoiceOver steps committing to BOTH callbacks; the hover / focus tint flags; and the props update
//      (closure refresh + controlled-width re-derivation).
//    • Views — the public surface + the harness compose.
//    • Strings — the a11y copy resolves through the P1/S10 facade with the English fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - DataTableResizerModel (interaction state + routing)

@MainActor
final class DataTableResizerModelTests: XCTestCase {
    private func input(width: Double, minWidth: Double = 60, maxWidth: Double = 800) -> DataTableResizerInput {
        DataTableResizerInput(columnKey: "name", width: width, minWidth: minWidth, maxWidth: maxWidth)
    }

    private func model(
        _ input: DataTableResizerInput,
        onResize: (@MainActor (Double) -> Void)? = nil,
        onResizeEnd: (@MainActor (Double) -> Void)? = nil,
        telemetry: DataTableResizerTelemetry = OSLogDataTableResizerTelemetry()
    ) -> DataTableResizerModel {
        DataTableResizerModel(input: input, onResize: onResize, onResizeEnd: onResizeEnd, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(input(width: 160), telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [DataTableResizerSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(input(width: 160), telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [DataTableResizerSurface.slug], "view.opened fires once per instance")
    }

    func testDragCapturesStartWidthOnceAndStreamsClampedResize() {
        let rec = ResizeRecorder()
        let holder = model(input(width: 200), onResize: { rec.resize($0) })
        holder.dragChanged(translation: 40)
        XCTAssertTrue(holder.isDragging, "the first drag raises the dragging flag (web setDragging(true))")
        holder.dragChanged(translation: 80)
        // Both deltas are measured from the captured 200 px start (web startWidth ref), not compounded.
        XCTAssertEqual(rec.resizes, [240, 280])
    }

    func testDragClampsStream() {
        let rec = ResizeRecorder()
        let holder = model(input(width: 70, minWidth: 60, maxWidth: 800), onResize: { rec.resize($0) })
        holder.dragChanged(translation: -100)
        XCTAssertEqual(rec.resizes, [60], "the streamed width is clamped to the floor")
    }

    func testDragEndedEmitsControlledWidthAndClearsFlag() {
        let rec = ResizeRecorder()
        let holder = model(input(width: 200), onResize: { rec.resize($0) }, onResizeEnd: { rec.end($0) })
        holder.dragChanged(translation: 40)
        // The controlled page streams the new width back as a prop before release (web `width` prop).
        holder.update(input(width: 240), onResize: { rec.resize($0) }, onResizeEnd: { rec.end($0) })
        holder.dragEnded()
        XCTAssertFalse(holder.isDragging)
        XCTAssertEqual(rec.ends, [240], "web finishDrag → onResizeEnd?(width) with the controlled width")
    }

    func testDragEndedIsNoOpWhenNotDragging() {
        let rec = ResizeRecorder()
        let holder = model(input(width: 200), onResizeEnd: { rec.end($0) })
        holder.dragEnded()
        XCTAssertTrue(rec.ends.isEmpty, "web `if (!dragging) return`")
    }

    func testArrowStepsCommitToBothCallbacks() {
        let rec = ResizeRecorder()
        let holder = model(input(width: 100), onResize: { rec.resize($0) }, onResizeEnd: { rec.end($0) })
        holder.stepLarger()
        XCTAssertEqual(rec.resizes, [108], "web ArrowRight → onResize(clamp(width + 8))")
        XCTAssertEqual(rec.ends, [108], "web ArrowRight → onResizeEnd?(next)")
    }

    func testArrowLeftShrinks() {
        let rec = ResizeRecorder()
        let holder = model(input(width: 100), onResize: { rec.resize($0) }, onResizeEnd: { rec.end($0) })
        holder.stepSmaller()
        XCTAssertEqual(rec.resizes, [92])
        XCTAssertEqual(rec.ends, [92])
    }

    func testHomeResetsAndEndMaximizes() {
        let rec = ResizeRecorder()
        let holder = model(
            input(width: 300, minWidth: 60, maxWidth: 800),
            onResize: { rec.resize($0) },
            onResizeEnd: { rec.end($0) }
        )
        holder.resetToDefault()
        XCTAssertEqual(rec.ends.last, 80, "web Home → clamp(80)")
        holder.maximize()
        XCTAssertEqual(rec.ends.last, 800, "web End → clamp(maxWidth)")
    }

    func testAdjustMapsIncrementToGrowAndDecrementToShrink() {
        let rec = ResizeRecorder()
        let holder = model(input(width: 100), onResize: { rec.resize($0) }, onResizeEnd: { rec.end($0) })
        holder.adjust(.increment)
        XCTAssertEqual(rec.ends.last, 108, "VoiceOver increment grows (web ArrowRight)")
        holder.adjust(.decrement)
        XCTAssertEqual(rec.ends.last, 92, "VoiceOver decrement shrinks (web ArrowLeft)")
    }

    func testHoverAndFocusFlagsDriveFillOpacity() {
        let holder = model(input(width: 160))
        XCTAssertEqual(holder.projection.fillOpacity, 0, accuracy: 0.0001)
        holder.setHovering(true)
        XCTAssertEqual(holder.projection.fillOpacity, 0.4, accuracy: 0.0001)
        holder.setFocused(true)
        XCTAssertEqual(holder.projection.fillOpacity, 0.6, accuracy: 0.0001, "focus wins over hover")
    }

    func testInteractionIsSafeWithoutCallbacks() {
        // The injected-model seam may omit the page closures; the interaction must not crash.
        let holder = model(input(width: 160))
        holder.dragChanged(translation: 20)
        XCTAssertTrue(holder.isDragging)
        holder.dragEnded()
        holder.stepLarger()
        holder.resetToDefault()
        XCTAssertFalse(holder.isDragging)
    }

    func testUpdateRefreshesClosuresAndReDerivesProjection() {
        let stale = ResizeRecorder()
        let fresh = ResizeRecorder()
        let holder = model(input(width: 100), onResize: { stale.resize($0) }, onResizeEnd: { stale.end($0) })
        holder.update(input(width: 220), onResize: { fresh.resize($0) }, onResizeEnd: { fresh.end($0) })
        XCTAssertEqual(holder.input.width, 220, "the controlled width re-derives the projection")
        XCTAssertEqual(holder.projection.width, 220)
        holder.stepLarger()
        XCTAssertTrue(stale.resizes.isEmpty, "the stale closure is discarded")
        XCTAssertEqual(fresh.resizes, [228], "the step routes through the refreshed closure (220 + 8)")
    }
}

// MARK: - Views (the public surface + harness compose)

@MainActor
final class DataTableResizerViewTests: XCTestCase {
    func testSurfaceComposesFromProps() {
        _ = DataTableResizer(columnKey: "name", width: 160, onResize: { _ in })
        _ = DataTableResizer(
            columnKey: "name",
            width: 160,
            minWidth: 80,
            maxWidth: 400,
            onResize: { _ in },
            onResizeEnd: { _ in },
            label: "Resize the name column"
        )
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = DataTableResizerModel(
            input: DataTableResizerInput(columnKey: "vin", width: 200),
            telemetry: SpyTelemetry()
        )
        _ = DataTableResizer(model: injected)
        XCTAssertEqual(DataTableResizer.surfaceSlug, "DataTableResizer")
    }

    func testHarnessComposes() {
        _ = DataTableResizerColumnHarness(columnKey: "displayName", title: "Display name")
        _ = DataTableResizerColumnHarness(columnKey: "soc", title: "SoC", width: 60, minWidth: 60, maxWidth: 280)
    }
}

// MARK: - Strings facade (P1/S10)

final class DataTableResizerStringsTests: XCTestCase {
    func testDefaultLabelInterpolatesColumnKey() {
        XCTAssertEqual(
            DataTableResizerStrings.label(columnKey: "displayName", override: nil),
            "Resize column displayName"
        )
    }

    func testLabelOverrideWins() {
        XCTAssertEqual(DataTableResizerStrings.label(columnKey: "displayName", override: "Custom"), "Custom")
    }

    func testValueAndHintFallbacks() {
        XCTAssertEqual(DataTableResizerStrings.value(width: 160), "160 points")
        XCTAssertEqual(DataTableResizerStrings.hint, "Drag, or use the arrow keys, to resize the column")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: DataTableResizerTelemetry, @unchecked Sendable {
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

/// Records the widths routed out through the `@MainActor` `onResize` / `onResizeEnd` page closures.
@MainActor
private final class ResizeRecorder {
    private(set) var resizes: [Double] = []
    private(set) var ends: [Double] = []

    func resize(_ value: Double) {
        resizes.append(value)
    }

    func end(_ value: Double) {
        ends.append(value)
    }
}
