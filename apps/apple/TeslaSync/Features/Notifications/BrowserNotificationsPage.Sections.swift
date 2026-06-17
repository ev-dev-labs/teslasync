//
//  BrowserNotificationsPage.Sections.swift
//  TeslaSync — P4 feature view · P7 · notifications/BrowserNotifications (Apple) — Sections
//
//  The regions of the web `NotificationSettings` surface (one `GlassPanel` with three
//  divider-separated groups), reproduced natively in the same data + grouping + order:
//    1. the permission gate + per-event toggles (web "Browser Notifications"),
//    2. the browser-tab signal toggles (web "Browser tab signals"),
//    3. the notification-sound channels + volume (web "Notification sounds").
//  Every visible literal resolves from `Localizable.xcstrings` under the web key names;
//  every control binds through the `@Observable` `BrowserNotificationsPageModel`.
//

import SwiftUI

// MARK: - Settings card (web `GlassPanel`)

/// The single frosted panel framing the three notification-settings regions (web
/// `GlassPanel className="p-6 space-y-5"` with `border-t` dividers between groups).
struct BrowserNotificationsSettingsCard: View {
    let model: BrowserNotificationsPageModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.xl) {
                BrowserNotificationsPermissionSection(model: model)
                hairline
                TabSignalsSection(model: model)
                hairline
                NotificationSoundsSection(model: model)
            }
        }
        .accessibilityElement(children: .contain)
    }

    /// Web `border-t border-white/[0.06]` group separator.
    private var hairline: some View {
        Rectangle()
            .fill(Color.TS.border)
            .frame(height: 1)
            .frame(maxWidth: .infinity)
            .accessibilityHidden(true)
    }
}

// MARK: - Shared section header (web `IconBox` + title + subtitle row)

/// The `IconBox` + title + subtitle header the permission + sounds regions share (web
/// `flex items-center gap-3` heading).
struct BrowserNotificationsSectionHeader: View {
    let systemName: String
    let title: LocalizedStringKey
    let subtitle: LocalizedStringKey

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSIconBox(systemName: systemName, tone: .accent)
            VStack(alignment: .leading, spacing: 2) {
                TSPanelTitle(title)
                TSCaption(subtitle)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Region 1 — permission + events (web "Browser Notifications")

/// The permission gate (web `useWebPush`): the four-way status switch plus, once granted,
/// the per-event toggles. Every state renders — never a blank region (ADR-011).
struct BrowserNotificationsPermissionSection: View {
    let model: BrowserNotificationsPageModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            BrowserNotificationsSectionHeader(
                systemName: "bell.fill",
                title: "translation.browserNotifications.title",
                subtitle: "translation.browserNotifications.subtitle"
            )
            if model.permission == .unsupported {
                TSHelperText("translation.browserNotifications.unsupported")
            } else {
                permissionContent
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private var permissionContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            statusRow
            if model.permission == .granted {
                eventsSubsection
            }
        }
    }

    @ViewBuilder private var statusRow: some View {
        switch model.permission {
        case .notDetermined:
            TSButton("translation.browserNotifications.enable") {
                Task { await model.enableNotifications() }
            }
        case .granted:
            TSBadge("translation.browserNotifications.enabled", tone: .success)
        case .denied:
            TSHelperText("translation.browserNotifications.blocked")
        case .unsupported:
            EmptyView()
        }
    }

    /// Web `permission === 'granted'` → "Notify me about" toggles + hint.
    private var eventsSubsection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSLabel("translation.browserNotifications.events")
            TSToggle("translation.browserNotifications.alerts", isOn: alertsBinding)
            TSToggle("translation.browserNotifications.exportStatus", isOn: exportBinding)
            TSCaption("translation.browserNotifications.hint")
        }
    }

    private var alertsBinding: Binding<Bool> {
        Binding(get: { model.preferences.push.alerts }, set: { model.setAlerts($0) })
    }

    private var exportBinding: Binding<Bool> {
        Binding(get: { model.preferences.push.exportStatus }, set: { model.setExportStatus($0) })
    }
}

