//
//  Spinner.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0140 · Spinner (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the size scale (the web
//  `sizeMap` dimensions + the scaled stroke), the motion-preference port (the verbatim port of the web
//  `useMotionPreference` — `durationMs` collapses to `0` when reduced, else the supplied default), the
//  projection (the reduced / full-motion split + the label-presence flag), the bolt geometry (the web SVG
//  `d`), the strike-draw schedule (the web `@keyframes boltDraw`), and the value-type equality. Split from
//  Spinner.Tests.swift (the SwiftUI / state-holder half) to keep each file within the SwiftLint file-length
//  budget. These run in the TeslaSync(/-macOS) XCTest targets; the derivation is pure, with no network and
//  no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class SpinnerAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(SpinnerSurface.slug, "Spinner")
    }
}

// MARK: - SpinnerSize (web `sizeMap`)

final class SpinnerSizeTests: XCTestCase {
    func testDimensionsMatchWebSizeMap() {
        XCTAssertEqual(SpinnerSize.sm.dimension, 24, accuracy: 0.0001)
        XCTAssertEqual(SpinnerSize.md.dimension, 48, accuracy: 0.0001)
        XCTAssertEqual(SpinnerSize.lg.dimension, 80, accuracy: 0.0001)
    }

    func testViewBoxStrokesMatchWebSizeMap() {
        XCTAssertEqual(SpinnerSize.sm.boltStrokeViewBox, 22, accuracy: 0.0001)
        XCTAssertEqual(SpinnerSize.md.boltStrokeViewBox, 14, accuracy: 0.0001)
        XCTAssertEqual(SpinnerSize.lg.boltStrokeViewBox, 10, accuracy: 0.0001)
    }

    func testCaseIterationIsSmallToLarge() {
        XCTAssertEqual(SpinnerSize.allCases, [.sm, .md, .lg])
    }
}

// MARK: - Motion preference (web `useMotionPreference`)

final class SpinnerMotionPreferenceTests: XCTestCase {
    func testDefaultsToMotionEnabledWithDefaultDuration() {
        // Web: defaults to reduce=false, durationMs=250 when prefers-reduced-motion is not set.
        let preference = SpinnerMotionPreference.resolve(reduceMotion: false)
        XCTAssertFalse(preference.reduce)
        XCTAssertEqual(preference.durationMs, 250)
    }

    func testHonoursDefaultMsOverrideWhenMotionAllowed() {
        let preference = SpinnerMotionPreference.resolve(reduceMotion: false, defaultMs: 600)
        XCTAssertFalse(preference.reduce)
        XCTAssertEqual(preference.durationMs, 600)
    }

    func testReducedReportsZeroDuration() {
        // Web: reports reduce=true and durationMs=0 when prefers-reduced-motion: reduce.
        let preference = SpinnerMotionPreference.resolve(reduceMotion: true)
        XCTAssertTrue(preference.reduce)
        XCTAssertEqual(preference.durationMs, 0)
    }

    func testReducedZeroDurationEvenWithCustomDefault() {
        let preference = SpinnerMotionPreference.resolve(reduceMotion: true, defaultMs: 900)
        XCTAssertTrue(preference.reduce)
        XCTAssertEqual(preference.durationMs, 0)
    }

    func testDurationSecondsIsMillisOverThousand() {
        let allowed = SpinnerMotionPreference.resolve(reduceMotion: false)
        let reduced = SpinnerMotionPreference.resolve(reduceMotion: true)
        XCTAssertEqual(allowed.durationSeconds, 0.25, accuracy: 0.0001)
        XCTAssertEqual(reduced.durationSeconds, 0, accuracy: 0.0001)
    }
}

// MARK: - Projection (stroke scale / label presence / reduced split)

final class SpinnerProjectionTests: XCTestCase {
    func testStrokeWidthScalesOutOfViewBox() {
        // stroke * dimension / 200 — keeps a constant visual weight at every size.
        XCTAssertEqual(SpinnerProjector.strokeWidthPoints(size: .sm), 2.64, accuracy: 0.0001)
        XCTAssertEqual(SpinnerProjector.strokeWidthPoints(size: .md), 3.36, accuracy: 0.0001)
        XCTAssertEqual(SpinnerProjector.strokeWidthPoints(size: .lg), 4.0, accuracy: 0.0001)
    }

    func testShowsLabelTextOnlyForNonEmptyLabel() {
        XCTAssertFalse(SpinnerProjector.showsLabelText(label: nil))
        XCTAssertFalse(SpinnerProjector.showsLabelText(label: ""))
        XCTAssertTrue(SpinnerProjector.showsLabelText(label: "Loading drives…"))
    }

    func testFullMotionProjectionLeavesBoltUnfilledAtRest() {
        // Web: fillOpacity={reduce ? 1 : 0} — the animation drives the fill from the unfilled outline.
        let projection = SpinnerProjector.resolve(SpinnerInput(size: .md), reduceMotion: false)
        XCTAssertFalse(projection.reduce)
        XCTAssertEqual(projection.restingFillOpacity, 0, accuracy: 0.0001)
        XCTAssertEqual(projection.dimension, 48, accuracy: 0.0001)
        XCTAssertEqual(projection.strokeWidthPoints, 3.36, accuracy: 0.0001)
    }

    func testReducedMotionProjectionFillsBoltSolid() {
        // Web: under reduced motion the bolt renders fully filled with no draw cycle.
        let projection = SpinnerProjector.resolve(
            SpinnerInput(size: .lg, label: "Loading"),
            reduceMotion: true
        )
        XCTAssertTrue(projection.reduce)
        XCTAssertEqual(projection.restingFillOpacity, 1, accuracy: 0.0001)
        XCTAssertTrue(projection.showsLabelText)
        XCTAssertEqual(projection.dimension, 80, accuracy: 0.0001)
    }
}

