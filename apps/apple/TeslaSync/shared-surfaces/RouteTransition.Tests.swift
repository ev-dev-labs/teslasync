//
//  RouteTransition.Tests.swift
//  TeslaSync — P4 shared surface · 0192 · RouteTransition (Apple)
//
//  Stateful + view coverage for the RouteTransition surface (the pure projection / matcher / adapter
//  coverage lives in RouteTransition.AdapterTests.swift):
//    • Model — the previous-path ref + rendered-path swap, the decision projection per navigation, the
//      `makeDecision` purity (no mutation) vs `commit`, the once-only `view.opened` telemetry, and the
//      Reduce-Motion suppression contract (the surface's one accessibility-relevant behaviour).
//    • Views — the public surface, the content layer, and the transition builder compose (signature
//      contract), and the geometry maps decisions to `.identity` vs the fade.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Model (previous-path ref + decision + lifecycle)

@MainActor
final class RouteTransitionModelTests: XCTestCase {
    private func makeModel(
        initialPath: String = "/dashboard",
        skipPatterns: [String] = RouteTransitionMeta.defaultSkipPatterns,
        baseDurationMs: Double = RouteTransitionMeta.crossfadeDurationMs,
        telemetry: RouteTransitionTelemetry = SpyRouteTransitionTelemetry()
    ) -> RouteTransitionModel {
        RouteTransitionModel(
            input: RouteTransitionInput(
                initialPath: initialPath,
                skipPatterns: skipPatterns,
                baseDurationMs: baseDurationMs
            ),
            telemetry: telemetry
        )
    }

    func testInitialStateSeedsRenderedPathAndInitialPhase() {
        let model = makeModel(initialPath: "/dashboard")
        XCTAssertEqual(model.renderedPath, "/dashboard")
        XCTAssertEqual(model.currentDecision.phase, .initial)
        XCTAssertFalse(model.currentDecision.animates)
    }

    func testPlainNavigationAnimatesAndAdvancesPaths() {
        let model = makeModel(initialPath: "/dashboard")
        let decision = model.transition(to: "/vehicles", reduceMotion: false)
        XCTAssertEqual(decision.phase, .animated)
        XCTAssertTrue(decision.animates)
        XCTAssertEqual(model.renderedPath, "/vehicles")
        XCTAssertEqual(model.currentDecision.phase, .animated)
    }

    func testRepeatNavigationToSamePathIsStable() {
        let model = makeModel(initialPath: "/vehicles")
        // The seed makes the previous path "/vehicles"; navigating there again is a no-op swap.
        let decision = model.transition(to: "/vehicles", reduceMotion: false)
        XCTAssertEqual(decision.phase, .stable)
        XCTAssertFalse(decision.animates)
    }

    func testListDetailDrillIsSuppressed() {
        let model = makeModel(initialPath: "/drives")
        let decision = model.transition(to: "/drives/42", reduceMotion: false)
        XCTAssertEqual(decision.phase, .suppressed(.skipPattern))
        XCTAssertEqual(model.renderedPath, "/drives/42")
    }

    func testReduceMotionSuppressesTransition_accessibility() {
        // The surface's one accessibility-relevant behaviour: reduced motion collapses the fade to an
        // instant swap (web `useMotionPreference` → `reduce`), regardless of the route.
        let model = makeModel(initialPath: "/dashboard")
        let decision = model.transition(to: "/vehicles", reduceMotion: true)
        XCTAssertEqual(decision.phase, .suppressed(.reduceMotion))
        XCTAssertFalse(decision.animates)
        XCTAssertEqual(decision.durationMs, 0, accuracy: 1e-9)
        XCTAssertEqual(model.renderedPath, "/vehicles")
    }

