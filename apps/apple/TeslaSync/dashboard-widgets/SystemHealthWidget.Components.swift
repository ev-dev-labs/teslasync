//
//  SystemHealthWidget.Components.swift
//  TeslaSync — P4 dashboard widget · 0099 · SystemHealthWidget (Apple)
//
//  The small presentational subviews that map the web shared components to native
//  counterparts, styled with the shared design tokens (the same tokens the shared
//  `TSStatusBadge` / `TSStatCard` use). They are authored locally — rather than
//  reusing the `LocalizedStringKey`-only shared components — so every label
//  resolves through the per-surface `SystemHealthStrings` table (P1/S10) with the
//  web `t(key, default)` fallback, mirroring how the sibling `MQTTStatusWidget`
//  builds `MQTTStatusChip` / `MQTTStatTile` over the same tokens.
//

import SwiftUI

// MARK: - Status dot (web `StatusDot` — `statusColor()` glow)

/// A small tone-colored dot with a soft glow, mirroring the web `StatusDot`
/// (`h-2.5 w-2.5 rounded-full shadow-[0_0_6px] ${statusColor}`). Green for
/// ok/healthy, amber for degraded, red otherwise.
struct SystemHealthStatusDot: View {
    let status: SystemHealthServiceStatus

    static func tone(_ status: SystemHealthServiceStatus) -> Color {
        if status.isHealthy { return Color.TS.statusSuccess }
        if status == .degraded { return Color.TS.statusWarning }
        return Color.TS.statusDanger
    }

    var body: some View {
        let tone = Self.tone(status)
        Circle()
            .fill(tone)
            .frame(width: 10, height: 10)
            .shadow(color: tone.opacity(0.4), radius: 3)
            .accessibilityHidden(true)
    }
}

// MARK: - Service row (web service-grid item)

/// One service status row: a tone dot + the (truncating) service label. Mirrors
/// the web `flex items-center gap-2 min-h-[44px]` grid cell, preserving the
/// 44pt minimum tap/scan target.
struct SystemHealthServiceRow: View {
    let label: String
    let status: SystemHealthServiceStatus

    private var statusWord: String {
        if status.isHealthy { return SystemHealthStrings.string("widget.systemHealth.healthy", "Healthy") }
        if status == .degraded { return SystemHealthStrings.string("widget.systemHealth.degraded", "Degraded") }
        return SystemHealthStrings.string("widget.systemHealth.down", "Down")
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            SystemHealthStatusDot(status: status)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 0)
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label): \(statusWord)"))
    }
}

// MARK: - Stat tile (web `StatCard label value`)

/// A compact label + value tile, mirroring the web `StatCard` (`@/components/
/// data-display`): a muted uppercase label over a bold, monospaced-digit value
/// inside a tonal surface card. The caller pre-formats `value` (fmtInt).
struct SystemHealthStatTile: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(verbatim: value)
                .font(Font.TS.panel)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.sm)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label): \(value)"))
    }
}

// MARK: - Overall badge (web `StatusBadge status={online|away|offline}`)

/// The overall-status pill: a tone dot + the capitalized Online/Away/Offline word
/// in a bordered capsule. Mirrors the web `StatusBadge` (`@/components/
/// data-display`) fed `overallBadgeStatus(status)`.
struct SystemHealthBadge: View {
    let badge: SystemHealthOverallBadge
    var size: Size = .regular

    enum Size { case small, regular }

    private var tone: Color {
        switch badge {
        case .online: Color.TS.statusSuccess
        case .away: Color.TS.statusWarning
        case .offline: Color.TS.statusDanger
        }
    }

    private var label: String {
        SystemHealthOverall.badgeLabel(badge)
    }

    private var dotSize: CGFloat {
        size == .small ? 6 : 8
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle().fill(tone).frame(width: dotSize, height: dotSize)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(Color.TS.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Freshness chip (web `DataFreshness` header indicator)

/// Live-stream freshness chip shown in the header: a tone dot + Live/Stale/
/// Offline word. Mirrors the web `DataFreshness` / `FreshnessIndicator`
/// (`@/components/data-display`).
struct SystemHealthFreshnessChip: View {
    let connection: SystemHealthConnection

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: SystemHealthStrings.string("widget.systemHealth.live", "Live")
        case .stale: SystemHealthStrings.string("widget.systemHealth.stale", "Stale")
        case .offline: SystemHealthStrings.string("widget.systemHealth.offline", "Offline")
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
