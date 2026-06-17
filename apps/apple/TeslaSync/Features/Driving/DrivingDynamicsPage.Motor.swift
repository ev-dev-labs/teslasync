//
//  DrivingDynamicsPage.Motor.swift
//  TeslaSync — P4-APPLE P7 · page:driving/DrivingDynamics (Apple) — Motor history + insights
//
//  The motor-telemetry analytics sections: the power/torque/rpm history charts
//  (web `MotorHistoryCharts`) drawn with the P3 native Swift Charts wrappers, the
//  three motor-efficiency insight panels (web `MotorEfficiencyInsights`), and the
//  six summary stat cards (web `SummaryStats`). SI values convert at the render
//  boundary; each chart + panel renders its own empty state.
//

import SwiftUI

// MARK: - Motor history charts (web `MotorHistoryCharts`)

struct DDynMotorHistorySection: View {
    let history: [MotorSnapshot]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            TSFadeIn(delay: 0.20) { powerChart }
            TSFadeIn(delay: 0.25) { torqueChart }
            TSFadeIn(delay: 0.30) { rpmChart }
        }
    }

    private var powerChart: some View {
        TSChartContainer(
            DDynStrings.key("dynamics.powerOverTime"),
            summary: DDynStrings.key("dynamics.powerOverTimeDesc"),
            isEmpty: history.isEmpty
        ) {
            VStack(spacing: TSSpacing.sm) {
                TSAreaChart(series: [
                    series(id: "power", key: "dynamics.power", fallback: "Power", colorIndex: 4, value: \.powerKw),
                    series(id: "regen", key: "dynamics.regen", fallback: "Regen", colorIndex: 2, value: \.regenKw)
                ])
                .frame(height: 220)
                DDynChartLegend(items: [
                    DDynChartLegend.Item(text: DDynStrings.text("dynamics.power", "Power"), colorIndex: 4),
                    DDynChartLegend.Item(text: DDynStrings.text("dynamics.regen", "Regen"), colorIndex: 2)
                ])
            }
        }
    }

    private var torqueChart: some View {
        TSChartContainer(
            DDynStrings.key("dynamics.torqueHistory"),
            summary: DDynStrings.key("dynamics.torqueHistoryDesc"),
            isEmpty: history.isEmpty
        ) {
            VStack(spacing: TSSpacing.sm) {
                TSLineChart(series: [
                    series(id: "front", key: "dynamics.torqueFront", fallback: "Front Torque",
                           colorIndex: 0, value: \.torqueNmFront),
                    series(id: "rear", key: "dynamics.torqueRear", fallback: "Rear Torque",
                           colorIndex: 6, value: \.torqueNmRear)
                ])
                .frame(height: 220)
                DDynChartLegend(items: [
                    DDynChartLegend.Item(text: DDynStrings.text("dynamics.torqueFront", "Front Torque"), colorIndex: 0),
                    DDynChartLegend.Item(text: DDynStrings.text("dynamics.torqueRear", "Rear Torque"), colorIndex: 6)
                ])
            }
        }
    }

    private var rpmChart: some View {
        TSChartContainer(
            DDynStrings.key("dynamics.rpmHistory"),
            summary: DDynStrings.key("dynamics.rpmHistoryDesc"),
            isEmpty: history.isEmpty
        ) {
            VStack(spacing: TSSpacing.sm) {
                TSLineChart(series: [
                    series(id: "front", key: "dynamics.rpmFront", fallback: "Front RPM",
                           colorIndex: 4, value: \.motorRpmFront),
                    series(id: "rear", key: "dynamics.rpmRear", fallback: "Rear RPM",
                           colorIndex: 6, value: \.motorRpmRear)
                ])
                .frame(height: 220)
                DDynChartLegend(items: [
                    DDynChartLegend.Item(text: DDynStrings.text("dynamics.rpmFront", "Front RPM"), colorIndex: 4),
                    DDynChartLegend.Item(text: DDynStrings.text("dynamics.rpmRear", "Rear RPM"), colorIndex: 6)
                ])
            }
        }
    }

    /// Builds a numeric-indexed series from one motor field over the history window.
    private func series(
        id: String,
        key: String,
        fallback: String,
        colorIndex: Int,
        value: KeyPath<MotorSnapshot, Double?>
    ) -> TSChartSeries {
        let points = history.enumerated().compactMap { index, snapshot -> TSChartPoint? in
            guard let raw = snapshot[keyPath: value] else { return nil }
            return TSChartPoint(x: Double(index), y: raw, id: "\(id)-\(index)")
        }
        return TSChartSeries(
            id: id,
            name: DDynStrings.key(key),
            nameText: DDynStrings.text(key, fallback),
            points: points,
            colorIndex: colorIndex
        )
    }
}

/// Static color-keyed chart legend (web `Legend` / `ChartLegend`).
struct DDynChartLegend: View {
    struct Item: Identifiable {
        let text: String
        let colorIndex: Int
        var id: String { text }
    }

    let items: [Item]

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            ForEach(items) { item in
                HStack(spacing: TSSpacing.xs) {
                    Circle()
                        .fill(TSChartPalette.color(at: item.colorIndex))
                        .frame(width: 8, height: 8)
                    Text(verbatim: item.text)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .accessibilityHidden(true)
    }
}

// MARK: - Motor efficiency insights (web `MotorEfficiencyInsights`)

struct DDynMotorEfficiencySection: View {
    let stats: MotorStats?
    let throttleStyle: ThrottleStyle?
    @Environment(\.tsUnits) private var units

    private let columns = [GridItem(.adaptive(minimum: 240), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            torquePanel
            throttlePanel
            thermalPanel
        }
    }

