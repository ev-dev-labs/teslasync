//
//  ToggleCommandTile.Model.swift
//  TeslaSync — P4 feature view · 0260 · ToggleCommandTile (Apple)
//
//  State-holder seams (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) for the
//  Vehicle-Commands toggle tile — the SwiftUI parity of
//  features/system/components/ToggleCommandTile.tsx. The web component is fully
//  controlled by its parent: it reads `state` (the live vehicle-state booleans) to
//  derive `isOn`, falls back to a local optimistic toggle when the command has no
//  `stateField`, and calls `onExecute` (on-command / off-command) / `onRequestDialog`
//  (input-gated turn-on) / `onToggleFavorite`, reading back `loading` / `lastStatus` /
//  `isFavorite`. The native surface binds the same parent contract through three seams —
//  a command dispatcher (execute + request-dialog, reporting execution events back), a
//  bound toggle-state observer, and a favorite toggle — so the view performs no I/O. The
//  view binds through `ToggleCommandTileModel`.
//

import Foundation
import Observation
import OSLog

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Stable telemetry slug for the diagnostics `view.opened` event.
public enum ToggleCommandTileSurface {
    public static let slug = "ToggleCommandTile"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the diagnostics `view.opened` event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared core
/// diagnostics pipeline (consent-gated + redacted there).
public protocol ToggleCommandTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogToggleCommandTelemetry: ToggleCommandTelemetry {
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
public enum ToggleCommandEvent: Sendable, Equatable {
    case started
    case succeeded(detail: String?)
    case failed(detail: String?)
    case offline(detail: String?)
}

/// The seam the model dispatches activation through (web `onExecute(command, params)`
/// and `onRequestDialog(def)`). The production app implements it over the shared P1/S8
/// command bus; previews and tests inject `InMemoryToggleCommandDispatcher`. The
/// dispatcher reports progress back through `onExecutionEvent`. No I/O lives in the view.
@MainActor
public protocol ToggleCommandDispatching: AnyObject {
    var onExecutionEvent: (@MainActor (ToggleCommandEvent) -> Void)? { get set }
    /// Runs the on- or off-command (web `onExecute`). The off-command carries no params.
    func execute(command: String, parameters: ToggleCommandParameters?)
    /// Hands an input-gated turn-on to the parent's dialog flow (web `onRequestDialog`).
    func requestDialog(for def: ToggleCommandTileDef)
}

// MARK: - Bound toggle-state seam (P1/S8 — web `state[def.stateField]`)

/// The seam the model observes the bound live boolean through (web `state` →
/// `Boolean(state[def.stateField])`). The production app implements it over the shared
/// P1/S8 live-signal holder for the command's `stateField`; previews and tests inject
/// `InMemoryToggleStateSource`. A `nil` value means the live state is unknown / not yet
/// loaded (web `state` null), in which case the tile uses its local optimistic toggle.
@MainActor
public protocol ToggleStateObserving: AnyObject {
    var onToggleStateChanged: (@MainActor (Bool?) -> Void)? { get set }
    /// Begins observing the bound field (no-op for commands without a `stateField`).
    func start()
}

// MARK: - Favorite seam (P1/S8 — web `onToggleFavorite` + `isFavorite`)

/// The seam the model toggles the favorite through (web `onToggleFavorite()`). The
/// production app implements it over the shared P1/S8 favorites holder, which is the
/// source of truth and confirms the new value via `onFavoriteChanged`; previews and
/// tests inject `InMemoryToggleFavoriteToggle`.
@MainActor
public protocol ToggleCommandFavoriteToggling: AnyObject {
    var onFavoriteChanged: (@MainActor (Bool) -> Void)? { get set }
    func toggle(commandID: String)
}

// MARK: - View model

/// The surface's observable view-model. Owns the on/off power state (web `isOn` —
/// derived from the bound live state, or a local optimistic toggle when unbound), the
/// execution lifecycle (web `loading`), the last-outcome projection (web `lastStatus`),
/// the favorite state (web `isFavorite`), and the freshness (stale / offline) layered on
/// top so SwiftUI can render every state. No networking lives here — progress arrives
/// through the seams.
@MainActor
@Observable
public final class ToggleCommandTileModel {
    /// The toggle command this tile renders (web `props.def`).
    public let def: ToggleCommandTileDef

    public private(set) var isExecuting = false
    public private(set) var outcome: ToggleCommandOutcome?
    public private(set) var isFavorite: Bool
    public private(set) var isOffline = false
    public private(set) var lastOutcomeAt: Date?

    /// The latest bound live value (web `state[def.stateField]`); `nil` until a snapshot
    /// arrives or for unbound commands (web `state` null).
    public private(set) var liveToggleState: Bool?
    /// The optimistic local toggle used when there is no bound state (web `localToggle`).
    public private(set) var localToggle = false

    @ObservationIgnored private let dispatcher: any ToggleCommandDispatching
    @ObservationIgnored private let stateSource: any ToggleStateObserving
    @ObservationIgnored private let favorites: any ToggleCommandFavoriteToggling
    @ObservationIgnored private let telemetry: any ToggleCommandTelemetry
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private let stalenessWindow: TimeInterval
    @ObservationIgnored private var didStart = false

