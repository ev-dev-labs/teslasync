import Foundation

/// How a notification should present in the foreground, derived from the user's
/// `PushSettings` + quiet hours. A disabled category collapses to `.silent`.
public struct PushPresentation: Equatable, Sendable {
    public var showsBanner: Bool
    public var playsSound: Bool
    public var setsBadge: Bool
    /// The category is disabled entirely — nothing is presented.
    public var isSuppressed: Bool

    public init(showsBanner: Bool, playsSound: Bool, setsBadge: Bool, isSuppressed: Bool) {
        self.showsBanner = showsBanner
        self.playsSound = playsSound
        self.setsBadge = setsBadge
        self.isSuppressed = isSuppressed
    }

    /// Present nothing (category disabled).
    public static let silent = PushPresentation(
        showsBanner: false,
        playsSound: false,
        setsBadge: false,
        isSuppressed: true
    )
}

/// The user's notification preferences: which categories are enabled, the quiet
/// window, the alert channels (sound/badge), and critical-alert eligibility.
/// Serialises to the persistence seam and drives both the authorization request
/// and the foreground-presentation policy. Defaults to all categories on.
public struct PushSettings: Codable, Equatable, Sendable {
    public var enabledCategories: Set<PushCategory>
    public var quietHours: QuietHours
    /// Whether the user opted into critical alerts (breaks through Do-Not-Disturb /
    /// quiet hours). Requires the Apple critical-alert entitlement to take effect.
    public var criticalAlertsEnabled: Bool
    public var soundEnabled: Bool
    public var badgeEnabled: Bool

    public init(
        enabledCategories: Set<PushCategory> = Set(PushCategory.allCases),
        quietHours: QuietHours = QuietHours(),
        criticalAlertsEnabled: Bool = false,
        soundEnabled: Bool = true,
        badgeEnabled: Bool = true
    ) {
        self.enabledCategories = enabledCategories
        self.quietHours = quietHours
        self.criticalAlertsEnabled = criticalAlertsEnabled
        self.soundEnabled = soundEnabled
        self.badgeEnabled = badgeEnabled
    }

    public static let `default` = PushSettings()

    public func isEnabled(_ category: PushCategory) -> Bool {
        enabledCategories.contains(category)
    }

    public mutating func setCategory(_ category: PushCategory, enabled: Bool) {
        if enabled {
            enabledCategories.insert(category)
        } else {
            enabledCategories.remove(category)
        }
    }

    /// The foreground presentation for `notification` at `date`. A disabled category
    /// is `.silent`; quiet hours mute sound for non-critical notifications while
    /// still showing the banner (so the notification centre still records it); a
    /// `critical` severity bypasses quiet hours entirely.
    public func presentation(
        for notification: PushNotification,
        at date: Date = Date(),
        calendar: Calendar = .current
    ) -> PushPresentation {
        guard isEnabled(notification.category) else { return .silent }
        let bypassesQuiet = notification.severity?.bypassesQuietHours ?? false
        let muted = quietHours.contains(date, calendar: calendar) && !bypassesQuiet
        return PushPresentation(
            showsBanner: true,
            playsSound: soundEnabled && !muted,
            setsBadge: badgeEnabled,
            isSuppressed: false
        )
    }

    /// The authorization options to request, given the configured channels and
    /// critical-alert opt-in.
    public var authorizationOptions: PushAuthorizationOptions {
        var options: PushAuthorizationOptions = [.alert]
        if soundEnabled { options.insert(.sound) }
        if badgeEnabled { options.insert(.badge) }
        if criticalAlertsEnabled { options.insert(.criticalAlert) }
        return options
    }
}
