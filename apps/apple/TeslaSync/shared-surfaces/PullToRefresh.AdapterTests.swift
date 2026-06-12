//
//  PullToRefresh.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0188 · PullToRefresh (Apple)
//
//  Pure coverage (Foundation only) for the dependency-light core of the PullToRefresh surface:
//    • Projection — the verbatim port of the web gesture math + render computations: the rubber-band
//      resistance + `MAX_PULL` clamp, the release predicate, progress / ready / indicator height /
//      content offset, the opacity floor + scale ramp + icon sweep, the phase branch order, and the
//      label-key ternary (the deterministic per-state "snapshot").
//    • Meta + Adapter — the diagnostics slug + verbatim web constants, the `active = enabled ?? isCoarse`
//      resolution, the threshold guard, the pointer capability, the string-key fallbacks, and the
//      indicator-visibility predicate.
//    • Accessibility — the spoken status per phase + the native action / hint labels.
//
//  No store, no SwiftUI: each assertion reads the pure adapter / projection directly. String stubs are
//  deterministic so the key-selection + fallback assertions hold regardless of the runner's locale.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Deterministic string stubs

private func keyEcho(_ key: String, _: String) -> String {
    key
}

private func fallbackEcho(_: String, _ fallback: String) -> String {
    fallback
}

// MARK: - Projection (gesture math + render geometry)

final class PullToRefreshProjectionTests: XCTestCase {
    func testResistedIsLinearBelowThreshold() {
        XCTAssertEqual(PullToRefreshProjection.resisted(delta: 40, threshold: 80), 40, accuracy: 1e-9)
        XCTAssertEqual(PullToRefreshProjection.resisted(delta: 79, threshold: 80), 79, accuracy: 1e-9)
    }

    func testResistedHalvesPastThreshold() {
        // 80 + (120 - 80) * 0.5 = 100
        XCTAssertEqual(PullToRefreshProjection.resisted(delta: 120, threshold: 80), 100, accuracy: 1e-9)
        // boundary: at the threshold there is no extra travel yet
        XCTAssertEqual(PullToRefreshProjection.resisted(delta: 80, threshold: 80), 80, accuracy: 1e-9)
    }

    func testPullIgnoresNonPositiveDelta() {
        XCTAssertEqual(PullToRefreshProjection.pull(forDelta: 0, threshold: 80), 0, accuracy: 1e-9)
        XCTAssertEqual(PullToRefreshProjection.pull(forDelta: -25, threshold: 80), 0, accuracy: 1e-9)
    }

    func testPullAppliesResistanceThenClamp() {
        XCTAssertEqual(PullToRefreshProjection.pull(forDelta: 40, threshold: 80), 40, accuracy: 1e-9)
        XCTAssertEqual(PullToRefreshProjection.pull(forDelta: 120, threshold: 80), 100, accuracy: 1e-9)
        // 80 + (240 - 80) * 0.5 = 160 → clamped to MAX_PULL 140
        XCTAssertEqual(PullToRefreshProjection.pull(forDelta: 240, threshold: 80), 140, accuracy: 1e-9)
        XCTAssertEqual(PullToRefreshProjection.pull(forDelta: 5000, threshold: 80), 140, accuracy: 1e-9)
    }

    func testShouldFireOnlyWhenArmedAndPastThreshold() {
        XCTAssertTrue(PullToRefreshProjection.shouldFire(pull: 80, threshold: 80, armed: true))
        XCTAssertTrue(PullToRefreshProjection.shouldFire(pull: 140, threshold: 80, armed: true))
        XCTAssertFalse(PullToRefreshProjection.shouldFire(pull: 79, threshold: 80, armed: true))
        XCTAssertFalse(PullToRefreshProjection.shouldFire(pull: 140, threshold: 80, armed: false))
    }

    func testProgressClampsAndHonorsRefreshing() {
        XCTAssertEqual(
            PullToRefreshProjection.progress(pull: 40, threshold: 80, refreshing: false),
            0.5,
            accuracy: 1e-9
        )
        XCTAssertEqual(PullToRefreshProjection.progress(pull: 0, threshold: 80, refreshing: false), 0, accuracy: 1e-9)
        XCTAssertEqual(PullToRefreshProjection.progress(pull: 120, threshold: 80, refreshing: false), 1, accuracy: 1e-9)
        XCTAssertEqual(PullToRefreshProjection.progress(pull: 0, threshold: 80, refreshing: true), 1, accuracy: 1e-9)
    }

    func testProgressGuardsZeroThreshold() {
        // a zero threshold falls back to the default denominator (80) rather than dividing by zero
        XCTAssertEqual(PullToRefreshProjection.progress(pull: 40, threshold: 0, refreshing: false), 0.5, accuracy: 1e-9)
    }

