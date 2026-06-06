#if canImport(UserNotifications)
    import Foundation
    import UserNotifications

    #if canImport(UIKit)
        import UIKit
    #elseif canImport(AppKit)
        import AppKit
    #endif

    /// The application delegate that receives the raw APNs + `UserNotifications`
    /// callbacks and forwards them to the `PushRuntime` (and thence the coordinator).
    /// Installed via `@UIApplicationDelegateAdaptor` / `@NSApplicationDelegateAdaptor`
    /// from `TeslaSyncApp`. It owns no business logic — it only bridges OS callbacks.
    @MainActor
    public final class PushAppDelegate: NSObject {
        /// The runtime the app connects auth into and reads navigation from.
        public let runtime = PushRuntime()

        fileprivate func bindNotificationCenter() {
            UNUserNotificationCenter.current().delegate = self
        }
    }

    // MARK: - Foreground presentation + taps (cross-platform)

    extension PushAppDelegate: UNUserNotificationCenterDelegate {
        public func userNotificationCenter(
            _: UNUserNotificationCenter,
            willPresent notification: UNNotification
        ) async -> UNNotificationPresentationOptions {
            Self.options(for: runtime.presentation(for: notification.request.content.userInfo))
        }

        public func userNotificationCenter(
            _: UNUserNotificationCenter,
            didReceive response: UNNotificationResponse
        ) async {
            runtime.receiveTap(response.notification.request.content.userInfo)
        }

        /// Maps the settings-derived `PushPresentation` to the OS presentation options.
        static func options(for presentation: PushPresentation) -> UNNotificationPresentationOptions {
            guard !presentation.isSuppressed else { return [] }
            var options: UNNotificationPresentationOptions = []
            if presentation.showsBanner {
                options.insert(.banner)
                options.insert(.list)
            }
            if presentation.playsSound { options.insert(.sound) }
            if presentation.setsBadge { options.insert(.badge) }
            return options
        }
    }

    // MARK: - APNs token lifecycle (platform-specific signatures)

    #if os(iOS)
        extension PushAppDelegate: UIApplicationDelegate {
            public func application(
                _: UIApplication,
                didFinishLaunchingWithOptions _: [UIApplication.LaunchOptionsKey: Any]? = nil
            ) -> Bool {
                bindNotificationCenter()
                return true
            }

            public func application(
                _: UIApplication,
                didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
            ) {
                runtime.receiveToken(deviceToken)
            }

            public func application(
                _: UIApplication,
                didFailToRegisterForRemoteNotificationsWithError error: Error
            ) {
                runtime.receiveFailure(error)
            }
        }

    #elseif os(macOS)
        extension PushAppDelegate: NSApplicationDelegate {
            public func applicationDidFinishLaunching(_: Notification) {
                bindNotificationCenter()
            }

            public func application(
                _: NSApplication,
                didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
            ) {
                runtime.receiveToken(deviceToken)
            }

            public func application(
                _: NSApplication,
                didFailToRegisterForRemoteNotificationsWithError error: Error
            ) {
                runtime.receiveFailure(error)
            }
        }
    #endif
#endif
