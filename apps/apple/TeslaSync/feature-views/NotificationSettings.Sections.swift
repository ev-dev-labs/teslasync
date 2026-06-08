//
//  NotificationSettings.Sections.swift
//  TeslaSync — P4 feature view · 0208 · NotificationSettings (Apple)
//
//  The composed sections of the settings "Notifications" feature view, split out of
//  NotificationSettings.Views.swift to keep each file within the line-length budget: the OS-authorization
//  area (web `useWebPush` permission branch + the "Notify me about" toggles), the granted badge, the
//  tab-signal toggles, and the per-channel sound section (master toggle, autoplay hint, channel rows,
//  volume slider). All copy resolves through the P1/S10 facade; all chrome is token-driven (P1/S9).
//

import SwiftUI

// MARK: - Authorization area (web `useWebPush` permission branch)

/// The OS-authorization area: the unsupported line, the enable affordance, the granted badge, or the
/// blocked line — plus the "Notify me about" event toggles once granted. Mirrors the web permission switch.
struct NotificationAuthorizationSection: View {
    let model: NotificationSettingsModel

    var body: some View {
        let projection = model.projection
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if projection.supportsNotifications {
                authorizationControl(projection.authorization)
                if projection.showsEventPrefs {
                    eventPrefs()
                }
            } else {
                NotificationHint(
                    text: NotificationSettingsStrings.text(
                        "browserNotifications.unsupported",
                        "Browser notifications are not supported in this browser."
                    )
                )
            }
        }
    }

    @ViewBuilder
    private func authorizationControl(_ authorization: NotificationAuthorization) -> some View {
        switch authorization {
        case .notDetermined:
            Button { model.requestAuthorization() } label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "bell.fill").font(.system(size: 13, weight: .semibold))
                    NotificationSettingsStrings.text("browserNotifications.enable", "Enable Browser Notifications")
                }
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.lg)
                .padding(.vertical, TSSpacing.sm)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(
                NotificationSettingsStrings.text("browserNotifications.enable", "Enable Browser Notifications")
            )
        case .granted:
            NotificationEnabledBadge()
        case .denied:
            NotificationHint(
                text: NotificationSettingsStrings.text(
                    "browserNotifications.blocked",
                    "Notifications are blocked. Enable in your browser settings."
                )
            )
        case .unsupported:
            EmptyView()
        }
    }

    private func eventPrefs() -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Divider().overlay(Color.TS.border)
            NotificationGroupHeading(
                text: NotificationSettingsStrings.text("browserNotifications.events", "Notify me about")
            )
            NotificationToggleRow(
                label: NotificationSettingsStrings.text("browserNotifications.alerts", "Alerts"),
                isOn: Binding(get: { model.projection.eventPrefs.alerts }, set: { model.setAlerts($0) })
            )
            NotificationToggleRow(
                label: NotificationSettingsStrings.text("browserNotifications.exportStatus", "Export completions"),
                isOn: Binding(
                    get: { model.projection.eventPrefs.exportCompletions },
                    set: { model.setExportCompletions($0) }
                )
            )
            NotificationHint(
                text: NotificationSettingsStrings.text(
                    "browserNotifications.hint",
                    "Notifications only fire when the app tab is in the background."
                )
            )
        }
    }
}

/// The granted-state badge (web `<Badge variant="success">Enabled</Badge>`).
struct NotificationEnabledBadge: View {
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "checkmark.circle.fill").font(.system(size: 12, weight: .semibold))
            NotificationSettingsStrings.text("browserNotifications.enabled", "Enabled")
        }
        .font(Font.TS.caption)
        .fontWeight(.semibold)
        .foregroundStyle(Color.TS.statusSuccess)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.statusSuccess.opacity(0.14), in: Capsule())
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Tab-signal section (web "Browser tab signals")

/// The tab-signal toggles (web `settings.tab.*`): the unread-count badge and the critical-alert title
/// flash, with the explanatory hint. The toggles are disabled until the settings read resolves (web's
/// `!settings` no-op guard, made explicit on native).
struct NotificationTabSignalsSection: View {
    let model: NotificationSettingsModel

    var body: some View {
        let projection = model.projection
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            NotificationGroupHeading(
                text: NotificationSettingsStrings.text("settings.tab.heading", "Browser tab signals")
            )
            NotificationToggleRow(
                label: NotificationSettingsStrings.text("settings.tab.badge", "Show unread count in browser tab"),
                isOn: Binding(get: { model.projection.tabBadgeEnabled }, set: { model.setTabBadge($0) }),
                isEnabled: projection.tabSettingsEditable
            )
            NotificationToggleRow(
                label: NotificationSettingsStrings.text("settings.tab.flash", "Flash tab title on critical alerts"),
                isOn: Binding(
                    get: { model.projection.criticalFlashEnabled },
                    set: { model.setTabCriticalFlash($0) }
                ),
                isEnabled: projection.tabSettingsEditable
            )
            NotificationHint(
                text: NotificationSettingsStrings.text(
                    "settings.tab.hint",
                    // swiftlint:disable:next line_length
                    "Adds a \"(N)\" prefix and favicon dot when there are unread notifications. Critical alerts briefly flash \"(!) ALERT\" when the tab is in the background."
                )
            )
        }
    }
}

