//
//  ChargingTab.Charts.swift
//  TeslaSync — P4 feature view · 0054 · ChargingTab (Apple)
//
//  The three Swift Charts panels that are the body of the surface below the summary grid, the
//  native parity of the web source's Recharts charts (mapped through the P3 `@/components/charts`
//  layer):
//
//    1. Charger Types          — donut (web `PieChart` + `Pie` innerRadius 55 / outerRadius 95,
//                                paddingAngle 3) built with `SectorMark`; colors by source index
//                                (web `PIE_COLORS[i % len]` → `TSChartPalette.color(at:)`) + legend
//    2. Start Battery Distribution — bar histogram (web `BarChart`, CHART_COLORS[1])
//    3. Hourly Charging Pattern    — bars + line (web `ComposedChart`, twin axes: charges LEFT
//                                [0], energy RIGHT [3]) re-projected onto one Swift Charts domain
//                                via `ChargingTabHourlyScale` with a trailing true-energy axis
//
//  Every panel renders its own per-series empty row (web `EmptyState`) and carries a VoiceOver
//  value so a chart is never an opaque image. Palette indices match the web `CHART_COLORS`
//  (Okabe-Ito) through `TSChartPalette`. The prompt's auto-extracted "charts: (none)" is
//  superseded by the web source, which is THE specification (covenant #5 — no parity shortcuts).
//

import Charts
import SwiftUI

private let chargingChartHeight: CGFloat = 260
private let chargingDonutHeight: CGFloat = 240

// MARK: - Legend chip (web `Legend` dot + label)

/// One legend entry: a colored swatch + a (pre-localized or data) label.
struct ChargingTabLegendChip: View {
    let color: Color
    let label: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
    }
}

// MARK: - 1. Charger Types donut (web `PieChart`)

/// The charger-types panel. A donut (`SectorMark`, angle ∝ count, inner-radius ratio 0.58 ≈ web
/// 55/95, angular inset standing in for `paddingAngle`) above a wrapping legend, or the per-series
/// empty state. The chart speaks a single share summary; the legend is decorative for VoiceOver.
struct ChargingTabChargerTypesPanel: View {
    let slices: [ChargingTabChargerTypeSlice]
    let localize: (String, String) -> String
    let formatting: any ChargingTabFormatting

    private let legendColumns = [GridItem(.adaptive(minimum: 110), spacing: TSSpacing.sm, alignment: .leading)]

    private var summary: String {
        ChargingTabAccessibility.chargerTypesSummary(
            slices: slices,
            typesNoun: localize("analytics.charging.a11yTypes", "charger types"),
            totalNoun: localize("analytics.charging.a11ySessions", "sessions"),
            emptyFallback: localize("analytics.charging.a11yNoData", "No data"),
            formatInt: formatting.formatInt
        )
    }

    var body: some View {
        ChargingTabGlassPanel(titleKey: "analytics.charging.chargerTypes", titleFallback: "Charger Types") {
            if slices.isEmpty {
                ChargingTabEmptyRow(key: "analytics.charging.noTypes", fallback: "No charger type data")
            } else {
                VStack(spacing: TSSpacing.md) {
                    donut
                        .frame(height: chargingDonutHeight)
                        .frame(maxWidth: .infinity)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(ChargingTabStrings.text(
                            "analytics.charging.chargerTypes",
                            "Charger Types"
                        ))
                        .accessibilityValue(Text(verbatim: summary))
                    legend
                }
            }
        }
    }

    private var donut: some View {
        Chart(slices) { slice in
            SectorMark(
                angle: .value("count", ChargingTabNumeric.safe(slice.count)),
                innerRadius: .ratio(0.58),
                angularInset: 2
            )
            .cornerRadius(4)
            .foregroundStyle(TSChartPalette.color(at: slice.colorIndex))
        }
        .chartLegend(.hidden)
    }

