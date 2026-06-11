//
//  PlaybackControls.Seams.swift
//  TeslaSync — P4 shared surface · 0096 · PlaybackControls (Apple)
//
//  The dependency seams the bar's state-holder binds through (P1/S8), kept apart from the store for
//  the lint length budget:
//    • `PlaybackControlsSource` — the snapshot feed. The web `PlaybackControls` owns no data (the
//      props are pushed by the parent every render); the live source reproduces that by holding the
//      host's current snapshot and re-emitting it on `update(_:)` / `start` / `refresh`.
//    • `PlaybackControlsShortcutRegistry` — the native parity of the web `useShortcut(defs)` hook: the
//      model registers the route-scoped replay cheatsheet on appear (when keyboard shortcuts are on)
//      and unregisters on disappear, so the host's global shortcuts overlay can list them. The default
//      is a no-op; the in-memory double records the calls for the unit test.
//
//  Both feeds are local + synchronous (no HTTP), matching the web source.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the host's snapshot
/// (`LivePlaybackControlsSource`); previews + tests use `InMemoryPlaybackControlsSource`. The view
/// never reads the host's playback state directly.
@MainActor
public protocol PlaybackControlsSource: AnyObject {
    var onUpdate: (@MainActor (PlaybackControlsInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Live source (production — holds the host's snapshot)

/// The production source. Holds the host's current snapshot (the playback state the page owns) and
/// re-emits it whenever the host updates it — the native bridge between the web controlled props and
/// the surface's snapshot contract.
@MainActor
public final class LivePlaybackControlsSource: PlaybackControlsSource {
    public var onUpdate: (@MainActor (PlaybackControlsInput) -> Void)?

    private var snapshot: PlaybackControlsInput

    public init(snapshot: PlaybackControlsInput) {
        self.snapshot = snapshot
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    /// Sets the host's current snapshot and re-emits it — the parity of the web props changing and the
    /// controlled bar re-rendering.
    public func update(_ snapshot: PlaybackControlsInput) {
        self.snapshot = snapshot
        emit()
    }

    private func emit() {
        onUpdate?(snapshot)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit / UI tests. Emits an optional initial snapshot on `start()`
/// and lets a test push further snapshots via `push(_:)`. The call counters let the wiring +
/// delegation be asserted without a host.
@MainActor
public final class InMemoryPlaybackControlsSource: PlaybackControlsSource {
    public var onUpdate: (@MainActor (PlaybackControlsInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: PlaybackControlsInput?

    public init(initial: PlaybackControlsInput? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ input: PlaybackControlsInput) {
        onUpdate?(input)
    }
}

// MARK: - Shortcut registry seam (web `useShortcut`)

/// The native parity of the web `useShortcut(defs)` hook. The model registers the route-scoped replay
/// cheatsheet when the surface appears with keyboard shortcuts enabled, and unregisters when it
/// disappears, so the host's global "keyboard shortcuts" overlay can list them. Kept behind a seam so
/// the view never touches a global registry directly.
@MainActor
public protocol PlaybackControlsShortcutRegistry: AnyObject {
    func register(_ shortcuts: [PlaybackControlsShortcut])
    func unregister()
}

/// The production default — a no-op (the host injects the real registry adapter). Registration is a
/// best-effort affordance for the global overlay, never required for the in-view shortcuts to work.
@MainActor
public final class NoopPlaybackControlsShortcutRegistry: PlaybackControlsShortcutRegistry {
    public init() {}
    public func register(_: [PlaybackControlsShortcut]) {}
    public func unregister() {}
}

/// In-memory registry double for tests — records the last registered set + the register / unregister
/// call counts so the `useShortcut` lifecycle parity can be asserted.
@MainActor
public final class InMemoryPlaybackControlsShortcutRegistry: PlaybackControlsShortcutRegistry {
    public private(set) var registered: [PlaybackControlsShortcut] = []
    public private(set) var registerCount = 0
    public private(set) var unregisterCount = 0

    public init() {}

    public func register(_ shortcuts: [PlaybackControlsShortcut]) {
        registered = shortcuts
        registerCount += 1
    }

    public func unregister() {
        registered = []
        unregisterCount += 1
    }
}
