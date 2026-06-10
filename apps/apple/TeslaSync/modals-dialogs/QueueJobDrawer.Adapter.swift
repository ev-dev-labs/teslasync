//
//  QueueJobDrawer.Adapter.swift
//  TeslaSync — P4 modal / dialog · 0020 · QueueJobDrawer (Apple)
//
//  The testable, dependency-free projection core for the per-worker job-history drawer — the
//  faithful port of features/admin/components/QueueJobDrawer.tsx and the `useQueueJobs`
//  (`QueueJobsResponse` / `QueueJobView`) wire types it binds to. Everything here is pure
//  Foundation so the status-tone map, the display-ready row, the duration formatter, the body
//  phase, the drawer title, and the resolved duration source are all unit-tested without a
//  bundle or a rendered view.
//
//  Web parity notes:
//    • The web widget is a controlled `<Drawer>` (the host owns `open` / `onClose` / `worker` /
//      `displayName`) whose fetch is gated on `enabled: open && worker`. The native model owns
//      the same lifecycle; this core holds only pure projection.
//    • `STATUS_TONE` (the notification / export / automation status colour map) →
//      `QueueJobStatusTone`, resolved to a token colour in the views.
//    • `formatDurationMsLong` → `QueueJobDurationFormatter` (faithful port, incl. the `—` /
//      `ms` / `s` / `m s` arms and the JS half-away-from-zero rounding).
//    • The web `durationLabel` selection (`duration_ms` else `finished_at − started_at` else
//      none) → `QueueJobDrawerProjection.resolvedDurationMs`.
//    • `bodyPhase` widens the web loading / error / empty / list split with a cached-rows
//      envelope so a failed reload over cached rows is never a blank box (guideline #6).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free
/// core so the projection's unit tests can reach it without a bundle.
public enum QueueJobDrawerSurface {
    public static let slug = "QueueJobDrawer"
}

// MARK: - Status tone (web `STATUS_TONE`)

/// The semantic colour bucket a job status renders in — the native parity of the web
/// `STATUS_TONE` map (notification / export / automation status → Tailwind tone). Kept as pure
/// data so the mapping is unit-tested; the views resolve each case to a P1/S9 token colour.
public enum QueueJobStatusTone: String, Sendable, Equatable, CaseIterable {
    /// Web `text-emerald-300` (sent / ready / success).
    case success
    /// Web `text-amber-300` (pending / deferred_dnd / queued / partial).
    case warning
    /// Web `text-cyan-300` (processing / running).
    case info
    /// Web `text-rose-300` (failed).
    case danger
    /// Web `text-[var(--text-muted)]` (cancelled / skipped).
    case muted
    /// Web fallback `text-[var(--text-primary)]` (any unmapped status).
    case neutral

    /// The faithful port of the web `STATUS_TONE[status] ?? primary` lookup.
    public static func from(status: String) -> QueueJobStatusTone {
        switch status {
        case "sent", "ready", "success": .success
        case "pending", "deferred_dnd", "queued", "partial": .warning
        case "processing", "running": .info
        case "failed": .danger
        case "cancelled", "skipped": .muted
        default: .neutral
        }
    }
}

// MARK: - Display-ready row (web `QueueJobView`)

/// One recent job — the native parity of a web `QueueJobView`. Times are resolved `Date` (the
/// web carries ISO-8601 strings, always UTC); the nullable `finishedAt` / `durationMs` /
/// `error` columns stay optional so the projection picks the web fallbacks explicitly.
public struct QueueJobRowData: Sendable, Equatable, Identifiable {
    public let id: String
    public let worker: String
    public let status: String
    public let title: String
    public let startedAt: Date
    public let finishedAt: Date?
    public let durationMs: Int?
    public let error: String?

    public init(
        id: String,
        worker: String,
        status: String,
        title: String,
        startedAt: Date,
        finishedAt: Date? = nil,
        durationMs: Int? = nil,
        error: String? = nil
    ) {
        self.id = id
        self.worker = worker
        self.status = status
        self.title = title
        self.startedAt = startedAt
        self.finishedAt = finishedAt
        self.durationMs = durationMs
        self.error = error
    }

    /// The row's primary label — web `job.title || job.id` (an empty title falls back to the id).
    public var displayTitle: String {
        title.isEmpty ? id : title
    }

    /// The semantic colour bucket for this row's status (web `statusToneClass`).
    public var statusTone: QueueJobStatusTone {
        QueueJobStatusTone.from(status: status)
    }

