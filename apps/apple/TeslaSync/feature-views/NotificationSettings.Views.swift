//
//  NotificationSettings.Views.swift
//  TeslaSync — P4 feature view · 0208 · NotificationSettings (Apple)
//
//  The presentational chrome for the settings "Notifications" feature view: the glass-panel container (web
//  `<GlassPanel className="p-6">`), the section header with its icon box + freshness chip, the stale /
//  offline connectivity banner, the OS-authorization area (web `useWebPush` permission branch + the
//  "Notify me about" toggles), the tab-signal toggles, and the per-channel sound section (master toggle,
//  autoplay hint, channel rows, volume slider). All copy resolves through the P1/S10 facade; all chrome is
//  token-driven (P1/S9). The load-state chrome lives in NotificationSettings.States.swift.
//

import SwiftUI

// MARK: - Glass panel container (web `<GlassPanel className="p-6 space-y-5">`)

/// The web `GlassPanel` surface the whole section renders inside: the semantic surface fill clipped to the
/// panel radius with the glass-border stroke.
struct NotificationSettingsGlassPanel<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(TSSpacing.x2xl)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}

// MARK: - Icon box (web `<IconBox color="cyan">`)

/// The small rounded accent tile holding a glyph (web `<IconBox>`): a tinted square with the SF Symbol
/// centered. Decorative — hidden from VoiceOver (the adjacent title carries the meaning).
struct NotificationIconBox: View {
    let systemImage: String
    var size: CGFloat = 36

    var body: some View {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            .fill(Color.TS.accent.opacity(0.14))
            .frame(width: size, height: size)
            .overlay(
                Image(systemName: systemImage)
                    .font(.system(size: size * 0.44, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - Section header (web `<IconBox><Bell/></IconBox>` + title + subtitle)

/// The panel header: the bell icon box, the "Browser Notifications" title + subtitle, and the live-state
/// freshness chip on the trailing edge.
struct NotificationSettingsHeader: View {
    let connection: NotificationSettingsConnection

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            NotificationIconBox(systemImage: "bell.fill")
            VStack(alignment: .leading, spacing: TSSpacing.xs / 2) {
                NotificationSettingsStrings.text("browserNotifications.title", "Browser Notifications")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                NotificationSettingsStrings.text(
                    "browserNotifications.subtitle",
                    "Get notified when the app tab is in the background"
                )
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: TSSpacing.sm)
            NotificationFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013). The web `useSettings`
/// query can go stale, so a stalled read is surfaced here rather than shown as current.
struct NotificationFreshnessChip: View {
    let connection: NotificationSettingsConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            NotificationSettingsStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(NotificationSettingsStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: NotificationSettingsConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "notifications.settings.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "notifications.settings.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "notifications.settings.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the content when the bound source is not live, so the persisted
/// settings are clearly labelled while reconnecting / offline (web `DataFreshness` intent).
struct NotificationSettingsConnectivityBanner: View {
    let connection: NotificationSettingsConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "notifications.settings.offlineBanner" : "notifications.settings.staleBanner"
        let fallback = offline
            ? "Offline — showing your last saved notification settings"
            : "Reconnecting — notification settings may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            NotificationSettingsStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Small text roles (web `uppercase tracking-wider` heading + `text-[10px]` hint)

/// A small uppercase group heading (web `text-xs font-medium uppercase tracking-wider text-muted`).
struct NotificationGroupHeading: View {
    let text: Text

    var body: some View {
        text
            .font(Font.TS.label)
            .textCase(.uppercase)
            .tracking(TSTypeMetrics.labelTracking)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A small explanatory hint line (web `text-[10px] text-muted`), tinted by `tone`.
struct NotificationHint: View {
    let text: Text
    var tone: Color = .TS.textMuted

    var body: some View {
        text
            .font(Font.TS.caption)
            .foregroundStyle(tone)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Toggle row (web `<Toggle label size="sm" />`)

/// A labelled switch row (web `<Toggle>`): a leading label and a trailing native switch tinted with the
/// brand accent. The native control carries VoiceOver, Dynamic Type, and Reduce-Motion for free. Takes a
/// `Binding` so the source of truth stays in the model (the parent builds it from the projection + a
/// mutation, capturing the Sendable model).
struct NotificationToggleRow: View {
    let label: Text
    @Binding var isOn: Bool
    var isEnabled: Bool = true

    var body: some View {
        Toggle(isOn: $isOn) {
            label
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .toggleStyle(.switch)
        .tint(Color.TS.accent)
        .disabled(!isEnabled)
    }
}
