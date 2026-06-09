//
//  CostBreakdownWidget.Chart.swift
//  TeslaSync — P4 dashboard widget · 0031 · CostBreakdownWidget (Apple)
//
//  The Swift Charts donut — the native counterpart of the web Recharts `PieChart`
//  (innerRadius 55%, outerRadius 85%, paddingAngle 2) in
//  features/dashboard/widgets/CostBreakdownWidget.tsx. Slice fills come from the design-token
//  categorical palette (web `useThemeChartPalette().series` → `TSChartPalette`), and the donut
//  supports tap-to-inspect selection that updates the center read-out — the touch-first native
//  analog of the web hover `CostTooltip` (which showed the slice month + `formatCurrency(value, 2)`).
//

import Charts
import SwiftUI

// MARK: - Donut chart (web Recharts `PieChart`)

/// Monthly-cost donut. Each sector is filled with its palette colour and inset to reproduce the web
/// `paddingAngle`; the hole (web `innerRadius="55%"`) carries a read-out of the focused slice's month
/// + cost. Tapping a sector focuses it (the native analog of the web hover tooltip); at rest no slice
/// is dimmed and the center shows the most-recent month.
struct CostBreakdownDonutChart: View {
    let segments: [CostDonutSegment]

    @State private var selectedValue: Double?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Maps the selected angular value back to its slice by walking the cumulative slice sums (the
    /// donut sectors are summed in `segments` order).
    private var selectedSegment: CostDonutSegment? {
        guard let selectedValue else { return nil }
        var cumulative = 0.0
        for segment in segments {
            cumulative += segment.value
            if selectedValue <= cumulative { return segment }
        }
        return segments.last
    }

    /// The slice shown in the center read-out: the tapped one, else the most-recent month (web
    /// "This Month" emphasis). The default read-out never dims the other slices.
    private var centerSegment: CostDonutSegment? {
        selectedSegment ?? segments.last
    }

    var body: some View {
        Chart(segments) { segment in
            SectorMark(
                angle: .value(CostBreakdownStrings.string("widget.costBreakdown.a11y.cost", "Cost"), segment.value),
                innerRadius: .ratio(0.55),
                angularInset: 2
            )
            .cornerRadius(3)
            .foregroundStyle(TSChartPalette.color(at: segment.paletteIndex))
            .opacity(opacity(for: segment))
            .accessibilityLabel(Text(verbatim: segment.label))
            .accessibilityValue(Text(verbatim: segment.formattedValue))
        }
        .chartLegend(.hidden)
        .chartAngleSelection(value: $selectedValue)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: segments)
        .overlay { centerReadout }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(CostBreakdownStrings.text(
            "widget.costBreakdown.chartA11y",
            "Donut chart of monthly charging cost"
        ))
    }

    private func opacity(for segment: CostDonutSegment) -> Double {
        guard let selectedSegment else { return 1 }
        return selectedSegment.id == segment.id ? 1 : 0.4
    }

    @ViewBuilder
    private var centerReadout: some View {
        if let centerSegment {
            VStack(spacing: 2) {
                Text(verbatim: centerSegment.label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Text(verbatim: centerSegment.formattedValue)
                    .font(Font.TS.panel)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            .padding(.horizontal, TSSpacing.sm)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }
}
