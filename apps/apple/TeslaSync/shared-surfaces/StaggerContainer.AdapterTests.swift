//
//  StaggerContainer.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0193 · StaggerContainer (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the motion-preference port
//  (the verbatim port of the web `useMotionPreference` — `durationMs` collapses to `0` when reduced, else
//  the supplied default; mirrors the web hook's cases), the projection (the reduced / full-motion hidden
//  variant, the cascade step, the hosted child's duration), the index-driven entrance delay, the per-phase
//  opacity / offset, and the value-type equality. Split from StaggerContainer.Tests.swift (the SwiftUI /
//  state-holder half) to keep each file within the SwiftLint file-length budget. These run in the
//  TeslaSync(/-macOS) XCTest targets; the derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class StaggerContainerAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(StaggerContainerSurface.slug, "StaggerContainer")
    }
}

// MARK: - Motion preference (web `useMotionPreference`)

final class StaggerContainerMotionPreferenceTests: XCTestCase {
    func testDefaultsToMotionEnabledWithDefaultDuration() {
        // Web: defaults to reduce=false, durationMs=250 when prefers-reduced-motion is not set.
        let preference = StaggerContainerMotionPreference.resolve(reduceMotion: false)
        XCTAssertFalse(preference.reduce)
        XCTAssertEqual(preference.durationMs, 250)
    }

    func testHonoursDefaultMsOverrideWhenMotionAllowed() {
        // Web: honours the defaultMs override when motion is allowed.
        let preference = StaggerContainerMotionPreference.resolve(reduceMotion: false, defaultMs: 400)
        XCTAssertFalse(preference.reduce)
        XCTAssertEqual(preference.durationMs, 400)
    }

    func testReducedReportsZeroDuration() {
        // Web: reports reduce=true and durationMs=0 when prefers-reduced-motion: reduce.
        let preference = StaggerContainerMotionPreference.resolve(reduceMotion: true)
        XCTAssertTrue(preference.reduce)
        XCTAssertEqual(preference.durationMs, 0)
    }

    func testReducedZeroDurationEvenWithCustomDefault() {
        // Web: returns durationMs=0 even when a custom defaultMs is provided.
        let preference = StaggerContainerMotionPreference.resolve(reduceMotion: true, defaultMs: 900)
        XCTAssertTrue(preference.reduce)
        XCTAssertEqual(preference.durationMs, 0)
    }

    func testDurationSecondsIsMillisOverThousand() {
        // Web: durationMs / 1000 is the seconds value.
        let allowed = StaggerContainerMotionPreference.resolve(reduceMotion: false)
        let reduced = StaggerContainerMotionPreference.resolve(reduceMotion: true)
        XCTAssertEqual(allowed.durationSeconds, 0.25, accuracy: 0.0001)
        XCTAssertEqual(reduced.durationSeconds, 0, accuracy: 0.0001)
    }
}

// MARK: - Projection (hidden variant / cascade step / child duration)

final class StaggerContainerProjectionTests: XCTestCase {
    func testFullMotionStepAndChildVariant() {
        // Web: staggerChildren = 0.06 and the hosted child's hidden = { opacity: 0, y: 15 } when motion is
        // allowed; the hosted child enters over 350 ms.
        let projection = StaggerContainerProjector.resolve(StaggerContainerInput(), reduceMotion: false)
        XCTAssertFalse(projection.reduce)
        XCTAssertEqual(projection.staggerStepSeconds, 0.06, accuracy: 0.0001)
        XCTAssertEqual(projection.childHiddenOpacity, 0, accuracy: 0.0001)
        XCTAssertEqual(projection.childHiddenOffsetY, 15, accuracy: 0.0001)
        XCTAssertEqual(projection.childDurationSeconds, 0.35, accuracy: 0.0001)
    }

    func testReducedMotionCollapsesCascadeAndChildVariant() {
        // Web: staggerChildren = 0 and the hosted child's hidden = { opacity: 1, y: 0 } under reduced motion.
        let projection = StaggerContainerProjector.resolve(StaggerContainerInput(), reduceMotion: true)
        XCTAssertTrue(projection.reduce)
        XCTAssertEqual(projection.staggerStepSeconds, 0, accuracy: 0.0001)
        XCTAssertEqual(projection.childHiddenOpacity, 1, accuracy: 0.0001)
        XCTAssertEqual(projection.childHiddenOffsetY, 0, accuracy: 0.0001)
        XCTAssertEqual(projection.childDurationSeconds, 0, accuracy: 0.0001)
    }

    func testCascadeDelayScalesWithIndex() {
        // Web: the container staggers children by 0.06 s; the per-child delay is index * 0.06.
        let projection = StaggerContainerProjector.resolve(StaggerContainerInput(), reduceMotion: false)
        XCTAssertEqual(projection.delaySeconds(forIndex: 0), 0, accuracy: 0.0001)
        XCTAssertEqual(projection.delaySeconds(forIndex: 3), 0.18, accuracy: 0.0001)
    }