    private var torquePanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                DrivingPanelHeading(
                    text: DDynStrings.text("dynamics.torqueDistribution", "Torque Distribution"),
                    systemImage: "bolt.fill",
                    tone: .info
                )
                if let stats {
                    DrivingMetricRow(
                        label: DDynStrings.text("dynamics.avgTorque", "Avg Torque"),
                        value: "\(DDynFormat.number(stats.avgTorque, fractionDigits: 1)) Nm"
                    )
                    DrivingMetricRow(
                        label: DDynStrings.text("dynamics.maxTorque", "Max Torque"),
                        value: "\(DDynFormat.number(stats.maxTorque, fractionDigits: 1)) Nm"
                    )
                    DrivingMetricRow(
                        label: DDynStrings.text("dynamics.highTorqueTime", "High Torque Time"),
                        value: DDynFormat.percent(stats.highTorquePct, fractionDigits: 1)
                    )
                } else {
                    noData
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var throttlePanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                DrivingPanelHeading(
                    text: DDynStrings.text("dynamics.throttleBehavior", "Throttle Behavior"),
                    systemImage: "gauge.with.dots.needle.bottom.50percent",
                    tone: .info
                )
                if let stats {
                    DrivingMetricRow(
                        label: DDynStrings.text("dynamics.avgPower", "Avg Power"),
                        value: "\(DDynFormat.number(stats.avgPower, fractionDigits: 1)) kW"
                    )
                    HStack {
                        Text(verbatim: DDynStrings.text("dynamics.drivingStyle", "Style"))
                            .font(Font.TS.bodySm)
                            .foregroundStyle(Color.TS.textSecondary)
                        Spacer()
                        TSBadge(styleKey, tone: styleTone)
                    }
                    TSMetricBar(fraction: min(stats.avgPower / 200, 1), tone: styleTone)
                } else {
                    noData
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var thermalPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                DrivingPanelHeading(
                    text: DDynStrings.text("dynamics.motorThermal", "Motor Thermal"),
                    systemImage: "thermometer.medium",
                    tone: .warning
                )
                if let stats {
                    DrivingMetricRow(
                        label: DDynStrings.text("dynamics.avgMotorTemp", "Avg Motor Temp"),
                        value: temp(stats.avgMotorTemp)
                    )
                    DrivingMetricRow(
                        label: DDynStrings.text("dynamics.maxMotorTemp", "Max Motor Temp"),
                        value: temp(stats.maxMotorTemp)
                    )
                    TSBadge(thermalKey(stats.maxMotorTemp), tone: thermalTone(stats.maxMotorTemp))
                } else {
                    noData
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var noData: some View {
        TSEmptyState(
            title: "common.noData",
            message: DDynStrings.key("dynamics.noMotorData"),
            systemImage: "bolt.slash"
        )
        .frame(maxWidth: .infinity)
    }

    private func temp(_ celsius: Double) -> String {
        "\(DDynFormat.number(Units.convertTemperature(celsius, units), fractionDigits: 1))\(units.temperature)"
    }

    private var styleKey: LocalizedStringKey {
        switch throttleStyle {
        case .conservative: DDynStrings.key("dynamics.conservative")
        case .moderate: DDynStrings.key("dynamics.moderate")
        case .aggressive, .none: DDynStrings.key("dynamics.aggressive")
        }
    }

    private var styleTone: TSTone {
        switch throttleStyle {
        case .conservative: .success
        case .moderate: .warning
        case .aggressive, .none: .danger
        }
    }

    private func thermalKey(_ maxTemp: Double) -> LocalizedStringKey {
        if maxTemp < 100 { return DDynStrings.key("dynamics.thermalGood") }
        if maxTemp < 140 { return DDynStrings.key("dynamics.thermalWarm") }
        return DDynStrings.key("dynamics.thermalHot")
    }

    private func thermalTone(_ maxTemp: Double) -> TSTone {
        if maxTemp < 100 { return .success }
        if maxTemp < 140 { return .warning }
        return .danger
    }
}

// MARK: - Summary stats (web `SummaryStats`)

struct DDynSummaryStatsSection: View {
    let stats: MotorStats?
    @Environment(\.tsUnits) private var units

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            TSStatCard(
                title: DDynStrings.key("dynamics.totalReadings"),
                value: "\(stats?.totalReadings ?? 0)",
                systemImage: "chart.bar.xaxis"
            )
            TSStatCard(
                title: DDynStrings.key("dynamics.avgTorque"),
                value: "\(DDynFormat.number(stats?.avgTorque ?? 0, fractionDigits: 1)) Nm",
                systemImage: "bolt.fill"
            )
            TSStatCard(
                title: DDynStrings.key("dynamics.peakPower"),
                value: "\(DDynFormat.number(stats?.peakPower ?? 0, fractionDigits: 1)) kW",
                systemImage: "arrow.up.right"
            )
            TSStatCard(
                title: DDynStrings.key("dynamics.peakRegen"),
                value: "\(DDynFormat.number(stats?.peakRegen ?? 0, fractionDigits: 1)) kW",
                systemImage: "arrow.down.right"
            )
            TSStatCard(
                title: DDynStrings.key("dynamics.avgPower"),
                value: "\(DDynFormat.number(stats?.avgPower ?? 0, fractionDigits: 1)) kW",
                systemImage: "gauge.with.dots.needle.bottom.50percent"
            )
            TSStatCard(
                title: DDynStrings.key("dynamics.avgMotorTemp"),
                value: stats.map { temp($0.avgMotorTemp) } ?? "—",
                systemImage: "thermometer.medium"
            )
        }
    }

    private func temp(_ celsius: Double) -> String {
        "\(DDynFormat.number(Units.convertTemperature(celsius, units), fractionDigits: 1))\(units.temperature)"
    }
}
