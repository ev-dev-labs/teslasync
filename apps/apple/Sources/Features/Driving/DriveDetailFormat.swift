import Foundation

/// Pure display-boundary formatters for the Driving detail surface (web `fmtNumber`,
/// `fmtInt`, `fmtPercent`, `formatDuration`, the `'—'` fallbacks, and the cost helpers from
/// `useFormatting`). Unit-bearing values (distance, speed, energy, power, temperature,
/// pressure) are formatted by the SI-aware `Units` facade / `TS*` components in the view; this
/// enum only covers the unit-free numbers + the cost/efficiency estimates the web computes
/// from settings, so it stays SwiftUI-free and unit-tested. Every helper returns an em dash
/// for `nil` / non-finite input (never "nan"), matching the web `'—'` sentinel.
public enum DriveDetailFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

    /// Web `fmtNumber(value, decimals)`: en-US grouping, fixed fraction digits.
    public static func number(_ value: Double, decimals: Int = 1) -> String {
        guard value.isFinite else { return emptyValue }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(decimals)f", value)
    }

    /// Web `value != null ? fmtNumber(value, decimals) : '—'`.
    public static func numberOrDash(_ value: Double?, decimals: Int = 1) -> String {
        guard let value, value.isFinite else { return emptyValue }
        return number(value, decimals: decimals)
    }

    /// Web `fmtInt(value)`: a grouped whole number, or the em dash when absent.
    public static func int(_ value: Double?) -> String {
        guard let value, value.isFinite else { return emptyValue }
        return number(value, decimals: 0)
    }

    /// Web `fmtPercent(value)`: a rounded integer percent, or the em dash when absent.
    public static func percent(_ value: Double?) -> String {
        guard let value, value.isFinite else { return emptyValue }
        return "\(number(value, decimals: 0))%"
    }

    /// Web `helpers.formatDuration(min)`: `Xh Ym` once an hour is reached, else `Ym`.
    public static func duration(minutes: Double) -> String {
        guard minutes.isFinite else { return emptyValue }
        let hours = Int((minutes / 60).rounded(.down))
        let mins = Int(minutes.truncatingRemainder(dividingBy: 60).rounded())
        return hours > 0 ? "\(hours)h \(mins)m" : "\(mins)m"
    }

    /// Web `${a} → ${b}` start→end pair, each formatted with `decimals`.
    public static func pair(_ start: Double?, _ end: Double?, decimals: Int = 0) -> String {
        let left = start.map { number($0, decimals: decimals) } ?? "?"
        let right = end.map { number($0, decimals: decimals) } ?? "?"
        return "\(left) → \(right)"
    }

    /// Web JourneyDetails coordinate label `47.6°N, 122.3°W` (only when no address).
    public static func coordinate(latitude: Double, longitude: Double) -> String {
        let lat = "\(number(abs(latitude), decimals: 2))°\(latitude >= 0 ? "N" : "S")"
        let lon = "\(number(abs(longitude), decimals: 2))°\(longitude >= 0 ? "E" : "W")"
        return "\(lat), \(lon)"
    }

    /// Web `formatCurrency(value, decimals)` (en-US, `$` symbol).
    public static func currency(_ value: Double, decimals: Int = 2) -> String {
        guard value.isFinite else { return emptyValue }
        return "\(defaultCurrencySymbol)\(number(value, decimals: decimals))"
    }

    // MARK: Efficiency (web `Wh/km` vs `Wh/mi`, derived from the distance pref)

    /// Web `toEfficiencyDisplay`: Wh/km stays, Wh/mi multiplies by 1.609344.
    public static func efficiencyDisplay(whPerKm: Double, isMiles: Bool) -> Double {
        isMiles ? whPerKm * 1.609344 : whPerKm
    }

    /// The efficiency unit label paired with `efficiencyDisplay` (web `'Wh/mi' | 'Wh/km'`).
    public static func efficiencyUnit(isMiles: Bool) -> String {
        isMiles ? "Wh/mi" : "Wh/km"
    }

    // MARK: Cost estimates (web `useFormatting` settings defaults)

    /// Display-time fallback electricity price (web `useFormatting().costPerKwh` default).
    public static let defaultCostPerKwh = 0.13
    /// Display-time fallback currency symbol (web `currencySymbol`).
    public static let defaultCurrencySymbol = "$"
    /// Display-time fallback gas price per gallon (web settings default).
    public static let defaultGasPricePerGallon = 3.50
    /// Display-time fallback gas efficiency, MPG (web `settings.gas_efficiency_mpg`).
    public static let defaultGasEfficiencyMpg = 25.0

    /// Web `evCost = (energyWh/1000) * costPerKwh`.
    public static func evCost(energyWh: Double) -> Double {
        (energyWh / 1000) * defaultCostPerKwh
    }

    /// Web `estimateGasCost(distanceM)`: gallons × price, gallons = miles / mpg.
    public static func gasCost(distanceM: Double) -> Double {
        let miles = distanceM / 1609.344
        guard defaultGasEfficiencyMpg > 0 else { return 0 }
        return (miles / defaultGasEfficiencyMpg) * defaultGasPricePerGallon
    }

    /// Web `costPerDistanceUnit`: EV cost over distance, in the user's distance unit.
    public static func costPerDistance(energyWh: Double, distanceM: Double, isMiles: Bool) -> Double? {
        guard distanceM > 0 else { return nil }
        let distance = isMiles ? distanceM / 1609.344 : distanceM / 1000
        guard distance > 0 else { return nil }
        return evCost(energyWh: energyWh) / distance
    }
}
