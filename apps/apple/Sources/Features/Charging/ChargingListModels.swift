import Foundation

// Value types + pure derivations for the Charging Sessions list surface (web
// `web/src/features/charging/pages/ChargingListPage.tsx`, route `/charging`). Everything
// the page renders — the six overview KPIs, the metric-switcher trend, the collection
// counts, the search/sort/group pipeline, the anomaly + notable detection — is derived
// here as pure, unit-testable functions over a window of `ChargingSession`s, mirroring the
// web `lib/chargingAggregation.ts` helpers verbatim.
//
// SI discipline (ADR-005): sessions are kept SI-canonical exactly as the API delivers them
// — energy in watt-hours (`energyAddedWh`), power in watts (`peakPowerW` / `avgPowerW`),
// cost in decimal currency. kWh / kW are derived only at the display boundary by
// `ChargingListFormat`; nothing non-SI is stored or computed here.

// MARK: - Vehicle (web `useSelectedVehicle` → `GET /vehicles`)

/// One selectable vehicle (web `vehicle.display_name || vehicle.vin`). Identity + label
/// strings only — no SI measurements, so they round-trip verbatim.
public struct ChargingVehicle: Identifiable, Hashable, Sendable {
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

// MARK: - Charging session (web `ChargingSession`, SI-canonical)

/// One charging session row (web `ChargingSession`). Energy is in watt-hours and power in
/// watts (SI canonical, web `total_energy_added_wh` / `peak_power_w` / `avg_power_w`); cost
/// is decimal currency. The view converts to kWh / kW only at the render boundary.
public struct ChargingSession: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let startedAt: Date
    public let endedAt: Date?
    public let chargerType: String?
    public let startPlace: String?
    /// Web `total_energy_added_wh` — energy added in watt-hours (SI).
    public let energyAddedWh: Double
    /// Web `peak_power_w` — peak charger power in watts (SI).
    public let peakPowerW: Double?
    /// Web `avg_power_w` — API-provided average power in watts (SI fallback).
    public let avgPowerWApi: Double?
    public let costDecimal: Double?
    public let startSocPct: Double?
    public let endSocPct: Double?

    public init(
        id: Int64,
        startedAt: Date,
        endedAt: Date?,
        chargerType: String?,
        startPlace: String?,
        energyAddedWh: Double,
        peakPowerW: Double?,
        avgPowerWApi: Double?,
        costDecimal: Double?,
        startSocPct: Double?,
        endSocPct: Double?
    ) {
        self.id = id
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.chargerType = chargerType
        self.startPlace = startPlace
        self.energyAddedWh = energyAddedWh
        self.peakPowerW = peakPowerW
        self.avgPowerWApi = avgPowerWApi
        self.costDecimal = costDecimal
        self.startSocPct = startSocPct
        self.endSocPct = endSocPct
    }

    /// Web `durationMinutes(s)`: minutes between start and end; 0 for in-progress or
    /// malformed timestamps so callers can sum without NaN propagation.
    public var durationMinutes: Double {
        guard let endedAt, endedAt > startedAt else { return 0 }
        return endedAt.timeIntervalSince(startedAt) / 60
    }

    /// Web `avgPowerW(s)`: energy (Wh) / elapsed hours, falling back to the API
    /// `avg_power_w`; 0 when neither path is computable. Watts (SI).
    public var avgPowerW: Double {
        let minutes = durationMinutes
        if minutes > 0, energyAddedWh > 0 {
            return energyAddedWh / (minutes / 60)
        }
        return avgPowerWApi ?? 0
    }

    /// Web `costPerKwh(s)`: nil when free / unknown / zero-energy.
    public var costPerKwh: Double? {
        guard energyAddedWh > 0, let cost = costDecimal, cost > 0 else { return nil }
        return cost / (energyAddedWh / 1000)
    }

    /// Web `s.cost_decimal == null || s.cost_decimal === 0` — a free / uncosted session.
    public var isFree: Bool {
        costDecimal == nil || costDecimal == 0
    }

    /// The coarse charger category (web `getChargerCategory(s.charger_type)`).
    public var category: ChargerCategory {
        ChargerCategory.from(chargerType)
    }
}

// MARK: - Charger category (web `ChargerCategory` / `getChargerCategory`)

