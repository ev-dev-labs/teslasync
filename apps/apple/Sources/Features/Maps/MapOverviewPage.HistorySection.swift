import SwiftUI

/// GlassPanel9 — the recent location-history table (web `DataTable`): time, latitude, longitude,
/// speed, and heading for the recent fixes, via the adaptive P3 `TSDataTable` (a columnar grid
/// on macOS / iPad, a card list on compact iPhone). Falls back to its own empty state when there
/// is no history, so the panel is never blank (ADR-011). Speed converts from SI m/s to the
/// user's unit at the render boundary (ADR-005).
struct MapOverviewHistorySection: View {
    let model: MapOverviewPageModel
    @Environment(\.tsUnits) private var units

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("mapOverview.recentHistory")
                if model.hasHistory {
                    TSDataTable(rows: model.history, columns: columns, density: .compact)
                } else {
                    TSEmptyState(title: "mapOverview.noHistory", systemImage: "clock.arrow.circlepath")
                        .frame(maxWidth: .infinity, minHeight: 160)
                }
            }
        }
    }

    private var columns: [TSColumn<MapOverviewPosition>] {
        let units = units
        return [
            TSColumn(id: "time", title: "mapOverview.colTime") { row in
                Text(verbatim: MapOverviewFormat.time(row.createdAt))
                    .lineLimit(1)
            },
            TSColumn(id: "lat", title: "mapOverview.colLat") { row in
                Text(verbatim: row.hasValidLocation ? MapOverviewFormat.coordinate(row.latitude, decimals: 5) : "—")
                    .monospacedDigit()
            },
            TSColumn(id: "lon", title: "mapOverview.colLon") { row in
                Text(verbatim: row.hasValidLocation ? MapOverviewFormat.coordinate(row.longitude, decimals: 5) : "—")
                    .monospacedDigit()
            },
            TSColumn(id: "speed", title: "mapOverview.colSpeed") { row in
                Text(verbatim: MapOverviewFormat.speed(row.speedMps, units: units))
                    .monospacedDigit()
            },
            TSColumn(id: "heading", title: "mapOverview.colHeading") { row in
                Text(verbatim: MapOverviewFormat.heading(row.heading))
                    .monospacedDigit()
            }
        ]
    }
}
