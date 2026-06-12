//
//  RouteTransition.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0192 · RouteTransition (Apple)
//
//  Pure coverage (Foundation only) for the dependency-light core of the RouteTransition surface:
//    • RouteMatcher — the verbatim port of react-router's `matchPath({ end: true })`: segment splitting,
//      dynamic `:param` matching, full-path (`end: true`) segment-count enforcement, case-insensitive
//      literals, trailing-slash tolerance, and the `some(...)` set match.
//    • Projection — the web body resolution: the `skipForList` OR over both sides, and the
//      `initial / stable / reduce / skip / animated` decision branches (the deterministic per-state
//      "snapshot"), including the `reduce ||` precedence over the skip patterns.
//    • Meta + Adapter — the diagnostics slug + verbatim web constants, the default skip patterns, the
//      decision's duration projection, and the input's base-duration guard.
//
//  No store, no SwiftUI: each assertion reads the pure adapter / projection directly.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - RouteMatcher (web `matchPath({ end: true })`)

final class RouteTransitionMatcherTests: XCTestCase {
    func testSegmentsDropsLeadingTrailingAndDoubleSlashes() {
        XCTAssertEqual(RouteMatcher.segments("/drives/123/"), ["drives", "123"])
        XCTAssertEqual(RouteMatcher.segments("/drives//123"), ["drives", "123"])
        XCTAssertEqual(RouteMatcher.segments("/"), [])
        XCTAssertEqual(RouteMatcher.segments(""), [])
    }

    func testMatchesDynamicSegment() {
        XCTAssertTrue(RouteMatcher.matches(pattern: "/drives/:id", path: "/drives/123"))
        XCTAssertTrue(RouteMatcher.matches(pattern: "/drives/:id", path: "/drives/abc"))
        XCTAssertTrue(RouteMatcher.matches(pattern: "/vehicles/:id/access", path: "/vehicles/9/access"))
    }

    func testMatchesRejectsSegmentCountMismatch() {
        // `end: true` — the pattern must consume the whole path.
        XCTAssertFalse(RouteMatcher.matches(pattern: "/drives/:id", path: "/drives"))
        XCTAssertFalse(RouteMatcher.matches(pattern: "/drives/:id", path: "/drives/1/2"))
        XCTAssertFalse(RouteMatcher.matches(pattern: "/drives/:id", path: "/drives/9/replay"))
    }

    func testMatchesLiteralIsCaseInsensitive() {
        // react-router default is `caseSensitive: false`.
        XCTAssertTrue(RouteMatcher.matches(pattern: "/drives/:id", path: "/DRIVES/9"))
        XCTAssertFalse(RouteMatcher.matches(pattern: "/drives/:id", path: "/charging/9"))
    }

    func testMatchesToleratesTrailingSlash() {
        XCTAssertTrue(RouteMatcher.matches(pattern: "/vehicles/:id", path: "/vehicles/7/"))
        XCTAssertTrue(RouteMatcher.matches(pattern: "/drives/:id/replay", path: "/drives/7/replay/"))
    }

    func testMatchesDeepPattern() {
        XCTAssertTrue(RouteMatcher.matches(pattern: "/drives/:id/replay", path: "/drives/9/replay"))
        XCTAssertFalse(RouteMatcher.matches(pattern: "/drives/:id/replay", path: "/drives/9"))
    }

    func testMatchesAnyOverDefaultPatterns() {
        let patterns = RouteTransitionMeta.defaultSkipPatterns
        XCTAssertTrue(RouteMatcher.matchesAny(patterns, path: "/drives/42"))
        XCTAssertTrue(RouteMatcher.matchesAny(patterns, path: "/charging/55"))
        XCTAssertTrue(RouteMatcher.matchesAny(patterns, path: "/vehicles/3/access"))
        XCTAssertTrue(RouteMatcher.matchesAny(patterns, path: "/trips/2"))
        XCTAssertTrue(RouteMatcher.matchesAny(patterns, path: "/drives/9/replay"))
        XCTAssertFalse(RouteMatcher.matchesAny(patterns, path: "/dashboard"))
        XCTAssertFalse(RouteMatcher.matchesAny(patterns, path: "/drives"))
        XCTAssertFalse(RouteMatcher.matchesAny(patterns, path: "/vehicles"))
    }
}

// MARK: - Projection (skip resolution + decision branches)

final class RouteTransitionProjectionTests: XCTestCase {
    private let patterns = RouteTransitionMeta.defaultSkipPatterns

    func testSkipsForListDetailFiresOnEitherSide() {
        // Drill-in: new path matches.
        XCTAssertTrue(RouteTransitionProjection.skipsForListDetail(
            previousPath: "/drives", newPath: "/drives/9", skipPatterns: patterns
        ))
        // Drill-back-out (POP): previous path matches.
        XCTAssertTrue(RouteTransitionProjection.skipsForListDetail(
            previousPath: "/drives/9", newPath: "/drives", skipPatterns: patterns
        ))
        // Plain page-to-page: neither side matches.
        XCTAssertFalse(RouteTransitionProjection.skipsForListDetail(
            previousPath: "/dashboard", newPath: "/vehicles", skipPatterns: patterns
        ))
    }

    func testDecideInitialWhenNoPreviousPath() {
        let decision = RouteTransitionProjection.decide(
            previousPath: nil, newPath: "/dashboard", reduceMotion: false, skipPatterns: patterns,
            baseDurationMs: 120
        )
        XCTAssertEqual(decision.phase, .initial)
        XCTAssertFalse(decision.animates)
        XCTAssertEqual(decision.durationMs, 0, accuracy: 1e-9)
    }

