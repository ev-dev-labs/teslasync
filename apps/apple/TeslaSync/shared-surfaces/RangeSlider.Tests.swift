//
//  RangeSlider.Tests.swift
//  TeslaSync — P4 shared surface · 0224 · RangeSlider (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types
//  live in RangeSlider.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • RangeSliderModel — the once-only `view.opened`, the optimistic + emitted thumb changes routed through
//      the web swap rules, the disabled no-op, the step increment / decrement (incl. the non-positive-step
//      fallback), the drag-fraction mapping, the props `update` reconcile, and the display / thumb-label /
//      summary copy (web `formatValue ?? String`, `minThumbLabel ?? t(...)`).
//    • RangeSliderMotion — the fill / thumb animation is nil under reduced motion and present otherwise.
//    • Views — the public surface + the subviews compose in every real branch.
//    • Strings — the thumb a11y names + the affordance copy resolve through the P1/S10 facade.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - RangeSliderModel (interaction state + routing)

@MainActor
final class RangeSliderModelTests: XCTestCase {
    private func model(
        _ input: RangeSliderInput,
        onChange: (@MainActor (Double, Double) -> Void)? = nil,
        formatValue: (@MainActor (Double) -> String)? = nil,
        telemetry: RangeSliderTelemetry = OSLogRangeSliderTelemetry()
    ) -> RangeSliderModel {
        RangeSliderModel(input: input, onChange: onChange, formatValue: formatValue, telemetry: telemetry)
    }

