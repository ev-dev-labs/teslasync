//
//  BrowserNotificationsPageModel.swift
//  TeslaSync — P4 feature view · P7 · notifications/BrowserNotifications (Apple) — View Model
//
//  Full parity with web/src/features/notifications/pages/BrowserNotificationsPage.tsx
//  (route `/notifications/browser`), which frames the shared `NotificationSettings`
//  surface. An `@Observable` model that drives the view from local state (the web page
//  declares no API source — it renders from the `useWebPush` permission, the
//  `useNotificationListener` push preferences, the `useSettings` tab signals, and the
//  `useNotificationSoundPrefs` sound preferences). The view holds no business logic and
//  no platform service calls — those live behind the injected seams in
//  `BrowserNotificationsDataSources.swift` (ADR-004), so previews / tests drive every
//  permission state and every preference deterministically.
//

import Foundation
import Observation
import SwiftUI

// MARK: - Permission (web `useWebPush`: `isSupported` + `Notification.permission`)

/// The notification-authorization state the panel reacts to. Mirrors the web
/// `useWebPush` projection: `unsupported` (web `!isSupported`), `notDetermined`
/// (web `'default'`), `granted`, `denied`. On Apple the system authorization status
/// maps onto the same four-way switch the web permission gate uses.
enum BrowserNotificationsPermission: Equatable, Sendable {
    case unsupported
    case notDetermined
    case granted
    case denied
}

// MARK: - Sound channel (web `NOTIFICATION_SOUND_CATEGORIES`)

/// One notification-sound channel (web `NotificationSoundCategory`). The raw value is
/// the stable wire identifier the web localStorage prefs + the `notificationSounds`
/// string keys are keyed on, so the labels resolve verbatim against the shared catalog.
enum BrowserNotificationSoundCategory: String, CaseIterable, Identifiable, Sendable {
    case criticalAlert = "critical_alert"
    case warningAlert = "warning_alert"
    case infoAlert = "info_alert"
    case chargeComplete = "charge_complete"
    case driveComplete = "drive_complete"
    case automationRun = "automation_run"
    case achievement

    var id: String { rawValue }

    /// Web ``t(`notificationSounds.category.${category}`)`` — the channel label.
    var titleKey: LocalizedStringKey {
        LocalizedStringKey("translation.notificationSounds.category." + rawValue)
    }

    /// Web `DEFAULT_NOTIFICATION_SOUND_PREFS.perCategory` seed.
    var defaultEnabled: Bool {
        switch self {
        case .criticalAlert, .warningAlert, .chargeComplete: true
        case .infoAlert, .driveComplete, .automationRun, .achievement: false
        }
    }
}

// MARK: - Event preferences (web `useNotificationListener` → `WebPushPreferences`)

/// Which delivered events fire a notification (web `WebPushPreferences`). Web
/// `DEFAULT_PREFS` seeds both on.
struct BrowserPushPreferences: Codable, Equatable, Sendable {
    var alerts: Bool = true
    var exportStatus: Bool = true
}

// MARK: - Tab signals (web `useSettings` → `tab_badge_enabled` / `critical_flash_enabled`)

/// The browser-tab signal toggles (web `tab_badge_enabled` / `critical_flash_enabled`).
/// Web defaults each ON when the field is absent, so the native seed matches.
struct TabSignalPreferences: Codable, Equatable, Sendable {
    var badgeEnabled: Bool = true
    var criticalFlashEnabled: Bool = true
}

// MARK: - Sound preferences (web `useNotificationSoundPrefs` → `NotificationSoundPrefs`)

/// The notification-sound preferences (web `NotificationSoundPrefs`): the overall gate,
/// the per-channel gates (keyed by `BrowserNotificationSoundCategory.rawValue` so the
/// struct stays trivially `Codable`), and the `[0, 1]` output volume.
struct NotificationSoundPreferences: Codable, Equatable, Sendable {
    var enabled: Bool
    var enabledByCategory: [String: Bool]
    var volume: Double

    /// Web `DEFAULT_NOTIFICATION_SOUND_PREFS` (overall gate off, mixed per-channel seed,
    /// `volume: 0.6`).
    static let `default` = NotificationSoundPreferences(
        enabled: false,
        enabledByCategory: defaultEnabledByCategory,
        volume: 0.6
    )

    private static var defaultEnabledByCategory: [String: Bool] {
        var result: [String: Bool] = [:]
        for category in BrowserNotificationSoundCategory.allCases {
            result[category.rawValue] = category.defaultEnabled
        }
        return result
    }

