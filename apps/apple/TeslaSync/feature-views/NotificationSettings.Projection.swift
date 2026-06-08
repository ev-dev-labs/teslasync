//
//  NotificationSettings.Projection.swift
//  TeslaSync — P4 feature view · 0208 · NotificationSettings (Apple)
//
//  The projected output types for the settings "Notifications" feature view (the per-channel sound rows
//  and the whole-surface projection), the diagnostics surface slug, and the VoiceOver summary builder.
//  Foundation-only so it executes on a plain host and is pinned by tests. Parity target:
//  features/settings/components/NotificationSettings.tsx.
//

import Foundation

// MARK: - Projected channel row (web sound-channel `<Toggle> + <Button>Test</Button>` row)

/// One projected sound-channel row (web's per-category row): the localized label, the channel key, its
/// gate state, whether it is dimmed because the master switch is off (web `!soundPrefs.master &&
/// 'opacity-60'`), and the pre-interpolated `Test …` VoiceOver label. The value renders verbatim — no
/// further formatting at the view layer.
public struct NotificationSoundChannelRow: Sendable, Equatable, Identifiable {
    public var category: NotificationSoundCategory
    public var label: String
    /// Web `soundPrefs.perCategory[category]` — the per-channel gate.
    public var isOn: Bool
    /// Web `!soundPrefs.master` dim — the row is reachable but muted while the master switch is off.
    public var isDimmed: Bool
    /// Web `t('notificationSounds.testAria', 'Test {{name}} sound', { name })` — the Test button label.
    public var testAccessibilityLabel: String

    public var id: String {
        category.rawValue
    }

    public init(
        category: NotificationSoundCategory,
        label: String,
        isOn: Bool,
        isDimmed: Bool,
        testAccessibilityLabel: String
    ) {
        self.category = category
        self.label = label
        self.isOn = isOn
        self.isDimmed = isDimmed
        self.testAccessibilityLabel = testAccessibilityLabel
    }
}

// MARK: - Whole-surface projection

/// The whole projected surface: the authorization branch, the event-delivery prefs (shown only when
/// granted), the tab-signal toggles (with the web "default on when missing" applied and an editable flag
/// mirroring the web `!settings` no-op guard), the sound master + autoplay-hint flags, the channel rows,
/// and the rounded volume percentage. `hasContent` drives the content-vs-empty switch.
public struct NotificationSettingsProjection: Sendable, Equatable {
    public var authorization: NotificationAuthorization
    /// Web `notificationsSupported` — the unsupported branch shows a single explanatory line.
    public var supportsNotifications: Bool
    /// Web `permission === 'granted'` — gates the "Notify me about" event toggles.
    public var showsEventPrefs: Bool
    public var eventPrefs: NotificationEventPrefs

    public var tabBadgeEnabled: Bool
    public var criticalFlashEnabled: Bool
    /// Web `!settings` guard — the tab toggles can only be persisted once the settings query resolves.
    public var tabSettingsEditable: Bool

    public var soundsEnabled: Bool
    /// Web `soundPrefs.master && !autoplayHintDismissed` — the one-time autoplay-authorization hint.
    public var showsAutoplayHint: Bool
    public var channels: [NotificationSoundChannelRow]
    /// Web `Math.round(soundPrefs.volume * 100)` — the slider's 0…100 display value.
    public var volumePercent: Int

    /// Whether the surface has anything to render (drives content vs empty). The settings panel always has
    /// content in production (the channel list + tab toggles are always present); the flag exists so the
    /// empty envelope is a real, tested path rather than a blank surface.
    public var hasContent: Bool

    public init(
        authorization: NotificationAuthorization,
        supportsNotifications: Bool,
        showsEventPrefs: Bool,
        eventPrefs: NotificationEventPrefs,
        tabBadgeEnabled: Bool,
        criticalFlashEnabled: Bool,
        tabSettingsEditable: Bool,
        soundsEnabled: Bool,
        showsAutoplayHint: Bool,
        channels: [NotificationSoundChannelRow],
        volumePercent: Int,
        hasContent: Bool
    ) {
        self.authorization = authorization
        self.supportsNotifications = supportsNotifications
        self.showsEventPrefs = showsEventPrefs
        self.eventPrefs = eventPrefs
        self.tabBadgeEnabled = tabBadgeEnabled
        self.criticalFlashEnabled = criticalFlashEnabled
        self.tabSettingsEditable = tabSettingsEditable
        self.soundsEnabled = soundsEnabled
        self.showsAutoplayHint = showsAutoplayHint
        self.channels = channels
        self.volumePercent = volumePercent
        self.hasContent = hasContent
    }

    /// The resolved-but-empty surface (no notification capability and no channels) — never reached in
    /// production but kept as a real value so the empty envelope has a concrete projection.
    public static let empty = NotificationSettingsProjection(
        authorization: .unsupported,
        supportsNotifications: false,
        showsEventPrefs: false,
        eventPrefs: .defaults,
        tabBadgeEnabled: true,
        criticalFlashEnabled: true,
        tabSettingsEditable: false,
        soundsEnabled: false,
        showsAutoplayHint: false,
        channels: [],
        volumePercent: 0,
        hasContent: false
    )
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the dependency-free core so
/// it is reachable from the projection's unit tests.
public enum NotificationSettingsSurface {
    public static let slug = "NotificationSettings"
}

// MARK: - Accessibility (VoiceOver summary)

/// Builds the surface's VoiceOver summary. Copy resolves through an injected localizer
/// (`(key, fallback) -> String`) so the summary is testable without a bundle, exactly like the view's
/// P1/S10 facade.
public enum NotificationSettingsAccessibility {
    /// The section-level summary: the "Browser Notifications" title followed by the authorization state and
    /// the sound master state, or the empty-state message when the surface has no content.
    public static func sectionSummary(
        for projection: NotificationSettingsProjection,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("browserNotifications.title", "Browser Notifications")
        guard projection.hasContent else {
            let empty = localize("notifications.settings.empty.title", "Notification settings are unavailable")
            return "\(title). \(empty)"
        }
        let permission = permissionSummary(projection.authorization, localize: localize)
        let soundsKey = projection.soundsEnabled
            ? "notifications.settings.a11y.soundsOn"
            : "notifications.settings.a11y.soundsOff"
        let soundsFallback = projection.soundsEnabled ? "Notification sounds on" : "Notification sounds off"
        let sounds = localize(soundsKey, soundsFallback)
        return [title, permission, sounds].joined(separator: ". ")
    }

    /// The spoken description of the authorization state, mapping each branch to its web copy.
    public static func permissionSummary(
        _ authorization: NotificationAuthorization,
        localize: (String, String) -> String
    ) -> String {
        switch authorization {
        case .unsupported:
            localize("browserNotifications.unsupported", "Browser notifications are not supported in this browser.")
        case .notDetermined:
            localize("browserNotifications.enable", "Enable Browser Notifications")
        case .granted:
            localize("browserNotifications.enabled", "Enabled")
        case .denied:
            localize("browserNotifications.blocked", "Notifications are blocked. Enable in your browser settings.")
        }
    }
}
