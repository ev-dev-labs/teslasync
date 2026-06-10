//
//  StateTimeline.Source.swift
//  TeslaSync — P4 feature view · 0235 · StateTimeline (Apple)
//
//  The P1/S8 state-holder seam for the FSM transition timeline: the coalesced update
//  envelope (the pre-windowed transitions + window + anchor + the most-recent
//  transition + the wider preset + the selection + freshness), the action
//  capabilities (web optional `onWidenWindow` / `onJumpToLast`), the
//  `StateTimelineSource` protocol the view-model binds through, and the in-memory
//  implementation previews + tests drive. The production app implements the protocol
//  over the shared FSM-debugger state holders (the windowed `useFSMTransitions`
//  result from `windowTransitions.ts`, plus the toolbar's widen / freeze intents);
//  the view never talks to the network.
//

import Foundation

// MARK: - Action capabilities (web optional callbacks)

/// Which empty-state actions the parent debugger supplies (web optional
/// `onWidenWindow` / `onJumpToLast` props). A button renders only when its capability
/// is enabled AND its data exists (web `showWiden = widerPreset != null &&
/// onWidenWindow != null`, `showJump = lastTransition != null && onJumpToLast != null`).
/// Defaults match the real debugger toolbar, which supplies both intents.
public struct StateTimelineCapabilities: Sendable, Equatable {
    /// Web `onWidenWindow != null` — gates the "Widen window to …" primary button.
    public var widenWindow: Bool
    /// Web `onJumpToLast != null` — gates the "Jump to last transition" ghost button.
    public var jumpToLast: Bool

    public init(widenWindow: Bool = true, jumpToLast: Bool = true) {
        self.widenWindow = widenWindow
        self.jumpToLast = jumpToLast
    }
}

// MARK: - Source snapshot

/// One coalesced timeline snapshot pushed by a `StateTimelineSource`: the pre-windowed
/// transitions + the `fsmType` (state-color resolution) + the window length + an
/// optional fixed `anchor` (web `anchor ?? now`) + the most-recent transition (the
/// empty-state hint) + the smallest wider preset that would surface it + the current
/// selection + the action capabilities + the load status / freshness / last-update.
public struct StateTimelineUpdate: Sendable, Equatable {
    public var status: StateTimelineLoadStatus
    public var transitions: [StateTransitionInput]
    public var fsmType: String
    public var windowMinutes: Int
    /// Optional fixed end-time anchor (web `anchor`); `nil` ⇒ the model uses live "now".
    public var anchor: Date?
    /// The most-recent transition in or outside the window (web `lastTransition`).
    public var lastTransition: StateTransitionInput?
    /// The smallest dropdown preset (minutes) that would include `lastTransition`
    /// (web `widerPreset`); `nil` ⇒ no preset within 24 h fits.
    public var widerPreset: Int?
    /// The currently selected transition id (web `selectedId`); `nil` ⇒ none.
    public var selectedID: Int?
    public var capabilities: StateTimelineCapabilities
    public var connection: StateTimelineConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: StateTimelineLoadStatus = .loading,
        transitions: [StateTransitionInput] = [],
        fsmType: String = "vehicle",
        windowMinutes: Int = 10,
        anchor: Date? = nil,
        lastTransition: StateTransitionInput? = nil,
        widerPreset: Int? = nil,
        selectedID: Int? = nil,
        capabilities: StateTimelineCapabilities = StateTimelineCapabilities(),
        connection: StateTimelineConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.transitions = transitions
        self.fsmType = fsmType
        self.windowMinutes = windowMinutes
        self.anchor = anchor
        self.lastTransition = lastTransition
        self.widerPreset = widerPreset
        self.selectedID = selectedID
        self.capabilities = capabilities
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared FSM-debugger state holders — the windowed transition query plus the
/// selection (web `onSelect`), the widen-window (web `onWidenWindow`), and the
/// jump-to-last (web `onJumpToLast`) intents. Previews + tests use
/// `InMemoryStateTimelineSource`. The view never talks to the network directly.
@MainActor
public protocol StateTimelineSource: AnyObject {
    /// Pushes a coalesced timeline snapshot (status + transitions + window + freshness).
    var onUpdate: (@MainActor (StateTimelineUpdate) -> Void)? { get set }

    func start()
    func stop()
    /// Re-runs the underlying transition query (web refetch / the stale auto-refresh).
    func refresh()
    /// Selects a transition (web `onSelect(transition)`); the parent owns `selectedId`.
    func select(_ transitionID: Int)
    /// Snaps the toolbar window to `widerPreset` (web `onWidenWindow`).
    func widenWindow()
    /// Switches to freeze mode + selects the last transition (web `onJumpToLast`).
    func jumpToLast()
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()`, records the selection / widen / jump intents, and lets a test push
/// further snapshots via `push(_:)`.
@MainActor
public final class InMemoryStateTimelineSource: StateTimelineSource {
    public var onUpdate: (@MainActor (StateTimelineUpdate) -> Void)?

    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var widenCount = 0
    public private(set) var jumpCount = 0
    public private(set) var lastSelectedID: Int?

    private let initial: StateTimelineUpdate?

    public init(initial: StateTimelineUpdate? = nil) {
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

    public func select(_ transitionID: Int) {
        lastSelectedID = transitionID
    }

    public func widenWindow() {
        widenCount += 1
    }

    public func jumpToLast() {
        jumpCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: StateTimelineUpdate) {
        onUpdate?(update)
    }
}
