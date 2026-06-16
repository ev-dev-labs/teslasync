import SwiftUI

// The speed-profile area chart and the home/work presence line chart for the Navigation & Route surface
// (web GlassPanel8 Speed-Profile `AreaChart` + GlassPanel12 Home/Work-Presence `LineChart`), built on the
// P3 native Swift Charts wrappers (never a WKWebView). Speed + distance convert to the user's unit at
// this display boundary via `NavigationRouteFormat`; each panel renders its own loading / empty region
// (never a blank region).

// MARK: - GlassPanel8 — Speed Profile (web AreaChart: speed + distance-to-arrival)

/// The speed-profile panel (web GlassPanel8): a dual-series area chart of speed and distance-to-arrival
/// over the snapshot history, a unit-labeled legend, and the axis captions. Below the chart the legend
/// names carry the active speed / distance units (web `nav.legendSpeedV2` / `nav.legendDistanceToArrivalV2`).
struct NavSpeedProfileSection: View {
    let model: NavigationRoutePageModel
    let units: UnitPreferences

    private var samples: [NavSnapshot] {
        model.historyAscending
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "gauge.with.dots.needle.50percent")
                        .foregroundStyle(Color.TS.accent)
                        .accessibilityHidden(true)
                    TSPanelTitle("nav.speedProfile")
                }
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private var content: some View {
        if model.historyState == .loading {
            TSChartSkeleton(height: 240)
        } else if samples.isEmpty {
            TSEmptyState(title: "nav.noHistory", systemImage: "chart.xyaxis.line")
                .frame(maxWidth: .infinity, minHeight: 200)
        } else {
            TSAreaChart(series: series)
                .frame(height: 240)
                .accessibilityLabel(Text("nav.speedProfile"))
            legend
            axisCaptions
        }
    }

    /// Two area series — speed (`nav.legendSpeedV2`) and distance-to-arrival (`nav.legendDistanceToArrivalV2`),
    /// both converted to the user's unit; x is the chronological sample index.
    private var series: [TSChartSeries] {
        let speedPoints = samples.enumerated().map { index, snapshot in
            TSChartPoint(
                x: Double(index),
                y: NavigationRouteFormat.speedValue(snapshot.speedMps ?? 0, units),
                id: "speed-\(snapshot.id)"
            )
        }
        let distancePoints = samples.enumerated().map { index, snapshot in
            TSChartPoint(
                x: Double(index),
                y: NavigationRouteFormat.distanceValue(snapshot.distanceToArrivalM ?? 0, units),
                id: "dist-\(snapshot.id)"
            )
        }
        return [
            TSChartSeries(
                id: "speed",
                name: "nav.legendSpeedV2",
                nameText: legendSpeed,
                points: speedPoints,
                colorIndex: 0
            ),
            TSChartSeries(
                id: "distance",
                name: "nav.legendDistanceToArrivalV2",
                nameText: legendDistance,
                points: distancePoints,
                colorIndex: 1
            )
        ]
    }

    private var legend: some View {
        HStack(spacing: TSSpacing.lg) {
            legendItem(text: legendSpeed, colorIndex: 0)
            legendItem(text: legendDistance, colorIndex: 1)
            Spacer(minLength: 0)
        }
        .accessibilityHidden(true)
    }

    private func legendItem(text: String, colorIndex: Int) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Circle().fill(TSChartPalette.color(at: colorIndex)).frame(width: 8, height: 8)
            Text(verbatim: text)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
    }

    /// The web dual-axis labels surfaced as captions (`nav.chartSpeedV2` / `nav.chartDistanceV2`).
    private var axisCaptions: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: axisSpeed)
            Text(verbatim: axisDistance)
        }
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textMuted)
    }

    private var axisSpeed: String {
        String(format: String(localized: "nav.chartSpeedV2"), NavigationRouteFormat.speedUnit(units))
    }

    private var axisDistance: String {
        String(format: String(localized: "nav.chartDistanceV2"), NavigationRouteFormat.distanceUnit(units))
    }

    /// Web `nav.legendSpeedV2` = `Speed ({{unit}})`.
    private var legendSpeed: String {
        String(format: String(localized: "nav.legendSpeedV2"), NavigationRouteFormat.speedUnit(units))
    }

    /// Web `nav.legendDistanceToArrivalV2` = `Distance to Arrival ({{unit}})`.
    private var legendDistance: String {
        String(format: String(localized: "nav.legendDistanceToArrivalV2"), NavigationRouteFormat.distanceUnit(units))
    }
}

// MARK: - GlassPanel12 — Home / Work Presence (web LineChart: home / work / homelink step lines)

/// The home/work presence panel (web GlassPanel12): a three-series step line chart of the home, work, and
/// HomeLink presence flags over the snapshot history, with a localized legend (`nav.atHome` / `nav.atWork`
/// / `nav.homelinkNearby`).
struct NavPresenceSection: View {
    let model: NavigationRoutePageModel

    private var samples: [NavPresenceSample] {
        model.presenceSamples
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "chart.line.uptrend.xyaxis")
                        .foregroundStyle(Color.TS.accent)
                        .accessibilityHidden(true)
                    TSPanelTitle("nav.presenceChart")
                }
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private var content: some View {
        if model.historyState == .loading {
            TSChartSkeleton(height: 260)
        } else if samples.isEmpty {
            TSEmptyState(title: "nav.noPresence", systemImage: "chart.xyaxis.line")
                .frame(maxWidth: .infinity, minHeight: 200)
        } else {
            TSLineChart(series: series, smooth: false)
                .frame(height: 260)
                .accessibilityLabel(Text("nav.presenceChart"))
            legend
        }
    }

    /// Three step series for the home / work / homelink flags (0/1), x = chronological sample index.
    private var series: [TSChartSeries] {
        [
            presenceSeries(id: "home", name: "nav.atHome", text: "Home", colorIndex: 1) { $0.home },
            presenceSeries(id: "work", name: "nav.atWork", text: "Work", colorIndex: 3) { $0.work },
            presenceSeries(id: "homelink", name: "nav.homelinkNearby", text: "HomeLink", colorIndex: 4) { $0.homelink }
        ]
    }

    private func presenceSeries(
        id: String,
        name: LocalizedStringKey,
        text: String,
        colorIndex: Int,
        flag: (NavPresenceSample) -> Bool
    ) -> TSChartSeries {
        let points = samples.enumerated().map { index, sample in
            TSChartPoint(x: Double(index), y: flag(sample) ? 1 : 0, id: "\(id)-\(sample.id)")
        }
        return TSChartSeries(id: id, name: name, nameText: text, points: points, colorIndex: colorIndex)
    }

    private var legend: some View {
        HStack(spacing: TSSpacing.lg) {
            legendItem(key: "nav.atHome", colorIndex: 1)
            legendItem(key: "nav.atWork", colorIndex: 3)
            legendItem(key: "nav.homelinkNearby", colorIndex: 4)
            Spacer(minLength: 0)
        }
        .accessibilityHidden(true)
    }

    private func legendItem(key: LocalizedStringKey, colorIndex: Int) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Circle().fill(TSChartPalette.color(at: colorIndex)).frame(width: 8, height: 8)
            Text(key)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
    }
}
