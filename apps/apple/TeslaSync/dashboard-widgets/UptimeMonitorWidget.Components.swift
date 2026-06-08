//
//  UptimeMonitorWidget.Components.swift
//  TeslaSync — P4 dashboard widget · 0104 · UptimeMonitorWidget (Apple)
//
//  The small presentational subviews that map the web shared components to native
//  counterparts, styled with the shared design tokens (the same tokens the shared
//  `TSBadge` / `TSStatusBadge` use). They are authored locally — rather than
//  reusing the `LocalizedStringKey`-only shared components — so every label
//  resolves through the per-surface `UptimeMonitorStrings` table (P1/S10) with the
//  web `t(key, default)` fallback, mirroring how the sibling `MQTTStatusWidget`
//  builds its chip/tile over the same tokens.
//

import SwiftUI

// MARK: - Tone → color

extension UptimeStatusTone {
    /// The design-token color for the tone (web `bg-green-500` / `bg-amber-400` /
    /// `bg-red-500` and the matching `Badge` variant colors).
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        }
    }
}

// MARK: - Status dot (web `StatusDot`)

/// A small tone-colored dot with a soft glow, mirroring the web `StatusDot`
/// (`h-2.5 w-2.5 rounded-full shadow-[0_0_6px]`).
struct UptimeStatusDot: View {
    let tone: UptimeStatusTone
    var diameter: CGFloat = 10

    var body: some View {
        Circle()
            .fill(tone.color)
            .frame(width: diameter, height: diameter)
            .shadow(color: tone.color.opacity(0.45), radius: 3)
            .accessibilityHidden(true)
    }
}

// MARK: - Status badge (web `Badge variant={success|warning|danger}`)

/// A compact tonal pill, mirroring the web `Badge` (`@/components/ui`) variants.
/// The caller passes the already-localized text.
struct UptimeStatusBadge: View {
    let text: String
    let tone: UptimeStatusTone
    var emphasized = false

    var body: some View {
        Text(verbatim: text)
            .font(emphasized ? Font.TS.label : Font.TS.caption)
            .fontWeight(.semibold)
            .foregroundStyle(tone.color)
            .lineLimit(1)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.14), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.28), lineWidth: 1))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: text))
    }
}

// MARK: - Service row (web `ServiceRow`)

/// One service status line: a tone dot + label on the left, a status badge on the
/// right. Mirrors the web `ServiceRow` (`flex items-center justify-between`).
struct UptimeServiceRow: View {
    let label: String
    let statusText: String
    let tone: UptimeStatusTone

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                UptimeStatusDot(tone: tone)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
            }
            Spacer(minLength: TSSpacing.sm)
            UptimeStatusBadge(text: statusText, tone: tone)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label): \(statusText)"))
    }
}

// MARK: - Footer row (web DB-size / tables rows)

/// A muted "label … value" row used for the DB Size and Tables footer entries
/// (web `flex items-center justify-between text-[10px]`).
struct UptimeFooterRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: value)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .truncationMode(.middle)
                .monospacedDigit()
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label): \(value)"))
    }
}

// MARK: - Freshness chip (web `DataFreshness` header indicator)

/// Live-stream freshness chip shown in the header: a tone dot + Live/Stale/
/// Offline word. Mirrors the web `DataFreshness` / `FreshnessIndicator`
/// (`@/components/data-display`).
struct UptimeFreshnessChip: View {
    let connection: UptimeConnection

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: UptimeMonitorStrings.string("widget.uptime.live", "Live")
        case .stale: UptimeMonitorStrings.string("widget.uptime.stale", "Stale")
        case .offline: UptimeMonitorStrings.string("widget.uptime.offlineChip", "Offline")
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}
