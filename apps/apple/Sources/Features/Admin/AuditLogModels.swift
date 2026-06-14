import Foundation

// MARK: - Wire value types (web `AuditLogRow` / `AuditChainVerifyResponse`)

/// One audit-ledger row — the native peer of the web `AuditLogRow` (backed by
/// `internal/handler/v1/admin_audit_handler.go`). Field names/types mirror the wire
/// 1:1 so the production KMP `OperatorConfidenceStore` binding maps straight across.
/// Audit metadata is unit-agnostic control-plane data (no SI conversion applies); the
/// timestamp is rendered at the display boundary by `AuditLogFormat`.
public struct AuditLogRow: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let ts: String
    public let actor: String
    public let category: String?
    public let action: String
    public let entityType: String
    public let entityID: Int64?
    public let detail: String?
    public let ip: String?
    public let userAgent: String?
    public let before: String?
    public let after: String?
    public let traceID: String?
    public let prevRowHash: String?
    public let rowHash: String?
    public let success: Bool?

    public init(
        id: Int64,
        ts: String,
        actor: String,
        category: String? = nil,
        action: String,
        entityType: String,
        entityID: Int64? = nil,
        detail: String? = nil,
        ip: String? = nil,
        userAgent: String? = nil,
        before: String? = nil,
        after: String? = nil,
        traceID: String? = nil,
        prevRowHash: String? = nil,
        rowHash: String? = nil,
        success: Bool? = nil
    ) {
        self.id = id
        self.ts = ts
        self.actor = actor
        self.category = category
        self.action = action
        self.entityType = entityType
        self.entityID = entityID
        self.detail = detail
        self.ip = ip
        self.userAgent = userAgent
        self.before = before
        self.after = after
        self.traceID = traceID
        self.prevRowHash = prevRowHash
        self.rowHash = rowHash
        self.success = success
    }
}

/// The SHA-256 hash-chain re-derivation result (web `AuditChainVerifyResponse`).
/// `intact` is true iff every row's `row_hash == sha256(prev_row_hash || payload)`.
public struct AuditChainVerify: Equatable, Sendable {
    public let intact: Bool
    public let firstBadID: Int64
    public let rowsChecked: Int64
    public let since: String
    public let limit: Int

    public init(intact: Bool, firstBadID: Int64, rowsChecked: Int64, since: String, limit: Int) {
        self.intact = intact
        self.firstBadID = firstBadID
        self.rowsChecked = rowsChecked
        self.since = since
        self.limit = limit
    }
}

// MARK: - Query (web `AuditLogQueryParams` + `buildAuditLogQuery`)

/// The filtered-list query the page builds from its filter row (web `queryParams`
/// memo). Carried as a value type so the production data source maps it to the
/// snake_case query string and the model is unit-testable. Filters are snake_case on
/// the wire (DRY anti-pattern guard #8 — never camelCase params).
public struct AuditLogQuery: Equatable, Sendable {
    public var since: String?
    public var until: String?
    public var categories: [String]
    public var actors: [String]
    public var actions: [String]
    public var entityType: String?
    public var limit: Int
    public var offset: Int

    public init(
        since: String? = nil,
        until: String? = nil,
        categories: [String] = [],
        actors: [String] = [],
        actions: [String] = [],
        entityType: String? = nil,
        limit: Int = 100,
        offset: Int = 0
    ) {
        self.since = since
        self.until = until
        self.categories = categories
        self.actors = actors
        self.actions = actions
        self.entityType = entityType
        self.limit = limit
        self.offset = offset
    }

    /// Ports the web `buildAuditLogQuery`: snake_case params, comma-joined multi-values,
    /// empty filters omitted. Used by the production adapter + asserted in tests so the
    /// backend contract (`GET /admin/audit-log{qs}`) is reproduced exactly.
    public var queryString: String {
        var parts: [String] = []
        if let since { parts.append("since=\(since)") }
        if let until { parts.append("until=\(until)") }
        if !categories.isEmpty { parts.append("categories=\(categories.joined(separator: ","))") }
        if !actors.isEmpty { parts.append("actors=\(actors.joined(separator: ","))") }
        if !actions.isEmpty { parts.append("actions=\(actions.joined(separator: ","))") }
        if let entityType { parts.append("entity_type=\(entityType)") }
        parts.append("limit=\(limit)")
        parts.append("offset=\(offset)")
        return parts.isEmpty ? "" : "?" + parts.joined(separator: "&")
    }
}

/// Thrown when the deployment lacks the audit-log subsystem — the native peer of the
/// web `logQuery.error.status === 503` (`subsystemMissing`) branch that surfaces the
/// "subsystem unavailable" banner. Distinct from a generic failure so the page can
/// reproduce the web's dedicated not-configured affordance.
public struct AuditLogSubsystemUnavailable: Error {
    public init() {}
}

// MARK: - Display-boundary formatters (web `dateFormat.ts` + `formatJSON`)

/// Pure, testable display formatters ported from `web/src/lib/dateFormat.ts`
/// (`formatDateTime` / `formatRelative`) and the page's local `formatJSON`. Audit
/// metadata carries no SI units, so these only format at the display boundary. The
/// relative formatter takes an injectable `now` so the relative phrase is deterministic
/// under test.
public enum AuditLogFormat {
    /// The em-dash shown for nil / unrenderable values (web `'—'` fallback).
    public static let emptyValue = "—"

    /// Web `new Date(value).toISOString()` — UTC RFC-3339 used for the snake_case query.
    public static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    /// Web `formatDateTime(iso)`: en-US `MMM d, yyyy, h:mm a`; em-dash for nil / invalid.
    public static func dateTime(_ iso: String?) -> String {
        guard let iso, let date = parseISO(iso) else { return emptyValue }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateFormat = "MMM d, yyyy, h:mm a"
        return formatter.string(from: date)
    }

    /// Web `formatRelative(iso)`: "just now" / "{n}m ago" / "{n}h ago" / "{n}d ago",
    /// falling back to `MMM d, yyyy` beyond a week; em-dash for nil / invalid.
    public static func relative(_ iso: String?, now: Date = Date()) -> String {
        guard let iso, let date = parseISO(iso) else { return emptyValue }
        let seconds = Int(now.timeIntervalSince(date))
        if seconds < 60 { return "just now" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h ago" }
        let days = hours / 24
        if days < 7 { return "\(days)d ago" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateFormat = "MMM d, yyyy"
        return formatter.string(from: date)
    }

    /// Web `formatJSON(raw)`: pretty-print 2-space JSON, falling back to the raw string
    /// when it does not parse; em-dash for nil.
    public static func prettyJSON(_ raw: String?) -> String {
        guard let raw, !raw.isEmpty else { return emptyValue }
        guard let data = raw.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let pretty = try? JSONSerialization.data(
                  withJSONObject: object,
                  options: [.prettyPrinted, .sortedKeys]
              ),
              let string = String(data: pretty, encoding: .utf8)
        else {
            return raw
        }
        return string
    }

    /// Tolerant ISO-8601 parse (with + without fractional seconds), mirroring the
    /// sibling Schema Drift formatter.
    static func parseISO(_ iso: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }
}
