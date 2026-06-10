//
//  LiveTelemetryPanels.Primitives.swift
//  TeslaSync — P4 feature view · 0281 · LiveTelemetryPanels (Apple)
//
//  The reusable panel primitives the seven panels render: the i18n `Text` helper, the tone
//  → token mapping, the panel shell (web `GlassPanel` + `section-title` header), the
//  label / value row, the tinted chip, the boxed metric tile, and the per-source empty
//  fallback. The section chrome (header, freshness, grid, states) lives in
//  LiveTelemetryPanels.Views.swift.
//

import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension LiveTelemetryPanelsStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model
    /// file) so the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Tone mapping (catalog enum → P1/S9 tokens)

extension LTPTone {
    /// The accent tint for chips, row values, and corners (web Tailwind toned colors). The
    /// neutral case is context-dependent: chips/labels read muted, row values read primary.
    var color: Color {
        switch self {
        case .neutral: Color.TS.textMuted
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        case .accent: Color.TS.accent
        case .info: Color.TS.chartSeriesSpeed
        case .purple: Color.TS.chartSeriesPower
        }
    }

    /// The color a row value renders in: neutral falls back to primary text (web value
    /// default `text-[var(--text-primary)]`), every other tone uses its accent.
    var valueColor: Color {
        self == .neutral ? Color.TS.textPrimary : color
    }
}

// MARK: - Panel shell (web `GlassPanel` with a `section-title` header)

/// One telemetry panel container. Renders the tinted SF Symbol + title + an optional
/// trailing accessory, then the panel content.
struct LTPPanelShell<Trailing: View, Content: View>: View {
    let icon: String
    let tint: Color
    let title: String
    @ViewBuilder var trailing: () -> Trailing
    @ViewBuilder var content: () -> Content

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: icon)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(tint)
                        .accessibilityHidden(true)
                    Text(verbatim: title)
                        .font(Font.TS.section)
                        .foregroundStyle(Color.TS.textPrimary)
                        .accessibilityAddTraits(.isHeader)
                    Spacer(minLength: TSSpacing.xs)
                    trailing()
                }
                content()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

extension LTPPanelShell where Trailing == EmptyView {
    init(icon: String, tint: Color, title: String, @ViewBuilder content: @escaping () -> Content) {
        self.init(icon: icon, tint: tint, title: title, trailing: { EmptyView() }, content: content)
    }
}

// MARK: - Row / chip / tile / empty

/// One label / value row (web justify-between row). The value renders monospaced + toned.
struct LTPRow: View {
    let row: LTPInfoRow

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                if let icon = row.icon {
                    Image(systemName: icon)
                        .font(.system(size: 11, weight: .regular))
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityHidden(true)
                }
                Text(verbatim: row.label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: row.value)
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .monospacedDigit()
                .foregroundStyle(row.valueTone.valueColor)
                .multilineTextAlignment(.trailing)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: row.label))
        .accessibilityValue(Text(verbatim: row.value))
    }
}

/// A tinted pill (web status badge): filled tinted background + border, or a plain muted
/// chip when `filled` is false (web source-token chip).
struct LTPChipView: View {
    let chip: LTPChip

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            if let icon = chip.icon {
                Image(systemName: icon).font(.system(size: 10, weight: .semibold)).accessibilityHidden(true)
            }
            Text(verbatim: chip.text).font(Font.TS.caption).fontWeight(.medium)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .foregroundStyle(chip.filled ? chip.tone.color : Color.TS.textMuted)
        .background(chip.filled ? chip.tone.color.opacity(0.12) : Color.TS.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(chip.filled ? chip.tone.color.opacity(0.3) : Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: chip.text))
    }
}

/// A boxed metric tile (web `MetricCard`): label + big value + optional unit caption.
struct LTPMetricTileView: View {
    let tile: LTPMetricTile

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: tile.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                Text(verbatim: tile.value)
                    .font(Font.TS.panel)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                if let unit = tile.unit {
                    Text(verbatim: unit).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous).strokeBorder(
            Color.TS.border,
            lineWidth: 1
        ))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(tile.label) \(tile.value) \(tile.unit ?? "")"))
    }
}

/// A panel's per-source empty fallback (web `EmptyState` inside a panel) — never a blank
/// box.
struct LTPPanelEmpty: View {
    let message: String

    var body: some View {
        HStack {
            Spacer(minLength: 0)
            VStack(spacing: TSSpacing.xs) {
                Image(systemName: "tray")
                    .font(.system(size: 18, weight: .regular))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .multilineTextAlignment(.center)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
