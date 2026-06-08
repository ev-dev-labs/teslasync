//
//  NotificationSettings.Models.swift
//  TeslaSync — P4 feature view · 0208 · NotificationSettings (Apple)
//
//  The Foundation-only value types for the settings "Notifications" feature view: the OS notification
//  authorization (web `useWebPush().permission` + `isSupported`), the event-delivery preferences (web
//  `useNotificationListener().prefs`), the tab-signal app settings (web `useSettings()`
//  `tab_badge_enabled` / `critical_flash_enabled`), the per-channel sound preferences (web
//  `useNotificationSoundPrefs()`), the sound-channel enum (web `NOTIFICATION_SOUND_CATEGORIES`), the
//  inbound snapshot, the injected pre-localized copy, and the phase / status / connection enums. Free of
//  SwiftUI so the projection logic compiles and unit-tests on a plain host. Parity target:
//  features/settings/components/NotificationSettings.tsx.
//

import Foundation

// MARK: - OS notification authorization (web `useWebPush().permission` + `isSupported`)

/// The notification-permission state the surface branches on. The web reads `Notification.permission`
/// (`'default'` / `'granted'` / `'denied'`) gated by `isSupported` (`'Notification' in window`); the
/// native surface folds the unsupported case into the same enum so every web branch maps one-to-one.
/// On Apple this is `UNUserNotificationCenter`'s `UNAuthorizationStatus`: `.notDetermined` → request
/// affordance, `.authorized` / `.provisional` / `.ephemeral` → granted, `.denied` → blocked.
public enum NotificationAuthorization: String, Sendable, Equatable, CaseIterable {
    /// Web `!isSupported` — the platform exposes no notification capability.
    case unsupported
    /// Web `permission === 'default'` — not yet asked; show the enable affordance.
    case notDetermined
    /// Web `permission === 'granted'` — delivery allowed; show the per-event toggles.
    case granted
    /// Web `permission === 'denied'` — blocked; deep-link to system Settings.
    case denied
}

// MARK: - Sound channel (web `NOTIFICATION_SOUND_CATEGORIES`)

/// One notification sound channel, in the web's render order. The raw value is the canonical key the web
/// stores in localStorage + reads in `t('notificationSounds.category.${category}')`, so the native
/// catalog key and any cross-platform preference round-trip identically.
public enum NotificationSoundCategory: String, Sendable, Equatable, CaseIterable, Identifiable {
    case criticalAlert = "critical_alert"
    case warningAlert = "warning_alert"
    case infoAlert = "info_alert"
    case chargeComplete = "charge_complete"
    case driveComplete = "drive_complete"
    case automationRun = "automation_run"
    case achievement

    public var id: String {
        rawValue
    }

    /// The English fallback label (web `categoryFallback(category)`), used as the copy default and pinned
    /// by tests. The localized label resolves through the P1/S10 facade key
    /// `notificationSounds.category.<rawValue>`.
    public var defaultLabel: String {
        switch self {
        case .criticalAlert: "Critical alerts"
        case .warningAlert: "Warning alerts"
        case .infoAlert: "Informational alerts"
        case .chargeComplete: "Charge complete"
        case .driveComplete: "Drive complete"
        case .automationRun: "Automation runs"
        case .achievement: "Achievements"
        }
    }
}

// MARK: - Event-delivery preferences (web `useNotificationListener().prefs`)

/// Which out-of-app events fire a notification (web `WebPushPreferences`). Shown only once the surface is
/// authorized — exactly the web `permission === 'granted'` gate around the "Notify me about" block.
public struct NotificationEventPrefs: Sendable, Equatable {
    /// Web `prefs.alerts` — alert triggers. Defaults on.
    public var alerts: Bool
    /// Web `prefs.exportStatus` — export-completion events. Defaults on.
    public var exportCompletions: Bool

    public init(alerts: Bool = true, exportCompletions: Bool = true) {
        self.alerts = alerts
        self.exportCompletions = exportCompletions
    }

    /// The web `DEFAULT_PREFS` (both on).
    public static let defaults = NotificationEventPrefs()
}

// MARK: - Tab-signal app settings (web `useSettings()` subset)

/// The two app-settings booleans the surface drives (web `settings.tab_badge_enabled` /
/// `settings.critical_flash_enabled`). Both are persisted server-side via the full-object upsert (web
/// `useSaveSettings`); a present value of `false` is the only thing that turns them off — a missing field
/// defaults on (web `settings?.field !== false`).
public struct TabSignalSettings: Sendable, Equatable {
    /// Web `tab_badge_enabled` — unread count in the app badge / browser tab.
    public var badgeEnabled: Bool
    /// Web `critical_flash_enabled` — flash the title on critical alerts.
    public var criticalFlashEnabled: Bool

    public init(badgeEnabled: Bool = true, criticalFlashEnabled: Bool = true) {
        self.badgeEnabled = badgeEnabled
        self.criticalFlashEnabled = criticalFlashEnabled
    }
}

// MARK: - Per-channel sound preferences (web `useNotificationSoundPrefs()`)

/// The per-channel audio preferences (web `NotificationSoundPrefs`): the master gate, the per-channel
/// gates, and the `[0, 1]` output volume. Defaults mirror the web `DEFAULT_NOTIFICATION_SOUND_PREFS`
/// exactly so a fresh install renders identically on every platform.
public struct NotificationSoundPrefs: Sendable, Equatable {
    /// The overall sound gate (web `master`) — overall sound on/off. When false every channel is muted.
    /// Defaults off. Named `enabled` to satisfy the inclusive-language lint.
    public var enabled: Bool
    /// Web `perCategory` — the per-channel gate map.
    public var perCategory: [NotificationSoundCategory: Bool]
    /// Web `volume` — output level in `[0, 1]`. Defaults `0.6`.
    public var volume: Double

