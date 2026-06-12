//
//  RangeSlider.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0224 · RangeSlider (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the percent math (incl. the
//  empty-range fallbacks), the two-direction thumb-swap (the verbatim port of the web `handleLowChange` /
//  `handleHighChange`), the step snap + clamp, the drag-fraction → value mapping, the default `String(n)`
//  format, the z-order threshold, the projection, and the value-type equality + normalization. Split from
//  RangeSlider.Tests.swift (the SwiftUI / state-holder half) to keep each file within the SwiftLint
//  file-length budget. These run in the TeslaSync(/-macOS) XCTest targets; the derivation is pure, with no
//  network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class RangeSliderAdapterSurfaceTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(RangeSliderSurface.slug, "RangeSlider")
        XCTAssertEqual(RangeSliderMeta.surfaceSlug, "RangeSlider")
    }
}

// MARK: - Percent math (web lowPct / highPct)

final class RangeSliderPercentTests: XCTestCase {
    func testPercentMapsLinearly() {
        XCTAssertEqual(RangeSliderProjector.percent(value: 0, min: 0, max: 100, emptyFallback: 0), 0, accuracy: 1e-9)
        XCTAssertEqual(RangeSliderProjector.percent(value: 50, min: 0, max: 100, emptyFallback: 0), 50, accuracy: 1e-9)
        XCTAssertEqual(
            RangeSliderProjector.percent(value: 100, min: 0, max: 100, emptyFallback: 0),
            100,
            accuracy: 1e-9
        )
    }

    func testPercentClampsOutOfRange() {
        XCTAssertEqual(RangeSliderProjector.percent(value: -20, min: 0, max: 100, emptyFallback: 0), 0, accuracy: 1e-9)
        XCTAssertEqual(
            RangeSliderProjector.percent(value: 250, min: 0, max: 100, emptyFallback: 0),
            100,
            accuracy: 1e-9
        )
    }

    func testEmptyRangeUsesFallback() {
        // Web: range > 0 ? ... : (lowPct 0 / highPct 100).
        XCTAssertEqual(RangeSliderProjector.lowPercent(low: 10, min: 10, max: 10), 0, accuracy: 1e-9)
        XCTAssertEqual(RangeSliderProjector.highPercent(high: 10, min: 10, max: 10), 100, accuracy: 1e-9)
    }

    func testPercentWithNonZeroMin() {
        XCTAssertEqual(RangeSliderProjector.percent(value: 30, min: 20, max: 70, emptyFallback: 0), 20, accuracy: 1e-9)
    }
}

// MARK: - Thumb-swap (web handleLowChange / handleHighChange)

final class RangeSliderSwapTests: XCTestCase {
    func testLowChangeNoSwapWhenWithin() {
        let result = RangeSliderProjector.applyLowChange(next: 30, high: 80)
        XCTAssertEqual(result.low, 30, accuracy: 1e-9)
        XCTAssertEqual(result.high, 80, accuracy: 1e-9)
    }

    func testLowChangeSwapsWhenPastHigh() {
        // Web: next > high -> [high, next].
        let result = RangeSliderProjector.applyLowChange(next: 90, high: 80)
        XCTAssertEqual(result.low, 80, accuracy: 1e-9)
        XCTAssertEqual(result.high, 90, accuracy: 1e-9)
    }

    func testHighChangeNoSwapWhenWithin() {
        let result = RangeSliderProjector.applyHighChange(next: 70, low: 20)
        XCTAssertEqual(result.low, 20, accuracy: 1e-9)
        XCTAssertEqual(result.high, 70, accuracy: 1e-9)
    }

    func testHighChangeSwapsWhenBelowLow() {
        // Web: next < low -> [next, low].
        let result = RangeSliderProjector.applyHighChange(next: 10, low: 20)
        XCTAssertEqual(result.low, 10, accuracy: 1e-9)
        XCTAssertEqual(result.high, 20, accuracy: 1e-9)
    }

    func testSwapResultsAreAlwaysSorted() {
        XCTAssertLessThanOrEqual(
            RangeSliderProjector.applyLowChange(next: 95, high: 40).low,
            RangeSliderProjector.applyLowChange(next: 95, high: 40).high
        )
        XCTAssertLessThanOrEqual(
            RangeSliderProjector.applyHighChange(next: 5, low: 60).low,
            RangeSliderProjector.applyHighChange(next: 5, low: 60).high
        )
    }
}

