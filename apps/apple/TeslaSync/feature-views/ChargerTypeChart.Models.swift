//
//  ChargerTypeChart.Models.swift
//  TeslaSync — P4 feature view · 0087 · ChargerTypeChart (Apple)
//
//  The pure value types for the "Charge Rate by Charger Type" surface — the
//  session input slice, the charger-type + metric enums, the projected chart
//  column + row, and the render/load/connection states. Foundation-only so they
//  are shared by the projection (`ChargerTypeChart.Adapter.swift`), the state
//  holder, and the views without dragging in SwiftUI. Faithful to the web
//  features/charging/components/charging-curve/ChargerTypeChart.tsx data shapes.
//

import Foundation

// MARK: - Session input (web `ChargingSession` slice)

/// One charging session, reduced to the fields the chart reads. SI canonical:
/// `peakPowerW` in watts, `totalEnergyAddedWh` in watt-hours (web `peak_power_w`
/// / `total_energy_added_wh`). The kW / kWh shown to the user are display-only
/// conversions in `points`, never persisted.
public struct ChargingSessionInput: Sendable, Equatable {
    /// The reported charger type label (web `charger_type`), if any.
    public var chargerType: String?
    /// Peak charger power in watts (web `peak_power_w`), if known.
    public var peakPowerW: Double?
    /// Energy added in watt-hours (web `total_energy_added_wh`).
    public var totalEnergyAddedWh: Double
    /// Session start (web `started_at`).
    public var startedAt: Date?
    /// Session end (web `ended_at`); `nil` for an in-progress session.
    public var endedAt: Date?

    public init(
        chargerType: String? = nil,
        peakPowerW: Double? = nil,
        totalEnergyAddedWh: Double = 0,
        startedAt: Date? = nil,
        endedAt: Date? = nil
    ) {
        self.chargerType = chargerType
        self.peakPowerW = peakPowerW
        self.totalEnergyAddedWh = totalEnergyAddedWh
        self.startedAt = startedAt
        self.endedAt = endedAt
    }
}

// MARK: - Charger type (web `getChargerLabel` result)

/// The charger category a session is bucketed into — the SwiftUI parity of the
/// web `getChargerLabel` return values. The raw value is the stable grouping /
/// chart key; the display name resolves through the P1/S10 facade so no English
/// literal ships in the view (web renders the bare label; native localizes it,
/// fallbacks identical to the web strings).
public enum ChargerType: String, Sendable, Equatable, CaseIterable, Identifiable {
    case supercharger
    case dcFast
    case homeAC

    public var id: String {
        rawValue
    }

    /// Plot / table / legend order (fastest → slowest).
    public var order: Int {
        switch self {
        case .supercharger: 0
        case .dcFast: 1
        case .homeAC: 2
        }
    }

    /// The i18n key the display name resolves (web `t(key, default)`).
    public var localizationKey: String {
        switch self {
        case .supercharger: "charging.curve.charger.supercharger"
        case .dcFast: "charging.curve.charger.dcFast"
        case .homeAC: "charging.curve.charger.homeAC"
        }
    }

    /// The web English label for `localizationKey` (web `getChargerLabel`).
    public var fallback: String {
        switch self {
        case .supercharger: "Supercharger"
        case .dcFast: "DC Fast"
        case .homeAC: "Home / AC"
        }
    }
}

// MARK: - Metric (web `<Bar>` series)

/// The two per-charger series, mirroring the web `avgKw` / `avgKwh` bars + their
/// `name` props ("Avg Power" / "Avg Energy") and unit suffixes (" kW" / " kWh").
public enum ChargerMetric: String, Sendable, Equatable, CaseIterable, Identifiable {
    case power
    case energy

    public var id: String {
        rawValue
    }

    /// Plot order within a charger group (web renders the kW bar before kWh).
    public var order: Int {
        switch self {
        case .power: 0
        case .energy: 1
        }
    }

    /// The i18n key for the series name (web `<Bar name={t(...)}>`).
    public var localizationKey: String {
        switch self {
        case .power: "charging.curve.avgPower"
        case .energy: "charging.curve.avgEnergy"
        }
    }

    /// The web English series name.
    public var fallback: String {
        switch self {
        case .power: "Avg Power"
        case .energy: "Avg Energy"
        }
    }

    /// The i18n key for the unit suffix (web `<Bar unit=" kW">` / `" kWh"`).
    public var unitKey: String {
        switch self {
        case .power: "charging.curve.unit.kw"
        case .energy: "charging.curve.unit.kwh"
        }
    }

    /// The web English unit suffix.
    public var unitFallback: String {
        switch self {
        case .power: "kW"
        case .energy: "kWh"
        }
    }
}

// MARK: - Charger projection (one chart column + its row payload)

/// One projected charger group: the category and its four aggregates (web
/// `ChargerTypeStats` — `{ label, count, avgKw, avgKwh, avgDuration }`). Drives a
/// clustered chart column, the breakdown rows, the data table, and a11y.
public struct ChargerTypePoint: Sendable, Equatable, Identifiable {
    public var type: ChargerType
    /// Sessions in this group (web `count`).
    public var count: Int
    /// Average peak power in kW (web `avgKw` = avg of `peak_power_w / 1000`).
    public var avgKw: Double
    /// Average energy added in kWh (web `avgKwh` = avg of `total_energy_added_wh / 1000`).
    public var avgKwh: Double
    /// Average session length in minutes (web `avgDuration`).
    public var avgDurationMin: Double

    public var id: String {
        type.rawValue
    }

    public init(type: ChargerType, count: Int, avgKw: Double, avgKwh: Double, avgDurationMin: Double) {
        self.type = type
        self.count = count
        self.avgKw = avgKw
        self.avgKwh = avgKwh
        self.avgDurationMin = avgDurationMin
    }

    /// The value plotted for one series (web bar height).
    public func value(for metric: ChargerMetric) -> Double {
        switch metric {
        case .power: avgKw
        case .energy: avgKwh
        }
    }
}

// MARK: - Chart row (one clustered bar segment)

/// One `(charger, metric)` bar for the Swift Charts grid: the native parity of a
/// single web `<Bar>`/`<Cell>` pair. The web flattens this implicitly across its
/// two `<Bar>` elements; the native chart plots an explicit row per segment.
public struct ChargerChartRow: Sendable, Equatable, Identifiable {
    public var type: ChargerType
    public var metric: ChargerMetric
    public var value: Double

    public var id: String {
        "\(type.rawValue)#\(metric.rawValue)"
    }

    public init(type: ChargerType, metric: ChargerMetric, value: Double) {
        self.type = type
        self.metric = metric
        self.value = value
    }
}

// MARK: - Render phase (web content/empty split, plus the load envelope)

/// What the surface should render. The web source only distinguishes
/// content-vs-empty (`chargerTypeStats.length`); the loading / error envelope
/// around it (prompt P4 states) is supplied by the bound source, mirroring the
/// web parent page's `isLoading` / error wiring.
public enum ChargerTypePhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the sessions query (web `isLoading` /
/// resolved / failure), projected into a phase by `resolvePhase`.
public enum ChargerTypeLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data
/// banner so cached columns are clearly labeled while reconnecting / offline.
public enum ChargerTypeConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}
