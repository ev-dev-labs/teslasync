//
//  MQTTStatusWidget.Components.swift
//  TeslaSync — P4 dashboard widget · 0068 · MQTTStatusWidget (Apple)
//
//  The small presentational subviews that map the web shared components to native
//  counterparts, styled with the shared design tokens (the same tokens the
//  shared `TSStatusBadge` / `TSStatCard` / `TSFreshnessIndicator` use). They are
//  authored locally — rather than reusing the `LocalizedStringKey`-only shared
//  components — so every label resolves through the per-surface `MQTTStatusStrings`
//  table (P1/S10) with the web `t(key, default)` fallback, mirroring how the
//  sibling `DigitalTwinWidget` builds `TwinBadge` over the same tokens.
//

import SwiftUI

// MARK: - Status chip (web `StatusBadge status={connected ? 'online' : 'offline'}`)

/// Online/offline broker status pill: a tone-colored dot + capitalized status
/// word in a bordered capsule. Mirrors the web `StatusBadge` (`@/components/
/// data-display`). `connected` maps to the green "Online" / red "Offline" dot.
struct MQTTStatusChip: View {
    let connected: Bool
    var size: Size = .regular

    enum Size { case small, regular }

    private var tone: Color {
        connected ? Color.TS.statusSuccess : Color.TS.statusDanger
    }

    private var label: String {
        connected
            ? MQTTStatusStrings.string("widget.mqtt.online", "Online")
            : MQTTStatusStrings.string("widget.mqtt.offline", "Offline")
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

// MARK: - Stat tile (web `StatCard label value`)

/// A compact label + value tile, mirroring the web `StatCard` (`@/components/
/// data-display`): a muted uppercase label over a bold, monospaced-digit value
/// inside a tonal surface card. The caller pre-formats `value` (fmtNumber/fmtInt).
struct MQTTStatTile: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(verbatim: value)
                .font(Font.TS.title)
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

// MARK: - Footer row (web last-message / broker rows)

/// A muted "label … value" row used for the Last Message and Broker footer
/// entries (web `flex items-center justify-between text-[10px]`).
struct MQTTFooterRow: View {
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
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label): \(value)"))
    }
}

// MARK: - Freshness chip (web `DataFreshness` header indicator)

/// Live-stream freshness chip shown in the header: a tone dot + Live/Stale/
/// Offline word. Mirrors the web `DataFreshness` / `FreshnessIndicator`
/// (`@/components/data-display`).
struct MQTTFreshnessChip: View {
    let connection: MQTTConnection

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: MQTTStatusStrings.string("widget.mqtt.live", "Live")
        case .stale: MQTTStatusStrings.string("widget.mqtt.stale", "Stale")
        case .offline: MQTTStatusStrings.string("widget.mqtt.offline", "Offline")
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
