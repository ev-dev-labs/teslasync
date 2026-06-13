import Foundation

/// Pure display-boundary formatters for the Statistics surface (web `fmtNumber` / `fmtInt` /
/// `formatCurrency` / `useUnits` helpers). SI values come from the model; conversion to the user's
/// unit preference happens here via the shared KMP `Units` facade (P1/S5) — never in the model.
/// Each returns an em dash for nil/non-finite input (never "nan").
public enum StatisticsFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

    /// The fraction digits a bare `fmtNumber(v)` uses — the user's global precision preference
    /// (web `_globalPrecision`, default 2).
    public static func defaultDecimals(_ prefs: UnitPreferences) -> Int {
        prefs.precision ?? 2
    }

    /// Web `fmtNumber(value, decimals)`: en-US grouping, fixed fraction digits.
    public static func number(_ value: Double, decimals: Int) -> String {
        guard value.isFinite else { return emptyValue }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(decimals)f", value)
    }

    /// Web `fmtInt(value)` → `fmtNumber(value, 0)`.
    public static func integer(_ value: Double) -> String {
        number(value, decimals: 0)
    }

    /// Web `formatCurrency(amount, decimals)` — locale currency, fixed fraction digits (default USD).
    public static func currency(_ amount: Double, decimals: Int, code: String = "USD") -> String {
        guard amount.isFinite else { return emptyValue }
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = code
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: amount)) ?? emptyValue
    }

    // MARK: - Distance (web `fmtInt(fromKm(m))` / `fmtNumber(fromKm(m))` + distanceUnit)

    /// SI meters → the user's distance unit, integer digits, with the unit label (web
    /// `${fmtInt(fromKm(total_distance))} ${distanceUnit}`).
    public static func distanceInt(_ meters: Double, _ prefs: UnitPreferences) -> String {
        "\(number(Units.convertDistance(meters, prefs), decimals: 0)) \(prefs.distance)"
    }

    /// SI meters → the user's distance unit, default precision, with the unit label (web
    /// `${fmtNumber(fromKm(m))} ${distanceUnit}`).
    public static func distance(_ meters: Double, _ prefs: UnitPreferences) -> String {
        "\(number(Units.convertDistance(meters, prefs), decimals: defaultDecimals(prefs))) \(prefs.distance)"
    }

    // MARK: - Efficiency (web `whPerKmToDisplay` + efficiencyUnit)

    /// Web `efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km'`.
    public static func efficiencyUnit(_ prefs: UnitPreferences) -> String {
        prefs.distance == "mi" ? "Wh/mi" : "Wh/km"
    }

    /// Web `whPerKmToDisplay`: Wh/km stays as-is for metric, scaled by km-per-mile for imperial.
    public static func efficiencyValue(_ whPerKm: Double, _ prefs: UnitPreferences) -> Double {
        prefs.distance == "mi" ? whPerKm * 1.609344 : whPerKm
    }

    /// Web `${fmtNumber(whPerKmToDisplay(avg_efficiency))} ${efficiencyUnit}`.
    public static func efficiency(_ whPerKm: Double, _ prefs: UnitPreferences) -> String {
        "\(number(efficiencyValue(whPerKm, prefs), decimals: defaultDecimals(prefs))) \(efficiencyUnit(prefs))"
    }

    // MARK: - Energy + battery (always kWh on this page; web hardcodes the `kWh` label)

    /// SI watt-hours → `${fmtNumber(energy_used)} kWh` (web shows kWh directly, no unit pref).
    public static func energyKWh(_ wattHours: Double, _ prefs: UnitPreferences) -> String {
        "\(number(wattHours / 1000, decimals: defaultDecimals(prefs))) kWh"
    }

    /// SI watt-hours → `${fmtNumber(estimated_capacity, 1)} kWh` (web battery capacity, 1 decimal).
    public static func capacityKWh(_ wattHours: Double) -> String {
        "\(number(wattHours / 1000, decimals: 1)) kWh"
    }

    /// Web `${fmtNumber(degradation_rate_yr, 2)}%/yr`.
    public static func degradationPerYear(_ ratePercent: Double) -> String {
        "\(number(ratePercent, decimals: 2))%/yr"
    }

    /// Web `${battery_age_months} mo`.
    public static func ageMonths(_ months: Int) -> String {
        "\(months) mo"
    }

    // MARK: - CO₂ + cost

    /// Web `${fmtNumber(co2_saved)} kg`.
    public static func co2(_ kilograms: Double, _ prefs: UnitPreferences) -> String {
        "\(number(kilograms, decimals: defaultDecimals(prefs))) kg"
    }

    /// Web `formatCurrency(total_cost, 0)`.
    public static func totalCost(_ amount: Double) -> String {
        currency(amount, decimals: 0)
    }

    /// Web `total_distance > 0 ? formatCurrency(total_cost / total_distance, 3) : '—'` — currency
    /// per kilometer at 3 decimals, em dash when there is no distance.
    public static func costPerKm(_ value: Double?) -> String {
        guard let value, value.isFinite else { return emptyValue }
        return currency(value, decimals: 3)
    }
}