    public init(
        enabled: Bool = false,
        perCategory: [NotificationSoundCategory: Bool] = NotificationSoundPrefs.defaultPerCategory,
        volume: Double = 0.6
    ) {
        self.enabled = enabled
        self.perCategory = perCategory
        self.volume = volume
    }

    /// The web `DEFAULT_NOTIFICATION_SOUND_PREFS.perCategory` map (critical / warning / charge on; the
    /// rest off).
    public static let defaultPerCategory: [NotificationSoundCategory: Bool] = [
        .criticalAlert: true,
        .warningAlert: true,
        .infoAlert: false,
        .chargeComplete: true,
        .driveComplete: false,
        .automationRun: false,
        .achievement: false
    ]

    /// The full web default preferences.
    public static let defaults = NotificationSoundPrefs()

    /// Whether `category` is gated on, defaulting to the web seed when the map omits it.
    public func isOn(_ category: NotificationSoundCategory) -> Bool {
        perCategory[category] ?? (NotificationSoundPrefs.defaultPerCategory[category] ?? false)
    }
}

// MARK: - Inbound snapshot (the coalesced read the source pushes)

/// One coalesced snapshot of everything the surface renders: the authorization, the event prefs, the tab
/// settings (`nil` until the settings query resolves — the web `settings` being `undefined`), the sound
/// prefs, and whether the autoplay hint has been dismissed (web `autoplayHintDismissed`). All independently
/// shaped so the projector can render any partial state.
public struct NotificationSettingsInput: Sendable, Equatable {
    public var authorization: NotificationAuthorization
    public var eventPrefs: NotificationEventPrefs
    /// Web `useSettings().data` — `nil` while the settings query is unresolved; the tab toggles then show
    /// their defaults but cannot be persisted (web `updateTabSetting` early-returns when `!settings`).
    public var tabSettings: TabSignalSettings?
    public var soundPrefs: NotificationSoundPrefs
    /// Web `autoplayHintDismissed` — the autoplay hint shows while sounds are on and this is false.
    public var autoplayHintDismissed: Bool

    public init(
        authorization: NotificationAuthorization = .notDetermined,
        eventPrefs: NotificationEventPrefs = .defaults,
        tabSettings: TabSignalSettings? = TabSignalSettings(),
        soundPrefs: NotificationSoundPrefs = .defaults,
        autoplayHintDismissed: Bool = false
    ) {
        self.authorization = authorization
        self.eventPrefs = eventPrefs
        self.tabSettings = tabSettings
        self.soundPrefs = soundPrefs
        self.autoplayHintDismissed = autoplayHintDismissed
    }
}

// MARK: - Injected, pre-localized copy (P1/S10) for the pure projector

/// The pre-localized strings the projector needs to build the data-driven channel rows: the seven channel
/// labels the web reads via `t('notificationSounds.category.${category}')`, plus the `Test {{name}} sound`
/// VoiceOver template (web `t('notificationSounds.testAria', …, { name })`). Injected so the projection
/// stays Foundation-only and host-testable; the view resolves the real catalog copy through the P1/S10
/// facade.
public struct NotificationSettingsCopy: Sendable, Equatable {
    /// The localized label for each sound channel (web `t('notificationSounds.category.<key>')`).
    public var categoryLabels: [NotificationSoundCategory: String]
    /// The `Test {{name}} sound` accessibility template (web `notificationSounds.testAria`).
    public var testAccessibilityTemplate: String

    public init(
        categoryLabels: [NotificationSoundCategory: String] = NotificationSettingsCopy.defaultCategoryLabels,
        testAccessibilityTemplate: String = "Test {{name}} sound"
    ) {
        self.categoryLabels = categoryLabels
        self.testAccessibilityTemplate = testAccessibilityTemplate
    }

    /// The English channel labels (web `categoryFallback`) keyed by channel.
    public static let defaultCategoryLabels: [NotificationSoundCategory: String] = Dictionary(
        uniqueKeysWithValues: NotificationSoundCategory.allCases.map { ($0, $0.defaultLabel) }
    )

    /// English fallbacks (matching the web source literals) — used by previews + tests.
    public static let fallback = NotificationSettingsCopy()

    /// The localized label for `category`, falling back to the channel's English default.
    public func label(for category: NotificationSoundCategory) -> String {
        categoryLabels[category] ?? category.defaultLabel
    }
}

// MARK: - Render phase (load envelope around the web settings panel)

/// What the surface should render. The web `NotificationSettings` renders its panel as soon as it mounts;
/// the native surface widens that to the full load envelope so every prompt-required state
/// (loading / empty / error) renders here, with `stale` / `offline` carried separately on the connection.
public enum NotificationSettingsPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the settings read (web `useSettings` `isLoading` / resolved /
/// failure). The authorization + sound prefs are local reads that resolve immediately; the settings query
/// is the async leg this status tracks.
public enum NotificationSettingsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so persisted
/// settings are clearly labelled while reconnecting / offline. The web `useSettings` query can go stale;
/// the native surface surfaces that rather than silently showing it as current.
public enum NotificationSettingsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}
