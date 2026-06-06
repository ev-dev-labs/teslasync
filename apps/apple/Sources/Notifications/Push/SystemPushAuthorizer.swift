#if canImport(UserNotifications)
    import Foundation
    import UserNotifications

    #if canImport(UIKit)
        import UIKit
    #elseif canImport(AppKit)
        import AppKit
    #endif

    /// The production `PushAuthorizing` over `UNUserNotificationCenter` plus the
    /// platform's remote-registration entry point (`UIApplication` on iOS/iPadOS,
    /// `NSApplication` on macOS). It holds no OS object (so it stays `Sendable`),
    /// resolving `UNUserNotificationCenter.current()` per call.
    public struct SystemPushAuthorizer: PushAuthorizing {
        private let log: PushLog

        public init(log: PushLog = PushLog()) {
            self.log = log
        }

        public func currentStatus() async -> PushAuthorizationStatus {
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            return Self.map(settings.authorizationStatus)
        }

        @discardableResult
        public func requestAuthorization(options: PushAuthorizationOptions) async -> PushAuthorizationStatus {
            do {
                _ = try await UNUserNotificationCenter.current().requestAuthorization(options: Self.map(options))
            } catch {
                log.error("authorization request failed: \(String(describing: error))")
            }
            return await currentStatus()
        }

        public func registerForRemoteNotifications() async {
            await MainActor.run {
                #if canImport(UIKit)
                    UIApplication.shared.registerForRemoteNotifications()
                #elseif canImport(AppKit)
                    NSApplication.shared.registerForRemoteNotifications()
                #endif
            }
        }

        public func unregisterForRemoteNotifications() async {
            await MainActor.run {
                #if canImport(UIKit)
                    UIApplication.shared.unregisterForRemoteNotifications()
                #elseif canImport(AppKit)
                    NSApplication.shared.unregisterForRemoteNotifications()
                #endif
            }
        }

        // MARK: - Mapping

        static func map(_ status: UNAuthorizationStatus) -> PushAuthorizationStatus {
            switch status {
            case .authorized: .authorized
            case .denied: .denied
            case .provisional: .provisional
            case .ephemeral: .ephemeral
            case .notDetermined: .notDetermined
            @unknown default: .notDetermined
            }
        }

        static func map(_ options: PushAuthorizationOptions) -> UNAuthorizationOptions {
            var result: UNAuthorizationOptions = []
            if options.contains(.alert) { result.insert(.alert) }
            if options.contains(.badge) { result.insert(.badge) }
            if options.contains(.sound) { result.insert(.sound) }
            if options.contains(.criticalAlert) { result.insert(.criticalAlert) }
            if options.contains(.provisional) { result.insert(.provisional) }
            return result
        }
    }
#endif
