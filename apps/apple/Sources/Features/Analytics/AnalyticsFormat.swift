import Foundation

/// Pure display-boundary formatters + converters for the Fleet-Analytics surface (web `fmtNumber` /
/// `fmtInt` / `formatCurrency` / `useUnits` / `useFormatting` helpers). SI values come from the
/// model; conversion to the user's unit preference happens here via the shared KMP `Units` facade
/// (P1/S5) — never in the model. String formatters return an em dash for nil/non-finite input
/// (never "nan"); the `*Value` converters feed Swift Charts raw `Double`s in the user's unit.
public enum AnalyticsFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

    /// The fraction digits a bare `fmtNumber(v)` uses — the user's global precision (web default 2).
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

    // MARK: - Distance (web `convertDistanceFromSI(m, unit)` + distanceUnit)

    /// SI meters → the user's distance unit as a raw chart value.
    public static func distanceValue(_ meters: Double, _ prefs: UnitPreferences) -> Double {
        Units.convertDistance(meters, prefs)
    }

    /// SI meters → `${fmtNumber(value, decimals)} ${distanceUnit}`.
    public static func distance(_ meters: Double, _ prefs: UnitPreferences, decimals: Int = 1) -> String {
        "\(number(distanceValue(meters, prefs), decimals: decimals)) \(prefs.distance)"
    }

    /// SI meters → `${fmtInt(value)} ${distanceUnit}` (web hero/leaderboard integer distance).
    public static func distanceInt(_ meters: Double, _ prefs: UnitPreferences) -> String {
        "\(integer(distanceValue(meters, prefs))) \(prefs.distance)"
    }

    // MARK: - Speed (web `convertSpeedFromSI(mps, unit)` + speedUnit)

    /// SI metres-per-second → the user's speed unit as a raw chart value.
    public static func speedValue(_ mps: Double, _ prefs: UnitPreferences) -> Double {
        Units.convertSpeed(mps, prefs)
    }

    /// SI metres-per-second → `${fmtNumber(value, 0)} ${speedUnit}`.
    public static func speed(_ mps: Double, _ prefs: UnitPreferences) -> String {
        "\(number(speedValue(mps, prefs), decimals: 0)) \(prefs.speed)"
    }

    // MARK: - Temperature (web `convertTempFromSI(°C, unit)` + tempUnit)

    /// SI °C → the user's temperature unit as a raw chart value.
    public static func temperatureValue(_ celsius: Double, _ prefs: UnitPreferences) -> Double {
        Units.convertTemperature(celsius, prefs)
    }

    /// SI °C → `${fmtNumber(value, 1)} ${tempUnit}`.
    public static func temperature(_ celsius: Double, _ prefs: UnitPreferences) -> String {
        "\(number(temperatureValue(celsius, prefs), decimals: 1)) \(prefs.temperature)"
    }

    // MARK: - Power (web kW; SI base is watts)

    /// SI watts → kilowatts as a raw chart value (web charts plot kW directly).
    public static func powerKWValue(_ watts: Double) -> Double {
        watts / 1000
    }

    /// SI watts → `${fmtNumber(kW, 0)} kW` (web `power_stats`/`regen_stats` cards show whole kW).
    public static func powerKW(_ watts: Double) -> String {
        "\(number(powerKWValue(watts), decimals: 0))"
    }

    // MARK: - Duration (web min; SI base is seconds)

    /// SI seconds → minutes as a raw chart value.
    public static func durationMinValue(_ seconds: Double) -> Double {
        seconds / 60
    }

    /// SI seconds → `${fmtNumber(min, 0)}` (web `duration_stats.avg` shows whole minutes).
    public static func durationMin(_ seconds: Double) -> String {
        number(durationMinValue(seconds), decimals: 0)
    }

    // MARK: - Energy (web kWh; SI base is watt-hours)

    /// SI watt-hours → kilowatt-hours as a raw chart value.
    public static func energyKWhValue(_ wattHours: Double) -> Double {
        wattHours / 1000
    }

    /// SI watt-hours → `${fmtNumber(kWh, decimals)}` (web hero/charging energy shows kWh).
    public static func energyKWh(_ wattHours: Double, decimals: Int = 1) -> String {
        number(energyKWhValue(wattHours), decimals: decimals)
    }

    // MARK: - Efficiency (web `whPerKmToDisplay` + efficiencyUnit)

    /// Web `efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km'`.
    public static func efficiencyUnit(_ prefs: UnitPreferences) -> String {
        prefs.distance == "mi" ? "Wh/mi" : "Wh/km"
    }

    /// Web `whPerKmToDisplay`: Wh/km stays for metric, scaled by km-per-mile for imperial.
    public static func efficiencyValue(_ whPerKm: Double, _ prefs: UnitPreferences) -> Double {
        prefs.distance == "mi" ? whPerKm * 1.609344 : whPerKm
    }

    /// Web `${fmtNumber(whPerKmToDisplay(eff), 1)} ${efficiencyUnit}`.
    public static func efficiency(_ whPerKm: Double, _ prefs: UnitPreferences) -> String {
        "\(number(efficiencyValue(whPerKm, prefs), decimals: 1)) \(efficiencyUnit(prefs))"
    }

    // MARK: - Percent + plain scalars

    /// Web `${fmtNumber(value, decimals)}%`.
    public static func percent(_ value: Double, decimals: Int = 1) -> String {
        "\(number(value, decimals: decimals))%"
    }

    /// Web `${fmtNumber(value, decimals)} kg`.
    public static func kilograms(_ value: Double, decimals: Int = 0) -> String {
        "\(number(value, decimals: decimals)) kg"
    }
}
