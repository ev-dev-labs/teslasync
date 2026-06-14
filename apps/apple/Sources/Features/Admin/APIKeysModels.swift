import Foundation

// MARK: - Wire value types (web `APIKey` — web/src/types/admin.ts)

/// One API key, the native peer of the web `APIKey` interface
/// (`internal/api/api_keys_handler.go`). Only the key *prefix* is ever returned by the
/// list endpoint — the full secret is shown exactly once, at creation, via
/// `CreatedAPIKey`. API-key metadata is control-plane data and carries no SI units.
public struct APIKeyEntry: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let keyPrefix: String
    public let permissions: APIKeyPermission
    public let createdAt: String
    public let lastUsedAt: String?
    public let expiresAt: String?

    public init(
        id: String,
        name: String,
        keyPrefix: String,
        permissions: APIKeyPermission,
        createdAt: String,
        lastUsedAt: String? = nil,
        expiresAt: String? = nil
    ) {
        self.id = id
        self.name = name
        self.keyPrefix = keyPrefix
        self.permissions = permissions
        self.createdAt = createdAt
        self.lastUsedAt = lastUsedAt
        self.expiresAt = expiresAt
    }

    /// Web `isExpired(k) = k.expiresAt && new Date(k.expiresAt) < new Date()`. Evaluated
    /// against an injectable `now` so the predicate stays pure + testable.
    public func isExpired(now: Date = Date()) -> Bool {
        guard let expiresAt, let date = APIKeysFormat.parseISO(expiresAt) else { return false }
        return date < now
    }
}

/// The permission level of an API key (web union `'read' | 'read-write' | 'admin'`,
/// `internal/models/api_key.go`). Rendered verbatim in the permission chip + offered as
/// the create-form options; the tone/icon mapping lives at the view boundary.
public enum APIKeyPermission: String, Hashable, Sendable, CaseIterable {
    case read
    case readWrite = "read-write"
    case admin

    /// Tolerant decode (web falls back to `read` for an unknown permission via
    /// `cfg[perm] ?? cfg.read`).
    public init(wire: String) {
        self = APIKeyPermission(rawValue: wire) ?? .read
    }
}

/// The result of a create call (web `request<APIKey & { key: string }>`): the persisted
/// key metadata plus the one-time plaintext secret that is never returned again.
public struct CreatedAPIKey: Sendable, Equatable {
    public let entry: APIKeyEntry
    public let key: String

    public init(entry: APIKeyEntry, key: String) {
        self.entry = entry
        self.key = key
    }
}

// MARK: - Data source seam (web `useApiKeys` / `useCreateApiKey` / `useDeleteApiKey` / `useRevokeApiKey`)

/// Supplies the key list and performs the create / delete / revoke writes the page drives.
/// The production implementation binds the shared KMP API-key endpoints
/// (`GET/POST/DELETE /api-keys`, `POST /api-keys/{id}/revoke`, ADR-004 — the view holds no
/// networking); previews and tests inject doubles to drive every data state. Mirrors the
/// sibling `FeatureFlagsDataSource` seam.
public protocol APIKeysDataSource: Sendable {
    /// Web `useApiKeys → GET /api-keys`.
    func loadKeys() async throws -> [APIKeyEntry]
    /// Web `useCreateApiKey → POST /api-keys` (returns the one-time secret).
    func createKey(name: String, permissions: APIKeyPermission) async throws -> CreatedAPIKey
    /// Web `useDeleteApiKey → DELETE /api-keys/{id}`.
    func deleteKey(id: String) async throws
    /// Web `useRevokeApiKey → POST /api-keys/{id}/revoke`.
    func revokeKey(id: String) async throws
}

// MARK: - Page state (web `keys` query phases)

/// The key-list state (web `useApiKeys` query): `.empty` is a successful load with zero
/// rows, `.error` is a retryable failure, `.loaded` carries one or more keys.
public enum APIKeysListState: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case loaded([APIKeyEntry])
}

// MARK: - Display-boundary formatter (web `dateFormat.ts` `formatDate`)

/// Pure, testable display formatter ported from `web/src/lib/dateFormat.ts` (`formatDate`,
/// used by the key rows' `Created` / `Last used` timestamps: en-US `MMM d, yyyy`). API-key
/// metadata carries no SI units, so this only formats the timestamp at the boundary.
public enum APIKeysFormat {
    /// The em-dash shown for nil / unparseable values (web `'—'` fallback).
    public static let emptyValue = "—"

    /// Web `formatDate(iso)`: en-US `MMM d, yyyy`; em-dash for nil / invalid.
    public static func date(_ iso: String?) -> String {
        guard let iso, let date = parseISO(iso) else { return emptyValue }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateFormat = "MMM d, yyyy"
        return formatter.string(from: date)
    }

    /// Tolerant ISO-8601 parse (with + without fractional seconds), mirroring the sibling
    /// Feature Flags / Audit Log formatters.
    static func parseISO(_ iso: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }
}
