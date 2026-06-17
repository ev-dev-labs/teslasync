import SwiftUI

// Drivetrain Health charts (web sections 7–10), built on the P3 native Swift Charts wrappers (never a
// WKWebView): the stator-temperature multi-line history (`StatorTempChart`), the motor-torque area
// history (`TorqueHistoryChart`), the outside-temperature trend line (`TemperatureTrendChart`), and the
// per-drive power-output area history (`PowerOutputChart`). Each frames its plot in a `TSChartContainer`
// with the web title/subtitle, an accessible summary, a copyable CSV (web `dataColumns`), and a
// not-enough-data empty overlay — so a thin data set surfaces an empty state, never a blank region.

// MARK: - Shared chart chrome

/// One static legend entry (web recharts `<Legend />` swatch + series name).
struct DrivetrainLegendItem: Identifiable {
    let id: String
    let nameKey: String
    let colorIndex: Int
}

/// A compact static legend for the multi-series charts (web `<Legend />`).
struct DrivetrainChartLegend: View {
    let items: [DrivetrainLegendItem]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TSSpacing.md) {
                ForEach(items) { item in
                    HStack(spacing: TSSpacing.xs) {
                        Circle()
                            .fill(TSChartPalette.color(at: item.colorIndex))
                            .frame(width: 8, height: 8)
                        Text(DrivetrainHealthPageStrings.key(item.nameKey))
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textSecondary)
                            .lineLimit(1)
                    }
                }
            }
        }
        .accessibilityHidden(true)
    }
}

/// First/last tick captions beneath a numeric-x chart (the wrappers use a numeric x-axis, so the time /
/// date span is surfaced here, mirroring the web X-axis ticks).
struct DrivetrainAxisLabels: View {
    let labels: [String]

    var body: some View {
        if let first = labels.first, let last = labels.last {
            HStack {
                Text(verbatim: first)
                Spacer()
                Text(verbatim: last)
            }
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityHidden(true)
        }
    }
}

/// A dashed-swatch threshold row (web `ReferenceLine` with a label).
struct DrivetrainReferenceRow: View {
    let labelKey: String
    let value: String
    let tone: TSTone

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            RoundedRectangle(cornerRadius: 1, style: .continuous)
                .fill(tone.color)
                .frame(width: 16, height: 2)
            Text(DrivetrainHealthPageStrings.key(labelKey))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            TSCode(value)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Section 7 — Stator temperature history (web `StatorTempChart`)

/// A native multi-line chart of the front / rear / inverter stator temperatures over recent `/motor`
/// snapshots, with the converted 60 °C "Normal" and 80 °C "Warm" reference thresholds.
struct DrivetrainStatorTempChartSection: View {
    let points: [DrivetrainMotorChartPoint]
    let units: UnitPreferences

    private var isEmpty: Bool { points.count <= 1 }

    var body: some View {
        TSChartContainer(
            DrivetrainHealthPageStrings.key("drivetrain.statorTempHistory"),
            summary: DrivetrainHealthPageStrings.key("drivetrain.statorTempHistory.aria"),
            isEmpty: isEmpty,
            csv: csv
        ) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Text(DrivetrainHealthPageStrings.key("drivetrain.statorTempSub"))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                TSLineChart(series: series, smooth: false)
                    .frame(height: 260)
                    .accessibilityLabel(Text(DrivetrainHealthPageStrings.key("drivetrain.statorTempHistory.aria")))
                DrivetrainChartLegend(items: legend)
                HStack(spacing: TSSpacing.lg) {
                    DrivetrainReferenceRow(labelKey: "drivetrain.normal", value: threshold(60), tone: .success)
                    DrivetrainReferenceRow(labelKey: "drivetrain.warm", value: threshold(80), tone: .warning)
                }
                DrivetrainAxisLabels(labels: points.map(\.time))
            }
        }
    }

    private var series: [TSChartSeries] {
        [
            lineSeries("stator", "drivetrain.statorTemp", "Stator", 5) { $0.stator },
            lineSeries("statorRel", "drivetrain.statorTempRearLeft", "Rear-Left", 6) { $0.statorRearLeft },
            lineSeries("statorRer", "drivetrain.statorTempRearRight", "Rear-Right", 4) { $0.statorRearRight }
        ]
    }

    private var legend: [DrivetrainLegendItem] {
        [
            DrivetrainLegendItem(id: "stator", nameKey: "drivetrain.statorTemp", colorIndex: 5),
            DrivetrainLegendItem(id: "statorRel", nameKey: "drivetrain.statorTempRearLeft", colorIndex: 6),
            DrivetrainLegendItem(id: "statorRer", nameKey: "drivetrain.statorTempRearRight", colorIndex: 4)
        ]
    }

    private func lineSeries(
        _ id: String, _ nameKey: String, _ text: String, _ color: Int,
        value: (DrivetrainMotorChartPoint) -> Double?
    ) -> TSChartSeries {
        let mapped = points.compactMap { point -> TSChartPoint? in
            guard let raw = value(point) else { return nil }
            return TSChartPoint(x: Double(point.index), y: raw, id: "\(id)-\(point.index)")
        }
        return TSChartSeries(
            id: id, name: DrivetrainHealthPageStrings.key(nameKey), nameText: text,
            points: mapped, colorIndex: color
        )
    }

    private func threshold(_ celsius: Double) -> String {
        DrivetrainHealthPageFormat.temperatureMax(celsius, units)
    }

    private var csv: String? {
        guard !isEmpty else { return nil }
        let unit = DrivetrainHealthPageFormat.temperatureUnit(units)
        let header = [
            DrivetrainHealthPageStrings.text("drivetrain.col.time", "Time"),
            "\(DrivetrainHealthPageStrings.text("drivetrain.col.stator", "Stator")) (\(unit))",
            "\(DrivetrainHealthPageStrings.text("drivetrain.col.statorRel", "Rear-Left")) (\(unit))",
            "\(DrivetrainHealthPageStrings.text("drivetrain.col.statorRer", "Rear-Right")) (\(unit))"
        ].joined(separator: ",")
        let rows = points.map { point in
            [point.time, cell(point.stator), cell(point.statorRearLeft), cell(point.statorRearRight)]
                .joined(separator: ",")
        }
        return ([header] + rows).joined(separator: "\n")
    }

    private func cell(_ value: Double?) -> String {
        value.map { DrivetrainHealthPageFormat.number($0, decimals: 1) } ?? ""
    }
}

