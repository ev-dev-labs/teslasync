import Charts
import SwiftUI

// The Top-Charging-Locations chart on the Charging Patterns surface, built on native Swift
// Charts (never a WKWebView). The web renders a horizontal `BarChart` (`layout="vertical"`):
// the location names on the category axis and the session count along the value axis. The P3
// `TSBarChart` wrapper plots vertical numeric series, so this categorical horizontal bar — the
// faithful port of the web layout — uses `Chart` directly while staying inside the design
// tokens for colour and typography.

/// Horizontal bar chart of the busiest charging places (web `BarChart` with `dataKey="count"`).
/// Bars are ordered highest-first (top) to match the web's descending `locationData`, each
/// annotated with its session count; the brand accent fills the bars.
struct ChargingHeatmapLocationsChart: View {
    let locations: [ChargingLocation]

    /// Web `height={locationData.length * 36 + 20}`.
    private var chartHeight: CGFloat {
        CGFloat(locations.count) * 36 + 20
    }

    /// Category order so the highest-count place sits at the top (Swift Charts places the first
    /// domain entry at the bottom, so the descending list is reversed).
    private var domain: [String] {
        locations.map(\.name).reversed()
    }

    var body: some View {
        Chart(locations) { location in
            BarMark(
                x: .value("charging.heatmap.sessions", location.count),
                y: .value("charging.heatmap.location", location.name)
            )
            .foregroundStyle(Color.TS.accent.opacity(0.7))
            .cornerRadius(4)
            .annotation(position: .trailing, alignment: .leading) {
                Text(verbatim: "\(location.count)")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .monospacedDigit()
            }
        }
        .chartYScale(domain: domain)
        .chartXAxis {
            AxisMarks(position: .bottom) { value in
                AxisGridLine().foregroundStyle(Color.TS.border)
                AxisValueLabel {
                    if let count = value.as(Int.self) {
                        Text(verbatim: "\(count)")
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisValueLabel {
                    if let name = value.as(String.self) {
                        Text(verbatim: name)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textSecondary)
                            .lineLimit(1)
                    }
                }
            }
        }
        .frame(height: chartHeight)
        .accessibilityLabel(Text("charging.heatmap.topLocations"))
        .accessibilityElement(children: .contain)
    }
}
