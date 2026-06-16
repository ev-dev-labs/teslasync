import SwiftUI

// The route-waypoints, recent-destinations, and location-history tables for the Navigation & Route
// surface (web GlassPanel9 Waypoints `DataTable`, GlassPanel11 Recent-Destinations `DataTable`, and
// GlassPanel13 Location-History `DataTable`), built on the adaptive P3 `TSDataTable` (columnar on
// macOS / iPad, cards on compact iPhone). Distances convert to the user's unit at this display boundary;
// each panel renders its own loading / empty region (never a blank region).

// MARK: - GlassPanel9 — Route Waypoints (web Waypoints DataTable)

/// The route-waypoints panel (web GlassPanel9): the destination/supercharger waypoint table when a route
/// is active (web `navigation.noRoute` when inactive; `common.noData` when active with no rows).
struct NavWaypointsSection: View {
    let model: NavigationRoutePageModel
    let units: UnitPreferences

    private var waypoints: [NavWaypoint] {
        model.waypoints
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "bolt.fill")
                        .foregroundStyle(Color.TS.accent)
                        .accessibilityHidden(true)
                    TSPanelTitle("nav.waypoints")
                }
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private var content: some View {
        if !model.hasActiveRoute {
            TSEmptyState(title: "navigation.noRoute", systemImage: "signpost.right.and.left")
                .frame(maxWidth: .infinity, minHeight: 120)
        } else if waypoints.isEmpty {
            TSEmptyState(title: "common.noData", systemImage: "mappin.slash")
                .frame(maxWidth: .infinity, minHeight: 120)
        } else {
            TSDataTable(rows: waypoints, columns: columns, density: .compact)
        }
    }

    private var columns: [TSColumn<NavWaypoint>] {
        [
            TSColumn(id: "name", title: "nav.wp.name") { waypoint in
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: Self.icon(for: waypoint.kind))
                        .foregroundStyle(Self.tone(for: waypoint.kind).color)
                        .accessibilityHidden(true)
                    Text(verbatim: waypoint.name).foregroundStyle(Color.TS.textPrimary)
                }
            },
            TSColumn(id: "type", title: "nav.wp.type") { waypoint in
                NavKindChip(kind: waypoint.kind)
            },
            TSColumn(id: "distance", title: "nav.wp.distance") { waypoint in
                Text(verbatim: NavigationRouteFormat.distance(waypoint.distanceM, units))
                    .font(.system(.body, design: .monospaced))
                    .foregroundStyle(Color.TS.textMuted)
            }
        ]
    }

    private static func icon(for kind: NavWaypoint.Kind) -> String {
        switch kind {
        case .supercharger: "bolt.fill"
        case .destination: "mappin.circle.fill"
        case .waypoint: "point.topleft.down.curvedto.point.bottomright.up"
        }
    }

    private static func tone(for kind: NavWaypoint.Kind) -> TSTone {
        switch kind {
        case .supercharger: .danger
        case .destination: .info
        case .waypoint: .warning
        }
    }
}

/// A tinted chip for a waypoint kind (web `Badge variant={...}`). The kind value is data-driven (web
/// renders `row.type` verbatim), so it is shown verbatim rather than as a localized literal.
struct NavKindChip: View {
    let kind: NavWaypoint.Kind

    private var tone: TSTone {
        switch kind {
        case .supercharger: .danger
        case .destination: .info
        case .waypoint: .warning
        }
    }

    var body: some View {
        Text(verbatim: kind.rawValue)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
    }
}

// MARK: - GlassPanel11 — Recent Destinations (web Recent Destinations DataTable)

/// The recent-destinations panel (web GlassPanel11): the unique recent destinations with their time,
/// distance, and ETA — or the `nav.noDestinations` empty state, or a skeleton while history loads.
struct NavRecentDestinationsSection: View {
    let model: NavigationRoutePageModel
    let units: UnitPreferences

    private var destinations: [NavDestination] {
        model.recentDestinations
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "clock.fill")
                        .foregroundStyle(Color.TS.accent)
                        .accessibilityHidden(true)
                    TSPanelTitle("nav.recentDestinations")
                }
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private var content: some View {
        if model.historyState == .loading {
            TSTableSkeleton(rows: 6)
        } else if destinations.isEmpty {
            TSEmptyState(title: "nav.noDestinations", systemImage: "mappin.slash")
                .frame(maxWidth: .infinity, minHeight: 120)
        } else {
            TSDataTable(rows: destinations, columns: columns, density: .compact)
        }
    }

    private var columns: [TSColumn<NavDestination>] {
        [
            TSColumn(id: "time", title: "nav.col.time", comparator: { lhs, rhs in
                NavTableCompare.dates(lhs.time, rhs.time)
            }, cell: { row in
                Text(verbatim: NavigationRouteFormat.dateTime(row.time))
                    .foregroundStyle(Color.TS.textMuted)
            }),
            TSColumn(id: "destination", title: "nav.col.destination") { row in
                Text(verbatim: row.destination).foregroundStyle(Color.TS.textPrimary)
            },
            TSColumn(id: "distance", title: "nav.col.distance") { row in
                Text(verbatim: NavigationRouteFormat.distance(row.distanceM, units))
                    .foregroundStyle(Color.TS.textMuted)
            },
            TSColumn(id: "eta", title: "nav.col.eta") { row in
                (Text(verbatim: NavigationRouteFormat.minutes(row.etaMinutes) + " ") + Text("nav.minutes"))
                    .foregroundStyle(Color.TS.textMuted)
            }
        ]
    }
}

