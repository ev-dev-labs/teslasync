import Foundation

/// A representative local seed used as the `LocationsPage` / preview default until the KMP-backed
/// source is injected at composition time. It is NOT production telemetry — it is an
/// API-response-shaped fixture (3 vehicles, each with a rank-ordered list of visited places,
/// including a few unnamed rows that surface the AI auto-name affordance) so the surface renders
/// its populated success state out of the box. Durations are SI canonical (seconds); the view
/// converts at the boundary.
public struct SampleLocationsDataSource: LocationsDataSource {
    public init() {}

    public func loadVehicles() async throws -> [LocationsPageVehicle] {
        [
            LocationsPageVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001"),
            LocationsPageVehicle(id: 2, displayName: "Tachi", vin: "5YJYGDEE1LF000002"),
            LocationsPageVehicle(id: 3, displayName: "Razorback", vin: "5YJSA1E26MF000003")
        ]
    }

    public func loadLocations(vehicleID: Int64, limit: Int, offset: Int) async throws -> [VisitedLocation] {
        let all = SampleLocationsDataSource.locations(vehicleID: vehicleID)
        guard offset < all.count else { return [] }
        let upper = min(offset + limit, all.count)
        return Array(all[offset ..< upper])
    }

    /// Builds a deterministic, rank-ordered (visits descending) list of visited places for a
    /// vehicle, with recent `last_visited` dates and a few unnamed rows (empty / "Unknown" /
    /// coordinate-pair) so the AI auto-name affordance and the unnamed-detection both render.
    static func locations(vehicleID: Int64) -> [VisitedLocation] {
        let seed = Double(vehicleID)
        return seeds.enumerated().map { index, row in
            row.location(vehicleID: vehicleID, index: index, seed: seed)
        }
    }

    private static let seeds: [SampleLocationSeed] = [
        SampleLocationSeed(name: "Home - 1200 Alpine Way, Seattle", visits: 312, durationS: 4_104_000, recencyDays: 0),
        SampleLocationSeed(name: "Work - 410 Terry Ave N, Seattle", visits: 188, durationS: 2_268_000, recencyDays: 1),
        SampleLocationSeed(name: "Supercharger - Centralia, WA", visits: 64, durationS: 172_800, recencyDays: 2),
        SampleLocationSeed(name: "Whole Foods - Roosevelt, Seattle", visits: 47, durationS: 84600, recencyDays: 3),
        SampleLocationSeed(name: "Gym - Green Lake, Seattle", visits: 39, durationS: 140_400, recencyDays: 5),
        SampleLocationSeed(name: "Mom's House - 88 Pine St, Tacoma", visits: 28, durationS: 201_600, recencyDays: 8),
        SampleLocationSeed(name: "Trailhead - Mount Si, North Bend", visits: 17, durationS: 122_400, recencyDays: 12),
        SampleLocationSeed(name: "Unknown", visits: 11, durationS: 39600, recencyDays: 15),
        SampleLocationSeed(name: "47.6062, -122.3321", visits: 8, durationS: 21600, recencyDays: 20),
        SampleLocationSeed(name: "Beach - Alki Point, Seattle", visits: 6, durationS: 43200, recencyDays: 26),
        SampleLocationSeed(name: "", visits: 4, durationS: 10800, recencyDays: 33),
        SampleLocationSeed(name: "Airport - SEA Cell Lot", visits: 3, durationS: 9000, recencyDays: 41)
    ]
}

/// A single sample-location seed (the production source maps the live API instead). Named fields
/// keep the fixture readable, and `location(vehicleID:index:seed:)` scales it deterministically per
/// vehicle into an SI `VisitedLocation`.
private struct SampleLocationSeed {
    let name: String
    let visits: Int
    let durationS: Double
    let recencyDays: Int

    func location(vehicleID: Int64, index: Int, seed: Double) -> VisitedLocation {
        let calendar = Calendar(identifier: .gregorian)
        let anchor = calendar.startOfDay(for: Date(timeIntervalSince1970: 1_780_000_000))
        let date = calendar.date(byAdding: .day, value: -(recencyDays + Int(seed)), to: anchor) ?? anchor
        return VisitedLocation(
            id: Int64(vehicleID) * 100 + Int64(index),
            addressName: name,
            visitCount: max(1, visits + Int(seed) * 3 - index),
            totalDurationS: durationS + seed * 7200,
            lastVisited: date
        )
    }
}

#if DEBUG
    /// Preview/test seam yielding a single vehicle with no visited locations — drives the page's
    /// no-data empty state (web `!locations?.length` list EmptyState + each chart's own empty).
    public struct EmptyLocationsDataSource: LocationsDataSource {
        public init() {}

        public func loadVehicles() async throws -> [LocationsPageVehicle] {
            [LocationsPageVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadLocations(vehicleID _: Int64, limit _: Int, offset _: Int) async throws -> [VisitedLocation] {
            []
        }
    }

    /// Preview/test seam whose locations query fails — drives the error state (web
    /// `PageContainer` error region with Retry).
    public struct FailingLocationsDataSource: LocationsDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [LocationsPageVehicle] {
            [LocationsPageVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadLocations(vehicleID _: Int64, limit _: Int, offset _: Int) async throws -> [VisitedLocation] {
            throw Failure()
        }
    }
#endif
