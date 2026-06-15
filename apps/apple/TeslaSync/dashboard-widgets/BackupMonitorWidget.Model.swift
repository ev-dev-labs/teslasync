//
//  BackupMonitorWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0009 · BackupMonitorWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the canonical registry metadata + the testable accessibility summary. The
//  view binds through `BackupMonitorModel`; no networking lives in the view.
//  Mirrors the established `SoftwareUpdateHistoryWidget.Model` /
//  `LifetimeStatsWidget.Model` seams so every dashboard surface plugs into the
//  same P4-core state-holder + diagnostics contracts.
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
public protocol BackupMonitorTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogBackupMonitorTelemetry: BackupMonitorTelemetry {
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
public enum BackupMonitorLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum BackupMonitorConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `BackupMonitorSource`: the cached backup
/// runs plus their load/connection status. The model turns this into the render
/// projection.
public struct BackupMonitorUpdate: Sendable, Equatable {
    public var status: BackupMonitorLoadStatus
    public var connection: BackupMonitorConnection
    public var runs: [BackupMonitorRun]
    public var updatedAt: Date?

    public init(
        status: BackupMonitorLoadStatus = .loading,
        connection: BackupMonitorConnection = .live,
        runs: [BackupMonitorRun] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.runs = runs
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`useBackupRuns` projected from the KMP admin
/// store, refetched on the web `INTERVALS.FAST` cadence); previews and tests use
/// `InMemoryBackupMonitorSource`.
@MainActor
public protocol BackupMonitorSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (BackupMonitorUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `BackupMonitorSource`,
/// recomputes the latest-badge + stat-grid + recent-runs projection, and exposes
/// a render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class BackupMonitorModel {
    /// The mutually-exclusive render branches (web shell loading / empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: BackupMonitorConnection = .live
    public private(set) var latest: BackupLatest?
    public private(set) var recentRows: [BackupRunRow] = []
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any BackupMonitorSource
    @ObservationIgnored private let telemetry: any BackupMonitorTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any BackupMonitorSource,
        telemetry: any BackupMonitorTelemetry = OSLogBackupMonitorTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Whether there is at least one cached backup run to show.
    public var hasRuns: Bool {
        latest != nil
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: BackupMonitorSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached value stays visible). Wired to the
    /// retry / refresh affordances.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: BackupMonitorUpdate) {
        let now = Date()
        connection = update.connection
        updatedAt = update.updatedAt
        latest = BackupMonitorProjection.latest(from: update.runs, now: now)
        recentRows = BackupMonitorProjection.recentRows(from: update.runs)
        phase = Self.resolvePhase(update.status, hasData: !update.runs.isEmpty)
    }

    /// Resolves the render phase. Whenever there is cached history to show, the
    /// content renders and stays visible behind refresh/errors (the web keeps the
    /// last grid under the freshness/error dot). The top-level empty/error states
    /// are reserved for a resolved load / failure with nothing cached.
    static func resolvePhase(_ status: BackupMonitorLoadStatus, hasData: Bool) -> Phase {
        switch status {
        case .loading:
            hasData ? .content : .loading
        case .loaded, .empty:
            hasData ? .content : .empty
        case let .failed(message):
            hasData ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryBackupMonitorSource: BackupMonitorSource {
    public var onUpdate: (@MainActor (BackupMonitorUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: BackupMonitorUpdate?

    public init(initial: BackupMonitorUpdate? = nil) {
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
    public func push(_ update: BackupMonitorUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface metadata (slug + canonical registry entry)

/// The surface's stable identity: the P1/S11 diagnostics slug and the canonical
/// dashboard-registry entry (web `registry/system.ts → "backup-monitor"`).
/// Decoupled from the SwiftUI view so the model + projection compile/test without
/// the design system.
public enum BackupMonitorSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "BackupMonitorWidget"

    /// Canonical registry metadata (registry/system.ts → "backup-monitor").
    public static let registration = DashboardWidgetRegistration(
        id: "backup-monitor",
        nameKey: "widget.backupMonitor.title",
        descriptionKey: "widget.backupMonitor.description",
        category: "system",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "BackupMonitorWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration.
public enum BackupMonitorStrings {
    public static let table = "BackupMonitorWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }

    /// The localized status label for a run status (`Success` / `Running` /
    /// `Queued` / `Failed`), the native localization of the web `statusLabel`.
    public static func label(for status: BackupMonitorRunStatus) -> String {
        string(status.labelKey, status.labelFallback)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the widget compact badge / stat grid /
/// recent rows. Pure + public so the a11y label content can be unit-tested
/// without rendering.
public enum BackupMonitorAccessibility {
    /// The compact-badge summary: "{last backup}, {status}" — e.g. "2m ago, Success".
    public static func compactSummary(_ latest: BackupLatest) -> String {
        "\(latest.lastBackupRelative), \(latest.statusLabel)"
    }

    /// The stat-grid summary: every tile read as one phrase.
    public static func gridSummary(_ latest: BackupLatest) -> String {
        let lastBackup = BackupMonitorStrings.string("widget.backupMonitor.lastBackup", "Last backup")
        let size = BackupMonitorStrings.string("widget.backupMonitor.size", "Backup Size")
        let type = BackupMonitorStrings.string("widget.backupMonitor.type", "Type")
        let status = BackupMonitorStrings.string("widget.backupMonitor.status", "Status")
        return "\(lastBackup): \(latest.lastBackupRelative). "
            + "\(size): \(latest.sizeText). "
            + "\(type): \(latest.typeText). "
            + "\(status): \(latest.statusLabel)."
    }

    /// One recent-run row spoken label: "{time}. {status}. {detail}".
    public static func rowSummary(_ row: BackupRunRow) -> String {
        "\(row.timeText). \(row.statusLabel). \(row.detailText)"
    }
}
