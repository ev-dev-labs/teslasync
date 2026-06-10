//
//  RecentChargesSection.Model.swift
//  TeslaSync — P4 feature view · 0296 · RecentChargesSection (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for
//  the Recent Charges section. The view binds through `RecentChargesSectionModel`; no networking
//  lives in the view. The web source (RecentChargesSection.tsx) is a pure presentational leaf fed
//  a `sessions` prop by the Vehicle Detail page, so the input snapshot here carries that list
//  (plus the `useFormatting` preferences and the parent's loading / error / connectivity state)
//  rather than issuing HTTP itself.
//
//  States: the web leaf's own branch is `sessions && sessions.length > 0 ? <DataTable> :
//  <EmptyState>`. On top of that, this surface honours the P4 leaf contract (the same one the
//  sibling ClimateSection/0291 ships): a `phase` (loading / empty / error / data) fed by the
//  parent's query state, and an orthogonal `connection` axis (live / stale / offline) surfaced as
//  a freshness chip + banner with a one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared-core
/// diagnostics sink (consent-gated + redacted there).
public protocol RecentChargesSectionTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event. The slug is a static, non-identifying constant.
public struct OSLogRecentChargesSectionTelemetry: RecentChargesSectionTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the header chip
/// + banner. `live` hides the banner; `stale` / `offline` show it.
public enum RecentChargesSectionConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web prop + `useFormatting` + parent lifecycle)

/// One coalesced snapshot of the section's inputs — the native mirror of the web `sessions` prop
/// and the `useFormatting` preferences, plus the parent surface's lifecycle (`isLoading`, an error
/// message, and connectivity). A `nil` or empty `sessions` is the web `!(sessions && length > 0)`
/// empty branch.
public struct RecentChargesSectionInput: Sendable, Equatable {
    public var sessions: [RecentChargesSession]?
    public var formatting: RecentChargesFormatting
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: RecentChargesSectionConnection

    public init(
        sessions: [RecentChargesSession]? = nil,
        formatting: RecentChargesFormatting = .default,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: RecentChargesSectionConnection = .live
    ) {
        self.sessions = sessions
        self.formatting = formatting
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the section's render branches. `phase`
/// selects the body and carries the pre-computed projection for the data case, so the view is a
/// pure function of this value.
public struct RecentChargesSectionResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Initial fetch (web parent `isLoading`) → skeleton chrome.
        case loading
        /// Resolved with no rows (web `!(sessions && length > 0)`) → friendly empty.
        case empty
        /// Parent query failure → retry affordance (web `QueryError` peer).
        case error(String)
        /// A non-empty session list → the DataTable.
        case data(RecentChargesProjection)
    }

    public let phase: Phase

    public init(phase: Phase) {
        self.phase = phase
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// component's `sessions && length > 0 ? table : empty` branch plus the P4 leaf contract. Unit
/// tested across loading / empty / error / data.
public enum RecentChargesSectionProjector {
    public static func resolve(_ input: RecentChargesSectionInput) -> RecentChargesSectionResolved {
        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return RecentChargesSectionResolved(phase: .error(message))
        }
        // Initial fetch (web parent `isLoading`) → skeleton.
        guard !input.isLoading else {
            return RecentChargesSectionResolved(phase: .loading)
        }
        // Web empty branch: a nil OR empty session list renders the EmptyState, not the table.
        guard let sessions = input.sessions, !sessions.isEmpty else {
            return RecentChargesSectionResolved(phase: .empty)
        }
        return RecentChargesSectionResolved(
            phase: .data(RecentChargesProjection.make(sessions: sessions, formatting: input.formatting))
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the live charging
/// feed (`useCharging` + `useFormatting`); previews and tests use `InMemoryRecentChargesSource`.
/// The view never talks to the network.
@MainActor
public protocol RecentChargesSectionSource: AnyObject {
    var onUpdate: (@MainActor (RecentChargesSectionInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The section's observable view-model. Subscribes to a `RecentChargesSectionSource`, recomputes
/// the resolved projection, exposes a render `phase` + the `connection` axis, and auto-refreshes
/// once when the feed transitions to stale.
@MainActor
@Observable
public final class RecentChargesSectionModel {
    public private(set) var resolved: RecentChargesSectionResolved =
        RecentChargesSectionProjector.resolve(RecentChargesSectionInput(isLoading: true))
    public private(set) var connection: RecentChargesSectionConnection = .live

    public var phase: RecentChargesSectionResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any RecentChargesSectionSource
    @ObservationIgnored private let telemetry: any RecentChargesSectionTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any RecentChargesSectionSource,
        telemetry: any RecentChargesSectionTelemetry = OSLogRecentChargesSectionTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: RecentChargesSection.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (header refresh button + error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: RecentChargesSectionInput) {
        resolved = RecentChargesSectionProjector.resolve(input)
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryRecentChargesSource: RecentChargesSectionSource {
    public var onUpdate: (@MainActor (RecentChargesSectionInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: RecentChargesSectionInput?

    public init(initial: RecentChargesSectionInput? = nil) {
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
    public func push(_ input: RecentChargesSectionInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded prose. Keys live in the "RecentChargesSection" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum RecentChargesSectionStrings {
    public static let table = "RecentChargesSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
