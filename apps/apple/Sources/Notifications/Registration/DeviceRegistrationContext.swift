import Foundation

/// The device/app metadata posted alongside the APNs token to `/api/v1/devices`.
/// Resolved once at launch from the bundle + process; Shared-free and `Sendable`
/// so it crosses into the registrar without bridging. No precise-location or
/// identifying fields are collected (ADR-016).
public struct DeviceRegistrationContext: Sendable {
    public let platform: DevicePlatform
    public let environment: DevicePushEnvironment
    public let bundleID: String
    public let appVersion: String?
    public let osVersion: String?
    public let locale: String?
    public let deviceModel: String?

    public init(
        platform: DevicePlatform,
        environment: DevicePushEnvironment,
        bundleID: String,
        appVersion: String? = nil,
        osVersion: String? = nil,
        locale: String? = nil,
        deviceModel: String? = nil
    ) {
        self.platform = platform
        self.environment = environment
        self.bundleID = bundleID
        self.appVersion = appVersion
        self.osVersion = osVersion
        self.locale = locale
        self.deviceModel = deviceModel
    }

    /// Builds a `DeviceRegistration` for this context with the supplied APNs token.
    public func registration(token: String) -> DeviceRegistration {
        DeviceRegistration(
            token: token,
            platform: platform,
            environment: environment,
            bundleID: bundleID,
            appVersion: appVersion,
            osVersion: osVersion,
            locale: locale,
            deviceModel: deviceModel
        )
    }

    /// The live context for this build: platform from the compile target, APNs
    /// environment from the build configuration (`sandbox` for debug, `production`
    /// for release), and identity from the main bundle.
    public static func current(bundle: Bundle = .main) -> DeviceRegistrationContext {
        #if os(macOS)
            let platform: DevicePlatform = .macOS
        #else
            let platform: DevicePlatform = .iOS
        #endif
        #if DEBUG
            let environment: DevicePushEnvironment = .sandbox
        #else
            let environment: DevicePushEnvironment = .production
        #endif
        return DeviceRegistrationContext(
            platform: platform,
            environment: environment,
            bundleID: bundle.bundleIdentifier ?? "io.teslasync.app",
            appVersion: bundle.infoDictionary?["CFBundleShortVersionString"] as? String,
            osVersion: ProcessInfo.processInfo.operatingSystemVersionString,
            locale: Locale.current.identifier
        )
    }
}
