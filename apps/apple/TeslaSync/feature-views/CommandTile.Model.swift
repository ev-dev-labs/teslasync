//
//  CommandTile.Model.swift
//  TeslaSync — P4 feature view · 0226 · CommandTile (Apple)
//
//  State-holder seams (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) for
//  the Vehicle-Commands tile — the SwiftUI parity of
//  features/system/components/CommandTile.tsx. The web component is fully controlled
//  by its parent: it calls `onExecute` / `onRequestDialog` / `onToggleFavorite` and
//  reads back `loading` / `lastStatus` / `isFavorite`. The native surface binds the
//  same parent contract through two seams — a command dispatcher (execute +
//  request-confirmation, reporting execution events back) and a favorite toggle — so
//  the view performs no I/O. The view binds through `CommandTileModel`.
//

import Foundation
import Observation
import OSLog

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Stable telemetry slug for the diagnostics `view.opened` event.
public enum CommandTileSurface {
    public static let slug = "CommandTile"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the diagnostics `view.opened` event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared
/// core diagnostics pipeline (consent-gated + redacted there).
public protocol CommandTileTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogCommandTileTelemetry: CommandTileTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Dispatch seam (P1/S8 — web `onExecute` + `onRequestDialog`)

/// An update from the command dispatcher about the in-flight send, mirroring the web
/// parent's `loading` / `lastStatus` props collapsed into a stream the tile observes,
/// plus the transport-failure `offline` the native app surfaces behind a chip.
public enum CommandExecutionEvent: Sendable, Equatable {
    case started
    case succeeded(detail: String?)
    case failed(detail: String?)
    case offline(detail: String?)
}

/// The seam the model dispatches activation through (web `onExecute(command, params)`
/// and `onRequestDialog(def)`). The production app implements it over the shared P1/S8
/// command bus; previews and tests inject `InMemoryCommandDispatcher`. The dispatcher
/// reports progress back through `onExecutionEvent`. No I/O lives in the view.
@MainActor
public protocol CommandDispatching: AnyObject {
    var onExecutionEvent: (@MainActor (CommandExecutionEvent) -> Void)? { get set }
    /// Runs a non-dangerous command (web `onExecute`).
    func execute(command: String, parameters: CommandParameters?)
    /// Hands a dangerous command to the parent's confirmation flow (web `onRequestDialog`).
    func requestConfirmation(for def: CommandTileDef)
}

// MARK: - Favorite seam (P1/S8 — web `onToggleFavorite` + `isFavorite`)

/// The seam the model toggles the favorite through (web `onToggleFavorite()`). The
/// production app implements it over the shared P1/S8 favorites holder, which is the
/// source of truth and confirms the new value via `onFavoriteChanged`; previews and
/// tests inject `InMemoryFavoriteToggle`.
@MainActor
public protocol CommandFavoriteToggling: AnyObject {
    var onFavoriteChanged: (@MainActor (Bool) -> Void)? { get set }
    func toggle(commandID: String)
}

// MARK: - View model

/// The surface's observable view-model. Owns the execution lifecycle (web `loading`),
/// the last-outcome projection (web `lastStatus`), the favorite state (web
/// `isFavorite`), and the freshness (stale / offline) layered on top so SwiftUI can
/// render every state. No networking lives here — progress arrives through the seams.
@MainActor
@Observable
public final class CommandTileModel {
    /// The command this tile renders (web `props.def`).
    public let def: CommandTileDef

    public private(set) var isExecuting = false
    public private(set) var outcome: CommandTileOutcome?
    public private(set) var isFavorite: Bool
    public private(set) var isOffline = false
    public private(set) var lastOutcomeAt: Date?

    @ObservationIgnored private let dispatcher: any CommandDispatching
    @ObservationIgnored private let favorites: any CommandFavoriteToggling
    @ObservationIgnored private let telemetry: any CommandTileTelemetry
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private let stalenessWindow: TimeInterval
    @ObservationIgnored private var didStart = false

    public init(
        def: CommandTileDef,
        isFavorite: Bool = false,
        lastStatus: String? = nil,
        dispatcher: any CommandDispatching,
        favorites: any CommandFavoriteToggling,
        telemetry: any CommandTileTelemetry = OSLogCommandTileTelemetry(),
        now: @escaping @Sendable () -> Date = { Date() },
        stalenessWindow: TimeInterval = 120
    ) {
        self.def = def
        self.isFavorite = isFavorite
        outcome = CommandTileOutcome.parse(lastStatus)
        self.dispatcher = dispatcher
        self.favorites = favorites
        self.telemetry = telemetry
        self.now = now
        self.stalenessWindow = stalenessWindow
        if outcome != nil { lastOutcomeAt = now() }
        dispatcher.onExecutionEvent = { [weak self] event in self?.applyExecution(event) }
        favorites.onFavoriteChanged = { [weak self] value in self?.applyFavorite(value) }
    }