// MARK: - Snap + clamp + fraction mapping

final class RangeSliderSnapTests: XCTestCase {
    func testSnappedClampsToBounds() {
        XCTAssertEqual(RangeSliderProjector.snapped(value: -5, min: 0, max: 100, step: 1), 0, accuracy: 1e-9)
        XCTAssertEqual(RangeSliderProjector.snapped(value: 140, min: 0, max: 100, step: 1), 100, accuracy: 1e-9)
    }

    func testSnappedRoundsToStep() {
        XCTAssertEqual(RangeSliderProjector.snapped(value: 23, min: 0, max: 100, step: 10), 20, accuracy: 1e-9)
        XCTAssertEqual(RangeSliderProjector.snapped(value: 27, min: 0, max: 100, step: 10), 30, accuracy: 1e-9)
    }

    func testSnappedRespectsNonZeroMinOrigin() {
        // Steps are measured from min, not from 0.
        XCTAssertEqual(RangeSliderProjector.snapped(value: 12, min: 5, max: 100, step: 10), 15, accuracy: 1e-9)
    }

    func testNonPositiveStepSkipsSnapping() {
        XCTAssertEqual(RangeSliderProjector.snapped(value: 23.4, min: 0, max: 100, step: 0), 23.4, accuracy: 1e-9)
    }

    func testFractionMapsAcrossRange() {
        XCTAssertEqual(RangeSliderProjector.value(fromFraction: 0, min: 0, max: 100, step: 1), 0, accuracy: 1e-9)
        XCTAssertEqual(RangeSliderProjector.value(fromFraction: 1, min: 0, max: 100, step: 1), 100, accuracy: 1e-9)
        XCTAssertEqual(RangeSliderProjector.value(fromFraction: 0.5, min: 0, max: 100, step: 1), 50, accuracy: 1e-9)
    }

    func testFractionClampsAndHandlesNonFinite() {
        XCTAssertEqual(RangeSliderProjector.value(fromFraction: -2, min: 0, max: 100, step: 1), 0, accuracy: 1e-9)
        XCTAssertEqual(RangeSliderProjector.value(fromFraction: 3, min: 0, max: 100, step: 1), 100, accuracy: 1e-9)
        XCTAssertEqual(RangeSliderProjector.value(fromFraction: .nan, min: 0, max: 100, step: 1), 0, accuracy: 1e-9)
    }
}

// MARK: - Default format (web String(n))

final class RangeSliderFormatTests: XCTestCase {
    func testIntegralValuesDropDecimals() {
        XCTAssertEqual(RangeSliderProjector.defaultFormat(3), "3")
        XCTAssertEqual(RangeSliderProjector.defaultFormat(0), "0")
        XCTAssertEqual(RangeSliderProjector.defaultFormat(-12), "-12")
    }

    func testFractionalValuesKeepDecimals() {
        XCTAssertEqual(RangeSliderProjector.defaultFormat(3.5), "3.5")
    }
}

// MARK: - Z-order + range

final class RangeSliderZOrderTests: XCTestCase {
    func testLowOnTopThreshold() {
        // Web: lowOnTop = lowPct > 50.
        XCTAssertFalse(RangeSliderProjector.lowOnTop(lowPercent: 50))
        XCTAssertTrue(RangeSliderProjector.lowOnTop(lowPercent: 50.1))
        XCTAssertFalse(RangeSliderProjector.lowOnTop(lowPercent: 10))
    }

    func testHasRange() {
        XCTAssertTrue(RangeSliderProjector.hasRange(min: 0, max: 100))
        XCTAssertFalse(RangeSliderProjector.hasRange(min: 10, max: 10))
        XCTAssertFalse(RangeSliderProjector.hasRange(min: 20, max: 10))
    }
}

// MARK: - Projection

