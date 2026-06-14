import Foundation

// MARK: - Wire value types (web `FeatureFlagEntry` / `FeatureFlagChange`)

/// One stored feature flag — the native peer of the web `FeatureFlagEntry`
/// (`internal/api/flags_handler.go`). The value is arbitrary JSON; identity is the
/// immutable flag key (web `keyExtractor={(row) => row.key}`). Feature-flag metadata is
/// control-plane data and carries no SI units.
public struct FeatureFlagEntry: Identifiable, Hashable, Sendable {
    public let key: String
    public let value: FlagJSONValue

    public init(key: String, value: FlagJSONValue) {
        self.key = key
        self.value = value
    }

    public var id: String {
        key
    }

    /// Single-cell value preview (web `previewValue(row.value)`).
    public var valuePreview: String {
        value.preview
    }

    /// Two-space pretty JSON used to seed the editor (web `JSON.stringify(value, null, 2)`).
    public var prettyValue: String {
        value.prettyJSON
    }
}

/// The flag-change operation enum (web `FeatureFlagOperation`, from
/// `internal/database/feature_flag_changes_repo.go`). Rendered verbatim in the audit
/// badge (`set` / `delete`); the tone mapping lives at the view boundary.
public enum FeatureFlagOperation: String, Hashable, Sendable {
    case set
    case delete
}

/// One row of the flag-change audit feed (web `FeatureFlagChange`). `oldValue` /
/// `newValue` are nullable JSON (an absent or JSON-null value renders as the em-dash via
/// `FlagJSONValue.compact`). The timestamp is formatted at the display boundary.
public struct FeatureFlagChange: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let changedAt: String
    public let actor: String
    public let actorIP: String
    public let flagKey: String
    public let operation: FeatureFlagOperation
    public let oldValue: FlagJSONValue?
    public let newValue: FlagJSONValue?
    public let reason: String
    public let traceID: String

    public init(
        id: Int64,
        changedAt: String,
        actor: String,
        actorIP: String = "",
        flagKey: String,
        operation: FeatureFlagOperation,
        oldValue: FlagJSONValue? = nil,
        newValue: FlagJSONValue? = nil,
        reason: String = "",
        traceID: String = ""
    ) {
        self.id = id
        self.changedAt = changedAt
        self.actor = actor
        self.actorIP = actorIP
        self.flagKey = flagKey
        self.operation = operation
        self.oldValue = oldValue
        self.newValue = newValue
        self.reason = reason
        self.traceID = traceID
    }
}

// MARK: - Data source seam (web `useFlags` / `useFlagChanges` / `useSetFlag` / `useDeleteFlag`)

/// Supplies the registry + audit feeds and performs the sudo-gated writes the page
/// drives. The production implementation binds the shared KMP feature-flag endpoints
/// (`GET/PUT/DELETE /system/flags*`, ADR-004 — the view holds no networking); previews
/// and tests inject doubles to drive every data state. Mirrors the sibling
/// `AuditLogDataSource` seam.
public protocol FeatureFlagsDataSource: Sendable {
    /// Web `useFlags → GET /system/flags`.
    func loadFlags() async throws -> [FeatureFlagEntry]
    /// Web `useFlagChanges → GET /system/flags/changes?limit=`.
    func loadChanges(limit: Int) async throws -> [FeatureFlagChange]
    /// Web `useSetFlag → PUT /system/flags/{key}`.
    func setFlag(key: String, value: FlagJSONValue, reason: String) async throws
    /// Web `useDeleteFlag → DELETE /system/flags/{key}?reason=`.
    func deleteFlag(key: String, reason: String) async throws
}

// MARK: - Page states (web `flags` / `changes` query phases)

/// The registry list state (web `flags` query): `.empty` is a successful load with zero
/// rows, `.error` is a retryable failure, `.loaded` carries one or more flags.
public enum FeatureFlagsListState: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case loaded([FeatureFlagEntry])
}

/// The change-audit state (web `changes` query): same phases as the registry, scoped to
/// the flag-change feed.
public enum FeatureFlagChangesState: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case loaded([FeatureFlagChange])
}

// MARK: - Display-boundary formatter (web `dateFormat.ts` `formatDateTime`)

/// Pure, testable display formatter ported from `web/src/lib/dateFormat.ts`
/// (`formatDateTime`, used by the audit feed's `<TimeStamp format="absolute">`). Flag
/// metadata carries no SI units, so this only formats the timestamp at the boundary.
public enum FeatureFlagsFormat {
    /// The em-dash shown for nil / unrenderable values (web `'—'` fallback).
    public static let emptyValue = "—"

    /// Web `formatDateTime(iso)`: en-US `MMM d, yyyy, h:mm a`; em-dash for nil / invalid.
    public static func dateTime(_ iso: String?) -> String {
        guard let iso, let date = parseISO(iso) else { return emptyValue }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateFormat = "MMM d, yyyy, h:mm a"
        return formatter.string(from: date)
    }

    /// Tolerant ISO-8601 parse (with + without fractional seconds), mirroring the sibling
    /// Audit Log formatter.
    static func parseISO(_ iso: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }
}
