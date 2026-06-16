import Foundation

/// A representative local seed used as the `NavigationRoutePage` / preview default until the KMP-backed
/// source is injected at composition time. It is NOT production telemetry — it is an
/// API-response-shaped fixture (the web `LocationSnapshot[]` shape, SI-canonical: meters + m/s) so the
/// surface renders its populated success state out of the box. The view converts at the display
/// boundary.
public struct SampleNavigationRouteDataSource: NavigationRouteDataSource {
    public init() {}

    public func loadVehicles() async throws -> [NavVehicle] {
        [
            NavVehicle(id: 1, vin: "5YJ3E1EA7KF000001", displayName: "Rocinante"),
            NavVehicle(id: 2, vin: "5YJYGDEE1LF000002", displayName: "Tachi"),
            NavVehicle(id: 3, vin: "5YJSA1E26MF000003", displayName: "Razorback")
        ]
    }

    public func loadLatest(vehicleID: Int64) async throws -> NavSnapshot? {
        let now = Date()
        switch vehicleID {
        case 2: return Self.parkedSnapshot(now)
        case 3: return Self.noFixSnapshot(now)
        default: return Self.activeRouteSnapshot(now)
        }
    }

    /// Parked at home, no active route — drives the inactive / empty branches.
    private static func parkedSnapshot(_ now: Date) -> NavSnapshot {
        NavSnapshot(
            id: 2001,
            latitude: 37.4419,
            longitude: -122.1430,
            heading: 0,
            gpsState: "gpsValid",
            elevationM: 9,
            speedMps: 0,
            routeLastUpdated: now.addingTimeInterval(-3600),
            locatedAtHome: true,
            locatedAtWork: false,
            locatedAtFavorite: true,
            homelinkNearby: true,
            createdAt: now
        )
    }

    /// Coordinates unavailable — drives the GPS-warning + location-unavailable branches.
    private static func noFixSnapshot(_ now: Date) -> NavSnapshot {
        NavSnapshot(
            id: 3001,
            latitude: 0,
            longitude: 0,
            gpsState: "noFix",
            createdAt: now
        )
    }

    /// Active route to Sand Hill Rd — drives every populated panel.
    private static func activeRouteSnapshot(_ now: Date) -> NavSnapshot {
        NavSnapshot(
            id: 1001,
            latitude: 37.7833,
            longitude: -122.4090,
            heading: 142,
            gpsState: "gpsValid",
            elevationM: 64,
            speedMps: 27.3,
            destinationName: "Sand Hill Rd, Menlo Park",
            distanceToArrivalM: 58200,
            minutesToArrival: 47,
            routeTrafficDelayS: 480,
            routeLastUpdated: now.addingTimeInterval(-90),
            destinationLat: 37.4220,
            destinationLon: -122.2010,
            originLat: 37.7833,
            originLon: -122.4090,
            locatedAtHome: false,
            locatedAtWork: false,
            locatedAtFavorite: false,
            homelinkNearby: true,
            createdAt: now
        )
    }

    public func loadHistory(vehicleID: Int64) async throws -> [NavSnapshot] {
        guard vehicleID != 3 else { return [] }
        let now = Date()
        let destinations = vehicleID == 2
            ? [nil, nil, "Home"]
            : [
                "Sand Hill Rd, Menlo Park",
                "Sand Hill Rd, Menlo Park",
                "Office, Palo Alto",
                nil,
                "Supercharger, Mountain View"
            ]
        return (0 ..< 24).map { index in
            let minutesAgo = Double((24 - index) * 12)
            let progress = Double(index) / 24
            let destination = destinations[index % destinations.count]
            let speed = 18 + 12 * sin(progress * .pi * 2)
            let remaining = max(0, 60000 - Double(index) * 2200)
            let atHome = index < 4 || (vehicleID == 2 && index > 20)
            let atWork = index >= 10 && index <= 14
            return NavSnapshot(
                id: Int64(vehicleID * 100 + Int64(index)),
                latitude: 37.78 - progress * 0.36,
                longitude: -122.41 + progress * 0.21,
                heading: (progress * 360).truncatingRemainder(dividingBy: 360),
                gpsState: "gpsValid",
                elevationM: 20 + progress * 80,
                speedMps: max(0, speed),
                destinationName: destination,
                distanceToArrivalM: destination == nil ? nil : remaining,
                minutesToArrival: destination == nil ? nil : max(0, 50 - Double(index) * 2),
                routeTrafficDelayS: destination == nil ? nil : Double(index % 5) * 120,
                routeLastUpdated: now.addingTimeInterval(-minutesAgo * 60),
                locatedAtHome: atHome,
                locatedAtWork: atWork,
                locatedAtFavorite: false,
                homelinkNearby: atHome,
                createdAt: now.addingTimeInterval(-minutesAgo * 60)
            )
        }
    }

    public func useChargingTelemetryLatest(vehicleID: Int64) async throws -> NavChargingTelemetry? {
        switch vehicleID {
        case 1: NavChargingTelemetry(expectedEnergyPctAtArrival: 62)
        case 2: NavChargingTelemetry(expectedEnergyPctAtArrival: 88)
        default: NavChargingTelemetry(expectedEnergyPctAtArrival: nil)
        }
    }
}

#if DEBUG
    /// Preview/test seam yielding a vehicle with no snapshots — drives the page's per-section empty
    /// states (web: no active route, no history, no destinations, no presence, no snapshots).
    public struct EmptyNavigationRouteDataSource: NavigationRouteDataSource {
        public init() {}

        public func loadVehicles() async throws -> [NavVehicle] {
            [NavVehicle(id: 1, vin: "5YJ3E1EA7KF000001", displayName: "Rocinante")]
        }

        public func loadLatest(vehicleID _: Int64) async throws -> NavSnapshot? {
            nil
        }

        public func loadHistory(vehicleID _: Int64) async throws -> [NavSnapshot] {
            []
        }

        public func useChargingTelemetryLatest(vehicleID _: Int64) async throws -> NavChargingTelemetry? {
            nil
        }
    }

    /// Preview/test seam with no vehicles — drives the page-level empty phase (web `vehicleId === null`).
    public struct NoVehiclesNavigationRouteDataSource: NavigationRouteDataSource {
        public init() {}

        public func loadVehicles() async throws -> [NavVehicle] {
            []
        }

        public func loadLatest(vehicleID _: Int64) async throws -> NavSnapshot? {
            nil
        }

        public func loadHistory(vehicleID _: Int64) async throws -> [NavSnapshot] {
            []
        }

        public func useChargingTelemetryLatest(vehicleID _: Int64) async throws -> NavChargingTelemetry? {
            nil
        }
    }

    /// Preview/test seam whose vehicles load fails — drives the page error phase (web `vehiclesError` →
    /// `PageContainer error`).
    public struct FailingNavigationRouteDataSource: NavigationRouteDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [NavVehicle] {
            throw Failure()
        }

        public func loadLatest(vehicleID _: Int64) async throws -> NavSnapshot? {
            throw Failure()
        }

        public func loadHistory(vehicleID _: Int64) async throws -> [NavSnapshot] {
            throw Failure()
        }

        public func useChargingTelemetryLatest(vehicleID _: Int64) async throws -> NavChargingTelemetry? {
            throw Failure()
        }
    }
#endif
