import CoreLocation
import Foundation

// Domain models for the Map Overview page (web `MapOverviewPage.tsx` route `/live`). Every
// spatial / kinematic field is SI-canonical exactly as the API delivers it — metres, metres
// per second, watts — and is converted to the user's units only at the SwiftUI render
// boundary via the shared `Units` engine (ADR-005). Nothing non-SI is stored or computed.

/// One enrolled vehicle (web `useVehicles` row → `GET /vehicles`). The header picker binds the
/// list; the map marker callout shows the selected vehicle's `displayName`.
public struct MapOverviewVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let displayName: String

    public init(id: Int64, displayName: String) {
        self.id = id
        self.displayName = displayName
    }
}

/// One position sample (web `PositionRecord` → `GET /vehicles/{id}/positions`). Speed is SI
/// m/s, power is SI W, elevation + odometer are SI metres; heading is compass degrees.
public struct MapOverviewPosition: Identifiable, Sendable {
    public let id: Int64
    public let latitude: Double
    public let longitude: Double
    public let speedMps: Double?
    public let powerW: Double?
    public let heading: Double?
    public let elevationM: Double?
    public let odometerM: Double
    public let batteryLevel: Double
    public let createdAt: Date

    public init(
        id: Int64,
        latitude: Double,
        longitude: Double,
        speedMps: Double?,
        powerW: Double?,
        heading: Double?,
        elevationM: Double?,
        odometerM: Double,
        batteryLevel: Double,
        createdAt: Date
    ) {
        self.id = id
        self.latitude = latitude
        self.longitude = longitude
        self.speedMps = speedMps
        self.powerW = powerW
        self.heading = heading
        self.elevationM = elevationM
        self.odometerM = odometerM
        self.batteryLevel = batteryLevel
        self.createdAt = createdAt
    }

    /// The MapKit coordinate for this sample.
    public var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    /// Web `hasValidLocation` gate — a real fix that is not the null-island (0,0).
    public var hasValidLocation: Bool {
        TSGeo.isValid(coordinate)
    }
}

/// The latest location snapshot (web `LocationSnapshot` → `GET /location-snapshots/latest`).
/// `locatedAtHome` / `locatedAtWork` are tri-state (unknown until the snapshot resolves).
public struct MapOverviewLocationSnapshot: Sendable {
    public let locatedAtHome: Bool?
    public let locatedAtWork: Bool?
    public let homelinkNearby: Bool
    public let activeRoute: Bool
    public let destinationName: String
    public let createdAt: Date

    public init(
        locatedAtHome: Bool?,
        locatedAtWork: Bool?,
        homelinkNearby: Bool,
        activeRoute: Bool,
        destinationName: String,
        createdAt: Date
    ) {
        self.locatedAtHome = locatedAtHome
        self.locatedAtWork = locatedAtWork
        self.homelinkNearby = homelinkNearby
        self.activeRoute = activeRoute
        self.destinationName = destinationName
        self.createdAt = createdAt
    }
}

/// The page's top-level data state (web `PageContainer` loading / error + body), mirroring the
/// sibling pages' phase enums. `ready` is the success state in which every panel renders from
/// the bound model (each panel resolves its own empty state when its source datum is absent).
public enum MapOverviewPhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case ready
}

/// The three map sub-page affordances in the Quick Links panel (web buttons that route to
/// `/maps/navigation-route`, `/maps/geofences`, `/maps/locations`). The destinations are their
/// own parity units; this page renders the labelled navigation affordances.
public enum MapOverviewQuickLink: String, CaseIterable, Identifiable, Sendable {
    case navigationRoute
    case geofences
    case locations

    public var id: String { rawValue }

    /// The web i18n key for the button title.
    var titleKey: String {
        switch self {
        case .navigationRoute: "mapOverview.navRoute"
        case .geofences: "mapOverview.geofences"
        case .locations: "mapOverview.locations"
        }
    }

    /// The SF Symbol matching the web Lucide icon.
    var systemImage: String {
        switch self {
        case .navigationRoute: "point.topleft.down.to.point.bottomright.curvepath"
        case .geofences: "circle.dashed"
        case .locations: "location.viewfinder"
        }
    }
}

/// Staleness threshold for the live-position freshness indicator (ADR-013): a current value
/// older than two minutes is surfaced as stale.
public enum MapOverviewFreshness {
    public static let staleAfter: TimeInterval = 120
}
