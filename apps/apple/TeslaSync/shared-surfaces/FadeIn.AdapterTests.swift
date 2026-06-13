//
//  FadeIn.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0191 · FadeIn (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the motion-preference port
//  (the verbatim port of the web `useMotionPreference` — `durationMs` collapses to `0` when reduced, else
//  the supplied default; mirrors the web hook's five cases), the projection (the reduced / full-motion
//  initial variant, the delay passthrough + its reduced-motion suppression, the duration), the per-phase
//  opacity / offset, and the value-type equality. Split from FadeIn.Tests.swift (the SwiftUI / state-holder
//  half) to keep each file within the SwiftLint file-length budget. These run in the TeslaSync(/-macOS)
//  XCTest targets; the derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class FadeInAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(FadeInSurface.slug, "FadeIn")
    }
}

// MARK: - Motion preference (web `useMotionPreference`)

final class FadeInMotionPreferenceTests: XCTestCase {
    func testDefaultsToMotionEnabledWithDefaultDuration() {
        // Web: defaults to reduce=false, durationMs=250 when prefers-reduced-motion is not set.
        let preference = FadeInMotionPreference.resolve(reduceMotion: false)
        XCTAssertFalse(preference.reduce)
        XCTAssertEqual(preference.durationMs, 250)
    }

    func testHonoursDefaultMsOverrideWhenMotionAllowed() {
        // Web: honours the defaultMs override (FadeIn passes 400) when motion is allowed.
        let preference = FadeInMotionPreference.resolve(reduceMotion: false, defaultMs: 400)
        XCTAssertFalse(preference.reduce)
        XCTAssertEqual(preference.durationMs, 400)
    }

    func testReducedReportsZeroDuration() {
        // Web: reports reduce=true and durationMs=0 when prefers-reduced-motion: reduce.
        let preference = FadeInMotionPreference.resolve(reduceMotion: true)
        XCTAssertTrue(preference.reduce)
        XCTAssertEqual(preference.durationMs, 0)
    }

    func testReducedZeroDurationEvenWithCustomDefault() {
        // Web: returns durationMs=0 even when a custom defaultMs is provided.
        let preference = FadeInMotionPreference.resolve(reduceMotion: true, defaultMs: 900)
        XCTAssertTrue(preference.reduce)
        XCTAssertEqual(preference.durationMs, 0)
    }

    func testDurationSecondsIsMillisOverThousand() {
        // Web: durationMs / 1000 is passed straight into the transition.
        let allowed = FadeInMotionPreference.resolve(reduceMotion: false, defaultMs: 400)
        let reduced = FadeInMotionPreference.resolve(reduceMotion: true)
        XCTAssertEqual(allowed.durationSeconds, 0.4, accuracy: 0.0001)
        XCTAssertEqual(reduced.durationSeconds, 0, accuracy: 0.0001)
    }
}

// MARK: - Projection (initial variant / duration / delay)

final class FadeInProjectionTests: XCTestCase {
    func testFullMotionInitialVariant() {
        // Web: initial = { opacity: 0, y: 12 } when motion is allowed.
        let projection = FadeInProjector.resolve(FadeInInput(), reduceMotion: false)
        XCTAssertFalse(projection.reduce)
        XCTAssertEqual(projection.hiddenOpacity, 0, accuracy: 0.0001)
        XCTAssertEqual(projection.hiddenOffsetY, 12, accuracy: 0.0001)
        XCTAssertEqual(projection.durationSeconds, 0.4, accuracy: 0.0001)
    }

    func testReducedMotionInitialVariantIsFinalState() {
        // Web: initial = false under reduced motion → renders in the final state {opacity 1, y 0}.
        let projection = FadeInProjector.resolve(FadeInInput(delaySeconds: 0.5), reduceMotion: true)
        XCTAssertTrue(projection.reduce)
        XCTAssertEqual(projection.hiddenOpacity, 1, accuracy: 0.0001)
        XCTAssertEqual(projection.hiddenOffsetY, 0, accuracy: 0.0001)
        XCTAssertEqual(projection.durationSeconds, 0, accuracy: 0.0001)
        XCTAssertEqual(projection.delaySeconds, 0, accuracy: 0.0001)
    }

