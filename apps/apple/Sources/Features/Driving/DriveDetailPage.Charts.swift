import SwiftUI

// The Driving detail time-series charts (web `DriveOverviewChart`, `SocChart`, `ElevationChart`,
// `TemperatureSection`, `SpeedHistogramChart`, `PowerProfileChart`). All render through the P3
// Swift Charts wrappers (`TSLineChart` / `TSAreaChart` / `TSBarChart` / `TSComposedChart`) —
// never a web view — with values converted at the render boundary through `Units`. Each chart
// resolves its own empty vs. success from the samples it filters, exactly as the web page does,
// and carries a localized legend so each series stays identifiable without a recharts tooltip.

// MARK: - Shared helpers

/// Builds time-axis chart points (x = minutes since the first sample) for a sample value,
/// dropping samples whose value is absent.
enum DriveChartBuilder {
    static func points(
        _ samples: [DriveTelemetrySample],
        _ value: (DriveTelemetrySample) -> Double?
    ) -> [TSChartPoint] {
        guard let start = samples.first?.createdAt else { return [] }
        return samples.compactMap { sample in
            guard let measured = value(sample) else { return nil }
            return TSChartPoint(x: sample.createdAt.timeIntervalSince(start) / 60, y: measured)
        }
    }

    static func series(
        _ id: String,
        _ name: LocalizedStringKey,
        _ text: String,
        _ points: [TSChartPoint],
        _ color: Int
    ) -> TSChartSeries {
        TSChartSeries(id: id, name: name, nameText: text, points: points, colorIndex: color)
    }
}

/// A compact coloured-dot legend naming each chart series (web chart legend / tooltip labels).
struct DriveChartLegend: View {
    let series: [TSChartSeries]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TSSpacing.md) {
                ForEach(series) { item in
                    HStack(spacing: TSSpacing.xs) {
                        Circle().fill(item.color).frame(width: 8, height: 8)
                        Text(item.name).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
                    }
                }
            }
        }
        .accessibilityHidden(true)
    }
}

/// Shared empty chart state (web per-chart "No telemetry data available").
struct DriveDetailChartEmpty: View {
    var message: LocalizedStringKey = "driveDetail.noChartData"

    var body: some View {
        TSEmptyState(title: message, systemImage: "chart.xyaxis.line")
            .frame(maxWidth: .infinity, minHeight: 180)
    }
}

// MARK: - Overview (web `DriveOverviewChart` — speed · SoC · power over time)

/// The drive overview chart: speed, state-of-charge, and power over the drive timeline (web's
/// composed multi-axis trace), with a colour legend and a mean/max/min summary row.
struct DriveOverviewChartSection: View {
    let samples: [DriveTelemetrySample]
    @Environment(\.tsUnits) private var units

    var body: some View {
        DriveDetailPanel(title: "driveDetail.driveChart", systemImage: "waveform.path.ecg.rectangle") {
            if samples.count > 1 {
                DriveChartLegend(series: series)
                TSLineChart(series: series).frame(height: 300)
                summaryRow
            } else {
                DriveDetailChartEmpty()
            }
        }
    }

    private var series: [TSChartSeries] {
        let speed = DriveChartBuilder.points(samples) { $0.speedMps.map { Units.convertSpeed($0, units) } }
        let soc = DriveChartBuilder
            .points(samples) { sample in (sample.socPct ?? sample.batteryPct).flatMap { $0 > 0 ? $0 : nil } }
        let power = DriveChartBuilder.points(samples) { $0.powerW.map { $0 / 1000 } }
        return [
            DriveChartBuilder.series("speed", "driveDetail.speed", "Speed", speed, 5),
            DriveChartBuilder.series("soc", "driveDetail.soc", "SOC", soc, 2),
            DriveChartBuilder.series("power", "driveDetail.power", "Power", power, 4)
        ]
    }