    private func input(
        low: Double = 20,
        high: Double = 80,
        min: Double = 0,
        max: Double = 100,
        step: Double = 1,
        disabled: Bool = false
    ) -> RangeSliderInput {
        RangeSliderInput(low: low, high: high, min: min, max: max, step: step, label: "T", isDisabled: disabled)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(input(), telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [RangeSliderSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(input(), telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [RangeSliderSurface.slug], "view.opened fires once per instance")
    }

    func testSetLowWithinRangeUpdatesAndEmits() {
        let recorder = ChangeRecorder()
        let holder = model(input(low: 20, high: 80), onChange: { recorder.record($0, $1) })
        holder.setLow(30)
        XCTAssertEqual(holder.input.low, 30, accuracy: 1e-9)
        XCTAssertEqual(holder.input.high, 80, accuracy: 1e-9)
        XCTAssertEqual(recorder.last?.low, 30)
        XCTAssertEqual(recorder.last?.high, 80)
    }

    func testSetLowPastHighSwaps() {
        // Web handleLowChange: next > high -> [high, next].
        let recorder = ChangeRecorder()
        let holder = model(input(low: 20, high: 80), onChange: { recorder.record($0, $1) })
        holder.setLow(95)
        XCTAssertEqual(holder.input.low, 80, accuracy: 1e-9)
        XCTAssertEqual(holder.input.high, 95, accuracy: 1e-9)
        XCTAssertEqual(recorder.last?.low, 80)
        XCTAssertEqual(recorder.last?.high, 95)
    }

    func testSetHighBelowLowSwaps() {
        // Web handleHighChange: next < low -> [next, low].
        let recorder = ChangeRecorder()
        let holder = model(input(low: 20, high: 80), onChange: { recorder.record($0, $1) })
        holder.setHigh(10)
        XCTAssertEqual(holder.input.low, 10, accuracy: 1e-9)
        XCTAssertEqual(holder.input.high, 20, accuracy: 1e-9)
        XCTAssertEqual(recorder.last?.low, 10)
        XCTAssertEqual(recorder.last?.high, 20)
    }

    func testSetHighWithinRangeNoSwap() {
        let holder = model(input(low: 20, high: 80))
        holder.setHigh(60)
        XCTAssertEqual(holder.input.low, 20, accuracy: 1e-9)
        XCTAssertEqual(holder.input.high, 60, accuracy: 1e-9)
    }

    func testSetSnapsToStep() {
        let holder = model(input(low: 20, high: 80, step: 10))
        holder.setLow(23)
        XCTAssertEqual(holder.input.low, 20, accuracy: 1e-9)
        holder.setLow(27)
        XCTAssertEqual(holder.input.low, 30, accuracy: 1e-9)
    }

    func testDisabledIgnoresChanges() {
        let recorder = ChangeRecorder()
        let holder = model(input(low: 20, high: 80, disabled: true), onChange: { recorder.record($0, $1) })
        holder.setLow(50)
        holder.setHigh(60)
        holder.incrementLow()
        XCTAssertEqual(holder.input.low, 20, accuracy: 1e-9)
        XCTAssertEqual(holder.input.high, 80, accuracy: 1e-9)
        XCTAssertTrue(recorder.values.isEmpty, "a disabled slider emits nothing")
    }

    func testIncrementDecrementStepByStep() {
        let holder = model(input(low: 20, high: 80, step: 5))
        holder.incrementLow()
        XCTAssertEqual(holder.input.low, 25, accuracy: 1e-9)
        holder.decrementLow()
        XCTAssertEqual(holder.input.low, 20, accuracy: 1e-9)
        holder.incrementHigh()
        XCTAssertEqual(holder.input.high, 85, accuracy: 1e-9)
        holder.decrementHigh()
        XCTAssertEqual(holder.input.high, 80, accuracy: 1e-9)
    }

    func testNonPositiveStepUsesFallbackNotch() {
        let holder = model(input(low: 20, high: 80, step: 0))
        holder.incrementLow()
        XCTAssertEqual(holder.input.low, 20 + RangeSliderMeta.fallbackStep, accuracy: 1e-9)
    }

    func testDragMapsFractionAcrossRange() {
        let holder = model(input(low: 20, high: 80, min: 0, max: 100))
        holder.dragLow(toFraction: 0.1)
        XCTAssertEqual(holder.input.low, 10, accuracy: 1e-9)
        holder.dragHigh(toFraction: 0.9)
        XCTAssertEqual(holder.input.high, 90, accuracy: 1e-9)
    }

    func testUpdateRefreshesPropsAndReconciles() {
        let holder = model(input(low: 20, high: 80))
        holder.update(input(low: 30, high: 70), onChange: nil, formatValue: nil)
        XCTAssertEqual(holder.input.low, 30, accuracy: 1e-9)
        XCTAssertEqual(holder.input.high, 70, accuracy: 1e-9)
        XCTAssertEqual(holder.projection.fillStartPercent, 30, accuracy: 1e-9)
    }

    func testUpdateRefreshesClosures() {
        let recorder = ChangeRecorder()
        let holder = model(input(low: 20, high: 80))
        holder.setLow(40)
        XCTAssertTrue(recorder.values.isEmpty)
        holder.update(holder.input, onChange: { recorder.record($0, $1) }, formatValue: nil)
        holder.setLow(50)
        XCTAssertEqual(recorder.last?.low, 50)
    }
}

// MARK: - Display + accessibility copy

@MainActor
final class RangeSliderCopyTests: XCTestCase {
    func testDefaultDisplayUsesStringFormat() {
        let holder = RangeSliderModel(input: RangeSliderInput(low: 20, high: 80, min: 0, max: 100, label: "T"))
        XCTAssertEqual(holder.displayLow, "20")
        XCTAssertEqual(holder.displayHigh, "80")
    }

    func testCustomFormatValueApplied() {
        let holder = RangeSliderModel(
            input: RangeSliderInput(low: 12, high: 48, min: 0, max: 60, label: "T"),
            formatValue: { "$\(Int($0))" }
        )
        XCTAssertEqual(holder.displayLow, "$12")
        XCTAssertEqual(holder.displayHigh, "$48")
    }

    func testDefaultThumbLabelsInterpolateLabel() {
        let holder = RangeSliderModel(input: RangeSliderInput(low: 1, high: 2, min: 0, max: 10, label: "Price"))
        XCTAssertEqual(holder.lowThumbLabel, "Price minimum")
        XCTAssertEqual(holder.highThumbLabel, "Price maximum")
    }

    func testCustomThumbLabelsOverrideDefaults() {
        let holder = RangeSliderModel(input: RangeSliderInput(
            low: 1,
            high: 2,
            min: 0,
            max: 10,
            label: "Price",
            minThumbLabel: "Floor",
            maxThumbLabel: "Ceiling"
        ))
        XCTAssertEqual(holder.lowThumbLabel, "Floor")
        XCTAssertEqual(holder.highThumbLabel, "Ceiling")
    }

    func testValueSummaryUsesConnector() {
        let holder = RangeSliderModel(input: RangeSliderInput(low: 20, high: 80, min: 0, max: 100, label: "Range"))
        XCTAssertEqual(holder.valueSummary, "Range, 20 to 80")
    }
}

// MARK: - RangeSliderMotion (honors Reduce Motion)

final class RangeSliderMotionTests: XCTestCase {
    func testAnimationNilUnderReducedMotion() {
        XCTAssertNil(RangeSliderMotion.thumb(reduce: true))
    }

    func testAnimationPresentWhenMotionAllowed() {
        XCTAssertNotNil(RangeSliderMotion.thumb(reduce: false))
    }
}

// MARK: - Views (every real branch composes)

@MainActor
final class RangeSliderViewTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = RangeSlider(value: (20, 80), min: 0, max: 100, label: "T", onChange: { _, _ in })
        _ = RangeSlider(value: (20, 80), min: 0, max: 100, label: "T", showLabel: false, onChange: { _, _ in })
        _ = RangeSlider(value: (20, 80), min: 0, max: 100, label: "T", disabled: true, onChange: { _, _ in })
        _ = RangeSlider(
            value: (12, 48),
            min: 0,
            max: 60,
            label: "T",
            formatValue: { "$\(Int($0))" },
            onChange: { _, _ in }
        )
        _ = RangeSlider(value: (10, 10), min: 10, max: 10, label: "T", onChange: { _, _ in })
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = RangeSliderModel(
            input: RangeSliderInput(low: 20, high: 80, min: 0, max: 100, label: "Charging"),
            telemetry: SpyTelemetry()
        )
        _ = RangeSlider(model: injected)
        XCTAssertEqual(RangeSlider.surfaceSlug, "RangeSlider")
    }

