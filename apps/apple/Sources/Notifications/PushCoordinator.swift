import Foundation
import Observation

/// The push subsystem's single source of truth: it drives the APNs authorization
/// + token lifecycle, registers/unregisters the device with TeslaSync, routes
/// tapped notifications to a deep-link `AppRoute`, and decides foreground
/// presentation (honoring quiet hours + per-category settings). All UI-affecting
/// mutation is on the main actor; the OS callbacks (`didRegister`, the
/// `UNUserNotificationCenterDelegate`) funnel through here.
///
/// Foreground SSE live data is P6-0001; this is the *background* channel (ADR-009):
/// pushes survive app suspension, and a tap brings the app forward to `pendingRoute`.
@MainActor
@Observable
public final class PushCoordinator {
    /// The OS authorization status (mirrors `settings.authorizationStatus`).
    public private(set) var authorizationStatus: PushAuthorizationStatus = .notDetermined
    /// Whether this device's APNs token is registered with TeslaSync.
    public private(set) var isRegistered = false
    /// The last registration/authorization error, if any.
    public private(set) var lastError: FacadeError?
    /// The notification whose in-app banner is currently shown (foreground).
    public private(set) var foregroundBanner: PushNotification?
    /// A deep-link route a tapped notification requests; the app consumes + clears it.
    public private(set) var pendingRoute: AppRoute?

    /// The settings the push-settings screen binds to (owned here so the coordinator
    /// and the screen share one model).
    public let settingsModel: PushSettingsModel

    @ObservationIgnored private let authorizer: any PushAuthorizing
    @ObservationIgnored private let registrar: any DeviceRegistering
    @ObservationIgnored private let context: DeviceRegistrationContext
    @ObservationIgnored private let log: PushLog
    @ObservationIgnored private let clock: @Sendable () -> Date

    @ObservationIgnored private var deviceToken: String?

    public init(
        authorizer: any PushAuthorizing,
        registrar: any DeviceRegistering,
        settingsModel: PushSettingsModel,
        context: DeviceRegistrationContext,
        log: PushLog = PushLog(),
        clock: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.authorizer = authorizer
        self.registrar = registrar
        self.settingsModel = settingsModel
        self.context = context
        self.log = log
        self.clock = clock
    }

    // MARK: - Lifecycle

    /// Reads the current authorization status on launch and, when already
    /// authorized, asks the OS to (re)issue an APNs token so a token that rotated
    /// while the app was closed re-registers.
    public func start() async {
        await applyStatus(authorizer.currentStatus())
        if authorizationStatus.isAuthorized {
            await authorizer.registerForRemoteNotifications()
        }
    }

    /// Requests authorization (surfacing the system prompt on first ask) using the
    /// configured channels, then registers for remote notifications when granted.
    public func requestAuthorization() async {
        let status = await authorizer.requestAuthorization(options: settingsModel.settings.authorizationOptions)
        await applyStatus(status)
        if status.isAuthorized {
            await authorizer.registerForRemoteNotifications()
        } else {
            log.notice("authorization not granted: \(status.rawValue)")
        }
    }

    /// Re-reads the OS authorization status (e.g. after returning from Settings).
    public func refreshAuthorizationStatus() async {
        await applyStatus(authorizer.currentStatus())
    }

    /// Toggles critical-alert eligibility, then re-requests authorization so the OS
    /// option set reflects the change.
    public func setCriticalAlertsEnabled(_ enabled: Bool) async {
        settingsModel.setCriticalAlertsEnabled(enabled)
        if authorizationStatus.isAuthorized || authorizationStatus.canPrompt {
            await requestAuthorization()
        }
    }

    // MARK: - APNs token callbacks (from the app delegate)

    /// Handles a freshly issued APNs token: hex-encodes it and registers the device.
    public func didRegister(tokenData: Data) async {
        let token = tokenData.map { String(format: "%02x", $0) }.joined()
        deviceToken = token
        log.info("apns token received \(PushLog.maskToken(token))")
        await registerDevice(token: token)
    }

    /// Handles a failure to obtain an APNs token (no entitlement, no network, etc.).
    public func didFailToRegister(error: Error) {
        isRegistered = false
        lastError = mapError(error)
        log.error("apns registration failed: \(String(describing: error))")
    }

    // MARK: - Notification routing

    /// Routes a tapped notification (from `didReceive response`) to its deep link.
    public func handleTap(userInfo: [AnyHashable: Any]) {
        handleTap(PushPayloadParser.parse(userInfo, now: clock()))
    }

    /// Routes an already-parsed notification tap to its deep link.
    public func handleTap(_ notification: PushNotification) {
        pendingRoute = notification.route
        log.info("notification tap routed to \(notification.route.rawValue) [\(notification.category.rawValue)]")
    }

    /// Computes the foreground presentation for an incoming push and, when it should
    /// show a banner with alert content, raises the in-app banner. Returns the
    /// decision so the delegate can map it to `UNNotificationPresentationOptions`.
    @discardableResult
    public func foregroundPresentation(for userInfo: [AnyHashable: Any]) -> PushPresentation {
        let notification = PushPayloadParser.parse(userInfo, now: clock())
        let presentation = settingsModel.settings.presentation(for: notification, at: clock())
        if presentation.showsBanner, notification.hasAlertContent {
            foregroundBanner = notification
        }
        return presentation
    }

    /// Dismisses the in-app foreground banner.
    public func dismissBanner() {
        foregroundBanner = nil
    }

    /// Opens the in-app banner's deep link, then dismisses it.
    public func openBanner() {
        if let banner = foregroundBanner {
            handleTap(banner)
        }
        foregroundBanner = nil
    }

    /// The app calls this to read + clear a pending deep-link route.
    public func consumePendingRoute() -> AppRoute? {
        defer { pendingRoute = nil }
        return pendingRoute
    }

    // MARK: - Sign-out / disable

    /// Unregisters this device from TeslaSync and stops remote-notification delivery.
    public func unregister() async {
        if let token = deviceToken {
            do {
                try await registrar.unregister(token: token)
                log.info("device unregistered \(PushLog.maskToken(token))")
            } catch {
                lastError = mapError(error)
                log.error("device unregister failed: \(String(describing: error))")
            }
        }
        await authorizer.unregisterForRemoteNotifications()
        deviceToken = nil
        isRegistered = false
    }

    // MARK: - Internals

    private func registerDevice(token: String) async {
        do {
            _ = try await registrar.register(context.registration(token: token))
            isRegistered = true
            lastError = nil
            log.info("device registered with teslasync")
        } catch {
            isRegistered = false
            lastError = mapError(error)
            log.error("device registration failed: \(String(describing: error))")
        }
    }

    private func applyStatus(_ status: PushAuthorizationStatus) async {
        authorizationStatus = status
        settingsModel.updateAuthorization(status)
    }

    /// Maps a thrown error to a `FacadeError` without importing `Shared` — the
    /// registrar already throws `FacadeError`, so a cast covers the common path.
    private func mapError(_ error: Error) -> FacadeError {
        (error as? FacadeError) ?? .unknown(message: String(describing: error))
    }
}
