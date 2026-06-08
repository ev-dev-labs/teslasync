//
//  OptimizerSection.Heatmap.swift
//  TeslaSync — P4 feature view · 0104 · OptimizerSection (Apple)
//
//  The Charging Cost Heatmap — the native parity of the web `CostHeatmap` child the
//  optimizer section composes (driven by `weekly_heatmap`, part of this surface's
//  own data prop). A 7 (Sun→Sat) × 24 (hours) grid of cost cells over a warm→cool
//  ramp whose opacity grows with session volume, an hour-tick header, and a
//  Cheap→Expensive legend. The grid scrolls horizontally on compact widths (web
//  `overflow-x-auto` + `min-w-[600px]`). All math comes from the pure
//  `OptimizerHeatmap` projection; the view only maps colors and wires accessibility.
//

import SwiftUI

// MARK: - Heatmap geometry

private enum OptimizerHeatmapMetrics {
    static let cellSize: CGFloat = 16
    static let cellSpacing: CGFloat = 2
    static let dayLabelWidth: CGFloat = 40
    static let legendSwatch: CGFloat = 12
}

// MARK: - Heatmap panel (web `CostHeatmap`)

/// The cost-heatmap panel. Resolves day labels through the i18n facade, builds each
/// `day × hour` cell from the pure projection, and exposes a spoken overview plus
/// per-populated-cell labels for VoiceOver.
struct OptimizerHeatmapPanel: View {
    let entries: [OptimizerHeatmapEntry]
    let peakCostPerKwh: Double
    let localize: (String, String) -> String
    let formatting: any OptimizerFormatting

    private var maxCost: Double {
        OptimizerHeatmap.maxCost(peakCostPerKwh: peakCostPerKwh)
    }

    private var sessionsWord: String {
        localize("charging.optimizer.sessions", "sessions")
    }

    private func dayLabel(_ index: Int) -> String {
        let fallback = OptimizerDayLabels.fallback(index)
        return localize("charging.optimizer.day\(index)", fallback)
    }

    private var overview: String {
        let busiest = OptimizerHeatmap.busiest(entries)
        return OptimizerAccessibility.heatmapOverview(
            title: localize("charging.optimizer.heatmap", "Charging Cost Heatmap"),
            busiest: busiest,
            busiestDayLabel: busiest.map { dayLabel($0.day) },
            sessionsWord: sessionsWord,
            formatNumber: { formatting.formatNumber($0, decimals: $1) }
        )
    }

    var body: some View {
        OptimizerGlassPanel(
            systemImage: "clock.fill",
            tint: Color.TS.chartSeriesPower,
            title: localize("charging.optimizer.heatmap", "Charging Cost Heatmap")
        ) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                ScrollView(.horizontal, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: OptimizerHeatmapMetrics.cellSpacing) {
                        hourHeader
                        ForEach(OptimizerHeatmapAxis.dayIndices, id: \.self) { day in
                            dayRow(day)
                        }
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel(Text(verbatim: overview))
                }
                legend
            }
        }
    }

    private var hourHeader: some View {
        HStack(spacing: OptimizerHeatmapMetrics.cellSpacing) {
            Color.clear
                .frame(width: OptimizerHeatmapMetrics.dayLabelWidth, height: 1)
            ForEach(OptimizerHeatmapAxis.hourIndices, id: \.self) { hour in
                Text(verbatim: OptimizerHeatmapAxis.hourTick(hour))
                    .font(.system(size: 8))
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(width: OptimizerHeatmapMetrics.cellSize)
            }
        }
        .accessibilityHidden(true)
    }

    private func dayRow(_ day: Int) -> some View {
        HStack(spacing: OptimizerHeatmapMetrics.cellSpacing) {
            Text(verbatim: dayLabel(day))
                .font(.system(size: 10))
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: OptimizerHeatmapMetrics.dayLabelWidth, alignment: .trailing)
                .accessibilityHidden(true)
            ForEach(OptimizerHeatmapAxis.hourIndices, id: \.self) { hour in
                cellView(day: day, hour: hour)
            }
        }
    }

    @ViewBuilder
    private func cellView(day: Int, hour: Int) -> some View {
        let cell = OptimizerHeatmap.cell(day: day, hour: hour, entries: entries)
        let heat = OptimizerHeatmap.color(for: cell, maxCost: maxCost)
        RoundedRectangle(cornerRadius: 3, style: .continuous)
            .fill(Color(heat))
            .frame(width: OptimizerHeatmapMetrics.cellSize, height: OptimizerHeatmapMetrics.cellSize)
            .modifier(HeatCellAccessibility(
                summary: cellSummary(dayLabel: dayLabel(day), cell: cell),
                isPopulated: cell.isPopulated
            ))
    }

    private func cellSummary(dayLabel: String, cell: OptimizerHeatmapCell) -> String {
        OptimizerAccessibility.heatCellSummary(
            dayLabel: dayLabel,
            cell: cell,
            sessionsWord: sessionsWord,
            formatNumber: { formatting.formatNumber($0, decimals: $1) },
            formatCurrency: { formatting.formatCurrency($0, decimals: $1) }
        )
    }

    private var legend: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            Text(verbatim: localize("charging.optimizer.cheap", "Cheap"))
                .font(.system(size: 10))
                .foregroundStyle(Color.TS.textMuted)
            HStack(spacing: OptimizerHeatmapMetrics.cellSpacing) {
                ForEach(Array(OptimizerHeatmap.legendStops.enumerated()), id: \.offset) { _, stop in
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(Color(OptimizerHeatmap.legendColor(intensity: stop)))
                        .frame(
                            width: OptimizerHeatmapMetrics.legendSwatch,
                            height: OptimizerHeatmapMetrics.legendSwatch
                        )
                }
            }
            Text(verbatim: localize("charging.optimizer.expensive", "Expensive"))
                .font(.system(size: 10))
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(OptimizerSection.text("charging.optimizer.legend", "Legend: cheap to expensive"))
    }
}

// MARK: - Cell accessibility (populated cells are spoken; empty cells are hidden)

/// Exposes a populated heatmap cell as its own VoiceOver element (the web `title`
/// tooltip), and hides empty cells so the rotor isn't flooded with blanks.
private struct HeatCellAccessibility: ViewModifier {
    let summary: String
    let isPopulated: Bool

    func body(content: Content) -> some View {
        if isPopulated {
            content
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: summary))
        } else {
            content.accessibilityHidden(true)
        }
    }
}

// MARK: - SwiftUI color bridge

extension Color {
    /// Builds a SwiftUI `Color` from the heatmap projection's `0…1` sRGB channels.
    init(_ heat: OptimizerHeatColor) {
        self = Color(.sRGB, red: heat.red, green: heat.green, blue: heat.blue, opacity: heat.opacity)
    }
}

// MARK: - Day labels (web fixed `['Sun'…'Sat']`)

/// The English fallbacks for the heatmap's day axis (web `['Sun'…'Sat']`). The view
/// resolves each through the i18n facade (`charging.optimizer.day0…6`); these are
/// only the defaults when a key is missing from the catalog.
enum OptimizerDayLabels {
    static let fallbacks = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    static func fallback(_ index: Int) -> String {
        guard index >= 0, index < fallbacks.count else { return "" }
        return fallbacks[index]
    }
}
