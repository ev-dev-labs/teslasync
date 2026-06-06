import Foundation

/// The Apple platform a push registration originates from. Sent to the backend so
/// the notification-worker can pick the right push provider (APNs) and topic.
public enum DevicePlatform: String, Codable, Equatable, Sendable {
    case iOS = "ios"
    case iPadOS = "ipados"
    case macOS = "macos"
}

/// The APNs delivery environment the token was minted for. A token registered for
/// `sandbox` (debug builds) must not be pushed through the production gateway and
/// vice-versa, so the server keys on this alongside the token.
public enum DevicePushEnvironment: String, Codable, Equatable, Sendable {
    case sandbox
    case production
}

/// The `POST /api/v1/devices` request body (ADR-009 additive device-registration
/// contract, ADR-003 snake_case JSON). Carries the APNs device token plus the
/// platform/environment/app metadata the notification-worker needs to fan a push
/// out to this install. No field is unit-bearing, so there is no SI conversion at
/// this layer.
public struct DeviceRegistration: Codable, Equatable, Sendable {
    /// The APNs device token, lowercase hex (never logged raw — see `PushLog`).
    public let token: String
    public let platform: DevicePlatform
    public let environment: DevicePushEnvironment
    public let bundleID: String
    public let appVersion: String?
    public let osVersion: String?
    public let locale: String?
    public let deviceModel: String?

    public init(
        token: String,
        platform: DevicePlatform,
        environment: DevicePushEnvironment,
        bundleID: String,
        appVersion: String? = nil,
        osVersion: String? = nil,
        locale: String? = nil,
        deviceModel: String? = nil
    ) {
        self.token = token
        self.platform = platform
        self.environment = environment
        self.bundleID = bundleID
        self.appVersion = appVersion
        self.osVersion = osVersion
        self.locale = locale
        self.deviceModel = deviceModel
    }

    enum CodingKeys: String, CodingKey {
        case token = "device_token"
        case platform
        case environment
        case bundleID = "bundle_id"
        case appVersion = "app_version"
        case osVersion = "os_version"
        case locale
        case deviceModel = "device_model"
    }
}

/// The `POST /api/v1/devices` response row. Decoded leniently — every field is
/// optional so a 201-with-body, a 200-echo, or a terse 204 all round-trip (the
/// registrar synthesises the token from the request when the server omits it).
public struct RegisteredDevice: Codable, Equatable, Sendable {
    public let id: Int64?
    public let token: String?
    public let platform: DevicePlatform?
    public let createdAt: String?

    public init(id: Int64? = nil, token: String? = nil, platform: DevicePlatform? = nil, createdAt: String? = nil) {
        self.id = id
        self.token = token
        self.platform = platform
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey {
        case id
        case token = "device_token"
        case platform
        case createdAt = "created_at"
    }
}

/// The `DELETE /api/v1/devices` request body — removes a single registration by
/// its APNs token (sign-out / notifications disabled).
public struct DeviceUnregistration: Codable, Equatable, Sendable {
    public let token: String

    public init(token: String) {
        self.token = token
    }

    enum CodingKeys: String, CodingKey {
        case token = "device_token"
    }
}