// MARK: - Section 8 — Motor torque history (web `TorqueHistoryChart`)

/// A native area chart of the drive-inverter torque output over recent `/motor` snapshots.
struct DrivetrainTorqueChartSection: View {
    let points: [DrivetrainMotorChartPoint]

    private var isEmpty: Bool {
        points.count <= 1 || !points.contains { $0.torque != nil }
    }

    var body: some View {
        TSChartContainer(
            DrivetrainHealthPageStrings.key("drivetrain.torqueHistory"),
            summary: DrivetrainHealthPageStrings.key("drivetrain.torqueHistory.aria"),
            isEmpty: isEmpty,
            csv: csv
        ) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Text(DrivetrainHealthPageStrings.key("drivetrain.torqueHistorySub"))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                TSAreaChart(series: series)
                    .frame(height: 260)
                    .accessibilityLabel(Text(DrivetrainHealthPageStrings.key("drivetrain.torqueHistory.aria")))
                DrivetrainAxisLabels(labels: points.map(\.time))
            }
        }
    }

    private var series: [TSChartSeries] {
        let mapped = points.compactMap { point -> TSChartPoint? in
            guard let torque = point.torque else { return nil }
            return TSChartPoint(x: Double(point.index), y: torque, id: "torque-\(point.index)")
        }
        return [TSChartSeries(
            id: "torque", name: DrivetrainHealthPageStrings.key("drivetrain.torque"), nameText: "Torque",
            points: mapped, colorIndex: 3
        )]
    }

    private var csv: String? {
        guard !isEmpty else { return nil }
        let header = [
            DrivetrainHealthPageStrings.text("drivetrain.col.time", "Time"),
            DrivetrainHealthPageStrings.text("drivetrain.col.torque", "Torque (Nm)")
        ].joined(separator: ",")
        let rows = points.map { point in
            let torque = point.torque.map { DrivetrainHealthPageFormat.number($0, decimals: 1) } ?? ""
            return "\(point.time),\(torque)"
        }
        return ([header] + rows).joined(separator: "\n")
    }
}

// MARK: - Section 9 — Outside temperature trend (web `TemperatureTrendChart`)

/// A native line chart of the outside temperature recorded across recent drives, with the converted
/// 35 °C "Warm Zone" and 0 °C "Freezing" reference thresholds.
struct DrivetrainTemperatureTrendChartSection: View {
    let points: [DrivetrainDriveChartPoint]
    let units: UnitPreferences

    private var isEmpty: Bool { points.count <= 1 }

