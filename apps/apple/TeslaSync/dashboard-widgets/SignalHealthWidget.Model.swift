//
//  SignalHealthWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0088 · SignalHealthWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the testable accessibility summary. The view binds through
//  `SignalHealthModel`; no networking lives in the view. Mirrors the established
//  `LiveSignalsModel` / `BackupHistoryModel` seams so every dashboard surface
//  plugs into the same P4-core state-holder + diagnostics contracts.
//
//  The production source wires this over the shared P1/S8 stores — the
//  `VehicleStore` (web `useVehicles`, resolving the active vehicle), the available
//  -signals store (web `useSignals` → `/signals/{id}/available`), the live-signal
//  store (web `useSignalGaps` → `/signals/{id}/live`), and the signal-stats store
//  (web `useSignalStats` → `/signals/{id}/stats`, whose load/fetch state drives
//  the shell freshness). Previews and tests drive `InMemorySignalHealthSource`.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for the surface. The default
/// logs via `os.Logger`; the production app injects an adapter that forwards to
/// the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016 §5), which
/// is consent-gated and redacted there.
public protocol SignalHealthTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogSignalHealthTelemetry: SignalHealthTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared `LoadableState`
/// cases the production source projects from the signal-stats query `Resource<T>`
/// (the web `statsLoading` / `statsError`, which drive the shell).
public enum SignalHealthLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). The web binds
/// the stats query's `isStale` / fetch state into the shell freshness chip; here
/// it also drives the stale / offline banners over cached coverage.
public enum SignalHealthConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `SignalHealthSource`: the cached
/// available-signal names (web `useSignals`, `nil` until resolved), the cached
/// live-signal map (web `useSignalGaps`, `nil` until resolved), whether the stats
/// query has resolved (web `stats` truthiness), the reference `now` the freshness
/// / gap ages are measured against, the format preferences, and the combined
/// load/connection status. The model turns this into the render projection.
public struct SignalHealthUpdate: Sendable, Equatable {
    public var status: SignalHealthLoadStatus
    public var connection: SignalHealthConnection
    public var signals: [String]?
    public var liveEntries: [String: SignalHealthLiveEntry]?
    public var statsAvailable: Bool
    public var now: Date
    public var options: SignalHealthFormatOptions
    public var updatedAt: Date?