    public init(
        def: ToggleCommandTileDef,
        isFavorite: Bool = false,
        lastStatus: String? = nil,
        dispatcher: any ToggleCommandDispatching,
        stateSource: any ToggleStateObserving,
        favorites: any ToggleCommandFavoriteToggling,
        telemetry: any ToggleCommandTelemetry = OSLogToggleCommandTelemetry(),
        now: @escaping @Sendable () -> Date = { Date() },
        stalenessWindow: TimeInterval = 120
    ) {
        self.def = def
        self.isFavorite = isFavorite
        outcome = ToggleCommandOutcome.parse(lastStatus)
        self.dispatcher = dispatcher
        self.stateSource = stateSource
        self.favorites = favorites
        self.telemetry = telemetry
        self.now = now
        self.stalenessWindow = stalenessWindow
        if outcome != nil { lastOutcomeAt = now() }
        dispatcher.onExecutionEvent = { [weak self] event in self?.applyExecution(event) }
        stateSource.onToggleStateChanged = { [weak self] value in self?.applyToggleState(value) }
        favorites.onFavoriteChanged = { [weak self] value in self?.applyFavorite(value) }
    }

    // MARK: Derived projections

    /// Whether the toggle reads as on (web `def.stateField && state ?
    /// Boolean(state[def.stateField]) : localToggle`). A bound command uses the live
    /// value once known; otherwise (unbound, or live state not yet loaded) it falls back
    /// to the local optimistic toggle.
    public var isOn: Bool {
        if def.hasStateBinding, let liveToggleState {
            return liveToggleState
        }
        return localToggle
    }

    /// The on/off power label projection (web `t('commands.on'/'commands.off')`).
    public var power: ToggleCommandPower {
        ToggleCommandPower.from(isOn: isOn)
    }

    /// The active tone when on, or `nil` when off (web `onStyles[variant]` vs neutral).
    public var activeTone: TSTone? {
        ToggleCommandTileStyle.activeTone(isOn: isOn, variant: def.variant)
    }

    /// What the icon/status region shows (web `loading ? spinner : icon` + status).
    public var phase: ToggleCommandTilePhase {
        ToggleCommandTilePhase.project(isExecuting: isExecuting, outcome: outcome)
    }

    /// Whether the last outcome is older than the freshness window. Only a settled,
    /// online outcome can go stale; the resting idle tile never does.
    public var isStale: Bool {
        guard !isOffline, outcome != nil, let lastOutcomeAt else { return false }
        return now().timeIntervalSince(lastOutcomeAt) > stalenessWindow
    }

    /// Freshness/connectivity projection (mirrors `LiveConnectionState`, ADR-013).
    public var connection: ToggleCommandConnection {
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

    /// Emits the diagnostics `view.opened` event once (web effect on mount) and starts
    /// observing the bound toggle state. Idempotent.
    public func start() {
        guard !didStart else { return }
        didStart = true
        telemetry.viewOpened(surface: ToggleCommandTileSurface.slug)
        stateSource.start()
    }

    // MARK: Intents (web `handleClick` / favorite `onClick`)

    /// Activates the tile (web `handleClick`): no-op while executing/offline. When on,
    /// it flips the local toggle off (unbound only) and dispatches the off-command. When
    /// off, an input-gated command opens the dialog (web `onRequestDialog`); otherwise it
    /// flips the local toggle on (unbound only) and dispatches the on-command.
    public func activate() {
        guard isInteractive else { return }

        if isOn {
            if !def.hasStateBinding { localToggle = false }
            guard let commandOff = def.commandOff else { return }
            beginExecuting()
            dispatcher.execute(command: commandOff, parameters: nil)
            return
        }

        if def.requiresInput {
            dispatcher.requestDialog(for: def)
            return
        }

        if !def.hasStateBinding { localToggle = true }
        beginExecuting()
        dispatcher.execute(command: def.command, parameters: def.parameters)
    }

    /// Toggles the favorite (web `onToggleFavorite`). Optimistic locally; the seam is the
    /// source of truth and confirms through `onFavoriteChanged`.
    public func toggleFavorite() {
        isFavorite.toggle()
        favorites.toggle(commandID: def.id)
    }

    // MARK: Seam handlers

    private func beginExecuting() {
        isExecuting = true
        outcome = nil
    }

    private func applyExecution(_ event: ToggleCommandEvent) {
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
            // Keep the last outcome cached behind the offline chip; the command could not
            // be sent, so drop the in-flight executing state.
            isExecuting = false
            isOffline = true
            lastOutcomeAt = now()
        }
    }

    private func applyToggleState(_ value: Bool?) {
        liveToggleState = value
    }

    private func applyFavorite(_ value: Bool) {
        isFavorite = value
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "ToggleCommandTile" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time. The web source keys
/// (`commands.toggleFavorite`, `commands.on`, `commands.off`) are preserved verbatim so
/// a shared catalog resolves identically across web and native.
public enum ToggleCommandTileStrings {
    public static let table = "ToggleCommandTile"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
