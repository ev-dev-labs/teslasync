//
//  StaggerItem.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0194 · StaggerItem (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the motion-preference port
//  (the verbatim port of the web `useMotionPreference` — `durationMs` collapses to `0` when reduced, else
//  the supplied default; mirrors the web hook's five cases), the projection (the reduced / full-motion
//  hidden variant, the index-driven cascade delay, the duration), the per-phase opacity / offset, and the
//  value-type equality. Split from StaggerItem.Tests.swift (the SwiftUI / state-holder half) to keep each
//  file within the SwiftLint file-length budget. These run in the TeslaSync(/-macOS) XCTest targets; the
//  derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class StaggerItemAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(StaggerItemSurface.slug, "StaggerItem")
    }
}

// MARK: - Motion preference (web `useMotionPreference`)

final class StaggerItemMotionPreferenceTests: XCTestCase {
    func testDefaultsToMotionEnabledWithDefaultDuration() {
        // Web: defaults to reduce=false, durationMs=250 when prefers-reduced-motion is not set.
        let preference = StaggerItemMotionPreference.resolve(reduceMotion: false)
        XCTAssertFalse(preference.reduce)
        XCTAssertEqual(preference.durationMs, 250)
    }

    func testHonoursDefaultMsOverrideWhenMotionAllowed() {
        // Web: honours the defaultMs override (StaggerItem passes 350) when motion is allowed.
        let preference = StaggerItemMotionPreference.resolve(reduceMotion: false, defaultMs: 350)
        XCTAssertFalse(preference.reduce)
        XCTAssertEqual(preference.durationMs, 350)
    }

    func testReducedReportsZeroDuration() {
        // Web: reports reduce=true and durationMs=0 when prefers-reduced-motion: reduce.
        let preference = StaggerItemMotionPreference.resolve(reduceMotion: true)
        XCTAssertTrue(preference.reduce)
        XCTAssertEqual(preference.durationMs, 0)
    }

    func testReducedZeroDurationEvenWithCustomDefault() {
        // Web: returns durationMs=0 even when a custom defaultMs is provided.
        let preference = StaggerItemMotionPreference.resolve(reduceMotion: true, defaultMs: 900)
        XCTAssertTrue(preference.reduce)
        XCTAssertEqual(preference.durationMs, 0)
    }

    func testDurationSecondsIsMillisOverThousand() {
        // Web: durationMs / 1000 is passed straight into the transition.
        let allowed = StaggerItemMotionPreference.resolve(reduceMotion: false, defaultMs: 350)
        let reduced = StaggerItemMotionPreference.resolve(reduceMotion: true)
        XCTAssertEqual(allowed.durationSeconds, 0.35, accuracy: 0.0001)
        XCTAssertEqual(reduced.durationSeconds, 0, accuracy: 0.0001)
    }
}

// MARK: - Projection (hidden variant / duration / cascade delay)

final class StaggerItemProjectionTests: XCTestCase {
    func testFullMotionHiddenVariant() {
        // Web: hidden = { opacity: 0, y: 15 } when motion is allowed.
        let projection = StaggerItemProjector.resolve(StaggerItemInput(), reduceMotion: false)
        XCTAssertFalse(projection.reduce)
        XCTAssertEqual(projection.hiddenOpacity, 0, accuracy: 0.0001)
        XCTAssertEqual(projection.hiddenOffsetY, 15, accuracy: 0.0001)
        XCTAssertEqual(projection.durationSeconds, 0.35, accuracy: 0.0001)
    }

    func testReducedMotionHiddenVariantIsFinalState() {
        // Web: hidden = { opacity: 1, y: 0 } under reduced motion (no movement).
        let projection = StaggerItemProjector.resolve(StaggerItemInput(), reduceMotion: true)
        XCTAssertTrue(projection.reduce)
        XCTAssertEqual(projection.hiddenOpacity, 1, accuracy: 0.0001)
        XCTAssertEqual(projection.hiddenOffsetY, 0, accuracy: 0.0001)
        XCTAssertEqual(projection.durationSeconds, 0, accuracy: 0.0001)
        XCTAssertEqual(projection.staggerDelaySeconds, 0, accuracy: 0.0001)
    }

