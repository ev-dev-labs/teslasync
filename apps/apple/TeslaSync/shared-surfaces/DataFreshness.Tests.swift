//
//  DataFreshness.Tests.swift
//  TeslaSync — P4 shared surface · 0079 · DataFreshness (Apple)
//
//  Coverage for the DataFreshness surface above the pure adapter (see AdapterTests):
//    • Projection — every presentation (loading / refetching / fresh / empty / stale / offline /
//      error), the relative-label precedence (cached time preferred, errored-with-cache reads the
//      cached time, first-load error reads "error", never-updated reads ""), the base title
//      (lastUpdated / neverUpdated), and the force-stale window driving the amber visual.
//    • Model — start idempotence; the once-only `view.opened` telemetry (emitted on first present,
//      even while fetching); the stale one-shot auto-refresh (armed on the transition, gated on
//      refreshable, re-armed after leaving stale, never armed by an error/fetching jump); the
//      clock-driven tick crossing the force-stale window; manual refresh + stop/start wiring.
//    • Live source — start/refresh emit the bound snapshot.
//    • Views — every state's subview composes (signature contract) + the surface composes for every
//      input.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure projection / model directly against a fixed clock.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures

private let resolveFallback: DataFreshnessResolve = { _, fallback in fallback }
private let fixedTimeFormat: DataFreshnessTimeFormat = { _ in "3:04 PM" }

private enum ModelFixture {
    static let now = Date(timeIntervalSince1970: 1_700_000_000)

    static func ago(_ seconds: TimeInterval) -> Date {
        now.addingTimeInterval(-seconds)
    }

    static let freshInput = DataFreshnessInput(updatedAt: ago(180))
    static let refetchingInput = DataFreshnessInput(updatedAt: ago(120), isFetching: true)
    static let loadingInput = DataFreshnessInput(isFetching: true)
    static let staleInput = DataFreshnessInput(updatedAt: ago(7200), isStale: true)
    static let offlineInput = DataFreshnessInput(updatedAt: ago(300), isError: true)
    static let errorInput = DataFreshnessInput(isError: true)
    static let emptyInput = DataFreshnessInput()
}

// MARK: - Projection (presentations + leaf contract)

final class DataFreshnessProjectionTests: XCTestCase {
    private func resolve(
        _ input: DataFreshnessInput,
        config: DataFreshnessConfig = .default
    ) -> DataFreshnessReadout {
        DataFreshnessProjection.resolve(
            input,
            config: config,
            now: ModelFixture.now,
            timeFormat: fixedTimeFormat,
            strings: resolveFallback
        )
    }

    func testLoadingPresentation() {
        let readout = resolve(ModelFixture.loadingInput)
        XCTAssertEqual(readout.status, .fetching)
        XCTAssertEqual(readout.presentation, .loading)
        XCTAssertEqual(readout.relativeLabel, "updating…")
        XCTAssertFalse(readout.isBackgroundRefetch)
        XCTAssertEqual(readout.baseTitle, "Never updated")
    }

    func testRefetchingPresentationPulses() {
        let readout = resolve(ModelFixture.refetchingInput)
        XCTAssertEqual(readout.status, .fetching)
        XCTAssertEqual(readout.presentation, .refetching)
        XCTAssertEqual(readout.relativeLabel, "updating…")
        XCTAssertTrue(readout.isBackgroundRefetch)
    }

    func testFreshPresentationShowsCachedTime() {
        let readout = resolve(ModelFixture.freshInput)
        XCTAssertEqual(readout.status, .fresh)
        XCTAssertEqual(readout.presentation, .fresh)
        XCTAssertEqual(readout.relativeLabel, "3m ago")
        XCTAssertEqual(readout.baseTitle, "Last updated: 3:04 PM")
    }

    func testEmptyPresentationHasNoLabel() {
        let readout = resolve(ModelFixture.emptyInput)
        XCTAssertEqual(readout.status, .fresh)
        XCTAssertEqual(readout.presentation, .empty)
        XCTAssertEqual(readout.relativeLabel, "")
        XCTAssertEqual(readout.baseTitle, "Never updated")
        XCTAssertEqual(readout.accessibilityValue, "fresh")
    }