    /// Whether `category` plays, falling back to its web default when unseen.
    func isEnabled(_ category: BrowserNotificationSoundCategory) -> Bool {
        enabledByCategory[category.rawValue] ?? category.defaultEnabled
    }

    mutating func setEnabled(_ category: BrowserNotificationSoundCategory, _ isOn: Bool) {
        enabledByCategory[category.rawValue] = isOn
    }
}

// MARK: - Aggregate preferences (the page's persisted local state)

/// The full local state the panel persists (web's three independent localStorage /
/// settings stores, collapsed to one injectable snapshot for the native page).
struct BrowserNotificationsPreferences: Codable, Equatable, Sendable {
    var push: BrowserPushPreferences = .init()
    var tab: TabSignalPreferences = .init()
    var sound: NotificationSoundPreferences = .default
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking / no
/// platform calls in the view). Owns the authorization status (web `useWebPush`), the
/// event / tab / sound preferences (web `useNotificationListener` + `useSettings` +
/// `useNotificationSoundPrefs`), persists every mutation through the injected store, and
/// requests authorization / previews a cue through the injected seams.
@MainActor
@Observable
final class BrowserNotificationsPageModel {
    /// The live authorization status (web `useWebPush.permission` + `isSupported`).
    private(set) var permission: BrowserNotificationsPermission

    /// The persisted event / tab / sound preferences.
    private(set) var preferences: BrowserNotificationsPreferences

    @ObservationIgnored private let permissionProvider: any NotificationPermissionProviding
    @ObservationIgnored private let store: any BrowserNotificationsPreferencesStoring
    @ObservationIgnored private let soundPreviewer: any NotificationSoundPreviewing

    init(
        permissionProvider: any NotificationPermissionProviding = SystemNotificationPermissionProvider(),
        store: any BrowserNotificationsPreferencesStoring = UserDefaultsBrowserNotificationsStore(),
        soundPreviewer: any NotificationSoundPreviewing = SystemNotificationSoundPreviewer(),
        initialPermission: BrowserNotificationsPermission = .notDetermined
    ) {
        self.permissionProvider = permissionProvider
        self.store = store
        self.soundPreviewer = soundPreviewer
        permission = initialPermission
        preferences = store.load()
    }

    // MARK: Authorization (web `useWebPush`)

    /// Reads the current OS authorization status (web mounts with `Notification.permission`).
    func refreshPermission() async {
        permission = await permissionProvider.current()
    }

    /// Requests authorization (web `requestPermission` → `Notification.requestPermission()`).
    func enableNotifications() async {
        permission = await permissionProvider.request()
    }

    // MARK: Event preferences (web `setPushPrefs`)

    func setAlerts(_ isOn: Bool) {
        mutate { $0.push.alerts = isOn }
    }

    func setExportStatus(_ isOn: Bool) {
        mutate { $0.push.exportStatus = isOn }
    }

    // MARK: Tab signals (web `updateTabSetting`)

    func setTabBadge(_ isOn: Bool) {
        mutate { $0.tab.badgeEnabled = isOn }
    }

    func setCriticalFlash(_ isOn: Bool) {
        mutate { $0.tab.criticalFlashEnabled = isOn }
    }

    // MARK: Sound preferences (web `setNotificationSoundPrefs`)

    /// Web `handleMasterToggle` — flips the overall sound gate (and primes audio when enabling).
    func setSoundEnabled(_ isOn: Bool) {
        mutate { $0.sound.enabled = isOn }
        if isOn {
            soundPreviewer.play(.infoAlert, volume: 0)
        }
    }

    func setSoundCategory(_ category: BrowserNotificationSoundCategory, _ isOn: Bool) {
        mutate { $0.sound.setEnabled(category, isOn) }
    }

    func setVolume(_ volume: Double) {
        mutate { $0.sound.volume = min(max(volume, 0), 1) }
    }

    /// Web `handleTestSound` — forces a cue even when the overall gate is off (the press
    /// is itself the authorising gesture), using a sensible volume floor.
    func testSound(_ category: BrowserNotificationSoundCategory) {
        let volume = preferences.sound.volume <= 0 ? 0.5 : preferences.sound.volume
        soundPreviewer.play(category, volume: volume)
    }

    private func mutate(_ transform: (inout BrowserNotificationsPreferences) -> Void) {
        var next = preferences
        transform(&next)
        guard next != preferences else { return }
        preferences = next
        store.save(next)
    }
}
