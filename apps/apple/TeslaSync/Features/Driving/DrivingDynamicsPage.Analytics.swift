//
//  DrivingDynamicsPage.Analytics.swift
//  TeslaSync — P4-APPLE P7 · page:driving/DrivingDynamics (Apple) — Drive analytics + tips
//
//  The drive-analytics section (web `DriveAnalyticsSection`): the date-range
//  control, the speed-distribution bars, the acceleration-pattern scatter, and the
//  recent-drives power profile — plus the driving-style recommendations (web
//  `DrivingTips`). Charts use the P3 Swift Charts wrappers; the categorical
//  speed distribution renders as native labeled bars. SI drive metrics convert to
//  the user's units at the render boundary.
//

import SwiftUI

// MARK: - Drive analytics (web `DriveAnalyticsSection`)

struct DDynAnalyticsSection: View {
    let model: DrivingDynamicsPageModel
    @Environment(\.tsUnits) private var units

    /// A speed-distribution bucket's SI bounds + label (web `SPEED_BUCKETS_RANGES`).
    private struct SpeedBucketBound {
        let lower: Double
        let upper: Double
        let label: String
    }

    /// Bucket lower bounds in SI m/s (web `SPEED_BUCKETS_RANGES`, compared in SI).
    private static let bucketBounds: [SpeedBucketBound] = [
        SpeedBucketBound(lower: 0, upper: 30, label: "0–30"),
        SpeedBucketBound(lower: 30, upper: 60, label: "30–60"),
        SpeedBucketBound(lower: 60, upper: 90, label: "60–90"),
        SpeedBucketBound(lower: 90, upper: 120, label: "90–120"),
        SpeedBucketBound(lower: 120, upper: .infinity, label: "120+")
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            TSFadeIn(delay: 0.45) {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    DrivingSectionTitle(DDynStrings.text("dynamics.driveAnalytics", "Drive Analytics"))
                    rangeControl
                }
            }
            TSFadeIn(delay: 0.50) { speedDistributionPanel }
            TSFadeIn(delay: 0.52) { accelerationPanel }
            TSFadeIn(delay: 0.55) { powerProfilePanel }
        }
    }

    // MARK: Date range (web `RangePicker`)

    private var rangeControl: some View {
        HStack(spacing: TSSpacing.md) {
            DatePicker(
                selection: startBinding,
                displayedComponents: .date
            ) { Text(verbatim: DDynStrings.text("dynamics.col.range", "Range")) }
                .labelsHidden()
            Text(verbatim: "—").foregroundStyle(Color.TS.textMuted)
            DatePicker(
                selection: endBinding,
                displayedComponents: .date
            ) { Text(verbatim: DDynStrings.text("dynamics.col.range", "Range")) }
                .labelsHidden()
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .contain)
    }

    private var startBinding: Binding<Date> {
        Binding(
            get: { model.startDate },
            set: { model.setDateRange(start: $0, end: model.endDate) }
        )
    }

    private var endBinding: Binding<Date> {
        Binding(
            get: { model.endDate },
            set: { model.setDateRange(start: model.startDate, end: $0) }
        )
    }

    // MARK: Speed distribution (web bar chart → native labeled bars)

    private var speedDistributionPanel: some View {
        TSChartContainer(
            DDynStrings.key("dynamics.speedDistribution"),
            summary: DDynStrings.key("dynamics.speedDistDesc"),
            isEmpty: model.filteredDrives.isEmpty
        ) {
            VStack(spacing: TSSpacing.sm) {
                ForEach(speedBuckets) { bucket in
                    DDynLabeledBar(
                        label: bucket.label,
                        value: Double(bucket.count),
                        maxValue: Double(maxBucketCount),
                        valueText: "\(bucket.count)"
                    )
                }
            }
        }
    }

    private var speedBuckets: [DDynBucket] {
        Self.bucketBounds.enumerated().map { index, bound in
            let count = model.filteredDrives.count { drive in
                guard let speed = drive.avgSpeedMps else { return false }
                return speed >= bound.lower && speed < bound.upper
            }
            return DDynBucket(id: index, label: "\(bound.label) \(units.speed)", count: count)
        }
    }

    private var maxBucketCount: Int {
        max(speedBuckets.map(\.count).max() ?? 1, 1)
    }

    // MARK: Acceleration patterns (web scatter)

    private var accelerationPanel: some View {
        TSChartContainer(
            DDynStrings.key("dynamics.accelPatterns"),
            summary: DDynStrings.key("dynamics.accelPatternsDesc"),
            isEmpty: accelPoints.isEmpty
        ) {
            TSScatterChart(series: [
                TSChartSeries(
                    id: "accel",
                    name: DDynStrings.key("dynamics.drives"),
                    nameText: DDynStrings.text("dynamics.drives", "Drives"),
                    points: accelPoints,
                    colorIndex: 6
                )
            ])
            .frame(height: 240)
        }
    }

    private var accelPoints: [TSChartPoint] {
        model.filteredDrives.compactMap { drive in
            guard let power = drive.avgPowerW else { return nil }
            let distance = (Units.convertDistance(drive.distanceM, units)).rounded()
            return TSChartPoint(x: distance, y: power / 1000, id: "\(drive.id)")
        }
    }

    // MARK: Power profile (web area chart)

    private var powerProfilePanel: some View {
        TSChartContainer(
            DDynStrings.key("dynamics.powerProfile"),
            summary: DDynStrings.key("dynamics.powerProfileDesc"),
            isEmpty: powerPoints.isEmpty
        ) {
            VStack(spacing: TSSpacing.sm) {
                TSAreaChart(series: [
                    TSChartSeries(
                        id: "powerMax",
                        name: DDynStrings.key("dynamics.maxPower"),
                        nameText: DDynStrings.text("dynamics.maxPower", "Max Power (kW)"),
                        points: powerPoints,
                        colorIndex: 0
                    )
                ])
                .frame(height: 240)
                DDynChartLegend(items: [
                    DDynChartLegend.Item(
                        text: DDynStrings.text("dynamics.maxPower", "Max Power (kW)"),
                        colorIndex: 0
                    )
                ])
            }
        }
    }

    private var powerPoints: [TSChartPoint] {
        model.filteredDrives.suffix(20).enumerated().map { index, drive in
            TSChartPoint(x: Double(index + 1), y: (drive.avgPowerW ?? 0) / 1000, id: "\(drive.id)")
        }
    }
}

