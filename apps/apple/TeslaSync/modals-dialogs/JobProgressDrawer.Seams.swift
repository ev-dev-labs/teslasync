//
//  JobProgressDrawer.Seams.swift
//  TeslaSync — P4 modal / dialog · 0005 · JobProgressDrawer (Apple)
//
//  The dependency seams the JobProgressDrawer view-model binds through, kept apart from the
//  model for the lint length budget: the P1/S11 telemetry contract, the P1/S10 i18n facade
//  (web `useTranslation`), the relative/absolute date facade (web `formatRelative`), the
//  persisted drawer-state store (web `localStorage`), the download action seam (web
//  `exportDownloadUrl` anchor), the coalesced source snapshot, the P1/S8 source protocol, the
//  in-memory source for previews/tests, and the VoiceOver string builder.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core
/// diagnostics sink (consent-gated + redacted there).
public protocol JobProgressDrawerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`. The slug is a
/// static, non-identifying constant.
public struct OSLogJobProgressDrawerTelemetry: JobProgressDrawerTelemetry {
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
/// hardcoded literals. Keys live in the "JobProgressDrawer" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel
/// prompt owns its own strings.
public enum JobProgressDrawerStrings {
    public static let table = "JobProgressDrawer"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Convenience for body interpolation (`{{count}}` etc.): resolves then substitutes.
    public static func string(
        _ key: String,
        _ fallback: String,
        _ token: String,
        _ value: String
    ) -> String {
        string(key, fallback).replacingOccurrences(of: token, with: value)
    }
}

// MARK: - Date facade (web `formatRelative` + absolute fallback)

/// Resolves a structured `ExportDrawerRelative` into display copy. Production injects a
/// settings-backed implementation (locale + 12/24h from `useSettings`); previews/tests use
/// `DefaultExportDrawerDateFormatting`.
public protocol ExportDrawerDateFormatting: Sendable {
    func relative(_ value: ExportDrawerRelative) -> String
}

/// Bundle-resolving default: the relative buckets resolve through the P1/S10 facade (so the
/// copy is translatable) and the absolute fallback uses a medium date, matching the web
/// `formatRelative` tail. Stateless + `Sendable`.
public struct DefaultExportDrawerDateFormatting: ExportDrawerDateFormatting {
    private let localeIdentifier: String

    public init(localeIdentifier: String = "en_US") {
        self.localeIdentifier = localeIdentifier
    }

    public func relative(_ value: ExportDrawerRelative) -> String {
        switch value {
        case .empty:
            "—"
        case .justNow:
            JobProgressDrawerStrings.string("export.jobDrawer.relative.justNow", "just now")
        case let .minutes(count):
            JobProgressDrawerStrings.string(
                "export.jobDrawer.relative.minutes", "{{count}}m ago", "{{count}}", String(count)
            )
        case let .hours(count):
            JobProgressDrawerStrings.string(
                "export.jobDrawer.relative.hours", "{{count}}h ago", "{{count}}", String(count)
            )
        case let .days(count):
            JobProgressDrawerStrings.string(
                "export.jobDrawer.relative.days", "{{count}}d ago", "{{count}}", String(count)
            )
        case let .absolute(date):
            absolute(date)
        }
    }

    private func absolute(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }
}

// MARK: - Persisted drawer-state store (web `localStorage`)

/// Reads/writes the persisted drawer state (web `STORAGE_KEY`/`readPersistedState`/
/// `writePersistedState`). The view-model loads the seed once and writes back on every
/// presentation change so the choice survives relaunch.
public protocol JobDrawerPresentationStore: Sendable {
    func load() -> JobDrawerPresentation
    func save(_ presentation: JobDrawerPresentation)
}

/// `UserDefaults`-backed default. Mirrors the web seed (absent / unknown → `minimized`).
public struct UserDefaultsJobDrawerPresentationStore: JobDrawerPresentationStore {
    public static let storageKey = "teslasync.exportDrawer.state"

    private let suiteName: String?

    public init(suiteName: String? = nil) {
        self.suiteName = suiteName
    }

    private var defaults: UserDefaults {
        suiteName.flatMap(UserDefaults.init(suiteName:)) ?? .standard
    }

    public func load() -> JobDrawerPresentation {
        guard let raw = defaults.string(forKey: Self.storageKey),
              let value = JobDrawerPresentation(rawValue: raw)
        else {
            return .minimized
        }
        return value
    }

    public func save(_ presentation: JobDrawerPresentation) {
        defaults.set(presentation.rawValue, forKey: Self.storageKey)
    }
}

/// In-memory store for previews + unit tests. Lock-guarded so it satisfies the `Sendable`
/// store seam under Swift 6 strict concurrency.
public final class InMemoryJobDrawerPresentationStore: JobDrawerPresentationStore, @unchecked Sendable {
    private let lock = NSLock()
    private var value: JobDrawerPresentation

    public init(initial: JobDrawerPresentation = .minimized) {
        value = initial
    }

    public func load() -> JobDrawerPresentation {
        lock.lock()
        defer { lock.unlock() }
        return value
    }

    public func save(_ presentation: JobDrawerPresentation) {
        lock.lock()
        value = presentation
        lock.unlock()
    }
}

// MARK: - Download action seam (web `exportDownloadUrl` anchor)

/// The single action the drawer drives — opening a finished job's artifact (web the `ready`
/// row's `<a href={exportDownloadUrl(job.id)}>`). The default logs the intent without
/// networking so previews render safely; the app injects an opener that resolves the
/// `request()` base + presents the system download.
public protocol ExportDrawerActions: Sendable {
    func download(_ job: ExportDrawerJob)
}

/// `os.Logger`-backed default that records the download intent without networking.
public struct OSLogExportDrawerActions: ExportDrawerActions {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "export-drawer")
    }

    public func download(_ job: ExportDrawerJob) {
        logger.info("export-drawer.download id=\(job.id, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by an `ExportDrawerJobsSource`: the load status, the resolved
/// jobs, the live-state freshness, the in-flight refresh flag, and the last-updated timestamp.
public struct ExportDrawerJobsUpdate: Sendable, Equatable {
    public var status: ExportDrawerLoadStatus
    public var jobs: [ExportDrawerJob]
    public var connection: ExportDrawerConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: ExportDrawerLoadStatus = .loading,
        jobs: [ExportDrawerJob] = [],
        connection: ExportDrawerConnection = .live,
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

/// The seam the view binds through. Production implements this over the shared P1/S8 export
/// jobs state holder (the `useExportJobs` 5s-polling query); previews/tests use
/// `InMemoryExportDrawerJobsSource`. The view never talks to the network.
@MainActor
public protocol ExportDrawerJobsSource: AnyObject {
    var onUpdate: (@MainActor (ExportDrawerJobsUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web poll tick / the error-state retry / stale refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryExportDrawerJobsSource: ExportDrawerJobsSource {
    public var onUpdate: (@MainActor (ExportDrawerJobsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ExportDrawerJobsUpdate?

    public init(initial: ExportDrawerJobsUpdate? = nil) {
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
    public func push(_ update: ExportDrawerJobsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the
/// summaries are testable without a bundle.
public enum JobProgressDrawerAccessibility {
    /// The minimized chip's label (web `aria-label="Show export jobs ({{count}} active)"`).
    public static func minimizedLabel(activeCount: Int, localize: (String, String) -> String) -> String {
        localize("export.jobDrawer.expand", "Show export jobs ({{count}} active)")
            .replacingOccurrences(of: "{{count}}", with: String(activeCount))
    }

    /// The open panel's region label (web `aria-label="Export job progress"`).
    public static func panelLabel(localize: (String, String) -> String) -> String {
        localize("export.jobDrawer.label", "Export job progress")
    }

    /// One row's VoiceOver label: type, format, status, the trailing detail, and any error.
    public static func rowLabel(
        type: String,
        format: String,
        status: String,
        detail: String,
        errorMessage: String?
    ) -> String {
        var parts = [type, format, status, detail]
        if let errorMessage, !errorMessage.isEmpty {
            parts.append(errorMessage)
        }
        return parts.joined(separator: ", ")
    }
}
