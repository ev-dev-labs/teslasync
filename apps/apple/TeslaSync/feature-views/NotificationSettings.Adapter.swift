//
//  NotificationSettings.Adapter.swift
//  TeslaSync — P4 feature view · 0208 · NotificationSettings (Apple)
//
//  The testable projection core for the settings "Notifications" feature view — the faithful port of
//  features/settings/components/NotificationSettings.tsx. `NotificationSettingsProjector` reproduces the
//  component's render logic VERBATIM: the `permission === 'granted'` event-toggle gate, the
//  `settings?.field !== false` "default on when missing" tab logic with the `!settings` no-op guard, the
//  `!soundPrefs.master` channel dim, the `master && !dismissed` autoplay hint, and the
//  `Math.round(volume * 100)` slider value. Foundation-only so it is unit-tested without a bundle or a
//  rendered view.
//

import Foundation

// MARK: - Volume math (web `Math.round(volume * 100)` + the `[0, 1]` clamp)

/// Pure volume helpers mirroring the web slider: the `[0, 1]` clamp the sound-prefs store applies (web
/// `clamp(v, 0, 1)`) and the `Math.round(volume * 100)` percentage the slider displays.
public enum NotificationVolumeMath {
    /// Web `clamp(n, 0, 1)`: a finite value pinned into `[0, 1]`; a non-finite value collapses to the
    /// lower bound (web `Number.isNaN(n)` guard returns `min`).
    public static func clampUnit(_ value: Double) -> Double {
        guard value.isFinite else { return 0 }
        return min(1, max(0, value))
    }

    /// Web `Math.round(volume * 100)`: the `[0, 1]` volume as a whole-number percentage, half-away-from-zero
    /// like JavaScript `Math.round`.
    public static func percent(_ volume: Double) -> Int {
        Int((clampUnit(volume) * 100).rounded(.toNearestOrAwayFromZero))
    }

    /// The inverse used by the slider's `onChange` (web `next / 100`): a 0…100 step back into `[0, 1]`.
    public static func unit(fromPercent percent: Int) -> Double {
        clampUnit(Double(percent) / 100)
    }
}

// MARK: - Projector (pure)

/// The dependency-free projection from a cached `NotificationSettingsInput` + the injected channel copy to
/// the view-ready `NotificationSettingsProjection`. Every branch uses the same logic as the web component
/// so the web and native surfaces render the same shape for the same input.
public enum NotificationSettingsProjector {
    /// Builds the projection. Mirrors the web render pipeline branch-for-branch.
    public static func project(
        input: NotificationSettingsInput,
        copy: NotificationSettingsCopy = .fallback
    ) -> NotificationSettingsProjection {
        let supports = input.authorization != .unsupported
        // Web: the "Notify me about" block renders only inside `permission === 'granted'`.
        let showsEventPrefs = input.authorization == .granted

        // Web `settings?.tab_badge_enabled !== false` — default on unless explicitly false; a `nil`
        // settings payload keeps the defaults but cannot be persisted (web `!settings` no-op guard).
        let tabBadge = input.tabSettings?.badgeEnabled ?? true
        let tabFlash = input.tabSettings?.criticalFlashEnabled ?? true
        let tabEditable = input.tabSettings != nil

        let soundsEnabled = input.soundPrefs.enabled
        let showsAutoplayHint = soundsEnabled && !input.autoplayHintDismissed

        let channels = NotificationSoundCategory.allCases.map { category in
            NotificationSoundChannelRow(
                category: category,
                label: copy.label(for: category),
                isOn: input.soundPrefs.isOn(category),
                isDimmed: !soundsEnabled,
                testAccessibilityLabel: testLabel(for: category, copy: copy)
            )
        }

        // The settings panel always has content in production; "empty" is reserved for a degenerate read
        // with no capability and no channels so the empty envelope stays a real, tested path.
        let hasContent = supports || !channels.isEmpty || tabEditable

        return NotificationSettingsProjection(
            authorization: input.authorization,
            supportsNotifications: supports,
            showsEventPrefs: showsEventPrefs,
            eventPrefs: input.eventPrefs,
            tabBadgeEnabled: tabBadge,
            criticalFlashEnabled: tabFlash,
            tabSettingsEditable: tabEditable,
            soundsEnabled: soundsEnabled,
            showsAutoplayHint: showsAutoplayHint,
            channels: channels,
            volumePercent: NotificationVolumeMath.percent(input.soundPrefs.volume),
            hasContent: hasContent
        )
    }

    /// Resolves the surface phase, mirroring the web parent precedence (loading → error → body): a resolved
    /// read with content is the panel; a resolved read with no content is the empty state; an unresolved
    /// read before the first resolve is loading.
    public static func resolvePhase(
        _ status: NotificationSettingsLoadStatus,
        hasContent: Bool
    ) -> NotificationSettingsPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasContent ? .content : .empty
        }
    }

    /// Web `t('notificationSounds.testAria', 'Test {{name}} sound', { name })` — the `{{name}}` token
    /// replaced by the channel's localized label.
    private static func testLabel(
        for category: NotificationSoundCategory,
        copy: NotificationSettingsCopy
    ) -> String {
        copy.testAccessibilityTemplate.replacingOccurrences(of: "{{name}}", with: copy.label(for: category))
    }
}
