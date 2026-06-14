import Foundation

/// Pure display-boundary formatters for the Fleet Comparison surface (web `fmtNumber` /
/// `useUnits` / `useFormatting` helpers). SI values come from the model; conversion to the
/// user's unit preference happens here via the shared KMP `Units` facade (P1/S5) — never in
/// the model. Each returns an em dash for nil/non-finite input (never "nan").
public enum FleetCompareFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

    /// Web `fmtNumber(value, decimals)`: en-US grouping, fixed fraction digits.
    public static func number(_ value: Double, decimals: Int = 0) -> String {
        guard value.isFinite else { return emptyValue }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(decimals)f", value)
    }

    /// Web `formatCurrency(amount, 0)` — locale currency, zero fraction digits (default USD).
    public static func currency(_ amount: Double, code: String = "USD") -> String {
        guard amount.isFinite else { return emptyValue }
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = code
        formatter.maximumFractionDigits = 0
        formatter.minimumFractionDigits = 0
        return formatter.string(from: NSNumber(value: amount)) ?? emptyValue
    }

    /// Web `efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km'`.
    public static func efficiencyUnit(_ prefs: UnitPreferences) -> String {
        prefs.distance == "mi" ? "Wh/mi" : "Wh/km"
    }

    /// Web `whPerKmToDisplay`: Wh/km stays as-is for metric, scaled by km-per-mile for imperial.
    public static func efficiencyValue(_ whPerKm: Double, _ prefs: UnitPreferences) -> Double {
        prefs.distance == "mi" ? whPerKm * 1.609344 : whPerKm
    }

    // MARK: - Comparison table cell values (web `comparisonRows` value strings)

    /// Formats one comparison metric's raw SI value for display (web per-row value template).
    public static func tableValue(_ metric: FleetCompareMetric, raw: Double, prefs: UnitPreferences) -> String {
        switch metric {
        case .totalDrives, .chargeSessions:
            number(raw)
        case .totalDistance:
            "\(number(Units.convertDistance(raw, prefs))) \(prefs.distance)"
        case .avgEfficiency:
            "\(number(efficiencyValue(raw, prefs))) \(efficiencyUnit(prefs))"
        case .avgSpeed, .topSpeed:
            "\(number(Units.convertSpeed(raw, prefs))) \(prefs.speed)"
        case .regenRatio:
            "\(number(raw * 100, decimals: 1))%"
        case .co2Saved:
            "\(number(raw)) kg"
        case .chargingCost:
            currency(raw)
        case .totalEnergy:
            Units.formatEnergy(raw, prefs)
        }
    }

    // MARK: - Status-card values (web VehicleStatusCard)

    /// Battery percentage or em dash (web `${batteryLevel}%`).
    public static func battery(_ level: Int?) -> String {
        guard let level else { return emptyValue }
        return "\(level)%"
    }

    /// Rated range via the SI distance formatter, or em dash (web `formatDistance(range)`).
    public static func range(_ meters: Double?, _ prefs: UnitPreferences) -> String {
        guard let meters else { return emptyValue }
        return Units.formatDistance(meters, prefs)
    }

    /// Inside (and optionally outside) temperature via the SI formatter (web temp line).
    public static func temperature(inside: Double?, outside: Double?, _ prefs: UnitPreferences) -> String {
        guard let inside else { return emptyValue }
        let insideText = Units.formatTemperature(inside, prefs)
        guard let outside else { return insideText }
        return "\(insideText) / \(Units.formatTemperature(outside, prefs))"
    }

    // MARK: - Highlight cards (web "Key Highlights" StatCards)

    /// Web `${a ?? '—'}% vs ${b ?? '—'}%`.
    public static func batteryHighlight(_ valueA: Int?, _ valueB: Int?) -> String {
        "\(valueA.map { "\($0)%" } ?? emptyValue) vs \(valueB.map { "\($0)%" } ?? emptyValue)"
    }

    /// Web efficiency highlight `${fmtNumber(effA)} vs ${fmtNumber(effB)}` + unit.
    public static func efficiencyHighlight(_ valueA: Double, _ valueB: Double, _ prefs: UnitPreferences) -> String {
        let left = number(efficiencyValue(valueA, prefs))
        let right = number(efficiencyValue(valueB, prefs))
        return "\(left) vs \(right) \(efficiencyUnit(prefs))"
    }

    /// Web cost highlight `${formatCurrency(a)} vs ${formatCurrency(b)}`.
    public static func costHighlight(_ valueA: Double, _ valueB: Double) -> String {
        "\(currency(valueA)) vs \(currency(valueB))"
    }

    /// Web CO₂ highlight `${fmtNumber(a)} vs ${fmtNumber(b)}` + "kg".
    public static func co2Highlight(_ valueA: Double, _ valueB: Double) -> String {
        "\(number(valueA)) vs \(number(valueB)) kg"
    }
}
