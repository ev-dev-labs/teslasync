//
//  ChargingSessionCard.Adapter.swift
//  TeslaSync — P4 feature view · 0107 · ChargingSessionCard (Apple)
//
//  The domain core for the charging-session list row: the `safe()` numeric guard
//  (port of the web `safeNumber`), the charger-category classifier (web
//  `getChargerCategory`), the semantic tone / glow / density value types, the
//  decoded session model (parity with the web `ChargingSession` from
//  `@/api/types`), and the page-level anomaly callout. Foundation-only so it
//  unit-tests without a store or a rendered view.
//

import Foundation

// MARK: - Numeric guard (port of the web `safe` / `safeNumber`)

/// `safe` is the native port of the web `safeNumber = (v) => typeof v === 'number'
/// && isFinite(v) ? v : 0`, used wherever a metric feeds arithmetic so a `NaN` /
/// `Infinity` never reaches a width or a label.
public enum ChargingSessionNumeric {
    /// Returns the value when it is finite, else `0`.
    public static func safe(_ value: Double?) -> Double {
        guard let value, value.isFinite else { return 0 }
        return value
    }
}

// MARK: - Charger category (port of the web `getChargerCategory`)

/// Coarse charger classification (web `ChargerCategory` —
/// `'home' | 'supercharger' | 'dc' | 'unknown'`). Drives the leading badge tint,
/// the badge label, and the row glow.
public enum ChargerKind: String, CaseIterable, Equatable, Sendable {
    case home
    case supercharger
    case dc
    case unknown

    /// Maps a raw `charger_type` into a category, reproducing the web
    /// `getChargerCategory` exactly: a missing/empty type is historically home AC;
    /// otherwise the lower-cased string is matched against the supercharger, DC,
    /// then home substrings, falling through to `unknown`.
    public static func category(forType type: String?) -> ChargerKind {
        guard let type, !type.isEmpty else { return .home }
        let value = type.lowercased()
        if value.contains("super") || value.contains("tpc") { return .supercharger }
        if value.contains("dc") || value.contains("ccs") || value.contains("chademo") || value.contains("fast") {
            return .dc
        }
        if value.contains("home") || value.contains("ac") || value.contains("wall") { return .home }
        return .unknown
    }

    /// The badge tone for the charger label (web
    /// `cat === 'supercharger' ? 'danger' : cat === 'dc' ? 'warning' : 'success'`).
    public var badgeTone: ChargingSessionCardTone {
        switch self {
        case .supercharger: .danger
        case .dc: .warning
        case .home, .unknown: .success
        }
    }

    /// The hover glow for the row (web `ACCENT[cat] === 'red' ? 'cyan' : 'green'`,
    /// where only `supercharger` maps to red).
    public var glow: ChargingSessionCardGlow {
        self == .supercharger ? .cyan : .green
    }
}

// MARK: - Semantic tone / glow / density (Foundation-side; mapped to tokens in the view)

/// A semantic badge/score tone, resolved to a generated design token at the view
/// boundary so the Foundation layer never imports SwiftUI or hardcodes a hex.
public enum ChargingSessionCardTone: Equatable, Sendable {
    case success
    case info
    case warning
    case danger
    case critical
    case neutral
    case accent
    case purple
}

/// The row's hover glow (web `HistoryListRowGlow` subset used by the card).
public enum ChargingSessionCardGlow: Equatable, Sendable {
    case cyan
    case green
}

/// Layout density (web `density?: 'comfortable' | 'compact'`). Compact hides the
/// secondary metrics line.
public enum ChargingSessionCardDensity: String, Equatable, Sendable {
    case comfortable
    case compact
}

// MARK: - Domain model (port of `ChargingSession`)

/// The decoded charging session the card renders (parity with the web
/// `ChargingSession`). Energy is SI watt-hours and power SI watts (the canonical
/// on-the-wire shapes); the display boundary converts. Nullable web fields are
/// optionals so the projection can branch exactly like the source.
public struct ChargingSessionSummary: Identifiable, Equatable, Sendable {
    public var id: Int
    public var chargerType: String?
    public var startedAt: Date?
    public var endedAt: Date?
    /// Energy added in watt-hours (Wh, SI canonical — web `total_energy_added_wh`).
    public var totalEnergyAddedWh: Double
    /// Peak charger power in watts (W, SI — web `peak_power_w`).
    public var peakPowerW: Double?
    /// Average charger power in watts (W, SI — web `avg_power_w`).
    public var avgPowerW: Double?
    public var costDecimal: Double?
    public var startSocPct: Double?
    public var endSocPct: Double?
    /// Odometer in metres (SI — web `start_odometer_m` / `end_odometer_m`).
    public var odometerStartM: Double?
    public var odometerEndM: Double?
    public var startPlace: String?
    public var startLat: Double?
    public var startLng: Double?

    public init(
        id: Int,
        chargerType: String? = nil,
        startedAt: Date? = nil,
        endedAt: Date? = nil,
        totalEnergyAddedWh: Double = 0,
        peakPowerW: Double? = nil,
        avgPowerW: Double? = nil,
        costDecimal: Double? = nil,
        startSocPct: Double? = nil,
        endSocPct: Double? = nil,
        odometerStartM: Double? = nil,
        odometerEndM: Double? = nil,
        startPlace: String? = nil,
        startLat: Double? = nil,
        startLng: Double? = nil
    ) {
        self.id = id
        self.chargerType = chargerType
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.totalEnergyAddedWh = totalEnergyAddedWh
        self.peakPowerW = peakPowerW
        self.avgPowerW = avgPowerW
        self.costDecimal = costDecimal
        self.startSocPct = startSocPct
        self.endSocPct = endSocPct
        self.odometerStartM = odometerStartM
        self.odometerEndM = odometerEndM
        self.startPlace = startPlace
        self.startLat = startLat
        self.startLng = startLng
    }
}

/// The page-level anomaly callout for a session (web `ChargingAnomaly`). The card
/// renders only the user-facing `message`; the rest of the web type is page scope.
public struct ChargingAnomalyInfo: Equatable, Sendable {
    public var message: String

    public init(message: String) {
        self.message = message
    }
}
