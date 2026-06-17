import Foundation
import SwiftUI

// MARK: - Display-boundary formatters (web numberFormat.ts + unitConversion.ts)

/// Pure, testable display helpers. Temperatures are stored SI °C and converted to
/// the user's unit only here, at the render boundary (P1/S5 — the same affine
/// `convertTempFromSI` the KMP golden converter applies: °F = °C·1.8 + 32). No
/// value is ever stored or computed in a non-SI unit.
enum ClimateFormat {
    /// The em-dash shown for nil values (web `'—'`).
    static let dash = "—"

    /// Web `convertTempFromSI(celsius, tempUnit)`.
    static func displayTemperature(_ celsius: Double, fahrenheit: Bool) -> Double {
        fahrenheit ? celsius * 1.8 + 32 : celsius
    }

    /// Web `tempGaugeMax` (`isFahrenheit ? 131 : 55`).
    static func gaugeMax(fahrenheit: Bool) -> Double {
        fahrenheit ? 131 : 55
    }

    /// Web `fmtNumber(value, decimals)`: en-US grouping, fixed fraction digits.
    static func number(_ value: Double, decimals: Int = 1) -> String {
        guard value.isFinite else { return number(0, decimals: decimals) }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(decimals)f", value)
    }

    /// Web `fmtInt(value)`: rounded, en-US grouping, no fraction digits.
    static func int(_ value: Double) -> String {
        number(value.rounded(), decimals: 0)
    }

    /// A signed delta string (web `${delta > 0 ? '+' : ''}${delta}`).
    static func signedDelta(_ value: Double) -> String {
        let formatted = number(value, decimals: 1)
        return value > 0 ? "+\(formatted)" : formatted
    }

    /// Web `${fmtNumber(displayTemp, 1)}${tempUnit}` — converted value + unit.
    static func temperatureWithUnit(_ celsius: Double, fahrenheit: Bool, unitLabel: String) -> String {
        "\(number(displayTemperature(celsius, fahrenheit: fahrenheit), decimals: 1))\(unitLabel)"
    }

    /// Web `formatDateTime(timestamp)`: localized medium date + short time, or `—`.
    static func dateTime(_ date: Date?) -> String {
        guard let date else { return dash }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}

// MARK: - Seat heat / cool level (web HEAT_LEVELS / COOL_LEVELS, 0–3)

/// A seat heater/cooler intensity level (web `heatStyle` / `coolStyle`).
enum ClimateLevel: Int, CaseIterable {
    case off = 0
    case low = 1
    case medium = 2
    case high = 3

    /// Clamps an arbitrary integer level into 0…3 (web `Math.min(Math.max(level,0),3)`).
    static func clamp(_ level: Int) -> ClimateLevel {
        ClimateLevel(rawValue: min(max(level, 0), 3)) ?? .off
    }

    /// Web `HEAT_LEVELS[i].label` (also the cool labels).
    var labelKey: LocalizedStringKey {
        switch self {
        case .off: "Off"
        case .low: "Low"
        case .medium: "Medium"
        case .high: "High"
        }
    }

    /// Web `heatBadgeVariant` (neutral / info / warning / danger).
    var heatTone: TSTone {
        switch self {
        case .off: .neutral
        case .low: .info
        case .medium: .warning
        case .high: .danger
        }
    }

    /// Web `coolBadgeVariant` (neutral when off, else info).
    var coolTone: TSTone {
        self == .off ? .neutral : .info
    }
}

// MARK: - Climate Keeper (web keeperLabel / keeperVariant)

/// Climate-Keeper mode mapping (web `keeperLabel` / `keeperVariant`).
enum ClimateKeeper {
    static func labelKey(_ mode: String?) -> LocalizedStringKey {
        switch mode {
        case "On": "On"
        case "Dog Mode": "Dog Mode"
        case "Camp Mode": "Camp Mode"
        default: "Off"
        }
    }

    static func tone(_ mode: String?) -> TSTone {
        switch mode {
        case "On": .info
        case "Dog Mode": .warning
        case "Camp Mode": .info
        default: .neutral
        }
    }

    /// Web `latest.climateKeeperMode !== 'Off'`.
    static func isActive(_ mode: String?) -> Bool {
        guard let mode else { return false }
        return mode != "Off"
    }
}

// MARK: - Comfort (web comfortBadge — banner label/variant)

/// Comfort assessment from the inside/target spread (web `comfortBadge`).
enum ClimateComfort {
    case comfortable
    case adjusting
    case far

