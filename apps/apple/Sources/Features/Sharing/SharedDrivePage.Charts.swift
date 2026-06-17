import SwiftUI

// The Shared Drive profile charts (web `ChartContainer` + `AreaChart` for elevation, `ChartContainer`
// + `LineChart` for speed). Both render through the P3 Swift Charts wrappers (`TSAreaChart` /
// `TSLineChart`) — never a web view — with x = distance and y = elevation / speed converted at the
// render boundary through `Units` / `SharedDriveFormat` (SI in, display out — ADR-005). Each chart
// resolves its own empty vs. success from the points it receives, exactly as the web page does, and
// carries the web `aria-label` plus a localized unit legend so the series stays identifiable
// without a recharts tooltip.

// MARK: - Chart panel (web `ChartContainer`)

/// A titled glass chart panel (web `ChartContainer`): the visible title over the chart body, with
/// the web `ariaLabel` applied to the whole region for VoiceOver.
struct SharedDriveChartPanel<Content: View>: View {
    let title: LocalizedStringKey
    let ariaLabel: LocalizedStringKey
    @ViewBuilder var content: () -> Content

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle(title)
                content()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(ariaLabel))
    }
}

/// A compact coloured-dot legend naming a chart's series + its display units (web chart tooltip
/// label). Decorative — hidden from VoiceOver, which reads the panel's aria label instead.
private struct SharedDriveChartLegend: View {
    let label: LocalizedStringKey
    let unit: String
    let colorIndex: Int

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle().fill(TSChartPalette.color(at: colorIndex)).frame(width: 8, height: 8)
            Text(label).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: "(\(unit))").font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityHidden(true)
    }
}

/// Shared empty chart state (web per-chart fallback / `EmptyState`).
private struct SharedDriveChartEmpty: View {
    var body: some View {
        TSEmptyState(title: SharedDriveStrings.noMapData, systemImage: "chart.xyaxis.line")
            .frame(maxWidth: .infinity, minHeight: 180)
    }
}

// MARK: - Elevation profile (web `ChartContainer` + `AreaChart`)

/// The elevation profile area chart by distance (web elevation `ChartContainer` + `AreaChart`).
/// Elevation lifts SI meters to feet for imperial viewers; distance goes through `Units`.
struct SharedDriveElevationSection: View {
    let points: [SharedElevationPoint]
    @Environment(\.tsUnits) private var units

    private let colorIndex = 4

    var body: some View {
        SharedDriveChartPanel(title: SharedDriveStrings.elevation, ariaLabel: SharedDriveStrings.elevationAria) {
            if let series {
                SharedDriveChartLegend(
                    label: SharedDriveStrings.elevTooltipLabel,
                    unit: SharedDriveFormat.elevationUnit(units),
                    colorIndex: colorIndex
                )
                TSAreaChart(series: [series]).frame(height: 200)
            } else {
                SharedDriveChartEmpty()
            }
        }
    }

    private var series: TSChartSeries? {
        guard !points.isEmpty else { return nil }
        let chartPoints = points.map { point in
            TSChartPoint(
                x: Units.convertDistance(point.distanceM, units),
                y: SharedDriveFormat.convertElevation(point.elevationM, units)
            )
        }
        return TSChartSeries(
            id: "elevation",
            name: SharedDriveStrings.elevTooltipLabel,
            nameText: "Elevation",
            points: chartPoints,
            colorIndex: colorIndex
        )
    }
}

// MARK: - Speed profile (web `ChartContainer` + `LineChart`)

/// The speed profile line chart by distance (web speed `ChartContainer` + `LineChart`). Speed and
/// distance both convert to the viewer's display units at the render boundary through `Units`.
struct SharedDriveSpeedSection: View {
    let points: [SharedSpeedPoint]
    @Environment(\.tsUnits) private var units

    private let colorIndex = 5

    var body: some View {
        SharedDriveChartPanel(title: SharedDriveStrings.speed, ariaLabel: SharedDriveStrings.speedAria) {
            if let series {
                SharedDriveChartLegend(
                    label: SharedDriveStrings.speedTooltipLabel,
                    unit: units.speed,
                    colorIndex: colorIndex
                )
                TSLineChart(series: [series]).frame(height: 200)
            } else {
                SharedDriveChartEmpty()
            }
        }
    }

    private var series: TSChartSeries? {
        guard !points.isEmpty else { return nil }
        let chartPoints = points.map { point in
            TSChartPoint(
                x: Units.convertDistance(point.distanceM, units),
                y: Units.convertSpeed(point.speedMps, units)
            )
        }
        return TSChartSeries(
            id: "speed",
            name: SharedDriveStrings.speedTooltipLabel,
            nameText: "Speed",
            points: chartPoints,
            colorIndex: colorIndex
        )
    }
}
