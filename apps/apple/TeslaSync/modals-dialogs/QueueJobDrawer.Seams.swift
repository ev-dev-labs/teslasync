//
//  QueueJobDrawer.Seams.swift
//  TeslaSync — P4 modal / dialog · 0020 · QueueJobDrawer (Apple)
//
//  The dependency seams the QueueJobDrawer view-model binds through, kept apart from the model
//  for the lint length budget: the P1/S11 telemetry contract, the P1/S10 i18n facade (web
//  `useTranslation`), the absolute date/time facade (web `formatDateTime`), the coalesced source
//  snapshot, the P1/S8 jobs-source protocol, the in-memory source for previews/tests, and the
//  VoiceOver string builder.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core
/// diagnostics sink (consent-gated + redacted there).
public protocol QueueJobDrawerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`. The slug is a
/// static, non-identifying constant.
public struct OSLogQueueJobDrawerTelemetry: QueueJobDrawerTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "QueueJobDrawer" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel
/// prompt owns its own strings.
public enum QueueJobDrawerStrings {
    public static let table = "QueueJobDrawer"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Convenience for body interpolation (`{{at}}` / `{{duration}}` / `{{worker}}`): resolves
    /// then substitutes a single token.
    public static func string(
        _ key: String,
        _ fallback: String,
        _ token: String,
        _ value: String
    ) -> String {
        string(key, fallback).replacingOccurrences(of: token, with: value)
    }

    /// The localized status word — web `t(\`queueStatus.jobStatus.${status}\`, status)`. An
    /// unmapped status falls back to the raw token verbatim, exactly as the web default arm does.
    public static func statusLabel(_ status: String) -> String {
        string("queueStatus.jobStatus.\(status)", status)
    }
}

// MARK: - Date facade (web `formatDateTime`)

/// Resolves an absolute instant into the row's "Started …" copy (web `formatDateTime`).
/// Production injects a settings-backed implementation (locale + tz + 12/24h from `useSettings`);
/// previews/tests use a deterministic stub so the projection is verifiable without a locale.
public protocol QueueJobDateFormatting: Sendable {
    func dateTime(_ date: Date) -> String
}

/// Bundle-/locale-resolving default: a medium date + short time, matching the web
/// `formatDateTime` (`toLocaleString` with `month: short, day/year numeric, hour/minute 2-digit`).
/// Stateless + `Sendable`.
public struct DefaultQueueJobDateFormatting: QueueJobDateFormatting {
    private let localeIdentifier: String?
    private let timeZone: TimeZone?

    public init(localeIdentifier: String? = nil, timeZone: TimeZone? = nil) {
        self.localeIdentifier = localeIdentifier
        self.timeZone = timeZone
    }

    public func dateTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        if let localeIdentifier { formatter.locale = Locale(identifier: localeIdentifier) }
        if let timeZone { formatter.timeZone = timeZone }
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `QueueJobsSource`: the load status, the resolved jobs, the
/// live-state freshness, the in-flight refresh flag, and the last-updated timestamp.
public struct QueueJobsUpdate: Sendable, Equatable {
    public var status: QueueJobLoadStatus
    public var jobs: [QueueJobRowData]
    public var connection: QueueJobDrawerConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: QueueJobLoadStatus = .loading,
        jobs: [QueueJobRowData] = [],
        connection: QueueJobDrawerConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.jobs = jobs
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8 queue-jobs
/// state holder (the `useQueueJobs` 60s-polling query, gated on `open && worker`); previews/tests
/// use `InMemoryQueueJobsSource`. The view never talks to the network.
@MainActor
public protocol QueueJobsSource: AnyObject {
    var onUpdate: (@MainActor (QueueJobsUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web poll tick / the error-state retry / stale refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()`
/// and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryQueueJobsSource: QueueJobsSource {
    public var onUpdate: (@MainActor (QueueJobsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: QueueJobsUpdate?

    public init(initial: QueueJobsUpdate? = nil) {
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
    public func push(_ update: QueueJobsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the
/// summaries are testable without a bundle.
public enum QueueJobDrawerAccessibility {
    /// The close affordance's label (web close `aria-label="Close"`).
    public static func closeLabel(localize: (String, String) -> String) -> String {
        localize("queueStatus.drawer.close", "Close")
    }

    /// One row's VoiceOver label: title, status word, the trailing detail line, and any error.
    public static func rowLabel(
        title: String,
        status: String,
        detail: String,
        errorMessage: String?
    ) -> String {
        var parts = [title, status, detail]
        if let errorMessage, !errorMessage.isEmpty {
            parts.append(errorMessage)
        }
        return parts.joined(separator: ", ")
    }
}
