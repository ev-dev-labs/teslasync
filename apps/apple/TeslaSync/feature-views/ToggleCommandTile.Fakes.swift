//
//  ToggleCommandTile.Fakes.swift
//  TeslaSync — P4 feature view · 0260 · ToggleCommandTile (Apple)
//
//  Deterministic in-memory seam implementations for the ToggleCommandTile surface,
//  shared by the #if DEBUG previews and the XCTest suite. They let the previews and tests
//  drive the surface without any network or real store (the view itself never performs
//  I/O — it binds the P1/S8 protocols in ToggleCommandTile.Model.swift). The production
//  app injects the facade-backed command bus / live-signal holder / favorites holder
//  instead.
//

import Foundation

// MARK: - Dispatch seam (web `onExecute` + `onRequestDialog`)

/// Deterministic command dispatcher for previews and unit/UI tests. Records every
/// execute / request-dialog call and can emit an optional canned execution event on
/// `execute` (when `autoEmits`), or be driven manually via `push(_:)`.
@MainActor
public final class InMemoryToggleCommandDispatcher: ToggleCommandDispatching {
    public var onExecutionEvent: (@MainActor (ToggleCommandEvent) -> Void)?
    public private(set) var executeCount = 0
    public private(set) var lastCommand: String?
    public private(set) var lastParameters: ToggleCommandParameters?
    public private(set) var dialogCount = 0
    public private(set) var lastDialogID: String?

    private let event: ToggleCommandEvent?
    private let autoEmits: Bool

    public init(event: ToggleCommandEvent? = nil, autoEmits: Bool = true) {
        self.event = event
        self.autoEmits = autoEmits
    }

    public func execute(command: String, parameters: ToggleCommandParameters?) {
        executeCount += 1
        lastCommand = command
        lastParameters = parameters
        if autoEmits, let event {
            onExecutionEvent?(event)
        }
    }

    public func requestDialog(for def: ToggleCommandTileDef) {
        dialogCount += 1
        lastDialogID = def.id
    }

    /// Delivers an execution event to the bound model (deterministic test affordance).
    public func push(_ event: ToggleCommandEvent) {
        onExecutionEvent?(event)
    }
}

// MARK: - Bound toggle-state seam (web `state[def.stateField]`)

/// Deterministic bound toggle-state source for previews and unit/UI tests. Replays an
/// optional initial value on `start` and can push later live updates via `push(_:)`.
@MainActor
public final class InMemoryToggleStateSource: ToggleStateObserving {
    public var onToggleStateChanged: (@MainActor (Bool?) -> Void)?
    public private(set) var startCount = 0

    private let initial: Bool?

    public init(initial: Bool? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        onToggleStateChanged?(initial)
    }

    /// Delivers a live bound-state value to the model (web parent `state` update).
    public func push(_ value: Bool?) {
        onToggleStateChanged?(value)
    }
}

// MARK: - Favorite seam (web `onToggleFavorite` + `isFavorite`)

/// Deterministic favorite toggle for previews and unit/UI tests. Flips an internal value
/// on `toggle` and confirms it back through `onFavoriteChanged` (when `autoConfirms`), or
/// is driven manually via `confirm(_:)`.
@MainActor
public final class InMemoryToggleFavoriteToggle: ToggleCommandFavoriteToggling {
    public var onFavoriteChanged: (@MainActor (Bool) -> Void)?
    public private(set) var toggleCount = 0
    public private(set) var lastCommandID: String?
    public private(set) var value: Bool

    private let autoConfirms: Bool

    public init(initial: Bool = false, autoConfirms: Bool = true) {
        value = initial
        self.autoConfirms = autoConfirms
    }

    public func toggle(commandID: String) {
        toggleCount += 1
        lastCommandID = commandID
        value.toggle()
        if autoConfirms {
            onFavoriteChanged?(value)
        }
    }

    /// Delivers an authoritative favorite value to the bound model (test affordance).
    public func confirm(_ value: Bool) {
        self.value = value
        onFavoriteChanged?(value)
    }
}
