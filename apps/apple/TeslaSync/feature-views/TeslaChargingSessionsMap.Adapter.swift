//
//  TeslaChargingSessionsMap.Adapter.swift
//  TeslaSync — P4 feature view · 0120 · TeslaChargingSessionsMap (Apple)
//
//  The Foundation-only domain core for the charging-sessions map: the `safe()`
//  numeric guard, the decoded session record (parity with the web
//  `TeslaChargingSession` slice consumed by
//  features/charging/pages/TeslaChargingSessionsMap.tsx), the derived map marker
//  (web `clusterPoints[i]`), and the charger-type display normaliser. Pure +
//  `Equatable` so it unit-tests without a store or a rendered map.
//

import CoreLocation
import Foundation

// MARK: - Numeric guard

/// Native port of the implicit web numeric guards: a coordinate is plottable only
/// when it is an actual, non-`NaN` number (web
/// `typeof lat === 'number' && !Number.isNaN(lat)`).
public enum TeslaChargingSessionsMapNumeric {
    /// Whether a coordinate component is a usable, finite number (not `nil`/`NaN`).
    public static func isPlottable(_ value: Double?) -> Bool {
        guard let value else { return false }
        return !value.isNaN && value.isFinite
    }
}

// MARK: - Charger-type display (web `String(charger_type).toUpperCase()`)

/// Normalises a raw `charger_type` for display, reproducing the web popup's
/// `text-transform:uppercase` on the trimmed value. Returns `nil` when the source
/// is absent/blank so the callout row is omitted exactly like the web `charger`
/// template literal (which renders nothing when `charger_type` is falsy).
public enum TeslaChargerTypeDisplay {
    public static func uppercased(_ chargerType: String?) -> String? {
        guard let trimmed = chargerType?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty
        else { return nil }
        return trimmed.uppercased()
    }
}

// MARK: - Domain record (port of the consumed `TeslaChargingSession` fields)

/// One charging session the map plots — the native parity of the web
/// `TeslaChargingSession` fields the page reads (`session_id`,
/// `site_location_name`, `charge_start_datetime`, `total_energy_added_wh`,
/// `total_cost`, `charger_type`, `latitude`, `longitude`). Energy is SI
/// watt-hours (the canonical on-the-wire shape); the display boundary converts.
public struct TeslaChargingSessionRecord: Identifiable, Equatable, Sendable {
    /// Web `session_id` (the marker key).
    public var id: Int
    public var siteLocationName: String?
    public var startedAt: Date?
    /// Energy added in watt-hours (Wh, SI — web `total_energy_added_wh`).
    public var totalEnergyAddedWh: Double?
    public var totalCost: Double?
    public var chargerType: String?
    public var latitude: Double?
    public var longitude: Double?

    public init(
        id: Int,
        siteLocationName: String? = nil,
        startedAt: Date? = nil,
        totalEnergyAddedWh: Double? = nil,
        totalCost: Double? = nil,
        chargerType: String? = nil,
        latitude: Double? = nil,
        longitude: Double? = nil
    ) {
        self.id = id
        self.siteLocationName = siteLocationName
        self.startedAt = startedAt
        self.totalEnergyAddedWh = totalEnergyAddedWh
        self.totalCost = totalCost
        self.chargerType = chargerType
        self.latitude = latitude
        self.longitude = longitude
    }

    /// Whether this session has a plottable coordinate (web `clusterPoints` filter).
    public var isPlottable: Bool {
        TeslaChargingSessionsMapNumeric.isPlottable(latitude)
            && TeslaChargingSessionsMapNumeric.isPlottable(longitude)
    }
}

// MARK: - Derived marker (port of the web `clusterPoints[i]`)

/// A single plotted marker derived from a plottable session. Holds the resolved
/// coordinate plus the raw fields the callout/label layer formats. Coordinates
/// are stored as `Double`s (so the value type stays `Sendable`/`Equatable`); the
/// `CLLocationCoordinate2D` is computed for MapKit.
public struct TeslaChargingSessionMarker: Identifiable, Equatable, Sendable {
    public var id: Int
    public var latitude: Double
    public var longitude: Double
    public var siteLocationName: String?
    public var startedAt: Date?
    public var energyWh: Double?
    public var cost: Double?
    public var chargerType: String?

    public init(
        id: Int,
        latitude: Double,
        longitude: Double,
        siteLocationName: String? = nil,
        startedAt: Date? = nil,
        energyWh: Double? = nil,
        cost: Double? = nil,
        chargerType: String? = nil
    ) {
        self.id = id
        self.latitude = latitude
        self.longitude = longitude
        self.siteLocationName = siteLocationName
        self.startedAt = startedAt
        self.energyWh = energyWh
        self.cost = cost
        self.chargerType = chargerType
    }

    /// The MapKit coordinate for this marker.
    public var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    /// Builds a marker from a plottable session, carrying its display source
    /// fields. Returns `nil` when the session has no usable coordinate (so the
    /// caller reproduces the web `clusterPoints` filter exactly).
    public static func from(_ session: TeslaChargingSessionRecord) -> TeslaChargingSessionMarker? {
        guard session.isPlottable, let latitude = session.latitude, let longitude = session.longitude else {
            return nil
        }
        return TeslaChargingSessionMarker(
            id: session.id,
            latitude: latitude,
            longitude: longitude,
            siteLocationName: session.siteLocationName,
            startedAt: session.startedAt,
            energyWh: session.totalEnergyAddedWh,
            cost: session.totalCost,
            chargerType: session.chargerType
        )
    }
}
