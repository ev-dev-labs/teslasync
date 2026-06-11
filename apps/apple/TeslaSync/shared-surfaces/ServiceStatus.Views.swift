//
//  ServiceStatus.Views.swift
//  TeslaSync — P4 shared surface · 0104 · ServiceStatus (Apple)
//
//  The presentational subviews composed by `ServiceStatus`: the connectivity banner (the native
//  parity of the web `ServiceStatusBanner` — the red "You are offline…" notice), the system-health
//  dot (the parity of the web `SystemHealthDot` — the `overall`-tinted indicator), the subsystem
//  breakdown, and the freshness chip (P4 connectivity axis). All consume the P1/S10 facade and the
//  shared P1/S9 tokens / components (`TSAlertBanner` ← web `AlertBanner`) — no networking, no
//  Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Level → tone (P1/S9 tokens)

extension SystemHealthLevel {
    /// The shared status tone for the level — the native mirror of the web `SystemHealthDot` colour
    /// ternary (healthy → green, degraded → amber, else → red).
    var tone: TSTone {
        switch self {
        case .healthy: .success
        case .degraded: .warning
        case .down: .danger
        }
    }
}

// MARK: - Health glyph (the tinted, glowing dot)

/// The dot glyph the web paints with `bg-neon-* shadow-[0_0_6px_…]` — a tone-filled circle with a
/// soft glow. Reused by the standalone `SystemHealthDot`, the labelled row, and the subsystem list.
/// Decorative on its own; the owning view supplies the VoiceOver label.
struct ServiceStatusHealthGlyph: View {
    let level: SystemHealthLevel
    var size: CGFloat = 10

    var body: some View {
        Circle()
            .fill(level.tone.color)
            .frame(width: size, height: size)
            .shadow(color: level.tone.color.opacity(0.5), radius: size * 0.35)
            .accessibilityHidden(true)
    }
}

// MARK: - System health dot (web `SystemHealthDot`)

/// The compact system-health indicator — the SwiftUI parity of the web `SystemHealthDot`. Paints a
/// single tone-tinted dot from the rollup level and carries the "System: {status}" VoiceOver label
/// (web ``title={`System: ${overall}`}``). The web component returns `null` until data resolves;
/// here the owning surface gates the no-data states, so this view always has a level to paint.
public struct SystemHealthDot: View {
    private let data: ServiceStatusData

    public init(data: ServiceStatusData) {
        self.data = data
    }

    private var levelLabel: String {
        ServiceStatusStrings.string(data.level.label.key, data.level.label.fallback)
    }

    private var accessibilityText: String {
        ServiceStatusAccessibility.dotLabel(
            statusLabel: levelLabel,
            template: ServiceStatusStrings.string("service.status.systemLabel", "System: {status}")
        )
    }

    public var body: some View {
        ServiceStatusHealthGlyph(level: data.level)
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: accessibilityText))
    }
}

// MARK: - Labelled dot row (composite header)

/// The dot paired with its localized level label + the raw `overall` rollup — the headline of the
/// composite surface. A single VoiceOver element announcing "System: {level}".
struct ServiceStatusDotRow: View {
    let data: ServiceStatusData

    private var levelLabel: String {
        ServiceStatusStrings.string(data.level.label.key, data.level.label.fallback)
    }

    private var accessibilityText: String {
        ServiceStatusAccessibility.dotLabel(
            statusLabel: levelLabel,
            template: ServiceStatusStrings.string("service.status.systemLabel", "System: {status}")
        )
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            ServiceStatusHealthGlyph(level: data.level, size: 12)
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: levelLabel)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(ServiceStatusStrings.string("service.status.systemTitle", "System status"))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }
}

// MARK: - Subsystem breakdown (web `SystemStatus.{database,tesla_api,mqtt,worker}`)

/// The per-subsystem health breakdown beneath the dot — a tone-tinted glyph + the subsystem name +
/// its level label, one focusable VoiceOver element per row. Empty input renders nothing (the
/// caller guards the empty surface).
struct ServiceStatusComponentsList: View {
    let components: [ServiceComponentStatus]

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            ForEach(components) { component in
                row(component)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func name(_ component: ServiceComponentStatus) -> String {
        ServiceStatusStrings.string(component.nameKey, component.nameFallback)
    }

    private func levelLabel(_ level: SystemHealthLevel) -> String {
        ServiceStatusStrings.string(level.label.key, level.label.fallback)
    }

    private func row(_ component: ServiceComponentStatus) -> some View {
        HStack(spacing: TSSpacing.sm) {
            ServiceStatusHealthGlyph(level: component.level, size: 7)
            Text(verbatim: name(component))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: levelLabel(component.level))
                .font(Font.TS.caption)
                .foregroundStyle(component.level.tone.color)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(name(component)): \(levelLabel(component.level))"))
    }
}

// MARK: - Connectivity banner (web `ServiceStatusBanner`)

/// The offline connectivity banner — the SwiftUI parity of the web `ServiceStatusBanner`. While
/// offline it renders the red "You are offline. Data may be stale. Reconnecting automatically…"
/// notice; online it renders nothing, animating in/out (the web `AnimatePresence` height/opacity),
/// honouring Reduce Motion.
public struct ServiceStatusBanner: View {
    private let isOffline: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(isOffline: Bool) {
        self.isOffline = isOffline
    }

    private var title: String {
        ServiceStatusStrings.string(ServiceStatusCopy.offlineTitleKey, ServiceStatusCopy.offlineTitleFallback)
    }

    private var message: String {
        ServiceStatusStrings.string(ServiceStatusCopy.offlineMessageKey, ServiceStatusCopy.offlineMessageFallback)
    }

    private var accessibilityText: String {
        ServiceStatusAccessibility.bannerLabel(title: title, message: message)
    }

    public var body: some View {
        ZStack {
            if isOffline {
                TSAlertBanner(
                    tone: .danger,
                    systemImage: "wifi.slash",
                    title: LocalizedStringKey(title),
                    message: LocalizedStringKey(message)
                )
                .accessibilityLabel(Text(verbatim: accessibilityText))
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: isOffline)
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beside the dot when the feed is not live — a coloured dot + a label
/// (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the snapshot,
/// with an explicit label. Hidden while live.
struct ServiceStatusFreshnessChip: View {
    let connection: ServiceStatusConnection
    let onRefresh: () -> Void

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: ServiceStatusStrings.string("service.status.live", "Live")
        case .stale: ServiceStatusStrings.string("service.status.stale", "Stale")
        case .offline: ServiceStatusStrings.string("service.status.offline", "Offline")
        }
    }

    private var accessibilityText: String {
        switch connection {
        case .live:
            label
        case .stale:
            ServiceStatusStrings.string("service.status.staleA11y", "Stale — tap to refresh")
        case .offline:
            ServiceStatusStrings.string("service.status.offlineA11y", "Offline — showing the last known status")
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle().fill(tone).frame(width: 6, height: 6)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(tone.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }
}