/// Coarse charger category used by the filter pills, breakdown, and anomaly rules (web
/// `ChargerCategory`). `home` is the historical default for a null charger type.
public enum ChargerCategory: String, CaseIterable, Sendable {
    case home
    case supercharger
    case dc
    case unknown

    /// Web `getChargerCategory` — verbatim substring rules; null type → home AC.
    public static func from(_ type: String?) -> ChargerCategory {
        guard let type, !type.isEmpty else { return .home }
        let value = type.lowercased()
        if value.contains("super") || value.contains("tpc") { return .supercharger }
        if value.contains("dc") || value.contains("ccs") || value.contains("chademo") || value.contains("fast") {
            return .dc
        }
        if value.contains("home") || value.contains("ac") || value.contains("wall") { return .home }
        return .unknown
    }
}

// MARK: - Collections (web `COLLECTIONS` pill set)

/// The collection filter the pill bar offers (web `COLLECTIONS`). Each maps to a subset of
/// the date-filtered window; `tagged` is disabled and not yet wired, exactly as the web page
/// renders it (count 0, not yet wired).
public enum ChargingCollection: String, CaseIterable, Identifiable, Sendable {
    case all
    case home
    case supercharger
    case dc
    case free
    case anomalies
    case notable
    case tagged

    public var id: String { rawValue }

    /// Web pill label key (`charging.coll.*`).
    public var labelKey: String {
        "charging.coll.\(rawValue)"
    }

    /// Web pill glyph.
    public var systemImage: String {
        switch self {
        case .all: "list.bullet"
        case .home: "house.fill"
        case .supercharger: "bolt.fill"
        case .dc: "bolt.car.fill"
        case .free: "sun.max.fill"
        case .anomalies: "exclamationmark.triangle.fill"
        case .notable: "star.fill"
        case .tagged: "tag.fill"
        }
    }

    /// Web `disabled: true` on the Tagged pill (not yet wired).
    public var isDisabled: Bool {
        self == .tagged
    }
}

// MARK: - Sort field (web `SORT_FIELDS`)

/// The list sort key (web `SORT_FIELDS`).
public enum ChargingSortField: String, CaseIterable, Identifiable, Sendable {
    case date
    case energy
    case cost
    case duration
    case power

    public var id: String { rawValue }

    /// Web sort menu label key (`charging.sort.*`).
    public var labelKey: String {
        "charging.sort.\(rawValue)"
    }
}

// MARK: - Trend metric (web `TREND_METRICS`)

/// The metric the trend chart switches between (web `ChargingTrendMetric`).
public enum ChargingTrendMetric: String, CaseIterable, Identifiable, Sendable {
    case sessions
    case energy
    case cost
    case power

    public var id: String { rawValue }

    /// Web metric label key (`charging.metric.*`).
    public var labelKey: String {
        "charging.metric.\(rawValue)"
    }

    /// Web per-metric chart type — `power` is a line, the rest are bars.
    public var isLine: Bool {
        self == .power
    }

    /// Web per-metric accent → brand chart-palette index (green / cyan / red / purple).
    public var colorIndex: Int {
        switch self {
        case .sessions: 0
        case .energy: 1
        case .cost: 3
        case .power: 4
        }
    }
}

// MARK: - List density (web `DensityToggle`)

/// The row-density toggle (web `Density`).
public enum ChargingDensity: String, CaseIterable, Identifiable, Sendable {
    case comfortable
    case compact

    public var id: String { rawValue }

    public var labelKey: String {
        "charging.density.\(rawValue)"
    }
}

// MARK: - Anomalies (web `ChargingAnomaly` / `detectChargingAnomalies`)

/// The anomaly classification for a session (web `ChargingAnomalyKind`). At most one per
/// session, first matching rule wins.
public enum ChargingAnomalyKind: String, Sendable {
    case telemetryGap
    case costZero
    case badPower
    case expensive
    case trickle

    /// Localized short badge label key for the anomaly (web inline message family).
    public var labelKey: String {
        "charging.anomalyKind.\(rawValue)"
    }
}

/// A detected anomaly bound to its session (web `ChargingAnomaly`).
public struct ChargingAnomaly: Identifiable, Sendable {
    public let session: ChargingSession
    public let kind: ChargingAnomalyKind

    public var id: Int64 { session.id }

    public init(session: ChargingSession, kind: ChargingAnomalyKind) {
        self.session = session
        self.kind = kind
    }
}