    func testDelayPassthroughWhenMotionAllowed() {
        // Web: transition.delay = delay when motion is allowed.
        let projection = FadeInProjector.resolve(FadeInInput(delaySeconds: 0.25), reduceMotion: false)
        XCTAssertEqual(projection.delaySeconds, 0.25, accuracy: 0.0001)
    }

    func testDelaySuppressedUnderReducedMotion() {
        // Web: transition.delay = reduce ? 0 : delay.
        let projection = FadeInProjector.resolve(FadeInInput(delaySeconds: 0.25), reduceMotion: true)
        XCTAssertEqual(projection.delaySeconds, 0, accuracy: 0.0001)
    }

    func testNegativeDelayClampsToNoDelay() {
        let projection = FadeInProjector.resolve(FadeInInput(delaySeconds: -0.5), reduceMotion: false)
        XCTAssertEqual(projection.delaySeconds, 0, accuracy: 0.0001)
    }

    func testDefaultInputUsesWebCallSiteDuration() {
        // Web: FadeIn calls useMotionPreference(400) with delay defaulting to 0.
        XCTAssertEqual(FadeInInput().defaultMs, 400)
        XCTAssertEqual(FadeInInput().delaySeconds, 0, accuracy: 0.0001)
    }
}

// MARK: - Per-phase opacity / offset (web `initial` / `animate`)

final class FadeInPhaseProjectionTests: XCTestCase {
    func testShownPhaseIsAlwaysFinalState() {
        let full = FadeInProjector.resolve(FadeInInput(), reduceMotion: false)
        XCTAssertEqual(full.opacity(for: .shown), 1, accuracy: 0.0001)
        XCTAssertEqual(full.offsetY(for: .shown), 0, accuracy: 0.0001)
    }

    func testHiddenPhaseFullMotionLiftsAndFades() {
        let full = FadeInProjector.resolve(FadeInInput(), reduceMotion: false)
        XCTAssertEqual(full.opacity(for: .hidden), 0, accuracy: 0.0001)
        XCTAssertEqual(full.offsetY(for: .hidden), 12, accuracy: 0.0001)
    }

    func testHiddenPhaseReducedMotionMatchesShown() {
        let reduced = FadeInProjector.resolve(FadeInInput(), reduceMotion: true)
        XCTAssertEqual(reduced.opacity(for: .hidden), reduced.opacity(for: .shown), accuracy: 0.0001)
        XCTAssertEqual(reduced.offsetY(for: .hidden), reduced.offsetY(for: .shown), accuracy: 0.0001)
    }

    func testPhaseEnumerationIsHiddenThenShown() {
        XCTAssertEqual(FadeInPhase.allCases, [.hidden, .shown])
    }
}

// MARK: - Value-type equality

final class FadeInValueTypeTests: XCTestCase {
    func testInputEquality() {
        XCTAssertEqual(FadeInInput(delaySeconds: 0.2, defaultMs: 400), FadeInInput(delaySeconds: 0.2, defaultMs: 400))
        XCTAssertNotEqual(
            FadeInInput(delaySeconds: 0.2, defaultMs: 400),
            FadeInInput(delaySeconds: 0.3, defaultMs: 400)
        )
        XCTAssertNotEqual(
            FadeInInput(delaySeconds: 0.2, defaultMs: 400),
            FadeInInput(delaySeconds: 0.2, defaultMs: 250)
        )
    }

    func testPreferenceEquality() {
        XCTAssertEqual(
            FadeInMotionPreference.resolve(reduceMotion: false, defaultMs: 400),
            FadeInMotionPreference(reduce: false, durationMs: 400)
        )
        XCTAssertNotEqual(
            FadeInMotionPreference.resolve(reduceMotion: true),
            FadeInMotionPreference(reduce: false, durationMs: 0)
        )
    }

    func testProjectionEquality() {
        let lhs = FadeInProjector.resolve(FadeInInput(delaySeconds: 0.1), reduceMotion: false)
        let rhs = FadeInProjector.resolve(FadeInInput(delaySeconds: 0.1), reduceMotion: false)
        XCTAssertEqual(lhs, rhs)
        let other = FadeInProjector.resolve(FadeInInput(delaySeconds: 0.2), reduceMotion: false)
        XCTAssertNotEqual(lhs, other)
    }
}
