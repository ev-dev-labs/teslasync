//
//  FreshnessIndicator.Tests.swift
//  TeslaSync — P4 shared surface · 0090 · FreshnessIndicator (Apple)
//
//  Coverage for the FreshnessIndicator surface above the pure adapter (see AdapterTests):
//    • Projection — every render phase (loading / unavailable / ready) including the unknown/empty
//      readout, plus the carried `useIsStale` verdict and the `readyStatus` convenience.
//    • Model — start idempotence; the lazy once-only `view.opened` telemetry (never while loading /
//      unavailable); the fresh→stale one-shot auto-refresh (armed on the transition, re-armed after
//      leaving stale, never armed by an offline jump); the clock-driven tick transition; manual
//      refresh + stop/start wiring; and the exposed `useIsStale` verdict.
//    • Live source — start/refresh emit the bound snapshot.
//    • Views — every state's subview composes (signature contract) + the surface composes for every
//      input.
//    • Accessibility — the localised status words + the freshness-aware readout label.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure projection / model directly against a fixed clock.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures

private let resolveFallback: FreshnessResolve = { _, fallback in fallback }

private enum ModelFixture {
    static let now = Date(timeIntervalSince1970: 1_700_000_000)

    static func iso(secondsAgo seconds: TimeInterval) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: now.addingTimeInterval(-seconds))
    }

    static let freshInput = FreshnessInput(status: .resolved, timestamp: iso(secondsAgo: 5))
    static let staleInput = FreshnessInput(status: .resolved, timestamp: iso(secondsAgo: 200))
    static let offlineInput = FreshnessInput(status: .resolved, timestamp: iso(secondsAgo: 1200))
    static let unknownInput = FreshnessInput(status: .resolved, timestamp: nil)
}

// MARK: - Projection (render phases + leaf contract)

final class FreshnessProjectionTests: XCTestCase {
    private func resolve(_ input: FreshnessInput) -> FreshnessResolved {
        FreshnessProjection.resolve(input, config: .default, now: ModelFixture.now, strings: resolveFallback)
    }

    func testLoadingPhase() {
        XCTAssertEqual(resolve(FreshnessInput(status: .loading)).phase, .loading)
    }

    func testFailedPhaseIsUnavailable() {
        XCTAssertEqual(resolve(FreshnessInput(status: .failed)).phase, .unavailable)
    }

    func testResolvedNilTimestampIsUnknownEmptyReadout() {
        let resolved = resolve(ModelFixture.unknownInput)
        XCTAssertEqual(resolved.readyStatus, .unknown)
        if case let .ready(readout) = resolved.phase {
            XCTAssertEqual(readout.ageLabel, "—")
            XCTAssertNil(readout.timestamp)
        } else {
            XCTFail("expected ready phase")
        }
    }

    func testResolvedFresh() {
        XCTAssertEqual(resolve(ModelFixture.freshInput).readyStatus, .fresh)
    }

    func testResolvedStaleCarriesUseIsStaleVerdict() {
        let resolved = resolve(ModelFixture.staleInput)
        XCTAssertEqual(resolved.readyStatus, .stale)
        XCTAssertTrue(resolved.stale.isStale)
        XCTAssertFalse(resolved.stale.isOffline)
    }

    func testResolvedOfflineCarriesUseIsStaleVerdict() {
        let resolved = resolve(ModelFixture.offlineInput)
        XCTAssertEqual(resolved.readyStatus, .offline)
        XCTAssertTrue(resolved.stale.isStale)
        XCTAssertTrue(resolved.stale.isOffline)
    }

    func testReadyStatusNilForChrome() {
        XCTAssertNil(resolve(FreshnessInput(status: .loading)).readyStatus)
        XCTAssertNil(resolve(FreshnessInput(status: .failed)).readyStatus)
    }
}

// MARK: - Model (state-holder)

@MainActor
final class FreshnessIndicatorModelTests: XCTestCase {
    private struct Harness {
        let model: FreshnessIndicatorModel
        let source: InMemoryFreshnessIndicatorSource
        let spy: SpyFreshnessTelemetry
    }

