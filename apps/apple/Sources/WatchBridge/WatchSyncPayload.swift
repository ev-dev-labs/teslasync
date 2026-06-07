import Foundation

/// The cross-device payload the iPhone app pushes to the paired Apple Watch over
/// WatchConnectivity.
///
/// It carries the same already-display-formatted cached glance `snapshot` the
/// widgets use — so the watch shows last-known values with honest freshness and
/// never runs its own background stream (ADR-013) — plus the lean
/// `WatchSyncSettings` mirror and the non-sensitive `isAuthenticated` flag the
/// watch uses to gate command actions. There are no SI internals, tokens, VINs, or
/// coordinates here: the snapshot summaries are structurally redacted on the phone
/// before they are ever sent (ADR-005).
public struct WatchSyncPayload: Codable, Equatable, Sendable {
    /// Schema version of the payload. A watch that receives a newer version it does
    /// not understand falls back to its last good cache instead of misreading.
    public let schemaVersion: Int
    /// The cached glance snapshot, or `nil` when the phone has nothing cached yet.
    public let snapshot: TeslaSyncWidgetSnapshot?
    /// The mirrored core preferences.
    public let settings: WatchSyncSettings
    /// Whether the phone currently has a valid session (gates command actions).
    public let isAuthenticated: Bool
    /// When the phone produced this payload (drives the watch-side freshness).
    public let generatedAt: Date

    /// The schema version this build writes and can read.
    public static let currentSchemaVersion = 1

    public init(
        schemaVersion: Int = WatchSyncPayload.currentSchemaVersion,
        snapshot: TeslaSyncWidgetSnapshot?,
        settings: WatchSyncSettings,
        isAuthenticated: Bool,
        generatedAt: Date
    ) {
        self.schemaVersion = schemaVersion
        self.snapshot = snapshot
        self.settings = settings
        self.isAuthenticated = isAuthenticated
        self.generatedAt = generatedAt
    }

    /// Whether this build can read the payload (same or older schema).
    public var isReadable: Bool {
        schemaVersion <= WatchSyncPayload.currentSchemaVersion
    }
}

/// The single JSON coder both sides use, so the payload always round-trips across
/// the WatchConnectivity boundary regardless of OS/locale. ISO-8601 dates keep it
/// stable and debuggable.
public enum WatchSyncCoder {
    public static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }

    public static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    public static func encode(_ payload: WatchSyncPayload) throws -> Data {
        try makeEncoder().encode(payload)
    }

    /// Decodes a payload, returning `nil` for an unreadable/too-new envelope rather
    /// than throwing into the live messaging path.
    public static func decode(_ data: Data) -> WatchSyncPayload? {
        guard let payload = try? makeDecoder().decode(WatchSyncPayload.self, from: data) else { return nil }
        return payload.isReadable ? payload : nil
    }
}
