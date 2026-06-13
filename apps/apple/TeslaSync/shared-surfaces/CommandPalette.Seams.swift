//
//  CommandPalette.Seams.swift
//  TeslaSync — P4 shared surface · 0205 · CommandPalette (Apple)
//
//  The data + telemetry seams the ``CommandPaletteModel`` binds through (P1/S8 + P1/S11), kept apart from the
//  model for the SwiftLint file-length budget. The web `<CommandPalette>` composes ten hooks — `useVehicles`,
//  `useSelectedVehicle`, `useIsForwardAuth`, `useCommandRegistry`, `useGlobalSearch`, plus the
//  `recentPages` / `commandFrecency` stores and the `navSections` nav — into the rows it renders, and routes
//  activations through `useVehicleCommand` / `useNavigate`. The native peer keeps that contract: the composed
//  read value arrives through ``CommandPaletteSource`` snapshots (with the live-search + usage-record side
//  channels), and activations route out through the ``CommandPaletteRunner`` (see CommandPalette.Runner.swift).
//  The view never reads a source directly — it goes through the model, which goes through these seams. No
//  networking lives here.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`; the
/// production app injects an adapter forwarding to the consent-gated shared-core diagnostics sink. The slug is
/// a static, non-identifying constant — no query text (which is PII) is ever emitted.
public protocol CommandPaletteTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogCommandPaletteTelemetry: CommandPaletteTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - PaletteConnection (P4 connectivity axis)

/// The orthogonal freshness axis used by the P4 leaf-state contract: `live` (fresh), `stale` (older than the
/// freshness window — auto-refreshes once), `offline` (no connectivity — keeps the cached rows). The web
/// component has no such axis; it is the native surface's always-render connectivity chip.
public enum PaletteConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - CommandPaletteSnapshot (the composed web hook value)

/// The host's current palette feed pushed through the source — the composed value of the web read hooks
/// (`useVehicles` + `useSelectedVehicle` + `useIsForwardAuth` + `useCommandRegistry` + the `recentPages` /
/// `commandFrecency` stores + `navSections`) and the latest `useGlobalSearch` hits, plus the in-flight /
/// error flags and the connectivity axis. A value type so the model, the projector, and the tests agree on
/// one shape.
public struct CommandPaletteSnapshot: Sendable, Equatable {
    /// The fleet (web `useVehicles`), in display order.
    public let vehicles: [PaletteVehicle]
    /// The active vehicle id (web `useSelectedVehicle().vehicleId`), or `nil` when nothing is selected.
    public let selectedVehicleID: Int?
    /// Whether the deployment is ForwardAuth-gated (web `useIsForwardAuth`) — reveals auth-only nav rows.
    public let isForwardAuth: Bool
    /// The navigable pages (web `navSections` + `navSearchKeywords`).
    public let navEntries: [PaletteNavEntry]
    /// The static registry commands (web `useCommandRegistry().commands`).
    public let registryEntries: [PaletteRegistryEntry]
    /// The recently-visited pages (web `getRecentPages`).
    public let recentPages: [PaletteRecentPage]
    /// The frecency scores keyed by row id (web `getAllCommandScores`).
    public let commandScores: [String: Double]
    /// The latest server search hits for the active term (web `useGlobalSearch().hits`).
    public let searchHits: [PaletteSearchHit]
    /// Whether the composed feed is still loading (web initial fetch).
    public let isLoading: Bool
    /// The feed failure reason, if any — surfaced verbatim by the error state.
    public let errorMessage: String?
    /// The live-feed freshness axis.
    public let connection: PaletteConnection

    public init(
        vehicles: [PaletteVehicle] = [],
        selectedVehicleID: Int? = nil,
        isForwardAuth: Bool = false,
        navEntries: [PaletteNavEntry] = [],
        registryEntries: [PaletteRegistryEntry] = [],
        recentPages: [PaletteRecentPage] = [],
        commandScores: [String: Double] = [:],
        searchHits: [PaletteSearchHit] = [],
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: PaletteConnection = .live
    ) {
        self.vehicles = vehicles
        self.selectedVehicleID = selectedVehicleID
        self.isForwardAuth = isForwardAuth
        self.navEntries = navEntries
        self.registryEntries = registryEntries
        self.recentPages = recentPages
        self.commandScores = commandScores
        self.searchHits = searchHits
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }

    /// A copy with replaced server search hits (the live-search side channel re-emit).
    public func with(searchHits: [PaletteSearchHit]) -> CommandPaletteSnapshot {
        CommandPaletteSnapshot(
            vehicles: vehicles, selectedVehicleID: selectedVehicleID, isForwardAuth: isForwardAuth,
            navEntries: navEntries, registryEntries: registryEntries, recentPages: recentPages,
            commandScores: commandScores, searchHits: searchHits, isLoading: isLoading,
            errorMessage: errorMessage, connection: connection
        )
    }

