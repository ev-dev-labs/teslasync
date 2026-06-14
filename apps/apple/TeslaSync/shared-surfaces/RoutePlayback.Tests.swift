//
//  RoutePlayback.Tests.swift
//  TeslaSync — P4 shared surface · 0187 · RoutePlayback (Apple)
//
//  State-holder + view coverage for the RoutePlayback surface: the model's lifecycle (start idempotence
//  + the once-only `view.opened` telemetry), the route snapshot apply (connection / phase / route, with
//  the offline snapshot retaining the last-known route), the connectivity axis with the one-shot stale
//  auto-refresh (re-armed on return to live) and offline never auto-refreshing, the playback engine
//  (play / pause / stop / seek / speed + the clock-driven cursor advance to the end), the embedded
//  controlled `PlaybackControls` bar wiring, the every-state view composition, and the freshness /
//  metric / accessibility copy. Runs in the TeslaSync(/-macOS) XCTest targets.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Model (state-holder + playback engine)

@MainActor
final class RoutePlaybackModelTests: XCTestCase {
    private struct Harness {
        let model: RoutePlaybackModel
        let source: InMemoryRoutePlaybackSource
        let clock: ManualRoutePlaybackClock
        let spy: SpyRoutePlaybackTelemetry
    }

    private var sampleRows: [RoutePlaybackPointRow] {
        [
            RoutePlaybackPointRow(lat: 0, lng: 0, timestamp: "2026-01-01T00:00:00Z", speed: 0, soc: 90),
            RoutePlaybackPointRow(lat: 0, lng: 1, timestamp: "2026-01-01T00:00:00.100Z", speed: 50, soc: 88)
        ]
    }

    private func makeHarness(
        _ input: RoutePlaybackInput,
        content: RoutePlaybackContent = RoutePlaybackContent()
    ) -> Harness {
        let source = InMemoryRoutePlaybackSource(initial: input)
        let clock = ManualRoutePlaybackClock()
        let spy = SpyRoutePlaybackTelemetry()
        let model = RoutePlaybackModel(content: content, source: source, clock: clock, telemetry: spy)
        return Harness(model: model, source: source, clock: clock, spy: spy)
    }

    private var liveLoaded: RoutePlaybackInput {
        RoutePlaybackInput(connection: .live, phase: .loaded, rows: sampleRows)
    }

