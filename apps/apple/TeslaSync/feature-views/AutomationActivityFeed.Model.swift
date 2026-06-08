//
//  AutomationActivityFeed.Model.swift
//  TeslaSync — P4 feature view · 0081 · AutomationActivityFeed (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the Automation "Recent Activity" feed. The view binds through
//  `AutomationFeedModel`; no networking lives in the view. The web source
//  (AutomationActivityFeed.tsx) is a pure presentational leaf — its only hook is
//  `useTranslation`; it receives `history` / `historyStats` / `isLoading` / `liveEvents` /
//  `connectionState` as props from its parent (the automations page's history query +
//  `useAutomationEvents` SSE stream). So the native `AutomationFeedSource` carries that
//  parent prop snapshot rather than issuing HTTP itself; the projection is the same one
//  the web render performs.
//

import Foundation
import Observation
import OSLog

// MARK: - Diagnostics surface identity (P1/S11)

/// The surface slug emitted with the `view.opened` diagnostics event. Kept here (not on
/// the SwiftUI view) so the model + tests reference it without importing SwiftUI.
public enum AutomationFeedDiagnostics {
    public static let surface = "AutomationActivityFeed"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol AutomationFeedTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogAutomationFeedTelemetry: AutomationFeedTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connection (web `connectionState` + P4 freshness)

/// The live-feed connection + freshness state. `connected` / `reconnecting` are the two
/// web `connectionState` values (rendered "Live" / "Reconnecting"); `stale` / `offline`
/// are the native P4 states-contract additions (a cached read past the freshness window /
/// no connectivity), rendered as their own chips + a cached-data banner.
public enum AutomationFeedConnection: Sendable, Equatable {
    case connected
    case reconnecting
    case stale
    case offline
}

// MARK: - History render phase (web `isLoading` / data / empty + native error)

/// The mutually-exclusive render branches for the history list — the native mirror of the
/// web `isLoading ? skeletons : (history.length ? rows : <EmptyState/>)` ladder, with the
/// native error branch (the P4 states contract's QueryError-equivalent) slotted after
/// loading.
public enum AutomationFeedPhase: Sendable, Equatable {
    case loading
    case data
    case empty
    case error(String)
}

// MARK: - Input snapshot (web props from the parent query + SSE stream)

/// One coalesced snapshot of the feed's inputs — the native mirror of the web props
/// (`history`, `historyStats`, `isLoading`, `liveEvents`, `connectionState`) plus an
/// optional `errorMessage` so a failed parent history query can surface natively, and an
/// `updatedAt` for the freshness chrome.
public struct AutomationFeedInput: Sendable, Equatable {
    public var history: [AutomationHistoryInput]
    public var stats: AutomationHistoryStatsInput?
    public var isLoading: Bool
    public var errorMessage: String?
    public var liveEvents: [AutomationLiveEventInput]
    public var connection: AutomationFeedConnection
    public var updatedAt: Date?

    public init(
        history: [AutomationHistoryInput] = [],
        stats: AutomationHistoryStatsInput? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        liveEvents: [AutomationLiveEventInput] = [],
        connection: AutomationFeedConnection = .connected,
        updatedAt: Date? = nil
    ) {
        self.history = history
        self.stats = stats
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.liveEvents = liveEvents
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

// MARK: - Resolved render state (the web render branches)

/// The resolved, view-ready state — the history `phase` plus the always-on overlays the
/// web renders independently of the loading branch (the live-event rows, the gated stats
/// summary, and the connection chip).
public struct AutomationFeedResolved: Sendable, Equatable {
    public let phase: AutomationFeedPhase
    public let historyRows: [AutomationHistoryRow]
    public let liveRows: [AutomationLiveEventRow]
    public let stats: AutomationFeedStats?
    public let connection: AutomationFeedConnection

    public init(
        phase: AutomationFeedPhase,
        historyRows: [AutomationHistoryRow],
        liveRows: [AutomationLiveEventRow],
        stats: AutomationFeedStats?,
        connection: AutomationFeedConnection
    ) {
        self.phase = phase
        self.historyRows = historyRows
        self.liveRows = liveRows
        self.stats = stats
        self.connection = connection
    }
}

/// Pure projection from the input snapshot to the resolved view-state. The history `phase`
/// follows the web `isLoading ? skeleton : (rows.length ? data : empty)` ladder with the
/// native error branch; the live rows / stats / connection are projected independently
/// (the web renders them outside the loading branch). Unit-tested across every branch.
public enum AutomationFeedProjection {
    public static func resolve(
        _ input: AutomationFeedInput,
        locale: Locale = .current
    ) -> AutomationFeedResolved {
        let rows = AutomationFeedAdapter.historyRows(from: input.history)
        let phase: AutomationFeedPhase = if input.isLoading {
            .loading
        } else if let message = input.errorMessage, !message.isEmpty {
            .error(message)
        } else {
            rows.isEmpty ? .empty : .data
        }
        return AutomationFeedResolved(
            phase: phase,
            historyRows: rows,
            liveRows: AutomationFeedAdapter.liveRows(from: input.liveEvents),
            stats: AutomationFeedAdapter.stats(from: input.stats, locale: locale),
            connection: input.connection
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the parent
/// history query (web `useAutomationHistory`) composed with the `useAutomationEvents` SSE
/// stream; previews + tests use `InMemoryAutomationFeedSource`. The view never talks to
/// the network directly.
@MainActor
public protocol AutomationFeedSource: AnyObject {
    var onUpdate: (@MainActor (AutomationFeedInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The feed's observable view-model. Subscribes to an `AutomationFeedSource`, recomputes
/// the resolved projection, and exposes a render `phase` + the live rows / stats /
/// connection for SwiftUI to switch over.
@MainActor
@Observable
public final class AutomationFeedModel {
    public private(set) var phase: AutomationFeedPhase = .loading
    public private(set) var historyRows: [AutomationHistoryRow] = []
    public private(set) var liveRows: [AutomationLiveEventRow] = []
    public private(set) var stats: AutomationFeedStats?
    public private(set) var connection: AutomationFeedConnection = .connected
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any AutomationFeedSource
    @ObservationIgnored private let telemetry: any AutomationFeedTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any AutomationFeedSource,
        telemetry: any AutomationFeedTelemetry = OSLogAutomationFeedTelemetry(),
        locale: Locale = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: AutomationFeedDiagnostics.surface)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the history (wired to the retry affordance + the stale auto-refresh).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: AutomationFeedInput) {
        let resolved = AutomationFeedProjection.resolve(input, locale: locale)
        phase = resolved.phase
        historyRows = resolved.historyRows
        liveRows = resolved.liveRows
        stats = resolved.stats
        connection = resolved.connection
        updatedAt = input.updatedAt
        handleAutoRefresh(for: resolved.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once
    /// fully live so a later stale episode re-triggers exactly once.
    private func handleAutoRefresh(for connection: AutomationFeedConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .connected:
            didAutoRefreshForStale = false
        case .reconnecting, .offline:
            break
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryAutomationFeedSource: AutomationFeedSource {
    public var onUpdate: (@MainActor (AutomationFeedInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: AutomationFeedInput?

    public init(initial: AutomationFeedInput? = nil) {
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
    public func push(_ input: AutomationFeedInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds
/// no hardcoded literals. Keys live in the "AutomationActivityFeed" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time so each parallel surface owns
/// its own strings without editing the shared catalog.
public enum AutomationFeedStrings {
    public static let table = "AutomationActivityFeed"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
