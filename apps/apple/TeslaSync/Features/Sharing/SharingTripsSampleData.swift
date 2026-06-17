import Foundation

/// A representative local seed used as the `SharingTripsPageModel` / preview default until the
/// KMP-backed source is injected at composition time (ADR-004). It is an API-response-shaped
/// fixture set (six recent trips across ~two weeks, mixing named and auto-generated trips and one
/// still-open trip) so the recent-trips list renders its populated success state out of the box.
/// Every measurement is SI (metres, watt-hours, seconds); the row converts at the render boundary.
public struct SampleSharingTripsDataSource: SharingTripsDataSource {
    private let base = Date(timeIntervalSince1970: 1_718_000_000)

    public init() {}

    public func loadTrips(vehicleID: Int64?, limit: Int) async throws -> [SharingTrip] {
        Array(Self.rows.map(makeTrip).prefix(limit))
    }

    private func makeTrip(_ row: Row) -> SharingTrip {
        let start = base.addingTimeInterval(-Double(row.daysAgo) * 86_400)
        let end = row.durationMinutes.map { start.addingTimeInterval(Double($0) * 60) }
        return SharingTrip(
            id: row.id,
            vehicleID: row.vehicleID,
            name: row.name,
            startDate: start,
            endDate: end,
            totalDistanceM: row.distanceKm * 1000,
            totalEnergyWh: row.energyKWh * 1000,
            totalDurationS: Double(row.durationMinutes ?? 0) * 60,
            driveCount: row.driveCount,
            chargeCount: row.chargeCount
        )
    }

    /// Display-shaped seed rows converted to SI in `makeTrip`. `durationMinutes == nil` models a
    /// still-open trip (web `end_date == null` → em-dash duration).
    private struct Row {
        let id: Int64
        let vehicleID: Int64
        let name: String?
        let daysAgo: Int
        let durationMinutes: Int?
        let distanceKm: Double
        let energyKWh: Double
        let driveCount: Int
        let chargeCount: Int
    }

    private static let rows: [Row] = [
        Row(id: 4821, vehicleID: 1, name: "Weekend to Tahoe",
            daysAgo: 5, durationMinutes: 210, distanceKm: 312.4, energyKWh: 61.8,
            driveCount: 4, chargeCount: 2),
        Row(id: 4810, vehicleID: 1, name: nil,
            daysAgo: 6, durationMinutes: 24, distanceKm: 18.2, energyKWh: 4.1,
            driveCount: 1, chargeCount: 0),
        Row(id: 4799, vehicleID: 1, name: "Morning commute",
            daysAgo: 7, durationMinutes: 38, distanceKm: 27.6, energyKWh: 6.0,
            driveCount: 2, chargeCount: 0),
        Row(id: 4774, vehicleID: 2, name: "Coastal Highway 1",
            daysAgo: 12, durationMinutes: 152, distanceKm: 168.0, energyKWh: 33.2,
            driveCount: 3, chargeCount: 1),
        Row(id: 4760, vehicleID: 2, name: nil,
            daysAgo: 14, durationMinutes: 9, distanceKm: 5.4, energyKWh: 1.3,
            driveCount: 1, chargeCount: 0),
        Row(id: 4732, vehicleID: 1, name: "Road trip (in progress)",
            daysAgo: 16, durationMinutes: nil, distanceKm: 95.0, energyKWh: 18.0,
            driveCount: 2, chargeCount: 1)
    ]
}

#if DEBUG
    /// Preview/test seam yielding no trips — drives the web empty state (`allTrips.length === 0` →
    /// the "No recent trips" `ContentUnavailableView`).
    public struct EmptySharingTripsDataSource: SharingTripsDataSource {
        public init() {}

        public func loadTrips(vehicleID _: Int64?, limit _: Int) async throws -> [SharingTrip] {
            []
        }
    }

    /// Preview/test seam whose trip load fails — drives the retryable error region.
    public struct FailingSharingTripsDataSource: SharingTripsDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadTrips(vehicleID _: Int64?, limit _: Int) async throws -> [SharingTrip] {
            throw Failure()
        }
    }
#endif