    func testCascadeDelaySuppressedUnderReducedMotion() {
        let projection = StaggerContainerProjector.resolve(StaggerContainerInput(), reduceMotion: true)
        XCTAssertEqual(projection.delaySeconds(forIndex: 4), 0, accuracy: 0.0001)
    }

    func testNegativeIndexClampsToNoDelay() {
        let projection = StaggerContainerProjector.resolve(StaggerContainerInput(), reduceMotion: false)
        XCTAssertEqual(projection.delaySeconds(forIndex: -3), 0, accuracy: 0.0001)
    }

    func testHonoursCustomStepAndChildDuration() {
        let input = StaggerContainerInput(stepSeconds: 0.1, childDurationMs: 200)
        let projection = StaggerContainerProjector.resolve(input, reduceMotion: false)
        XCTAssertEqual(projection.staggerStepSeconds, 0.1, accuracy: 0.0001)
        XCTAssertEqual(projection.delaySeconds(forIndex: 2), 0.2, accuracy: 0.0001)
        XCTAssertEqual(projection.childDurationSeconds, 0.2, accuracy: 0.0001)
    }

    func testDefaultInputUsesWebCallSiteValues() {
        // Web: the container staggers by 0.06 s and its hosted StaggerItem enters over 350 ms.
        XCTAssertEqual(StaggerContainerInput().stepSeconds, 0.06, accuracy: 0.0001)
        XCTAssertEqual(StaggerContainerInput().childDurationMs, 350)
    }
}

// MARK: - Per-phase opacity / offset (web child `hidden` / `show`)

final class StaggerContainerPhaseProjectionTests: XCTestCase {
    func testShownPhaseIsAlwaysFinalState() {
        let full = StaggerContainerProjector.resolve(StaggerContainerInput(), reduceMotion: false)
        XCTAssertEqual(full.childOpacity(for: .shown), 1, accuracy: 0.0001)
        XCTAssertEqual(full.childOffsetY(for: .shown), 0, accuracy: 0.0001)
    }

    func testHiddenPhaseFullMotionLiftsAndFades() {
        let full = StaggerContainerProjector.resolve(StaggerContainerInput(), reduceMotion: false)
        XCTAssertEqual(full.childOpacity(for: .hidden), 0, accuracy: 0.0001)
        XCTAssertEqual(full.childOffsetY(for: .hidden), 15, accuracy: 0.0001)
    }

    func testHiddenPhaseReducedMotionMatchesShown() {
        let reduced = StaggerContainerProjector.resolve(StaggerContainerInput(), reduceMotion: true)
        XCTAssertEqual(reduced.childOpacity(for: .hidden), reduced.childOpacity(for: .shown), accuracy: 0.0001)
        XCTAssertEqual(reduced.childOffsetY(for: .hidden), reduced.childOffsetY(for: .shown), accuracy: 0.0001)
    }

    func testPhaseEnumerationIsHiddenThenShown() {
        XCTAssertEqual(StaggerContainerPhase.allCases, [.hidden, .shown])
    }
}

// MARK: - Value-type equality

final class StaggerContainerValueTypeTests: XCTestCase {
    func testInputEquality() {
        XCTAssertEqual(
            StaggerContainerInput(stepSeconds: 0.06, childDurationMs: 350),
            StaggerContainerInput(stepSeconds: 0.06, childDurationMs: 350)
        )
        XCTAssertNotEqual(
            StaggerContainerInput(stepSeconds: 0.06, childDurationMs: 350),
            StaggerContainerInput(stepSeconds: 0.08, childDurationMs: 350)
        )
        XCTAssertNotEqual(
            StaggerContainerInput(stepSeconds: 0.06, childDurationMs: 350),
            StaggerContainerInput(stepSeconds: 0.06, childDurationMs: 250)
        )
    }

    func testPreferenceEquality() {
        XCTAssertEqual(
            StaggerContainerMotionPreference.resolve(reduceMotion: false),
            StaggerContainerMotionPreference(reduce: false, durationMs: 250)
        )
        XCTAssertNotEqual(
            StaggerContainerMotionPreference.resolve(reduceMotion: true),
            StaggerContainerMotionPreference(reduce: false, durationMs: 0)
        )
    }

    func testProjectionEquality() {
        let lhs = StaggerContainerProjector.resolve(StaggerContainerInput(), reduceMotion: false)
        let rhs = StaggerContainerProjector.resolve(StaggerContainerInput(), reduceMotion: false)
        XCTAssertEqual(lhs, rhs)
        let other = StaggerContainerProjector.resolve(StaggerContainerInput(), reduceMotion: true)
        XCTAssertNotEqual(lhs, other)
    }

    func testContextInertIsShownAndVisible() {
        let context = StaggerContainerContext.inert
        XCTAssertEqual(context.phase, .shown)
        XCTAssertEqual(context.projection.childOpacity(for: context.phase), 1, accuracy: 0.0001)
        XCTAssertEqual(context.projection.childOffsetY(for: context.phase), 0, accuracy: 0.0001)
    }
}