    func testSubviewsCompose() {
        let holder = RangeSliderModel(input: RangeSliderInput(low: 20, high: 80, min: 0, max: 100, label: "T"))
        _ = RangeSliderLabelRow(label: "T", valueText: "20 – 80", accessibilitySummary: "T, 20 to 80")
        _ = RangeSliderThumb(size: 22, disabled: false, dragging: true)
        _ = RangeSliderTrack(model: holder, reduceMotion: false)
        _ = RangeSliderEmptyState()
    }
}

// MARK: - Strings facade (P1/S10)

final class RangeSliderStringsTests: XCTestCase {
    func testThumbLabelFallbacksInterpolate() {
        XCTAssertEqual(RangeSliderStrings.minThumbLabel(label: "Speed"), "Speed minimum")
        XCTAssertEqual(RangeSliderStrings.maxThumbLabel(label: "Speed"), "Speed maximum")
    }

    func testNativeAdditionFallbacks() {
        XCTAssertEqual(RangeSliderStrings.rangeConnector, "to")
        XCTAssertEqual(RangeSliderStrings.emptyTitle, "No range to adjust")
        XCTAssertEqual(
            RangeSliderStrings.emptyMessage,
            "A range appears here once the minimum and maximum differ."
        )
    }

    func testValueSummaryComposesParts() {
        XCTAssertEqual(RangeSliderStrings.valueSummary(label: "SoC", low: "10", high: "90"), "SoC, 10 to 90")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: RangeSliderTelemetry, @unchecked Sendable {
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

/// Records the `[low, high]` changes routed out through `onChange` (the `@MainActor` page-closure seam).
@MainActor
private final class ChangeRecorder {
    private(set) var values: [(low: Double, high: Double)] = []

    var last: (low: Double, high: Double)? {
        values.last
    }

    func record(_ low: Double, _ high: Double) {
        values.append((low: low, high: high))
    }
}
