//
//  InputCommandTile.Model.swift
//  TeslaSync — P4 feature view · 0232 · InputCommandTile (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the vehicle-command input tile. The view binds through
//  `InputCommandTileModel`; no networking lives in the view. The web source
//  (InputCommandTile.tsx) is a presentational leaf fed `def` / `loading` /
//  `lastStatus` / `isFavorite` by its parent (the Vehicle Command Center), so the
//  input snapshot here carries those props rather than issuing HTTP itself.
//
//  States: the web leaf's own branches are data-driven (the in-flight spinner, the
//  optional sublabel, the ✓/✗ status line). On top of those, this surface honours
//  the P4 leaf contract: a `phase` (loading / empty / error / data) fed by the
//  parent's query state, and an orthogonal `connection` axis (live / stale /
//  offline) surfaced as a freshness chip + a one-shot auto-refresh on the stale
//  transition. Sending a command while offline is disabled (the tile is a remote
//  actuation), mirroring the web tile's early-return when `loading`.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol InputCommandTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogInputCommandTelemetry: InputCommandTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as
/// the corner chip. `live` hides the chip; `stale` / `offline` show it, and
/// `offline` additionally disables command actuation.
public enum InputCommandConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web props from the Vehicle Command Center)

/// One coalesced snapshot of the tile's inputs — the native mirror of the web props
/// (`def`, `loading`, `lastStatus`, `isFavorite`) plus the parent surface's
/// lifecycle (`isLoading`, an error message) and the connectivity axis.
public struct InputCommandTileInput: Sendable, Equatable {
    public var def: InputCommandTileCommandTileDef?
    public var isLoading: Bool
    public var isExecuting: Bool
    public var errorMessage: String?
    public var lastStatusRaw: String?
    public var isFavorite: Bool
    public var connection: InputCommandConnection

    public init(
        def: InputCommandTileCommandTileDef? = nil,
        isLoading: Bool = false,
        isExecuting: Bool = false,
        errorMessage: String? = nil,
        lastStatusRaw: String? = nil,
        isFavorite: Bool = false,
        connection: InputCommandConnection = .live
    ) {
        self.def = def
        self.isLoading = isLoading
        self.isExecuting = isExecuting
        self.errorMessage = errorMessage
        self.lastStatusRaw = lastStatusRaw
        self.isFavorite = isFavorite
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the tile's render branches.
/// `phase` selects the body; the parsed status, the executing/favorite flags, the
/// accent, and `isInteractive` are pre-computed so the view is a pure function of it.
public struct InputCommandTileResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let def: InputCommandTileCommandTileDef?
    public let status: CommandTileStatus?
    public let isExecuting: Bool
    public let isFavorite: Bool
    public let accent: CommandTileAccent
    public let isInteractive: Bool

    public init(
        phase: Phase,
        def: InputCommandTileCommandTileDef?,
        status: CommandTileStatus?,
        isExecuting: Bool,
        isFavorite: Bool,
        accent: CommandTileAccent,
        isInteractive: Bool
    ) {
        self.phase = phase
        self.def = def
        self.status = status
        self.isExecuting = isExecuting
        self.isFavorite = isFavorite
        self.accent = accent
        self.isInteractive = isInteractive
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native
/// port of the web component's render branches plus the P4 leaf contract. Unit
/// tested across loading / empty / error / data and the interactivity gate.
public enum InputCommandTileProjection {
    public static func resolve(_ input: InputCommandTileInput) -> InputCommandTileResolved {
        let status = CommandTileStatus.parse(input.lastStatusRaw)
        let accent = input.def?.variant.accent ?? .neutral

        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return resolved(.error(message), input: input, status: status, accent: accent, interactive: false)
        }
        // Initial fetch (web parent `isLoading`) or no snapshot yet.
        guard !input.isLoading else {
            return resolved(.loading, input: input, status: status, accent: accent, interactive: false)
        }
        // No command bound (e.g. unsupported for this vehicle) → friendly empty tile.
        guard input.def != nil else {
            return resolved(.empty, input: input, status: status, accent: accent, interactive: false)
        }
        // Web tile blocks taps while `loading`; offline blocks remote actuation too.
        let interactive = !input.isExecuting && input.connection != .offline
        return resolved(.data, input: input, status: status, accent: accent, interactive: interactive)
    }

    private static func resolved(
        _ phase: InputCommandTileResolved.Phase,
        input: InputCommandTileInput,
        status: CommandTileStatus?,
        accent: CommandTileAccent,
        interactive: Bool
    ) -> InputCommandTileResolved {
        InputCommandTileResolved(
            phase: phase,
            def: input.def,
            status: status,
            isExecuting: input.isExecuting,
            isFavorite: input.isFavorite,
            accent: accent,
            isInteractive: interactive
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// Command Center's command/state/favorites queries; previews and tests use
/// `InMemoryInputCommandSource`. The view never talks to the network directly.
@MainActor
public protocol InputCommandTileSource: AnyObject {
    var onUpdate: (@MainActor (InputCommandTileInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    /// Web `onRequestDialog(def)` — open the command's input dialog.
    func requestDialog()
    /// Web `onToggleFavorite()` — flip the command's pinned state.
    func toggleFavorite()
}

/// The tile's observable view-model. Subscribes to an `InputCommandTileSource`,
/// recomputes the resolved projection, exposes a render `phase` + the resolved
/// view-state and the `connection` axis, gates actuation on interactivity, and
/// auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class InputCommandTileModel {
    public private(set) var resolved: InputCommandTileResolved =
        InputCommandTileProjection.resolve(InputCommandTileInput(isLoading: true))
    public private(set) var connection: InputCommandConnection = .live

    public var phase: InputCommandTileResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any InputCommandTileSource
    @ObservationIgnored private let telemetry: any InputCommandTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any InputCommandTileSource,
        telemetry: any InputCommandTelemetry = OSLogInputCommandTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: InputCommandTile.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (error retry + stale auto-refresh).
    public func refresh() {
        source.refresh()
    }

    /// Opens the input dialog (web tile tap). Gated: in-flight or offline tiles are
    /// inert, matching the web early-return on `loading`.
    public func requestDialog() {
        guard resolved.isInteractive else { return }
        source.requestDialog()
    }

    /// Toggles the command's favorite/pinned state (web ghost star). Always allowed
    /// — it is a local preference, not a remote actuation.
    public func toggleFavorite() {
        source.toggleFavorite()
    }

    private func apply(_ input: InputCommandTileInput) {
        resolved = InputCommandTileProjection.resolve(input)
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

/// In-memory source for previews + unit tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryInputCommandSource: InputCommandTileSource {
    public var onUpdate: (@MainActor (InputCommandTileInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var dialogCount = 0
    public private(set) var favoriteToggleCount = 0

    private let initial: InputCommandTileInput?

    public init(initial: InputCommandTileInput? = nil) {
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

    public func requestDialog() {
        dialogCount += 1
    }

    public func toggleFavorite() {
        favoriteToggleCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: InputCommandTileInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "InputCommandTile" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time.
public enum InputCommandStrings {
    public static let table = "InputCommandTile"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
