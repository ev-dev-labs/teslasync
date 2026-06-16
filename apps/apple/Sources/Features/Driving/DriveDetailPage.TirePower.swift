import SwiftUI

// MARK: - Speed histogram (web `SpeedHistogramChart`)

/// The speed-distribution histogram (web `SpeedHistogramChart`): the percentage of the drive
/// spent in each display-unit speed bucket.
struct DriveSpeedHistogramSection: View {
    let samples: [DriveTelemetrySample]
    @Environment(\.tsUnits) private var units

    var body: some View {
        DriveDetailPanel(title: "driveDetail.speedHistogram", systemImage: "chart.bar", tone: .accent) {
            let buckets = histogram
            if buckets.isEmpty {
                DriveDetailChartEmpty()
            } else {
                TSBarChart(series: [series(buckets)]).frame(height: 220)
            }
        }
    }

    private var histogram: [SpeedHistogramBucket] {
        let displaySpeeds = samples.compactMap { $0.speedMps.map { Units.convertSpeed($0, units) } }
        return DriveDetailDerivations.speedHistogram(displaySpeeds: displaySpeeds)
    }

    private func series(_ buckets: [SpeedHistogramBucket]) -> TSChartSeries {
        let points = buckets.enumerated().map { index, bucket in
            TSChartPoint(x: Double(index), y: bucket.pct, id: bucket.range)
        }
        return DriveChartBuilder.series("pct", "driveDetail.ofDrive", "% of drive", points, 5)
    }
}

// MARK: - Power profile (web `PowerProfileChart`)

/// The power profile area chart (web `PowerProfileChart`), with the max / regen / avg footer.
struct DrivePowerProfileSection: View {
    let samples: [DriveTelemetrySample]
    let stats: DriveStats

    var body: some View {
        DriveDetailPanel(title: "driveDetail.powerProfile", systemImage: "bolt.fill", tone: .warning) {
            if let series = powerSeries {
                TSAreaChart(series: [series]).frame(height: 200)
                HStack(spacing: TSSpacing.lg) {
                    footer(
                        "driveDetail.maxPower",
                        "\(DriveDetailFormat.number(stats.powerMaxW / 1000, decimals: 0)) kW",
                        .warning
                    )
                    footer(
                        "driveDetail.maxRegen",
                        "\(DriveDetailFormat.number(stats.powerMinW / 1000, decimals: 0)) kW",
                        .accent
                    )
                    footer(
                        "driveDetail.avgLabel",
                        "\(DriveDetailFormat.number(stats.avgPowerW / 1000, decimals: 1)) kW",
                        .neutral
                    )
                }
            } else {
                DriveDetailChartEmpty()
            }
        }
    }

    private var powerSeries: TSChartSeries? {
        let points = DriveChartBuilder.points(samples) { $0.powerW.map { $0 / 1000 } }
        guard points.count > 1 else { return nil }
        return DriveChartBuilder.series("power", "driveDetail.power", "Power", points, 4)
    }

    private func footer(_ label: LocalizedStringKey, _ value: String, _ tone: TSTone) -> some View {
        HStack(spacing: TSSpacing.xs) {
            TSMetricLabel(label)
            Text(verbatim: value).font(Font.TS.caption).fontWeight(.semibold).foregroundStyle(tone.color)
        }
    }
}

// MARK: - Tire pressure (web `TirePressureSection`)

/// The per-wheel tire-pressure lines over the timeline (web `TirePressureSection`), prefixed by
/// the per-wheel min–max tiles. Empty when the drive recorded no tire pressure.
struct DriveTirePressureSection: View {
    let samples: [DriveTelemetrySample]
    let stats: DriveStats
    @Environment(\.tsUnits) private var units

    private let tileColumns = [GridItem(.adaptive(minimum: 110), spacing: TSSpacing.sm)]

    var body: some View {
        DriveDetailPanel(title: "driveDetail.tirePressure", systemImage: "car.side", tone: .accent) {
            if stats.hasTirePressure {
                LazyVGrid(columns: tileColumns, spacing: TSSpacing.sm) {
                    wheelTile("driveDetail.frontLeft", \.tireFlKpa)
                    wheelTile("driveDetail.frontRight", \.tireFrKpa)
                    wheelTile("driveDetail.rearLeft", \.tireRlKpa)
                    wheelTile("driveDetail.rearRight", \.tireRrKpa)
                }
                DriveChartLegend(series: series)
                TSLineChart(series: series).frame(height: 220)
            } else {
                DriveDetailChartEmpty()
            }
        }
    }

    private var series: [TSChartSeries] {
        var result: [TSChartSeries] = []
        if samples.contains(where: { $0.tireFlKpa != nil }) {
            result.append(DriveChartBuilder.series("fl", "driveDetail.frontLeft", "FL", pressurePoints(\.tireFlKpa), 1))
        }
        if samples.contains(where: { $0.tireFrKpa != nil }) {
            result.append(DriveChartBuilder.series(
                "fr",
                "driveDetail.frontRight",
                "FR",
                pressurePoints(\.tireFrKpa),
                2
            ))
        }
        if samples.contains(where: { $0.tireRlKpa != nil }) {
            result.append(DriveChartBuilder.series("rl", "driveDetail.rearLeft", "RL", pressurePoints(\.tireRlKpa), 4))
        }
        if samples.contains(where: { $0.tireRrKpa != nil }) {
            result.append(DriveChartBuilder.series("rr", "driveDetail.rearRight", "RR", pressurePoints(\.tireRrKpa), 3))
        }
        return result
    }

    private func pressurePoints(_ keyPath: KeyPath<DriveTelemetrySample, Double?>) -> [TSChartPoint] {
        DriveChartBuilder
            .points(samples) { sample in sample[keyPath: keyPath].map { Units.convertPressure($0, units) } }
    }

    private func wheelTile(
        _ label: LocalizedStringKey,
        _ keyPath: KeyPath<DriveTelemetrySample, Double?>
    ) -> some View {
        let values = samples.compactMap { $0[keyPath: keyPath] }.filter { $0 > 0 }
        let text: String
        if let low = values.min(), let high = values.max() {
            let lowText = DriveDetailFormat.number(Units.convertPressure(low, units), decimals: 0)
            let highText = DriveDetailFormat.number(Units.convertPressure(high, units), decimals: 0)
            text = "\(lowText)–\(highText) \(units.pressure)"
        } else {
            text = DriveDetailFormat.emptyValue
        }
        return DriveMetricTile(label: label, value: text, tone: .accent)
    }
}
