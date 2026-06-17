//
//  BrowserNotificationsDataSources.swift
//  TeslaSync — P4 feature view · P7 · notifications/BrowserNotifications (Apple) — Seams
//
//  The injectable boundaries the `BrowserNotificationsPageModel` drives so the view layer
//  never touches a platform service directly (ADR-004): the authorization provider (web
//  `useWebPush` → the OS notification-authorization status), the sound previewer (web
//  `playNotificationSound` → a short system cue), and the preferences store (web's
//  localStorage / settings persistence → `UserDefaults`). Production wires the real OS
//  services; previews / tests inject deterministic doubles to exercise every permission
//  state and every preference without side effects.
//

import Foundation

#if canImport(UserNotifications)
    import UserNotifications
#endif
#if canImport(AudioToolbox)
    import AudioToolbox
#endif
#if canImport(AppKit)
    import AppKit
#endif

// MARK: - Authorization provider (web `useWebPush`)

/// Supplies + mutates the OS notification-authorization status (web `useWebPush`:
/// `Notification.permission` on mount, `Notification.requestPermission()` on enable).
protocol NotificationPermissionProviding: Sendable {
    func current() async -> BrowserNotificationsPermission
    func request() async -> BrowserNotificationsPermission
}

/// Production provider backed by `UNUserNotificationCenter` — the Apple parity of the
/// web Notification permission gate (notifications are always supported natively, so the
/// `unsupported` branch is preview-only).
struct SystemNotificationPermissionProvider: NotificationPermissionProviding {
    func current() async -> BrowserNotificationsPermission {
        #if canImport(UserNotifications)
            let status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
            return Self.map(status)
        #else
            return .notDetermined
        #endif
    }

    func request() async -> BrowserNotificationsPermission {
        #if canImport(UserNotifications)
            let center = UNUserNotificationCenter.current()
            _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
            return await current()
        #else
            return .denied
        #endif
    }

    #if canImport(UserNotifications)
        /// Projects `UNAuthorizationStatus` onto the web four-way permission switch.
        static func map(_ status: UNAuthorizationStatus) -> BrowserNotificationsPermission {
            switch status {
            case .notDetermined: .notDetermined
            case .denied: .denied
            case .authorized, .provisional, .ephemeral: .granted
            @unknown default: .notDetermined
            }
        }
    #endif
}

/// Deterministic provider for previews / tests — reports a fixed status and resolves a
/// `notDetermined` request to `granted` (the prompt "Allow" path).
struct PreviewNotificationPermissionProvider: NotificationPermissionProviding {
    let fixed: BrowserNotificationsPermission

    func current() async -> BrowserNotificationsPermission {
        fixed
    }

    func request() async -> BrowserNotificationsPermission {
        fixed == .notDetermined ? .granted : fixed
    }
}

// MARK: - Sound previewer (web `playNotificationSound`)

/// Plays a short cue for a channel (web `playNotificationSound` behind the Test button +
/// the enable-time priming play).
protocol NotificationSoundPreviewing: Sendable {
    func play(_ category: BrowserNotificationSoundCategory, volume: Double)
}

/// Production previewer — a brief system cue (iOS `AudioServices`, macOS `NSSound.beep`).
/// The system cue has no per-call volume, so `volume` is accepted for call-site parity
/// with the web signature and used only as the "is this audible at all" gate.
struct SystemNotificationSoundPreviewer: NotificationSoundPreviewing {
    func play(_ category: BrowserNotificationSoundCategory, volume: Double) {
        guard volume > 0 else { return }
        #if os(iOS)
            AudioServicesPlaySystemSound(SystemSoundID(1007))
        #elseif os(macOS)
            NSSound.beep()
        #endif
    }
}

/// No-audio previewer for previews / tests (keeps snapshot + unit runs silent).
struct SilentNotificationSoundPreviewer: NotificationSoundPreviewing {
    func play(_ category: BrowserNotificationSoundCategory, volume: Double) {}
}

// MARK: - Preferences store (web localStorage / settings persistence)

/// Persistence boundary for `BrowserNotificationsPreferences` (web's localStorage +
/// settings save). Production uses `UserDefaults`; tests use an in-memory double.
protocol BrowserNotificationsPreferencesStoring: Sendable {
    func load() -> BrowserNotificationsPreferences
    func save(_ preferences: BrowserNotificationsPreferences)
}

/// `UserDefaults`-backed persistence. `UserDefaults` is thread-safe and the struct holds
/// no mutable Swift state, so the `@unchecked Sendable` is sound.
struct UserDefaultsBrowserNotificationsStore: BrowserNotificationsPreferencesStoring, @unchecked Sendable {
    private let defaults: UserDefaults
    private let key: String

    init(defaults: UserDefaults = .standard, key: String = "io.teslasync.browserNotifications.prefs") {
        self.defaults = defaults
        self.key = key
    }

    func load() -> BrowserNotificationsPreferences {
        guard let data = defaults.data(forKey: key),
              let preferences = try? JSONDecoder().decode(BrowserNotificationsPreferences.self, from: data)
        else {
            return BrowserNotificationsPreferences()
        }
        return preferences
    }

    func save(_ preferences: BrowserNotificationsPreferences) {
        guard let data = try? JSONEncoder().encode(preferences) else { return }
        defaults.set(data, forKey: key)
    }
}

/// In-memory `BrowserNotificationsPreferencesStoring` for previews / tests.
final class InMemoryBrowserNotificationsStore: BrowserNotificationsPreferencesStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var preferences: BrowserNotificationsPreferences

    init(preferences: BrowserNotificationsPreferences = .init()) {
        self.preferences = preferences
    }

    func load() -> BrowserNotificationsPreferences {
        lock.lock()
        defer { lock.unlock() }
        return preferences
    }

    func save(_ preferences: BrowserNotificationsPreferences) {
        lock.lock()
        self.preferences = preferences
        lock.unlock()
    }
}
