//
//  BatteryHealthSection.Tiles.swift
//  TeslaSync — P4 feature view · 0072 · BatteryHealthSection (Apple)
//
//  The leaf tiles + their semantic mapping for the Battery Health section: the
//  band → tone map and the pill / stat kind → i18n-label + SF-Symbol + unit
//  extensions (web STATUS_COLORS + the lucide glyphs), the runtime stale / offline
//  `BHChip`, the fixed-width level bar, and the two presentational tiles —
//  `BatteryPillView` (web `BatteryPill`) and `MiniStatView` (web `MiniStat`).
//

import SwiftUI

// MARK: - Band → tone (web BatteryPill STATUS_COLORS map)

extension BatteryBand {
    /// The shared status tone for the glyph / percent / bar fill (web hex map:
    /// good #10b981 → success, warning #f59e0b → warning, critical #ef4444 → danger).
    var tone: TSTone {
        switch self {
        case .good: .success
        case .warning: .warning
        case .critical: .danger
        }
    }

    var color: Color {
        tone.color
    }

    /// A battery glyph whose fill tracks the band, so the level reads at a glance
    /// (web recolours a single battery icon; the native glyph also varies its fill).
    var systemImage: String {
        switch self {
        case .good: "battery.100"
        case .warning: "battery.50"
        case .critical: "battery.25"
        }
    }
}

// MARK: - Pill kind → label (web `t(key, default)` keys)

extension BatteryPillKind {
    var labelKey: String {
        switch self {
        case .chargeStart: "analytics.weeklyDigest.avgBatteryStart"
        case .chargeEnd: "analytics.weeklyDigest.avgBatteryEnd"
        }
    }

    var labelFallback: String {
        switch self {
        case .chargeStart: "Avg Battery at Charge Start"
        case .chargeEnd: "Avg Battery at Charge End"
        }
    }
}

// MARK: - Stat kind → label + icon (web `t(key, default)` + lucide glyph)

extension MiniStatKind {
    var labelKey: String {
        switch self {
        case .chargeGain: "analytics.weeklyDigest.avgChargeGain"
        case .sessions: "analytics.weeklyDigest.chargeSessions"
        case .rangeAdded: "analytics.weeklyDigest.estRangeAdded"
        }
    }

    var labelFallback: String {
        switch self {
        case .chargeGain: "Avg Charge Gain"
        case .sessions: "Charge Sessions"
        case .rangeAdded: "Est. Range Added"
        }
    }

    /// SF Symbol mirroring the web lucide glyph (TrendingUp / Zap / MapPin).
    var systemImage: String {
        switch self {
        case .chargeGain: "chart.line.uptrend.xyaxis"
        case .sessions: "bolt.fill"
        case .rangeAdded: "mappin"
        }
    }

    /// Resolves the formatted value into its final display string, wrapping the
    /// numeric text with the percent / km unit through the i18n facade.
    func displayValue(_ valueText: String) -> String {
        switch self {
        case .chargeGain:
            BHStrings.format("analytics.weeklyDigest.batteryPercent", "{{value}}%", ["value": valueText])
        case .sessions:
            valueText
        case .rangeAdded:
            BHStrings.format("analytics.weeklyDigest.estRangeAddedUnit", "{{value}} km", ["value": valueText])
        }
    }
}

// MARK: - Chip (stale / offline overlays)

/// A small tinted capsule mirroring the shared `TSBadge` styling, taking the runtime
/// string the `LocalizedStringKey`-only `TSBadge` cannot express. Backs the stale /
/// offline header chips (the P4 freshness + connectivity overlays).
struct BHChip: View {
    let text: String
    let systemImage: String
    var tone: TSTone = .neutral

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage).font(.caption2)
            Text(verbatim: text).font(Font.TS.caption).fontWeight(.medium)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: text))
    }
}

// MARK: - Battery pill (web `BatteryPill`)

/// A fixed-width proportion bar (web `h-2 w-16` track + fill). Clamped 0…1.
struct BHLevelBar: View {
    let fraction: Double
    let tone: TSTone

    private var clamped: Double {
        min(max(fraction, 0), 1)
    }

    var body: some View {
        ZStack(alignment: .leading) {
            Capsule().fill(Color.TS.border.opacity(0.3))
            GeometryReader { geo in
                Capsule().fill(tone.color).frame(width: geo.size.width * clamped)
            }
        }
        .frame(width: 64, height: 8)
        .accessibilityHidden(true)
    }
}

/// One battery pill: the band-tinted level glyph, the label + coloured percent, and
/// the trailing proportion bar — the native port of the web `BatteryPill`.
struct BatteryPillView: View {
    let pill: BatteryPillProjection

    private var label: String {
        BHStrings.string(pill.kind.labelKey, pill.kind.labelFallback)
    }

    private var percent: String {
        BHStrings.format("analytics.weeklyDigest.batteryPercent", "{{value}}%", ["value": pill.levelText])
    }

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Image(systemName: pill.band.systemImage)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(pill.band.color)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Text(verbatim: percent)
                    .font(Font.TS.bodySm)
                    .fontWeight(.bold)
                    .foregroundStyle(pill.band.color)
            }
            Spacer(minLength: TSSpacing.sm)
            BHLevelBar(fraction: pill.fraction, tone: pill.band.tone)
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel(cornerRadius: TSRadius.md)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: BatteryHealthAccessibility.tileSummary(label: label, value: percent)))
    }
}

// MARK: - Mini stat (web `MiniStat`)

/// One range stat: the muted glyph, the label, and the value — the native port of the
/// web `MiniStat`. The kind drives the i18n label, the SF Symbol, and the unit wrapper.
struct MiniStatView: View {
    let stat: MiniStatProjection

    private var label: String {
        BHStrings.string(stat.kind.labelKey, stat.kind.labelFallback)
    }

    private var value: String {
        stat.kind.displayValue(stat.valueText)
    }

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Image(systemName: stat.kind.systemImage)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Text(verbatim: value)
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel(cornerRadius: TSRadius.md)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: BatteryHealthAccessibility.tileSummary(label: label, value: value)))
    }
}
