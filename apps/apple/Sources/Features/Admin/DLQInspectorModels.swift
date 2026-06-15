import Foundation

// MARK: - Wire value types (web `DLQEntrySummary` / `DLQEntryFull` / `DLQReplayAuditRecord`)

/// One summary row in the DLQ list (web `DLQEntrySummary`, `internal/api/dlq_handler.go`).
/// The heavy raw / inner payload blobs are intentionally omitted here — the list endpoint
/// keeps them off the wire and the drawer lazy-loads the `DLQEntryFull` on open. DLQ
/// envelope metadata is control-plane data and carries no SI units; byte sizes are exact
/// integers formatted at the display boundary.
public struct DLQEntrySummary: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let arrivedAt: String
    public let dlqTopic: String
    public let parsedReason: String
    public let parsedVehicleID: Int64?
    public let parsedVIN: String?
    public let parsedSourceTopic: String?
    public let parsedRedeliveries: Int?
    public let parsedTimestamp: String?
    public let parseError: String?
    public let replayable: Bool
    public let rawPayloadSize: Int
    public let innerPayloadSize: Int

    public init(
        id: Int64,
        arrivedAt: String,
        dlqTopic: String = "",
        parsedReason: String = "",
        parsedVehicleID: Int64? = nil,
        parsedVIN: String? = nil,
        parsedSourceTopic: String? = nil,
        parsedRedeliveries: Int? = nil,
        parsedTimestamp: String? = nil,
        parseError: String? = nil,
        replayable: Bool = false,
        rawPayloadSize: Int = 0,
        innerPayloadSize: Int = 0
    ) {
        self.id = id
        self.arrivedAt = arrivedAt
        self.dlqTopic = dlqTopic
        self.parsedReason = parsedReason
        self.parsedVehicleID = parsedVehicleID
        self.parsedVIN = parsedVIN
        self.parsedSourceTopic = parsedSourceTopic
        self.parsedRedeliveries = parsedRedeliveries
        self.parsedTimestamp = parsedTimestamp
        self.parseError = parseError
        self.replayable = replayable
        self.rawPayloadSize = rawPayloadSize
        self.innerPayloadSize = innerPayloadSize
    }
}

/// Full DLQ row — the summary plus the two payload blobs as base64 strings (web
/// `DLQEntryFull`). Used by the entry drawer to expose copy + the decoded payload viewer.
public struct DLQEntryFull: Identifiable, Hashable, Sendable {
    public let summary: DLQEntrySummary
    public let rawPayloadB64: String
    public let innerPayloadB64: String

    public init(summary: DLQEntrySummary, rawPayloadB64: String = "", innerPayloadB64: String = "") {
        self.summary = summary
        self.rawPayloadB64 = rawPayloadB64
        self.innerPayloadB64 = innerPayloadB64
    }

    public var id: Int64 {
        summary.id
    }
}

/// Stable string codes returned in the replay response + audit rows (web `DLQReplayResult`,
/// mirroring the constants in `internal/database/dlq_replay_audit_repo.go`). The raw value
/// is rendered verbatim in the audit badge; the tone mapping lives at the view boundary.
public enum DLQReplayResult: String, Hashable, Sendable {
    case ok
    case publishFailed = "publish_failed"
    case rateLimited = "rate_limited"
    case disabled
    case notFound = "not_found"
    case unparseable
}

/// One row of the replay-audit feed (web `DLQReplayAuditRecord`). Only the fields the audit
/// table renders are required; `actorIP` / `srcTopic` round out the wire type.
public struct DLQReplayAuditRecord: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let replayedAt: String
    public let actor: String
    public let actorIP: String
    public let dlqID: Int64
    public let srcTopic: String
    public let dstTopic: String
    public let reason: String
    public let result: DLQReplayResult
    public let error: String
    public let traceID: String

    public init(
        id: Int64,
        replayedAt: String,
        actor: String = "",
        actorIP: String = "",
        dlqID: Int64,
        srcTopic: String = "",
        dstTopic: String = "",
        reason: String = "",
        result: DLQReplayResult,
        error: String = "",
        traceID: String = ""
    ) {
        self.id = id
        self.replayedAt = replayedAt
        self.actor = actor
        self.actorIP = actorIP
        self.dlqID = dlqID
        self.srcTopic = srcTopic
        self.dstTopic = dstTopic
        self.reason = reason
        self.result = result
        self.error = error
        self.traceID = traceID
    }
}

/// The DLQ list payload (web `DLQListResponse`): the entries plus the server-side
/// `replay_enabled` flag (mirrors `DLQ_REPLAY_ENABLED`) and the total count.
public struct DLQListResult: Equatable, Sendable {
    public let count: Int
    public let replayEnabled: Bool
    public let entries: [DLQEntrySummary]