    private func makeHarness(
        _ input: FreshnessInput,
        clock: @escaping FreshnessClock = { ModelFixture.now }
    ) -> Harness {
        let source = InMemoryFreshnessIndicatorSource(initial: input)
        let spy = SpyFreshnessTelemetry()
        let model = FreshnessIndicatorModel(
            source: source,
            telemetry: spy,
            clock: clock,
            strings: resolveFallback
        )
        return Harness(model: model, source: source, spy: spy)
    }

    func testStartIsIdempotent() {
        let env = makeHarness(ModelFixture.freshInput)
        env.model.start()
        env.model.start()
        XCTAssertEqual(env.source.startCount, 1)
    }

    func testLoadingEmitsNoTelemetry() {
        let env = makeHarness(FreshnessInput(status: .loading))
        env.model.start()
        XCTAssertEqual(env.model.phase, .loading)
        XCTAssertTrue(env.spy.surfaces.isEmpty)
    }

    func testFailedProjectsUnavailableWithoutTelemetry() {
        let env = makeHarness(FreshnessInput(status: .failed))
        env.model.start()
        XCTAssertEqual(env.model.phase, .unavailable)
        XCTAssertTrue(env.spy.surfaces.isEmpty)
    }

    func testReadyEmitsTelemetryOnce() {
        let env = makeHarness(ModelFixture.freshInput)
        env.model.start()
        XCTAssertEqual(env.model.readyStatusOrNil, .fresh)
        XCTAssertEqual(env.spy.surfaces, [FreshnessIndicatorMeta.surfaceSlug])
        env.source.push(ModelFixture.freshInput)
        XCTAssertEqual(env.spy.surfaces, [FreshnessIndicatorMeta.surfaceSlug])
    }

    func testTelemetryEmittedOnFirstReadyAfterLoading() {
        let env = makeHarness(FreshnessInput(status: .loading))
        env.model.start()
        XCTAssertTrue(env.spy.surfaces.isEmpty)
        env.source.push(ModelFixture.freshInput)
        XCTAssertEqual(env.spy.surfaces, [FreshnessIndicatorMeta.surfaceSlug])
    }

    func testUseIsStaleVerdictExposed() {
        let env = makeHarness(ModelFixture.staleInput)
        env.model.start()
        XCTAssertTrue(env.model.stale.isStale)
        XCTAssertFalse(env.model.stale.isOffline)
        XCTAssertEqual(env.model.stale.ageLabel, "3m ago")
    }