    /// Web `comfortBadge(latest?.insideTemp ?? 0, latest?.driverTempSetting ?? 0)`.
    static func evaluate(inside: Double?, target: Double?) -> ClimateComfort {
        let delta = abs((inside ?? 0) - (target ?? 0))
        if delta <= 1 { return .comfortable }
        if delta <= 3 { return .adjusting }
        return .far
    }

    var labelKey: LocalizedStringKey {
        switch self {
        case .comfortable: "Comfortable"
        case .adjusting: "Adjusting"
        case .far: "Far from target"
        }
    }

    var tone: TSTone {
        switch self {
        case .comfortable: .success
        case .adjusting: .warning
        case .far: .danger
        }
    }
}

// MARK: - Comfort score band (web `comfortScore >= 80 / >= 50`)

/// The score band used for the comfort-score circle + efficiency card (web ladder).
enum ClimateScoreBand {
    case excellent
    case moderate
    case poor

    static func from(_ score: Double?) -> ClimateScoreBand? {
        guard let score else { return nil }
        if score >= 80 { return .excellent }
        if score >= 50 { return .moderate }
        return .poor
    }

    var labelKey: LocalizedStringKey {
        switch self {
        case .excellent: "Excellent"
        case .moderate: "Moderate"
        case .poor: "Poor"
        }
    }

    var tone: TSTone {
        switch self {
        case .excellent: .success
        case .moderate: .warning
        case .poor: .danger
        }
    }
}

// MARK: - Thermal comfort status (web tempDelta > 2 / < -2)

/// The cabin-vs-target status badge (web Thermal Comfort "Status" tile).
enum ClimateThermalStatus {
    case tooWarm
    case tooCold
    case comfortable

    static func from(delta: Double?) -> ClimateThermalStatus {
        guard let delta else { return .comfortable }
        if delta > 2 { return .tooWarm }
        if delta < -2 { return .tooCold }
        return .comfortable
    }

    var labelKey: LocalizedStringKey {
        switch self {
        case .tooWarm: "Too Warm"
        case .tooCold: "Too Cold"
        case .comfortable: "Comfortable"
        }
    }

    var systemImage: String {
        switch self {
        case .tooWarm: "sun.max.fill"
        case .tooCold: "snowflake"
        case .comfortable: "wind"
        }
    }

    var tone: TSTone {
        switch self {
        case .tooWarm: .warning
        case .tooCold: .info
        case .comfortable: .success
        }
    }
}

// MARK: - Derivations (web comfortScore / tempDelta / efficiencyStats)

/// Aggregate fan/AC efficiency stats (web `efficiencyStats`).
struct ClimateEfficiency: Equatable {
    let avgFan: Double
    let peakFan: Double
    let acOnPct: Double
}

/// Pure derivations over the climate latest + history (web `useMemo` blocks).
enum ClimateInsight {
    /// Web `comfortScore = max(0, 100 - |inside-target| * 10)` (nil when either missing).
    static func comfortScore(inside: Double?, target: Double?) -> Double? {
        guard let inside, let target else { return nil }
        return max(0, 100 - abs(inside - target) * 10)
    }

    /// Web `tempDelta = fmtNumber(inside - target, 1)` (°C, nil when either missing).
    static func tempDelta(inside: Double?, target: Double?) -> Double? {
        guard let inside, let target else { return nil }
        return ((inside - target) * 10).rounded() / 10
    }

    /// Web `efficiencyStats` — nil when there are no fan-active samples.
    static func efficiency(_ history: [ClimateSnapshot]) -> ClimateEfficiency? {
        guard !history.isEmpty else { return nil }
        let speeds = history.compactMap { snapshot -> Double? in
            guard let fan = snapshot.fanSpeed, fan > 0 else { return nil }
            return Double(fan)
        }
        guard !speeds.isEmpty else { return nil }
        let avg = speeds.reduce(0, +) / Double(speeds.count)
        let peak = speeds.max() ?? 0
        let acOn = history.count(where: { $0.isAcOn == true })
        let acOnPct = Double(acOn) / Double(history.count) * 100
        return ClimateEfficiency(avgFan: avg, peakFan: peak, acOnPct: acOnPct)
    }
}
