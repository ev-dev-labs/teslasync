//
//  SpeedProfilePage.Sections.swift
//  TeslaSync — P4 feature view · P7 · driving/SpeedProfile (Apple) — Panels
//
//  The five parity panels of the Speed Profile surface (web GlassPanel1, the
//  Speed-Distribution ChartContainer, the per-bucket GlassPanel cards, the
//  Efficiency-vs-Speed ChartContainer, and the GlassPanel5 insight banner). Each
//  formats from SI via `SpeedProfileFormat` at this display boundary; each renders
//  its own empty state (never a blank region), keeping every panel visible exactly
//  like the web body.
//

import SwiftUI

// MARK: - Hero gauges (web GlassPanel1 — Avg / Peak / Optimal RadialGauge)

/// The hero gauge panel (web GlassPanel1): three `RadialGauge`s for the average,
/// peak and optimal speed, each filled to `value / max` with the value + unit at the
/// centre. The gauge maxima mirror the web literals (200 km/h for avg/optimal,
/// 250 km/h for peak), converted to the user's unit.
struct SpeedProfileHeroSection: View {
    let summary: SpeedProfileSummary
    let units: UnitPreferences
    let isCompact: Bool

    /// Web `max={Math.round(toSpeedDisplay(55.56))}` (≈ 200 km/h) for avg + optimal.
    private static let cruiseMaxMps = 55.56
    /// Web `max={Math.round(toSpeedDisplay(69.44))}` (≈ 250 km/h) for peak.
    private static let peakMaxMps = 69.44

    private var gaugeSize: CGFloat {
        isCompact ? 96 : 120
    }

    private var unit: String {
        SpeedProfileFormat.speedUnit(units)
    }

    var body: some View {
        TSGlassPanel {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                SpeedProfileGauge(
                    value: SpeedProfileFormat.speedRounded(summary.avgSpeedMps, units),
                    maxValue: SpeedProfileFormat.speedRounded(Self.cruiseMaxMps, units),
                    label: "translation.speedProfile.avgSpeed",
                    unit: unit,
                    tint: Color.TS.chartSeriesRegen,
                    size: gaugeSize
                )
                SpeedProfileGauge(
                    value: SpeedProfileFormat.speedRounded(summary.peakSpeedMps, units),
                    maxValue: SpeedProfileFormat.speedRounded(Self.peakMaxMps, units),
                    label: "translation.speedProfile.peakSpeed",
                    unit: unit,
                    tint: Color.TS.chartSeriesTemperature,
                    size: gaugeSize
                )
                SpeedProfileGauge(
                    value: SpeedProfileFormat.speedRounded(summary.optimalSpeedMps, units),
                    maxValue: SpeedProfileFormat.speedRounded(Self.cruiseMaxMps, units),
                    label: "translation.speedProfile.optimalSpeed",
                    unit: unit,
                    tint: Color.TS.chartSeriesBattery,
                    size: gaugeSize
                )
            }
            .frame(maxWidth: .infinity)
        }
    }
}

// MARK: - Speed distribution (web Speed-Distribution ChartContainer + BarChart)

/// The speed-distribution panel (web `ChartContainer` + `BarChart`): the titled,
/// aria-labelled frame over the band-colored bar chart, with the `noData` empty
/// state when there are no buckets (never a blank region).
struct SpeedDistributionSection: View {
    let buckets: [SpeedProfileBucket]

    var body: some View {
        TSChartContainer("translation.speedProfile.distribution") {
            if buckets.isEmpty {
                TSEmptyState(title: "translation.speedProfile.noData", systemImage: "chart.bar")
                    .frame(maxWidth: .infinity, minHeight: 200)
            } else {
                SpeedDistributionChart(buckets: buckets)
            }
        }
    }
}

// MARK: - Speed bucket cards (web StaggerContainer — GlassPanel3 per bucket)

/// The per-bucket detail cards (web `StaggerContainer` of `GlassPanel`s): one card
/// per bucket with its band icon + label, the time-share %, the drive count, and —
/// when drives fall in that bucket — the mean speed + consumption. Renders the
/// `noData` empty state when there are no buckets.
struct SpeedBucketCardsSection: View {
    let buckets: [SpeedProfileBucket]
    let drives: [SpeedProfileDrive]
    let totalReadings: Int
    let units: UnitPreferences

    private var efficiencyByBucket: [String: SpeedBucketEfficiency] {
        SpeedProfileFormat.bucketEfficiency(drives: drives, buckets: buckets, units)
    }

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    var body: some View {
        Group {
            if buckets.isEmpty {
                TSGlassPanel {
                    TSEmptyState(title: "translation.speedProfile.noData", systemImage: "speedometer")
                        .frame(maxWidth: .infinity)
                }
            } else {
                LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
                    ForEach(buckets) { bucket in
                        SpeedBucketCard(
                            bucket: bucket,
                            share: share(for: bucket),
                            efficiency: efficiencyByBucket[bucket.label],
                            units: units
                        )
                    }
                }
            }
        }
    }

    /// Web `pct = totalReadings > 0 ? (readings / totalReadings) * 100 : 0`.
    private func share(for bucket: SpeedProfileBucket) -> Double {
        totalReadings > 0 ? Double(bucket.readings) / Double(totalReadings) * 100 : 0
    }
}

