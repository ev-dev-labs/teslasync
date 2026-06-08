//
//  MotorHistoryCharts.swift
//  TeslaSync — P4 feature view · 0172 · MotorHistoryCharts (Apple)
//
//  The composable "Motor History" driving-dynamics surface — the SwiftUI parity of
//  features/driving/components/driving-dynamics/MotorHistoryCharts.tsx. The web
//  renders a fragment of three `FadeIn`-wrapped `ChartContainer`s (power-over-time
//  area, torque-history line, rpm-history line); native reproduces that exact
//  composition with the same staggered fade delays (0.2 / 0.25 / 0.3) and switches
//  each card over the bound model's phase so every prompt-required state renders
//  (loading / empty / error / stale / offline / content) — never a blank box. Binds
//  through `MotorHistoryChartsModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable Motor-History charts surface — the SwiftUI parity of the web
/// `MotorHistoryCharts`, binding through `MotorHistoryChartsModel` (P1/S8).
public struct MotorHistoryCharts: View {
    @State private var model: MotorHistoryChartsModel

    public init(model: MotorHistoryChartsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if model.connection != .live {
                MotorHistoryChartsBanner(connection: model.connection)
            }
            TSFadeIn(delay: 0.2) { powerSection }
            TSFadeIn(delay: 0.25) { torqueSection }
            TSFadeIn(delay: 0.3) { rpmSection }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    // MARK: Sections (one per web `ChartContainer`)

    /// Motor Power Over Time — the web cyan/green `AreaChart` with an interactive
    /// power/regen legend (web `ChartLegend` + `useHiddenSeries`).
    private var powerSection: some View {
        MotorHistoryChartsSection(
            title: str("dynamics.powerOverTime", "Motor Power Over Time"),
            subtitle: str("dynamics.powerOverTimeDesc", "Drive and regen power from motor telemetry"),
            ariaLabel: str("dynamics.powerOverTime.aria", "Motor power and regen over time area chart"),
            phase: model.phase,
            connection: model.connection,
            onRetry: { model.refresh() },
            chart: {
                MotorPowerAreaChart(
                    points: model.points,
                    hidden: model.hiddenPowerSeries,
                    onToggle: { model.togglePowerSeries($0) }
                )
            }
        )
    }

    /// Motor Torque History — the web blue/purple front-vs-rear `LineChart`.
    private var torqueSection: some View {
        MotorHistoryChartsSection(
            title: str("dynamics.torqueHistory", "Motor Torque History"),
            subtitle: str("dynamics.torqueHistoryDesc", "Front and rear motor torque over time"),
            ariaLabel: str("dynamics.torqueHistory.aria", "Front and rear motor torque over time line chart"),
            phase: model.phase,
            connection: model.connection,
            onRetry: { model.refresh() },
            chart: {
                MotorDualLineChart(
                    points: model.points,
                    front: MotorLineSeries(
                        id: "torque-front",
                        name: str("dynamics.torqueFront", "Front Torque"),
                        color: Color.TS.chartSeriesSpeed,
                        key: \.torqueFront
                    ),
                    rear: MotorLineSeries(
                        id: "torque-rear",
                        name: str("dynamics.torqueRear", "Rear Torque"),
                        color: Color.TS.chartSeriesPower,
                        key: \.torqueRear
                    ),
                    unit: str("dynamics.motorHistory.torqueUnit", "Nm"),
                    fractionDigits: 0,
                    ariaKey: "dynamics.torqueHistory.aria",
                    ariaFallback: "Front and rear motor torque over time line chart",
                    titleKey: "dynamics.torqueHistory",
                    titleFallback: "Motor Torque History"
                )
            }
        )
    }

    /// Motor RPM History — the web cyan/purple front-vs-rear `LineChart`.
    private var rpmSection: some View {
        MotorHistoryChartsSection(
            title: str("dynamics.rpmHistory", "Motor RPM History"),
            subtitle: str("dynamics.rpmHistoryDesc", "Front and rear motor RPM over time"),
            ariaLabel: str("dynamics.rpmHistory.aria", "Front and rear motor RPM over time line chart"),
            phase: model.phase,
            connection: model.connection,
            onRetry: { model.refresh() },
            chart: {
                MotorDualLineChart(
                    points: model.points,
                    front: MotorLineSeries(
                        id: "rpm-front",
                        name: str("dynamics.rpmFront", "Front RPM"),
                        color: Color.TS.chartSeriesRegen,
                        key: \.rpmFront
                    ),
                    rear: MotorLineSeries(
                        id: "rpm-rear",
                        name: str("dynamics.rpmRear", "Rear RPM"),
                        color: Color.TS.chartSeriesPower,
                        key: \.rpmRear
                    ),
                    unit: str("dynamics.motorHistory.rpmUnit", "RPM"),
                    fractionDigits: 0,
                    ariaKey: "dynamics.rpmHistory.aria",
                    ariaFallback: "Front and rear motor RPM over time line chart",
                    titleKey: "dynamics.rpmHistory",
                    titleFallback: "Motor RPM History"
                )
            }
        )
    }

    private func str(_ key: String, _ fallback: String) -> String {
        MotorHistoryChartsStrings.string(key, fallback)
    }
}
