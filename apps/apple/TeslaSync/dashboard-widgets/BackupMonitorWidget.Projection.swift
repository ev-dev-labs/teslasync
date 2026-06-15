//
//  BackupMonitorWidget.Projection.swift
//  TeslaSync — P4 dashboard widget · 0009 · BackupMonitorWidget (Apple)
//
//  The pure, SwiftUI-free adapter layer: the cached DTO the state holder pushes
//  (`BackupMonitorRun`) and the projection that turns the database-backup history into
//  the view's render model — the compact "last backup" badge, the 2×2 stat grid,
//  and the wide "Recent Runs" rows. This is a 1:1 port of the web source's
//  `statusVariant` / `statusLabel` / `statusDotColor` maps, the `sortedRuns` +
//  `latestRun` memos, the `fmtBytes` + `fmtRelativeTime` helpers, and the
//  `slice(0, 5)` recent-runs window
//  (features/dashboard/widgets/BackupMonitorWidget.tsx). Kept free of SwiftUI so
//  the adapter is unit-testable without rendering.
//

import Foundation

// MARK: - Status (port of the web union + statusVariant/statusLabel/statusDotColor)

/// The backup-run lifecycle status — the four web union members
/// (`completed` / `failed` / `running` / `queued`) plus an `other` escape hatch
/// for forward-compatibility (the runtime value is a free `string`). The `tone`
/// mirrors the web `statusVariant`/`statusDotColor` (success/warning/danger) and
/// the label resolves through the i18n facade exactly like `statusLabel`.
public enum BackupMonitorRunStatus: Sendable, Equatable {
    case completed
    case failed
    case running
    case queued
    case other(String)

    /// Parses the wire string into a case, matching the web union members; any
    /// unrecognized value is retained verbatim as `.other`.
    public init(raw: String) {
        switch raw {
        case "completed": self = .completed
        case "failed": self = .failed
        case "running": self = .running
        case "queued": self = .queued
        default: self = .other(raw)
        }
    }

    /// The canonical wire value (round-trips `init(raw:)`).
    public var rawValue: String {
        switch self {
        case .completed: "completed"
        case .failed: "failed"
        case .running: "running"
        case .queued: "queued"
        case let .other(value): value
        }
    }

    /// The i18n key for the status label — port of the web `statusLabel`
    /// (completed→Success, running→Running, queued→Queued, else→Failed).
    public var labelKey: String {
        switch self {
        case .completed: "widget.backupMonitor.statusSuccess"
        case .running: "widget.backupMonitor.statusRunning"
        case .queued: "widget.backupMonitor.statusQueued"
        case .failed, .other: "widget.backupMonitor.statusFailed"
        }
    }

    /// The English fallback for the status label (web `statusLabel` returns
    /// "Failed" for anything that is not completed/running/queued).
    public var labelFallback: String {
        switch self {
        case .completed: "Success"
        case .running: "Running"
        case .queued: "Queued"
        case .failed, .other: "Failed"
        }
    }

    /// The badge / dot tone — port of the web `statusVariant` (completed→success,
    /// running|queued→warning, else→danger), which the source also reuses for the
    /// status dot color (`statusDotColor`).
    public var tone: BackupTone {
        switch self {
        case .completed: .success
        case .running, .queued: .warning
        case .failed, .other: .danger
        }
    }

    /// Whether this is the exact `failed` status — the web tints the Status tile
    /// background red only when `latestStatus === 'failed'`.
    public var isFailed: Bool {
        self == .failed
    }
}

/// The semantic tone a backup badge / dot carries. SwiftUI-free so the
/// projection stays renderer-agnostic; the view layer maps each case onto a
/// `Color.TS` token.
public enum BackupTone: Sendable, Equatable {
    case success
    case warning
    case danger
}

// MARK: - Cached DTO input (port of the web `BackupMonitorRun`)

/// One database-backup record — the native projection of a single web
/// `BackupMonitorRun` row (`@/types/admin`). `completedAt`/`createdAt` are optional
/// `Date`s; the projection resolves the display timestamp with the same
/// `completedAt ?? createdAt` precedence the web source uses.
public struct BackupMonitorRun: Sendable, Equatable, Identifiable {
    public let id: String
    public var status: BackupMonitorRunStatus
    public var backupType: String?
    public var fileSize: Int
    public var durationMs: Int?
    public var createdAt: Date?
    public var completedAt: Date?

