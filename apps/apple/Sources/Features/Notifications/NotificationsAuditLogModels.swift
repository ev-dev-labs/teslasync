import Foundation

// MARK: - Wire value type (web `AuditLogEntry`)

/// One system-level audit entry — the native peer of the web `AuditLogEntry`
/// (`web/src/types/admin.ts`), surfaced by `GET /system/audit` (web `useAuditLogs`). Field
/// names/types mirror the wire 1:1 so the production KMP client binding maps straight across.
/// Audit metadata is unit-agnostic control-plane data (no SI conversion applies); the
/// timestamp is rendered at the display boundary by `AuditEntryFormat`.
public struct AuditLogEntry: Identifiable, Hashable, Sendable {
    public let id: String
    public let action: String
    public let resource: String
    public let details: String
    public let createdAt: String

    public init(id: String, action: String, resource: String, details: String, createdAt: String) {
        self.id = id
        self.action = action
        self.resource = resource
        self.details = details
        self.createdAt = createdAt
    }
}

// MARK: - Page state (web `useAuditLogs` phases + empty branch)

/// The list state for the audit feed. `.empty` is a successful load with zero entries (web
/// `auditLogs?.length` falsy → "No audit entries found"); `.error` is a retryable failure
/// (web `error` branch → "Failed to load audit logs"); `.loaded` carries one or more entries
/// (web search + `DataTable` branch).
public enum NotificationsAuditLogState: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case loaded([AuditLogEntry])
}

// MARK: - Data source seam (web `useAuditLogs`)

/// Supplies the audit feed the page renders (web `useAuditLogs` → `GET /system/audit`). The
/// production implementation binds the shared KMP client (ADR-004 — the view holds no
/// networking); previews and tests inject doubles to drive every data state. Mirrors the
/// `AuditLogDataSource` seam used by the sibling admin audit page.
public protocol NotificationsAuditLogDataSource: Sendable {
    /// Web `useAuditLogs()` (`GET /api/v1/system/audit`).
    func loadAuditLogs() async throws -> [AuditLogEntry]
}

// MARK: - Display-boundary helpers (web `dateFormat.ts` + `useFilteredList`)

/// Pure, testable display helpers ported from the web page: `formatDateTime`
/// (`web/src/lib/dateFormat.ts`) for the Time column, and the `useFilteredList` substring
/// search (`web/src/hooks/useFilteredList.ts`) over action / resource / details. Audit
/// metadata carries no SI units, so these only format at the display boundary.
public enum AuditEntryFormat {
    /// The em-dash shown for nil / unparseable timestamps (web `'—'` fallback).
    public static let emptyValue = "—"

    /// Web `formatDateTime(iso)`: en-US `MMM d, yyyy, hh:mm a`; em-dash for nil / invalid.
    public static func dateTime(_ iso: String?) -> String {
        guard let iso, let date = parseISO(iso) else { return emptyValue }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateFormat = "MMM d, yyyy, hh:mm a"
        return formatter.string(from: date)
    }

    /// Web `useFilteredList(auditLogs, search, ['action','resource','details'])`: returns the
    /// list unchanged for a blank query, else entries whose action / resource / details
    /// contain the trimmed, lowercased query as a substring.
    public static func filter(_ entries: [AuditLogEntry], query: String) -> [AuditLogEntry] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return entries }
        return entries.filter { entry in
            entry.action.lowercased().contains(needle)
                || entry.resource.lowercased().contains(needle)
                || entry.details.lowercased().contains(needle)
        }
    }

    /// Tolerant ISO-8601 parse (with + without fractional seconds), mirroring the sibling
    /// audit-log formatter.
    static func parseISO(_ iso: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }
}