/// One speed-distribution bucket count (web bar datum).
struct DDynBucket: Identifiable {
    let id: Int
    let label: String
    let count: Int
}

/// A native labeled proportional bar (categorical distribution row).
struct DDynLabeledBar: View {
    let label: String
    let value: Double
    let maxValue: Double
    let valueText: String

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .frame(width: 96, alignment: .leading)
            TSMetricBar(fraction: maxValue > 0 ? value / maxValue : 0, tone: .accent)
            Text(verbatim: valueText)
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .frame(width: 32, alignment: .trailing)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Driving tips (web `DrivingTips`)

struct DDynTipsSection: View {
    let stats: MotorStats?
    let throttleStyle: ThrottleStyle?

    private var tips: [(key: String, fallback: String)] {
        DDynFormat.tips(for: stats)
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                DrivingPanelHeading(
                    text: DDynStrings.text("dynamics.recommendations", "Driving Style Recommendations"),
                    systemImage: "lightbulb.fill",
                    tone: .warning
                )
                ForEach(tips, id: \.key) { tip in
                    tipRow(DDynStrings.text(tip.key, tip.fallback))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func tipRow(_ text: String) -> some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: tipIcon)
                .font(.system(size: 14))
                .foregroundStyle(throttleStyle == .conservative ? Color.TS.statusSuccess : Color.TS.statusWarning)
                .accessibilityHidden(true)
            Text(verbatim: text)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.md)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var tipIcon: String {
        throttleStyle == .conservative ? "checkmark.shield.fill" : "exclamationmark.triangle.fill"
    }
}