// MARK: - Region 2 — tab signals (web "Browser tab signals")

/// The browser-tab signal toggles (web `tab_badge_enabled` / `critical_flash_enabled`).
struct TabSignalsSection: View {
    let model: BrowserNotificationsPageModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSLabel("translation.settings.tab.heading")
            TSToggle("translation.settings.tab.badge", isOn: badgeBinding)
            TSToggle("translation.settings.tab.flash", isOn: flashBinding)
            TSCaption("translation.settings.tab.hint")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var badgeBinding: Binding<Bool> {
        Binding(get: { model.preferences.tab.badgeEnabled }, set: { model.setTabBadge($0) })
    }

    private var flashBinding: Binding<Bool> {
        Binding(get: { model.preferences.tab.criticalFlashEnabled }, set: { model.setCriticalFlash($0) })
    }
}

// MARK: - Region 3 — notification sounds (web "Notification sounds")

/// The notification-sound region (web `useNotificationSoundPrefs`): the overall gate, the
/// autoplay hint while enabled, the per-channel rows, and the volume slider.
struct NotificationSoundsSection: View {
    let model: BrowserNotificationsPageModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            BrowserNotificationsSectionHeader(
                systemName: "speaker.wave.2.fill",
                title: "translation.notificationSounds.title",
                subtitle: "translation.notificationSounds.subtitle"
            )
            TSToggle("translation.notificationSounds.master", isOn: soundEnabledBinding)
            if model.preferences.sound.enabled {
                autoplayHint
            }
            channels
            volumeSlider
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var autoplayHint: some View {
        Text("translation.notificationSounds.autoplayHint")
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.statusWarning)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var channels: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSLabel("translation.notificationSounds.categoriesHeading")
            ForEach(BrowserNotificationSoundCategory.allCases) { category in
                NotificationSoundChannelRow(model: model, category: category)
            }
        }
    }

    private var volumeSlider: some View {
        TSSlider(
            "translation.notificationSounds.volume",
            value: volumeBinding,
            in: 0 ... 100,
            format: { "\(Int($0))%" }
        )
        .disabled(!model.preferences.sound.enabled)
    }

    private var soundEnabledBinding: Binding<Bool> {
        Binding(get: { model.preferences.sound.enabled }, set: { model.setSoundEnabled($0) })
    }

    private var volumeBinding: Binding<Double> {
        Binding(
            get: { (model.preferences.sound.volume * 100).rounded() },
            set: { model.setVolume($0 / 100) }
        )
    }
}

// MARK: - Sound channel row (web per-category toggle + Test button)

/// One sound-channel row (web per-category `Toggle` + ghost `Test` button), dimmed while
/// the overall sound gate is off (web `opacity-60` when sounds are disabled).
struct NotificationSoundChannelRow: View {
    let model: BrowserNotificationsPageModel
    let category: BrowserNotificationSoundCategory

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            TSToggle(category.titleKey, isOn: enabledBinding)
            Spacer(minLength: TSSpacing.sm)
            testButton
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(
            Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .opacity(model.preferences.sound.enabled ? 1 : 0.6)
    }

    private var testButton: some View {
        TSButton(
            variant: .ghost,
            size: .small,
            action: { model.testSound(category) },
            label: { Label("translation.notificationSounds.test", systemImage: "play.fill") }
        )
        .accessibilityLabel(testAccessibilityLabel)
    }

    private var enabledBinding: Binding<Bool> {
        Binding(
            get: { model.preferences.sound.isEnabled(category) },
            set: { model.setSoundCategory(category, $0) }
        )
    }

    /// Web `aria-label={t('notificationSounds.testAria', 'Test {{name}} sound', { name })}`.
    private var testAccessibilityLabel: Text {
        let key = "translation.notificationSounds.category." + category.rawValue
        let name = NSLocalizedString(key, comment: "")
        let format = NSLocalizedString("translation.notificationSounds.testAria", comment: "")
        return Text(verbatim: String(format: format, name))
    }
}