    // MARK: Derived projections

    /// What the icon/status region shows (web `loading ? spinner : icon` + status).
    public var phase: CommandTilePhase {
        CommandTilePhase.project(isExecuting: isExecuting, outcome: outcome)
    }

    /// Whether the last outcome is older than the freshness window. Only a settled,
    /// online outcome can go stale; the resting idle tile never does.
    public var isStale: Bool {
        guard !isOffline, outcome != nil, let lastOutcomeAt else { return false }
        return now().timeIntervalSince(lastOutcomeAt) > stalenessWindow
    }

    /// Freshness/connectivity projection (mirrors `LiveConnectionState`, ADR-013).
    public var connection: CommandTileConnection {
        if isOffline { return .offline }
        if isStale { return .stale }
        return .live
    }

    /// Whether a tap activates the tile (web only blocks on `loading`; the native tile
    /// additionally blocks offline since a command send is a network action).
    public var isInteractive: Bool {
        !isExecuting && !isOffline
    }

    // MARK: Lifecycle

    /// Emits the diagnostics `view.opened` event once (web effect on mount). Idempotent.
    public func start() {
        guard !didStart else { return }
        didStart = true
        telemetry.viewOpened(surface: CommandTileSurface.slug)
    }

    // MARK: Intents (web `handleClick` / favorite `onClick`)

    /// Activates the tile (web `handleClick`): no-op while executing/offline; dangerous
    /// commands are handed to the confirmation seam (web `onRequestDialog`); everything
    /// else is dispatched (web `onExecute`) and the tile enters its executing state.
    public func activate() {
        guard isInteractive else { return }
        if def.isDangerous {
            dispatcher.requestConfirmation(for: def)
            return
        }
        isExecuting = true
        outcome = nil
        dispatcher.execute(command: def.command, parameters: def.parameters)
    }

    /// Toggles the favorite (web `onToggleFavorite`). Optimistic locally; the seam is
    /// the source of truth and confirms through `onFavoriteChanged`.
    public func toggleFavorite() {
        isFavorite.toggle()
        favorites.toggle(commandID: def.id)
    }

    // MARK: Seam handlers

    private func applyExecution(_ event: CommandExecutionEvent) {
        switch event {
        case .started:
            isExecuting = true
            isOffline = false
        case let .succeeded(detail):
            isExecuting = false
            isOffline = false
            outcome = .succeeded(detail: detail)
            lastOutcomeAt = now()
        case let .failed(detail):
            isExecuting = false
            isOffline = false
            outcome = .failed(detail: detail)
            lastOutcomeAt = now()
        case .offline:
            // Keep the last outcome cached behind the offline chip; the command could
            // not be sent, so drop the in-flight executing state.
            isExecuting = false
            isOffline = true
            lastOutcomeAt = now()
        }
    }

    private func applyFavorite(_ value: Bool) {
        isFavorite = value
    }
}

// MARK: - In-memory seams (previews + tests; the view never performs I/O)

/// Deterministic command dispatcher for previews and unit/UI tests. Records every
/// execute / confirmation call and can emit an optional canned execution event on
/// `execute` (when `autoEmits`), or be driven manually via `push(_:)`.
@MainActor
public final class InMemoryCommandDispatcher: CommandDispatching {
    public var onExecutionEvent: (@MainActor (CommandExecutionEvent) -> Void)?
    public private(set) var executeCount = 0
    public private(set) var lastCommand: String?
    public private(set) var lastParameters: CommandParameters?
    public private(set) var confirmationCount = 0
    public private(set) var lastConfirmationID: String?

    private let event: CommandExecutionEvent?
    private let autoEmits: Bool

    public init(event: CommandExecutionEvent? = nil, autoEmits: Bool = true) {
        self.event = event
        self.autoEmits = autoEmits
    }

    public func execute(command: String, parameters: CommandParameters?) {
        executeCount += 1
        lastCommand = command
        lastParameters = parameters
        if autoEmits, let event {
            onExecutionEvent?(event)
        }
    }

    public func requestConfirmation(for def: CommandTileDef) {
        confirmationCount += 1
        lastConfirmationID = def.id
    }

    /// Delivers an execution event to the bound model (deterministic test affordance).
    public func push(_ event: CommandExecutionEvent) {
        onExecutionEvent?(event)
    }
}

/// Deterministic favorite toggle for previews and unit/UI tests. Flips an internal
/// value on `toggle` and confirms it back through `onFavoriteChanged` (when
/// `autoConfirms`), or is driven manually via `confirm(_:)`.
@MainActor
public final class InMemoryFavoriteToggle: CommandFavoriteToggling {
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

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "CommandTile" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time. The web source key
/// (`commands.toggleFavorite`) is preserved verbatim so a shared catalog resolves
/// identically across web and native.
public enum CommandTileStrings {
    public static let table = "CommandTile"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