    /// Whether the row renders the inline error block (web `job.error ? … : null`).
    public var hasError: Bool {
        guard let error else { return false }
        return !error.isEmpty
    }
}

// MARK: - Duration formatter (port of lib/dateFormat.ts `formatDurationMsLong`)

/// The faithful port of web `formatDurationMsLong(ms)`: `—` for nullish / non-finite / `≤ 0`,
/// `"{ms}ms"` under a second, `"{s.1f}s"` under a minute, else `"{m}m {round(s%60)}s"`. The
/// minute-remainder rounds half away from zero to match the JS `toLocaleString` default.
public enum QueueJobDurationFormatter {
    public static let empty = "—"

    public static func string(_ ms: Double?) -> String {
        guard let ms, ms.isFinite, ms > 0 else { return empty }
        if ms < 1000 { return "\(integer(ms))ms" }
        let seconds = ms / 1000
        if seconds < 60 { return "\(oneDecimal(seconds))s" }
        let minutes = Int(seconds / 60)
        let remainder = seconds.truncatingRemainder(dividingBy: 60)
        return "\(minutes)m \(integer(remainder.rounded(.toNearestOrAwayFromZero)))s"
    }

    /// Renders an integral millisecond count without a decimal point (web `${ms}ms`, where the
    /// wire value is an integer).
    private static func integer(_ value: Double) -> String {
        String(Int(value.rounded(.toNearestOrAwayFromZero)))
    }

    /// One-decimal rendering matching JS `Number.toFixed(1)`.
    private static func oneDecimal(_ value: Double) -> String {
        String(format: "%.1f", value)
    }
}

// MARK: - Load status / render phase / freshness

/// The bound source's load status for the jobs query (web `isLoading` / resolved / `error`).
public enum QueueJobLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the header freshness chip + the cached-data banner
/// so a cached list is clearly labeled while reconnecting / offline.
public enum QueueJobDrawerConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the drawer body renders. The web splits loading / error / empty / list; the cached-rows
/// envelope is added so a failed reload over cached rows keeps the list (never a blank box).
public enum QueueJobDrawerPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case populated
}

// MARK: - Projection core (pure)

/// The dependency-free resolution from the bound source to the rendered phase, the inline
/// reload-failure envelope, the drawer title, and the per-row duration source. Copy resolves
/// through an injected localizer so the projection stays bundle-free.
public enum QueueJobDrawerProjection {
    /// The body phase. The web shows the loading line until the first response, the error block
    /// on failure, the empty line on a resolved empty list, else the rows. Cached rows stay on
    /// screen through a failed reload (freshness shown by the chip / banner) so the list never
    /// blanks — the web `isLoading ? … : error ? … : empty ? … : list` widened (guideline #6).
    public static func bodyPhase(status: QueueJobLoadStatus, hasJobs: Bool) -> QueueJobDrawerPhase {
        switch status {
        case .loading:
            hasJobs ? .populated : .loading
        case .loaded:
            hasJobs ? .populated : .empty
        case let .failed(message):
            hasJobs ? .populated : .error(message)
        }
    }

    /// The reload-failure message kept while cached rows remain on screen (so the populated
    /// branch can surface an inline banner above the list). `nil` unless the latest status
    /// failed AND rows are still shown.
    public static func inlineFailure(status: QueueJobLoadStatus, hasJobs: Bool) -> String? {
        guard hasJobs, case let .failed(message) = status else { return nil }
        return message
    }

    /// The drawer title — web `displayName ? 'Recent {{worker}} jobs' : 'Recent jobs'`. Note
    /// the web gates on `displayName` (not `worker`), and interpolates `displayName` into the
    /// `{{worker}}` token.
    public static func title(displayName: String?, localize: (String, String) -> String) -> String {
        guard let displayName, !displayName.isEmpty else {
            return localize("queueStatus.drawer.title", "Recent jobs")
        }
        return localize("queueStatus.drawer.titleWithWorker", "Recent {{worker}} jobs")
            .replacingOccurrences(of: "{{worker}}", with: displayName)
    }

    /// The millisecond duration the row formats, or `nil` when the row shows no duration — the
    /// faithful port of the web `durationLabel` selection: `duration_ms` if present, else
    /// `finished_at − started_at` if `finished_at` is present, else none.
    public static func resolvedDurationMs(
        durationMs: Int?,
        startedAt: Date,
        finishedAt: Date?
    ) -> Double? {
        if let durationMs { return Double(durationMs) }
        guard let finishedAt else { return nil }
        return finishedAt.timeIntervalSince(startedAt) * 1000
    }
}
