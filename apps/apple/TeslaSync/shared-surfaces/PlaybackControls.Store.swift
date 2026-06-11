//
//  PlaybackControls.Store.swift
//  TeslaSync — P4 shared surface · 0096 · PlaybackControls (Apple)
//
//  The surface's `@Observable` state-holder (P1/S8) — split from the contracts for the lint length
//  budget. It subscribes to a `PlaybackControlsSource`, projects each snapshot to the resolved
//  view-state, exposes the transient shortcut `toast` + the `cheatsheet`, emits `view.opened` exactly
//  once on first appear (P1/S11), auto-refreshes once on the stale transition, and registers /
//  unregisters the replay cheatsheet with the host's shortcut overlay (the `useShortcut` parity).
//
//  All transport intents (button taps, scrubber seeks, keyboard) funnel through here onto the host's
//  `PlaybackControlsActions` callbacks — the bar is controlled, exactly like the web source: it never
//  mutates playback state locally, it asks the host to and re-renders from the next snapshot.
//

import Foundation
import Observation

@MainActor
@Observable
public final class PlaybackControlsModel {
    public private(set) var resolved: PlaybackControlsResolved
    public private(set) var connection: PlaybackControlsConnection = .live
    /// The transient inline shortcut feedback (web `ShortcutToast`); `nil` when nothing is showing.
    public private(set) var toast: PlaybackControlsToast?
    /// The localized replay cheatsheet (web help tooltip rows + `useShortcut` defs).
    public private(set) var cheatsheet: [PlaybackControlsShortcut] = []

    public var phase: PlaybackControlsResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any PlaybackControlsSource
    @ObservationIgnored private let actions: PlaybackControlsActions
    @ObservationIgnored private let telemetry: any PlaybackControlsTelemetry
    @ObservationIgnored private let registry: any PlaybackControlsShortcutRegistry
    @ObservationIgnored let strings: PlaybackControlsResolve

    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefreshForStale = false
    @ObservationIgnored private var didRegister = false
    @ObservationIgnored private var toastCounter = 0
    @ObservationIgnored private var toastTask: Task<Void, Never>?

