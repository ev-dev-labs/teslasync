//
//  CommandSearch.Model.swift
//  TeslaSync — P4 feature view · 0225 · CommandSearch (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10) for the
//  vehicle-command search box. The view binds through `CommandSearchModel`; no networking lives in the
//  view. SwiftUI parity of features/system/components/CommandSearch.tsx as it is driven inside
//  features/system/components/VehicleCommandCenter.tsx.
//
//  The web box is controlled by its parent (`value` / `onChange`) and the parent filters the static
//  `COMMANDS` catalog synchronously via a `useMemo` on every keystroke (no debounce, no request). The
//  native model owns that lifecycle: it holds the query, forwards the parent `onChange`, projects the
//  bound catalog into matches on each keystroke, resolves the result phase + freshness, forwards an
//  `onActivate` selection, and emits `view.opened` once on first appearance.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016), which is consent-gated and redacted there.
public protocol CommandSearchTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`. The
/// slug is a static, non-identifying constant logged verbatim; no payload is ever recorded.
public struct OSLogCommandSearchTelemetry: CommandSearchTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "CommandSearch" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; the per-surface table keeps each parallel
/// surface prompt self-contained.
public enum CommandSearchStrings {
    public static let table = "CommandSearch"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// SwiftUI `Text` from the catalog (the view holds no English literals).
    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// Resolves the projector's injected, pre-localized copy from the catalog.
    public static func copy() -> CommandSearchCopy {
        CommandSearchCopy(
            fieldLabel: string("commandSearch.fieldLabel", "Search commands"),
            commandRole: string("commandSearch.commandRole", "Command")
        )
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `CommandSearchSource`: the command catalog + its load status,
/// the live-state connection, the in-flight flag, and the last-update timestamp (used by the stale
/// banner's age, web `commands.staleData` `{{age}}`).
public struct CommandSearchUpdate: Sendable, Equatable {
    public var status: CommandSearchLoadStatus
    public var commands: [CommandDTO]
    public var connection: CommandSearchConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: CommandSearchLoadStatus = .idle,
        commands: [CommandDTO] = [],
        connection: CommandSearchConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.commands = commands
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders — surfacing the same command catalog the web `VehicleCommandCenter` filters plus the
/// command-status query's load/freshness. Previews + tests use `InMemoryCommandSearchSource`. There
/// is no `search(_:)` member: filtering is client-side (web filters the in-memory catalog), so the
/// source only delivers the catalog and re-fetches on `refresh()`.
@MainActor
public protocol CommandSearchSource: AnyObject {
    var onUpdate: (@MainActor (CommandSearchUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-fetches the command catalog / status (the error-state retry / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Owns the field `query`, forwards the parent `onChange`,
/// projects the bound catalog into matches on each keystroke (web synchronous `useMemo`), resolves a
/// render `CommandSearchPhase` + freshness, forwards an `onActivate` selection, and emits the
/// `view.opened` diagnostics event once on first appearance.
@MainActor
@Observable
public final class CommandSearchModel {
    public private(set) var query: String
    public private(set) var phase: CommandSearchPhase = .loading
    public private(set) var connection: CommandSearchConnection = .live
    public private(set) var projection: CommandSearchProjection = .empty
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any CommandSearchSource
    @ObservationIgnored private let telemetry: any CommandSearchTelemetry
    @ObservationIgnored private let copy: CommandSearchCopy
    @ObservationIgnored private let onChange: @MainActor (String) -> Void
    @ObservationIgnored private let onActivate: @MainActor (CommandDTO) -> Void
    @ObservationIgnored private var latestStatus: CommandSearchLoadStatus = .idle
    @ObservationIgnored private var latestCommands: [CommandDTO] = []
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any CommandSearchSource,
        telemetry: any CommandSearchTelemetry = OSLogCommandSearchTelemetry(),
        copy: CommandSearchCopy = CommandSearchStrings.copy(),
        initialQuery: String = "",
        onChange: @escaping @MainActor (String) -> Void = { _ in },
        onActivate: @escaping @MainActor (CommandDTO) -> Void = { _ in }
    ) {
        self.source = source
        self.telemetry = telemetry
        self.copy = copy
        query = initialQuery
        self.onChange = onChange
        self.onActivate = onActivate
        source.onUpdate = { [weak self] update in self?.apply(update) }
        recompute()
    }

    /// The field's VoiceOver label (the un-elided web placeholder). // parity:allow ui
    public var fieldAccessibilityLabel: String {
        copy.fieldLabel
    }

    /// The total number of commands in the bound catalog (used by the idle hint).
    public var catalogCount: Int {
        latestCommands.count
    }

    /// Whether the box currently holds a non-blank query (web `!!search.trim()`).
    public var isSearching: Bool {
        CommandSearchProjector.isSearching(query)
    }

    /// The spoken status of the result area for the current phase.
    public var resultsAccessibilitySummary: String {
        CommandSearchAccessibility.resultsSummary(
            for: phase,
            count: projection.matches.count,
            localize: CommandSearchStrings.string
        )
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: CommandSearchSurface.slug)
        source.start()
    }

    /// Stops observing the bound source.
    public func stop() {
        started = false
        source.stop()
    }

    /// Handles a keystroke: forwards the raw text to the parent (web `onChange`) and re-projects the
    /// catalog synchronously (web `useMemo` recompute — no debounce, no request).
    public func setQuery(_ newValue: String) {
        query = newValue
        onChange(newValue)
        recompute()
    }

    /// Clears the box (the field's clear affordance) — web `onChange('')`.
    public func clear() {
        setQuery("")
    }

    /// Activates a matched command (web tile execute). Forwards the underlying command to the parent's
    /// `onActivate`; the catalog is the source of truth for the payload.
    public func activate(_ match: CommandMatch) {
        guard let command = latestCommands.first(where: { $0.id == match.id }) else { return }
        onActivate(command)
    }

    /// Re-fetches the catalog (web parent refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    /// A `Binding` over `query` the SwiftUI `TextField` writes through `setQuery`.
    public var queryBinding: Binding<String> {
        Binding(get: { [weak self] in self?.query ?? "" }, set: { [weak self] in self?.setQuery($0) })
    }

    private func apply(_ update: CommandSearchUpdate) {
        latestStatus = update.status
        latestCommands = update.commands
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        recompute()
        handleAutoRefresh(for: update.connection)
    }

    private func recompute() {
        projection = CommandSearchProjector.project(commands: latestCommands, query: query, copy: copy)
        phase = CommandSearchProjector.resolvePhase(
            latestStatus,
            isSearching: CommandSearchProjector.isSearching(query),
            hasMatches: projection.hasMatches
        )
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached catalog and does not
    /// refetch (web shows the cached commands behind the wake-first banner).
    private func handleAutoRefresh(for connection: CommandSearchConnection) {
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
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()`,
/// counts the lifecycle calls, and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryCommandSearchSource: CommandSearchSource {
    public var onUpdate: (@MainActor (CommandSearchUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: CommandSearchUpdate?

    public init(initial: CommandSearchUpdate? = nil) {
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
    public func push(_ update: CommandSearchUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension CommandSearch {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        CommandSearchSurface.slug
    }
}