    public init(count: Int, replayEnabled: Bool, entries: [DLQEntrySummary]) {
        self.count = count
        self.replayEnabled = replayEnabled
        self.entries = entries
    }
}

/// The outcome of a replay attempt (web `DLQReplayResponse`): the result code and the
/// destination topic the entry was (or would be) republished to.
public struct DLQReplayOutcome: Equatable, Sendable {
    public let result: DLQReplayResult
    public let dstTopic: String

    public init(result: DLQReplayResult, dstTopic: String = "") {
        self.result = result
        self.dstTopic = dstTopic
    }
}

/// Thrown by the data source when the server hard-rejects a replay because
/// `DLQ_REPLAY_ENABLED` is unset (web `error.status === 403`). The page surfaces this as a
/// persistent banner rather than a transient toast.
public struct DLQReplayDisabledError: Error, Equatable, Sendable {
    public init() {}
}

// MARK: - Data source seam (web `useDLQList` / `useDLQEntry` / `useDLQAudit` / `useDLQReplay`)

/// Supplies the list + audit feeds, lazy-loads a full entry, and performs the sudo-gated
/// replay the page drives. Production binds the shared KMP `/system/dlq*` endpoints
/// (ADR-004 — the view holds no networking); previews + tests inject doubles to drive every
/// data state. Mirrors the sibling `FeatureFlagsDataSource` seam.
public protocol DLQInspectorDataSource: Sendable {
    /// Web `useDLQList → GET /system/dlq`.
    func loadList() async throws -> DLQListResult
    /// Web `useDLQEntry → GET /system/dlq/{numericId}`.
    func loadEntry(id: Int64) async throws -> DLQEntryFull
    /// Web `useDLQAudit → GET /system/dlq/audit?limit=`.
    func loadAudit(limit: Int) async throws -> [DLQReplayAuditRecord]
    /// Web `useDLQReplay → POST /system/dlq/{id}/replay`. Throws `DLQReplayDisabledError`
    /// when the env gate hard-rejects (HTTP 403).
    func replay(id: Int64) async throws -> DLQReplayOutcome
}

// MARK: - Page states (web list / audit / entry query phases)

/// The list state (web `list` query): `.empty` is a successful load with zero rows (a clean
/// pipeline), `.error` is a retryable failure, `.loaded` carries the count + replay flag +
/// entries.
public enum DLQListState: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case loaded(DLQListResult)
}

/// The replay-audit state (web `audit` query): same phases as the list, scoped to the
/// global replay feed.
public enum DLQAuditState: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case loaded([DLQReplayAuditRecord])
}

/// The drawer's full-entry state (web `entry` query). There is no `.empty` phase — a
/// selected row always resolves to a full entry or a retryable error.
public enum DLQEntryState: Equatable, Sendable {
    case loading
    case error(String)
    case loaded(DLQEntryFull)
}

// MARK: - Display-boundary formatters (web `dateFormat.ts` / `formatBytes` / `decodeBase64Utf8`)

/// Pure, testable display helpers ported from the web DLQ surface. DLQ envelope metadata
/// carries no SI units, so these only format the timestamp, the exact byte sizes, and the
/// base64 payload at the boundary.
public enum DLQInspectorFormat {
    /// The em-dash shown for nil / unrenderable values (web `'—'` fallback).
    public static let emptyValue = "—"

    /// Web `<TimeStamp format="absolute">` → `formatDateTime(iso)`: en-US `MMM d, yyyy, h:mm a`.
    public static func dateTime(_ iso: String?) -> String {
        guard let iso, let date = parseISO(iso) else { return emptyValue }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateFormat = "MMM d, yyyy, h:mm a"
        return formatter.string(from: date)
    }

    /// Web `formatBytes(n)`: `B` / `KB` / `MB` with one decimal; em-dash for negatives.
    public static func bytes(_ count: Int) -> String {
        guard count >= 0 else { return emptyValue }
        if count < 1024 { return "\(count) B" }
        if count < 1024 * 1024 {
            return String(format: "%.1f KB", Double(count) / 1024)
        }
        return String(format: "%.1f MB", Double(count) / (1024 * 1024))
    }

    /// Web `decodeBase64Utf8(b64)`: decodes base64 → UTF-8 text, returning nil for empty or
    /// non-UTF-8 (binary protobuf) payloads so the drawer falls back to a byte-count marker.
    public static func decodeBase64UTF8(_ b64: String) -> String? {
        guard !b64.isEmpty, let data = Data(base64Encoded: b64) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Tolerant ISO-8601 parse (with + without fractional seconds), mirroring the sibling
    /// admin formatters.
    static func parseISO(_ iso: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }
}