    public init(
        id: String,
        status: BackupMonitorRunStatus = .failed,
        backupType: String? = nil,
        fileSize: Int = 0,
        durationMs: Int? = nil,
        createdAt: Date? = nil,
        completedAt: Date? = nil
    ) {
        self.id = id
        self.status = status
        self.backupType = backupType
        self.fileSize = fileSize
        self.durationMs = durationMs
        self.createdAt = createdAt
        self.completedAt = completedAt
    }
}

// MARK: - Render model (port of the StatCard grid + WidgetEventFeed rows)

/// The headline summary for the latest backup (web `latestRun`) — the values the
/// compact badge and the 2×2 stat grid render. Pre-formatted so the views are
/// pure renderers and the formatting is unit-testable.
public struct BackupLatest: Sendable, Equatable {
    public var lastBackupRelative: String
    public var sizeText: String
    public var typeText: String
    public var statusLabel: String
    public var statusTone: BackupTone
    public var showsFailedBackground: Bool

    public init(
        lastBackupRelative: String,
        sizeText: String,
        typeText: String,
        statusLabel: String,
        statusTone: BackupTone,
        showsFailedBackground: Bool
    ) {
        self.lastBackupRelative = lastBackupRelative
        self.sizeText = sizeText
        self.typeText = typeText
        self.statusLabel = statusLabel
        self.statusTone = statusTone
        self.showsFailedBackground = showsFailedBackground
    }
}

/// One "Recent Runs" row (web wide-layout list item): the absolute timestamp, the
/// "size · duration" detail line, and the status chip.
public struct BackupRunRow: Sendable, Equatable, Identifiable {
    public let id: String
    public var timeText: String
    public var detailText: String
    public var statusLabel: String
    public var statusTone: BackupTone

    public init(
        id: String,
        timeText: String,
        detailText: String,
        statusLabel: String,
        statusTone: BackupTone
    ) {
        self.id = id
        self.timeText = timeText
        self.detailText = detailText
        self.statusLabel = statusLabel
        self.statusTone = statusTone
    }
}

// MARK: - Projection (cached DTOs → render model)

/// Pure transforms from the cached `BackupMonitorRun` history to the render model. The
/// state holder calls these; the view never recomputes them.
public enum BackupMonitorProjection {
    /// The em-dash sentinel the web shows for a missing value (`?? '—'`).
    static let dash = "—"

    /// The number of rows the wide feed renders — the web `slice(0, 5)`.
    public static let maxRecentRows = 5

    /// Resolves the row timestamp used for SORTING, with the web precedence
    /// `completedAt ?? createdAt ?? epoch(0)` (the source feeds the coalesced
    /// value to `new Date(...)`, which yields the epoch for a missing date).
    static func sortTimestamp(for run: BackupMonitorRun) -> Date {
        run.completedAt ?? run.createdAt ?? Date(timeIntervalSince1970: 0)
    }

    /// Resolves the timestamp used for DISPLAY, with the web precedence
    /// `completedAt ?? createdAt` and NO epoch fallback — a missing date renders
    /// as the dash sentinel (web `?? null → '—'`).
    static func displayTimestamp(for run: BackupMonitorRun) -> Date? {
        run.completedAt ?? run.createdAt
    }

    /// Orders the runs newest-first by resolved timestamp (web `sortedRuns`).
    public static func ordered(_ runs: [BackupMonitorRun]) -> [BackupMonitorRun] {
        runs.sorted { sortTimestamp(for: $0) > sortTimestamp(for: $1) }
    }

    /// The compact / grid summary for the latest backup (web `sortedRuns[0]`), or
    /// `nil` when the history is empty.
    public static func latest(
        from runs: [BackupMonitorRun],
        now: Date = Date()
    ) -> BackupLatest? {
        guard let first = ordered(runs).first else { return nil }
        return BackupLatest(
            lastBackupRelative: BackupRelativeFormatter.string(for: displayTimestamp(for: first), now: now),
            sizeText: BackupByteFormatter.string(first.fileSize),
            typeText: first.backupType ?? dash,
            statusLabel: BackupMonitorStrings.label(for: first.status),
            statusTone: first.status.tone,
            showsFailedBackground: first.status.isFailed
        )
    }

