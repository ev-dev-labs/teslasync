import Foundation

/// Pure display-boundary formatters for the Battery Health surface (web `fmtNumber` /
/// `fmtInt` / `fmtPercent` + the inline `${value} kWh` / `${value} ${tempUnit}`
/// formatting). Percentages, scores, capacities, and cycle counts are
/// unit-preference-independent so they format here directly; module temperatures and
/// ranges convert through the shared SI `Units` facade at the view boundary. Numeric
/// formatting is delegated to the sibling `BatteryDegradationFormat` so both battery
/// surfaces render identical en-US grouping + em-dash-for-non-finite behaviour.
public enum BatteryHealthFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = BatteryDegradationFormat.emptyValue

    /// Web `fmtNumber(value, decimals)` — en-US grouping, fixed fraction digits.
    public static func number(_ value: Double, decimals: Int) -> String {
        BatteryDegradationFormat.number(value, decimals: decimals)
    }

    /// Web `fmtInt(value)` → `fmtNumber(value, 0)`.
    public static func integer(_ value: Double) -> String {
        BatteryDegradationFormat.integer(value)
    }

    /// Web `fmtPercent(value)` → `${fmtNumber(value, decimals)}%`; default precision
    /// matches the web global precision preference (`prefs.precision ?? 2`).
    public static func percent(_ value: Double, _ prefs: UnitPreferences) -> String {
        "\(number(value, decimals: prefs.precision ?? 2))%"
    }

    /// Web `${fmtNumber(value, decimals)}%` with explicit fraction digits.
    public static func percent(_ value: Double, decimals: Int) -> String {
        "\(number(value, decimals: decimals))%"
    }

    /// Web `${fmtNumber(value, decimals)} kWh` — capacity is served + shown in kWh.
    public static func kilowattHours(_ value: Double, decimals: Int = 1) -> String {
        "\(number(value, decimals: decimals)) kWh"
    }

    /// Web `convertEnergyFromSI(wh, 'kWh')` — a fixed Wh→kWh unit fact (not a user-pref
    /// conversion), used by the AC/DC breakdown which always renders kWh.
    public static func kilowattHours(fromWh wh: Double) -> Double {
        wh / 1000
    }

    /// Web `${fmtNumber(toTemperatureDisplay(celsius), 1)} ${tempUnit}` — SI Celsius
    /// converted to the user's temperature unit with its label, at one decimal.
    public static func temperature(_ celsius: Double, _ prefs: UnitPreferences) -> String {
        let display = Units.convertTemperature(celsius, prefs)
        return "\(number(display, decimals: 1)) \(prefs.temperature)"
    }

    /// Web temperature-spread `fmtNumber(toDisplay(max) - toDisplay(min), 1) ${tempUnit}`.
    /// Converting each endpoint then subtracting cancels the scale offset, yielding the
    /// correct delta in the display unit.
    public static func temperatureSpread(
        maxC: Double,
        minC: Double,
        _ prefs: UnitPreferences
    ) -> String {
        let delta = Units.convertTemperature(maxC, prefs) - Units.convertTemperature(minC, prefs)
        return "\(number(delta, decimals: 1)) \(prefs.temperature)"
    }

    /// Web `formatDateShort(date)` — a medium date label for the chart axes.
    public static func dateShort(_ raw: String) -> String {
        BatteryDegradationFormat.dateLabel(raw)
    }

    /// Web `p.month.slice(0, 7)` — the `YYYY-MM` projection label.
    public static func monthLabel(_ raw: String) -> String {
        String(raw.prefix(7))
    }

    /// Web `yearsTo80 = projectionTrustworthy ? fmtNumber(years, 1) : '—'`.
    public static func yearsTo80(_ years: Double?, trustworthy: Bool) -> String {
        guard trustworthy, let years, years.isFinite else { return emptyValue }
        return number(years, decimals: 1)
    }
}
