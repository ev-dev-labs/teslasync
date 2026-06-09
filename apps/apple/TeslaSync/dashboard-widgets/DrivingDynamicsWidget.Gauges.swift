//
//  DrivingDynamicsWidget.Gauges.swift
//  TeslaSync — P4 dashboard widget · 0044 · DrivingDynamicsWidget (Apple)
//
//  The native counterparts of the web visual primitives in
//  features/dashboard/widgets/DrivingDynamicsWidget.tsx: the three circular
//  `RadialGauge`s (accel / brake / lateral g) and the wide-layout acceleration
//  `BarChart` histogram. The web Recharts/SVG gauge becomes a SwiftUI trimmed
//  `Circle`; the Recharts `BarChart` becomes Swift Charts `BarMark`. Colors come
//  from the design-token status palette so they track the active theme.
//

import Charts
import SwiftUI

// MARK: - Gauge color band → design token

extension DrivingDynamicsGaugeTone {
    /// The design-token color for the band — the native counterpart of the web
    /// hex values (`#10b981` → statusSuccess, `#22d3ee` → statusInfo,
    /// `#f59e0b` → statusWarning, `#ef4444` → statusDanger).
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .info: Color.TS.statusInfo
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        }
    }
}

// MARK: - Radial gauge (web `RadialGauge`)

/// A single circular g-force gauge — the native counterpart of the web
/// `RadialGauge`: a faint full-circle track, a leading-trimmed colored arc for
/// the `0…1` fill fraction, the formatted value centered inside, and the role
/// caption below. The web stacks an identical formatted number as both the arc
/// center and the gauge `label`; the native gauge folds those into the single
/// centered readout and keeps the role caption, preserving every distinct datum.
struct DrivingDynamicsGaugeView: View {
    let gauge: DrivingDynamicsGauge
    var diameter: CGFloat = 76

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var lineWidth: CGFloat {
        diameter <= 64 ? 6 : 8
    }

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            ZStack {
                Circle()
                    .stroke(Color.TS.border, lineWidth: lineWidth)
                Circle()
                    .trim(from: 0, to: max(0, min(gauge.fraction, 1)))
                    .stroke(
                        gauge.tone.color,
                        style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
                    .animation(
                        reduceMotion ? nil : .easeInOut(duration: TSMotion.slowDuration),
                        value: gauge.fraction
                    )
                Text(verbatim: gauge.valueText)
                    .font(Font.TS.panel)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
            }
            .frame(width: diameter, height: diameter)
            DrivingDynamicsStrings.text(gauge.role.labelKey, gauge.role.labelFallback)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            Text(verbatim: DrivingDynamicsStrings.string(gauge.role.labelKey, gauge.role.labelFallback))
        )
        .accessibilityValue(Text(verbatim: DrivingDynamicsAccessibility.gaugeLabel(gauge)))
    }
}

// MARK: - Acceleration distribution histogram (web `BarChart`)

/// The acceleration-distribution histogram — the native counterpart of the web
/// Recharts `BarChart`. One bar per g-force bucket (count of samples), plotted
/// against a stable per-bucket key so two buckets that round to the same label
/// never collapse, with a tap-to-inspect tooltip, per-bar VoiceOver values, and
/// token-styled axes. Rendered only on a wide widget (web `isWide`).
struct DrivingDynamicsDistributionChart: View {
    let bars: [DrivingGForceBar]
    var isWide: Bool = false

    @State private var selectedKey: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var bucketLabel: String {
        DrivingDynamicsStrings.string("widget.drivingDynamics.bucket", "Bucket")
    }

    private var countLabel: String {
        DrivingDynamicsStrings.string("widget.drivingDynamics.count", "Count")
    }

    private var unit: String {
        DrivingDynamicsStrings.string("widget.drivingDynamics.gUnit", "g")
    }

    private var labelsByKey: [String: String] {
        Dictionary(bars.map { ($0.plotKey, $0.rangeLabel) }, uniquingKeysWith: { first, _ in first })
    }

    private var selectedBar: DrivingGForceBar? {
        guard let selectedKey else { return nil }
        return bars.first { $0.plotKey == selectedKey }
    }

    var body: some View {
        Chart {
            ForEach(bars) { bar in
                BarMark(
                    x: .value(bucketLabel, bar.plotKey),
                    y: .value(countLabel, bar.count)
                )
                .foregroundStyle(TSChartPalette.color(at: 0))
                .cornerRadius(3)
                .accessibilityLabel(Text(verbatim: "\(bar.rangeLabel) \(unit)"))
                .accessibilityValue(Text(verbatim: DrivingDynamicsAccessibility.barLabel(bar)))
            }

            if let selectedBar {
                RuleMark(x: .value(bucketLabel, selectedBar.plotKey))
                    .foregroundStyle(Color.TS.border)
                    .annotation(position: .top, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                        tooltip(for: selectedBar)
                    }
            }
        }
        .chartXScale(domain: bars.map(\.plotKey))
        .chartXSelection(value: $selectedKey)
        .chartXAxis { xAxis }
        .chartYAxis { yAxis }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: bars)
        .accessibilityLabel(
            DrivingDynamicsStrings.text(
                "widget.drivingDynamics.distributionA11y",
                "Histogram of g-force samples by acceleration bucket"
            )
        )
    }

    @AxisContentBuilder
    private var xAxis: some AxisContent {
        AxisMarks(values: axisKeys) { value in
            AxisValueLabel {
                if let key = value.as(String.self), let label = labelsByKey[key] {
                    Text(verbatim: label)
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    @AxisContentBuilder
    private var yAxis: some AxisContent {
        AxisMarks(position: .leading) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
            AxisValueLabel {
                if let number = value.as(Double.self) {
                    Text(verbatim: DrivingDynamicsFormat.number(number, decimals: 0))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    /// The bucket keys shown on the x-axis: all on a wide widget, evenly thinned
    /// otherwise so the g labels never collide (web swaps `axisTick` ↔
    /// `axisTickSm` by width for the same reason).
    private var axisKeys: [String] {
        let keys = bars.map(\.plotKey)
        let limit = isWide ? 10 : 6
        guard keys.count > limit else { return keys }
        let step = Int(ceil(Double(keys.count) / Double(limit)))
        return keys.enumerated().filter { $0.offset.isMultiple(of: step) }.map(\.element)
    }

    private func tooltip(for bar: DrivingGForceBar) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(verbatim: "\(bar.rangeLabel) \(unit)")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: DrivingDynamicsFormat.number(bar.count, decimals: 0))
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
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
}
