//
//  ScheduledExportsPanel.Seams.swift
//  TeslaSync — P4 feature view · 0262 · ScheduledExportsPanel (Apple)
//
//  The dependency seams the ScheduledExportsPanel view-model binds through, kept apart
//  from the model for the lint length budget: the P1/S11 telemetry contract, the P1/S10
//  i18n facade (web `useTranslation`), the date-formatting facade (web `TimeStamp`), the
//  CRUD mutator seam (web `useCreateScheduledExport` / `useUpdateScheduledExport` /
//  `useDeleteScheduledExport` / `useRunScheduledExportNow`), the coalesced source
//  snapshot, the P1/S8 source protocol, the in-memory source for previews/tests, and the
//  VoiceOver string builder.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core
/// diagnostics sink (consent-gated + redacted there).
public protocol ScheduledExportsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`. The slug
/// is a static, non-identifying constant.
public struct OSLogScheduledExportsTelemetry: ScheduledExportsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold
/// no hardcoded literals. Keys live in the "ScheduledExportsPanel" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time; kept per-surface so each
/// parallel prompt owns its own strings.
public enum ScheduledExportsStrings {
    public static let table = "ScheduledExportsPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Convenience for body interpolation (`{{name}}` etc.): resolves then substitutes.
    public static func string(_ key: String, _ fallback: String, _ token: String, _ value: String) -> String {
        string(key, fallback).replacingOccurrences(of: token, with: value)
    }
}

// MARK: - Date-formatting facade (web `TimeStamp` / `useDateFormat`)

/// Formats the "Next run" / "Last run" timestamps the rows render. Production injects a
/// settings-backed implementation (locale + 12/24h from `useSettings`); previews/tests use
/// `DefaultScheduledExportsDateFormatting`.
public protocol ScheduledExportsDateFormatting: Sendable {
    func dateTime(_ date: Date) -> String
}

/// Bundle-free default: a medium date + short time, matching the web relative/absolute
/// `TimeStamp` default closely enough for parity. Stateless + `Sendable`.
public struct DefaultScheduledExportsDateFormatting: ScheduledExportsDateFormatting {
    private let localeIdentifier: String

    public init(localeIdentifier: String = "en_US") {
        self.localeIdentifier = localeIdentifier
    }

    public func dateTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

// MARK: - CRUD mutator seam (web mutation hooks)

/// The four mutations the panel drives. The model awaits a boolean result, then refreshes
/// the bound source on success (web invalidates the `scheduled-exports` query). All
/// networking lives behind this seam so the view never talks to the network directly.
public protocol ScheduledExportsMutator: Sendable {
    /// Create (when `editingID` is `nil`, web `useCreateScheduledExport`) or update (web
    /// `useUpdateScheduledExport`) a schedule from the normalised form. Returns success.
    func save(form: ScheduledExportFormState, editingID: Int?) async -> Bool

    /// Toggle a schedule's enabled flag (web `toggleEnabled` → `useUpdateScheduledExport`
    /// with `enabled` flipped). Returns success.
    func setEnabled(item: ScheduledExportItem, enabled: Bool) async -> Bool

    /// Delete a schedule by id (web `useDeleteScheduledExport`). Returns success.
    func delete(id: Int) async -> Bool

    /// Manually trigger a schedule's next run (web `useRunScheduledExportNow`). Returns
    /// success.
    func runNow(id: Int) async -> Bool
}

/// `os.Logger`-backed default that records the intent without networking, so previews
/// render the CRUD chrome safely. Reports success so the bound source refreshes.
public struct OSLogScheduledExportsMutator: ScheduledExportsMutator {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "scheduled-exports")
    }

    public func save(form: ScheduledExportFormState, editingID: Int?) async -> Bool {
        logger.info("scheduled-exports.save editing=\(editingID.map(String.init) ?? "new", privacy: .public)")
        _ = form
        return true
    }

    public func setEnabled(item: ScheduledExportItem, enabled: Bool) async -> Bool {
        logger.info("scheduled-exports.setEnabled id=\(item.id, privacy: .public) enabled=\(enabled, privacy: .public)")
        return true
    }

    public func delete(id: Int) async -> Bool {
        logger.info("scheduled-exports.delete id=\(id, privacy: .public)")
        return true
    }

    public func runNow(id: Int) async -> Bool {
        logger.info("scheduled-exports.runNow id=\(id, privacy: .public)")
        return true
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `ScheduledExportsSource`: the load status, the
/// resolved rows, the live-state freshness, the in-flight refresh flag, and the
/// last-updated timestamp.
public struct ScheduledExportsUpdate: Sendable, Equatable {
    public var status: ScheduledExportsLoadStatus
    public var items: [ScheduledExportItem]
    public var connection: ScheduledExportsConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: ScheduledExportsLoadStatus = .loading,
        items: [ScheduledExportItem] = [],
        connection: ScheduledExportsConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.items = items
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8
/// scheduled-exports state holder (the `useScheduledExports` 60s-polling query); previews/
/// tests use `InMemoryScheduledExportsSource`. The view never talks to the network.
@MainActor
public protocol ScheduledExportsSource: AnyObject {
    var onUpdate: (@MainActor (ScheduledExportsUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web list invalidation after a mutation / the stale
    /// auto-refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryScheduledExportsSource: ScheduledExportsSource {
    public var onUpdate: (@MainActor (ScheduledExportsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ScheduledExportsUpdate?

    public init(initial: ScheduledExportsUpdate? = nil) {
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
    public func push(_ update: ScheduledExportsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer +
/// date formatter so the summaries are testable without a bundle.
public enum ScheduledExportsAccessibility {
    /// The section header summary: title + schedule count.
    public static func sectionSummary(count: Int, localize: (String, String) -> String) -> String {
        let title = localize("dataExport.scheduled.title", "Scheduled exports")
        return "\(title): \(count)"
    }

    /// One row's VoiceOver label: name · type (format) · cron · delivery · status, each
    /// resolved through the same facades the row renders with.
    public static func rowLabel(
        _ item: ScheduledExportItem,
        dates: ScheduledExportsDateFormatting,
        localize: (String, String) -> String
    ) -> String {
        let cronHeader = localize("dataExport.scheduled.table.cron", "Cron")
        let deliveryHeader = localize("dataExport.scheduled.table.delivery", "Delivery")
        var parts: [String] = [item.name]
        parts.append(item.typeFormatLabel(localize: localize))
        parts.append("\(cronHeader): \(item.scheduleCron)")
        parts.append("\(deliveryHeader): \(item.deliveryLabel(localize: localize))")
        parts.append(statusFragment(item, dates: dates, localize: localize))
        if !item.enabled {
            parts.append(localize("dataExport.scheduled.actions.enable", "Enable"))
        }
        return parts.joined(separator: ", ")
    }

    /// The status arm of the row label: "OK" / "Failed" plus the last-run time, or the
    /// "Never" wording when the schedule has not yet run.
    private static func statusFragment(
        _ item: ScheduledExportItem,
        dates: ScheduledExportsDateFormatting,
        localize: (String, String) -> String
    ) -> String {
        guard let lastRunAt = item.lastRunAt else {
            return localize("dataExport.scheduled.status.never", "Never")
        }
        let status: String = switch item.lastStatus {
        case .ok: localize("dataExport.scheduled.status.ok", "OK")
        case .failed: localize("dataExport.scheduled.status.failed", "Failed")
        case .none: "—"
        }
        return "\(status), \(dates.dateTime(lastRunAt))"
    }
}
