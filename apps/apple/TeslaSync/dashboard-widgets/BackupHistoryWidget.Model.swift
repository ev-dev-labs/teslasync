//
//  BackupHistoryWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0008 · BackupHistoryWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the testable accessibility summary. The view binds through
//  `BackupHistoryModel`; no networking lives in the view. Mirrors the
//  established `SuperchargerHistoryModel` / `LocationFavoritesModel` seams so
//  every dashboard surface plugs into the same P4-core state-holder +
//  diagnostics contracts.
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
public protocol BackupHistoryTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogBackupHistoryTelemetry: BackupHistoryTelemetry {
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
/// cases the production source projects from `Resource<T>`.
public enum BackupHistoryLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). Drives the
/// freshness chip and the stale / offline banners.
public enum BackupHistoryConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `BackupHistorySource`: the cached events,
/// whether a Tesla Energy site is linked (the web `hasSites`), the active display
/// preferences, and the combined load/connection status of the two upstream
/// queries (`useTeslaEnergySites` + `useTeslaBackupHistory`). The model turns
/// this into the render projection.
public struct BackupHistoryUpdate: Sendable, Equatable {
    public var status: BackupHistoryLoadStatus
    public var connection: BackupHistoryConnection
    public var siteLinked: Bool
    public var events: [BackupHistoryEvent]
    public var options: BackupHistoryFormatOptions
    public var updatedAt: Date?

    public init(
        status: BackupHistoryLoadStatus = .loading,
        connection: BackupHistoryConnection = .live,
        siteLinked: Bool = false,
        events: [BackupHistoryEvent] = [],
        options: BackupHistoryFormatOptions = BackupHistoryFormatOptions(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.siteLinked = siteLinked
        self.events = events
        self.options = options
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`useTeslaEnergySites` for the site id +
/// `useTeslaBackupHistory` for the 30-day events, with the user `Settings`
/// supplying the format options); previews and tests use
/// `InMemoryBackupHistorySource`.
@MainActor
public protocol BackupHistorySource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (BackupHistoryUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `BackupHistorySource`,
/// recomputes the outage list + stats projection, and exposes a render `Phase` +
/// freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class BackupHistoryModel {
    /// The mutually-exclusive render branches. `noSite` is the web
    /// `!hasSites && !isLoading` empty state; `empty` is a linked site with no
    /// 30-day events; `error` is the native QueryError-equivalent for a failed
    /// fetch with nothing cached.
    public enum Phase: Equatable {
        case loading
        case noSite
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: BackupHistoryConnection = .live
    public private(set) var siteLinked = false
    public private(set) var projection = BackupHistoryProjection(
        rows: [],
        totalOutages: 0,
        totalOutagesText: "0",
        avgDurationText: "0s",
        siteLinked: false
    )
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any BackupHistorySource
    @ObservationIgnored private let telemetry: any BackupHistoryTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any BackupHistorySource,
        telemetry: any BackupHistoryTelemetry = OSLogBackupHistoryTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Whether the outage list has at least one row — the web `items.length > 0`
    /// switch.
    public var hasEvents: Bool {
        projection.hasEvents
    }

    /// Whether a one-column instance collapses to the compact layout — the web
    /// `size.cols <= 1` branch.
    public static func isCompact(for size: DashboardWidgetSize) -> Bool {
        size.cols <= 1
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: BackupHistoryWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached value stays visible). Wired to the
    /// retry / refresh affordances — the web `handleRefresh` (`refetchSites` +
    /// `refetchEvents`).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: BackupHistoryUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        siteLinked = update.siteLinked
        projection = BackupHistoryAdapter.project(
            events: update.events,
            siteLinked: update.siteLinked,
            options: update.options
        )
        phase = Self.resolvePhase(update.status, siteLinked: update.siteLinked, hasEvents: projection.hasEvents)
    }

    /// Resolves the render phase. Whenever there are events to show, the content
    /// renders and cached values stay visible behind refresh/errors. A failed
    /// fetch with nothing cached surfaces the error state; a resolved load with a
    /// linked site but no events is the empty state; a resolved load with no
    /// linked site is the `noSite` state — the web `!hasSites && !isLoading`
    /// branch.
    static func resolvePhase(
        _ status: BackupHistoryLoadStatus,
        siteLinked: Bool,
        hasEvents: Bool
    ) -> Phase {
        if hasEvents { return .content }
        switch status {
        case .loading:
            return .loading
        case let .failed(message):
            return .error(message)
        case .loaded, .empty:
            return siteLinked ? .empty : .noSite
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryBackupHistorySource: BackupHistorySource {
    public var onUpdate: (@MainActor (BackupHistoryUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: BackupHistoryUpdate?

    public init(initial: BackupHistoryUpdate? = nil) {
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
    public func push(_ update: BackupHistoryUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "BackupHistoryWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration.
public enum BackupHistoryStrings {
    public static let table = "BackupHistoryWidget"

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

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the widget and its rows. Pure + public
/// so the a11y label content can be unit-tested without rendering the view.
public enum BackupHistoryAccessibility {
    /// The full-size summary: title · outage count · average duration, or the
    /// no-site / no-events copy.
    public static func summary(siteLinked: Bool, outages: Int, avgDurationText: String) -> String {
        let title = BackupHistoryStrings.string("widget.backupHistory.title", "Backup History")
        guard siteLinked else {
            let noSite = BackupHistoryStrings.string("widget.backupHistory.noSite", "No Tesla Energy site linked")
            return "\(title). \(noSite)"
        }
        guard outages > 0 else {
            let noEvents = BackupHistoryStrings.string(
                "widget.backupHistory.noEvents",
                "No backup events in the last 30 days"
            )
            return "\(title). \(noEvents)"
        }
        let countPart = BackupHistoryStrings.count("widget.backupHistory.outagesCountA11y", "%lld outages", outages)
        let avgPart = BackupHistoryStrings.string("widget.backupHistory.avgDurationA11y", "Average duration %@")
            .replacingOccurrences(of: "%@", with: avgDurationText)
        return [title, countPart, avgPart].joined(separator: ". ")
    }

    /// The compact summary: the title + 30-day outage count.
    public static func compactSummary(outages: Int) -> String {
        let title = BackupHistoryStrings.string("widget.backupHistory.title", "Backup History")
        let label = BackupHistoryStrings.string("widget.backupHistory.outages30d", "Outages (30d)")
        return "\(title). \(label) \(outages)"
    }

    /// One outage row: the timestamp + its duration.
    public static func eventLabel(time: String, duration: String) -> String {
        BackupHistoryStrings.string("widget.backupHistory.eventA11y", "Outage on %1$@, duration %2$@")
            .replacingOccurrences(of: "%1$@", with: time)
            .replacingOccurrences(of: "%2$@", with: duration)
    }
}