    public init(
        source: any PlaybackControlsSource,
        actions: PlaybackControlsActions = PlaybackControlsActions(),
        telemetry: any PlaybackControlsTelemetry = OSLogPlaybackControlsTelemetry(),
        registry: any PlaybackControlsShortcutRegistry = NoopPlaybackControlsShortcutRegistry(),
        strings: @escaping PlaybackControlsResolve = PlaybackControlsStrings.string
    ) {
        self.source = source
        self.actions = actions
        self.telemetry = telemetry
        self.registry = registry
        self.strings = strings
        resolved = PlaybackControlsResolved.chrome(phase: .loading)
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    // MARK: - Lifecycle

    /// Begins observing, emits `view.opened` once, and registers the cheatsheet when enabled.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: PlaybackControlsMeta.surfaceSlug)
        }
        source.start()
        reconcileRegistration()
    }

    /// Stops observing, unregisters the cheatsheet, and cancels any pending toast.
    public func stop() {
        started = false
        source.stop()
        reconcileRegistration()
        toastTask?.cancel()
        toastTask = nil
    }

    /// Re-requests the host snapshot (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: PlaybackControlsInput) {
        connection = input.connection
        resolved = PlaybackControlsProjection.resolve(input, strings: strings)
        cheatsheet = PlaybackControlsKeyboard.cheatsheet(
            enabled: input.enableKeyboardShortcuts,
            strings: strings
        )
        handleAutoRefresh(for: input.connection)
        reconcileRegistration()
    }

    /// Stale → one guarded refresh on the transition; reset once live so a later stale episode
    /// re-triggers exactly once. Offline never auto-refreshes (cached content stays shown).
    private func handleAutoRefresh(for connection: PlaybackControlsConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }

    /// Registers once when shortcuts become enabled while started; unregisters once otherwise — the
    /// register-on-mount / cleanup-on-unmount parity of the web `useShortcut`.
    private func reconcileRegistration() {
        let shouldRegister = started && resolved.enableKeyboardShortcuts
        if shouldRegister, !didRegister {
            registry.register(cheatsheet)
            didRegister = true
        } else if !shouldRegister, didRegister {
            registry.unregister()
            didRegister = false
        }
    }

    // MARK: - Transport intents (web `onPlay / onPause / onStop / onSpeedChange / onSeek`)

    public func play() {
        actions.onPlay()
    }

    public func pause() {
        actions.onPause()
    }

    /// Toggles using the CURRENT state — the web button `onClick={isPlaying ? onPause : onPlay}`.
    public func togglePlayPause() {
        if resolved.isPlaying { actions.onPause() } else { actions.onPlay() }
    }

    /// Both the Reset and Stop buttons map to the host `onStop` (web parity).
    public func stopPlayback() {
        actions.onStop()
    }

    public func setSpeed(_ speed: PlaybackControlsSpeed) {
        actions.onSpeedChange(speed)
    }

    /// Left-click / tap on the speed control cycles to the next speed (web `nextSpeed`).
    public func cycleSpeed() {
        actions.onSpeedChange(resolved.speed.next)
    }

    /// Right-click / long-press steps back one slot (web `onContextMenu` → `shiftSpeed(-1)`).
    public func cycleSpeedBackward() {
        actions.onSpeedChange(resolved.speed.shifted(by: -1))
    }

    /// Steps the speed by `delta` slots — the keyboard `+/−` path (web `onSpeedRelative` fallback).
    public func speedRelative(_ delta: Int) {
        if let handler = actions.onSpeedRelative {
            handler(delta)
        } else {
            actions.onSpeedChange(resolved.speed.shifted(by: delta))
        }
    }

    public func seek(_ progress: Double) {
        actions.onSeek(max(0, min(1, progress)))
    }

    /// Seeks by `delta` seconds — the keyboard skip path. Uses `onSeekBy` when supplied, else falls
    /// back to `onSeek` driven by `durationMs` (the web `seekBySeconds` fallback).
    public func seekBySeconds(_ delta: Double) {
        if let handler = actions.onSeekBy {
            handler(delta)
        } else if let durationMs = resolved.durationMs, durationMs > 0 {
            let next = max(0, min(1, resolved.progress + (delta * 1000) / durationMs))
            actions.onSeek(next)
        }
    }

    /// Steps the playhead by `delta` frames (web `onStepFrame`; no-op when the host omits the hook).
    public func stepFrame(_ delta: Int) {
        actions.onStepFrame?(delta)
    }

    // MARK: - Keyboard (web `window.keydown` handler)

    /// Resolves a decoded key to its intent, dispatches it, and shows the matching toast — the parity
    /// of the web keydown switch. Ignored when keyboard shortcuts are disabled.
    public func perform(key: PlaybackControlsKey, shift: Bool = false) {
        guard resolved.enableKeyboardShortcuts else { return }
        guard let command = PlaybackControlsKeyboard.command(for: key, shift: shift) else { return }
        let label = PlaybackControlsKeyboard.toastLabel(
            for: key,
            shift: shift,
            isPlaying: resolved.isPlaying,
            strings: strings
        )
        dispatch(command)
        if let label { showToast(label) }
    }

    private func dispatch(_ command: PlaybackControlsCommand) {
        switch command {
        case .togglePlay: togglePlayPause()
        case let .seekBySeconds(delta): seekBySeconds(delta)
        case let .stepFrame(delta): stepFrame(delta)
        case let .seekToProgress(progress): seek(progress)
        case let .speedRelative(delta): speedRelative(delta)
        case .reserved: break
        }
    }

    // MARK: - Toast

    private func showToast(_ label: String) {
        toastCounter += 1
        toast = PlaybackControlsToast(id: toastCounter, label: label)
        toastTask?.cancel()
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(PlaybackControlsMeta.toastDurationMs))
            guard !Task.isCancelled else { return }
            self?.toast = nil
        }
    }
}
