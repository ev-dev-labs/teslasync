import Foundation
import Observation

/// The app-lifetime owner of the push subsystem: it lazily builds the live
/// `PushCoordinator` (system authorizer + HTTP `/devices` registrar over the P5
/// auth seams) and the `LiveActivityController`, and buffers any APNs token / tap
/// that arrives from the app delegate before auth is wired. The SwiftUI `App`
/// connects it once at launch and reads `coordinator` to drive deep-link
/// navigation + host the settings screen.
@MainActor
@Observable
public final class PushRuntime {
    /// The live coordinator, available after `connect(auth:baseURL:)`.
    public private(set) var coordinator: PushCoordinator?
    /// The Live Activity controller (real on iOS 16.2+, no-op elsewhere).
    public let activities = LiveActivityController.live()

    @ObservationIgnored private var pendingToken: Data?
    @ObservationIgnored private var pendingTaps: [[AnyHashable: Any]] = []

    public init() {}

    /// Builds and starts the live coordinator once the app's auth + API base URL are
    /// known (idempotent). Flushes any APNs callbacks that arrived beforehand.
    public func connect(auth: (any AuthTokenProviding & AuthChallengeHandling)?, baseURL: URL) {
        guard coordinator == nil else { return }
        #if canImport(UserNotifications)
            let authorizer: any PushAuthorizing = SystemPushAuthorizer()
        #else
            let authorizer: any PushAuthorizing = NoopPushAuthorizer()
        #endif
        let registrar = HTTPDeviceRegistrar(baseURL: baseURL, tokenProvider: auth, challenge: auth)
        let coordinator = PushCoordinator(
            authorizer: authorizer,
            registrar: registrar,
            settingsModel: PushSettingsModel(),
            context: .current()
        )
        self.coordinator = coordinator

        if let token = pendingToken {
            pendingToken = nil
            Task { await coordinator.didRegister(tokenData: token) }
        }
        let taps = pendingTaps
        pendingTaps.removeAll()
        for info in taps {
            coordinator.handleTap(userInfo: info)
        }
        Task { await coordinator.start() }
    }

    /// Reads + clears the pending deep-link route, applied by the app to navigation.
    public func consumePendingRoute() -> AppRoute? {
        coordinator?.consumePendingRoute()
    }

    // MARK: - App-delegate intake (buffers until `connect`)

    func receiveToken(_ data: Data) {
        if let coordinator {
            Task { await coordinator.didRegister(tokenData: data) }
        } else {
            pendingToken = data
        }
    }

    func receiveFailure(_ error: Error) {
        coordinator?.didFailToRegister(error: error)
    }

    func receiveTap(_ info: [AnyHashable: Any]) {
        if let coordinator {
            coordinator.handleTap(userInfo: info)
        } else {
            pendingTaps.append(info)
        }
    }

    func presentation(for info: [AnyHashable: Any]) -> PushPresentation {
        coordinator?.foregroundPresentation(for: info) ?? .silent
    }
}
