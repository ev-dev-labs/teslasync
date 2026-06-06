import Foundation

/// The notification categories the app asks to present, mapped to
/// `UNAuthorizationOptions` by the system authorizer. `criticalAlert` requires a
/// special Apple entitlement; it is requested only when the install is eligible.
public struct PushAuthorizationOptions: OptionSet, Sendable {
    public let rawValue: Int

    public init(rawValue: Int) {
        self.rawValue = rawValue
    }

    public static let alert = PushAuthorizationOptions(rawValue: 1 << 0)
    public static let badge = PushAuthorizationOptions(rawValue: 1 << 1)
    public static let sound = PushAuthorizationOptions(rawValue: 1 << 2)
    public static let criticalAlert = PushAuthorizationOptions(rawValue: 1 << 3)
    public static let provisional = PushAuthorizationOptions(rawValue: 1 << 4)

    /// The standard request: visible alerts, sounds, and badges.
    public static let standard: PushAuthorizationOptions = [.alert, .badge, .sound]
}

/// The seam the push coordinator drives the APNs lifecycle through: query/request
/// authorization and register/unregister for remote notifications. Implemented by
/// `SystemPushAuthorizer` over `UNUserNotificationCenter`; faked in tests so the
/// permission and token flows run with no APNs runtime, entitlement, or prompt.
public protocol PushAuthorizing: Sendable {
    /// The current OS authorization status (no prompt).
    func currentStatus() async -> PushAuthorizationStatus

    /// Requests authorization, surfacing the system prompt when `status` is
    /// `.notDetermined`. Returns the resulting status.
    @discardableResult
    func requestAuthorization(options: PushAuthorizationOptions) async -> PushAuthorizationStatus

    /// Asks the OS to obtain an APNs device token. The token is delivered
    /// asynchronously to the app delegate, not returned here.
    func registerForRemoteNotifications() async

    /// Stops remote-notification delivery to this device (sign-out / disable).
    func unregisterForRemoteNotifications() async
}

/// An authorizer that always reports `.denied` and ignores registration — the
/// honest fallback on a platform without `UserNotifications`. (Both Apple targets
/// ship `UserNotifications`, so the system authorizer is used in practice; this
/// keeps the runtime total.)
public struct NoopPushAuthorizer: PushAuthorizing {
    public init() {}

    public func currentStatus() async -> PushAuthorizationStatus {
        .denied
    }

    @discardableResult
    public func requestAuthorization(options _: PushAuthorizationOptions) async -> PushAuthorizationStatus {
        .denied
    }

    public func registerForRemoteNotifications() async {}

    public func unregisterForRemoteNotifications() async {}
}
