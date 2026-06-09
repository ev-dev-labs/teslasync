//
//  QueueStatusPanel.Adapter.swift
//  TeslaSync — P4 feature view · 0037 · QueueStatusPanel (Apple)
//
//  The testable projection core for the Queue-status panel — the SwiftUI parity
//  of features/admin/components/QueueStatusPanel.tsx plus the leaf helpers it
//  leans on (fmtNumber, formatRelative, formatDurationMsLong) and the per-card
//  derived maths the web `WorkerCard` computes inline (queue depth, MetricBar
//  fraction, the has-failures / has-backlog / has-host branches). Everything
//  here is pure + dependency-free (no store, no bundle, no view) so the decode,
//  the severity fall-through, the formatting, and the VoiceOver phrase are all
//  unit tested in isolation.
//

import Foundation

// MARK: - Heartbeat severity (web QueueHeartbeatSeverity + SEVERITY_COLOR/TONE)

/// The heartbeat-staleness band the backend reports for one worker (web
/// `'ok' | 'warn' | 'critical' | 'down'`). Decoding is lenient: an unrecognised
/// value degrades to `.down` (the slate "never reported in" band) rather than
/// throwing, mirroring the defensive web colour/tone lookup.
public enum QueueHeartbeatSeverity: String, Sendable, Equatable, CaseIterable, Decodable {
    case ok
    case warn
    case critical
    case down

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = QueueHeartbeatSeverity(rawValue: raw) ?? .down
    }

    /// Lenient mapping from an arbitrary backend string (web template-literal key).
    public static func parse(_ raw: String) -> QueueHeartbeatSeverity {
        QueueHeartbeatSeverity(rawValue: raw) ?? .down
    }
}

// MARK: - Wire model (web QueueStat row)

/// One worker row from GET /api/v1/system/queues (web `QueueStat`). Counts come
/// from each worker's domain table over the last 24h; the heartbeat fields come
/// from the Redis `worker_status` key. The snake_case `CodingKeys` mirror the
/// JSON tags exactly (the camelCase-vs-snake_case mismatch is a recurring bug
/// source, so it is covered by a decode test). Every count defaults to `0` and
/// every optional to `nil` so a partial payload never throws.
public struct QueueStat: Identifiable, Equatable, Sendable, Decodable {
    public let worker: String
    public let displayName: String
    public let pending: Int
    public let inProgress: Int
    public let succeeded24h: Int
    public let failed24h: Int
    public let oldestPendingAgeSeconds: Double
    public let heartbeatSeverity: QueueHeartbeatSeverity
    public let heartbeatDetail: String
    public let lastHeartbeatAt: Date?
    public let startedAt: Date?
    public let host: String?
    public let version: String?

    /// Stable identity for `ForEach` — the web row key `stat.worker`.
    public var id: String {
        worker
    }

    enum CodingKeys: String, CodingKey {
        case worker
        case displayName = "display_name"
        case pending
        case inProgress = "in_progress"
        case succeeded24h = "succeeded_24h"
        case failed24h = "failed_24h"
        case oldestPendingAgeSeconds = "oldest_pending_age_seconds"
        case heartbeatSeverity = "heartbeat_severity"
        case heartbeatDetail = "heartbeat_detail"
        case lastHeartbeatAt = "last_heartbeat_at"
        case startedAt = "started_at"
        case host
        case version
    }

    public init(
        worker: String,
        displayName: String,
        pending: Int = 0,
        inProgress: Int = 0,
        succeeded24h: Int = 0,
        failed24h: Int = 0,
        oldestPendingAgeSeconds: Double = 0,
        heartbeatSeverity: QueueHeartbeatSeverity = .down,
        heartbeatDetail: String = "",
        lastHeartbeatAt: Date? = nil,
        startedAt: Date? = nil,
        host: String? = nil,
        version: String? = nil
    ) {
        self.worker = worker
        self.displayName = displayName
        self.pending = pending
        self.inProgress = inProgress
        self.succeeded24h = succeeded24h
        self.failed24h = failed24h
        self.oldestPendingAgeSeconds = oldestPendingAgeSeconds
        self.heartbeatSeverity = heartbeatSeverity
        self.heartbeatDetail = heartbeatDetail
        self.lastHeartbeatAt = lastHeartbeatAt
        self.startedAt = startedAt
        self.host = host
        self.version = version
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let workerID = try container.decode(String.self, forKey: .worker)
        let severityRaw = try container.decodeIfPresent(String.self, forKey: .heartbeatSeverity) ?? "down"
        try self.init(
            worker: workerID,
            displayName: container.decodeIfPresent(String.self, forKey: .displayName) ?? workerID,
            pending: container.decodeIfPresent(Int.self, forKey: .pending) ?? 0,
            inProgress: container.decodeIfPresent(Int.self, forKey: .inProgress) ?? 0,
            succeeded24h: container.decodeIfPresent(Int.self, forKey: .succeeded24h) ?? 0,
            failed24h: container.decodeIfPresent(Int.self, forKey: .failed24h) ?? 0,
            oldestPendingAgeSeconds: container.decodeIfPresent(
                Double.self,
                forKey: .oldestPendingAgeSeconds
            ) ?? 0,
            heartbeatSeverity: QueueHeartbeatSeverity.parse(severityRaw),
            heartbeatDetail: container.decodeIfPresent(String.self, forKey: .heartbeatDetail) ?? "",
            lastHeartbeatAt: QueueStatusAdapter.parseTimestamp(
                container.decodeIfPresent(String.self, forKey: .lastHeartbeatAt)
            ),
            startedAt: QueueStatusAdapter.parseTimestamp(
                container.decodeIfPresent(String.self, forKey: .startedAt)
            ),
            host: container.decodeIfPresent(String.self, forKey: .host),
            version: container.decodeIfPresent(String.self, forKey: .version)
        )
    }
}