    func testStartIsIdempotent() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        env.model.start()
        XCTAssertEqual(env.source.startCount, 1)
    }

    func testStartEmitsViewOpenedOnce() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        XCTAssertEqual(env.spy.surfaces, [RoutePlaybackMeta.surfaceSlug])
        env.source.push(RoutePlaybackInput(connection: .stale, phase: .loaded, rows: sampleRows))
        XCTAssertEqual(env.spy.surfaces, [RoutePlaybackMeta.surfaceSlug])
    }

    func testApplyUpdatesRouteConnectionAndPhase() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        XCTAssertEqual(env.model.connection, .live)
        XCTAssertEqual(env.model.phase, .loaded)
        XCTAssertEqual(env.model.route.count, 2)
        XCTAssertEqual(env.model.resolved.status, .ready)
    }

    func testOfflineSnapshotRetainsLastRoute() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        XCTAssertEqual(env.model.route.count, 2)

        env.source.push(RoutePlaybackInput(connection: .offline, phase: .loaded, rows: nil))
        XCTAssertEqual(env.model.connection, .offline)
        XCTAssertEqual(env.model.route.count, 2)
        XCTAssertEqual(env.model.resolved.status, .ready)
    }

    func testSettledEmptyRowsResolveToEmpty() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        env.source.push(RoutePlaybackInput(connection: .live, phase: .loaded, rows: []))
        XCTAssertTrue(env.model.route.isEmpty)
        XCTAssertEqual(env.model.resolved.status, .empty)
    }

    func testStaleTriggersOneShotAutoRefresh() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        XCTAssertEqual(env.source.refreshCount, 0)

        env.source.push(RoutePlaybackInput(connection: .stale, phase: .loaded, rows: sampleRows))
        XCTAssertEqual(env.source.refreshCount, 1)
        env.source.push(RoutePlaybackInput(connection: .stale, phase: .loaded, rows: sampleRows))
        XCTAssertEqual(env.source.refreshCount, 1)
    }

    func testStaleReArmsAfterReturningToLive() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        env.source.push(RoutePlaybackInput(connection: .stale, phase: .loaded, rows: sampleRows))
        XCTAssertEqual(env.source.refreshCount, 1)
        env.source.push(liveLoaded)
        env.source.push(RoutePlaybackInput(connection: .stale, phase: .loaded, rows: sampleRows))
        XCTAssertEqual(env.source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        env.source.push(RoutePlaybackInput(connection: .offline, phase: .loaded, rows: sampleRows))
        XCTAssertEqual(env.source.refreshCount, 0)
    }

    func testManualRefreshForwardsToSource() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        env.model.refresh()
        XCTAssertEqual(env.source.refreshCount, 1)
    }

    // MARK: Playback engine

    func testPlayStartsClockThenReachesEnd() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        env.model.play()
        XCTAssertTrue(env.model.isPlaying)
        XCTAssertTrue(env.clock.isRunning)

        env.clock.fire() // elapsed 50ms of 100ms
        XCTAssertEqual(env.model.elapsedMs, 50)
        XCTAssertTrue(env.model.isPlaying)

        env.clock.fire() // elapsed clamps to 100ms → end
        XCTAssertFalse(env.model.isPlaying)
        XCTAssertFalse(env.clock.isRunning)
        XCTAssertEqual(env.model.currentIndex, env.model.route.count - 1)
    }

    func testPlayRequiresAtLeastTwoSamples() {
        let single = [RoutePlaybackPointRow(lat: 0, lng: 0, timestamp: "2026-01-01T00:00:00Z")]
        let env = makeHarness(RoutePlaybackInput(connection: .live, phase: .loaded, rows: single))
        env.model.start()
        env.model.play()
        XCTAssertFalse(env.model.isPlaying)
        XCTAssertFalse(env.clock.isRunning)
    }

    func testPauseStopsClock() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        env.model.play()
        env.model.pause()
        XCTAssertFalse(env.model.isPlaying)
        XCTAssertFalse(env.clock.isRunning)
    }

    func testStopAndResetRewinds() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        env.model.play()
        env.clock.fire()
        env.model.stopAndReset()
        XCTAssertFalse(env.model.isPlaying)
        XCTAssertEqual(env.model.currentIndex, 0)
        XCTAssertEqual(env.model.elapsedMs, 0)
    }

    func testSeekMovesCursor() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        env.model.seek(1)
        XCTAssertEqual(env.model.elapsedMs, env.model.route.totalMs)
        XCTAssertEqual(env.model.currentIndex, env.model.route.count - 1)
        env.model.seek(0)
        XCTAssertEqual(env.model.elapsedMs, 0)
        XCTAssertEqual(env.model.currentIndex, 0)
    }

    func testSetSpeedUpdatesMultiplier() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        env.model.setSpeed(.x25)
        XCTAssertEqual(env.model.speed, .x25)
        XCTAssertEqual(env.model.frame.speedMultiplier, 25)
    }

    func testPlayFromEndRestarts() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        env.model.seek(1)
        env.model.play()
        XCTAssertTrue(env.model.isPlaying)
        XCTAssertEqual(env.model.elapsedMs, 0)
        XCTAssertEqual(env.model.currentIndex, 0)
    }

    func testAutoPlayStartsOnLoad() {
        let env = makeHarness(liveLoaded, content: RoutePlaybackContent(autoPlay: true))
        env.model.start()
        XCTAssertTrue(env.model.isPlaying)
        XCTAssertTrue(env.clock.isRunning)
    }

    func testOnPositionChangeFiresOnCursorMove() {
        var observed: [Int] = []
        let source = InMemoryRoutePlaybackSource(initial: liveLoaded)
        let model = RoutePlaybackModel(
            content: RoutePlaybackContent(),
            source: source,
            clock: ManualRoutePlaybackClock(),
            onPositionChange: { _, index in observed.append(index) }
        )
        model.start()
        model.seek(1)
        XCTAssertEqual(observed.last, model.route.count - 1)
    }

    // MARK: Embedded controlled bar

    func testControlsBarReflectsPlaybackState() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        env.model.play()
        XCTAssertTrue(env.model.controlsModel.resolved.isPlaying)
        env.model.setSpeed(.x50)
        XCTAssertEqual(env.model.controlsModel.resolved.speed, .x50)
    }
}

// MARK: - View composition (every state renders)

@MainActor
final class RoutePlaybackViewTests: XCTestCase {
    private var sampleRows: [RoutePlaybackPointRow] {
        [
            RoutePlaybackPointRow(lat: 37.77, lng: -122.41, timestamp: "2026-01-01T00:00:00Z", speed: 10, soc: 80),
            RoutePlaybackPointRow(lat: 37.78, lng: -122.40, timestamp: "2026-01-01T00:00:30Z", speed: 20, soc: 79)
        ]
    }

    private func startedModel(
        connection: RoutePlaybackConnection,
        phase: RoutePlaybackLoadPhase,
        rows: [RoutePlaybackPointRow]?
    ) -> RoutePlaybackModel {
        let source = InMemoryRoutePlaybackSource(
            initial: RoutePlaybackInput(connection: connection, phase: phase, rows: rows)
        )
        let model = RoutePlaybackModel(
            content: RoutePlaybackContent(),
            source: source,
            clock: ManualRoutePlaybackClock()
        )
        model.start()
        return model
    }