    func testStalePresentation() {
        let readout = resolve(ModelFixture.staleInput)
        XCTAssertEqual(readout.status, .stale)
        XCTAssertEqual(readout.presentation, .stale)
        XCTAssertEqual(readout.relativeLabel, "2h ago")
    }

    func testOfflinePresentationShowsCachedTimeNotErrorWord() {
        let readout = resolve(ModelFixture.offlineInput)
        XCTAssertEqual(readout.status, .error)
        XCTAssertEqual(readout.presentation, .offline)
        // Web precedence: cached value + not fetching → the last-known-good time, not "error".
        XCTAssertEqual(readout.relativeLabel, "5m ago")
    }

    func testErrorPresentationFirstLoad() {
        let readout = resolve(ModelFixture.errorInput)
        XCTAssertEqual(readout.status, .error)
        XCTAssertEqual(readout.presentation, .error)
        XCTAssertEqual(readout.relativeLabel, "error")
    }

    func testForceStaleWindowDrivesAmberVisual() {
        let input = DataFreshnessInput(updatedAt: ModelFixture.ago(3 * 3600))
        let config = DataFreshnessConfig(forceStaleAfterMs: 3600 * 1000)
        XCTAssertEqual(resolve(input, config: config).status, .stale)
    }

    func testReadOnlyAccessibilityLabelInterpolatesState() {
        let readout = resolve(ModelFixture.freshInput, config: DataFreshnessConfig(refreshable: false))
        XCTAssertEqual(readout.accessibilityLabel, "Data freshness: fresh")
    }

    func testRefreshableAccessibilityLabelReadsRefresh() {
        XCTAssertEqual(resolve(ModelFixture.freshInput).accessibilityLabel, "Refresh")
    }

    func testCompactConfigPropagates() {
        let readout = resolve(ModelFixture.freshInput, config: DataFreshnessConfig(compact: true))
        XCTAssertTrue(readout.compact)
    }
}

// MARK: - Model (state-holder)

@MainActor
final class DataFreshnessModelTests: XCTestCase {
    private struct Harness {
        let model: DataFreshnessModel
        let source: InMemoryDataFreshnessSource
        let spy: SpyDataFreshnessTelemetry
    }