    func testIsReady() {
        XCTAssertFalse(PullToRefreshProjection.isReady(pull: 79, threshold: 80))
        XCTAssertTrue(PullToRefreshProjection.isReady(pull: 80, threshold: 80))
    }

    func testIndicatorHeightAndContentOffset() {
        XCTAssertEqual(
            PullToRefreshProjection.indicatorHeight(pull: 40, threshold: 80, refreshing: false), 40, accuracy: 1e-9
        )
        // refreshing → fixed threshold * 0.6 = 48 regardless of pull
        XCTAssertEqual(
            PullToRefreshProjection.indicatorHeight(pull: 0, threshold: 80, refreshing: true), 48, accuracy: 1e-9
        )
        XCTAssertEqual(
            PullToRefreshProjection.contentOffset(pull: 40, threshold: 80, refreshing: false),
            PullToRefreshProjection.indicatorHeight(pull: 40, threshold: 80, refreshing: false),
            accuracy: 1e-9
        )
    }

    func testIndicatorOpacityFloorAndClamp() {
        XCTAssertEqual(PullToRefreshProjection.indicatorOpacity(progress: 0), 0.4, accuracy: 1e-9)
        XCTAssertEqual(PullToRefreshProjection.indicatorOpacity(progress: 0.5), 0.5, accuracy: 1e-9)
        XCTAssertEqual(PullToRefreshProjection.indicatorOpacity(progress: 1), 1, accuracy: 1e-9)
        XCTAssertEqual(PullToRefreshProjection.indicatorOpacity(progress: 2), 1, accuracy: 1e-9)
    }

    func testIndicatorScaleRamp() {
        XCTAssertEqual(PullToRefreshProjection.indicatorScale(progress: 0), 0.8, accuracy: 1e-9)
        XCTAssertEqual(PullToRefreshProjection.indicatorScale(progress: 0.5), 0.9, accuracy: 1e-9)
        XCTAssertEqual(PullToRefreshProjection.indicatorScale(progress: 1), 1, accuracy: 1e-9)
        XCTAssertEqual(PullToRefreshProjection.indicatorScale(progress: 5), 1, accuracy: 1e-9)
    }

    func testIconRotation() {
        XCTAssertEqual(PullToRefreshProjection.iconRotationDegrees(progress: 1, refreshing: false), 270, accuracy: 1e-9)
        XCTAssertEqual(
            PullToRefreshProjection.iconRotationDegrees(progress: 0.5, refreshing: false), 135, accuracy: 1e-9
        )
        XCTAssertEqual(PullToRefreshProjection.iconRotationDegrees(progress: 1, refreshing: true), 0, accuracy: 1e-9)
    }

    func testPhaseBranchOrder() {
        XCTAssertEqual(
            PullToRefreshProjection.phase(pull: 100, threshold: 80, refreshing: false, active: false), .inactive
        )
        XCTAssertEqual(
            PullToRefreshProjection.phase(pull: 100, threshold: 80, refreshing: true, active: true), .refreshing
        )
        XCTAssertEqual(PullToRefreshProjection.phase(pull: 0, threshold: 80, refreshing: false, active: true), .idle)
        XCTAssertEqual(PullToRefreshProjection.phase(pull: 80, threshold: 80, refreshing: false, active: true), .ready)
        XCTAssertEqual(
            PullToRefreshProjection.phase(pull: 40, threshold: 80, refreshing: false, active: true), .pulling
        )
    }

    func testLabelKeyTernary() {
        XCTAssertEqual(PullToRefreshProjection.labelKey(for: .refreshing), PullToRefreshStringKey.refreshing)
        XCTAssertEqual(PullToRefreshProjection.labelKey(for: .ready), PullToRefreshStringKey.release)
        XCTAssertEqual(PullToRefreshProjection.labelKey(for: .pulling), PullToRefreshStringKey.pull)
        XCTAssertEqual(PullToRefreshProjection.labelKey(for: .idle), PullToRefreshStringKey.pull)
        XCTAssertEqual(PullToRefreshProjection.labelKey(for: .inactive), PullToRefreshStringKey.pull)
    }
}

// MARK: - Meta + Adapter

