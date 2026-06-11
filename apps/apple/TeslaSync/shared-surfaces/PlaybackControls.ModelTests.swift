//
//  PlaybackControls.ModelTests.swift
//  TeslaSync — P4 shared surface · 0096 · PlaybackControls (Apple)
//
//  The state-holder coverage, split from PlaybackControls.Tests.swift for the lint length budget:
//  projection adoption + push, once-only `view.opened`, safe stop, refresh delegation, the stale
//  one-shot auto-refresh (offline never), every transport intent → host callback (play / pause /
//  toggle / stop / seek + the seek-by-seconds + speed-relative fallbacks + step-frame no-op), the
//  keyboard `perform` dispatch + toast, and the shortcut-registry register / unregister lifecycle
//  (the `useShortcut` parity). Runs in the TeslaSync(/-macOS) XCTest targets with an identity resolver.
//

import SwiftUI
import XCTest
@testable import TeslaSync

private let resolve: PlaybackControlsResolve = { _, fallback in fallback }

private func contentInput(
    connection: PlaybackControlsConnection = .live,
    playing: Bool = true,
    shortcuts: Bool = false,
    progress: Double = 0.5,
    durationMs: Double? = 372_000
) -> PlaybackControlsInput {
    PlaybackControlsInput(
        isPlaying: playing,
        speed: .x10,
        progress: progress,
        elapsed: "3:06",
        total: "6:12",
        durationMs: durationMs,
        markers: [PlaybackControlsMarker(at: 0.41, kind: .regenPeak, label: "Regen", count: 3)],
        enableKeyboardShortcuts: shortcuts,
        connection: connection
    )
}

@MainActor
final class PlaybackControlsModelTests: XCTestCase {
    private func makeModel(
        initial: PlaybackControlsInput?,
        actions: PlaybackControlsActions = PlaybackControlsActions(),
        telemetry: PlaybackControlsTelemetry = SpyPlaybackControlsTelemetry(),
        registry: PlaybackControlsShortcutRegistry = InMemoryPlaybackControlsShortcutRegistry()
    ) -> (PlaybackControlsModel, InMemoryPlaybackControlsSource) {
        let source = InMemoryPlaybackControlsSource(initial: initial)
        let model = PlaybackControlsModel(
            source: source, actions: actions, telemetry: telemetry, registry: registry, strings: resolve
        )
        return (model, source)
    }

