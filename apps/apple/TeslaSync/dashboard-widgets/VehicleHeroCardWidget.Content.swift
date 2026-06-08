//
//  VehicleHeroCardWidget.Content.swift
//  TeslaSync — P4 dashboard widget · 0107 · VehicleHeroCardWidget (Apple)
//
//  The SwiftUI body sub-views (compact + full layouts, status badge, metric cell, charging
//  banner) plus the semantic-tone → `Color.TS` token mappings. These render a pure function of
//  `VehicleHeroProjection`; the shell + state switching live in VehicleHeroCardWidget.swift.
//

import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension VehicleHeroStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept out of the model/adapter so
    /// they stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Tone → token mapping (web Tailwind class → platform token)

extension VehicleHeroStatusTone {
    /// The status-dot color, mapping the resolved web `badgeDot` to the nearest semantic
    /// `Color.TS` token (asleep's web purple folds to the neutral muted token it themes from).
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .info: Color.TS.statusInfo
        case .warning: Color.TS.statusWarning
        case .accent: Color.TS.accent
        case .neutral: Color.TS.textMuted
        case .danger: Color.TS.statusDanger
        }
    }
}

extension VehicleHeroBatteryTone {
    /// The battery-readout color, mapping the web `batteryColor` thresholds to `Color.TS` tokens.
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        case .muted: Color.TS.textMuted
        }
    }
}

// MARK: - Status badge (web data-display `StatusBadge`, size="sm")

/// The vehicle status pill: a colored state dot + the (capitalized, localized) status label in a
/// bordered glass capsule — the native parity of `@/components/data-display/StatusBadge`.
struct VehicleHeroStatusBadge: View {
    let label: String
    let tone: VehicleHeroStatusTone

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(tone.color)
                .frame(width: 6, height: 6)
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(Color.TS.surfaceGlass, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Animated battery percent (web data-display `AnimatedNumber`)

/// The compact battery readout: a large, tone-colored percent that animates between values using
/// `numericText` content transition, honoring Reduce Motion — the native parity of the web
/// `<AnimatedNumber value suffix="%" />`. Falls back to an em dash when the level is unknown.
private struct VehicleHeroBatteryPercent: View {
    let level: Int?
    let tone: VehicleHeroBatteryTone
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if let level {
                Text(verbatim: "\(level)%")
                    .contentTransition(.numericText())
                    .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: level)
            } else {
                Text(verbatim: VehicleHeroProjection.emDash)
            }
        }
        .font(Font.TS.title)
        .fontWeight(.bold)
        .monospacedDigit()
        .foregroundStyle(tone.color)
    }
}

// MARK: - Metric cell (web `MetricCell`)

/// One labeled metric: a tinted leading glyph, a muted uppercase-free caption label, and the
/// value below it — the native parity of the web `MetricCell`.
private struct VehicleHeroMetricCell: View {
    let systemImage: String
    let iconColor: Color
    let labelKey: String
    let labelFallback: String
    let value: String
    var valueColor: Color = .TS.textPrimary

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.xs) {
            Image(systemName: systemImage)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(iconColor)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                VehicleHeroStrings.text(labelKey, labelFallback)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                Text(verbatim: value)
                    .font(Font.TS.panel)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(valueColor)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(VehicleHeroStrings.string(labelKey, labelFallback)) \(value)"))
    }
}

// MARK: - Charging banner (web charging `<div>`)

/// The "Charging" banner shown while the vehicle is actively charging: a pulsing bolt, the
/// localized label, and the optional charger-power suffix — native parity of the web banner.
private struct VehicleHeroChargingBanner: View {
    let powerText: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Color.TS.statusSuccess)
                .opacity(pulse && !reduceMotion ? 0.4 : 1)
                .animation(
                    reduceMotion ? nil : .easeInOut(duration: TSMotion.slowDuration).repeatForever(autoreverses: true),
                    value: pulse
                )
                .accessibilityHidden(true)
            VehicleHeroStrings.text("widget.charging", "Charging")
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.statusSuccess)
            if let powerText {
                Spacer(minLength: TSSpacing.xs)
                Text(verbatim: powerText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusSuccess.opacity(0.7))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(
            Color.TS.statusSuccess.opacity(0.08),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusSuccess.opacity(0.18), lineWidth: 1)
        )
        .onAppear { pulse = true }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Compact body (web `CompactView`, 1×1)

