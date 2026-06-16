import Foundation

// Value types for the Locations surface (web `LocationsPage.tsx`, route `/locations`).
// Visit durations are SI canonical — seconds — exactly as the backend `/locations` endpoint
// returns them (web `total_duration_s`); the user's duration unit preference is applied only at
// the SwiftUI render boundary via `Units` (ADR-005, SI-cutover instructions). Identity + address
// label strings are not measurements, so they round-trip verbatim.

// MARK: - Vehicle (web `useSelectedVehicle` → `GET /vehicles`)

/// One selectable vehicle (web `vehicle.display_name || vehicle.vin`).
public struct LocationsPageVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let displayName: String
    public let vin: String

    public init(id: Int64, displayName: String, vin: String) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
    }

    /// Web `vehicle.display_name || vehicle.vin` — the label shown in the selector.
    public var name: String {
        displayName.isEmpty ? vin : displayName
    }
}

// MARK: - Visited location (web `VisitedLocation` → `GET /locations?vehicle_id&limit&offset`)

/// One visited place for a vehicle (web `VisitedLocation`). `visitCount` ← `visit_count`,
/// `totalDurationS` ← `total_duration_s` (SI seconds), `lastVisited` ← `last_visited` (nullable).
public struct VisitedLocation: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let addressName: String
    public let visitCount: Int
    public let totalDurationS: Double
    public let lastVisited: Date?

    public init(id: Int64, addressName: String, visitCount: Int, totalDurationS: Double, lastVisited: Date?) {
        self.id = id
        self.addressName = addressName
        self.visitCount = visitCount
        self.totalDurationS = totalDurationS
        self.lastVisited = lastVisited
    }

    /// Web `loc.visit_count > 0 ? loc.total_duration_s / loc.visit_count : 0` — mean dwell per visit
    /// (SI seconds), shown in the per-row "~avg" caption.
    public var averageDurationS: Double {
        visitCount > 0 ? totalDurationS / Double(visitCount) : 0
    }

    /// Web `isUnnamedLocation(loc.address_name)` — whether this row should surface the AI
    /// auto-name affordance.
    public var isUnnamed: Bool {
        LocationsNaming.isUnnamed(addressName)
    }
}

// MARK: - Unnamed detection (web `isUnnamedLocation`)

/// Ports the web `isUnnamedLocation` heuristic verbatim. Three buckets count as "unnamed": an
/// empty/whitespace label, the literal "Unknown" sentinel the reverse-geocoder emits, and the
/// coordinate-pair fallback the geocoder emits when reverse-geocode fails. The AI auto-name
/// affordance is only worth offering when the existing label is unhelpful.
public enum LocationsNaming {
    /// Two signed decimals separated by a comma (optional surrounding whitespace) and nothing else,
    /// e.g. `"47.6062,-122.3321"` or `"47.6062, -122.3321"` (web regex
    /// `^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$`).
    private static let coordinatePattern =
        #"^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$"#

    public static func isUnnamed(_ addressName: String) -> Bool {
        let trimmed = addressName.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return true }
        if trimmed.lowercased() == "unknown" { return true }
        return trimmed.range(of: coordinatePattern, options: .regularExpression) != nil
    }

    /// Web `address_name.split(',').map(trim)` → last segment as the city (the first segment when
    /// there's only one), dropping the `"Unknown"` sentinel. Used to count `Unique Cities`.
    public static func city(of addressName: String) -> String? {
        let parts = addressName.split(separator: ",", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
        let city = parts.count > 1 ? parts[parts.count - 1] : parts.first ?? ""
        guard !city.isEmpty, city != "Unknown" else { return nil }
        return city
    }
}

// MARK: - Applied AI name hand-off (web `appliedName`)

/// The pending AI-proposed name hand-off (web `appliedName`): when the user applies an AI proposal
/// for a location, the proposed name is parked here keyed by `locationID`, and the row shows the
/// "ready to save" confirmation. The AI panel itself never persists — this is propose-only.
public struct AppliedLocationName: Equatable, Sendable {
    public let locationID: Int64
    public let name: String

    public init(locationID: Int64, name: String) {
        self.locationID = locationID
        self.name = name
    }
}