    func testStartProjectsInitialSnapshot() {
        let (model, _) = makeModel(initial: contentInput())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.resolved.speed, .x10)
    }

    func testPushAdoptsNewSnapshot() {
        let (model, source) = makeModel(initial: PlaybackControlsInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(contentInput())
        XCTAssertEqual(model.phase, .content)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyPlaybackControlsTelemetry()
        let (model, _) = makeModel(initial: contentInput(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["PlaybackControls"])
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

    func testTransportIntentsCallHostCallbacks() {
        let recorder = ActionRecorder()
        let (model, _) = makeModel(initial: contentInput(playing: true), actions: recorder.actions())
        model.start()
        model.play()
        model.pause()
        model.togglePlayPause() // playing → pause
        model.stopPlayback()
        model.seek(2) // clamps to 1
        XCTAssertEqual(recorder.playCount, 1)
        XCTAssertEqual(recorder.pauseCount, 2)
        XCTAssertEqual(recorder.stopCount, 1)
        XCTAssertEqual(recorder.seeks, [1])
    }

    func testSeekBySecondsFallsBackToSeekWhenNoHandler() {
        let recorder = ActionRecorder()
        let (model, _) = makeModel(
            initial: contentInput(progress: 0.5, durationMs: 10000), actions: recorder.actions()
        )
        model.start()
        model.seekBySeconds(5) // +5s of 10s = +0.5 → 1.0
        XCTAssertEqual(recorder.seeks, [1.0])
    }

    func testSeekByUsesHandlerWhenPresent() {
        let recorder = ActionRecorder()
        let (model, _) = makeModel(initial: contentInput(), actions: recorder.actions(optional: true))
        model.start()
        model.seekBySeconds(-10)
        XCTAssertEqual(recorder.seekBy, [-10])
        XCTAssertTrue(recorder.seeks.isEmpty)
    }

    func testSpeedIntents() {
        let recorder = ActionRecorder()
        let (model, _) = makeModel(initial: contentInput(), actions: recorder.actions())
        model.start()
        model.cycleSpeed() // x10 → x25
        model.cycleSpeedBackward() // x10 → x1
        model.speedRelative(1) // no handler → onSpeedChange(shifted +1) = x25
        XCTAssertEqual(recorder.speeds, [.x25, .x1, .x25])
    }

    func testSpeedRelativeUsesHandlerWhenPresent() {
        let recorder = ActionRecorder()
        let (model, _) = makeModel(initial: contentInput(), actions: recorder.actions(optional: true))
        model.start()
        model.speedRelative(-1)
        XCTAssertEqual(recorder.speedRel, [-1])
        XCTAssertTrue(recorder.speeds.isEmpty)
    }

    func testStepFrameNoOpWithoutHandler() {
        let recorder = ActionRecorder()
        let (model, _) = makeModel(initial: contentInput(), actions: recorder.actions())
        model.start()
        model.stepFrame(1)
        XCTAssertTrue(recorder.frames.isEmpty)
    }

    func testPerformIgnoredWhenShortcutsDisabled() {
        let recorder = ActionRecorder()
        let (model, _) = makeModel(
            initial: contentInput(playing: false, shortcuts: false), actions: recorder.actions()
        )
        model.start()
        model.perform(key: .space)
        XCTAssertEqual(recorder.playCount, 0)
        XCTAssertNil(model.toast)
    }

    func testPerformTogglesAndToastsWhenEnabled() {
        let recorder = ActionRecorder()
        let (model, _) = makeModel(
            initial: contentInput(playing: true, shortcuts: true), actions: recorder.actions()
        )
        model.start()
        model.perform(key: .space)
        XCTAssertEqual(recorder.pauseCount, 1)
        XCTAssertEqual(model.toast?.label, "Pause")
    }

    func testPerformDigitSeeksAndToastsPercent() {
        let recorder = ActionRecorder()
        let (model, _) = makeModel(initial: contentInput(shortcuts: true), actions: recorder.actions())
        model.start()
        model.perform(key: .digit(3))
        XCTAssertEqual(recorder.seeks, [0.3])
        XCTAssertEqual(model.toast?.label, "30%")
    }

    func testReservedKeyShowsNoToast() {
        let recorder = ActionRecorder()
        let (model, _) = makeModel(initial: contentInput(shortcuts: true), actions: recorder.actions())
        model.start()
        model.perform(key: .letterM)
        XCTAssertNil(model.toast)
    }

    func testShortcutRegistryLifecycle() {
        let registry = InMemoryPlaybackControlsShortcutRegistry()
        let (model, _) = makeModel(initial: contentInput(shortcuts: true), registry: registry)
        model.start()
        XCTAssertEqual(registry.registerCount, 1)
        XCTAssertEqual(registry.registered.count, 7)
        model.stop()
        XCTAssertEqual(registry.unregisterCount, 1)
    }

    func testShortcutRegistryNotUsedWhenDisabled() {
        let registry = InMemoryPlaybackControlsShortcutRegistry()
        let (model, _) = makeModel(initial: contentInput(shortcuts: false), registry: registry)
        model.start()
        XCTAssertEqual(registry.registerCount, 0)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces; lock-guarded to satisfy the `Sendable` telemetry seam.
private final class SpyPlaybackControlsTelemetry: PlaybackControlsTelemetry, @unchecked Sendable {
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

/// Records the host transport callbacks so the controlled-bar contract can be asserted.
@MainActor
private final class ActionRecorder {
    var playCount = 0
    var pauseCount = 0
    var stopCount = 0
    var speeds: [PlaybackControlsSpeed] = []
    var seeks: [Double] = []
    var seekBy: [Double] = []
    var speedRel: [Int] = []
    var frames: [Int] = []

    func actions(optional: Bool = false) -> PlaybackControlsActions {
        var built = PlaybackControlsActions(
            onPlay: { self.playCount += 1 },
            onPause: { self.pauseCount += 1 },
            onStop: { self.stopCount += 1 },
            onSpeedChange: { self.speeds.append($0) },
            onSeek: { self.seeks.append($0) }
        )
        if optional {
            built.onSeekBy = { self.seekBy.append($0) }
            built.onSpeedRelative = { self.speedRel.append($0) }
            built.onStepFrame = { self.frames.append($0) }
        }
        return built
    }
}
