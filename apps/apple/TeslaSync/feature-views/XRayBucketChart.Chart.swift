//
//  XRayBucketChart.Chart.swift
//  TeslaSync — P4 feature view · 0032 · XRayBucketChart (Apple)
//
//  The single-series Swift Charts bar chart + its selection tooltip — the native
//  counterpart of the web Recharts `BarChart` (one `<Bar dataKey="count"
//  fill="var(--accent-primary)">` over a time-scaled `ts` axis, with a `CartesianGrid`
//  + `Tooltip`). Split out of the chrome in `XRayBucketChart.Views.swift`. The bar color
//  comes from `XRayBucketPalette`; all copy resolves through the P1/S10 facade; all
//  chrome is token-driven (P1/S9).
//
//  Recharts → Swift Charts mapping: the web `XAxis dataKey="ts" type="number"
//  scale="time"` becomes a temporal x-domain; `YAxis allowDecimals={false}` +
//  `CartesianGrid` become the leading integer y-axis + grid lines; the
//  `<Tooltip labelFormatter={formatTime} />` becomes a tap/drag `chartXSelection` rule +
//  annotation; the `<Bar>` becomes a `BarMark` with `.cornerRadius`.
//

import Charts
import SwiftUI

// MARK: - Chart (web Recharts `BarChart`)

/// The ingest bucket bar chart — one bar per time bucket (web `<Bar dataKey="count">`),
/// the accent series fill, a leading integer y-axis, a time-of-day x-axis (web
/// `formatTime`), and a tap/drag selection that reveals a value tooltip (web `Tooltip`).
/// Each bar carries a VoiceOver label + value (the web visually-hidden data table parity).
struct XRayBucketBarChart: View {
    let bars: [XRayBucketBar]

    @State private var selectedDate: Date?
    @Environment(\.locale) private var locale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var bucketAxisLabel: String {
        XRayBucketStrings.string("admin.xray.chart.cols.bucket", "Bucket")
    }

    private var samplesAxisLabel: String {
        XRayBucketStrings.string("admin.xray.chart.cols.count", "Samples")
    }

    private var selectedBar: XRayBucketBar? {
        guard let selectedDate else { return nil }
        return Self.nearestBar(to: selectedDate, in: bars)
    }

    var body: some View {
        Chart {
            ForEach(bars) { bar in
                BarMark(
                    x: .value(bucketAxisLabel, bar.timestamp),
                    y: .value(samplesAxisLabel, bar.count)
                )
                .foregroundStyle(XRayBucketPalette.bar)
                .cornerRadius(3)
                .accessibilityLabel(Text(verbatim: barAccessibility(bar)))
                .accessibilityValue(Text(verbatim: barValue(bar)))
            }

            if let selectedBar {
                RuleMark(x: .value(bucketAxisLabel, selectedBar.timestamp))
                    .foregroundStyle(Color.TS.border)
                    .annotation(
                        position: .top,
                        overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                    ) {
                        XRayBucketTooltip(bar: selectedBar)
                    }
            }
        }
        .chartXSelection(value: $selectedDate)
        .chartLegend(.hidden)
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 5)) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
                AxisValueLabel {
                    if let date = value.as(Date.self) {
                        Text(verbatim: XRayBucketChartProjection.timeLabel(date, locale: locale, timeZone: .current))
                            .font(Font.TS.label)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
                AxisValueLabel {
                    if let count = Self.intTick(value) {
                        Text(verbatim: XRayBucketChartProjection.sampleCountText(count))
                            .font(Font.TS.label)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .frame(height: 220)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: bars)
        .accessibilityLabel(
            XRayBucketStrings.text(
                "admin.xray.chart.ariaLabel",
                "Bar chart of ingest sample counts per time bucket."
            )
        )
    }

    private func barAccessibility(_ bar: XRayBucketBar) -> String {
        XRayBucketChartAccessibility.barLabel(
            bar,
            locale: locale,
            timeZone: .current,
            localize: XRayBucketStrings.string
        )
    }

    private func barValue(_ bar: XRayBucketBar) -> String {
        XRayBucketChartAccessibility.barValue(bar, localize: XRayBucketStrings.string)
    }

    /// The nearest bar to a selected x instant — `chartXSelection` reports the
    /// interpolated time under the gesture, so we snap to the closest bucket (web
    /// Recharts tooltip snaps to the hovered category).
    static func nearestBar(to date: Date, in bars: [XRayBucketBar]) -> XRayBucketBar? {
        bars.min {
            abs($0.timestamp.timeIntervalSince(date)) < abs($1.timestamp.timeIntervalSince(date))
        }
    }

    /// Reads an integer y tick whether Swift Charts hands back the Int plottable or a
    /// Double (web `YAxis allowDecimals={false}` — integer ticks only).
    static func intTick(_ value: AxisValue) -> Int? {
        if let intValue = value.as(Int.self) {
            return intValue
        }
        if let doubleValue = value.as(Double.self) {
            return Int(doubleValue.rounded())
        }
        return nil
    }
}

// MARK: - Tooltip (web `Tooltip`)

/// The selection tooltip: the bucket's time over its sample count, the native parity of
/// the web `Tooltip` payload (`labelFormatter={formatTime}` + `[fmtInt(v), 'Samples']`).
struct XRayBucketTooltip: View {
    let bar: XRayBucketBar
    @Environment(\.locale) private var locale

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: XRayBucketChartProjection.timeLabel(bar.timestamp, locale: locale, timeZone: .current))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            HStack(spacing: TSSpacing.sm) {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(XRayBucketPalette.bar)
                    .frame(width: 8, height: 8)
                XRayBucketStrings.text("admin.xray.chart.tooltip", "Samples")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.md)
                Text(verbatim: XRayBucketChartProjection.sampleCountText(bar.count))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .frame(minWidth: 140, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