final class PullToRefreshMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(PullToRefreshMeta.surfaceSlug, "PullToRefresh")
    }

    func testVerbatimWebConstants() {
        XCTAssertEqual(PullToRefreshMeta.defaultThreshold, 80, accuracy: 1e-9)
        XCTAssertEqual(PullToRefreshMeta.maxPull, 140, accuracy: 1e-9)
        XCTAssertEqual(PullToRefreshMeta.resistanceFactor, 0.5, accuracy: 1e-9)
        XCTAssertEqual(PullToRefreshMeta.moveGuard, 8, accuracy: 1e-9)
        XCTAssertEqual(PullToRefreshMeta.refreshingHeightFactor, 0.6, accuracy: 1e-9)
        XCTAssertEqual(PullToRefreshMeta.maxIconRotationDegrees, 270, accuracy: 1e-9)
        XCTAssertEqual(PullToRefreshMeta.minIndicatorOpacity, 0.4, accuracy: 1e-9)
        XCTAssertEqual(PullToRefreshMeta.indicatorBaseScale, 0.8, accuracy: 1e-9)
        XCTAssertEqual(PullToRefreshMeta.indicatorScaleRange, 0.2, accuracy: 1e-9)
    }

    func testInputResolvesActiveFromEnabledOrPointer() {
        XCTAssertTrue(PullToRefreshInput(pointer: .coarse).isActive)
        XCTAssertFalse(PullToRefreshInput(pointer: .fine).isActive)
        XCTAssertTrue(PullToRefreshInput(pointer: .fine, enabled: true).isActive)
        XCTAssertFalse(PullToRefreshInput(pointer: .coarse, enabled: false).isActive)
    }

    func testInputThresholdGuard() {
        XCTAssertEqual(PullToRefreshInput(threshold: 120).effectiveThreshold, 120, accuracy: 1e-9)
        XCTAssertEqual(PullToRefreshInput(threshold: 0).effectiveThreshold, 80, accuracy: 1e-9)
        XCTAssertEqual(PullToRefreshInput(threshold: -5).effectiveThreshold, 80, accuracy: 1e-9)
    }

    func testPointerCapability() {
        XCTAssertTrue(PullToRefreshPointer.coarse.isCoarse)
        XCTAssertFalse(PullToRefreshPointer.fine.isCoarse)
        #if os(macOS)
            XCTAssertEqual(PullToRefreshPointer.platformDefault, .fine)
        #elseif targetEnvironment(macCatalyst)
            XCTAssertEqual(PullToRefreshPointer.platformDefault, .fine)
        #else
            XCTAssertEqual(PullToRefreshPointer.platformDefault, .coarse)
        #endif
    }

    func testStringKeyFallbacks() {
        XCTAssertEqual(PullToRefreshStringKey.fallback(for: PullToRefreshStringKey.pull), "Pull to refresh")
        XCTAssertEqual(PullToRefreshStringKey.fallback(for: PullToRefreshStringKey.release), "Release to refresh")
        XCTAssertEqual(PullToRefreshStringKey.fallback(for: PullToRefreshStringKey.refreshing), "Refreshing…")
        XCTAssertEqual(PullToRefreshStringKey.fallback(for: PullToRefreshStringKey.action), "Refresh")
        XCTAssertEqual(PullToRefreshStringKey.fallback(for: PullToRefreshStringKey.hint), "Pull down to refresh")
        XCTAssertEqual(PullToRefreshStringKey.fallback(for: "unknown.key"), "unknown.key")
    }

    func testPhaseShowsIndicator() {
        XCTAssertTrue(PullToRefreshPhase.pulling.showsIndicator)
        XCTAssertTrue(PullToRefreshPhase.ready.showsIndicator)
        XCTAssertTrue(PullToRefreshPhase.refreshing.showsIndicator)
        XCTAssertFalse(PullToRefreshPhase.idle.showsIndicator)
        XCTAssertFalse(PullToRefreshPhase.inactive.showsIndicator)
    }
}

// MARK: - Accessibility

final class PullToRefreshAccessibilityTests: XCTestCase {
    func testStatusLabelSelectsTheKeyForPhase() {
        XCTAssertEqual(
            PullToRefreshAccessibility.statusLabel(for: .ready, strings: keyEcho), PullToRefreshStringKey.release
        )
        XCTAssertEqual(
            PullToRefreshAccessibility.statusLabel(for: .refreshing, strings: keyEcho),
            PullToRefreshStringKey.refreshing
        )
        XCTAssertEqual(
            PullToRefreshAccessibility.statusLabel(for: .pulling, strings: keyEcho), PullToRefreshStringKey.pull
        )
    }

    func testActionAndHintResolveWebCopy() {
        XCTAssertEqual(PullToRefreshAccessibility.actionLabel(strings: fallbackEcho), "Refresh")
        XCTAssertEqual(PullToRefreshAccessibility.hintLabel(strings: fallbackEcho), "Pull down to refresh")
    }
}
