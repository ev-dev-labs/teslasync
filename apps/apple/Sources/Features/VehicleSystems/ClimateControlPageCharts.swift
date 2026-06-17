import SwiftUI

// MARK: - Chart legend (web Recharts `<Legend />`)

/// One swatch + localized label in a manual chart legend.
struct ClimateChartLegendItem: Identifiable {
    let id: String
    let labelKey: LocalizedStringKey
    let colorIndex: Int
}

/// A horizontal legend rendered above a chart (the shared `TSLineChart` hides its
/// own legend, so the series names are surfaced here — localized, web-keyed).
struct ClimateChartLegend: View {
    let items: [ClimateChartLegendItem]

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            ForEach(items) { item in
                HStack(spacing: TSSpacing.xs) {
                    Circle()
                        .fill(TSChartPalette.color(at: item.colorIndex))
                        .frame(width: 8, height: 8)
                    Text(item.labelKey)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Temperature history (web LineChart — inside / outside / driver-set)

/// The temperature trend (web "Temperature History" `LineChart`): three series
/// converted to the user's unit at the boundary, drawn through the shared P3
/// `TSLineChart` (native Swift Charts).
struct ClimateTemperatureHistoryChart: View {
    let history: [ClimateSnapshot]
    let fahrenheit: Bool

    private func series(
        id: String,
        colorIndex: Int,
        value: (ClimateSnapshot) -> Double?
    ) -> TSChartSeries {
        let points = history.enumerated().compactMap { index, snapshot -> TSChartPoint? in
            guard let raw = value(snapshot) else { return nil }
            let converted = ClimateFormat.displayTemperature(raw, fahrenheit: fahrenheit)
            return TSChartPoint(x: Double(index), y: converted, id: "\(id)-\(index)")
        }
        return TSChartSeries(
            id: id,
            name: LocalizedStringKey(id),
            nameText: id,
            points: points,
            colorIndex: colorIndex
        )
    }

    var body: some View {
        let inside = series(id: "inside", colorIndex: 0) { $0.insideTemp }
        let outside = series(id: "outside", colorIndex: 1) { $0.outsideTemp }
        let driver = series(id: "driver", colorIndex: 2) { $0.driverTempSetting }
        return VStack(alignment: .leading, spacing: TSSpacing.md) {
            ClimateChartLegend(items: [
                ClimateChartLegendItem(id: "inside", labelKey: "Inside Temp", colorIndex: 0),
                ClimateChartLegendItem(id: "outside", labelKey: "Outside Temp", colorIndex: 1),
                ClimateChartLegendItem(id: "driver", labelKey: "Driver Set Temp", colorIndex: 2)
            ])
            TSLineChart(series: [inside, outside, driver])
                .frame(height: 280)
                .accessibilityLabel(Text("Temperature History"))
        }
    }
}

// MARK: - AC state & fan speed (web AreaChart — AC on/off + fan level)

/// The HVAC trend (web "AC State & Fan Speed" `AreaChart`): AC on/off and fan
/// level over time through the shared P3 `TSAreaChart` (native Swift Charts),
/// with a localized legend + axis captions (web dual Y-axis `AC` / `Fan Level`).
struct ClimateHvacHistoryChart: View {
    let history: [ClimateSnapshot]

    private var acSeries: TSChartSeries {
        let points = history.enumerated().map { index, snapshot in
            TSChartPoint(x: Double(index), y: snapshot.isAcOn == true ? 1 : 0, id: "ac-\(index)")
        }
        return TSChartSeries(id: "ac", name: "AC On/Off", nameText: "ac", points: points, colorIndex: 0)
    }

    private var fanSeries: TSChartSeries {
        let points = history.enumerated().map { index, snapshot in
            TSChartPoint(x: Double(index), y: Double(snapshot.fanSpeed ?? 0), id: "fan-\(index)")
        }
        return TSChartSeries(id: "fan", name: "Fan Speed", nameText: "fan", points: points, colorIndex: 3)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(alignment: .firstTextBaseline) {
                ClimateChartLegend(items: [
                    ClimateChartLegendItem(id: "ac", labelKey: "AC On/Off", colorIndex: 0),
                    ClimateChartLegendItem(id: "fan", labelKey: "Fan Speed", colorIndex: 3)
                ])
                Spacer(minLength: TSSpacing.md)
                HStack(spacing: TSSpacing.md) {
                    Text("AC")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                    Text("Fan Level")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            TSAreaChart(series: [acSeries, fanSeries])
                .frame(height: 280)
                .accessibilityLabel(Text("AC State & Fan Speed"))
        }
    }
}
