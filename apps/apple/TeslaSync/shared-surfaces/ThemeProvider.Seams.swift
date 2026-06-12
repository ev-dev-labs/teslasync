//
//  ThemeProvider.Seams.swift
//  TeslaSync — P4 shared surface · 0229 · ThemeProvider (Apple)
//
//  The injectable seams the `@Observable` model depends on — kept behind protocols so the view does no
//  I/O directly (the acceptance bar) and so previews/tests drive every branch with in-memory doubles:
//
//    • ThemePersistence (P1/S8) — local durable storage, the native peer of the web `localStorage`
//      keys (`teslasync-theme`, `teslasync-mode`, `teslasync-custom-primary`, `teslasync-custom-accent`).
//      Default: `UserDefaultsThemePersistence`.
//    • ThemeRemoteGateway (P1/S8) — the backend `/settings` hydrate + persist seam, the native peer of
//      the web first-mount `fetch('/settings')` + fire-and-forget `PUT /settings`. The view never holds
//      a URLSession; the production app injects an adapter over the shared settings store. Default:
//      `StaticThemeRemoteGateway` (returns "no remote override", i.e. local-only) so the surface, its
//      previews, and its tests run with zero networking.
//    • ThemeBroadcaster — the cross-process change fan-out, the native peer of the web cross-tab
//      `broadcast`/`subscribe`. Default used by the production provider: `NotificationCenterThemeBroadcaster`;
//      the model's own default is `NoopThemeBroadcaster` so tests never touch global notifications.
//    • ThemeProviderTelemetry (P1/S11) — the `view.opened` sink; default logs via `os.Logger`.
//

import Foundation
import OSLog

// MARK: - ThemePersistence (web localStorage)

/// Local durable storage of the selection — the native peer of the web `localStorage` theme keys.
public protocol ThemePersistence: Sendable {
    /// Reads the stored selection, falling back per field to the web defaults (web `useState` lazy
    /// initializers). Always returns a value (web always has a starting selection).
    func load() -> ThemeSelection
    /// Writes the selection (web `localStorage.setItem` for each key).
    func save(_ selection: ThemeSelection)
}

/// The localStorage-key names, mirrored verbatim from the web source so the stored values are
/// conceptually portable.
public enum ThemePersistenceKeys {
    public static let colorway = "teslasync-theme"
    public static let mode = "teslasync-mode"
    public static let customPrimary = "teslasync-custom-primary"
    public static let customAccent = "teslasync-custom-accent"
}

/// `UserDefaults`-backed persistence — the native peer of the web `localStorage` reads/writes.
/// `@unchecked Sendable`: the only stored member is an immutable reference to the process-wide,
/// documented-thread-safe `UserDefaults`.
public struct UserDefaultsThemePersistence: ThemePersistence, @unchecked Sendable {
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func load() -> ThemeSelection {
        let primary = defaults.string(forKey: ThemePersistenceKeys.customPrimary) ?? CustomColors.default.primary
        let accent = defaults.string(forKey: ThemePersistenceKeys.customAccent) ?? CustomColors.default.accent
        return ThemeSelectionReducer.selection(
            colorway: defaults.string(forKey: ThemePersistenceKeys.colorway),
            mode: defaults.string(forKey: ThemePersistenceKeys.mode),
            customColors: CustomColors(primary: primary, accent: accent)
        )
    }

    public func save(_ selection: ThemeSelection) {
        defaults.set(selection.colorway.rawValue, forKey: ThemePersistenceKeys.colorway)
        defaults.set(selection.mode.rawValue, forKey: ThemePersistenceKeys.mode)
        defaults.set(selection.customColors.primary, forKey: ThemePersistenceKeys.customPrimary)
        defaults.set(selection.customColors.accent, forKey: ThemePersistenceKeys.customAccent)
    }
}

/// In-memory persistence for previews + tests (no `UserDefaults` global state).
public final class InMemoryThemePersistence: ThemePersistence, @unchecked Sendable {
    private let lock = NSLock()
    private var stored: ThemeSelection

    public init(seed: ThemeSelection = .default) {
        stored = seed
    }

    public func load() -> ThemeSelection {
        lock.lock(); defer { lock.unlock() }
        return stored
    }

    public func save(_ selection: ThemeSelection) {
        lock.lock(); defer { lock.unlock() }
        stored = selection
    }
}

// MARK: - ThemeRemoteGateway (web `/settings` fetch + PUT)

/// The result of hydrating the selection from the backend `/settings` feed — drives ``ThemeSyncPhase``.
public enum ThemeRemoteResult: Sendable, Equatable {
    /// The feed returned a theme override to adopt (web `setThemeId(settings.theme)`…).
    case applied(RemoteThemeSettings)
    /// The feed resolved with no theme override — the local selection stands.
    case empty
    /// The fetch failed; the local selection stands (web `.catch(() => {})`).
    case failed
    /// No connectivity; the cached local selection stands.
    case offline
    /// The feed returned a cached override older than the freshness window (auto-refreshing).
    case stale(RemoteThemeSettings)
}