/// The GET /api/v1/system/queues envelope (web `QueueStatusResponse`). `workers`
/// defaults to empty and `generated_at` is parsed leniently so a partial payload
/// keeps the panel on its empty branch instead of throwing.
public struct QueueStatusSnapshot: Equatable, Sendable, Decodable {
    public let generatedAt: Date?
    public let workers: [QueueStat]

    enum CodingKeys: String, CodingKey {
        case generatedAt = "generated_at"
        case workers
    }

    public init(generatedAt: Date? = nil, workers: [QueueStat]) {
        self.generatedAt = generatedAt
        self.workers = workers
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let rows = try container.decodeIfPresent([QueueStat].self, forKey: .workers) ?? []
        let generated = try QueueStatusAdapter.parseTimestamp(
            container.decodeIfPresent(String.self, forKey: .generatedAt)
        )
        self.init(generatedAt: generated, workers: rows)
    }

    /// Decodes the snapshot from raw API bytes (production source path). Returns
    /// `nil` only when the bytes are not the expected JSON object.
    public static func decode(_ data: Data) -> QueueStatusSnapshot? {
        try? JSONDecoder().decode(QueueStatusSnapshot.self, from: data)
    }
}

// MARK: - Projection (web WorkerCard inline derivations)

/// The view-ready projection of one worker row — the native mirror of the
/// per-card fields the web `WorkerCard` derives: the queue-depth `total`, the
/// MetricBar `fraction`, and the branch flags (`hasFailures`, `hasBacklog`,
/// `hasHost`). The localized labels themselves stay in the view so they resolve
/// through the i18n facade; this struct carries only structural data + numbers.
public struct QueueWorkerProjection: Identifiable, Equatable, Sendable {
    public let worker: String
    public let displayName: String
    public let host: String?
    public let version: String?
    public let severity: QueueHeartbeatSeverity
    public let pending: Int
    public let inProgress: Int
    public let total: Int
    public let succeeded24h: Int
    public let failed24h: Int
    public let oldestPendingAgeSeconds: Double
    public let heartbeatDetail: String
    public let lastHeartbeatAt: Date?

    /// Stable identity for `ForEach` — the web row key `stat.worker`.
    public var id: String {
        worker
    }

    /// `true` when the failed-24h value renders in the danger tone (web
    /// `stat.failed_24h > 0 ? rose : primary`).
    public var hasFailures: Bool {
        failed24h > 0
    }

    /// `true` when the oldest-pending footnote renders (web
    /// `stat.oldest_pending_age_seconds <= 0 ? null : …`).
    public var hasBacklog: Bool {
        oldestPendingAgeSeconds > 0
    }

    /// `true` when the host · version caption renders, else the "No host
    /// reported" caption (web `stat.host ? … : …`).
    public var hasHost: Bool {
        !(host?.isEmpty ?? true)
    }

    /// The oldest-pending age in milliseconds (web
    /// `formatDurationMsLong(stat.oldest_pending_age_seconds * 1000)`).
    public var oldestPendingMilliseconds: Double {
        oldestPendingAgeSeconds * 1000
    }

    /// The MetricBar fill fraction — the native mirror of the web
    /// `MetricBar value={total} max={total > 0 ? total : 1}` → `min(value/max, 1)`,
    /// i.e. full whenever there is any depth and empty at zero.
    public var barFraction: Double {
        let upperBound = total > 0 ? total : 1
        return min(Double(total) / Double(upperBound), 1)
    }

