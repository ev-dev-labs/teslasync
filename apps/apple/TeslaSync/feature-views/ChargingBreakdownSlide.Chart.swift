//
//  ChargingBreakdownSlide.Chart.swift
//  TeslaSync — P4 feature view · 0061 · ChargingBreakdownSlide (Apple)
//
//  The charging-mix donut — the Swift Charts parity of the web Recharts `PieChart`
//  in ChargingBreakdownSlide.tsx (`Pie dataKey="value"`, innerRadius 55 /
//  outerRadius 85 → a ~0.65 inner-radius ratio, `paddingAngle={3}`,
//  `strokeWidth={0}`). Built with `SectorMark` so the slice angles are proportional
//  to each charger type's share; colors come from the shared P1/S9 palette by the
//  web-filtered slice index. The whole donut exposes one accessible summary so
//  VoiceOver isn't handed an opaque image. A small legend chip backs the breakdown
//  legend row.
//
//  The slide's "Charts/maps used: (none)" prompt metadata is an extraction artifact
//  — the web source imports `PieChart, Pie, Cell, ResponsiveContainer` from
//  `@/components/charts` and renders a donut, so it IS reproduced here with Swift
//  Charts per the prompt's Recharts→Swift Charts mapping (Honesty rules 2 + 5).
//

import Charts
import SwiftUI

// MARK: - Slice palette (web `COLORS`, mapped to P1/S9 tokens)

/// The donut / legend palette — the web `COLORS = ['#f59e0b', '#3b82f6',
/// '#6b7280']` mapped to design tokens (no raw hex in the surface). The first two
/// tokens are exact matches for the web amber + blue; the third is the neutral
/// "muted/other" token for the AC / Other share. The index wraps, reproducing the
/// web `COLORS[i % COLORS.length]`.
public enum ChargingBreakdownSlidePalette {
    /// Amber (web `#f59e0b` == `chartSeriesEnergy`), blue (web `#3b82f6` ==
    /// `chartSeriesSpeed`), neutral grey (web `#6b7280` ≈ `textMuted`).
    public static let slice: [Color] = [
        Color.TS.chartSeriesEnergy,
        Color.TS.chartSeriesSpeed,
        Color.TS.textMuted
    ]

    /// The palette color for a slice index, wrapping (web `COLORS[i % len]`).
    public static func color(at index: Int) -> Color {
        guard !slice.isEmpty else { return Color.TS.accent }
        let wrapped = ((index % slice.count) + slice.count) % slice.count
        return slice[wrapped]
    }
}

// MARK: - Legend chip (web legend dot + "name (pct%)")

/// One legend entry: a colored swatch + the type name and its rounded percentage
/// (web `<div className="h-3 w-3 rounded-full" /> {name} ({round(pct)}%)`). The row
/// is hidden from VoiceOver — the donut speaks the full share list.
struct ChargingBreakdownLegendChip: View {
    let slice: ChargingBreakdownSlice

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Circle()
                .fill(ChargingBreakdownSlidePalette.color(at: slice.colorIndex))
                .frame(width: 12, height: 12)
            Text(verbatim: "\(slice.name) (\(slice.percentText))")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Charging-mix donut (web `PieChart`)

/// The donut chart. One `SectorMark` per slice, the angle proportional to the
/// charger-type share (web `dataKey="value"`), an inner-radius ratio of ~0.65 (web
/// 55/85) and a small angular inset standing in for the web `paddingAngle={3}`. The
/// legend is hidden (the slide carries its own); the chart speaks a single share
/// summary. Honors Reduce Motion for the entrance animation.
struct ChargingBreakdownDonutChart: View {
    let slices: [ChargingBreakdownSlice]

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var summary: String {
        ChargingBreakdownSlideAccessibility.chartSummary(for: slices)
    }

    var body: some View {
        Chart(slices) { slice in
            SectorMark(
                angle: .value(slice.name, ChargingBreakdownSlideFormat.safeNumber(slice.value)),
                innerRadius: .ratio(0.65),
                angularInset: 1.5
            )
            .cornerRadius(2)
            .foregroundStyle(ChargingBreakdownSlidePalette.color(at: slice.colorIndex))
        }
        .chartLegend(.hidden)
        .frame(width: 224, height: 224)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.slowDuration), value: slices)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: summary))
    }
}