/// The backend `/settings` hydrate + persist seam — the native peer of the web first-mount
/// `fetch('/settings')` and the fire-and-forget `PUT /settings`. No `URLSession` lives in the view; the
/// production app injects an adapter over the shared settings store.
public protocol ThemeRemoteGateway: Sendable {
    /// Hydrates the theme slice of `/settings` (web first-mount effect).
    func load() async -> ThemeRemoteResult
    /// Persists the selection back to `/settings` (web fire-and-forget `PUT`). Best-effort; failures are
    /// swallowed (web `.catch(() => {})`).
    func save(_ selection: ThemeSelection) async
}

/// A fixed-result gateway — the zero-networking default (returns `.empty`, i.e. "use local") and the
/// configurable double previews/tests use to drive every sync phase.
public struct StaticThemeRemoteGateway: ThemeRemoteGateway {
    private let result: ThemeRemoteResult

    public init(result: ThemeRemoteResult = .empty) {
        self.result = result
    }

    public func load() async -> ThemeRemoteResult {
        result
    }

    public func save(_: ThemeSelection) async {}
}

// MARK: - ThemeBroadcaster (web cross-tab broadcast/subscribe)

/// A theme change to fan out — the native peer of the web `broadcast({ type: 'theme.changed', … })` /
/// `broadcast({ type: 'theme.customColors', … })` messages.
public enum ThemeChange: Sendable, Equatable {
    /// The colorway and/or mode changed (web `'theme.changed'`).
    case selection(colorway: ThemeColorway, mode: ThemeMode)
    /// The custom color pair changed (web `'theme.customColors'`).
    case customColors(CustomColors)
}

/// An opaque handle that removes a ``ThemeBroadcaster`` subscription. Held + cancelled on the main
/// actor by the model; idempotent.
public final class ThemeSubscription {
    private let onCancel: () -> Void
    private var isCancelled = false

    public init(onCancel: @escaping () -> Void) {
        self.onCancel = onCancel
    }

    public func cancel() {
        guard !isCancelled else { return }
        isCancelled = true
        onCancel()
    }
}

/// Cross-process change fan-out — the native peer of the web cross-tab `broadcast`/`subscribe`. The
/// model publishes on every local change and mirrors received changes without re-persisting or
/// re-broadcasting (the web "mirror from other tabs" guard).
public protocol ThemeBroadcaster: Sendable {
    func publish(_ change: ThemeChange)
    func subscribe(_ handler: @escaping @Sendable (ThemeChange) -> Void) -> ThemeSubscription
}

/// No-op broadcaster — the model's default so unit tests never touch process-global notifications.
public struct NoopThemeBroadcaster: ThemeBroadcaster {
    public init() {}
    public func publish(_: ThemeChange) {}
    public func subscribe(_: @escaping @Sendable (ThemeChange) -> Void) -> ThemeSubscription {
        ThemeSubscription {}
    }
}

/// `NotificationCenter`-backed broadcaster — the production fan-out the provider wires by default, the
/// native peer of the web cross-tab channel. Stateless (uses `.default`), so it is trivially `Sendable`.
public struct NotificationCenterThemeBroadcaster: ThemeBroadcaster {
    public static let notificationName = Notification.Name("io.teslasync.themeProvider.changed")

    public init() {}

    public func publish(_ change: ThemeChange) {
        NotificationCenter.default.post(
            name: Self.notificationName,
            object: nil,
            userInfo: change.userInfo
        )
    }

    public func subscribe(_ handler: @escaping @Sendable (ThemeChange) -> Void) -> ThemeSubscription {
        let token = NotificationCenter.default.addObserver(
            forName: Self.notificationName,
            object: nil,
            queue: .main
        ) { note in
            guard let change = ThemeChange(userInfo: note.userInfo) else { return }
            handler(change)
        }
        return ThemeSubscription { NotificationCenter.default.removeObserver(token) }
    }
}

extension ThemeChange {
    /// Encodes the change as primitive strings for a `Notification.userInfo`.
    var userInfo: [String: String] {
        switch self {
        case let .selection(colorway, mode):
            ["kind": "selection", "colorway": colorway.rawValue, "mode": mode.rawValue]
        case let .customColors(colors):
            ["kind": "customColors", "primary": colors.primary, "accent": colors.accent]
        }
    }

    /// Decodes a change from a `Notification.userInfo`, or `nil` when the payload is unrecognized.
    init?(userInfo: [AnyHashable: Any]?) {
        guard let info = userInfo, let kind = info["kind"] as? String else { return nil }
        switch kind {
        case "selection":
            guard
                let colorway = (info["colorway"] as? String).flatMap(ThemeColorway.init(rawValue:)),
                let mode = (info["mode"] as? String).flatMap(ThemeMode.init(rawValue:))
            else { return nil }
            self = .selection(colorway: colorway, mode: mode)
        case "customColors":
            guard let primary = info["primary"] as? String, let accent = info["accent"] as? String else {
                return nil
            }
            self = .customColors(CustomColors(primary: primary, accent: accent))
        default:
            return nil
        }
    }
}

// MARK: - ThemeProviderTelemetry (P1/S11 diagnostics)

/// Emits the `view.opened` product-analytics event for the surface (P1/S11). The default logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol ThemeProviderTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogThemeProviderTelemetry: ThemeProviderTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}