    var body: some View {
        TSChartContainer(
            DrivetrainHealthPageStrings.key("drivetrain.tempHistory"),
            summary: DrivetrainHealthPageStrings.key("drivetrain.tempHistory.aria"),
            isEmpty: isEmpty,
            csv: csv
        ) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Text(DrivetrainHealthPageStrings.key("drivetrain.tempHistorySub"))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                TSLineChart(series: series, smooth: false)
                    .frame(height: 260)
                    .accessibilityLabel(Text(DrivetrainHealthPageStrings.key("drivetrain.tempHistory.aria")))
                HStack(spacing: TSSpacing.lg) {
                    DrivetrainReferenceRow(labelKey: "drivetrain.warmZone", value: threshold(35), tone: .warning)
                    DrivetrainReferenceRow(labelKey: "drivetrain.freezing", value: threshold(0), tone: .info)
                }
                DrivetrainAxisLabels(labels: points.map(\.date))
            }
        }
    }

    private var series: [TSChartSeries] {
        let mapped = points.compactMap { point -> TSChartPoint? in
            guard let temp = point.outsideTemp else { return nil }
            return TSChartPoint(x: Double(point.index), y: temp, id: "temp-\(point.index)")
        }
        return [TSChartSeries(
            id: "outsideTemp", name: DrivetrainHealthPageStrings.key("drivetrain.outsideTemp"),
            nameText: "Outside", points: mapped, colorIndex: 4
        )]
    }

    private func threshold(_ celsius: Double) -> String {
        DrivetrainHealthPageFormat.temperatureMax(celsius, units)
    }

    private var csv: String? {
        guard !isEmpty else { return nil }
        let unit = DrivetrainHealthPageFormat.temperatureUnit(units)
        let header = [
            DrivetrainHealthPageStrings.text("drivetrain.col.date", "Date"),
            "\(DrivetrainHealthPageStrings.text("drivetrain.col.outside", "Outside")) (\(unit))"
        ].joined(separator: ",")
        let rows = points.map { point in
            let temp = point.outsideTemp.map { DrivetrainHealthPageFormat.number($0, decimals: 1) } ?? ""
            return "\(point.date),\(temp)"
        }
        return ([header] + rows).joined(separator: "\n")
    }
}

// MARK: - Section 10 — Power output history (web `PowerOutputChart`)

/// A native area chart of per-drive peak and regen motor power (kW) over the filtered date range.
struct DrivetrainPowerOutputChartSection: View {
    let points: [DrivetrainDriveChartPoint]

    private var isEmpty: Bool { points.count <= 1 }

    var body: some View {
        TSChartContainer(
            DrivetrainHealthPageStrings.key("drivetrain.powerOutput"),
            summary: DrivetrainHealthPageStrings.key("drivetrain.powerOutput.aria"),
            isEmpty: isEmpty,
            csv: csv
        ) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Text(DrivetrainHealthPageStrings.key("drivetrain.powerOutputSub"))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                TSAreaChart(series: series)
                    .frame(height: 260)
                    .accessibilityLabel(Text(DrivetrainHealthPageStrings.key("drivetrain.powerOutput.aria")))
                DrivetrainChartLegend(items: legend)
                DrivetrainAxisLabels(labels: points.map(\.date))
            }
        }
    }

    private var series: [TSChartSeries] {
        [
            TSChartSeries(
                id: "powerMax",
                name: DrivetrainHealthPageStrings.key("drivetrain.powerMax"),
                nameText: "Peak Power (kW)",
                points: points.map { TSChartPoint(x: Double($0.index), y: $0.powerMaxKw, id: "max-\($0.index)") },
                colorIndex: 5
            ),
            TSChartSeries(
                id: "powerMin",
                name: DrivetrainHealthPageStrings.key("drivetrain.powerMin"),
                nameText: "Regen Power (kW)",
                points: points.map { TSChartPoint(x: Double($0.index), y: $0.powerMinKw, id: "min-\($0.index)") },
                colorIndex: 0
            )
        ]
    }

    private var legend: [DrivetrainLegendItem] {
        [
            DrivetrainLegendItem(id: "powerMax", nameKey: "drivetrain.powerMax", colorIndex: 5),
            DrivetrainLegendItem(id: "powerMin", nameKey: "drivetrain.powerMin", colorIndex: 0)
        ]
    }

    private var csv: String? {
        guard !isEmpty else { return nil }
        let header = [
            DrivetrainHealthPageStrings.text("drivetrain.col.date", "Date"),
            DrivetrainHealthPageStrings.text("drivetrain.col.powerMax", "Peak (kW)"),
            DrivetrainHealthPageStrings.text("drivetrain.col.powerMin", "Regen (kW)")
        ].joined(separator: ",")
        let rows = points.map { point in
            let peak = DrivetrainHealthPageFormat.number(point.powerMaxKw, decimals: 1)
            let regen = DrivetrainHealthPageFormat.number(point.powerMinKw, decimals: 1)
            return "\(point.date),\(peak),\(regen)"
        }
        return ([header] + rows).joined(separator: "\n")
    }
}
