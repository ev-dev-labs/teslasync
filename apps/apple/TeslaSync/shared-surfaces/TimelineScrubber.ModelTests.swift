//
//  TimelineScrubber.ModelTests.swift
//  TeslaSync — P4 shared surface · 0107 · TimelineScrubber (Apple)
//
//  The state-holder + source-seam coverage, split from TimelineScrubber.Tests.swift: the in-memory /
//  live source counters + re-emit, projection adoption + push, once-only `view.opened`, safe stop,
//  refresh delegation, the stale one-shot auto-refresh (offline never), and the seek funnel clamping
//  + delegating to the host `onSeek`. Runs in the TeslaSync(/-macOS) XCTest targets with no network.
//

import SwiftUI
import XCTest
@testable import TeslaSync

private func contentInput(
    connection: TimelineScrubberConnection = .live,
    progress: Double = 0.5,
    durationSeconds: Double = 372
) -> TimelineScrubberInput {
    TimelineScrubberInput(
        progress: progress,
        buffered: 0.6,
        durationSeconds: durationSeconds,
        markers: [TimelineScrubberMarker(at: 0.41, kind: .regenPeak, label: "Regen", count: 3)],
        connection: connection
    )
}

// MARK: - Source

@MainActor
final class TimelineScrubberSourceTests: XCTestCase {
    func testInMemoryStartEmitsInitialAndCounts() {
        let source = InMemoryTimelineScrubberSource(initial: contentInput())
        var received: TimelineScrubberInput?
        source.onUpdate = { received = $0 }
        source.start()
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(received?.durationSeconds, 372)
    }

    func testInMemoryStopRefreshCounters() {
        let source = InMemoryTimelineScrubberSource()
        source.stop()
        source.refresh()
        source.refresh()
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testLiveSourceUpdateReemits() {
        let source = LiveTimelineScrubberSource(snapshot: TimelineScrubberInput(isLoading: true))
        var received: TimelineScrubberInput?
        source.onUpdate = { received = $0 }
        source.start()
        XCTAssertEqual(received?.isLoading, true)
        source.update(contentInput())
        XCTAssertEqual(received?.durationSeconds, 372)
    }
}

// MARK: - Model

@MainActor
final class TimelineScrubberModelTests: XCTestCase {
    private func makeModel(
        initial: TimelineScrubberInput?,
        actions: TimelineScrubberActions = TimelineScrubberActions(),
        telemetry: TimelineScrubberTelemetry = SpyTimelineScrubberTelemetry()
    ) -> (TimelineScrubberModel, InMemoryTimelineScrubberSource) {
        let source = InMemoryTimelineScrubberSource(initial: initial)
        let model = TimelineScrubberModel(source: source, actions: actions, telemetry: telemetry)
        return (model, source)
    }

    func testStartProjectsInitialSnapshot() {
        let (model, _) = makeModel(initial: contentInput())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.resolved.progressPercent, 50)
    }

    func testPushAdoptsNewSnapshot() {
        let (model, source) = makeModel(initial: TimelineScrubberInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(contentInput())
        XCTAssertEqual(model.phase, .content)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyTimelineScrubberTelemetry()
        let (model, _) = makeModel(initial: contentInput(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["TimelineScrubber"])
    }

    func testStopIsSafe() {
        let (model, source) = makeModel(initial: contentInput())
        model.start()
        model.stop()
        model.stop()
        XCTAssertEqual(source.stopCount, 2)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(initial: contentInput())
        model.start()
        let before = source.refreshCount
        model.refresh()
        XCTAssertEqual(source.refreshCount, before + 1)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(initial: contentInput())
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(contentInput(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(contentInput(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(contentInput(connection: .live))
        source.push(contentInput(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineNeverAutoRefreshes() {
        let (model, source) = makeModel(initial: contentInput())
        model.start()
        source.push(contentInput(connection: .offline))
        XCTAssertEqual(source.refreshCount, 0)
        XCTAssertEqual(model.connection, .offline)
    }

    func testSeekClampsAndDelegatesToHost() {
        let recorder = ActionRecorder()
        let (model, _) = makeModel(initial: contentInput(), actions: recorder.actions())
        model.start()
        model.seek(0.42)
        model.seek(2) // clamps to 1
        model.seek(-1) // clamps to 0
        XCTAssertEqual(recorder.seeks, [0.42, 1, 0])
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces; lock-guarded to satisfy the `Sendable` telemetry seam.
private final class SpyTimelineScrubberTelemetry: TimelineScrubberTelemetry, @unchecked Sendable {
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

/// Records the host seek callback so the controlled-track contract can be asserted.
@MainActor
private final class ActionRecorder {
    var seeks: [Double] = []

    func actions() -> TimelineScrubberActions {
        TimelineScrubberActions(onSeek: { self.seeks.append($0) })
    }
}
