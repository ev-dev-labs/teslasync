import SwiftUI

// The per-cell bar chart (web GlassPanel9) and the voltage-distribution histogram
// (web GlassPanel10), built on the P3 native Swift Charts `TSBarChart` wrapper
// (never a WKWebView). Each renders its own empty block (never a blank region), a
// visible series legend (the wrappers hide their own), and axis captions so the web
// axis labels + reference-line labels resolve from the string catalog.

// MARK: - Shared chart chrome

/// One legend entry: a localized series name and its swatch color.
struct BatteryLegendItem: Identifiable {
    let id: String
    let name: LocalizedStringKey
    let color: Color
}

/// A horizontal series legend (the `TSBarChart` / `TSLineChart` wrappers hide their
/// own), surfacing each web series name.
struct BatteryChartLegend: View {
    let items: [BatteryLegendItem]

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            ForEach(items) { item in
                HStack(spacing: TSSpacing.xs) {
                    Circle().fill(item.color).frame(width: 8, height: 8)
                    Text(item.name).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One reference value chip (web `ReferenceLine` label + its value), e.g. Avg / Min /
/// Max or Nominal / Warning.
struct BatteryReferenceItem: Identifiable {
    let id: String
    let label: LocalizedStringKey
    let value: String
    let color: Color
}

/// A row of reference values surfacing the web reference-line labels.
struct BatteryReferenceRow: View {
    let items: [BatteryReferenceItem]

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            ForEach(items) { item in
                HStack(spacing: TSSpacing.xs) {
                    Rectangle().fill(item.color).frame(width: 12, height: 2)
                    Text(item.label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
                    Text(verbatim: item.value).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The axis labels beneath a chart (web X-axis / Y-axis `label`).
struct BatteryAxisCaption: View {
    let yLabel: LocalizedStringKey
    let xLabel: LocalizedStringKey

    var body: some View {
        HStack {
            Text(yLabel).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            Spacer()
            Text(xLabel).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
    }
}

/// A filled block standing in for a chart with no data (web `Skeleton height=…`).
struct BatteryChartEmpty: View {
    let height: CGFloat

    var body: some View {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .accessibilityHidden(true)
    }
}

// MARK: - Cell voltage bar chart (web GlassPanel9 — BarChart)

/// The per-cell voltage bar chart (web GlassPanel9): one bar per cell with the
/// average / minimum / maximum surfaced as reference values.
struct BatteryCellsVoltageBarSection: View {
    let data: BatteryCellData

    private var series: [TSChartSeries] {
        let points = data.cells.map { cell in
            TSChartPoint(x: Double(cell.cellID), y: cell.voltage, id: "cell-\(cell.cellID)")
        }
        return [TSChartSeries(id: "voltage", name: "Voltage", nameText: "Voltage", points: points, colorIndex: 0)]
    }

    private var references: [BatteryReferenceItem] {
        [
            BatteryReferenceItem(
                id: "avg",
                label: "Avg",
                value: BatteryCellsFormat.voltage(data.avgVoltage, decimals: 3),
                color: TSChartPalette.color(at: 0)
            ),
            BatteryReferenceItem(
                id: "min",
                label: "Min",
                value: BatteryCellsFormat.voltage(data.minVoltage, decimals: 3),
                color: TSChartPalette.color(at: 5)
            ),
            BatteryReferenceItem(
                id: "max",
                label: "Max",
                value: BatteryCellsFormat.voltage(data.maxVoltage, decimals: 3),
                color: TSChartPalette.color(at: 1)
            )
        ]
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSubhead("Cell Voltage Bar Chart")
                if data.cells.isEmpty {
                    BatteryChartEmpty(height: 280)
                } else {
                    TSBarChart(series: series)
                        .frame(height: 280)
                        .accessibilityLabel(Text("Cell Voltage Bar Chart"))
                    BatteryChartLegend(items: [BatteryLegendItem(
                        id: "voltage",
                        name: "Voltage",
                        color: TSChartPalette.color(at: 0)
                    )])
                    BatteryReferenceRow(items: references)
                    BatteryAxisCaption(yLabel: "Voltage (V)", xLabel: "Cell #")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Voltage distribution histogram (web GlassPanel10 — BarChart)

/// The voltage-distribution histogram (web GlassPanel10): cell counts per voltage
/// bucket, with the bucket ranges surfaced beneath the bars.
struct BatteryCellsDistributionSection: View {
    let data: BatteryCellData

    private var buckets: [BatteryVoltageBucket] {
        data.histogram
    }

    private var series: [TSChartSeries] {
        let points = buckets.map { bucket in
            TSChartPoint(x: Double(bucket.index), y: Double(bucket.count), id: "bucket-\(bucket.index)")
        }
        return [TSChartSeries(id: "count", name: "Cell Count", nameText: "Cell Count", points: points, colorIndex: 2)]
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSubhead("Voltage Distribution")
                if buckets.isEmpty {
                    BatteryChartEmpty(height: 240)
                } else {
                    TSBarChart(series: series)
                        .frame(height: 240)
                        .accessibilityLabel(Text("Voltage Distribution"))
                    BatteryChartLegend(items: [BatteryLegendItem(
                        id: "count",
                        name: "Cell Count",
                        color: TSChartPalette.color(at: 2)
                    )])
                    bucketAxis
                    BatteryAxisCaption(yLabel: "Cells", xLabel: "Voltage (V)")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    /// The bucket ranges beneath the bars (web X-axis tick labels).
    private var bucketAxis: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(buckets) { bucket in
                Text(verbatim: bucket.label)
                    .font(.system(size: 9))
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .frame(maxWidth: .infinity)
            }
        }
        .accessibilityHidden(true)
    }
}
