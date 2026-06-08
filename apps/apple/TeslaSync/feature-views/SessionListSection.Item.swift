//
//  SessionListSection.Item.swift
//  TeslaSync — P4 feature view · 0106 · SessionListSection (Apple)
//
//  The display-ready session model + the charger-category / sort / filter enums the
//  surface consumes — the native parity of the web `ChargingSession` and the
//  `SortKey` / `ChargerFilter` types in
//  features/charging/components/charging-list/helpers.ts plus
//  lib/chargingAggregation.ts:getChargerCategory. Pure Foundation; the per-item
//  derivations delegate to `SessionListProjection` (SessionListSection.Adapter.swift)
//  so the math is defined and tested once.
//
//  SI on disk: energy is in Wh and power in W (ADR — SI canonical). kWh / kW are
//  derived only at the read boundary by the computed accessors here, exactly like the
//  web `total_energy_added_wh / 1000`.
//

import Foundation

// MARK: - Charger category (web `getChargerCategory`)

/// The coarse charger classification used by the filter pills, the row badge, and
/// the search match — the port of `lib/chargingAggregation.ts:getChargerCategory`.
/// A `nil`/empty `charger_type` historically means home AC.
public enum SessionChargerCategory: String, Sendable, Equatable, CaseIterable, Identifiable {
    case home
    case supercharger
    case dc
    case unknown

    public var id: String {
        rawValue
    }

    /// Maps a raw `charger_type` string to a category, matching the web substring
    /// rules in order (super/tpc → supercharger; dc/ccs/chademo/fast → dc;
    /// home/ac/wall → home; otherwise unknown).
    public static func from(_ type: String?) -> SessionChargerCategory {
        guard let raw = type, !raw.isEmpty else { return .home }
        let lowered = raw.lowercased()
        if lowered.contains("super") || lowered.contains("tpc") { return .supercharger }
        if lowered.contains("dc") || lowered.contains("ccs")
            || lowered.contains("chademo") || lowered.contains("fast") { return .dc }
        if lowered.contains("home") || lowered.contains("ac") || lowered.contains("wall") { return .home }
        return .unknown
    }

    /// The i18n key the badge label resolves through (web `chargerTypes.*`).
    public var localizationKey: String {
        switch self {
        case .supercharger: "charging.chargerTypes.supercharger"
        case .dc: "charging.chargerTypes.dc"
        case .home: "charging.chargerTypes.home"
        case .unknown: "charging.chargerTypes.unknown"
        }
    }

    /// The web English fallback for `localizationKey`.
    public var fallback: String {
        switch self {
        case .supercharger: "Supercharger"
        case .dc: "DC Fast"
        case .home: "Home / AC"
        case .unknown: "Charger"
        }
    }
}

// MARK: - Sort + filter keys (web `SortKey` / `ChargerFilter`)

/// The session sort dimension (web `SortKey`). The label keys mirror the web pill
/// captions (`Date` / `kWh` / `Cost` / `Time` / `Power`).
public enum SessionSortKey: String, Sendable, Equatable, CaseIterable, Identifiable {
    case date
    case energy
    case cost
    case duration
    case power

    public var id: String {
        rawValue
    }

    public var localizationKey: String {
        switch self {
        case .date: "charging.sessions.sortDate"
        case .energy: "charging.sessions.sortEnergy"
        case .cost: "charging.sessions.sortCost"
        case .duration: "charging.sessions.sortTime"
        case .power: "charging.sessions.sortPower"
        }
    }

    public var fallback: String {
        switch self {
        case .date: "Date"
        case .energy: "kWh"
        case .cost: "Cost"
        case .duration: "Time"
        case .power: "Power"
        }
    }
}

/// The charger filter selection (web `ChargerFilter`). `all` clears the filter.
public enum SessionChargerFilter: String, Sendable, Equatable, CaseIterable, Identifiable {
    case all
    case home
    case supercharger
    case dc

    public var id: String {
        rawValue
    }

    /// The pill-bar display order matches the web (`All`, `Home`, `SC`, `DC`).
    public static var pillOrder: [SessionChargerFilter] {
        [.all, .home, .supercharger, .dc]
    }

    public var localizationKey: String {
        switch self {
        case .all: "charging.sessions.filterAll"
        case .home: "charging.sessions.filterHome"
        case .supercharger: "charging.sessions.filterSC"
        case .dc: "charging.sessions.filterDC"
        }
    }