    /// The wide-layout "Recent Runs" rows: the newest `maxRecentRows` backups,
    /// each projected to a row (web `sortedRuns.slice(0, 5).map(...)`).
    public static func recentRows(
        from runs: [BackupMonitorRun],
        limit: Int = maxRecentRows,
        locale: Locale = .autoupdatingCurrent
    ) -> [BackupRunRow] {
        ordered(runs).prefix(max(0, limit)).map { run in
            BackupRunRow(
                id: run.id,
                timeText: timeText(for: run, locale: locale),
                detailText: detailText(for: run),
                statusLabel: BackupMonitorStrings.label(for: run.status),
                statusTone: run.status.tone
            )
        }
    }

    /// The row's absolute timestamp (web `fmtShortTime(completedAt ?? createdAt)`),
    /// or the dash sentinel when the run carries no date.
    static func timeText(for run: BackupMonitorRun, locale: Locale) -> String {
        guard let date = displayTimestamp(for: run) else { return dash }
        return BackupAbsoluteFormatter.string(for: date, locale: locale)
    }

    /// The row's "size · {duration}ms" detail line — the web subtitle
    /// (`fmtBytes(fileSize) + (durationMs != null ? ` · ${durationMs}ms` : '')`).
    static func detailText(for run: BackupMonitorRun) -> String {
        let size = BackupByteFormatter.string(run.fileSize)
        guard let durationMs = run.durationMs else { return size }
        return "\(size) · \(durationMs)ms"
    }
}

// MARK: - Byte formatter (port of the web `fmtBytes`)

/// Human-readable byte sizes — a verbatim port of the web `fmtBytes`: "0 B" for
/// non-positive input, else one decimal under 10 (`toFixed(1)`) and a rounded
/// integer at/above 10 (`Math.round`), with the B/KB/MB/GB/TB unit symbols.
public enum BackupByteFormatter {
    private static let units = ["B", "KB", "MB", "GB", "TB"]

    public static func string(_ bytes: Int) -> String {
        guard bytes > 0 else { return "0 B" }
        let exponent = min(Int(floor(log(Double(bytes)) / log(1024.0))), units.count - 1)
        let value = Double(bytes) / pow(1024.0, Double(exponent))
        let magnitude = value < 10 ? String(format: "%.1f", value) : String(Int(value.rounded()))
        return "\(magnitude) \(units[exponent])"
    }
}

// MARK: - Relative-time formatter (port of the web `fmtRelativeTime`)

/// Relative-time phrasing for the "Last backup" value — a verbatim port of the
/// web `fmtRelativeTime`: the dash sentinel for a missing date, "just now" for
/// under a minute (or a future date), then "{m}m ago" / "{h}h ago" / "{d}d ago".
/// The phrases resolve through the i18n facade so no English literal ships.
public enum BackupRelativeFormatter {
    public static func string(for date: Date?, now: Date = Date()) -> String {
        guard let date else { return BackupMonitorProjection.dash }
        let diffSeconds = now.timeIntervalSince(date)
        if diffSeconds < 0 {
            return BackupMonitorStrings.string("widget.backupMonitor.relativeNow", "just now")
        }
        let minutes = Int(diffSeconds / 60)
        if minutes < 1 {
            return BackupMonitorStrings.string("widget.backupMonitor.relativeNow", "just now")
        }
        if minutes < 60 {
            return BackupMonitorStrings.count("widget.backupMonitor.relativeMinutes", "%lldm ago", minutes)
        }
        let hours = minutes / 60
        if hours < 24 {
            return BackupMonitorStrings.count("widget.backupMonitor.relativeHours", "%lldh ago", hours)
        }
        let days = hours / 24
        return BackupMonitorStrings.count("widget.backupMonitor.relativeDays", "%lldd ago", days)
    }
}

// MARK: - Absolute-time formatter (port of the web `fmtShortTime` / useDateFormat)

/// The absolute date-time shown on each "Recent Runs" row — the native
/// counterpart of the web `useDateFormat().formatDateTime` (a medium date with a
/// short time). Locale-injectable so the rows are unit-testable.
public enum BackupAbsoluteFormatter {
    public static func string(for date: Date, locale: Locale = .autoupdatingCurrent) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}