    func testDecideStableWhenPathUnchanged() {
        let decision = RouteTransitionProjection.decide(
            previousPath: "/dashboard", newPath: "/dashboard", reduceMotion: false, skipPatterns: patterns,
            baseDurationMs: 120
        )
        XCTAssertEqual(decision.phase, .stable)
        XCTAssertFalse(decision.animates)
        XCTAssertEqual(decision.durationMs, 0, accuracy: 1e-9)
    }

    func testDecideAnimatesPlainPageChange() {
        let decision = RouteTransitionProjection.decide(
            previousPath: "/dashboard", newPath: "/vehicles", reduceMotion: false, skipPatterns: patterns,
            baseDurationMs: 120
        )
        XCTAssertEqual(decision.phase, .animated)
        XCTAssertTrue(decision.animates)
        XCTAssertEqual(decision.durationMs, 120, accuracy: 1e-9)
        XCTAssertEqual(decision.durationSeconds, 0.12, accuracy: 1e-9)
    }

    func testDecideSuppressesUnderReduceMotion() {
        let decision = RouteTransitionProjection.decide(
            previousPath: "/dashboard", newPath: "/vehicles", reduceMotion: true, skipPatterns: patterns,
            baseDurationMs: 120
        )
        XCTAssertEqual(decision.phase, .suppressed(.reduceMotion))
        XCTAssertFalse(decision.animates)
        XCTAssertEqual(decision.durationMs, 0, accuracy: 1e-9)
    }

    func testDecideSuppressesListDetailDrillIn() {
        let decision = RouteTransitionProjection.decide(
            previousPath: "/drives", newPath: "/drives/9", reduceMotion: false, skipPatterns: patterns,
            baseDurationMs: 120
        )
        XCTAssertEqual(decision.phase, .suppressed(.skipPattern))
        XCTAssertFalse(decision.animates)
    }

    func testDecideSuppressesListDetailDrillBackOut() {
        let decision = RouteTransitionProjection.decide(
            previousPath: "/vehicles/3", newPath: "/vehicles", reduceMotion: false, skipPatterns: patterns,
            baseDurationMs: 120
        )
        XCTAssertEqual(decision.phase, .suppressed(.skipPattern))
    }

    func testReduceMotionTakesPrecedenceOverSkipPattern() {
        // Web `reduce || skipForList` — reduce is the left operand, so it is the reported reason.
        let decision = RouteTransitionProjection.decide(
            previousPath: "/drives", newPath: "/drives/9", reduceMotion: true, skipPatterns: patterns,
            baseDurationMs: 120
        )
        XCTAssertEqual(decision.phase, .suppressed(.reduceMotion))
    }

    func testCustomSkipPatternsOverrideDefaults() {
        // An empty override means even a list ↔ detail drill animates (web `skipPattern={[]}`).
        let decision = RouteTransitionProjection.decide(
            previousPath: "/drives", newPath: "/drives/9", reduceMotion: false, skipPatterns: [],
            baseDurationMs: 120
        )
        XCTAssertEqual(decision.phase, .animated)
    }
}

// MARK: - Meta + Adapter value types

final class RouteTransitionMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(RouteTransitionMeta.surfaceSlug, "RouteTransition")
    }

    func testVerbatimWebConstants() {
        XCTAssertEqual(RouteTransitionMeta.crossfadeDurationMs, 120, accuracy: 1e-9)
        XCTAssertEqual(RouteTransitionMeta.enterOffsetY, 4, accuracy: 1e-9)
        XCTAssertEqual(RouteTransitionMeta.exitOffsetY, -4, accuracy: 1e-9)
    }

    func testDefaultSkipPatternsMatchWebVerbatim() {
        XCTAssertEqual(RouteTransitionMeta.defaultSkipPatterns, [
            "/drives/:id",
            "/drives/:id/replay",
            "/charging/:id",
            "/vehicles/:id",
            "/vehicles/:id/access",
            "/trips/:id"
        ])
    }

    func testPhaseAnimatesOnlyForAnimated() {
        XCTAssertTrue(RouteTransitionPhase.animated.animates)
        XCTAssertFalse(RouteTransitionPhase.initial.animates)
        XCTAssertFalse(RouteTransitionPhase.stable.animates)
        XCTAssertFalse(RouteTransitionPhase.suppressed(.reduceMotion).animates)
        XCTAssertFalse(RouteTransitionPhase.suppressed(.skipPattern).animates)
    }

    func testDecisionDurationSeconds() {
        XCTAssertEqual(
            RouteTransitionDecision(phase: .animated, durationMs: 120).durationSeconds, 0.12, accuracy: 1e-9
        )
        XCTAssertEqual(
            RouteTransitionDecision(phase: .suppressed(.skipPattern), durationMs: 0).durationSeconds,
            0,
            accuracy: 1e-9
        )
    }

    func testInputBaseDurationGuard() {
        XCTAssertEqual(RouteTransitionInput(initialPath: "/x").effectiveBaseDurationMs, 120, accuracy: 1e-9)
        XCTAssertEqual(
            RouteTransitionInput(initialPath: "/x", baseDurationMs: 200).effectiveBaseDurationMs,
            200,
            accuracy: 1e-9
        )
        XCTAssertEqual(
            RouteTransitionInput(initialPath: "/x", baseDurationMs: 0).effectiveBaseDurationMs, 120, accuracy: 1e-9
        )
        XCTAssertEqual(
            RouteTransitionInput(initialPath: "/x", baseDurationMs: -5).effectiveBaseDurationMs, 120, accuracy: 1e-9
        )
    }

    func testInputDefaultsToWebSkipPatterns() {
        XCTAssertEqual(RouteTransitionInput(initialPath: "/x").skipPatterns, RouteTransitionMeta.defaultSkipPatterns)
    }
}
