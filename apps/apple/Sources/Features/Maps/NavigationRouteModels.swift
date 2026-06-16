import Foundation

// MARK: - Vehicle (web `useQuery(['vehicles'])` → GET /vehicles)

/// One selectable vehicle (web `vehicle.display_name || vehicle.vin`). Identity + label strings, not
/// SI measurements, so they round-trip verbatim.
public struct NavVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let vin: String
    public let displayName: String

    public init(id: Int64, vin: String, displayName: String) {
        self.id = id
        self.vin = vin
        self.displayName = displayName
    }

    /// Web `vehicle.display_name || vehicle.vin` — the label shown in the selector.
    public var name: String {
        displayName.isEmpty ? vin : displayName
    }
}

// MARK: - GPS fix quality (web `normalizeGpsState`)

/// Normalized GPS fix quality (web `GpsFixState`): the snapshot's free-form `gps_state` collapsed to a
/// known set so the status card can flag a true lock. `locked` drives the card's active styling
/// (web `fix === 'locked'`).
public enum NavGpsFix: String, Sendable {
    case locked
    case unlocked
    case unknown

    /// Web `normalizeGpsState(raw)`.
    public static func normalize(_ raw: String?) -> NavGpsFix {
        guard let raw else { return .unknown }
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !value.isEmpty else { return .unknown }
        switch value {
        case "true", "1", "yes", "gpsvalid", "fix2d", "fix3d", "normal", "good", "strong", "ok", "valid":
            return .locked
        case "false", "0", "no", "gpsinvalid", "nofix", "invalid", "none":
            return .unlocked
        default:
            return .unknown
        }
    }
}

// MARK: - Location snapshot (web `LocationSnapshot`; SI-canonical)

/// One location snapshot (web `LocationSnapshot`). The `/location-snapshots` feed emits SI values under
/// legacy field names (`speed_mph` is m/s; `miles_to_arrival` is meters) — this type stores the SI
/// values directly (`speedMps`, `distanceToArrivalM`) and the display boundary converts to the user's
/// unit preference (web's pre-existing 1609× inflation bug is therefore impossible here).
public struct NavSnapshot: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let latitude: Double?
    public let longitude: Double?
    public let heading: Double?
    public let gpsState: String?
    public let elevationM: Double?
    /// Web `speed_mph` — actually m/s SI.
    public let speedMps: Double?
    public let destinationName: String?
    /// Web `miles_to_arrival` — actually meters SI.
    public let distanceToArrivalM: Double?
    public let minutesToArrival: Double?
    public let routeTrafficDelayS: Double?
    public let routeLastUpdated: Date?
    public let destinationLat: Double?
    public let destinationLon: Double?
    public let originLat: Double?
    public let originLon: Double?
    public let locatedAtHome: Bool?
    public let locatedAtWork: Bool?
    public let locatedAtFavorite: Bool?
    public let homelinkNearby: Bool?
    public let createdAt: Date

    public init(
        id: Int64,
        latitude: Double? = nil,
        longitude: Double? = nil,
        heading: Double? = nil,
        gpsState: String? = nil,
        elevationM: Double? = nil,
        speedMps: Double? = nil,
        destinationName: String? = nil,
        distanceToArrivalM: Double? = nil,
        minutesToArrival: Double? = nil,
        routeTrafficDelayS: Double? = nil,
        routeLastUpdated: Date? = nil,
        destinationLat: Double? = nil,
        destinationLon: Double? = nil,
        originLat: Double? = nil,
        originLon: Double? = nil,
        locatedAtHome: Bool? = nil,
        locatedAtWork: Bool? = nil,
        locatedAtFavorite: Bool? = nil,
        homelinkNearby: Bool? = nil,
        createdAt: Date
    ) {
        self.id = id
        self.latitude = latitude
        self.longitude = longitude
        self.heading = heading
        self.gpsState = gpsState
        self.elevationM = elevationM
        self.speedMps = speedMps
        self.destinationName = destinationName
        self.distanceToArrivalM = distanceToArrivalM
        self.minutesToArrival = minutesToArrival
        self.routeTrafficDelayS = routeTrafficDelayS
        self.routeLastUpdated = routeLastUpdated
        self.destinationLat = destinationLat
        self.destinationLon = destinationLon
        self.originLat = originLat
        self.originLon = originLon
        self.locatedAtHome = locatedAtHome
        self.locatedAtWork = locatedAtWork
        self.locatedAtFavorite = locatedAtFavorite
        self.homelinkNearby = homelinkNearby
        self.createdAt = createdAt
    }

    /// Web `gps_state` collapsed to a normalized fix quality.
    public var gpsFix: NavGpsFix {
        NavGpsFix.normalize(gpsState)
    }

    /// Web `hasValidLocation` — non-nil, non-zero coordinates.
    public var hasValidLocation: Bool {
        guard let latitude, let longitude else { return false }
        return latitude != 0 || longitude != 0
    }
}

