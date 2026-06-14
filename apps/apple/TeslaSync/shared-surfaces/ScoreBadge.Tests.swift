//
//  ScoreBadge.Tests.swift
//  TeslaSync — P4 shared surface · 0103 · ScoreBadge (Apple)
//
//  Coverage for the ScoreBadge surface above the pure adapter (see AdapterTests):
//    • Projection — every render phase (loading / unavailable / ready) including the empty "—"
//      readout, the numeric-score and pre-computed-grade inputs, the aria override, and the carried
//      stale / offline decorations, plus the `readyGrade` convenience.
//    • Model — start idempotence; the lazy once-only `view.opened` telemetry (never while loading /
//      unavailable); the stale one-shot auto-refresh (armed on the transition, re-armed after leaving
//      stale, suppressed while offline, never armed by a fresh snapshot); manual refresh + stop/start
//      wiring; and the exposed stale / offline / config.
//    • Live source — start/refresh emit the bound snapshot.
//    • Views — every state's subview composes (signature contract) + the surface composes for every
//      input + the grade tint covers every grade.
//    • Accessibility — the stale/offline-aware readout label.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure projection / model directly.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures

private let resolveFallback: ScoreBadgeResolve = { _, fallback in fallback }

private enum ScoreFixture {
    static let scoreB = ScoreBadgeInput(status: .resolved, value: .score(72))
    static let scoreAPlus = ScoreBadgeInput(status: .resolved, value: .score(95))
    static let gradeA = ScoreBadgeInput(status: .resolved, value: .grade(.aGrade))
    static let empty = ScoreBadgeInput(status: .resolved, value: .score(nil))
    static let stale = ScoreBadgeInput(status: .resolved, value: .score(72), stale: true)
    static let offline = ScoreBadgeInput(status: .resolved, value: .score(91), offline: true)
    static let staleOffline = ScoreBadgeInput(status: .resolved, value: .score(72), stale: true, offline: true)
}

// MARK: - Projection (render phases + leaf contract)

final class ScoreBadgeProjectionTests: XCTestCase {
    private func resolve(
        _ input: ScoreBadgeInput,
        config: ScoreBadgeConfig = .default
    ) -> ScoreBadgeResolved {
        ScoreBadgeProjection.resolve(input, config: config, strings: resolveFallback)
    }

    func testLoadingPhase() {
        XCTAssertEqual(resolve(ScoreBadgeInput(status: .loading)).phase, .loading)
    }

    func testFailedPhaseIsUnavailable() {
        XCTAssertEqual(resolve(ScoreBadgeInput(status: .failed)).phase, .unavailable)
    }

    func testResolvedNumericScoreComposesGradeAndAria() {
        let resolved = resolve(ScoreFixture.scoreB)
        XCTAssertEqual(resolved.readyGrade, .bGrade)
        if case let .ready(readout) = resolved.phase {
            XCTAssertEqual(readout.label, "B")
            XCTAssertEqual(readout.accessibilityLabel, "Score B")
            XCTAssertEqual(readout.size, .medium)
        } else {
            XCTFail("expected ready phase")
        }
    }

    func testResolvedNullScoreIsUnratedEmptyReadout() {
        let resolved = resolve(ScoreFixture.empty)
        XCTAssertEqual(resolved.readyGrade, .unrated)
        if case let .ready(readout) = resolved.phase {
            XCTAssertEqual(readout.label, "—")
            XCTAssertEqual(readout.accessibilityLabel, "Score —")
        } else {
            XCTFail("expected ready phase")
        }
    }

    func testResolvedPrecomputedGrade() {
        XCTAssertEqual(resolve(ScoreFixture.gradeA).readyGrade, .aGrade)
    }

    func testAriaOverrideIsHonored() {
        let resolved = resolve(
            ScoreFixture.scoreB,
            config: ScoreBadgeConfig(size: .large, ariaLabelOverride: "Charging grade B")
        )
        if case let .ready(readout) = resolved.phase {
            XCTAssertEqual(readout.accessibilityLabel, "Charging grade B")
            XCTAssertEqual(readout.size, .large)
        } else {
            XCTFail("expected ready phase")
        }
    }

