import Foundation

/// Pure display-boundary formatters for the Year-in-Review story (web `fmtNumber` / `convertDistanceFromSI`
/// / `useUnits` helpers + the per-slide inline math). SI values come from the model; conversion to
/// the user's unit preference happens here via the shared `Units` facade (P1/S5) — never in the
/// model. Each returns an em dash for non-finite input (never "nan").
public enum YearReviewStoryFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

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

    /// Web `Math.round(value)` rendered with grouping (web `fmtInt`).
    public static func integer(_ value: Double) -> String {
        number(value.rounded(), decimals: 0)
    }

    /// Web `$${Math.round(amount)}` / `formatCurrency` — whole-dollar USD by default.
    public static func currency(_ amount: Double, decimals: Int = 0, code: String = "USD") -> String {
        guard amount.isFinite else { return emptyValue }
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = code
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: amount)) ?? emptyValue
    }

    // MARK: - Distance (web `convertDistanceFromSI(km * 1000, unit)` + distanceUnit)

    /// SI meters → the user's distance unit as a Double (web `convertDistanceFromSI`).
    public static func distanceValue(_ meters: Double, _ prefs: UnitPreferences) -> Double {
        Units.convertDistance(meters, prefs)
    }

    /// SI meters → the user's distance unit, rounded to a whole number (web `Math.round(distDisplay)`).
    public static func distanceInt(_ meters: Double, _ prefs: UnitPreferences) -> String {
        integer(distanceValue(meters, prefs))
    }

    // MARK: - Energy (always kWh on this surface; web reads `total_energy_kwh` directly)

    /// SI watt-hours → kWh as a Double (web wire is already kWh; the model stores SI Wh).
    public static func energyKWhValue(_ wattHours: Double) -> Double {
        wattHours / 1000
    }

    // MARK: - Efficiency (web `efficiencyUnit` + `whPerKm * KM_PER_MILE` for imperial)

    /// Web `distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km'`.
    public static func efficiencyUnit(_ prefs: UnitPreferences) -> String {
        prefs.distance == "mi" ? "Wh/mi" : "Wh/km"
    }

    /// Web `whPerKm` scaled by km-per-mile for imperial, unchanged for metric.
    public static func efficiencyValue(_ whPerKm: Double, _ prefs: UnitPreferences) -> Double {
        prefs.distance == "mi" ? whPerKm * 1.609344 : whPerKm
    }

    // MARK: - Patterns (web hour label + percent)

    /// Whole percent for charging-mix / SoC labels (web `Math.round(value)`).
    public static func percentInt(_ value: Double) -> Int {
        guard value.isFinite else { return 0 }
        return Int(value.rounded())
    }

    /// Web `hour >= 12 ? '… PM' : '… AM'`, rendered locale-aware (no hardcoded AM/PM literal).
    public static func hourLabel(_ hour: Int) -> String {
        var components = DateComponents()
        components.hour = max(0, min(hour, 23))
        let calendar = Calendar(identifier: .gregorian)
        guard let date = calendar.date(from: components) else { return emptyValue }
        return date.formatted(.dateTime.hour(.defaultDigits(amPM: .abbreviated)))
    }

    /// Web `${hours}h ${mins}m` / `${mins}m`, rendered locale-aware from SI seconds.
    public static func durationShort(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds > 0 else { return emptyValue }
        return Duration.seconds(seconds).formatted(
            .units(allowed: [.hours, .minutes], width: .narrow, zeroValueUnits: .hide)
        )
    }

    /// Localized short month symbol for a 1…12 month number (web `MONTH_LABELS`).
    public static func monthShortLabel(_ month: Int) -> String {
        let symbols = Calendar(identifier: .gregorian).shortMonthSymbols
        guard month >= 1, month <= symbols.count else { return "M\(month)" }
        return symbols[month - 1]
    }

    /// Resolves a catalog key to its localized String (for chart legends / VoiceOver names that
    /// need a plain `String` rather than a `LocalizedStringKey`).
    public static func localized(_ key: String) -> String {
        String(localized: String.LocalizationValue(key))
    }
}