    public init(
        status: SignalHealthLoadStatus = .loading,
        connection: SignalHealthConnection = .live,
        signals: [String]? = nil,
        liveEntries: [String: SignalHealthLiveEntry]? = nil,
        statsAvailable: Bool = false,
        now: Date = Date(),
        options: SignalHealthFormatOptions = SignalHealthFormatOptions(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.signals = signals
        self.liveEntries = liveEntries
        self.statsAvailable = statsAvailable
        self.now = now
        self.options = options
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders; previews and tests use
/// `InMemorySignalHealthSource`.
@MainActor
public protocol SignalHealthSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (SignalHealthUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `SignalHealthSource`,
/// recomputes the coverage projection via `SignalHealthAdapter`, and exposes a
/// render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class SignalHealthModel {
    /// The mutually-exclusive render branches. `empty` is the web
    /// `!hasData` state ("No signal health data"); `error` is the native
    /// QueryError-equivalent for a failed stats fetch with nothing cached.
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: SignalHealthConnection = .live
    public private(set) var projection: SignalHealthProjection = .empty
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any SignalHealthSource
    @ObservationIgnored private let telemetry: any SignalHealthTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any SignalHealthSource,
        telemetry: any SignalHealthTelemetry = OSLogSignalHealthTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Whether a one-column instance collapses to the compact layout — the web
    /// `size.cols <= 1` branch.
    public static func isCompact(for size: DashboardWidgetSize) -> Bool {
        size.cols <= 1
    }

    /// Whether a three-plus-column instance shows the stale / gap list — the web
    /// `size.cols >= 3` branch.
    public static func isWide(for size: DashboardWidgetSize) -> Bool {
        size.cols >= 3
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SignalHealthWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached coverage stays visible). Wired to the
    /// retry / refresh affordances — the web `handleRefresh` (`refetchStats`).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: SignalHealthUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        projection = SignalHealthAdapter.project(
            signals: update.signals,
            liveEntries: update.liveEntries,
            statsAvailable: update.statsAvailable,
            now: update.now,
            options: update.options
        )
        phase = Self.resolvePhase(update.status, hasData: projection.hasData)
    }

    /// Resolves the render phase. Whenever any source has resolved data the
    /// coverage renders and cached values stay visible behind refresh/errors — the
    /// web body always renders once `hasData` is truthy. A failed stats fetch with
    /// nothing cached surfaces the error state; a resolved load with no data is the
    /// empty "No signal health data" state.
    static func resolvePhase(_ status: SignalHealthLoadStatus, hasData: Bool) -> Phase {
        if hasData { return .content }
        switch status {
        case .loading:
            return .loading
        case let .failed(message):
            return .error(message)
        case .loaded, .empty:
            return .empty
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemorySignalHealthSource: SignalHealthSource {
    public var onUpdate: (@MainActor (SignalHealthUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SignalHealthUpdate?

    public init(initial: SignalHealthUpdate? = nil) {
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
    public func push(_ update: SignalHealthUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "SignalHealthWidget" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time; they
/// are kept in a per-surface table so each parallel surface prompt owns its own
/// strings without editing the shared catalog.
public enum SignalHealthStrings {
    public static let table = "SignalHealthWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }
}

// MARK: - Health level presentation (status copy)

extension SignalHealthLevel {
    /// The status-badge copy — the web `'Healthy' | 'Degraded' | 'Critical' |
    /// 'Unknown'` switch.
    var statusText: String {
        switch self {
        case .green:
            SignalHealthStrings.string("widget.signalHealth.healthy", "Healthy")
        case .amber:
            SignalHealthStrings.string("widget.signalHealth.degraded", "Degraded")
        case .red:
            SignalHealthStrings.string("widget.signalHealth.critical", "Critical")
        case .neutral:
            SignalHealthStrings.string("widget.signalHealth.unknown", "Unknown")
        }
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the widget and its rows. Pure + public so
/// the a11y label content can be unit-tested without rendering the view.
public enum SignalHealthAccessibility {
    /// The full summary: title · total / active / gap counts · freshness · status,
    /// or the no-data copy.
    public static func summary(for projection: SignalHealthProjection) -> String {
        let title = SignalHealthStrings.string("widget.signalHealth.title", "Signal Health")
        guard projection.hasData else {
            let noData = SignalHealthStrings.string("widget.signalHealth.noData", "No signal health data")
            return "\(title). \(noData)"
        }
        let total = SignalHealthStrings.count(
            "widget.signalHealth.totalA11y",
            "%lld total signals",
            projection.totalSignals
        )
        let active = SignalHealthStrings.count(
            "widget.signalHealth.activeA11y",
            "%lld active",
            projection.activeCount
        )
        let gaps = SignalHealthStrings.count(
            "widget.signalHealth.gapsA11y",
            "%lld with gaps",
            projection.staleCount
        )
        let freshnessLabel = SignalHealthStrings.string("widget.signalHealth.freshness", "Freshness")
        let freshness = "\(freshnessLabel) \(projection.freshnessText)"
        let statusLabel = SignalHealthStrings.string("widget.signalHealth.status", "Status")
        let status = "\(statusLabel) \(projection.healthLevel.statusText)"
        return [title, total, active, gaps, freshness, status].joined(separator: ". ")
    }

    /// One stale / gap row: the signal name + its last-seen relative time.
    public static func gapLabel(name: String, lastSeen: String) -> String {
        SignalHealthStrings.string("widget.signalHealth.gapA11y", "Signal %1$@, last seen %2$@")
            .replacingOccurrences(of: "%1$@", with: name)
            .replacingOccurrences(of: "%2$@", with: lastSeen)
    }
}
