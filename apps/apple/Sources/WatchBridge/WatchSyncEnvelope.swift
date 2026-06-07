import Foundation

/// Pure (de)serialization for the WatchConnectivity boundary. WatchConnectivity
/// exchanges `[String: Any]` dictionaries; this wraps the Codable sync types as
/// JSON `Data` under stable keys so the live transport stays a thin shell and all
/// of the encoding logic is unit-testable without `WCSession`.
public enum WatchSyncEnvelope {
    static let payloadKey = "payload"
    static let commandRequestKey = "commandRequest"
    static let commandResultKey = "commandResult"
    static let refreshKey = "refreshRequest"

    // MARK: - Payload (phone → watch application context)

    public static func context(for payload: WatchSyncPayload) -> [String: Any] {
        guard let data = try? WatchSyncCoder.encode(payload) else { return [:] }
        return [payloadKey: data]
    }

    public static func payload(from context: [String: Any]) -> WatchSyncPayload? {
        guard let data = context[payloadKey] as? Data else { return nil }
        return WatchSyncCoder.decode(data)
    }

    // MARK: - Command request (watch → phone)

    public static func message(for request: WatchCommandRequest) -> [String: Any] {
        guard let data = try? WatchSyncCoder.makeEncoder().encode(request) else { return [:] }
        return [commandRequestKey: data]
    }

    public static func commandRequest(from message: [String: Any]) -> WatchCommandRequest? {
        guard let data = message[commandRequestKey] as? Data else { return nil }
        return try? WatchSyncCoder.makeDecoder().decode(WatchCommandRequest.self, from: data)
    }

    // MARK: - Command result (phone → watch reply)

    public static func message(for result: WatchCommandResult) -> [String: Any] {
        guard let data = try? WatchSyncCoder.makeEncoder().encode(result) else { return [:] }
        return [commandResultKey: data]
    }

    public static func commandResult(from message: [String: Any]) -> WatchCommandResult? {
        guard let data = message[commandResultKey] as? Data else { return nil }
        return try? WatchSyncCoder.makeDecoder().decode(WatchCommandResult.self, from: data)
    }

    // MARK: - Refresh request (watch → phone)

    public static func refreshRequestMessage() -> [String: Any] {
        [refreshKey: true]
    }

    public static func isRefreshRequest(_ message: [String: Any]) -> Bool {
        (message[refreshKey] as? Bool) == true
    }
}