    func testSurfaceBuildsForEveryState() {
        XCTAssertEqual(RoutePlayback.surfaceSlug, "RoutePlayback")
        let scenarios: [RoutePlaybackScenario] = [
            RoutePlaybackScenario(connection: .live, phase: .loading, rows: nil),
            RoutePlaybackScenario(connection: .live, phase: .loaded, rows: []),
            RoutePlaybackScenario(connection: .live, phase: .failed, rows: nil),
            RoutePlaybackScenario(connection: .live, phase: .failed, rows: sampleRows),
            RoutePlaybackScenario(connection: .live, phase: .loaded, rows: sampleRows),
            RoutePlaybackScenario(connection: .stale, phase: .loaded, rows: sampleRows),
            RoutePlaybackScenario(connection: .offline, phase: .loaded, rows: sampleRows)
        ]
        for scenario in scenarios {
            let model = startedModel(connection: scenario.connection, phase: scenario.phase, rows: scenario.rows)
            _ = RoutePlayback(model: model).body
        }
    }

    func testChromeViewsBuild() {
        let frame = RoutePlaybackProjection.frame(
            route: RoutePlaybackAdapter.route(from: sampleRows),
            currentIndex: 1,
            isPlaying: true,
            speedMultiplier: 10,
            elapsedMs: 30000
        )
        _ = RoutePlaybackMetricChip(frame: frame).body
        _ = RoutePlaybackConnectivityChip(connection: .stale, onRefresh: {}).body
        _ = RoutePlaybackConnectivityBanner(connection: .offline).body
        _ = RoutePlaybackLoadingPanel(height: 400).body
        _ = RoutePlaybackErrorOverlay(onRetry: {}).body
        _ = RoutePlaybackPlayheadGlyph(color: Color.TS.accent, heading: 90).body
    }
}

// MARK: - Accessibility + freshness copy

final class RoutePlaybackAccessibilityTests: XCTestCase {
    private func route() -> RoutePlaybackRoute {
        RoutePlaybackAdapter.route(from: [
            RoutePlaybackPointRow(lat: 0, lng: 0, timestamp: "2026-01-01T00:00:00Z", speed: 12.4, soc: 73),
            RoutePlaybackPointRow(lat: 0, lng: 1, timestamp: "2026-01-01T00:00:10Z", speed: 44, soc: 71)
        ])
    }

    func testFreshnessLabelsResolve() {
        XCTAssertEqual(RoutePlaybackFreshness.label(for: .live), "Live")
        XCTAssertEqual(RoutePlaybackFreshness.label(for: .stale), "Stale")
        XCTAssertEqual(RoutePlaybackFreshness.label(for: .offline), "Offline")
    }

    func testFreshnessNotesAreDistinct() {
        let stale = RoutePlaybackFreshness.note(for: .stale)
        let offline = RoutePlaybackFreshness.note(for: .offline)
        XCTAssertFalse(stale.isEmpty)
        XCTAssertFalse(offline.isEmpty)
        XCTAssertNotEqual(stale, offline)
    }

    func testFreshnessTonesAreDistinct() {
        XCTAssertNotEqual(RoutePlaybackFreshness.tone(for: .live), RoutePlaybackFreshness.tone(for: .stale))
        XCTAssertNotEqual(RoutePlaybackFreshness.tone(for: .stale), RoutePlaybackFreshness.tone(for: .offline))
    }

    func testMetricFormatting() {
        let frame = RoutePlaybackProjection.frame(
            route: route(),
            currentIndex: 0,
            isPlaying: false,
            speedMultiplier: 1,
            elapsedMs: 0
        )
        XCTAssertEqual(RoutePlaybackFormat.counter(frame), "1/2")
        XCTAssertEqual(RoutePlaybackFormat.speed(12.4), "12.4")
        XCTAssertEqual(RoutePlaybackFormat.soc(72.6), "73")
    }

    func testMapValueDescribesSampleSpeedAndFreshness() {
        let built = route()
        let liveFrame = RoutePlaybackProjection.frame(
            route: built,
            currentIndex: 1,
            isPlaying: true,
            speedMultiplier: 1,
            elapsedMs: built.totalMs
        )
        let liveValue = RoutePlaybackAccessibility.mapValue(frame: liveFrame, connection: .live)
        XCTAssertTrue(liveValue.contains("2"))
        XCTAssertTrue(liveValue.contains("44"))

        let offlineValue = RoutePlaybackAccessibility.mapValue(frame: liveFrame, connection: .offline)
        XCTAssertTrue(offlineValue.contains(RoutePlaybackFreshness.note(for: .offline)))
    }
}

// MARK: - Telemetry spy

private struct RoutePlaybackScenario {
    let connection: RoutePlaybackConnection
    let phase: RoutePlaybackLoadPhase
    let rows: [RoutePlaybackPointRow]?
}

private final class SpyRoutePlaybackTelemetry: RoutePlaybackTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock(); defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock(); storage.append(surface); lock.unlock()
    }
}
