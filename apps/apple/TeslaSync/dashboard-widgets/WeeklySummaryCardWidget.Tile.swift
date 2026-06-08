//
//  WeeklySummaryCardWidget.Tile.swift
//  TeslaSync — P4 dashboard widget · 0117 · WeeklySummaryCardWidget (Apple)
//
//  The leaf views the WeeklySummaryCardWidget surface composes: the per-stat
//  cell (web `StatCard`, including the week-over-week trend chip), the compact
//  inline metric (web `InlineMetric`), and the compact hero number (web
//  `fmtNumber` big value). Kept in their own file so the surface file stays
//  within the house file-length limit.
//

import SwiftUI

// MARK: - Stat tile (web `StatCard`)

/// One stat cell's data, mirroring the web `StatCard` props (label, value, unit,
/// icon, optional week-over-week `trend`).
struct WeeklyStatTileData: Identifiable {
    let id: String
    let label: String
    let value: String
    let unit: String?
    let systemImage: String
    let trend: WeeklyTrend?
}

/// One stat cell mirroring the web `StatCard`: a muted label + icon, a large
/// value with an optional trailing unit, and an optional trend chip whose arrow
/// follows the direction and whose colour follows `positive` (success / danger /
/// muted) — exactly as the web component renders it.
struct WeeklyStatTile: View {
    let data: WeeklyStatTileData

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: data.label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 0)
                Image(systemName: data.systemImage)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(verbatim: data.value)
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if let unit = data.unit {
                    Text(verbatim: unit)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            if let trend = data.trend {
                WeeklyTrendChip(trend: trend)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.sm)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var accessibilityLabel: String {
        var label = data.unit.map { "\(data.label) \(data.value) \($0)" } ?? "\(data.label) \(data.value)"
        if let trend = data.trend, let phrase = WeeklySummaryAccessibility.trendPhrase(trend) {
            label += " \(phrase)"
        }
        return label
    }
}

// MARK: - Trend chip (web `StatCard` trend row)

/// The week-over-week trend chip: a direction arrow + the percent value. The
/// arrow follows `direction` (↑ / ↓ / —) while the colour follows `positive`
/// (success when positive, danger when not, muted when flat) — the native parity
/// of the web `trend.positive ? green : direction === 'flat' ? muted : red`.
struct WeeklyTrendChip: View {
    let trend: WeeklyTrend

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: arrowSystemImage)
                .font(.system(size: 9, weight: .bold))
            Text(verbatim: trend.value)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .monospacedDigit()
        }
        .foregroundStyle(tone)
        .accessibilityHidden(true)
    }

    private var arrowSystemImage: String {
        switch trend.direction {
        case .up: "arrow.up"
        case .down: "arrow.down"
        case .flat: "minus"
        }
    }

    private var tone: Color {
        if trend.positive == true { return Color.TS.statusSuccess }
        if trend.direction == .flat { return Color.TS.textMuted }
        return Color.TS.statusDanger
    }
}

// MARK: - Inline metric (web `InlineMetric`)

/// A compact icon + value pair, the native parity of the web `InlineMetric` used
/// in the standard (non-wide, non-tall) layout's footer row.
struct WeeklyInlineMetric: View {
    let systemImage: String
    let value: String
    let accessibilityLabel: String

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: systemImage)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: value)
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }
}

// MARK: - Big number (web compact `fmtNumber` hero value)

/// The compact layout's hero distance number, animating value changes and
/// honoring Reduce Motion (web compact `<span>{fmtNumber(distance, 0)}</span>`).
struct WeeklySummaryBigNumber: View {
    let formatted: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Text(verbatim: formatted)
            .font(Font.TS.display)
            .fontWeight(.bold)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textPrimary)
            .contentTransition(.numericText())
            .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.normalDuration), value: formatted)
            .lineLimit(1)
            .minimumScaleFactor(0.5)
    }
}
