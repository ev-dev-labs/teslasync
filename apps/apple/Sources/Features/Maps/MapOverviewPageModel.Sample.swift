import Foundation

// Local, API-response-shaped seed data for the Map Overview page. It is the page / preview
// default until the KMP-backed source is injected at composition time (P1/S8), mirroring the
// sibling features' `Sample*DataSource`s. It is NOT production telemetry — it is a realistic
// fixture (a recent vehicle trail with a fresh current fix and an at-home snapshot) so every
// panel renders its populated success state out of the box. Coordinates stay raw; speed is
// SI m/s, power is SI W, odometer is SI metres exactly as the API delivers — the view converts
// at the render boundary.

/// A short, plausible recent route used to seed the sample source + previews.
enum MapOverviewSampleRoute {
    static let pointCount = 18
    private static let baseLat = 37.7749
    private static let baseLon = -122.4194

    /// The recent history in the API's most-recent-first order (index 0 = freshest fix).
    static func history(now: Date, vehicleID: Int64) -> [MapOverviewPosition] {
        let chronological = (0 ..< pointCount).map { step in
            point(step: step, now: now, vehicleID: vehicleID)
        }
        return Array(chronological.reversed())
    }

    /// One chronological sample (`step` ascending in time; the last step is the current fix).
    private static func point(step: Int, now: Date, vehicleID: Int64) -> MapOverviewPosition {
        let lastStep = Double(pointCount - 1)
        let fraction = lastStep > 0 ? Double(step) / lastStep : 0
        let lonShift = vehicleID == 2 ? 0.018 : 0
        let latitude = baseLat + fraction * 0.052 + sin(fraction * .pi * 2) * 0.004
        let longitude = baseLon + fraction * 0.061 + lonShift
        let speedMps = 9 + sin(fraction * .pi) * 17
        let secondsAgo = (lastStep - Double(step)) * 60
        return MapOverviewPosition(
            id: vehicleID * 1000 + Int64(step),
            latitude: latitude,
            longitude: longitude,
            speedMps: speedMps,
            powerW: 4_000 + cos(fraction * .pi) * 22_000,
            heading: Double((step * 27 + 40) % 360),
            elevationM: 12 + sin(fraction * .pi * 1.5) * 60,
            odometerM: 48_280_000 + Double(step) * 920,
            batteryLevel: 86 - fraction * 12,
            createdAt: now.addingTimeInterval(-secondsAgo)
        )
    }

    /// The current at-home snapshot the location-details panel reads.
    static func snapshot(now: Date) -> MapOverviewLocationSnapshot {
        MapOverviewLocationSnapshot(
            locatedAtHome: true,
            locatedAtWork: false,
            homelinkNearby: true,
            activeRoute: false,
            destinationName: "Home",
            createdAt: now.addingTimeInterval(-45)
        )
    }

    static let vehicles: [MapOverviewVehicle] = [
        MapOverviewVehicle(id: 1, displayName: "Rocinante"),
        MapOverviewVehicle(id: 2, displayName: "Tachi")
    ]
}

/// An error the failing seed throws to exercise the page's retryable error state.
struct MapOverviewSampleError: LocalizedError {
    var errorDescription: String? { "The map data source is unavailable." }
}

/// The populated success seed (the page / preview default).
public struct SampleMapOverviewDataSource: MapOverviewDataSource {
    private let now: Date

    public init(now: Date = Date()) {
        self.now = now
    }

    public func loadVehicles() async throws -> [MapOverviewVehicle] {
        MapOverviewSampleRoute.vehicles
    }

    public func loadLatestPosition(vehicleID: Int64) async throws -> MapOverviewPosition? {
        MapOverviewSampleRoute.history(now: now, vehicleID: vehicleID).first
    }

    public func loadHistory(vehicleID: Int64) async throws -> [MapOverviewPosition] {
        MapOverviewSampleRoute.history(now: now, vehicleID: vehicleID)
    }

    public func loadLocationSnapshot(vehicleID _: Int64) async throws -> MapOverviewLocationSnapshot? {
        MapOverviewSampleRoute.snapshot(now: now)
    }
}

/// A seed with enrolled vehicles but no position / snapshot yet — drives every panel's own
/// empty state inside the page success state (web "No GPS data available").
public struct EmptyMapOverviewDataSource: MapOverviewDataSource {
    public init() {}

    public func loadVehicles() async throws -> [MapOverviewVehicle] {
        MapOverviewSampleRoute.vehicles
    }

    public func loadLatestPosition(vehicleID _: Int64) async throws -> MapOverviewPosition? { nil }
    public func loadHistory(vehicleID _: Int64) async throws -> [MapOverviewPosition] { [] }
    public func loadLocationSnapshot(vehicleID _: Int64) async throws -> MapOverviewLocationSnapshot? { nil }
}

/// A seed with no enrolled vehicles — drives the page-level empty state (web `NoVehicleSelected`).
public struct NoVehiclesMapOverviewDataSource: MapOverviewDataSource {
    public init() {}

    public func loadVehicles() async throws -> [MapOverviewVehicle] { [] }
    public func loadLatestPosition(vehicleID _: Int64) async throws -> MapOverviewPosition? { nil }
    public func loadHistory(vehicleID _: Int64) async throws -> [MapOverviewPosition] { [] }
    public func loadLocationSnapshot(vehicleID _: Int64) async throws -> MapOverviewLocationSnapshot? { nil }
}

/// A seed whose vehicle fetch fails — drives the retryable page error state.
public struct FailingMapOverviewDataSource: MapOverviewDataSource {
    public init() {}

    public func loadVehicles() async throws -> [MapOverviewVehicle] { throw MapOverviewSampleError() }
    public func loadLatestPosition(vehicleID _: Int64) async throws -> MapOverviewPosition? { nil }
    public func loadHistory(vehicleID _: Int64) async throws -> [MapOverviewPosition] { [] }
    public func loadLocationSnapshot(vehicleID _: Int64) async throws -> MapOverviewLocationSnapshot? { nil }
}

/// A seed whose current fix is older than two minutes — drives the stale-data indicator (ADR-013).
public struct StaleMapOverviewDataSource: MapOverviewDataSource {
    private let now: Date

    public init(now: Date = Date()) {
        self.now = now
    }

    public func loadVehicles() async throws -> [MapOverviewVehicle] {
        MapOverviewSampleRoute.vehicles
    }

    public func loadLatestPosition(vehicleID: Int64) async throws -> MapOverviewPosition? {
        MapOverviewSampleRoute.history(now: now.addingTimeInterval(-300), vehicleID: vehicleID).first
    }

    public func loadHistory(vehicleID: Int64) async throws -> [MapOverviewPosition] {
        MapOverviewSampleRoute.history(now: now.addingTimeInterval(-300), vehicleID: vehicleID)
    }

    public func loadLocationSnapshot(vehicleID _: Int64) async throws -> MapOverviewLocationSnapshot? {
        MapOverviewSampleRoute.snapshot(now: now.addingTimeInterval(-300))
    }
}