// MARK: - GlassPanel13 — Location History (web Location History DataTable)

/// The location-history panel (web GlassPanel13): the sortable snapshot table (time, lat, lon, home,
/// work, destination) — or the `nav.noSnapshots` empty state, or a skeleton while history loads.
struct NavLocationHistorySection: View {
    let model: NavigationRoutePageModel

    private var history: [NavSnapshot] {
        model.history
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "safari.fill")
                        .foregroundStyle(Color.TS.accent)
                        .accessibilityHidden(true)
                    TSPanelTitle("nav.locationHistory")
                }
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private var content: some View {
        if model.historyState == .loading {
            TSTableSkeleton(rows: 8)
        } else if history.isEmpty {
            TSEmptyState(title: "nav.noSnapshots", systemImage: "clock.arrow.circlepath")
                .frame(maxWidth: .infinity, minHeight: 120)
        } else {
            TSDataTable(rows: history, columns: columns, density: .compact)
        }
    }

    private var columns: [TSColumn<NavSnapshot>] {
        [
            TSColumn(id: "time", title: "nav.col.time", comparator: { lhs, rhs in
                NavTableCompare.dates(lhs.createdAt, rhs.createdAt)
            }, cell: { row in
                Text(verbatim: NavigationRouteFormat.dateTime(row.createdAt))
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.textMuted)
            }),
            TSColumn(id: "lat", title: "nav.col.lat", comparator: { lhs, rhs in
                NavTableCompare.doubles(lhs.latitude, rhs.latitude)
            }, cell: { row in
                Text(verbatim: NavigationRouteFormat.coordinateComponent(row.latitude))
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.textPrimary)
            }),
            TSColumn(id: "lon", title: "nav.col.lon", comparator: { lhs, rhs in
                NavTableCompare.doubles(lhs.longitude, rhs.longitude)
            }, cell: { row in
                Text(verbatim: NavigationRouteFormat.coordinateComponent(row.longitude))
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.textPrimary)
            }),
            TSColumn(id: "home", title: "nav.col.home", comparator: { lhs, rhs in
                NavTableCompare.bools(lhs.locatedAtHome, rhs.locatedAtHome)
            }, cell: { row in
                NavBoolCell(value: row.locatedAtHome, tone: .success)
            }),
            TSColumn(id: "work", title: "nav.col.work", comparator: { lhs, rhs in
                NavTableCompare.bools(lhs.locatedAtWork, rhs.locatedAtWork)
            }, cell: { row in
                NavBoolCell(value: row.locatedAtWork, tone: .info)
            }),
            TSColumn(id: "destination", title: "nav.col.destination") { row in
                Text(verbatim: row.destinationName ?? NavigationRouteFormat.emptyValue)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
            }
        ]
    }
}

/// A boolean presence cell (web `Yes`/`No`/`—`): rendered as a tinted check / dash / em-dash symbol so no
/// English literal is hardcoded.
struct NavBoolCell: View {
    let value: Bool?
    let tone: TSTone

    var body: some View {
        switch value {
        case true:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(tone.color)
        case false:
            Image(systemName: "xmark.circle").foregroundStyle(Color.TS.textMuted)
        default:
            Text(verbatim: NavigationRouteFormat.emptyValue).foregroundStyle(Color.TS.textMuted)
        }
    }
}

/// Stable column comparators for the history / destination tables (web sortable columns).
enum NavTableCompare {
    static func dates(_ lhs: Date, _ rhs: Date) -> ComparisonResult {
        lhs == rhs ? .orderedSame : (lhs < rhs ? .orderedAscending : .orderedDescending)
    }

    static func doubles(_ lhs: Double?, _ rhs: Double?) -> ComparisonResult {
        let left = lhs ?? 0
        let right = rhs ?? 0
        if left == right { return .orderedSame }
        return left < right ? .orderedAscending : .orderedDescending
    }

    static func bools(_ lhs: Bool?, _ rhs: Bool?) -> ComparisonResult {
        let left = (lhs ?? false) ? 1 : 0
        let right = (rhs ?? false) ? 1 : 0
        if left == right { return .orderedSame }
        return left < right ? .orderedAscending : .orderedDescending
    }
}