    func testStaleAndOfflineDecorationsCarried() {
        XCTAssertTrue(resolve(ScoreFixture.stale).stale)
        XCTAssertFalse(resolve(ScoreFixture.stale).offline)
        XCTAssertTrue(resolve(ScoreFixture.offline).offline)
        XCTAssertFalse(resolve(ScoreFixture.offline).stale)
        XCTAssertTrue(resolve(ScoreFixture.staleOffline).stale)
        XCTAssertTrue(resolve(ScoreFixture.staleOffline).offline)
    }

    func testReadyGradeNilForChrome() {
        XCTAssertNil(resolve(ScoreBadgeInput(status: .loading)).readyGrade)
        XCTAssertNil(resolve(ScoreBadgeInput(status: .failed)).readyGrade)
    }
}

// MARK: - Model (state-holder)

@MainActor
final class ScoreBadgeModelTests: XCTestCase {
    private struct Harness {
        let model: ScoreBadgeModel
        let source: InMemoryScoreBadgeSource
        let spy: SpyScoreBadgeTelemetry
    }

    private func makeHarness(
        _ input: ScoreBadgeInput,
        config: ScoreBadgeConfig = .default
    ) -> Harness {
        let source = InMemoryScoreBadgeSource(initial: input)
        let spy = SpyScoreBadgeTelemetry()
        let model = ScoreBadgeModel(source: source, config: config, telemetry: spy, strings: resolveFallback)
        return Harness(model: model, source: source, spy: spy)
    }

    func testStartIsIdempotent() {
        let env = makeHarness(ScoreFixture.scoreB)
        env.model.start()
        env.model.start()
        XCTAssertEqual(env.source.startCount, 1)
    }

    func testLoadingEmitsNoTelemetry() {
        let env = makeHarness(ScoreBadgeInput(status: .loading))
        env.model.start()
        XCTAssertEqual(env.model.phase, .loading)
        XCTAssertTrue(env.spy.surfaces.isEmpty)
    }

    func testFailedProjectsUnavailableWithoutTelemetry() {
        let env = makeHarness(ScoreBadgeInput(status: .failed))
        env.model.start()
        XCTAssertEqual(env.model.phase, .unavailable)
        XCTAssertTrue(env.spy.surfaces.isEmpty)
    }

    func testReadyEmitsTelemetryOnce() {
        let env = makeHarness(ScoreFixture.scoreB)
        env.model.start()
        XCTAssertEqual(env.model.resolved.readyGrade, .bGrade)
        XCTAssertEqual(env.spy.surfaces, [ScoreBadgeMeta.surfaceSlug])
        env.source.push(ScoreFixture.gradeA)
        XCTAssertEqual(env.spy.surfaces, [ScoreBadgeMeta.surfaceSlug])
    }

    func testTelemetryEmittedOnFirstReadyAfterLoading() {
        let env = makeHarness(ScoreBadgeInput(status: .loading))
        env.model.start()
        XCTAssertTrue(env.spy.surfaces.isEmpty)
        env.source.push(ScoreFixture.scoreB)
        XCTAssertEqual(env.spy.surfaces, [ScoreBadgeMeta.surfaceSlug])
    }

