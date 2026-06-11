//
//  PollingEngine.Tests.swift
//  TeslaSync — P4 shared surface · 0098 · PollingEngine (Apple)
//
//  Coverage for the PollingEngine state-holder (the pure adapter is in AdapterTests; the projection +
//  view signature contract are in ProjectionTests, which also owns the shared `PollingFixtures`):
//    • Model — start idempotence, the once-only `view.opened` telemetry (never while withdrawn), the
//      withdraw flag, the connection axis with the one-shot stale auto-refresh (re-armed on return to
//      live), offline never auto-refreshing, and stop / refresh wiring.
//    • Live source — start / refresh emit the bound snapshot.
//
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no real store.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Model (state-holder)

@MainActor
final class PollingEngineModelTests: XCTestCase {
    private struct Harness {
        let model: PollingEngineModel
        let source: InMemoryPollingEngineSource
        let spy: SpyPollingTelemetry
    }

    private func makeHarness(_ input: PollingInput) -> Harness {
        let source = InMemoryPollingEngineSource(initial: input)
        let spy = SpyPollingTelemetry()
        let model = PollingEngineModel(
            source: source,
            telemetry: spy,
            now: { PollingFixtures.now }
        )
        return Harness(model: model, source: source, spy: spy)
    }

    func testStartIsIdempotent() {
        let env = makeHarness(PollingFixtures.enabledInput)
        env.model.start()
        env.model.start()
        XCTAssertEqual(env.source.startCount, 1)
    }

    func testReadyEmitsTelemetryOnce() {
        let env = makeHarness(PollingFixtures.enabledInput)
        env.model.start()
        XCTAssertEqual(env.model.phase, .ready)
        XCTAssertEqual(env.spy.surfaces, ["PollingEngine"])
        env.source.push(PollingFixtures.enabledInput)
        XCTAssertEqual(env.spy.surfaces, ["PollingEngine"])
    }

    func testDisabledFromStartWithdrawsAndEmitsNothing() {
        let env = makeHarness(PollingFixtures.disabledInput)
        env.model.start()
        XCTAssertEqual(env.model.phase, .disabled)
        XCTAssertTrue(env.model.isWithdrawn)
        XCTAssertTrue(env.spy.surfaces.isEmpty)
    }

    func testTelemetryEmittedOnFirstPresentAfterDisabled() {
        let env = makeHarness(PollingFixtures.disabledInput)
        env.model.start()
        XCTAssertTrue(env.spy.surfaces.isEmpty)
        env.source.push(PollingFixtures.enabledInput)
        XCTAssertEqual(env.model.phase, .ready)
        XCTAssertEqual(env.spy.surfaces, ["PollingEngine"])
    }

    func testConnectionAxisIsExposed() {
        let env = makeHarness(PollingFixtures.enabled(connection: .live))
        env.model.start()
        XCTAssertEqual(env.model.connection, .live)
        env.source.push(PollingFixtures.enabled(connection: .offline))
        XCTAssertEqual(env.model.connection, .offline)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let env = makeHarness(PollingFixtures.enabled(connection: .live))
        env.model.start()
        XCTAssertEqual(env.source.refreshCount, 0)

        env.source.push(PollingFixtures.enabled(connection: .stale))
        XCTAssertEqual(env.model.connection, .stale)
        XCTAssertEqual(env.source.refreshCount, 1)

        env.source.push(PollingFixtures.enabled(connection: .stale))
        XCTAssertEqual(env.source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let env = makeHarness(PollingFixtures.enabled(connection: .live))
        env.model.start()
        env.source.push(PollingFixtures.enabled(connection: .stale))
        XCTAssertEqual(env.source.refreshCount, 1)
        env.source.push(PollingFixtures.enabled(connection: .live))
        env.source.push(PollingFixtures.enabled(connection: .stale))
        XCTAssertEqual(env.source.refreshCount, 2)
    }

    func testOfflineNeverAutoRefreshes() {
        let env = makeHarness(PollingFixtures.enabled(connection: .live))
        env.model.start()
        env.source.push(PollingFixtures.enabled(connection: .offline))
        XCTAssertEqual(env.model.connection, .offline)
        XCTAssertEqual(env.source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let env = makeHarness(PollingFixtures.enabledInput)
        env.model.start()
        env.model.refresh()
        XCTAssertEqual(env.source.refreshCount, 1)
    }

    func testStopThenStartReArms() {
        let env = makeHarness(PollingFixtures.enabledInput)
        env.model.start()
        env.model.stop()
        XCTAssertEqual(env.source.stopCount, 1)
        env.model.start()
        XCTAssertEqual(env.source.startCount, 2)
    }
}

// MARK: - Live source (production binding)

@MainActor
final class LivePollingEngineSourceTests: XCTestCase {
    func testStartAndRefreshEmitTheBoundSnapshot() {
        let input = PollingFixtures.enabledInput
        let source = LivePollingEngineSource(input: input)
        var emissions: [PollingInput] = []
        source.onUpdate = { emissions.append($0) }
        source.start()
        source.refresh()
        XCTAssertEqual(emissions, [input, input])
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyPollingTelemetry: PollingEngineTelemetry, @unchecked Sendable {
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