/// The 1×1 layout: a status badge over the animated battery percent over the truncated vehicle
/// name, centered — native parity of the web `CompactView`.
struct VehicleHeroCompactContent: View {
    let projection: VehicleHeroProjection

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            VehicleHeroStatusBadge(label: projection.statusLabel, tone: projection.statusTone)
            VehicleHeroBatteryPercent(level: projection.batteryLevel, tone: projection.batteryTone)
            Text(verbatim: projection.name)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .truncationMode(.tail)
                .padding(.horizontal, TSSpacing.xs)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(projection.name). \(projection.statusLabel). \(projection.batteryText)"))
    }
}

// MARK: - Full body (web `FullView`, 2×1+)

/// The standard layout: name + status header, model/trim subtitle, the responsive metric grid,
/// the charging banner, and the extra outside/ideal row when tall-and-narrow — native parity of
/// the web `FullView`.
struct VehicleHeroFullContent: View {
    let projection: VehicleHeroProjection
    let isWide: Bool
    let isTall: Bool

    private let columns = [GridItem(.adaptive(minimum: 88), spacing: TSSpacing.sm, alignment: .leading)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            subtitle
            metricGrid
            if projection.isCharging {
                VehicleHeroChargingBanner(powerText: projection.chargingPowerText)
            }
            if isTall, !isWide {
                tallExtraRow
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: VehicleHeroAccessibility.summary(for: projection)))
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: projection.name)
                .font(Font.TS.panel)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
            VehicleHeroStatusBadge(label: projection.statusLabel, tone: projection.statusTone)
                .layoutPriority(1)
        }
    }

    @ViewBuilder
    private var subtitle: some View {
        if !projection.subtitle.isEmpty {
            Text(verbatim: projection.subtitle)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .truncationMode(.tail)
        }
    }

    private var metricGrid: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.sm) {
            VehicleHeroMetricCell(
                systemImage: "battery.100",
                iconColor: Color.TS.textMuted,
                labelKey: "widget.battery",
                labelFallback: "Battery",
                value: projection.batteryText,
                valueColor: projection.batteryTone.color
            )
            VehicleHeroMetricCell(
                systemImage: "gauge.medium",
                iconColor: Color.TS.accent,
                labelKey: "widget.range",
                labelFallback: "Range",
                value: projection.rangeText
            )
            VehicleHeroMetricCell(
                systemImage: "thermometer.medium",
                iconColor: Color.TS.statusWarning,
                labelKey: "widget.cabin",
                labelFallback: "Cabin",
                value: projection.cabinText
            )
            if isWide {
                VehicleHeroMetricCell(
                    systemImage: "thermometer.medium",
                    iconColor: Color.TS.statusInfo,
                    labelKey: "widget.outside",
                    labelFallback: "Outside",
                    value: projection.outsideText
                )
            }
        }
    }

    private var tallExtraRow: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Divider().overlay(Color.TS.border)
            HStack(alignment: .top, spacing: TSSpacing.sm) {
                VehicleHeroMetricCell(
                    systemImage: "thermometer.medium",
                    iconColor: Color.TS.statusInfo,
                    labelKey: "widget.outside",
                    labelFallback: "Outside",
                    value: projection.outsideText
                )
                VehicleHeroMetricCell(
                    systemImage: "gauge.medium",
                    iconColor: Color.TS.accent,
                    labelKey: "widget.idealRange",
                    labelFallback: "Ideal",
                    value: projection.idealText
                )
            }
        }
    }
}