// MARK: - Sound section (web "Notification sounds")

/// The per-channel sound section (web `data-testid="notification-sounds"`): the section header, the master
/// switch, the autoplay hint, the channel rows, and the volume slider.
struct NotificationSoundsSection: View {
    let model: NotificationSettingsModel

    var body: some View {
        let projection = model.projection
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                NotificationIconBox(systemImage: "speaker.wave.2.fill", size: 32)
                VStack(alignment: .leading, spacing: TSSpacing.xs / 2) {
                    NotificationSettingsStrings.text("notificationSounds.title", "Notification sounds")
                        .font(Font.TS.body)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                    NotificationSettingsStrings.text(
                        "notificationSounds.subtitle",
                        // swiftlint:disable:next line_length
                        "Play a short cue when an alert or completion event arrives. Plays even while the tab is visible."
                    )
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
                }
            }

            NotificationToggleRow(
                label: NotificationSettingsStrings.text("notificationSounds.master", "Enable notification sounds"),
                isOn: Binding(get: { model.projection.soundsEnabled }, set: { model.setSoundsEnabled($0) })
            )

            if projection.showsAutoplayHint {
                NotificationHint(
                    text: NotificationSettingsStrings.text(
                        "notificationSounds.autoplayHint",
                        // swiftlint:disable:next line_length
                        "Some browsers require a click before audio is allowed. Use the Test buttons below once to authorise playback."
                    ),
                    tone: Color.TS.statusWarning
                )
            }

            channels(projection.channels)
            NotificationVolumeSlider(
                percent: projection.volumePercent,
                volume: Binding(
                    get: { NotificationVolumeMath.unit(fromPercent: model.projection.volumePercent) },
                    set: { model.setVolume($0) }
                ),
                isEnabled: projection.soundsEnabled
            )
        }
    }

    private func channels(_ rows: [NotificationSoundChannelRow]) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            NotificationGroupHeading(
                text: NotificationSettingsStrings.text("notificationSounds.categoriesHeading", "Channels")
            )
            ForEach(rows) { row in
                NotificationSoundChannelRowView(row: row, model: model)
            }
        }
    }
}

/// One sound-channel row (web `<Toggle> … <Button>Test</Button>`): the label, a Test affordance that
/// previews the cue, and the channel switch. The whole row dims while the master switch is off (web
/// `opacity-60`) but stays interactive.
struct NotificationSoundChannelRowView: View {
    let row: NotificationSoundChannelRow
    let model: NotificationSettingsModel

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: row.label)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: TSSpacing.sm)
            Button { model.testSound(row.category) } label: {
                HStack(spacing: 4) {
                    Image(systemName: "play.fill").font(.system(size: 11, weight: .semibold))
                    NotificationSettingsStrings.text("notificationSounds.test", "Test")
                }
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.surface, in: Capsule())
                .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
                .foregroundStyle(Color.TS.textSecondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: row.testAccessibilityLabel))
            Toggle(isOn: Binding(get: { row.isOn }, set: { model.setSoundChannel(row.category, $0) })) {
                EmptyView()
            }
            .labelsHidden()
            .toggleStyle(.switch)
            .tint(Color.TS.accent)
            .accessibilityLabel(Text(verbatim: row.label))
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .opacity(row.isDimmed ? 0.6 : 1)
    }
}

/// The output-volume slider (web `<Slider label min=0 max=100 step=5 formatValue="%" disabled />`): a
/// native slider over `[0, 1]` with the percentage caption, disabled while the master switch is off. Takes
/// a `Binding` so the source of truth stays in the model.
struct NotificationVolumeSlider: View {
    let percent: Int
    @Binding var volume: Double
    let isEnabled: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                NotificationSettingsStrings.text("notificationSounds.volume", "Volume")
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer()
                Text(verbatim: "\(percent)%")
                    .font(Font.TS.label)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textMuted)
            }
            Slider(value: $volume, in: 0 ... 1, step: 0.05)
                .tint(Color.TS.accent)
                .disabled(!isEnabled)
                .accessibilityValue(Text(verbatim: "\(percent)%"))
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(NotificationSettingsStrings.text("notificationSounds.volume", "Volume"))
    }
}