    func testSequentialNavigationsTrackPreviousPath() {
        let model = makeModel(initialPath: "/dashboard")
        XCTAssertEqual(model.transition(to: "/drives", reduceMotion: false).phase, .animated)
        // From "/drives" into the detail → suppressed (previous path now "/drives").
        XCTAssertEqual(model.transition(to: "/drives/9", reduceMotion: false).phase, .suppressed(.skipPattern))
        // Leaving the detail for a plain page is ALSO suppressed: the web `skipForList` ORs over both
        // sides, so a previous path that matches a skip pattern (the detail we are leaving) skips the fade.
        XCTAssertEqual(model.transition(to: "/energy", reduceMotion: false).phase, .suppressed(.skipPattern))
        // A plain page-to-page step with neither side matching animates again.
        XCTAssertEqual(model.transition(to: "/analytics", reduceMotion: false).phase, .animated)
    }

    func testMakeDecisionDoesNotMutateState() {
        let model = makeModel(initialPath: "/dashboard")
        let first = model.makeDecision(forNext: "/vehicles", reduceMotion: false)
        let second = model.makeDecision(forNext: "/vehicles", reduceMotion: false)
        XCTAssertEqual(first, second)
        // No commit happened, so the rendered path is untouched.
        XCTAssertEqual(model.renderedPath, "/dashboard")
        XCTAssertEqual(model.currentDecision.phase, .initial)
    }

    func testCustomDurationFlowsIntoAnimatedDecision() {
        let model = makeModel(initialPath: "/dashboard", baseDurationMs: 200)
        let decision = model.transition(to: "/vehicles", reduceMotion: false)
        XCTAssertEqual(decision.durationMs, 200, accuracy: 1e-9)
        XCTAssertEqual(decision.durationSeconds, 0.2, accuracy: 1e-9)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyRouteTransitionTelemetry()
        let model = makeModel(telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [RouteTransitionMeta.surfaceSlug])
    }

    func testStopIsSafe() {
        let model = makeModel()
        model.start()
        model.stop()
        model.stop()
        XCTAssertEqual(model.currentDecision.phase, .initial)
    }
}

// MARK: - Views (compose — signature contract) + geometry

@MainActor
final class RouteTransitionViewTests: XCTestCase {
    func testSurfaceSlugFromViewType() {
        XCTAssertEqual(RouteTransition<EmptyView>.surfaceSlug, "RouteTransition")
    }

    func testSurfaceComposes() {
        _ = RouteTransition(path: "/dashboard") {
            Text(verbatim: "content")
        }
        _ = RouteTransition(
            path: "/dashboard",
            model: RouteTransitionModel(input: RouteTransitionInput(initialPath: "/dashboard"))
        ) {
            Text(verbatim: "content")
        }
    }

    func testContentLayerComposesForEveryPhase() {
        _ = RouteTransitionContentLayer(
            renderedPath: "/a",
            decision: RouteTransitionDecision(phase: .initial, durationMs: 0),
            content: Text(verbatim: "a")
        )
        _ = RouteTransitionContentLayer(
            renderedPath: "/b",
            decision: RouteTransitionDecision(phase: .animated, durationMs: 120),
            content: Text(verbatim: "b")
        )
        _ = RouteTransitionContentLayer(
            renderedPath: "/c",
            decision: RouteTransitionDecision(phase: .suppressed(.reduceMotion), durationMs: 0),
            content: Text(verbatim: "c")
        )
    }

    func testGeometryUsesFadeOnlyWhenAnimated() {
        // The builder returns a real transition for `animated` and `.identity` otherwise; the value type
        // is opaque, so the contract is asserted via the decision that selects it.
        XCTAssertTrue(RouteTransitionDecision(phase: .animated, durationMs: 120).animates)
        XCTAssertFalse(RouteTransitionDecision(phase: .stable, durationMs: 0).animates)
        _ = RouteTransitionGeometry.crossFade(for: RouteTransitionDecision(phase: .animated, durationMs: 120))
        _ = RouteTransitionGeometry.crossFade(for: RouteTransitionDecision(phase: .initial, durationMs: 0))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it satisfies
/// the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyRouteTransitionTelemetry: RouteTransitionTelemetry, @unchecked Sendable {
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
