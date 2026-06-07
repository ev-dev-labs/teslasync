import Foundation

/// Cross-process hand-off channel between the App Intents / Shortcuts extension and
/// the running app, backed by the shared App Group `UserDefaults`.
///
/// App Intents can be executed by the system **out of process** (Siri, the
/// Shortcuts app, Spotlight), so an intent cannot mutate the app's in-memory
/// navigation or call its authenticated networking directly. Instead an intent
/// writes a small, **non-sensitive** request here — a route to open, or a
/// confirmed vehicle command to run — and the foregrounded app drains it through
/// `consumePendingRoute()` / `consumePendingCommand()` and executes it with its
/// real session + facade.
///
/// Privacy: this channel carries only routes, command kinds, a coarse
/// authenticated flag, and the set of currently-permitted commands. It never
/// stores tokens, VINs, coordinates, or any PII — those never leave the app
/// process (ADR-005).
///
/// `UserDefaults` is thread-safe but not `Sendable`, so the `@unchecked` is sound:
/// the struct carries no mutable Swift state of its own.
public struct IntentBridge: @unchecked Sendable {
    private let defaults: UserDefaults

    private enum Key {
        static let pendingRoute = "io.teslasync.intent.pendingRoute"
        static let pendingRouteAt = "io.teslasync.intent.pendingRoute.at"
        static let pendingCommand = "io.teslasync.intent.pendingCommand"
        static let refreshRequested = "io.teslasync.intent.refreshRequested"
        static let authenticated = "io.teslasync.intent.authenticated"
        static let permittedCommands = "io.teslasync.intent.permittedCommands"
    }

    /// Production bridge over the App Group suite, falling back to `.standard`
    /// when the entitlement is not provisioned (mirrors `WidgetSnapshotStore`).
    public init(appGroupIdentifier: String = WidgetAppGroup.identifier) {
        defaults = UserDefaults(suiteName: appGroupIdentifier) ?? .standard
    }

    /// Test/preview initializer over an explicit (e.g. ephemeral) suite.
    public init(defaults: UserDefaults) {
        self.defaults = defaults
    }

    /// The shared production bridge.
    public static let shared = IntentBridge()

    // MARK: - Navigation requests

    /// Records that the app should navigate to `route` when it next foregrounds.
    public func requestRoute(_ route: AppRoute, at date: Date = Date()) {
        defaults.set(route.pathSegment, forKey: Key.pendingRoute)
        defaults.set(date.timeIntervalSince1970, forKey: Key.pendingRouteAt)
    }

    /// Returns and clears any pending navigation request.
    public func consumePendingRoute() -> AppRoute? {
        guard let segment = defaults.string(forKey: Key.pendingRoute) else { return nil }
        defaults.removeObject(forKey: Key.pendingRoute)
        defaults.removeObject(forKey: Key.pendingRouteAt)
        return AppRouteParser.parse(path: "/" + segment)
    }

    // MARK: - Command requests

    /// Enqueues a confirmed command for the app to execute in the foreground.
    public func enqueueCommand(_ request: VehicleCommandRequest) {
        guard let data = try? JSONEncoder().encode(request) else { return }
        defaults.set(data, forKey: Key.pendingCommand)
    }

    /// Returns and clears any pending command request.
    public func consumePendingCommand() -> VehicleCommandRequest? {
        guard let data = defaults.data(forKey: Key.pendingCommand) else { return nil }
        defaults.removeObject(forKey: Key.pendingCommand)
        return try? JSONDecoder().decode(VehicleCommandRequest.self, from: data)
    }

    // MARK: - Refresh requests

    /// Records that the app should force-refresh live vehicle state on next
    /// foreground (the refresh runs in-app where the session + SSE live).
    public func requestRefresh() {
        defaults.set(true, forKey: Key.refreshRequested)
    }

    /// Returns and clears any pending refresh request.
    public func consumeRefreshRequest() -> Bool {
        guard defaults.bool(forKey: Key.refreshRequested) else { return false }
        defaults.removeObject(forKey: Key.refreshRequested)
        return true
    }

    // MARK: - Authentication mirror (non-sensitive)

    /// The app mirrors whether a session exists so intents can gate safely without
    /// ever touching tokens.
    public var isAuthenticated: Bool {
        defaults.bool(forKey: Key.authenticated)
    }

    /// Updates the coarse authenticated flag (called by the app on auth changes).
    public func setAuthenticated(_ authenticated: Bool) {
        defaults.set(authenticated, forKey: Key.authenticated)
    }

    // MARK: - Command capability mirror ("where backend permissions allow")

    /// The set of command kinds the backend currently permits for this user, as
    /// mirrored by the app. An empty set means "unknown / none permitted".
    public var permittedCommands: Set<VehicleCommandKind> {
        let raw = defaults.array(forKey: Key.permittedCommands) as? [String] ?? []
        return Set(raw.compactMap(VehicleCommandKind.init(rawValue:)))
    }

    /// Mirrors the backend-permitted command set (called by the app).
    public func setPermittedCommands(_ commands: Set<VehicleCommandKind>) {
        defaults.set(commands.map(\.rawValue).sorted(), forKey: Key.permittedCommands)
    }

    /// Clears every cross-process value (used on sign-out to drop residual state).
    public func clear() {
        for key in [
            Key.pendingRoute, Key.pendingRouteAt, Key.pendingCommand, Key.refreshRequested,
            Key.authenticated, Key.permittedCommands
        ] {
            defaults.removeObject(forKey: key)
        }
    }
}