    public var fallback: String {
        switch self {
        case .all: "All"
        case .home: "Home"
        case .supercharger: "SC"
        case .dc: "DC"
        }
    }

    /// The category this filter restricts to, or `nil` for `all`.
    public var category: SessionChargerCategory? {
        switch self {
        case .all: nil
        case .home: .home
        case .supercharger: .supercharger
        case .dc: .dc
        }
    }
}

// MARK: - Session item (the display-ready row, SI in)

/// One charging session projected to the fields the row + sort + filter need — the
/// native parity of the web `ChargingSession` consumed by this surface. Energy is in
/// Wh and power in W (SI); kWh/kW are derived at the read boundary by the computed
/// accessors below.
public struct SessionListItem: Sendable, Equatable, Identifiable {
    public var id: Int
    public var startedAt: Date
    public var endedAt: Date?
    public var startSocPct: Double?
    public var endSocPct: Double?
    public var energyAddedWh: Double
    public var peakPowerW: Double?
    public var avgPowerW: Double?
    public var costDecimal: Double?
    public var costCurrency: String?
    public var chargerType: String?
    public var startPlace: String?
    public var startLat: Double?
    public var startLng: Double?
    public var odometerStartM: Double?
    public var odometerEndM: Double?

    public init(
        id: Int,
        startedAt: Date,
        endedAt: Date? = nil,
        startSocPct: Double? = nil,
        endSocPct: Double? = nil,
        energyAddedWh: Double = 0,
        peakPowerW: Double? = nil,
        avgPowerW: Double? = nil,
        costDecimal: Double? = nil,
        costCurrency: String? = nil,
        chargerType: String? = nil,
        startPlace: String? = nil,
        startLat: Double? = nil,
        startLng: Double? = nil,
        odometerStartM: Double? = nil,
        odometerEndM: Double? = nil
    ) {
        self.id = id
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.startSocPct = startSocPct
        self.endSocPct = endSocPct
        self.energyAddedWh = energyAddedWh
        self.peakPowerW = peakPowerW
        self.avgPowerW = avgPowerW
        self.costDecimal = costDecimal
        self.costCurrency = costCurrency
        self.chargerType = chargerType
        self.startPlace = startPlace
        self.startLat = startLat
        self.startLng = startLng
        self.odometerStartM = odometerStartM
        self.odometerEndM = odometerEndM
    }

    /// The coarse charger category (web `getChargerCategory(session.charger_type)`).
    public var category: SessionChargerCategory {
        .from(chargerType)
    }

    /// Elapsed minutes (web `durationMinutes`). 0 for in-progress / malformed.
    public var durationMinutes: Double {
        SessionListProjection.durationMinutes(start: startedAt, end: endedAt)
    }

    /// Energy added in kWh (web `total_energy_added_wh / 1000`).
    public var energyKwh: Double {
        energyAddedWh / 1000
    }

    /// Average charger power in W (web `avgPowerW`): energy/elapsed, falling back to
    /// the API-provided `avg_power_w`.
    public var effectiveAvgPowerW: Double {
        SessionListProjection.avgPowerW(self)
    }

    /// Average charger power in kW, or `nil` when not computable (> 0 only).
    public var avgPowerKw: Double? {
        let watts = effectiveAvgPowerW
        return watts > 0 ? watts / 1000 : nil
    }

    /// Peak charger power in kW, or `nil` when absent.
    public var peakPowerKw: Double? {
        peakPowerW.map { $0 / 1000 }
    }

    /// Cost per kWh, or `nil` when free / unknown / zero-energy (web `costPerKwh`).
    public var costPerKwh: Double? {
        SessionListProjection.costPerKwh(self)
    }

    /// Whether the session was free (web `cost_decimal == null || === 0`).
    public var isFree: Bool {
        (costDecimal ?? 0) == 0
    }

    /// The battery-friendly score (web `ChargingSessionCard` derivation), or `nil`
    /// when either SoC endpoint is missing.
    public var batteryScore: Int? {
        SessionListProjection.batteryScore(start: startSocPct, end: endSocPct)
    }

    /// Distance added in meters from the odometer delta (web `distanceAddedM`), or
    /// `nil` when not a positive delta.
    public var distanceAddedM: Double? {
        SessionListProjection.distanceAddedM(start: odometerStartM, end: odometerEndM)
    }
}