    func testFreshToStaleArmsOneRefresh() {
        let env = makeHarness(ModelFixture.freshInput)
        env.model.start()
        XCTAssertEqual(env.source.refreshCount, 0)

        env.source.push(ModelFixture.staleInput)
        XCTAssertEqual(env.model.readyStatusOrNil, .stale)
        XCTAssertEqual(env.source.refreshCount, 1)

        env.source.push(ModelFixture.staleInput)
        XCTAssertEqual(env.source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterLeavingStale() {
        let env = makeHarness(ModelFixture.freshInput)
        env.model.start()
        env.source.push(ModelFixture.staleInput)
        XCTAssertEqual(env.source.refreshCount, 1)
        env.source.push(ModelFixture.freshInput)
        XCTAssertEqual(env.model.readyStatusOrNil, .fresh)
        env.source.push(ModelFixture.staleInput)
        XCTAssertEqual(env.source.refreshCount, 2)
    }

    func testOfflineJumpDoesNotAutoRefresh() {
        let env = makeHarness(ModelFixture.freshInput)
        env.model.start()
        env.source.push(ModelFixture.offlineInput)
        XCTAssertEqual(env.model.readyStatusOrNil, .offline)
        XCTAssertEqual(env.source.refreshCount, 0)
    }

    func testTickRecomputesAgeAndArmsRefreshOnStaleCrossing() {
        let box = MutableClock(ModelFixture.now)
        let env = makeHarness(ModelFixture.freshInput, clock: { box.now })
        env.model.start()
        XCTAssertEqual(env.model.readyStatusOrNil, .fresh)
        XCTAssertEqual(env.source.refreshCount, 0)

        box.advance(200)
        env.model.tick()
        XCTAssertEqual(env.model.readyStatusOrNil, .stale)
        XCTAssertEqual(env.source.refreshCount, 1)

        env.model.tick()
        XCTAssertEqual(env.source.refreshCount, 1)
    }

    func testManualRefreshDelegatesToSource() {
        let env = makeHarness(ModelFixture.freshInput)
        env.model.start()
        env.model.refresh()
        XCTAssertEqual(env.source.refreshCount, 1)
    }

    func testStopThenStartReArms() {
        let env = makeHarness(ModelFixture.freshInput)
        env.model.start()
        env.model.stop()
        XCTAssertEqual(env.source.stopCount, 1)
        env.model.start()
        XCTAssertEqual(env.source.startCount, 2)
    }

    func testConfigDefaultsAreExposed() {
        let env = makeHarness(ModelFixture.freshInput)
        XCTAssertTrue(env.model.config.showLabel)
        XCTAssertEqual(env.model.config.size, .small)
    }
}

// MARK: - Live source (production binding)

@MainActor
final class LiveFreshnessIndicatorSourceTests: XCTestCase {
    func testStartAndRefreshEmitTheBoundSnapshot() {
        let input = FreshnessInput(status: .resolved, timestamp: ModelFixture.iso(secondsAgo: 12))
        let source = LiveFreshnessIndicatorSource(input: input)
        var emissions: [FreshnessInput] = []
        source.onUpdate = { emissions.append($0) }
        source.start()
        source.refresh()
        XCTAssertEqual(emissions, [input, input])
    }
}

// MARK: - Views (every state composes — signature contract)

@MainActor
final class FreshnessIndicatorViewTests: XCTestCase {
    func testEveryStateSubviewComposes() {
        _ = FreshnessDot(status: .fresh, size: .small)
        _ = FreshnessDot(status: .offline, size: .medium)
        _ = FreshnessLabel(text: "5m ago")
        _ = FreshnessReadyView(
            readout: FreshnessReadout(status: .stale, ageLabel: "5m ago", timestamp: "2026-06-10T00:00:00Z"),
            showLabel: true,
            size: .small
        )
        _ = FreshnessLoadingChip(size: .medium)
        _ = FreshnessUnavailableChip(onRetry: {})
    }

    func testSurfaceComposesForEveryInput() {
        let inputs: [FreshnessInput] = [
            FreshnessInput(status: .loading),
            FreshnessInput(status: .failed),
            ModelFixture.freshInput,
            ModelFixture.staleInput,
            ModelFixture.offlineInput,
            ModelFixture.unknownInput
        ]
        for input in inputs {
            _ = FreshnessIndicator(input: input)
        }
        _ = FreshnessIndicator(input: ModelFixture.freshInput, config: FreshnessConfig(showLabel: false, size: .medium))
    }
}

// MARK: - Accessibility (status words + readout label)

final class FreshnessIndicatorAccessibilityTests: XCTestCase {
    func testStatusWordsResolve() {
        XCTAssertEqual(FreshnessStatus.fresh.accessibilityWord, "Fresh")
        XCTAssertEqual(FreshnessStatus.stale.accessibilityWord, "Stale")
        XCTAssertEqual(FreshnessStatus.offline.accessibilityWord, "Offline")
        XCTAssertEqual(FreshnessStatus.unknown.accessibilityWord, "No data")
    }

    func testReadoutLabelCombinesWordAndAge() {
        let label = FreshnessAccessibility.label(
            status: .stale,
            ageLabel: "5m ago",
            statusWord: FreshnessStatus.stale.accessibilityWord
        )
        XCTAssertEqual(label, "Stale, 5m ago")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyFreshnessTelemetry: FreshnessTelemetry, @unchecked Sendable {
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

/// A mutable clock for the tick-transition test — advanced explicitly so the projection ages the
/// timestamp across a threshold without waiting on a wall clock. Lock-guarded for the `@Sendable`
/// clock seam under Swift 6 strict concurrency.
private final class MutableClock: @unchecked Sendable {
    private let lock = NSLock()
    private var current: Date

    init(_ start: Date) {
        current = start
    }

    var now: Date {
        lock.lock()
        defer { lock.unlock() }
        return current
    }

    func advance(_ seconds: TimeInterval) {
        lock.lock()
        current = current.addingTimeInterval(seconds)
        lock.unlock()
    }
}

// MARK: - Model test convenience

private extension FreshnessIndicatorModel {
    /// The resolved status when presenting a readout, else `nil` — a test reach-through to the
    /// projection's `readyStatus` for terse model assertions.
    var readyStatusOrNil: FreshnessStatus? {
        resolved.readyStatus
    }
}