    func testStaleArmsOneRefresh() {
        let env = makeHarness(ScoreFixture.scoreB)
        env.model.start()
        XCTAssertEqual(env.source.refreshCount, 0)

        env.source.push(ScoreFixture.stale)
        XCTAssertTrue(env.model.stale)
        XCTAssertEqual(env.source.refreshCount, 1)

        env.source.push(ScoreFixture.stale)
        XCTAssertEqual(env.source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterLeavingStale() {
        let env = makeHarness(ScoreFixture.scoreB)
        env.model.start()
        env.source.push(ScoreFixture.stale)
        XCTAssertEqual(env.source.refreshCount, 1)
        env.source.push(ScoreFixture.scoreB)
        XCTAssertFalse(env.model.stale)
        env.source.push(ScoreFixture.stale)
        XCTAssertEqual(env.source.refreshCount, 2)
    }

    func testOfflineStaleDoesNotAutoRefresh() {
        let env = makeHarness(ScoreFixture.scoreB)
        env.model.start()
        env.source.push(ScoreFixture.staleOffline)
        XCTAssertTrue(env.model.stale)
        XCTAssertTrue(env.model.offline)
        XCTAssertEqual(env.source.refreshCount, 0)
    }

    func testFreshSnapshotDoesNotAutoRefresh() {
        let env = makeHarness(ScoreFixture.scoreB)
        env.model.start()
        env.source.push(ScoreFixture.gradeA)
        XCTAssertFalse(env.model.stale)
        XCTAssertEqual(env.source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let env = makeHarness(ScoreFixture.scoreB)
        env.model.start()
        env.model.refresh()
        XCTAssertEqual(env.source.refreshCount, 1)
    }

    func testStopThenStartReArms() {
        let env = makeHarness(ScoreFixture.scoreB)
        env.model.start()
        env.model.stop()
        XCTAssertEqual(env.source.stopCount, 1)
        env.model.start()
        XCTAssertEqual(env.source.startCount, 2)
    }

    func testConfigAndDecorationsExposed() {
        let env = makeHarness(ScoreFixture.offline, config: ScoreBadgeConfig(size: .large))
        env.model.start()
        XCTAssertEqual(env.model.config.size, .large)
        XCTAssertTrue(env.model.offline)
        XCTAssertFalse(env.model.stale)
    }
}

// MARK: - Live source (production binding)

@MainActor
final class LiveScoreBadgeSourceTests: XCTestCase {
    func testStartAndRefreshEmitTheBoundSnapshot() {
        let source = LiveScoreBadgeSource(input: ScoreFixture.gradeA)
        var emissions: [ScoreBadgeInput] = []
        source.onUpdate = { emissions.append($0) }
        source.start()
        source.refresh()
        XCTAssertEqual(emissions, [ScoreFixture.gradeA, ScoreFixture.gradeA])
    }
}

// MARK: - Views (every state composes — signature contract)

@MainActor
final class ScoreBadgeViewTests: XCTestCase {
    private func readout(_ input: ScoreBadgeInput, config: ScoreBadgeConfig = .default) -> ScoreBadgeReadout {
        guard case let .ready(readout) = ScoreBadgeProjection.resolve(
            input,
            config: config,
            strings: resolveFallback
        ).phase else {
            fatalError("expected ready readout for fixture")
        }
        return readout
    }

    func testEveryStateSubviewComposes() {
        _ = ScoreBadgeGlyph(readout: readout(ScoreFixture.scoreB))
        _ = ScoreBadgeStaleMarker()
        _ = ScoreBadgeOfflineMarker()
        _ = ScoreBadgeReadyView(readout: readout(ScoreFixture.scoreB), stale: false, offline: false)
        _ = ScoreBadgeReadyView(readout: readout(ScoreFixture.staleOffline), stale: true, offline: true)
        _ = ScoreBadgeLoadingSkeleton(size: .small)
        _ = ScoreBadgeUnavailableChip(onRetry: {})
    }

    func testTintColorCoversEveryGrade() {
        for grade in ScoreBadgeGrade.allCases {
            _ = grade.tintColor
        }
    }

    func testSurfaceComposesForEveryInput() {
        let inputs: [ScoreBadgeInput] = [
            ScoreBadgeInput(status: .loading),
            ScoreBadgeInput(status: .failed),
            ScoreFixture.scoreB,
            ScoreFixture.scoreAPlus,
            ScoreFixture.gradeA,
            ScoreFixture.empty,
            ScoreFixture.stale,
            ScoreFixture.offline,
            ScoreFixture.staleOffline
        ]
        for input in inputs {
            _ = ScoreBadge(input: input)
        }
        _ = ScoreBadge(input: ScoreFixture.gradeA, config: ScoreBadgeConfig(size: .large))
    }
}

// MARK: - Accessibility (stale/offline-aware readout label)

final class ScoreBadgeReadoutAccessibilityTests: XCTestCase {
    func testStaleOfflineReadoutLabelAppendsBothNotes() {
        let resolved = ScoreBadgeProjection.resolve(
            ScoreFixture.staleOffline,
            config: .default,
            strings: resolveFallback
        )
        guard case let .ready(readout) = resolved.phase else {
            return XCTFail("expected ready readout")
        }
        let label = ScoreBadgeAccessibility.label(
            base: readout.accessibilityLabel,
            staleNote: "Score may be out of date",
            offlineNote: "Offline — showing the last known score"
        )
        XCTAssertTrue(label.hasPrefix(readout.accessibilityLabel))
        XCTAssertTrue(label.contains("Score may be out of date"))
        XCTAssertTrue(label.hasSuffix("Offline — showing the last known score"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyScoreBadgeTelemetry: ScoreBadgeTelemetry, @unchecked Sendable {
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
