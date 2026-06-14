import Foundation

/// A representative in-memory seed used as the page/preview default until the KMP-backed
/// source is injected at composition time. It is NOT production data — it exists so the
/// surface renders its populated state out of the box (mirroring the sibling
/// `SampleFeatureFlagsDataSource`) and so create / delete / revoke visibly mutate the list
/// in previews. An `actor` so its mutable state stays isolated + `Sendable` (the writes the
/// page drives are real). Production replaces it with the API-key adapter over the shared
/// core.
public actor SampleAPIKeysDataSource: APIKeysDataSource {
    private var keys: [APIKeyEntry]
    private var sequence: Int

    public init() {
        keys = Self.seed
        sequence = 0
    }

    public func loadKeys() async throws -> [APIKeyEntry] {
        keys
    }

    public func createKey(name: String, permissions: APIKeyPermission) async throws -> CreatedAPIKey {
        sequence += 1
        let token = Self.randomToken()
        let entry = APIKeyEntry(
            id: "key_\(sequence)_\(UUID().uuidString.prefix(8))",
            name: name,
            keyPrefix: String(token.prefix(11)),
            permissions: permissions,
            createdAt: Self.iso(Date()),
            lastUsedAt: nil,
            expiresAt: nil
        )
        keys.insert(entry, at: 0)
        return CreatedAPIKey(entry: entry, key: token)
    }

    public func deleteKey(id: String) async throws {
        keys.removeAll { $0.id == id }
    }

    /// Revoking a key expires it immediately (web hides the revoke action once expired and
    /// dims the row), leaving only the delete action.
    public func revokeKey(id: String) async throws {
        keys = keys.map { key in
            guard key.id == id else { return key }
            return APIKeyEntry(
                id: key.id,
                name: key.name,
                keyPrefix: key.keyPrefix,
                permissions: key.permissions,
                createdAt: key.createdAt,
                lastUsedAt: key.lastUsedAt,
                expiresAt: Self.iso(Date().addingTimeInterval(-60))
            )
        }
    }

    private static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    private static func randomToken() -> String {
        let hex = "0123456789abcdef"
        let body = String((0 ..< 32).map { _ in hex.randomElement() ?? "0" })
        return "tsk_live_\(body)"
    }

    private static var seed: [APIKeyEntry] {
        let now = Date()
        return [
            APIKeyEntry(
                id: "key_prod",
                name: "Production Dashboard",
                keyPrefix: "tsk_live_a1",
                permissions: .read,
                createdAt: iso(now.addingTimeInterval(-86400 * 42)),
                lastUsedAt: iso(now.addingTimeInterval(-3600 * 5)),
                expiresAt: nil
            ),
            APIKeyEntry(
                id: "key_ci",
                name: "CI Pipeline",
                keyPrefix: "tsk_live_b7",
                permissions: .readWrite,
                createdAt: iso(now.addingTimeInterval(-86400 * 17)),
                lastUsedAt: iso(now.addingTimeInterval(-3600 * 28)),
                expiresAt: nil
            ),
            APIKeyEntry(
                id: "key_admin",
                name: "Fleet Automation",
                keyPrefix: "tsk_live_c3",
                permissions: .admin,
                createdAt: iso(now.addingTimeInterval(-86400 * 6)),
                lastUsedAt: nil,
                expiresAt: nil
            ),
            APIKeyEntry(
                id: "key_legacy",
                name: "Legacy Integration",
                keyPrefix: "tsk_live_d9",
                permissions: .read,
                createdAt: iso(now.addingTimeInterval(-86400 * 210)),
                lastUsedAt: iso(now.addingTimeInterval(-86400 * 95)),
                expiresAt: iso(now.addingTimeInterval(-86400 * 3))
            )
        ]
    }
}