    /// A copy with replaced frecency scores (the usage-record side channel re-emit).
    public func with(commandScores: [String: Double]) -> CommandPaletteSnapshot {
        CommandPaletteSnapshot(
            vehicles: vehicles, selectedVehicleID: selectedVehicleID, isForwardAuth: isForwardAuth,
            navEntries: navEntries, registryEntries: registryEntries, recentPages: recentPages,
            commandScores: commandScores, searchHits: searchHits, isLoading: isLoading,
            errorMessage: errorMessage, connection: connection
        )
    }
}

// MARK: - Read source seam (P1/S8) — the host's composed palette feed

/// The read seam the model binds through. The production app re-emits the host's composed hook value
/// (`LiveCommandPaletteSource`), forwards the debounced live-search term, and records usage; previews and
/// tests use `InMemoryCommandPaletteSource`. The view never reads it directly.
@MainActor
public protocol CommandPaletteSource: AnyObject {
    var onUpdate: (@MainActor (CommandPaletteSnapshot) -> Void)? { get set }
    /// Begin emitting (web hooks mount).
    func start()
    /// Stop emitting (web hooks unmount).
    func stop()
    /// Re-request the composed feed (web refetch) — the error-state retry + the stale auto-refresh.
    func refresh()
    /// Request live entity search for a term (web debounced `useGlobalSearch`); an empty term clears hits.
    func search(term: String)
    /// Record a row activation for frecency / recent ordering (web `recordCommandUse` + `addRecentCommand`).
    func recordUse(id: String)
}

/// The production read source — holds the host's current snapshot and re-emits it whenever the host updates
/// it. Search + usage-record requests are forwarded to host-supplied handlers (the production app wires them
/// to `useGlobalSearch` + the frecency / recent stores) so the seam stays network-free.
@MainActor
public final class LiveCommandPaletteSource: CommandPaletteSource {
    public var onUpdate: (@MainActor (CommandPaletteSnapshot) -> Void)?
    /// Host hook for the debounced live search (the native peer of `useGlobalSearch(term)`).
    public var searchHandler: (@MainActor (String) -> Void)?
    /// Host hook for the usage record (the native peer of `recordCommandUse` + `addRecentCommand`).
    public var recordHandler: (@MainActor (String) -> Void)?
    private var snapshot: CommandPaletteSnapshot

    public init(snapshot: CommandPaletteSnapshot) {
        self.snapshot = snapshot
    }

    public func start() {
        emit()
    }

    public func stop() {}
    public func refresh() {
        emit()
    }

    public func search(term: String) {
        searchHandler?(term)
    }

    public func recordUse(id: String) {
        recordHandler?(id)
    }

    /// Push a fresh snapshot (a new fleet / selection / registry / search hits / connectivity) and re-emit it.
    public func update(_ snapshot: CommandPaletteSnapshot) {
        self.snapshot = snapshot
        emit()
    }

    private func emit() {
        onUpdate?(snapshot)
    }
}

/// A fully-working in-memory source for previews + tests. Emits a base snapshot on `start()`, answers live
/// search from an injected provider, accumulates usage records into the frecency scores, and lets a test push
/// further snapshots via `push(_:)`.
@MainActor
public final class InMemoryCommandPaletteSource: CommandPaletteSource {
    public var onUpdate: (@MainActor (CommandPaletteSnapshot) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var searchedTerms: [String] = []
    public private(set) var recordedIDs: [String] = []

    private var snapshot: CommandPaletteSnapshot
    private let searchProvider: (String) -> [PaletteSearchHit]

    public init(
        snapshot: CommandPaletteSnapshot,
        searchProvider: @escaping (String) -> [PaletteSearchHit] = { _ in [] }
    ) {
        self.snapshot = snapshot
        self.searchProvider = searchProvider
    }

    public func start() {
        startCount += 1
        emit()
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
        emit()
    }

    public func search(term: String) {
        searchedTerms.append(term)
        let hits = term.isEmpty ? [] : searchProvider(term)
        snapshot = snapshot.with(searchHits: hits)
        emit()
    }

    public func recordUse(id: String) {
        recordedIDs.append(id)
        var scores = snapshot.commandScores
        scores[id, default: 0] += 1
        snapshot = snapshot.with(commandScores: scores)
        emit()
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: CommandPaletteSnapshot) {
        snapshot = update
        emit()
    }

    private func emit() {
        onUpdate?(snapshot)
    }
}