    public init(
        worker: String,
        displayName: String,
        host: String?,
        version: String?,
        severity: QueueHeartbeatSeverity,
        pending: Int,
        inProgress: Int,
        succeeded24h: Int,
        failed24h: Int,
        oldestPendingAgeSeconds: Double,
        heartbeatDetail: String,
        lastHeartbeatAt: Date?
    ) {
        self.worker = worker
        self.displayName = displayName
        self.host = host
        self.version = version
        self.severity = severity
        self.pending = pending
        self.inProgress = inProgress
        total = pending + inProgress
        self.succeeded24h = succeeded24h
        self.failed24h = failed24h
        self.oldestPendingAgeSeconds = oldestPendingAgeSeconds
        self.heartbeatDetail = heartbeatDetail
        self.lastHeartbeatAt = lastHeartbeatAt
    }
}

// MARK: - Adapter (web fmtNumber / formatRelative / formatDurationMsLong + decode)

/// Pure transforms from the decoded snapshot to the per-card projection plus the
/// number / relative-time / duration formatters the web card leans on. Unit
/// tested in isolation; no store, no bundle, no view.
public enum QueueStatusAdapter {
    /// The em-dash sentinel for a missing value (web `FALLBACK` / `formatRelative`
    /// null branch).
    public static let dash = "—"

    /// Projects one wire row into its view-model (web `WorkerCard` derivations).
    /// An empty host / version string collapses to `nil` so the caption picks the
    /// "No host reported" branch.
    public static func project(_ stat: QueueStat) -> QueueWorkerProjection {
        QueueWorkerProjection(
            worker: stat.worker,
            displayName: stat.displayName,
            host: (stat.host?.isEmpty ?? true) ? nil : stat.host,
            version: (stat.version?.isEmpty ?? true) ? nil : stat.version,
            severity: stat.heartbeatSeverity,
            pending: stat.pending,
            inProgress: stat.inProgress,
            succeeded24h: stat.succeeded24h,
            failed24h: stat.failed24h,
            oldestPendingAgeSeconds: stat.oldestPendingAgeSeconds,
            heartbeatDetail: stat.heartbeatDetail,
            lastHeartbeatAt: stat.lastHeartbeatAt
        )
    }

    /// Projects the worker list, preserving the backend's order (web renders
    /// `workers.map(...)` verbatim — no client-side sort).
    public static func project(_ stats: [QueueStat]) -> [QueueWorkerProjection] {
        stats.map(project)
    }

    /// Grouped count formatter mirroring `fmtNumber(value)`: thousands grouping
    /// plus the app's global decimal precision (`_globalPrecision`, default `2`).
    /// `locale` is injected so the separators are deterministic under test.
    public static func number(
        _ value: Int,
        precision: Int = 2,
        locale: Locale = .current
    ) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = precision
        formatter.maximumFractionDigits = precision
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    /// Relative timestamp mirroring `formatRelative(iso)`: `"—"` when absent,
    /// `"just now"` under a minute, then `"<n>m ago"` / `"<n>h ago"` / `"<n>d ago"`,
    /// falling back to a medium absolute date at a week or more. `now` is injected
    /// so the rollover thresholds are deterministic under test.
    public static func relativeLabel(
        _ date: Date?,
        now: Date = Date(),
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        guard let date else { return dash }
        let seconds = Int(now.timeIntervalSince(date))
        if seconds < 60 { return "just now" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h ago" }
        let days = hours / 24
        if days < 7 { return "\(days)d ago" }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }

    /// Long duration formatter mirroring `formatDurationMsLong(ms)`: `"—"` for a
    /// nullish / non-positive / non-finite value, `"<n>ms"` under a second,
    /// `"<n.n>s"` under a minute, else `"<m>m <s>s"` with a rounded seconds
    /// remainder.
    public static func durationLong(_ milliseconds: Double?) -> String {
        guard let milliseconds, milliseconds.isFinite, milliseconds > 0 else { return dash }
        if milliseconds < 1000 { return "\(Int(milliseconds))ms" }
        let seconds = milliseconds / 1000
        if seconds < 60 { return String(format: "%.1fs", seconds) }
        let minutes = Int(seconds / 60)
        let remainder = Int(seconds.truncatingRemainder(dividingBy: 60).rounded())
        return "\(minutes)m \(remainder)s"
    }

    /// Parses an ISO-8601 timestamp (web `new Date(iso)`), tolerating both the
    /// fractional-seconds and whole-seconds forms the backend emits. A nil or
    /// unparseable string yields `nil` so the caller renders the "—" branch.
    public static func parseTimestamp(_ raw: String?) -> Date? {
        guard let raw, !raw.isEmpty else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: raw) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: raw)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the combined VoiceOver phrase for one worker card from already-resolved
/// display strings. Pure + public so the spoken content is asserted without
/// rendering the view; empty fragments are dropped so a phrase never reads a
/// stray comma.
public enum QueueStatusAccessibility {
    public static func cardSummary(
        name: String,
        severity: String,
        depth: String,
        counts: String,
        heartbeat: String
    ) -> String {
        [name, severity, depth, counts, heartbeat]
            .compactMap { fragment in fragment.isEmpty ? nil : fragment }
            .joined(separator: ", ")
    }
}
