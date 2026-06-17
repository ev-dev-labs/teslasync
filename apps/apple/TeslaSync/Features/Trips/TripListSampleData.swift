import Foundation

/// A representative local seed used as the `TripListPageModel` / preview default until the KMP-backed
/// source is injected at composition time (ADR-004). It is an API-response-shaped fixture set (eight
/// trips across ~five weeks, mixing named and auto-generated trips, varied drive/charge counts, and
/// one still-open trip) so the stat cards, the top-trips bar chart, and the trip list all render
/// their populated success state out of the box. Every measurement is SI (metres, watt-hours,
/// seconds); the views convert at the render boundary.
public struct SampleTripListDataSource: TripListDataSource {
    private let base = Date(timeIntervalSince1970: 1_718_000_000)

    public init() {}

    public func loadTrips(query: TripListQuery) async throws -> [TripListItem] {
        let scoped = query.vehicleID.map { id in Self.rows.filter { $0.vehicleID == id } } ?? Self.rows
        return Array(scoped.map(makeTrip).dropFirst(query.offset).prefix(query.limit))
    }

    private func makeTrip(_ row: Row) -> TripListItem {
        let start = base.addingTimeInterval(-Double(row.daysAgo) * 86_400)
        let end = row.durationMinutes.map { start.addingTimeInterval(Double($0) * 60) }
        return TripListItem(
            id: row.id,
            vehicleID: row.vehicleID,
            name: row.name,
            startDate: start,
            endDate: end,
            totalDistanceM: row.distanceKm * 1000,
            totalEnergyWh: row.energyKWh * 1000,
            totalDurationS: Double(row.durationMinutes ?? 0) * 60,
            totalCost: row.cost,
            driveCount: row.driveCount,
            chargeCount: row.chargeCount
        )
    }

    /// Display-shaped seed rows converted to SI in `makeTrip`. `durationMinutes == nil` models a
    /// still-open trip (web `end_date == null` → the "In progress" duration sentinel).
    private struct Row {
        let id: Int64
        let vehicleID: Int64
        let name: String?
        let daysAgo: Int
        let durationMinutes: Int?
        let distanceKm: Double
        let energyKWh: Double
        let cost: Double
        let driveCount: Int
        let chargeCount: Int
    }

    private static let rows: [Row] = [
        Row(id: 4821, vehicleID: 1, name: "Weekend to Tahoe",
            daysAgo: 5, durationMinutes: 210, distanceKm: 312.4, energyKWh: 61.8,
            cost: 18.54, driveCount: 4, chargeCount: 2),
        Row(id: 4810, vehicleID: 1, name: nil,
            daysAgo: 6, durationMinutes: 24, distanceKm: 18.2, energyKWh: 4.1,
            cost: 1.23, driveCount: 1, chargeCount: 0),
        Row(id: 4799, vehicleID: 1, name: "Morning commute",
            daysAgo: 7, durationMinutes: 38, distanceKm: 27.6, energyKWh: 6.0,
            cost: 1.80, driveCount: 2, chargeCount: 0),
        Row(id: 4774, vehicleID: 2, name: "Coastal Highway 1",
            daysAgo: 12, durationMinutes: 152, distanceKm: 168.0, energyKWh: 33.2,
            cost: 9.96, driveCount: 3, chargeCount: 1),
        Row(id: 4760, vehicleID: 2, name: nil,
            daysAgo: 14, durationMinutes: 9, distanceKm: 5.4, energyKWh: 1.3,
            cost: 0.39, driveCount: 1, chargeCount: 0),
        Row(id: 4732, vehicleID: 1, name: "Napa Valley loop",
            daysAgo: 19, durationMinutes: 264, distanceKm: 221.7, energyKWh: 44.5,
            cost: 13.35, driveCount: 5, chargeCount: 2),
        Row(id: 4705, vehicleID: 2, name: "Airport run",
            daysAgo: 27, durationMinutes: 52, distanceKm: 41.3, energyKWh: 8.7,
            cost: 2.61, driveCount: 2, chargeCount: 0),
        Row(id: 4690, vehicleID: 1, name: "Road trip (in progress)",
            daysAgo: 33, durationMinutes: nil, distanceKm: 95.0, energyKWh: 18.0,
            cost: 5.40, driveCount: 2, chargeCount: 1)
    ]
}

#if DEBUG
    /// Preview/test seam yielding no trips — drives the web empty states (`allTrips.length === 0` →
    /// the chart's "No trip data to chart" and the list's "No trips recorded yet").
    public struct EmptyTripListDataSource: TripListDataSource {
        public init() {}

        public func loadTrips(query _: TripListQuery) async throws -> [TripListItem] {
            []
        }
    }

    /// Preview/test seam whose trip load fails — drives the retryable error region.
    public struct FailingTripListDataSource: TripListDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadTrips(query _: TripListQuery) async throws -> [TripListItem] {
            throw Failure()
        }
    }
#endif
