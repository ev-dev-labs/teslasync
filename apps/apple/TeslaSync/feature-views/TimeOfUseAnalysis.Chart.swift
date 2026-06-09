//
//  TimeOfUseAnalysis.Chart.swift
//  TeslaSync — P4 feature view · 0119 · TimeOfUseAnalysis (Apple)
//
//  The hourly sessions bar chart (web Recharts `<BarChart>` with a per-hour `<Cell>`
//  fill → native Swift `Chart` with one band-coloured `BarMark` per hour). Split out
//  of the chrome in `TimeOfUseAnalysis.Views.swift`. A tap/drag selection reproduces
//  the web `<Tooltip>`: it pins a rule + a callout showing the hour, its band, the
//  session count, and the average cost. The X axis is thinned to every third hour
//  (web `<XAxis interval={2}>`) and the Y axis is an integer session scale. The whole
//  chart exposes a single accessible summary plus per-bar labels so VoiceOver isn't
//  handed an opaque image. Colours come from `TimeOfUseBandPalette` (P1/S9).
//

import Charts
import SwiftUI

// MARK: - Band palette (web `<Cell>` fill → adaptive semantic tokens)

/// The time-of-use band → fill mapping. The web colours each bar by band —
/// peak `#ef4444`, off-peak `#10b981`, mid `palette[0]` — and the legend uses the
/// same three swatches; native maps each band to the equivalent adaptive token (and
/// the CB-safe chart palette for mid) so light / dark / high-contrast all resolve and
/// the chart + legend can NEVER disagree (they share this one function).
enum TimeOfUseBandPalette {
    static func color(_ band: TimeOfUseBand) -> Color {
        switch band {
        case .peak: Color.TS.statusDanger
        case .offPeak: Color.TS.statusSuccess
        case .midPeak: TSChartPalette.color(at: 0)
        }
    }
}

// MARK: - Bar chart (web Recharts `<BarChart>` of sessions per hour)

/// The hourly sessions bar chart — one `BarMark` per hour, coloured by its rate band
/// (web `<Cell fill>`). Tapping a column reveals a value callout (web `ChartTooltip`);
/// each bar carries a per-hour VoiceOver label + value.
struct TimeOfUseBarChart: View {
    let points: [TimeOfUseHourPoint]
    let axisLabels: [String]
    let localize: (String, String) -> String
    let formatting: any TimeOfUseFormatting

    @State private var selectedLabel: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var hourAxisLabel: String {
        localize("costAnalysis.tou.a11y.hour", "Hour")
    }

    private var sessionsAxisLabel: String {
        localize("costAnalysis.tou.sessions", "Sessions")
    }

    private var selectedPoint: TimeOfUseHourPoint? {
        guard let selectedLabel else { return nil }
        return points.first { $0.label == selectedLabel }
    }

    private var chartSummary: String {
        TimeOfUseAccessibility.chartSummary(
            points,
            localize: localize,
            formatCount: { [formatting] value in formatting.formatCount(value) }
        )
    }

    var body: some View {
        chart
            .chartXSelection(value: $selectedLabel)
            .chartLegend(.hidden)
            .frame(height: 260)
            .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: selectedLabel)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(verbatim: chartSummary))
    }

    private var chart: some View {
        Chart {
            ForEach(points) { point in
                BarMark(
                    x: .value(hourAxisLabel, point.label),
                    y: .value(sessionsAxisLabel, point.sessions)
                )
                .foregroundStyle(TimeOfUseBandPalette.color(point.band))
                .cornerRadius(3)
                .accessibilityLabel(Text(verbatim: TimeOfUseAccessibility.barLabel(point, localize: localize)))
                .accessibilityValue(
                    Text(
                        verbatim: TimeOfUseAccessibility.barValue(
                            point,
                            localize: localize,
                            formatCount: { [formatting] value in formatting.formatCount(value) }
                        )
                    )
                )
            }

            if let selected = selectedPoint {
                RuleMark(x: .value(hourAxisLabel, selected.label))
                    .foregroundStyle(Color.TS.textMuted.opacity(0.4))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
                    .annotation(
                        position: .top,
                        alignment: .center,
                        spacing: 6,
                        overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                    ) {
                        TimeOfUseSelectionCallout(point: selected, localize: localize, formatting: formatting)
                    }
            }
        }
        .chartXScale(domain: points.map(\.label))
        .chartXAxis {
            AxisMarks(values: axisLabels) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.15))
                AxisValueLabel {
                    if let label = value.as(String.self) {
                        Text(verbatim: label)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                AxisValueLabel {
                    if let count = value.as(Int.self) {
                        Text(verbatim: formatting.formatCount(count))
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
    }
}

// MARK: - Selection callout (web `<Tooltip>` / `ChartTooltip`)

/// The floating readout shown above the selected bar — the native parity of the web
/// Recharts `<Tooltip>`: the hour label, its band, the session count, and the average
/// cost per session.
struct TimeOfUseSelectionCallout: View {
    let point: TimeOfUseHourPoint
    let localize: (String, String) -> String
    let formatting: any TimeOfUseFormatting

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: TSSpacing.xs) {
                Circle()
                    .fill(TimeOfUseBandPalette.color(point.band))
                    .frame(width: 7, height: 7)
                Text(verbatim: point.label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Text(verbatim: localize(point.band.accessibilityKey, point.band.accessibilityFallback))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Text(verbatim: sessionsText)
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: avgCostText)
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    private var sessionsText: String {
        "\(formatting.formatCount(point.sessions)) \(localize("costAnalysis.tou.sessions", "sessions"))"
    }

    private var avgCostText: String {
        let avg = localize("costAnalysis.tou.avgCost", "avg")
        let perSession = localize("costAnalysis.tou.perSession", "/ session")
        return "\(avg) \(formatting.formatCurrency(point.avgCost)) \(perSession)"
    }
}
