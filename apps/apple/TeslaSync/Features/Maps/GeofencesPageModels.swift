//
//  GeofencesPageModels.swift
//  TeslaSync — P4 feature view · P7 · maps/Geofences (Apple) — Data Models
//
//  Wire-faithful Swift peers of the web Geofences contract. Field names mirror
//  web/src/types/location.ts (`Geofence`) and the form schema in
//  web/src/features/maps/schemas/geofence.ts. Coordinates are decimal degrees and
//  the radius is in metres (SI on disk, exactly as the /geofences endpoint serves);
//  any display formatting happens only at the render boundary in `GeofencesFormat`.
//  Types are prefixed `Geofences*` / `GeofenceZone` to avoid colliding with the
//  many existing `Geofence*` symbols (the GeofenceDrawer modal, GeofenceWidget,
//  the automation `Geofence` adapter, …) across the Apple target.
//

import Foundation

// MARK: - Wire model (web `Geofence`)

/// One geofence zone — `GET /geofences`. The web `Geofence` carries `id` as a
/// string (legacy) and camelCase alert flags; the radius is metres (SI).
struct GeofenceZone: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    let latitude: Double
    let longitude: Double
    /// Radius in metres (SI — web `radius`).
    let radius: Double
    let alertOnEntry: Bool
    let alertOnExit: Bool
    let enabled: Bool
    /// Optional charge rate in $/kWh (web `costPerKwh: number | null`).
    let costPerKwh: Double?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case latitude
        case longitude
        case radius
        case alertOnEntry
        case alertOnExit
        case enabled
        case costPerKwh
        case createdAt
    }

    /// The combined alert kind (web `getAlertType`).
    var alertKind: GeofencesAlertKind {
        if alertOnEntry, alertOnExit { return .both }
        if alertOnEntry { return .entry }
        if alertOnExit { return .exit }
        return .none
    }
}

// MARK: - Create/update payload (web `GeofencePayload` + costPerKwh)

/// The wire payload posted on create/update (web `toGeofencePayload` result, plus
/// `costPerKwh: null`). Numeric coordinates + metre radius + boolean alert flags.
struct GeofenceZonePayload: Codable, Equatable {
    let name: String
    let latitude: Double
    let longitude: Double
    let radius: Double
    let alertOnEntry: Bool
    let alertOnExit: Bool
    let enabled: Bool
    let costPerKwh: Double?
}

// MARK: - Alert kind (web `GeofenceAlertType`)

/// Whether a geofence raises entry, exit, both, or no alerts (web alert type).
enum GeofencesAlertKind: String, CaseIterable, Identifiable, Equatable {
    case entry
    case exit
    case both
    case none

    var id: String {
        rawValue
    }

    /// `alertOnEntry` derived from the combined kind (web `toGeofencePayload`).
    var alertOnEntry: Bool {
        self == .entry || self == .both
    }

    /// `alertOnExit` derived from the combined kind (web `toGeofencePayload`).
    var alertOnExit: Bool {
        self == .exit || self == .both
    }

    /// The badge label (web `alertBadgeLabel`).
    var badgeLabel: String {
        switch self {
        case .both: String(localized: "Entry & Exit", defaultValue: "Entry & Exit")
        case .entry: String(localized: "Entry", defaultValue: "Entry")
        case .exit: String(localized: "Exit", defaultValue: "Exit")
        case .none: String(localized: "None", defaultValue: "None")
        }
    }

    /// The picker option label (web `ALERT_OPTIONS`).
    var optionLabel: String {
        switch self {
        case .entry: String(localized: "Entry", defaultValue: "Entry")
        case .exit: String(localized: "Exit", defaultValue: "Exit")
        case .both: String(localized: "Entry & Exit", defaultValue: "Entry & Exit")
        case .none: String(localized: "None", defaultValue: "None")
        }
    }
}

// MARK: - Location source (web `LocationSource`)

/// The "Use Current Location" source tab in the create modal (web `LocationSource`).
enum GeofencesLocationSource: String, CaseIterable, Identifiable, Equatable {
    case vehicle
    case browser
    case map

    var id: String {
        rawValue
    }

    /// The tab label (web `Tabs` labels with their leading emoji).
    var tabLabel: String {
        switch self {
        case .vehicle: "🚗 " + String(localized: "geofences.vehicle", defaultValue: "Vehicle")
        case .browser: "📱 " + String(localized: "geofences.browser", defaultValue: "Browser")
        case .map: "🗺️ " + String(localized: "geofences.drawOnMap", defaultValue: "Draw on map")
        }
    }
}

// MARK: - Vehicle identity (web `useVehicles` roster)

/// Minimal vehicle identity for the location picker (web `display_name` + `vin`).
struct GeofencesVehicle: Codable, Identifiable, Equatable {
    let id: Int64
    let vin: String
    let displayName: String

    enum CodingKeys: String, CodingKey {
        case id
        case vin
        case displayName = "display_name"
    }

    /// The picker label (web `v.display_name || v.vin`).
    var optionLabel: String {
        displayName.isEmpty ? vin : displayName
    }
}

// MARK: - Vehicle position (web `Position`, /vehicles/{id}/positions)

/// A single vehicle position sample (web `Position`) used by the "Vehicle"
/// location source. Coordinates are decimal degrees.
struct GeofencesVehiclePosition: Codable, Equatable {
    let latitude: Double
    let longitude: Double
}

// MARK: - Pinned item (web `usePinned('geofence')`)

/// A pinned-geofence ordering record (web `usePinned` row): the geofence id and
/// its pin position, used to float pinned fences to the top of the list.
struct GeofencesPinnedItem: Codable, Identifiable, Equatable {
    let itemID: String
    let position: Int

    var id: String {
        itemID
    }

    enum CodingKeys: String, CodingKey {
        case itemID = "item_id"
        case position
    }
}

// MARK: - Summary stats (web `stats` memo)

/// The four summary counts surfaced in the metric cards (web `stats`).
struct GeofencesStats: Equatable {
    let total: Int
    let active: Int
    let entryAlerts: Int
    let exitAlerts: Int

    static let zero = GeofencesStats(total: 0, active: 0, entryAlerts: 0, exitAlerts: 0)
}

// MARK: - Form field identity (web `keyof GeofenceFormData`)

/// The editable form fields, used to key inline validation errors (web
/// `fieldErrors`).
enum GeofencesFormField: String, Hashable {
    case name
    case latitude
    case longitude
    case radius
}

// MARK: - Form state (web `GeofenceFormData`)

/// The controlled create/edit form (web `GeofenceFormData`) — coordinates and
/// radius are held as the literal strings the inputs bind to and parsed to the
/// numeric payload on submit.
struct GeofencesFormData: Equatable {
    var name: String = ""
    var latitude: String = ""
    var longitude: String = ""
    var radius: String = "100"
    var alertType: GeofencesAlertKind = .both
    var enabled: Bool = true

    /// The web `EMPTY_FORM`.
    static let empty = GeofencesFormData()

    /// Whether every required input carries a non-empty value (web
    /// `hasMinimalInput`) — drives the save button's enabled state.
    var hasMinimalInput: Bool {
        let fields = [name, latitude, longitude, radius]
        return fields.allSatisfy { !GeofencesText.trim($0).isEmpty }
    }
}

// MARK: - Text helper (web `.trim()` — namespaced to avoid a global String extension)

/// Small text utilities scoped to the Geofences surface so the page never adds a
/// module-wide `String` extension (the Apple target already carries several).
enum GeofencesText {
    /// Whitespace-trimmed copy (web `.trim()`).
    static func trim(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
