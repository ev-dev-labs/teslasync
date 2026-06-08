//
//  SecurityStatistics.Model.swift
//  TeslaSync — P4 feature view · 0045 · SecurityStatistics (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) for the
//  SecurityStatistics surface — the SwiftUI parity of the web
//  features/admin/components/security-access/SecurityStatistics.tsx props
//  (`securityStats` / `sentryUptime` / `isLoading`). The web component is
//  presentational; here the loading/loaded/empty/error + freshness lifecycle the
//  state list requires is owned by `SecurityStatisticsModel`, fed through a source
//  seam. No networking lives in the view.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Stable telemetry slug for the diagnostics `view.opened` event. Kept on a
/// non-generic type so the model can reference it without the view.
public enum SecurityStatisticsSurface {
    public static let slug = "SecurityStatistics"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the diagnostics `view.opened` event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared
/// core diagnostics pipeline (consent-gated + redacted there).
public protocol SecurityStatisticsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogSecurityStatisticsTelemetry: SecurityStatisticsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Load outcome (the seam's result)

/// The result of a statistics read, mirroring the shapes the web parent collapses to:
/// a computed `SecurityStats` (+ sentry uptime) success, the `computeSecurityStats →
/// null` empty (no events), a fetch error string (native `QueryError`), and the
/// transport failure the native app surfaces as `offline` so the last good snapshot
/// can stay on screen behind an offline chip rather than being blanked.
public enum SecurityStatisticsOutcome: Sendable, Equatable {
    case loaded(SecurityStatsSnapshot)
    case empty
    case failure(message: String)
    case offline(message: String)
}

// MARK: - State-holder seam (P1/S8 layer; never HTTP from the view)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 security-statistics holder (which derives the snapshot from the
/// security-event history — the web `computeSecurityStats`/`computeSentryUptime`
/// logic); previews and tests inject `InMemorySecurityStatisticsSource`. The view
/// never performs I/O itself.
@MainActor
public protocol SecurityStatisticsSource: AnyObject {
    var onOutcome: (@MainActor (SecurityStatisticsOutcome) -> Void)? { get set }
    func load()
}

// MARK: - View model

/// The surface's observable view-model. Drives the load lifecycle (web `isLoading` →
/// resolved), keeps the last snapshot visible as cached, and layers freshness (stale /
/// offline) on top so SwiftUI can render every state from the state list.
@MainActor
@Observable
public final class SecurityStatisticsModel {
    public private(set) var phase: SecurityStatisticsPhase = .loading
    public private(set) var snapshot: SecurityStatsSnapshot?
    public private(set) var errorMessage: String?
    public private(set) var lastUpdatedAt: Date?
    public private(set) var isOffline = false

    @ObservationIgnored private let source: any SecurityStatisticsSource
    @ObservationIgnored private let telemetry: any SecurityStatisticsTelemetry
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private let stalenessWindow: TimeInterval
    @ObservationIgnored private var didStart = false
    @ObservationIgnored private var isFetching = false

    public init(
        source: any SecurityStatisticsSource,
        telemetry: any SecurityStatisticsTelemetry = OSLogSecurityStatisticsTelemetry(),
        now: @escaping @Sendable () -> Date = { Date() },
        stalenessWindow: TimeInterval = 60
    ) {
        self.source = source
        self.telemetry = telemetry
        self.now = now
        self.stalenessWindow = stalenessWindow
        source.onOutcome = { [weak self] outcome in self?.apply(outcome) }
    }

    /// Whether the displayed snapshot is older than the freshness window. Only a
    /// loaded snapshot can go stale (an error/empty is never "fresh data").
    public var isStale: Bool {
        guard phase == .loaded, let lastUpdatedAt else { return false }
        return now().timeIntervalSince(lastUpdatedAt) > stalenessWindow
    }

    /// Freshness/connectivity projection (mirrors `LiveConnectionState`, ADR-013).
    public var connection: SecurityStatisticsConnection {
        if isOffline { return .offline }
        if isStale { return .stale }
        return .live
    }

    /// Whether the freshness chip is shown (only once a snapshot is on screen).
    public var showsFreshness: Bool {
        phase == .loaded
    }

    /// The projected metric tiles for the current snapshot (empty when not loaded).
    public var tiles: [SecurityMetricTile] {
        guard let snapshot else { return [] }
        return SecurityStatisticsTiles.project(snapshot)
    }

    /// Emits the diagnostics `view.opened` event once and kicks off the initial load.
    /// Idempotent — safe to call from every `onAppear`.
    public func start() {
        guard !didStart else { return }
        didStart = true
        telemetry.viewOpened(surface: SecurityStatisticsSurface.slug)
        dispatchLoad()
    }

    /// Forces a fresh read (retry after an error, or manual/auto refresh when stale).
    public func reload() {
        dispatchLoad()
    }

    /// Auto-refresh affordance: reloads only when a loaded snapshot has gone stale.
    public func reloadIfStale() {
        guard phase == .loaded, isStale else { return }
        dispatchLoad()
    }

    private func dispatchLoad() {
        guard !isFetching else { return }
        isFetching = true
        phase = .loading
        errorMessage = nil
        source.load()
    }

    private func apply(_ outcome: SecurityStatisticsOutcome) {
        isFetching = false
        lastUpdatedAt = now()
        switch outcome {
        case let .loaded(snapshot):
            self.snapshot = snapshot
            phase = .loaded
            isOffline = false
            errorMessage = nil
        case .empty:
            snapshot = nil
            phase = .empty
            isOffline = false
            errorMessage = nil
        case let .failure(message):
            phase = .failed
            errorMessage = message
            isOffline = false
        case let .offline(message):
            isOffline = true
            if snapshot != nil {
                // Keep the last good snapshot visible behind the offline chip.
                phase = .loaded
            } else {
                phase = .failed
                errorMessage = message
            }
        }
    }
}

// MARK: - In-memory source (previews + tests; the view never performs I/O)

/// Deterministic source for previews and unit/UI tests. Constructed with a canned
/// outcome (delivered synchronously on `load()` when `autoResponds`), or driven
/// manually via `push(_:)` to script multi-step flows (e.g. loaded → offline).
@MainActor
public final class InMemorySecurityStatisticsSource: SecurityStatisticsSource {
    public var onOutcome: (@MainActor (SecurityStatisticsOutcome) -> Void)?
    public private(set) var loadCount = 0

    private let outcome: SecurityStatisticsOutcome?
    private let autoResponds: Bool

    public init(outcome: SecurityStatisticsOutcome? = nil, autoResponds: Bool = true) {
        self.outcome = outcome
        self.autoResponds = autoResponds
    }

    public func load() {
        loadCount += 1
        if autoResponds, let outcome {
            onOutcome?(outcome)
        }
    }

    /// Delivers an outcome to the bound model (deterministic test/preview affordance).
    public func push(_ outcome: SecurityStatisticsOutcome) {
        onOutcome?(outcome)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "SecurityStatistics" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time. The web source
/// keys (`admin.security.statsTitle`, `admin.security.stats.*`, `common.noData`) are
/// preserved verbatim so a shared catalog resolves identically across web and native.
public enum SecurityStatisticsStrings {
    public static let table = "SecurityStatistics"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