    private var summaryRow: some View {
        HStack(spacing: TSSpacing.lg) {
            ForEach(series) { item in
                if !item.points.isEmpty {
                    Text(verbatim: TSChartFormat.summary(for: item))
                        .font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
                }
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - SoC over time (web `SocChart`)

/// The state-of-charge area chart over the drive timeline (web `SocChart`).
struct DriveSocChartSection: View {
    let samples: [DriveTelemetrySample]

    var body: some View {
        DriveDetailPanel(title: "driveDetail.socOverTime", systemImage: "battery.50percent", tone: .success) {
            if let series = socSeries {
                TSAreaChart(series: [series]).frame(height: 200)
            } else {
                DriveDetailChartEmpty()
            }
        }
    }

    private var socSeries: TSChartSeries? {
        let points = DriveChartBuilder.points(samples) { $0.batteryPct }
        guard points.count > 1 else { return nil }
        return DriveChartBuilder.series("soc", "driveDetail.soc", "SOC", points, 2)
    }
}

// MARK: - Elevation (web `ElevationChart` — elevation + speed)

/// The elevation profile with the speed overlay (web `ElevationChart`), prefixed by the
/// gain / loss / net summary.
struct DriveElevationChartSection: View {
    let samples: [DriveTelemetrySample]
    let stats: DriveStats
    @Environment(\.tsUnits) private var units

    var body: some View {
        DriveDetailPanel(title: "driveDetail.elevProfile", systemImage: "mountain.2", tone: .success) {
            if samples.count > 1 {
                HStack(spacing: TSSpacing.md) {
                    Text(verbatim: "↑ \(DriveDetailFormat.number(stats.elevGainM, decimals: 0)) m")
                        .font(Font.TS.caption).foregroundStyle(Color.TS.statusSuccess)
                    Text(verbatim: "↓ \(DriveDetailFormat.number(stats.elevLossM, decimals: 0)) m")
                        .font(Font.TS.caption).foregroundStyle(Color.TS.statusDanger)
                    Text("driveDetail.net")
                        .font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
                    Text(verbatim: "\(DriveDetailFormat.number(stats.elevGainM - stats.elevLossM, decimals: 0)) m")
                        .font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
                }
                DriveChartLegend(series: series)
                TSComposedChart(bars: elevationBars, line: speedLine).frame(height: 220)
            } else {
                DriveDetailChartEmpty()
            }
        }
    }

    private var elevationPoints: [TSChartPoint] {
        DriveChartBuilder.points(samples) { $0.elevationM }
    }

    private var speedPoints: [TSChartPoint] {
        DriveChartBuilder.points(samples) { $0.speedMps.map { Units.convertSpeed($0, units) } }
    }

    private var elevationBars: TSChartSeries {
        DriveChartBuilder.series("elevation", "driveDetail.elevation", "Elevation", elevationPoints, 2)
    }

    private var speedLine: TSChartSeries {
        DriveChartBuilder.series("speed", "driveDetail.speed", "Speed", speedPoints, 5)
    }

    private var series: [TSChartSeries] {
        [elevationBars, speedLine]
    }
}

// MARK: - Temperature (web `TemperatureSection`)

/// The temperature lines (outside / inside / driver / passenger) over the timeline, prefixed by
/// the average-temp tiles (web `TemperatureSection`). Empty when the drive recorded no temps.
struct DriveTemperatureChartSection: View {
    let samples: [DriveTelemetrySample]
    let stats: DriveStats
    @Environment(\.tsUnits) private var units

    private let tileColumns = [GridItem(.adaptive(minimum: 110), spacing: TSSpacing.sm)]

    var body: some View {
        DriveDetailPanel(title: "driveDetail.temperatures", systemImage: "thermometer.medium", tone: .info) {
            if samples.count > 1, stats.hasAnyTemp {
                LazyVGrid(columns: tileColumns, spacing: TSSpacing.sm) {
                    if let outside = stats.avgOutsideTempC {
                        DriveMetricTile(
                            label: "driveDetail.outsideTemp",
                            value: Units.formatTemperature(outside, units),
                            tone: .info
                        )
                    }
                    if let inside = stats.avgInsideTempC {
                        DriveMetricTile(
                            label: "driveDetail.insideTemp",
                            value: Units.formatTemperature(inside, units),
                            tone: .warning
                        )
                    }
                    if let driver = stats.avgDriverTempC {
                        DriveMetricTile(
                            label: "driveDetail.driverTemp",
                            value: Units.formatTemperature(driver, units),
                            tone: .danger
                        )
                    }
                    if let passenger = stats.avgPassengerTempC {
                        DriveMetricTile(
                            label: "driveDetail.passengerTemp",
                            value: Units.formatTemperature(passenger, units),
                            tone: .accent
                        )
                    }
                    if let climate = stats.climateStatus {
                        DriveMetricTile(
                            label: "driveDetail.climate",
                            value: climateText(climate),
                            tone: climate.isOn ? .success : .neutral
                        )
                    }
                }
                DriveChartLegend(series: series)
                TSLineChart(series: series).frame(height: 220)
            } else {
                DriveDetailChartEmpty(message: "driveDetail.noTemperatureData")
            }
        }
    }

    private var series: [TSChartSeries] {
        var result: [TSChartSeries] = []
        if stats.outsideTempCount > 0 {
            result.append(DriveChartBuilder.series(
                "outside",
                "driveDetail.outside",
                "Outside",
                tempPoints { $0.outsideTempC },
                1
            ))
        }
        if stats.insideTempCount > 0 {
            result.append(DriveChartBuilder.series(
                "inside",
                "driveDetail.inside",
                "Inside",
                tempPoints { $0.insideTempC },
                4
            ))
        }
        if stats.driverTempCount > 0 {
            result.append(DriveChartBuilder.series(
                "driver",
                "driveDetail.driver",
                "Driver",
                tempPoints { $0.driverTempC },
                3
            ))
        }
        if stats.passengerTempCount > 0 {
            result.append(DriveChartBuilder.series(
                "passenger",
                "driveDetail.passenger",
                "Passenger",
                tempPoints { $0.passengerTempC },
                0
            ))
        }
        return result
    }

    private func tempPoints(_ value: @escaping (DriveTelemetrySample) -> Double?) -> [TSChartPoint] {
        DriveChartBuilder.points(samples) { sample in value(sample).map { Units.convertTemperature($0, units) } }
    }

    private func climateText(_ status: DriveClimateStatus) -> String {
        switch status {
        case .on: String(localized: "driveDetail.climateOn")
        case .mostlyOff: String(localized: "driveDetail.climateMostlyOff")
        case .off: String(localized: "driveDetail.climateOff")
        }
    }
}