// MARK: - Charging telemetry (web `useChargingTelemetryLatest` → GET /charging-telemetry/latest)

/// The latest charging-telemetry datum the page consumes (web `useChargingTelemetryLatest`): the
/// projected battery percentage at the active route's destination. The parity manifest's single named
/// data source.
public struct NavChargingTelemetry: Hashable, Sendable {
    public let expectedEnergyPctAtArrival: Double?

    public init(expectedEnergyPctAtArrival: Double?) {
        self.expectedEnergyPctAtArrival = expectedEnergyPctAtArrival
    }
}

// MARK: - Waypoint (web `Waypoint` / `buildWaypoints`)

/// One route waypoint (web `Waypoint`). `distanceM` is SI meters (web `buildWaypoints` carries the SI
/// `miles_to_arrival`), converted at the display boundary.
public struct NavWaypoint: Identifiable, Hashable, Sendable {
    public enum Kind: String, Sendable {
        case supercharger
        case destination
        case waypoint
    }

    public let name: String
    public let kind: Kind
    public let distanceM: Double

    public init(name: String, kind: Kind, distanceM: Double) {
        self.name = name
        self.kind = kind
        self.distanceM = distanceM
    }

    public var id: String {
        "\(name)-\(distanceM)"
    }
}

// MARK: - Recent destination (web `recentDestinations`)

/// One recent-destination row (web `recentDestinations`). `distanceM` is SI meters; `etaMinutes` is the
/// snapshot's `minutes_to_arrival`.
public struct NavDestination: Identifiable, Hashable, Sendable {
    public let time: Date
    public let destination: String
    public let distanceM: Double
    public let etaMinutes: Double

    public init(time: Date, destination: String, distanceM: Double, etaMinutes: Double) {
        self.time = time
        self.destination = destination
        self.distanceM = distanceM
        self.etaMinutes = etaMinutes
    }

    public var id: String {
        "\(time.timeIntervalSince1970)-\(destination)"
    }
}

// MARK: - Presence sample (web `presenceChartData`)

/// One home/work/homelink presence sample over time (web `presenceChartData`), each flag as 0/1.
public struct NavPresenceSample: Identifiable, Hashable, Sendable {
    public let time: Date
    public let home: Bool
    public let work: Bool
    public let homelink: Bool

    public init(time: Date, home: Bool, work: Bool, homelink: Bool) {
        self.time = time
        self.home = home
        self.work = work
        self.homelink = homelink
    }

    public var id: String {
        "\(time.timeIntervalSince1970)"
    }
}

// MARK: - Data source seam (web hooks)

/// Supplies every datum the page renders. The production implementation binds the shared KMP
/// repositories/use-cases (ADR-004 — the view holds no networking); previews and tests inject doubles
/// to drive the loading / empty / error / success states.
///
/// Method ↔ web hook map (the manifest's named hook keeps its name at the Swift call site):
/// `loadVehicles` ← `useQuery(['vehicles'])`/`GET /vehicles`;
/// `loadLatest` ← `useQuery(['location-latest'])`/`GET /location-snapshots/latest?vehicle_id`;
/// `loadHistory` ← `useQuery(['location-history'])`/`GET /location-snapshots?vehicle_id&limit=200`;
/// `useChargingTelemetryLatest` ← `useChargingTelemetryLatest`/`GET /charging-telemetry/latest?vehicle_id`.
public protocol NavigationRouteDataSource: Sendable {
    func loadVehicles() async throws -> [NavVehicle]
    func loadLatest(vehicleID: Int64) async throws -> NavSnapshot?
    func loadHistory(vehicleID: Int64) async throws -> [NavSnapshot]
    func useChargingTelemetryLatest(vehicleID: Int64) async throws -> NavChargingTelemetry?
}

// MARK: - Page phase (web `vehiclesLoading ? Loading : vehiclesError ? Error : vehicleId ? content : —`)

/// The page's terminal phase (web `PageContainer` phases). `.empty` is a successful vehicles load with
/// no vehicle selected (web `vehicleId === null` — the whole body is gated off); `.error` is a retryable
/// vehicles-load failure (web `PageContainer error`); `.ready` renders every section, each of which
/// surfaces its own loading / empty / error region.
public enum NavigationRoutePhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case ready
}