// MARK: - Bolt geometry (web SVG `d`)

final class SpinnerBoltGeometryTests: XCTestCase {
    func testOutlineHasSixVerticesInViewBox() {
        XCTAssertEqual(SpinnerBoltGeometry.viewBox, 200, accuracy: 0.0001)
        XCTAssertEqual(SpinnerBoltGeometry.points.count, 6)
    }

    func testNormalizedPointsAreUnitScaledFromViewBox() {
        let normalized = SpinnerBoltGeometry.normalizedPoints
        XCTAssertEqual(normalized.count, 6)
        // First vertex M112 30 → (112/200, 30/200).
        XCTAssertEqual(normalized[0].x, 0.56, accuracy: 0.0001)
        XCTAssertEqual(normalized[0].y, 0.15, accuracy: 0.0001)
        for point in normalized {
            XCTAssertTrue((0 ... 1).contains(point.x))
            XCTAssertTrue((0 ... 1).contains(point.y))
        }
    }
}

// MARK: - Strike-draw schedule (web `@keyframes boltDraw`)

final class SpinnerBoltKeyframesTests: XCTestCase {
    func testFiveStopsSpanTheCycleMonotonically() {
        let stops = SpinnerBoltKeyframes.stops
        XCTAssertEqual(stops.count, 5)
        XCTAssertEqual(stops[0].fraction, 0, accuracy: 0.0001)
        XCTAssertEqual(stops[stops.count - 1].fraction, 1, accuracy: 0.0001)
        for (next, previous) in zip(stops.dropFirst(), stops) {
            XCTAssertGreaterThan(next.fraction, previous.fraction)
        }
    }

    func testInitialStopIsTheFirstFrame() {
        XCTAssertEqual(SpinnerBoltKeyframes.initialStop, SpinnerBoltKeyframes.stops[0])
        XCTAssertEqual(SpinnerBoltKeyframes.initialStop.trimTo, 0, accuracy: 0.0001)
        XCTAssertEqual(SpinnerBoltKeyframes.initialStop.opacity, 0.15, accuracy: 0.0001)
    }

    func testStrokeDrawsOnThenRetreats() {
        let stops = SpinnerBoltKeyframes.stops
        // Stroke draws on by 30% (trimTo 0 -> 1) and holds; the tail retreats only at the final stop.
        XCTAssertEqual(stops[1].trimTo, 1, accuracy: 0.0001)
        XCTAssertEqual(stops[1].trimFrom, 0, accuracy: 0.0001)
        XCTAssertEqual(stops[4].trimFrom, 1, accuracy: 0.0001)
    }

    func testFillSolidifiesThenClears() {
        let stops = SpinnerBoltKeyframes.stops
        XCTAssertEqual(stops[1].fillOpacity, 0, accuracy: 0.0001)
        XCTAssertEqual(stops[2].fillOpacity, 1, accuracy: 0.0001)
        XCTAssertEqual(stops[4].fillOpacity, 0, accuracy: 0.0001)
    }

    func testSegmentDurationsSumToCycle() {
        let durations = SpinnerBoltKeyframes.segmentDurations()
        XCTAssertEqual(durations.count, 4)
        XCTAssertEqual(durations.reduce(0, +), SpinnerProjector.boltCycleSeconds, accuracy: 0.0001)
        // 0.30 / 0.25 / 0.25 / 0.20 of a 2 s cycle.
        XCTAssertEqual(durations[0], 0.6, accuracy: 0.0001)
        XCTAssertEqual(durations[3], 0.4, accuracy: 0.0001)
    }

    func testSegmentDurationsScaleWithCustomCycle() {
        let durations = SpinnerBoltKeyframes.segmentDurations(cycle: 4)
        XCTAssertEqual(durations.reduce(0, +), 4, accuracy: 0.0001)
    }
}

// MARK: - Value-type equality

final class SpinnerValueTypeTests: XCTestCase {
    func testInputEquality() {
        XCTAssertEqual(SpinnerInput(size: .lg, label: "Loading"), SpinnerInput(size: .lg, label: "Loading"))
        XCTAssertNotEqual(SpinnerInput(size: .lg, label: "Loading"), SpinnerInput(size: .md, label: "Loading"))
        XCTAssertNotEqual(SpinnerInput(size: .lg, label: "Loading"), SpinnerInput(size: .lg, label: nil))
    }

    func testInputDefaultsToMediumWithNoLabel() {
        let input = SpinnerInput()
        XCTAssertEqual(input.size, .md)
        XCTAssertNil(input.label)
    }

    func testPreferenceEquality() {
        XCTAssertEqual(
            SpinnerMotionPreference.resolve(reduceMotion: false),
            SpinnerMotionPreference(reduce: false, durationMs: 250)
        )
        XCTAssertNotEqual(
            SpinnerMotionPreference.resolve(reduceMotion: true),
            SpinnerMotionPreference(reduce: false, durationMs: 0)
        )
    }

    func testProjectionEquality() {
        let lhs = SpinnerProjector.resolve(SpinnerInput(size: .md), reduceMotion: false)
        let rhs = SpinnerProjector.resolve(SpinnerInput(size: .md), reduceMotion: false)
        XCTAssertEqual(lhs, rhs)
        let other = SpinnerProjector.resolve(SpinnerInput(size: .md), reduceMotion: true)
        XCTAssertNotEqual(lhs, other)
    }
}