    func testCascadeDelayScalesWithIndex() {
        // Web: the container staggers children by 0.06 s; the per-item delay is index * 0.06.
        XCTAssertEqual(
            StaggerItemProjector.resolve(StaggerItemInput(index: 0), reduceMotion: false).staggerDelaySeconds,
            0,
            accuracy: 0.0001
        )
        XCTAssertEqual(
            StaggerItemProjector.resolve(StaggerItemInput(index: 3), reduceMotion: false).staggerDelaySeconds,
            0.18,
            accuracy: 0.0001
        )
    }

    func testCascadeDelaySuppressedUnderReducedMotion() {
        let projection = StaggerItemProjector.resolve(StaggerItemInput(index: 4), reduceMotion: true)
        XCTAssertEqual(projection.staggerDelaySeconds, 0, accuracy: 0.0001)
    }

    func testNegativeIndexClampsToNoDelay() {
        let projection = StaggerItemProjector.resolve(StaggerItemInput(index: -3), reduceMotion: false)
        XCTAssertEqual(projection.staggerDelaySeconds, 0, accuracy: 0.0001)
    }

    func testDefaultInputUsesWebCallSiteDuration() {
        // Web: StaggerItem calls useMotionPreference(350).
        XCTAssertEqual(StaggerItemInput().defaultMs, 350)
        XCTAssertEqual(StaggerItemInput().index, 0)
    }
}

// MARK: - Per-phase opacity / offset (web `hidden` / `show`)

final class StaggerItemPhaseProjectionTests: XCTestCase {
    func testShownPhaseIsAlwaysFinalState() {
        let full = StaggerItemProjector.resolve(StaggerItemInput(), reduceMotion: false)
        XCTAssertEqual(full.opacity(for: .shown), 1, accuracy: 0.0001)
        XCTAssertEqual(full.offsetY(for: .shown), 0, accuracy: 0.0001)
    }

    func testHiddenPhaseFullMotionLiftsAndFades() {
        let full = StaggerItemProjector.resolve(StaggerItemInput(), reduceMotion: false)
        XCTAssertEqual(full.opacity(for: .hidden), 0, accuracy: 0.0001)
        XCTAssertEqual(full.offsetY(for: .hidden), 15, accuracy: 0.0001)
    }

    func testHiddenPhaseReducedMotionMatchesShown() {
        let reduced = StaggerItemProjector.resolve(StaggerItemInput(), reduceMotion: true)
        XCTAssertEqual(reduced.opacity(for: .hidden), reduced.opacity(for: .shown), accuracy: 0.0001)
        XCTAssertEqual(reduced.offsetY(for: .hidden), reduced.offsetY(for: .shown), accuracy: 0.0001)
    }

    func testPhaseEnumerationIsHiddenThenShown() {
        XCTAssertEqual(StaggerItemPhase.allCases, [.hidden, .shown])
    }
}

// MARK: - Value-type equality

final class StaggerItemValueTypeTests: XCTestCase {
    func testInputEquality() {
        XCTAssertEqual(StaggerItemInput(index: 2, defaultMs: 350), StaggerItemInput(index: 2, defaultMs: 350))
        XCTAssertNotEqual(StaggerItemInput(index: 2, defaultMs: 350), StaggerItemInput(index: 3, defaultMs: 350))
        XCTAssertNotEqual(StaggerItemInput(index: 2, defaultMs: 350), StaggerItemInput(index: 2, defaultMs: 250))
    }

    func testPreferenceEquality() {
        XCTAssertEqual(
            StaggerItemMotionPreference.resolve(reduceMotion: false, defaultMs: 350),
            StaggerItemMotionPreference(reduce: false, durationMs: 350)
        )
        XCTAssertNotEqual(
            StaggerItemMotionPreference.resolve(reduceMotion: true),
            StaggerItemMotionPreference(reduce: false, durationMs: 0)
        )
    }

    func testProjectionEquality() {
        let lhs = StaggerItemProjector.resolve(StaggerItemInput(index: 1), reduceMotion: false)
        let rhs = StaggerItemProjector.resolve(StaggerItemInput(index: 1), reduceMotion: false)
        XCTAssertEqual(lhs, rhs)
        let other = StaggerItemProjector.resolve(StaggerItemInput(index: 2), reduceMotion: false)
        XCTAssertNotEqual(lhs, other)
    }
}
