import SwiftUI

// The four Charging detail charts (web `ChargingDetailPage.tsx`): the charge-curve area
// chart and the three synced time series (SoC·energy·range, temperature, voltage·current).
// All render through the P3 Swift Charts wrappers (`TSAreaChart` / `TSLineChart`) — never a
// web view — with values converted at the render boundary through `Units`. Each chart
// resolves its own empty vs. success from the telemetry it filters, exactly as the web
// page does, and carries a localized legend so each series is identifiable.

// MARK: - Shared helpers

/// Builds time-axis chart points (x = minutes since the first reading) for a telemetry
/// value, dropping samples whose value is absent.
enum ChargingChartBuilder {
    static func points(
        _ telemetry: [ChargeTelemetryReading],
        _ value: (ChargeTelemetryReading) -> Double?
    ) -> [TSChartPoint] {
        guard let start = telemetry.first?.createdAt else { return [] }
        return telemetry.compactMap { reading in
            guard let measured = value(reading) else { return nil }
            return TSChartPoint(x: reading.createdAt.timeIntervalSince(start) / 60, y: measured)
        }
    }

    /// Concise `TSChartSeries` factory (keeps the multi-series arrays within the line limit).
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

/// A compact colored-dot legend naming each chart series (web chart legend / tooltip
/// labels), so the series stay identifiable without the recharts tooltip.
struct ChargingChartLegend: View {
    let series: [TSChartSeries]

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            ForEach(series) { item in
                HStack(spacing: TSSpacing.xs) {
                    Circle().fill(item.color).frame(width: 8, height: 8)
                    Text(item.name).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
                }
            }
        }
        .accessibilityHidden(true)
    }
}

/// Shared empty chart state (web per-chart `EmptyState`).
struct ChargingDetailChartEmpty: View {
    var body: some View {
        TSEmptyState(title: "common.noData", systemImage: "chart.xyaxis.line")
            .frame(maxWidth: .infinity, minHeight: 200)
    }
}

// MARK: - Charge curve (web GlassPanel17 — power vs SoC area chart)

/// The Charge-Curve panel: power vs SoC, from measured telemetry or the synthesized curve
/// (tagged "estimated"), with the taper/derating help affordance.
struct ChargingChargeCurveSection: View {
    let session: ChargingSessionDetail
    let telemetry: [ChargeTelemetryReading]

    private var isEstimated: Bool { telemetry.isEmpty }
    private var curve: [ChargeCurvePoint] {
        ChargingDetailDerivations.chargeCurve(session: session, telemetry: telemetry)
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                if curve.isEmpty {
                    ChargingDetailChartEmpty()
                } else {
                    TSAreaChart(series: [curveSeries]).frame(height: 260)
                }
            }
        }
    }

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            TSPanelTitle("charging.detail.chargeCurve")
            if isEstimated {
                Text("charging.detail.estimated")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: TSSpacing.xs)
            Image(systemName: "info.circle")
                .font(.caption)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityLabel(Text("help.charging.chargeCurve.aria"))
        }
    }

    private var curveSeries: TSChartSeries {
        let points = curve.map { TSChartPoint(x: $0.soc, y: $0.powerKw) }
        return TSChartSeries(
            id: "power",
            name: "charging.detail.power",
            nameText: "Power",
            points: points,
            colorIndex: 6
        )
    }
}

// MARK: - SoC / energy / range over time (web GlassPanel18 — composed time series)

/// The SoC·energy·range time-series panel: state-of-charge, energy added, and rated range
/// over the session timeline (web composed area + lines).
struct ChargingTimeSeriesSection: View {
    let telemetry: [ChargeTelemetryReading]
    @Environment(\.tsUnits) private var units

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("charging.detail.socOverTime")
                if telemetry.isEmpty {
                    ChargingDetailChartEmpty()
                } else {
                    ChargingChartLegend(series: series)
                    TSLineChart(series: series).frame(height: 300)
                }
            }
        }
    }

    private var series: [TSChartSeries] {
        let soc = ChargingChartBuilder.points(telemetry) { $0.batteryLevelPct }
        let energy = ChargingChartBuilder.points(telemetry) { $0.energyAddedWh.map { $0 / 1000 } }
        let range = ChargingChartBuilder.points(telemetry) { reading in
            reading.ratedRangeM.map { Units.convertDistance($0, units) }
        }
        return [
            ChargingChartBuilder.series("soc", "charging.detail.soc", "SoC", soc, 2),
            ChargingChartBuilder.series("energy", "charging.detail.energy", "Energy", energy, 4),
            ChargingChartBuilder.series("range", "charging.detail.range", "Range", range, 1)
        ]
    }
}

// MARK: - Temperature (web GlassPanel19 — composed time series)

/// The Temperature time-series panel: battery, inside, and outside temperature over the
/// session timeline, converted to the user's unit.
struct ChargingTemperatureSection: View {
    let telemetry: [ChargeTelemetryReading]
    @Environment(\.tsUnits) private var units

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("charging.detail.temperature")
                if telemetry.isEmpty {
                    ChargingDetailChartEmpty()
                } else {
                    ChargingChartLegend(series: series)
                    TSLineChart(series: series).frame(height: 240)
                }
            }
        }
    }

    private var series: [TSChartSeries] {
        let battery = temperaturePoints { $0.batteryTempC }
        let inside = temperaturePoints { $0.insideTempC }
        let outside = temperaturePoints { $0.outsideTempC }
        return [
            ChargingChartBuilder.series("battery", "charging.detail.batteryTemp", "Battery", battery, 5),
            ChargingChartBuilder.series("inside", "charging.detail.insideTemp", "Inside", inside, 1),
            ChargingChartBuilder.series("outside", "charging.detail.outsideTemp", "Outside", outside, 4)
        ]
    }

    private func temperaturePoints(_ value: @escaping (ChargeTelemetryReading) -> Double?) -> [TSChartPoint] {
        ChargingChartBuilder.points(telemetry) { reading in
            value(reading).map { Units.convertTemperature($0, units) }
        }
    }
}

// MARK: - Voltage & current (web GlassPanel20 — composed time series)

/// The Voltage·Current time-series panel: charger voltage and current over the session
/// timeline (web dual-axis composed lines).
struct ChargingVoltageCurrentSection: View {
    let telemetry: [ChargeTelemetryReading]

    private var hasData: Bool {
        telemetry.contains { $0.voltageV != nil || $0.currentA != nil }
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("charging.detail.voltageCurrent")
                if hasData {
                    ChargingChartLegend(series: series)
                    TSLineChart(series: series).frame(height: 240)
                } else {
                    ChargingDetailChartEmpty()
                }
            }
        }
    }

    private var series: [TSChartSeries] {
        let voltage = ChargingChartBuilder.points(telemetry) { $0.voltageV }
        let current = ChargingChartBuilder.points(telemetry) { $0.currentA.map(abs) }
        return [
            ChargingChartBuilder.series("voltage", "charging.detail.voltage", "Voltage", voltage, 1),
            ChargingChartBuilder.series("current", "charging.detail.current", "Current", current, 3)
        ]
    }
}