    private func makeHarness(
        _ input: DataFreshnessInput,
        config: DataFreshnessConfig = .default,
        clock: @escaping DataFreshnessClock = { ModelFixture.now }
    ) -> Harness {
        let source = InMemoryDataFreshnessSource(initial: input)
        let spy = SpyDataFreshnessTelemetry()
        let model = DataFreshnessModel(
            source: source,
            config: config,
            telemetry: spy,
            clock: clock,
            timeFormat: fixedTimeFormat,
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

    func testViewOpenedEmittedOnceOnFirstPresent() {
        let env = makeHarness(ModelFixture.freshInput)
        env.model.start()
        XCTAssertEqual(env.spy.surfaces, [DataFreshnessMeta.surfaceSlug])
        env.source.push(ModelFixture.freshInput)
        XCTAssertEqual(env.spy.surfaces, [DataFreshnessMeta.surfaceSlug])
    }

    func testViewOpenedEmittedEvenWhileFetching() {
        let env = makeHarness(ModelFixture.loadingInput)
        env.model.start()
        XCTAssertEqual(env.model.resolved.presentation, .loading)
        XCTAssertEqual(env.spy.surfaces, [DataFreshnessMeta.surfaceSlug])
    }

    func testFreshToStaleArmsOneRefresh() {
        let env = makeHarness(ModelFixture.freshInput)
        env.model.start()
        XCTAssertEqual(env.source.refreshCount, 0)

        env.source.push(ModelFixture.staleInput)
        XCTAssertEqual(env.model.resolved.status, .stale)
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
        XCTAssertEqual(env.model.resolved.status, .fresh)
        env.source.push(ModelFixture.staleInput)
        XCTAssertEqual(env.source.refreshCount, 2)
    }

    func testReadOnlyChipDoesNotAutoRefresh() {
        let env = makeHarness(ModelFixture.freshInput, config: DataFreshnessConfig(refreshable: false))
        env.model.start()
        env.source.push(ModelFixture.staleInput)
        XCTAssertEqual(env.model.resolved.status, .stale)
        XCTAssertEqual(env.source.refreshCount, 0)
    }

    func testErrorJumpDoesNotAutoRefresh() {
        let env = makeHarness(ModelFixture.freshInput)
        env.model.start()
        env.source.push(ModelFixture.errorInput)
        XCTAssertEqual(env.model.resolved.status, .error)
        XCTAssertEqual(env.source.refreshCount, 0)
    }

    func testTickRecomputesAndArmsRefreshOnForceStaleCrossing() {
        let box = MutableClock(ModelFixture.now)
        let config = DataFreshnessConfig(forceStaleAfterMs: 3600 * 1000)
        let env = makeHarness(
            DataFreshnessInput(updatedAt: ModelFixture.ago(60)),
            config: config,
            clock: { box.now }
        )
        env.model.start()
        XCTAssertEqual(env.model.resolved.status, .fresh)
        XCTAssertEqual(env.source.refreshCount, 0)

        box.advance(2 * 3600)
        env.model.tick()
        XCTAssertEqual(env.model.resolved.status, .stale)
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
        XCTAssertFalse(env.model.config.compact)
        XCTAssertTrue(env.model.config.refreshable)
    }
}

// MARK: - Live source (production binding)

@MainActor
final class LiveDataFreshnessSourceTests: XCTestCase {
    func testStartAndRefreshEmitTheBoundSnapshot() {
        let input = DataFreshnessInput(updatedAt: ModelFixture.ago(12))
        let source = LiveDataFreshnessSource(input: input)
        var emissions: [DataFreshnessInput] = []
        source.onUpdate = { emissions.append($0) }
        source.start()
        source.refresh()
        XCTAssertEqual(emissions, [input, input])
    }
}

// MARK: - Views (every state composes — signature contract)

@MainActor
final class DataFreshnessViewTests: XCTestCase {
    func testEveryStateSubviewComposes() {
        _ = DataFreshnessDot(status: .fresh, isBackgroundRefetch: false)
        _ = DataFreshnessDot(status: .fetching, isBackgroundRefetch: true)
        _ = DataFreshnessIcon(status: .error, compact: false)
        _ = DataFreshnessIcon(status: .fetching, compact: true)
        _ = DataFreshnessLabel(text: "5m ago", tone: DataFreshnessStatus.fresh.tone)
        _ = DataFreshnessChip(
            readout: DataFreshnessProjection.resolve(
                ModelFixture.staleInput,
                config: .default,
                now: ModelFixture.now,
                timeFormat: fixedTimeFormat,
                strings: resolveFallback
            ),
            helpText: "Last updated: 3:04 PM",
            onRefresh: {}
        )
    }

    func testSurfaceComposesForEveryInput() {
        let inputs: [DataFreshnessInput] = [
            ModelFixture.loadingInput,
            ModelFixture.refetchingInput,
            ModelFixture.freshInput,
            ModelFixture.emptyInput,
            ModelFixture.staleInput,
            ModelFixture.offlineInput,
            ModelFixture.errorInput
        ]
        for input in inputs {
            _ = DataFreshness(input: input)
        }
        _ = DataFreshness(
            input: ModelFixture.freshInput,
            config: DataFreshnessConfig(compact: true, refreshable: false)
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyDataFreshnessTelemetry: DataFreshnessTelemetry, @unchecked Sendable {
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
/// timestamp across the force-stale window without waiting on a wall clock. Lock-guarded for the
/// `@Sendable` clock seam under Swift 6 strict concurrency.
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
