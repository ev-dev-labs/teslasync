//
//  globalShortcuts.Model.swift
//  TeslaSync — P4 misc surface · 0002 · globalShortcuts (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the global keyboard-shortcut registry. The view binds through
//  `GlobalShortcutsModel`; no networking lives in the view. The web source
//  (globalShortcuts.tsx) is a headless registry populator — it reads `useTranslation`
//  and pushes a static `defs` array into the registry via `useShortcut`, rendering
//  nothing. The native parity surface keeps the same data contract: a source emits the
//  registry snapshot (the canonical catalog) plus the parent's loading / error /
//  connectivity state, and the view renders the cheat-sheet over it.
//
//  States: the web registry is static, so the production source resolves straight to
//  `data`. On top of that, this surface honours the P4 leaf contract (the same one the
//  feature-view leaves ship): a `phase` (loading / empty / error / data) fed by the
//  source's query state, and an orthogonal `connection` axis (live / stale / offline)
//  surfaced as a freshness chip with a one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol GlobalShortcutsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogGlobalShortcutsTelemetry: GlobalShortcutsTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound registry — the orthogonal connectivity axis rendered as
/// the freshness chip. `live` hides the chip; `stale` / `offline` show it.
public enum GlobalShortcutsConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (registry snapshot + parent lifecycle)

/// One coalesced snapshot of the surface's inputs — the registry definitions (the
/// native mirror of the web registry snapshot the cheat-sheet reads) plus the parent's
/// lifecycle (`isLoading`, an error message, and connectivity). The definitions are
/// already-localised, exactly as the web `defs` are built with `t(…)` before being
/// registered.
public struct GlobalShortcutsInput: Sendable, Equatable {
    public var definitions: [GlobalShortcutDefinition]
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: GlobalShortcutsConnection

    public init(
        definitions: [GlobalShortcutDefinition] = [],
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: GlobalShortcutsConnection = .live
    ) {
        self.definitions = definitions
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body, and for the data phase
/// the grouped cheat-sheet sections and the total row count are pre-computed so the view
/// is a pure function of this value.
public struct GlobalShortcutsResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let groups: [GlobalShortcutGroup]
    public let totalCount: Int

    public init(phase: Phase, groups: [GlobalShortcutGroup], totalCount: Int) {
        self.phase = phase
        self.groups = groups
        self.totalCount = totalCount
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native port
/// of the cheat-sheet's render branches plus the P4 leaf contract. Unit tested across
/// loading / empty / error / data and the grouping. The `resolve` closure localises the
/// group headers (the only strings the projection itself produces).
public enum GlobalShortcutsProjection {
    public static func resolve(
        _ input: GlobalShortcutsInput,
        strings: GlobalShortcutsResolve
    ) -> GlobalShortcutsResolved {
        // P4 contract: a source query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return GlobalShortcutsResolved(phase: .error(message), groups: [], totalCount: 0)
        }
        // Initial fetch (web parent `isLoading`).
        if input.isLoading {
            return GlobalShortcutsResolved(phase: .loading, groups: [], totalCount: 0)
        }
        let groups = GlobalShortcutsGrouping.groups(from: input.definitions, resolve: strings)
        // Resolved with no registered shortcuts → friendly empty state (never blank).
        guard !groups.isEmpty else {
            return GlobalShortcutsResolved(phase: .empty, groups: [], totalCount: 0)
        }
        let total = groups.reduce(0) { $0 + $1.rows.count }
        return GlobalShortcutsResolved(phase: .data, groups: groups, totalCount: total)
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// registry snapshot (`CanonicalGlobalShortcutsSource`); previews and tests use
/// `InMemoryGlobalShortcutsSource`. The view never talks to the network directly.
@MainActor
public protocol GlobalShortcutsSource: AnyObject {
    var onUpdate: (@MainActor (GlobalShortcutsInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `GlobalShortcutsSource`,
/// recomputes the resolved projection, exposes a render `phase` + the resolved
/// view-state and the `connection` axis, and auto-refreshes once when the feed
/// transitions to stale.
@MainActor
@Observable
public final class GlobalShortcutsModel {
    public private(set) var resolved: GlobalShortcutsResolved =
        .init(phase: .loading, groups: [], totalCount: 0)
    public private(set) var connection: GlobalShortcutsConnection = .live

    public var phase: GlobalShortcutsResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any GlobalShortcutsSource
    @ObservationIgnored private let telemetry: any GlobalShortcutsTelemetry
    @ObservationIgnored private let strings: GlobalShortcutsResolve
    @ObservationIgnored private var started = false

    public init(
        source: any GlobalShortcutsSource,
        telemetry: any GlobalShortcutsTelemetry = OSLogGlobalShortcutsTelemetry(),
        strings: @escaping GlobalShortcutsResolve = GlobalShortcutsStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.strings = strings
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: GlobalShortcuts.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: GlobalShortcutsInput) {
        resolved = GlobalShortcutsProjection.resolve(input, strings: strings)
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

// MARK: - Canonical source (production — the web `useShortcut(defs)` seeding)

/// The production source. It seeds the bound model with the canonical catalog — the
/// exact `defs` the web `GlobalShortcuts` pushes into the registry — localised through
/// the P1/S10 facade. The registry is static (no HTTP), mirroring the web source, so
/// `start`/`refresh` simply re-emit the current catalog as a live snapshot.
@MainActor
public final class CanonicalGlobalShortcutsSource: GlobalShortcutsSource {
    public var onUpdate: (@MainActor (GlobalShortcutsInput) -> Void)?

    private let strings: GlobalShortcutsResolve

    public init(strings: @escaping GlobalShortcutsResolve = GlobalShortcutsStrings.string) {
        self.strings = strings
    }

    private func emit() {
        let defs = GlobalShortcutsCatalog.canonicalDefinitions(resolve: strings)
        onUpdate?(GlobalShortcutsInput(definitions: defs, connection: .live))
    }

    public func start() {
        emit()
    }

    public func stop() {}
    public func refresh() {
        emit()
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryGlobalShortcutsSource: GlobalShortcutsSource {
    public var onUpdate: (@MainActor (GlobalShortcutsInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: GlobalShortcutsInput?

    public init(initial: GlobalShortcutsInput? = nil) {
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

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: GlobalShortcutsInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view and
/// catalog hold no hardcoded literals. Keys live in the "globalShortcuts" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time.
public enum GlobalShortcutsStrings {
    public static let table = "globalShortcuts"

    public static let string: GlobalShortcutsResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