/// One speed-bucket card (web per-bucket `GlassPanel`).
struct SpeedBucketCard: View {
    let bucket: SpeedProfileBucket
    let share: Double
    let efficiency: SpeedBucketEfficiency?
    let units: UnitPreferences

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                header
                metricRow(
                    label: Text("translation.speedProfile.timeShare"),
                    value: Text(verbatim: SpeedProfileFormat.percent(share, units)),
                    valueColor: SpeedProfileFormat.bucketColor(bucket.label)
                )
                metricRow(
                    label: Text("translation.speedProfile.drives"),
                    value: Text(verbatim: "\(bucket.readings)"),
                    valueColor: Color.TS.chartSeriesRegen
                )
                if let efficiency {
                    metricRow(
                        label: Text("translation.speedProfile.avgSpeed"),
                        value: Text(verbatim: SpeedProfileFormat.speed(efficiency.avgSpeedMps, units)),
                        valueColor: Color.TS.textSecondary
                    )
                    metricRow(
                        label: Text(verbatim: SpeedProfileFormat.efficiencyUnit(units)),
                        value: Text(verbatim: SpeedProfileFormat.efficiency(efficiency.avgEfficiencyWhPerKm, units)),
                        valueColor: SpeedProfileFormat.efficiencyColor(efficiency.avgEfficiencyWhPerKm)
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: SpeedProfileFormat.bucketIconSystemName(bucket.label))
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(SpeedProfileFormat.bucketIconColor(bucket.label))
                .accessibilityHidden(true)
            Text(verbatim: bucket.label)
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
        }
    }

    private func metricRow(label: Text, value: Text, valueColor: Color) -> some View {
        HStack {
            label
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            value
                .font(Font.TS.bodySm)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(valueColor)
        }
    }
}

// MARK: - Efficiency vs speed (web Efficiency-vs-Speed ChartContainer + ScatterChart)

/// The efficiency-vs-speed panel (web `ChartContainer` + `ScatterChart`): the titled,
/// aria-labelled frame over the per-drive scatter cloud, the "Lower {unit} = better"
/// subtitle and the efficient/moderate/high-consumption legend. Shows the `noData`
/// empty state below four points (web `scatterData.length > 3` guard), keeping the
/// panel visible.
struct SpeedEfficiencySection: View {
    let samples: [SpeedScatterSample]
    let hasScatter: Bool
    let units: UnitPreferences

    var body: some View {
        TSChartContainer("translation.speedProfile.effVsSpeed") {
            if hasScatter {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    Text(verbatim: subtitle)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                    SpeedEfficiencyScatterChart(samples: samples, units: units)
                    legend
                }
            } else {
                TSEmptyState(title: "translation.speedProfile.noData", systemImage: "chart.dots.scatter")
                    .frame(maxWidth: .infinity, minHeight: 200)
            }
        }
    }

    /// Web subtitle `${t('lower')} ${efficiencyUnit} = ${t('better')}`.
    private var subtitle: String {
        let lower = String(localized: "translation.speedProfile.lower", defaultValue: "Lower")
        let better = String(localized: "translation.speedProfile.better", defaultValue: "better")
        return "\(lower) \(SpeedProfileFormat.efficiencyUnit(units)) = \(better)"
    }

    /// Web legend: Efficient (green) / Moderate (amber) / High consumption (red).
    private var legend: some View {
        HStack(spacing: TSSpacing.md) {
            Spacer(minLength: 0)
            legendItem(color: Color.TS.chartSeriesBattery, label: Text("translation.speedProfile.efficient"))
            legendItem(color: Color.TS.chartSeriesEnergy, label: Text("translation.speedProfile.moderate"))
            legendItem(color: Color.TS.chartSeriesTemperature, label: Text("translation.speedProfile.highConsumption"))
        }
        .accessibilityHidden(true)
    }

    private func legendItem(color: Color, label: Text) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            label
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }
}

// MARK: - Efficiency insight (web GlassPanel5 — bordered insight banner)

/// The efficiency-insight banner (web GlassPanel5): a left-accented panel with a bolt
/// glyph, the insight title and the optimal-speed sentence. The panel stays visible;
/// when there is no optimal speed (web hides it) it shows the `noData` message
/// inline, never a blank region.
struct SpeedInsightSection: View {
    let optimalSpeedMps: Double
    let hasInsight: Bool
    let units: UnitPreferences

    var body: some View {
        TSGlassPanel {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                Rectangle()
                    .fill(Color.TS.chartSeriesBattery)
                    .frame(width: 3)
                    .accessibilityHidden(true)
                Image(systemName: "bolt.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Color.TS.chartSeriesBattery)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    Text("translation.speedProfile.insightTitle")
                        .font(Font.TS.bodySm)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                    Text(verbatim: body(for: units))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }

    private func body(for units: UnitPreferences) -> String {
        guard hasInsight else {
            return String(
                localized: "translation.speedProfile.noData",
                defaultValue: "No speed profile data available yet"
            )
        }
        return SpeedProfileFormat.insightText(optimalSpeedMps: optimalSpeedMps, units)
    }
}