    private var legend: some View {
        LazyVGrid(columns: legendColumns, alignment: .leading, spacing: TSSpacing.xs) {
            ForEach(slices) { slice in
                ChargingTabLegendChip(color: TSChartPalette.color(at: slice.colorIndex), label: slice.type)
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - 2. Start Battery Distribution (web `BarChart`)

/// The start-battery distribution panel. A single-series categorical bar histogram (web `BarChart`
/// with a `range` x-axis, CHART_COLORS[1]) or the per-series empty state.
struct ChargingTabBatteryDistPanel: View {
    let bars: [ChargingTabDistributionBar]
    let localize: (String, String) -> String

    private var summary: String {
        ChargingTabAccessibility.distributionSummary(
            bars: bars,
            rangesNoun: localize("analytics.charging.a11yRanges", "ranges"),
            totalNoun: localize("analytics.charging.a11ySessions", "sessions"),
            emptyFallback: localize("analytics.charging.a11yNoData", "No data")
        )
    }

    var body: some View {
        ChargingTabGlassPanel(
            titleKey: "analytics.charging.startBattery",
            titleFallback: "Start Battery Distribution"
        ) {
            if bars.isEmpty {
                ChargingTabEmptyRow(key: "analytics.charging.noBatDist", fallback: "No battery distribution data")
            } else {
                chart
                    .frame(height: chargingChartHeight)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(ChargingTabStrings.text(
                        "analytics.charging.startBattery",
                        "Start Battery Distribution"
                    ))
                    .accessibilityValue(Text(verbatim: summary))
            }
        }
    }

    private var chart: some View {
        Chart(bars) { bar in
            BarMark(
                x: .value("range", bar.range),
                y: .value("count", bar.count)
            )
            .cornerRadius(4)
            .foregroundStyle(TSChartPalette.color(at: 1))
        }
        .chartLegend(.hidden)
        .tsChartAxes()
    }
}

// MARK: - 3. Hourly Charging Pattern (web `ComposedChart`, twin axes)

/// The hourly-pattern panel. Bars (charges, LEFT axis, [0]) + a line (energy, RIGHT axis, [3]).
/// Swift Charts shares one y-domain, so the energy line is re-projected onto the left (charges)
/// domain via `ChargingTabHourlyScale` and a trailing axis is drawn with labels mapped back to
/// true energy. A custom legend names both series; the chart speaks an hour-count summary.
struct ChargingTabHourlyPanel: View {
    let points: [ChargingTabHourlyPoint]
    let scale: ChargingTabHourlyScale
    let localize: (String, String) -> String
    let formatting: any ChargingTabFormatting

    private var chargesLabel: String {
        localize("analytics.charging.charges", "Charges")
    }

    private var energyLabel: String {
        localize("analytics.charging.energykWh", "Energy (kWh)")
    }

    private var summary: String {
        ChargingTabAccessibility.countSummary(
            points.count,
            noun: localize("analytics.charging.a11yHours", "hours"),
            emptyFallback: localize("analytics.charging.a11yNoData", "No data")
        )
    }

    var body: some View {
        ChargingTabGlassPanel(titleKey: "analytics.charging.hourlyPattern", titleFallback: "Hourly Charging Pattern") {
            if points.isEmpty {
                ChargingTabEmptyRow(key: "analytics.charging.noHourly", fallback: "No hourly data")
            } else {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    legend
                    chart
                        .frame(height: chargingChartHeight)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(ChargingTabStrings.text(
                            "analytics.charging.hourlyPattern",
                            "Hourly Charging Pattern"
                        ))
                        .accessibilityValue(Text(verbatim: summary))
                }
            }
        }
    }

    private var legend: some View {
        HStack(spacing: TSSpacing.md) {
            ChargingTabLegendChip(color: TSChartPalette.color(at: 0), label: chargesLabel)
            ChargingTabLegendChip(color: TSChartPalette.color(at: 3), label: energyLabel)
        }
        .accessibilityHidden(true)
    }

    private var chart: some View {
        Chart {
            ForEach(points) { point in
                BarMark(
                    x: .value("hour", point.hour),
                    y: .value("charges", point.charges)
                )
                .cornerRadius(3)
                .foregroundStyle(TSChartPalette.color(at: 0))

                LineMark(
                    x: .value("hour", point.hour),
                    y: .value("energy", scale.plotted(energy: point.energy))
                )
                .foregroundStyle(TSChartPalette.color(at: 3))
                .lineStyle(StrokeStyle(lineWidth: 2))
                .interpolationMethod(.catmullRom)
            }
        }
        .chartYScale(domain: 0 ... scale.domainUpperBound)
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(verbatim: ChargingTabNumeric.axisLabel(number)).foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
            AxisMarks(position: .trailing, values: scale.trailingTickPositions) { value in
                AxisValueLabel {
                    if let plotted = value.as(Double.self) {
                        Text(verbatim: formatting.formatInt(scale.trueEnergy(fromPlotted: plotted)))
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 6)) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.15))
                AxisValueLabel {
                    if let hour = value.as(Int.self) {
                        Text(verbatim: ChargingTabNumeric.hourLabel(hour)).foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .chartLegend(.hidden)
    }
}