final class RangeSliderProjectionTests: XCTestCase {
    func testResolveDerivesFillAndFlags() {
        let projection = RangeSliderProjector.resolve(
            input: RangeSliderInput(low: 20, high: 80, min: 0, max: 100, label: "T")
        )
        XCTAssertEqual(projection.lowPercent, 20, accuracy: 1e-9)
        XCTAssertEqual(projection.highPercent, 80, accuracy: 1e-9)
        XCTAssertEqual(projection.fillStartPercent, 20, accuracy: 1e-9)
        XCTAssertEqual(projection.fillEndPercent, 80, accuracy: 1e-9)
        XCTAssertFalse(projection.lowOnTop)
        XCTAssertTrue(projection.showsLabelRow)
        XCTAssertFalse(projection.isDisabled)
        XCTAssertTrue(projection.hasRange)
        XCTAssertTrue(projection.isAdjustable)
    }

    func testDisabledIsNotAdjustable() {
        let projection = RangeSliderProjector.resolve(
            input: RangeSliderInput(low: 20, high: 80, min: 0, max: 100, label: "T", isDisabled: true)
        )
        XCTAssertTrue(projection.hasRange)
        XCTAssertFalse(projection.isAdjustable)
    }

    func testDegenerateRangeIsNotAdjustableAndUsesFallbackPercents() {
        let projection = RangeSliderProjector.resolve(
            input: RangeSliderInput(low: 10, high: 10, min: 10, max: 10, label: "T")
        )
        XCTAssertFalse(projection.hasRange)
        XCTAssertFalse(projection.isAdjustable)
        XCTAssertEqual(projection.lowPercent, 0, accuracy: 1e-9)
        XCTAssertEqual(projection.highPercent, 100, accuracy: 1e-9)
    }

    func testShowLabelFalseHidesRow() {
        let projection = RangeSliderProjector.resolve(
            input: RangeSliderInput(low: 1, high: 2, min: 0, max: 10, label: "T", showLabel: false)
        )
        XCTAssertFalse(projection.showsLabelRow)
    }
}

// MARK: - Value-type equality + normalization

final class RangeSliderInputTests: XCTestCase {
    func testInputNormalizesValueOrder() {
        // Web invariant: value is always normalised so low <= high.
        let input = RangeSliderInput(low: 80, high: 20, min: 0, max: 100, label: "T")
        XCTAssertEqual(input.low, 20, accuracy: 1e-9)
        XCTAssertEqual(input.high, 80, accuracy: 1e-9)
    }

    func testUpdatingValuePreservesOtherFields() {
        let base = RangeSliderInput(
            low: 10,
            high: 20,
            min: 0,
            max: 100,
            step: 5,
            label: "Range",
            showLabel: false,
            isDisabled: true,
            minThumbLabel: "lo",
            maxThumbLabel: "hi"
        )
        let next = base.updatingValue(low: 30, high: 60)
        XCTAssertEqual(next.low, 30, accuracy: 1e-9)
        XCTAssertEqual(next.high, 60, accuracy: 1e-9)
        XCTAssertEqual(next.step, 5, accuracy: 1e-9)
        XCTAssertFalse(next.showLabel)
        XCTAssertTrue(next.isDisabled)
        XCTAssertEqual(next.minThumbLabel, "lo")
        XCTAssertEqual(next.maxThumbLabel, "hi")
    }

    func testInputEquality() {
        let lhs = RangeSliderInput(low: 10, high: 20, min: 0, max: 100, label: "T")
        let rhs = RangeSliderInput(low: 10, high: 20, min: 0, max: 100, label: "T")
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, RangeSliderInput(low: 11, high: 20, min: 0, max: 100, label: "T"))
        XCTAssertNotEqual(lhs, RangeSliderInput(low: 10, high: 20, min: 0, max: 100, label: "Other"))
    }

    func testProjectionEquality() {
        let lhs = RangeSliderProjector.resolve(input: RangeSliderInput(low: 1, high: 2, min: 0, max: 10, label: "T"))
        let rhs = RangeSliderProjector.resolve(input: RangeSliderInput(low: 1, high: 2, min: 0, max: 10, label: "T"))
        XCTAssertEqual(lhs, rhs)
        let other = RangeSliderProjector.resolve(input: RangeSliderInput(low: 3, high: 4, min: 0, max: 10, label: "T"))
        XCTAssertNotEqual(lhs, other)
    }
}
